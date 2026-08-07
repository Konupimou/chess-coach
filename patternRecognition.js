import { Chess, SQUARES } from "chess.js";
import { buildPositionConceptFingerprint } from "./positionConcepts.js";
import { motifRuleFor } from "./motifRules.js";

const VALUES = Object.freeze({ p: 1, n: 3, b: 3, r: 5, q: 9, k: 100 });
const TACTICAL = new Set([
  "fork", "pin", "loose_piece", "overloaded_defender", "mate_motif",
  "back_rank_mate", "remove_defender", "discovered_attack", "skewer",
]);
const POSITION_CACHE = new Map();
const MAX_CACHE_ENTRIES = 128;

export const PATTERN_LABELS = Object.freeze({
  fork: "Gabel",
  pin: "Fesselung",
  loose_piece: "Ungedeckte Figur",
  overloaded_defender: "Überlastete Verteidigung",
  mate_motif: "Mattmuster",
  back_rank_mate: "Grundreihenmatt",
  remove_defender: "Verteidiger beseitigen",
  deflection: "Ablenkung",
  zwischenzug: "Zwischenzug",
  discovered_attack: "Abzugsangriff",
  skewer: "Spieß",
  isolated_pawn: "Isolierter Bauer",
  passed_pawn: "Freibauer",
  backward_pawn: "Rückständiger Bauer",
  hanging_pawns: "Hängende Bauern",
  queenside_pawn_majority: "Bauernmehrheit am Damenflügel",
  kingside_pawn_majority: "Bauernmehrheit am Königsflügel",
  minority_attack: "Minderheitsangriff",
  outpost: "Vorposten",
  bad_bishop: "Schlechter Läufer",
  good_bishop: "Guter Läufer",
  development_advantage: "Entwicklungsvorsprung",
  open_center_against_uncastled_king: "Offenes Zentrum gegen den unrochierten König",
  opposite_side_castling_attack: "Angriff bei Rochaden auf verschiedenen Flügeln",
  rook_on_open_file: "Turm auf offener Linie",
  space_advantage: "Raumvorteil",
  king_activity_endgame: "Aktiver König im Endspiel",
  opposition: "Opposition",
});

const opposite = (color) => color === "w" ? "b" : "w";

function load(fen) {
  if (typeof fen !== "string" || fen.trim().split(/\s+/).length < 4) return null;
  try { return new Chess(fen); } catch { return null; }
}

function boardPieces(game) {
  return SQUARES.flatMap((square) => {
    const piece = game.get(square);
    return piece ? [{ square, ...piece }] : [];
  });
}

function materialBalance(game, side) {
  return boardPieces(game).reduce((sum, piece) => {
    const value = piece.type === "k" ? 0 : VALUES[piece.type] || 0;
    return sum + (piece.color === side ? value : -value);
  }, 0);
}

function immediateExchangeAt(game, side, square, initialGain = 0) {
  const replies = game.moves({ verbose: true })
    .filter((reply) => reply.to === square && reply.captured);
  if (!replies.length) return null;
  return replies.map((reply) => {
    const afterReply = new Chess(game.fen());
    const captured = afterReply.move({ from: reply.from, to: reply.to, promotion: reply.promotion });
    if (!captured) return null;
    const lostValue = VALUES[captured.captured] || 0;
    const recapture = afterReply.moves({ verbose: true })
      .filter((response) => response.to === square && response.captured)
      .sort((a, b) => (VALUES[b.captured] || 0) - (VALUES[a.captured] || 0))[0];
    const gain = initialGain - lostValue + (recapture ? VALUES[captured.piece] || 0 : 0);
    return {
      gain,
      line: [captured.san, ...(recapture ? [recapture.san] : [])],
      recapture: recapture?.san || "",
    };
  }).filter(Boolean).sort((a, b) => a.gain - b.gain)[0] || null;
}

function uci(move) {
  return `${move.from}${move.to}${move.promotion || ""}`;
}

function attackedTargets(game, attackerSquare, color) {
  return boardPieces(game)
    .filter((piece) => piece.color === opposite(color) && piece.type !== "p")
    .filter((piece) => game.attackers(piece.square, color).includes(attackerSquare))
    .sort((a, b) => VALUES[b.type] - VALUES[a.type] || a.square.localeCompare(b.square));
}

function timingText(timing) {
  if (timing === "created") return "Durch den letzten Zug entstanden";
  if (timing === "removed") return "Durch den letzten Zug verhindert";
  if (timing === "persistent") return "Bereits vor dem letzten Zug vorhanden";
  return "In der aktuellen Stellung";
}

function forkOpportunity(game, candidate) {
  const side = game.turn();
  const balanceBefore = materialBalance(game, side);
  const next = new Chess(game.fen());
  const played = next.move({ from: candidate.from, to: candidate.to, promotion: candidate.promotion });
  if (!played) return null;
  const targets = attackedTargets(next, played.to, side);
  if (targets.length < 2) return null;

  const capturedValue = VALUES[played.captured] || 0;
  const attackerValue = VALUES[played.piece] || 0;
  const outcomes = next.moves({ verbose: true }).map((reply) => {
    const continuation = new Chess(next.fen());
    const defended = continuation.move({ from: reply.from, to: reply.to, promotion: reply.promotion });
    if (!defended) return { gain: 0, line: [reply.san], reason: "unknown" };
    if (!continuation.get(played.to) || (reply.to === played.to && reply.captured)) {
      const recapture = continuation.moves({ verbose: true })
        .filter((response) => response.to === played.to && response.captured)
        .sort((a, b) => (VALUES[b.captured] || 0) - (VALUES[a.captured] || 0))[0];
      const exchangeGain = capturedValue - attackerValue + (recapture ? VALUES[reply.piece] || 0 : 0);
      return recapture
        ? { gain: exchangeGain, line: [reply.san, recapture.san], reason: exchangeGain > 0 ? "recapture_wins" : "attacker_captured" }
        : { gain: capturedValue - attackerValue, line: [reply.san], reason: "attacker_captured" };
    }
    const targetSquares = new Set(targets.map((target) => target.square));
    const payoff = continuation.moves({ square: played.to, verbose: true })
      .filter((response) => response.captured && targetSquares.has(response.to))
      .sort((a, b) => (VALUES[b.captured] || 0) - (VALUES[a.captured] || 0))[0];
    return payoff
      ? { gain: capturedValue + (VALUES[payoff.captured] || 0), line: [reply.san, payoff.san], reason: "target_won" }
      : { gain: 0, line: [reply.san], reason: "fork_neutralized" };
  });
  const outcomePriority = { attacker_captured: 0, fork_neutralized: 1, unknown: 2, recapture_wins: 3, target_won: 4 };
  const worst = outcomes.sort((a, b) => (
    a.gain - b.gain || (outcomePriority[a.reason] ?? 9) - (outcomePriority[b.reason] ?? 9)
  ))[0] || {
    gain: capturedValue + (VALUES[targets[1]?.type] || 0), line: [], reason: "target_won",
  };
  const materialGain = worst.gain;
  const balanceAfter = balanceBefore + materialGain;
  const status = worst.reason === "attacker_captured" && materialGain <= 0
    ? "refuted"
    : materialGain > 0
      ? "winning"
      : "unclear";
  const targetText = targets.map((target) => `${target.square} (${target.type})`).join(" und ");
  const explanation = status === "refuted"
    ? `${played.san} erzeugt geometrisch eine Gabel auf ${targetText}, aber ${worst.line[0]} schlägt den Angreifer sofort.`
    : status === "winning"
      ? worst.reason === "recapture_wins"
        ? `${played.san} greift gleichzeitig ${targetText} an. Nach ${worst.line.join(" ")} bleibt ${side === "w" ? "Weiß" : "Schwarz"} materiell im Vorteil.`
        : `${played.san} greift gleichzeitig ${targetText} an; auch nach der besten Verteidigung bleibt ein Ziel schlagbar.`
      : `${played.san} sieht wie eine Gabel auf ${targetText} aus, gewinnt nach der legalen Antwortprüfung aber nicht sicher Material.`;
  return {
    id: `fork:${uci(played)}:${targets.map((target) => target.square).join("-")}`,
    type: "fork",
    category: "tactical",
    side,
    status,
    move: { uci: uci(played), san: played.san, from: played.from, to: played.to },
    attacker: played.to,
    targets: targets.map((target) => ({ square: target.square, piece: target.type, value: VALUES[target.type] })),
    criticalSquares: [played.from, played.to, ...targets.map((target) => target.square)],
    materialGain,
    materialBalanceBefore: balanceBefore,
    materialBalanceAfter: balanceAfter,
    proofLine: [played.san, ...worst.line],
    confidence: status === "refuted" ? 0.99 : status === "winning" ? 0.96 : 0.8,
    explanation,
    score: status === "winning" ? 100 + materialGain * 8 : status === "refuted" ? 42 : 58,
  };
}

function removalOfDefenderOpportunity(game, candidate) {
  if (!candidate.captured) return null;
  const side = game.turn();
  const enemy = opposite(side);
  const defendedTargets = boardPieces(game)
    .filter((piece) => piece.color === enemy && piece.square !== candidate.to && piece.type !== "p")
    .filter((piece) => game.attackers(piece.square, enemy).length === 1)
    .filter((piece) => game.attackers(piece.square, enemy)[0] === candidate.to)
    .filter((piece) => game.attackers(piece.square, side).length > 0);
  if (!defendedTargets.length) return null;
  const next = new Chess(game.fen());
  const played = next.move({ from: candidate.from, to: candidate.to, promotion: candidate.promotion });
  if (!played) return null;
  const target = defendedTargets.sort((a, b) => VALUES[b.type] - VALUES[a.type])[0];
  const initialGain = VALUES[played.captured] || 0;
  const exchange = immediateExchangeAt(next, side, played.to, initialGain);
  const status = exchange && exchange.gain < 0 ? "refuted" : "active";
  const balanceBefore = materialBalance(game, side);
  const materialGain = exchange?.gain ?? initialGain;
  return {
    id: `remove_defender:${uci(played)}:${target.square}`,
    type: "remove_defender", category: "tactical", side, status,
    move: { uci: uci(played), san: played.san, from: played.from, to: played.to },
    attacker: played.to, targets: [{ square: target.square, piece: target.type, value: VALUES[target.type] }],
    criticalSquares: [played.from, played.to, target.square], materialGain,
    materialBalanceBefore: balanceBefore,
    materialBalanceAfter: balanceBefore + materialGain,
    proofLine: [played.san, ...(exchange?.line || [])], confidence: status === "refuted" ? 0.97 : 0.86,
    explanation: status === "refuted"
      ? `${played.san} beseitigt zwar den Verteidiger von ${target.square}, verliert nach ${exchange.line.join(" ")} aber Material.`
      : `${played.san} beseitigt den einzigen Verteidiger der Figur auf ${target.square}; die unmittelbare Abtauschprüfung widerlegt die Idee nicht.`,
    score: status === "refuted" ? 40 : 78 + VALUES[target.type] * 3,
  };
}

function deflectionOpportunity(game, candidate) {
  const side = game.turn();
  const enemy = opposite(side);
  const defenders = boardPieces(game).filter((piece) => piece.color === enemy && piece.type !== "k");
  const duties = new Map(defenders.map((defender) => [
    defender.square,
    boardPieces(game).filter((target) => (
      target.color === enemy
      && target.square !== defender.square
      && target.type !== "p"
      && game.attackers(target.square, enemy).length === 1
      && game.attackers(target.square, enemy)[0] === defender.square
      && game.attackers(target.square, side).length > 0
    )),
  ]));
  if (![...duties.values()].some((entries) => entries.length)) return null;
  const next = new Chess(game.fen());
  const played = next.move({ from: candidate.from, to: candidate.to, promotion: candidate.promotion });
  if (!played) return null;
  for (const reply of next.moves({ verbose: true }).filter((move) => move.to === played.to && move.captured)) {
    const targets = duties.get(reply.from) || [];
    if (!targets.length) continue;
    const continuation = new Chess(next.fen());
    const displaced = continuation.move({ from: reply.from, to: reply.to, promotion: reply.promotion });
    if (!displaced) continue;
    const payoff = continuation.moves({ verbose: true })
      .filter((move) => move.captured && targets.some((target) => target.square === move.to))
      .sort((a, b) => (VALUES[b.captured] || 0) - (VALUES[a.captured] || 0))[0];
    if (!payoff) continue;
    const initialGain = VALUES[played.captured] || 0;
    const gain = initialGain - (VALUES[played.piece] || 0) + (VALUES[payoff.captured] || 0);
    const target = targets.find((entry) => entry.square === payoff.to) || targets[0];
    const balanceBefore = materialBalance(game, side);
    return {
      id: `deflection:${uci(played)}:${reply.from}:${target.square}`,
      type: "deflection", category: "tactical", side,
      status: gain > 0 ? "winning" : "unclear",
      move: { uci: uci(played), san: played.san, from: played.from, to: played.to },
      attacker: played.to,
      targets: [{ square: target.square, piece: target.type, value: VALUES[target.type] }],
      criticalSquares: [played.from, played.to, reply.from, target.square],
      materialGain: gain, materialBalanceBefore: balanceBefore, materialBalanceAfter: balanceBefore + gain,
      proofLine: [played.san, displaced.san, payoff.san], confidence: gain > 0 ? 0.92 : 0.78,
      explanation: `${played.san} lockt den einzigen Verteidiger von ${target.square} weg. Nach ${displaced.san} wird ${payoff.san} möglich.`,
      score: gain > 0 ? 112 + gain * 5 : 62,
    };
  }
  return null;
}

function matingOpportunities(game) {
  return game.moves({ verbose: true }).flatMap((candidate) => {
    const next = new Chess(game.fen());
    const played = next.move({ from: candidate.from, to: candidate.to, promotion: candidate.promotion });
    if (!played || !next.isCheckmate()) return [];
    const backRank = ["r", "q"].includes(played.piece) && ["1", "8"].includes(played.to[1]);
    const type = backRank ? "back_rank_mate" : "mate_motif";
    return [{
      id: `${type}:${uci(played)}`, type, category: "tactical", side: game.turn(), status: "winning",
      move: { uci: uci(played), san: played.san, from: played.from, to: played.to },
      attacker: played.to, targets: [], criticalSquares: [played.from, played.to], materialGain: null,
      proofLine: [played.san], confidence: 1,
      explanation: `${played.san} setzt unmittelbar matt.`, score: 1000,
    }];
  });
}

function skewerPatterns(game) {
  const directions = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];
  const files = "abcdefgh";
  const items = boardPieces(game);
  const at = new Map(items.map((piece) => [piece.square, piece]));
  const results = [];
  for (const slider of items.filter((piece) => ["b", "r", "q"].includes(piece.type))) {
    for (const [df, dr] of directions) {
      const diagonal = df !== 0 && dr !== 0;
      if (slider.type === "b" && !diagonal) continue;
      if (slider.type === "r" && diagonal) continue;
      const hits = [];
      let file = files.indexOf(slider.square[0]) + df;
      let rank = Number(slider.square[1]) + dr;
      while (file >= 0 && file < 8 && rank >= 1 && rank <= 8 && hits.length < 2) {
        const piece = at.get(`${files[file]}${rank}`);
        if (piece) hits.push(piece);
        file += df;
        rank += dr;
      }
      if (
        hits.length === 2
        && hits.every((piece) => piece.color === opposite(slider.color) && piece.type !== "p")
        && VALUES[hits[0].type] > VALUES[hits[1].type]
      ) {
        const exchange = game.turn() === opposite(slider.color)
          ? immediateExchangeAt(game, slider.color, slider.square, 0)
          : null;
        const status = exchange?.gain < 0 ? "refuted" : "active";
        const balanceBefore = materialBalance(game, slider.color);
        results.push({
          id: `skewer:${slider.square}:${hits[0].square}:${hits[1].square}`,
          type: "skewer", category: "tactical", side: slider.color, status,
          move: null, attacker: slider.square,
          targets: hits.map((piece) => ({ square: piece.square, piece: piece.type, value: VALUES[piece.type] })),
          criticalSquares: [slider.square, ...hits.map((piece) => piece.square)], materialGain: exchange?.gain ?? null,
          materialBalanceBefore: balanceBefore,
          materialBalanceAfter: balanceBefore + (exchange?.gain || 0),
          proofLine: exchange?.line || [], confidence: status === "refuted" ? 0.97 : 0.9,
          explanation: status === "refuted"
            ? `Der Spieß ist geometrisch vorhanden, aber nach ${exchange.line.join(" ")} geht der Angreifer materiell ungünstig verloren.`
            : `Die Figur auf ${slider.square} greift zuerst das wertvollere Ziel auf ${hits[0].square} an; dahinter steht ${hits[1].square}.`,
          score: status === "refuted" ? 43 : 82,
        });
      }
    }
  }
  return results;
}

function discoveredAttackOpportunity(game, candidate) {
  const side = game.turn();
  const enemies = boardPieces(game).filter((piece) => piece.color === opposite(side) && piece.type !== "p");
  const beforeAttackers = new Map(enemies.map((piece) => [piece.square, new Set(game.attackers(piece.square, side))]));
  const next = new Chess(game.fen());
  const played = next.move({ from: candidate.from, to: candidate.to, promotion: candidate.promotion });
  if (!played) return null;
  const revealed = enemies.flatMap((target) => next.attackers(target.square, side)
    .filter((square) => !beforeAttackers.get(target.square)?.has(square) && square !== played.to)
    .flatMap((square) => {
      const attacker = next.get(square);
      return attacker && ["b", "r", "q"].includes(attacker.type) ? [{ square, target }] : [];
    }));
  if (!revealed.length) return null;
  const best = revealed.sort((a, b) => VALUES[b.target.type] - VALUES[a.target.type])[0];
  const exchange = immediateExchangeAt(next, side, best.square, VALUES[played.captured] || 0);
  const losesMaterial = Boolean(exchange && exchange.gain < 0);
  const status = losesMaterial ? "refuted" : "active";
  const proofLine = [played.san, ...(exchange?.line || [])];
  const balanceBefore = materialBalance(game, side);
  const materialGain = exchange?.gain ?? (VALUES[played.captured] || 0);
  return {
    id: `discovered_attack:${uci(played)}:${best.target.square}`,
    type: "discovered_attack", category: "tactical", side, status,
    move: { uci: uci(played), san: played.san, from: played.from, to: played.to },
    attacker: best.square,
    targets: [{ square: best.target.square, piece: best.target.type, value: VALUES[best.target.type] }],
    criticalSquares: [played.from, played.to, best.square, best.target.square], materialGain,
    materialBalanceBefore: balanceBefore,
    materialBalanceAfter: balanceBefore + materialGain,
    proofLine, confidence: losesMaterial ? 0.98 : 0.84,
    explanation: losesMaterial
      ? `${played.san} öffnet zwar den Angriff auf ${best.target.square}, aber nach ${exchange.line.join(" ")} geht die wertvollere angreifende Figur verloren.`
      : `${played.san} öffnet den Angriff der Figur auf ${best.square} gegen ${best.target.square}; die unmittelbare Abtauschprüfung widerlegt die Idee nicht.`,
    score: losesMaterial ? 45 : 74 + VALUES[best.target.type] * 2,
  };
}

function conceptPatterns(fen) {
  const fingerprint = buildPositionConceptFingerprint(fen);
  const game = load(fen);
  if (!fingerprint) return [];
  const grouped = new Map();
  const sideName = (side) => side === "w" ? "Weiß" : "Schwarz";
  const pieceName = (piece) => ({
    p: "Bauer", n: "Springer", b: "Läufer", r: "Turm", q: "Dame", k: "König",
  })[piece?.type] || "Figur";
  const conceptExplanation = (concept, warning) => {
    const squares = concept.criticalSquares || [];
    if (concept.id === "pin" && squares.length >= 3) {
      const attacker = squares.find((square) => {
        const piece = game?.get(square);
        return piece?.color === concept.side && ["b", "r", "q"].includes(piece.type);
      });
      const king = squares.find((square) => game?.get(square)?.type === "k");
      const pinned = squares.find((square) => square !== attacker && square !== king);
      return `${sideName(concept.side)} fesselt mit ${pieceName(game?.get(attacker))} auf ${attacker} `
        + `${pieceName(game?.get(pinned))} auf ${pinned} an den König auf ${king}.`;
    }
    if (concept.id === "bad_bishop" && squares.length >= 2) {
      const [bishop, ...pawns] = squares;
      return `Der ${sideName(concept.side).toLowerCase()}e Läufer auf ${bishop} wird durch eigene Bauern auf ${pawns.join(", ")} eingeschränkt.`;
    }
    return warning
      ? `${PATTERN_LABELS[concept.id] || concept.id} ist eine konkrete Schwäche auf ${squares.join(", ") || "dem Brett"}.`
      : `${PATTERN_LABELS[concept.id] || concept.id} betrifft ${squares.join(", ") || "die aktuelle Stellung"}.`;
  };
  for (const concept of fingerprint.concepts || []) {
    if (concept.id === "mate_motif") continue;
    const category = TACTICAL.has(concept.id) ? "tactical" : "strategic";
    const key = `${concept.id}:${concept.side}`;
    const current = grouped.get(key);
    if (current) {
      current.criticalSquares = [...new Set([...current.criticalSquares, ...(concept.criticalSquares || [])])].sort();
      current.confidence = Math.max(current.confidence, concept.confidence || 0);
      continue;
    }
    const warning = concept.polarity === "negative";
    const currentFork = concept.id === "fork";
    const forkAttacker = currentFork ? concept.criticalSquares?.[0] : "";
    const forkExchange = currentFork && game?.turn() === opposite(concept.side) && forkAttacker
      ? immediateExchangeAt(game, concept.side, forkAttacker, 0)
      : null;
    const forkStatus = !currentFork
      ? null
      : forkExchange
        ? forkExchange.gain < 0 ? "refuted" : forkExchange.gain > 0 ? "winning" : "unclear"
        : game?.turn() === opposite(concept.side) ? "winning" : "active";
    const balanceBefore = game ? materialBalance(game, concept.side) : 0;
    grouped.set(key, {
      id: key, type: concept.id, category, side: concept.side,
      status: forkStatus || (warning ? "warning" : "active"), move: null, attacker: forkAttacker || null, targets: [],
      criticalSquares: [...(concept.criticalSquares || [])], materialGain: forkExchange?.gain ?? null,
      materialBalanceBefore: currentFork ? balanceBefore : null,
      materialBalanceAfter: currentFork ? balanceBefore + (forkExchange?.gain || 0) : null,
      proofLine: forkExchange?.line || [],
      confidence: concept.confidence || 0.75,
      explanation: currentFork
        ? forkStatus === "refuted"
          ? `Die Gabel ist geometrisch vorhanden, aber nach ${forkExchange.line.join(" ")} geht der Angreifer materiell ungünstig verloren.`
          : forkStatus === "winning" && forkExchange
            ? `Die Gabel bleibt trotz ${forkExchange.line.join(" ")} materiell günstig.`
            : `Eine Figur greift in der aktuellen Stellung gleichzeitig mehrere gegnerische Ziele an.`
        : conceptExplanation(concept, warning),
      score: currentFork ? 95 : category === "tactical" ? 70 : 20 + Math.round((concept.confidence || 0.75) * 20),
    });
  }
  return [...grouped.values()];
}

function patternsInPosition(fen) {
  if (POSITION_CACHE.has(fen)) return POSITION_CACHE.get(fen);
  const game = load(fen);
  if (!game) return [];
  const legal = game.moves({ verbose: true });
  const opportunities = legal.flatMap((candidate) => [
    forkOpportunity(game, candidate),
    removalOfDefenderOpportunity(game, candidate),
    deflectionOpportunity(game, candidate),
    discoveredAttackOpportunity(game, candidate),
  ].filter(Boolean));
  const patterns = [...matingOpportunities(game), ...opportunities, ...skewerPatterns(game), ...conceptPatterns(fen)];
  POSITION_CACHE.set(fen, patterns);
  if (POSITION_CACHE.size > MAX_CACHE_ENTRIES) {
    POSITION_CACHE.delete(POSITION_CACHE.keys().next().value);
  }
  return patterns;
}

function signature(pattern) {
  return `${pattern.type}:${pattern.side}:${pattern.move?.uci || "position"}:${pattern.targets.map((target) => target.square).sort().join("-")}`;
}

function engineIntermediateMovePattern(fen, engine) {
  const line = Array.isArray(engine?.lineUci) ? engine.lineUci : [];
  const lastMove = String(engine?.lastMoveUci || "").toLowerCase();
  if (!engine?.lastMoveWasCapture || !line.length || !/^[a-h][1-8][a-h][1-8][qrbn]?$/.test(lastMove)) return null;
  const game = load(fen);
  if (!game) return null;
  const recaptureSquare = lastMove.slice(2, 4);
  const legal = game.moves({ verbose: true });
  const hasExpectedRecapture = legal.some((move) => move.to === recaptureSquare && move.captured);
  const bestUci = String(line[0] || "").toLowerCase();
  const best = legal.find((move) => uci(move) === bestUci);
  if (!hasExpectedRecapture || !best || best.to === recaptureSquare) return null;
  const forcing = /[+#]/u.test(best.san) || (best.captured && (VALUES[best.captured] || 0) >= 3);
  if (!forcing) return null;
  const lineGame = new Chess(game.fen());
  const proofLine = [];
  for (const moveUci of line.slice(0, 3)) {
    const frame = lineGame.move({
      from: String(moveUci).slice(0, 2),
      to: String(moveUci).slice(2, 4),
      promotion: String(moveUci).slice(4, 5) || undefined,
    });
    if (!frame) break;
    proofLine.push(frame.san);
  }
  return {
    id: `zwischenzug:${bestUci}`,
    type: "zwischenzug", category: "tactical", side: game.turn(), status: "active",
    move: { uci: bestUci, san: best.san, from: best.from, to: best.to },
    attacker: best.to, targets: [], criticalSquares: [best.from, best.to, recaptureSquare],
    materialGain: null, proofLine, confidence: 0.96,
    explanation: `Statt sofort auf ${recaptureSquare} zurückzuschlagen, spielt die Engine zuerst ${best.san} als stärkeren Zwischenzug.`,
    score: 145,
  };
}

function decorateWithRuleAndEngine(pattern, engine = {}) {
  const rule = motifRuleFor(pattern.type);
  const lineUci = Array.isArray(engine?.lineUci)
    ? engine.lineUci.map((move) => String(move || "").toLowerCase()).filter(Boolean)
    : [];
  const depth = Number.isFinite(engine?.depth) ? engine.depth : null;
  const engineSupportsMove = Boolean(pattern.move?.uci && lineUci[0] === pattern.move.uci);
  const engineStatus = !lineUci.length
    ? "unavailable"
    : engineSupportsMove
      ? "primary_line"
      : "not_primary_line";
  const checks = (rule?.validators || []).map((validator) => {
    let status = "not_evaluated";
    if (validator === "exchange_sequence") {
      status = Number.isFinite(pattern.materialGain) ? "passed" : "not_applicable";
    } else if (["legal_mate", "all_escapes_covered"].includes(validator)) {
      status = pattern.status === "winning" && pattern.type.includes("mate") ? "passed" : "not_applicable";
    } else if (validator === "best_defence") {
      status = pattern.proofLine?.length > 1 ? "passed" : engineSupportsMove ? "engine_supported" : "not_evaluated";
    } else if (["legal_mobility", "revealed_attacker_safety", "front_target_forced_to_move"].includes(validator)) {
      status = pattern.status === "refuted" ? "failed" : "passed";
    }
    return { validator, status };
  });
  const confidence = Math.min(1, pattern.confidence + (engineSupportsMove ? 0.03 : 0));
  return {
    ...pattern,
    confidence,
    knowledgeId: rule?.knowledgeId || null,
    ontologyId: rule?.ontologyId || null,
    knowledge: rule?.knowledge || null,
    ruleChecks: checks,
    engineEvidence: {
      status: engineStatus,
      depth,
      primaryMoveUci: lineUci[0] || null,
      supportsMove: engineSupportsMove,
      absenceDoesNotRefute: rule?.enginePolicy?.absenceDoesNotRefute !== false,
    },
    provenance: [
      "board_geometry",
      pattern.move ? "legal_move_search" : "position_structure",
      ...(Number.isFinite(pattern.materialGain) ? ["exchange_evaluation"] : []),
      ...(rule?.knowledge ? [`knowledge:${rule.knowledgeId}`] : []),
      ...(engineSupportsMove ? ["stockfish_primary_line"] : []),
    ],
  };
}

export function recognizePositionPatterns({ fenBefore = "", fenAfter = "", currentFen = "", engine = {} } = {}) {
  const effectiveAfter = fenAfter || currentFen || fenBefore;
  const before = patternsInPosition(fenBefore);
  const after = patternsInPosition(effectiveAfter);
  const beforeKeys = new Set(before.map(signature));
  const afterKeys = new Set(after.map(signature));
  const result = [];

  for (const pattern of after) {
    const timing = beforeKeys.has(signature(pattern)) ? "persistent" : "created";
    result.push({
      ...pattern,
      timing,
      timingText: timingText(timing),
      score: pattern.score + (timing === "created" ? 18 : 0),
    });
  }
  for (const pattern of before) {
    if (afterKeys.has(signature(pattern)) || pattern.category !== "tactical") continue;
    result.push({ ...pattern, timing: "removed", timingText: timingText("removed"), score: pattern.score - 20 });
  }
  const intermediate = engineIntermediateMovePattern(effectiveAfter, engine);
  if (intermediate) {
    result.push({
      ...intermediate,
      timing: "created",
      timingText: "Durch die Engine-Hauptvariante bestätigt",
    });
  }

  return result
    .sort((a, b) => b.score - a.score || b.confidence - a.confidence || a.id.localeCompare(b.id))
    .slice(0, 16)
    .map((pattern) => decorateWithRuleAndEngine(pattern, engine));
}
