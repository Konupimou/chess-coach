import { Chess } from "chess.js";

export const MATE_CENTIPAWNS = 10_000;

export const MOVE_QUALITY = Object.freeze({
  best: { label: "Bester Zug", shortLabel: "Best", tone: "best" },
  excellent: { label: "Sehr gut", shortLabel: "Sehr gut", tone: "excellent" },
  good: { label: "Gut", shortLabel: "Gut", tone: "good" },
  inaccuracy: { label: "Ungenauigkeit", shortLabel: "Ungenau", tone: "inaccuracy" },
  mistake: { label: "Fehler", shortLabel: "Fehler", tone: "mistake" },
  blunder: { label: "Patzer", shortLabel: "Patzer", tone: "blunder" },
});

const clamp = (value, minimum, maximum) => Math.max(minimum, Math.min(maximum, value));

export function pathToNode(node, limit = 300) {
  if (!node) return [];
  const path = [];
  const visited = new Set();
  let current = node;

  while (current && path.length <= limit) {
    if (visited.has(current)) {
      throw new Error("Der Variantenbaum enthält einen Kreis.");
    }
    visited.add(current);
    path.push(current);
    current = current.parent;
  }

  if (current) {
    throw new Error(`Die Partie ist länger als ${limit} Halbzüge.`);
  }
  return path.reverse();
}

export function buildPvFrames(fen, pv, limit = 8) {
  if (typeof fen !== "string" || !Array.isArray(pv) || limit <= 0) return [];
  const game = new Chess();
  try {
    game.load(fen);
  } catch {
    return [];
  }

  const frames = [];
  for (const value of pv.slice(0, limit)) {
    if (typeof value !== "string" || !/^[a-h][1-8][a-h][1-8][qrbn]?$/i.test(value)) break;
    let move;
    try {
      move = game.move({
        from: value.slice(0, 2),
        to: value.slice(2, 4),
        promotion: value.length > 4 ? value.slice(4, 5).toLowerCase() : undefined,
      });
    } catch {
      break;
    }
    if (!move) break;
    frames.push({
      fen: game.fen(),
      san: move.san,
      uci: value.toLowerCase(),
    });
  }
  return frames;
}

export function legalUciMove(fen, uci) {
  const frame = buildPvFrames(fen, [uci], 1)[0];
  return frame || null;
}

export function legalPv(fen, pv, limit = 20) {
  return buildPvFrames(fen, pv, limit);
}

export function verifiedSuggestionInfo(info, limit = 20) {
  if (!info || typeof info !== "object" || !Array.isArray(info.pv)) return null;
  const suppliedPv = info.pv.slice(0, Math.max(1, limit));
  if (suppliedPv.length === 0) return null;
  const frames = legalPv(info.fen, suppliedPv, limit);
  if (frames.length === 0) return null;
  return {
    ...info,
    pv: frames.map((frame) => frame.uci),
    pvComplete: frames.length === suppliedPv.length,
    rejectedPvTailLength: Math.max(0, suppliedPv.length - frames.length),
  };
}

export function verifiedMoveReview(move) {
  if (!move || typeof move !== "object") return null;
  const played = legalUciMove(move.fenBefore, move.playedUci);
  if (!played) return null;
  const suppliedPv = Array.isArray(move.bestPvUci) ? move.bestPvUci : [];
  const bestLine = suppliedPv[0] === move.bestUci
    ? suppliedPv
    : [move.bestUci].filter(Boolean);
  const bestFrames = legalPv(move.fenBefore, bestLine, 20);
  const best = bestFrames[0] || null;
  const suppliedContinuation = Array.isArray(move.playedContinuationUci)
    && move.playedContinuationUci[0] === played.uci
    ? move.playedContinuationUci
    : [played.uci];
  const continuationFrames = legalPv(move.fenBefore, suppliedContinuation, 20);
  const quality = move.quality === "best" && played.uci !== best?.uci
    ? "excellent"
    : move.quality;
  return {
    ...move,
    san: played.san,
    playedUci: played.uci,
    bestUci: best?.uci || "",
    bestSan: best?.san || "",
    bestPvUci: bestFrames.map((frame) => frame.uci),
    bestPvSan: bestFrames.map((frame) => frame.san),
    playedContinuationUci: continuationFrames.map((frame) => frame.uci),
    playedContinuationSan: continuationFrames.map((frame) => frame.san),
    ...(Object.hasOwn(move, "quality") ? { quality } : {}),
  };
}

function verifiedBestSan(move) {
  const verified = verifiedMoveReview(move);
  if (!verified || verified.bestUci === verified.playedUci) return "";
  return verified.bestSan;
}

export function scoreToWhiteCp(score) {
  if (Number.isFinite(score)) return clamp(Math.round(score), -MATE_CENTIPAWNS, MATE_CENTIPAWNS);
  if (!score || typeof score !== "object") return null;
  if (Number.isFinite(score.whiteCp)) {
    return clamp(Math.round(score.whiteCp), -MATE_CENTIPAWNS, MATE_CENTIPAWNS);
  }
  if (score.unit === "mate" && Number.isFinite(score.value)) {
    if (score.value === 0) return 0;
    return score.value > 0 ? MATE_CENTIPAWNS : -MATE_CENTIPAWNS;
  }
  if (Number.isFinite(score.pawns)) {
    return clamp(Math.round(score.pawns * 100), -MATE_CENTIPAWNS, MATE_CENTIPAWNS);
  }
  if (score.unit === "cp" && Number.isFinite(score.value)) {
    return clamp(Math.round(score.value), -MATE_CENTIPAWNS, MATE_CENTIPAWNS);
  }
  return null;
}

export function terminalWhiteCp(fen) {
  if (typeof fen !== "string") return null;
  const game = new Chess();
  try {
    game.load(fen);
  } catch {
    return null;
  }
  if (game.isCheckmate()) return game.turn() === "w" ? -MATE_CENTIPAWNS : MATE_CENTIPAWNS;
  if (game.isDraw()) return 0;
  return null;
}

export function winPercentFromCp(cp) {
  if (!Number.isFinite(cp)) return null;
  const bounded = clamp(cp, -MATE_CENTIPAWNS, MATE_CENTIPAWNS);
  return 50 + 50 * (2 / (1 + Math.exp(-0.00368208 * bounded)) - 1);
}

export function classifyCentipawnLoss(lossCp) {
  if (!Number.isFinite(lossCp) || lossCp < 0) return "good";
  if (lossCp <= 10) return "best";
  if (lossCp <= 30) return "excellent";
  if (lossCp <= 70) return "good";
  if (lossCp <= 140) return "inaccuracy";
  if (lossCp <= 280) return "mistake";
  return "blunder";
}

export function classifyAccuracy(accuracy) {
  if (!Number.isFinite(accuracy)) return "good";
  if (accuracy >= 97) return "best";
  if (accuracy >= 90) return "excellent";
  if (accuracy >= 80) return "good";
  if (accuracy >= 65) return "inaccuracy";
  if (accuracy >= 40) return "mistake";
  return "blunder";
}

export function calculateMoveAccuracy(beforeWhiteCp, afterWhiteCp, color) {
  if (!Number.isFinite(beforeWhiteCp) || !Number.isFinite(afterWhiteCp)) return null;
  const sign = color === "b" ? -1 : 1;
  const beforeMoverCp = clamp(beforeWhiteCp * sign, -MATE_CENTIPAWNS, MATE_CENTIPAWNS);
  const afterMoverCp = clamp(afterWhiteCp * sign, -MATE_CENTIPAWNS, MATE_CENTIPAWNS);
  const lossCp = Math.max(0, beforeMoverCp - afterMoverCp);
  const beforeWin = winPercentFromCp(beforeMoverCp);
  const afterWin = winPercentFromCp(afterMoverCp);
  const winPercentLoss = Math.max(0, beforeWin - afterWin);
  const accuracy = winPercentLoss === 0
    ? 100
    : clamp(
      103.1668100711649 * Math.exp(-0.04354415386753951 * winPercentLoss)
        - 3.166924740191411,
      0,
      100,
    );

  return {
    accuracy,
    lossCp,
    winPercentLoss,
    quality: classifyAccuracy(accuracy),
  };
}

export function explainMoveQuality(move) {
  if (!move || typeof move !== "object") return "Für diesen Zug liegt noch keine Bewertung vor.";
  const verified = verifiedMoveReview(move);
  const bestSan = verifiedBestSan(verified);
  const quality = move.quality === "best"
    ? verified?.quality === "best"
      ? "best"
      : "excellent"
    : move.quality;

  if (quality === "best") {
    return "Entspricht der ersten Stockfish-Wahl; laut Bewertung geht kein messbarer Vorteil verloren.";
  }
  if (quality === "excellent") {
    return bestSan
      ? `Weicht nur wenig von Stockfishs erster Wahl ${bestSan} ab.`
      : "Weicht laut Stockfish-Bewertung nur minimal von der besten Fortsetzung ab.";
  }
  if (quality === "good") {
    return bestSan
      ? `Bleibt nah an Stockfishs erster Wahl ${bestSan}; der Bewertungsverlust ist klein.`
      : "Der Stockfish-Bewertungsverlust bleibt klein.";
  }
  if (quality === "inaccuracy") {
    return bestSan
      ? `Gibt etwas Vorteil ab; genauer war ${bestSan}.`
      : "Gibt etwas Vorteil ab und erlaubt dem Gegner mehr Gegenspiel.";
  }
  if (quality === "mistake") {
    return bestSan
      ? `Verschlechtert die Stellung deutlich; ${bestSan} hielt besser dagegen.`
      : "Verschlechtert die Stellung deutlich und übersieht eine stärkere Fortsetzung.";
  }
  if (quality === "blunder") {
    return bestSan
      ? `Kippt die Stellung; ${bestSan} hätte den großen Verlust vermieden.`
      : "Kippt die Stockfish-Bewertung deutlich; eine Motiv-Erklärung benötigt die zugehörige Engine-Variante.";
  }
  return "Die Enginebewertung dieses Zuges ist noch nicht vollständig.";
}

export function describeMoveAssessment(move) {
  const verified = verifiedMoveReview(move);
  if (!verified) return null;
  const quality = Object.hasOwn(MOVE_QUALITY, verified.quality) ? verified.quality : "good";
  const bestSan = verifiedBestSan(verified);
  const descriptions = {
    best: {
      lead: "Das war der beste Zug.",
      reason: "Du hast damit keinen messbaren Vorteil abgegeben.",
    },
    excellent: {
      lead: "Das war sehr gut.",
      reason: "Deine Stellung bleibt nahezu so stark wie mit der besten Möglichkeit.",
    },
    good: {
      lead: "Das war gut.",
      reason: "Deine Stellung bleibt stabil und der kleine Nachteil ist gut verkraftbar.",
    },
    inaccuracy: {
      lead: "Das war etwas ungenau.",
      reason: "Du gibst einen Teil deiner guten Stellung ab und erlaubst mehr Gegenspiel.",
    },
    mistake: {
      lead: "Das war ein Fehler.",
      reason: "Deine Stellung wird dadurch deutlich schwieriger.",
    },
    blunder: {
      lead: "Das war ein großer Fehler.",
      reason: "Die Stellung kippt dadurch deutlich zu deinen Ungunsten.",
    },
  };
  return {
    tone: MOVE_QUALITY[quality].tone,
    label: MOVE_QUALITY[quality].label,
    lead: descriptions[quality].lead,
    reason: descriptions[quality].reason,
    alternative: bestSan
      ? `Statt ${verified.san} war ${bestSan} in der Stellung davor besser.`
      : "",
  };
}

export function groundedSuggestionReason({ rank = 1, san = "", uci = "" } = {}) {
  const notation = typeof san === "string" ? san.trim() : "";
  const move = typeof uci === "string" ? uci.toLowerCase() : "";
  let idea = "";
  if (/^O-O(?:-O)?[+#]?$/.test(notation)) {
    idea = "Der Zug bringt den König in Sicherheit und aktiviert einen Turm.";
  } else if (/[+#]$/.test(notation)) {
    idea = "Der Zug greift den König direkt an und zwingt zu einer Antwort.";
  } else if (notation.includes("x")) {
    idea = "Der Zug nutzt einen möglichen Abtausch und verändert dadurch die Stellung konkret.";
  } else if (/^[a-h][1-8][a-h][1-8][qrbn]$/.test(move)) {
    idea = "Der Zug wandelt einen Bauern um und schafft dadurch unmittelbar neues Material.";
  } else if (["d4", "e4", "d5", "e5"].includes(move.slice(2, 4))) {
    idea = "Der Zug erhöht den Einfluss im Zentrum.";
  }
  const comparison = rank === 1
    ? "Achte besonders darauf, wie die gezeigte Antwortfolge diese Idee unterstützt."
    : "Die Idee bleibt spielbar; die erste Zugidee löst die Aufgaben der Stellung etwas direkter.";
  return [idea, comparison].filter(Boolean).join(" ");
}

export function analysisEntryFromInfo(info) {
  if (!info || typeof info !== "object") return null;
  const score = info.whiteScore || info.score;
  const whiteCp = scoreToWhiteCp(score);
  if (!Number.isFinite(whiteCp)) return null;
  const suppliedPv = Array.isArray(info.pv) ? info.pv.slice(0, 20) : [];
  const frames = buildPvFrames(info.fen, suppliedPv, 20);
  if (frames.length === 0 || frames.length !== suppliedPv.length) return null;
  return {
    whiteCp,
    evaluation: score?.unit && Number.isFinite(score?.value)
      ? {
        unit: score.unit,
        value: Math.round(score.value),
        perspective: "white",
      }
      : {
        unit: "cp",
        value: whiteCp,
        perspective: "white",
      },
    depth: Number.isFinite(info.depth) ? info.depth : null,
    pv: frames.map((frame) => frame.uci),
    complete: true,
  };
}

export function uciToSan(fen, uci) {
  if (typeof fen !== "string" || typeof uci !== "string") return "";
  const game = new Chess();
  try {
    game.load(fen);
    const move = game.move({
      from: uci.slice(0, 2),
      to: uci.slice(2, 4),
      promotion: uci.length > 4 ? uci.slice(4, 5).toLowerCase() : undefined,
    });
    return move?.san || "";
  } catch {
    return "";
  }
}

function mean(values) {
  if (!values.length) return null;
  return values.reduce((total, value) => total + value, 0) / values.length;
}

function rounded(value, digits = 1) {
  if (!Number.isFinite(value)) return null;
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

export function selectCriticalMoments(moves, { playerColor = null, limit = 3 } = {}) {
  const normalizedLimit = Number.isInteger(limit) && limit > 0 ? limit : 3;
  const perspective = playerColor === "w" || playerColor === "b" ? playerColor : null;
  return (Array.isArray(moves) ? moves : [])
    .filter((move) => (
      move
      && ["inaccuracy", "mistake", "blunder"].includes(move.quality)
      && Number.isFinite(move.winPercentLoss)
      && (!perspective || move.color === perspective)
    ))
    .sort((left, right) => (
      right.winPercentLoss - left.winPercentLoss
      || left.ply - right.ply
    ))
    .slice(0, normalizedLimit)
    .map((move, index) => ({ ...move, decisivenessRank: index + 1 }));
}

export function summarizeGameReview(
  path,
  evaluations,
  { depth = null, final = true, playerColor = null } = {},
) {
  const nodes = Array.isArray(path) ? path : [];
  const entries = Array.isArray(evaluations) ? evaluations : [];
  const moves = [];

  for (let index = 1; index < nodes.length; index += 1) {
    const node = nodes[index];
    const before = entries[index - 1];
    const after = entries[index];
    const beforeCp = scoreToWhiteCp(before);
    const afterCp = scoreToWhiteCp(after);
    const color = node?.move?.color;
    const metrics = calculateMoveAccuracy(beforeCp, afterCp, color);
    if (!metrics) continue;
    const fenBefore = nodes[index - 1]?.fen || "";
    const bestFrames = buildPvFrames(
      fenBefore,
      Array.isArray(before?.pv) ? before.pv : [],
      20,
    );
    const bestUci = bestFrames[0]?.uci || "";
    const playedUci = node?.move
      ? `${node.move.from || ""}${node.move.to || ""}${node.move.promotion || ""}`
      : "";
    const playedContinuationFrames = buildPvFrames(
      fenBefore,
      [
        playedUci,
        ...(Array.isArray(after?.pv) ? after.pv : []),
      ].filter(Boolean),
      20,
    );

    const reportMove = {
      ply: index,
      moveNumber: Math.ceil(index / 2),
      color,
      san: node?.move?.san || "?",
      playedUci,
      fenBefore,
      fenAfter: node?.fen || "",
      beforeCp,
      afterCp,
      evaluationBefore: before?.evaluation || {
        unit: "cp",
        value: Math.round(beforeCp),
        perspective: "white",
      },
      evaluationAfter: after?.evaluation || {
        unit: "cp",
        value: Math.round(afterCp),
        perspective: "white",
      },
      evaluationDeltaCp: Math.round(afterCp - beforeCp),
      bestUci,
      bestSan: bestFrames[0]?.san || "",
      bestPvUci: bestFrames.map((frame) => frame.uci),
      bestPvSan: bestFrames.map((frame) => frame.san),
      playedContinuationUci: playedContinuationFrames.map((frame) => frame.uci),
      playedContinuationSan: playedContinuationFrames.map((frame) => frame.san),
      engineDepth: Number.isFinite(before?.depth) ? before.depth : null,
      accuracy: rounded(metrics.accuracy),
      lossCp: Math.round(metrics.lossCp),
      winPercentLoss: rounded(metrics.winPercentLoss, 2),
      quality: metrics.quality === "best" && playedUci !== bestUci
        ? "excellent"
        : metrics.quality,
    };
    reportMove.explanation = explainMoveQuality(reportMove);
    moves.push(reportMove);
  }

  const forColor = (color) => moves.filter((move) => move.color === color);
  const whiteMoves = forColor("w");
  const blackMoves = forColor("b");
  const counts = Object.keys(MOVE_QUALITY).reduce((result, key) => {
    result[key] = moves.filter((move) => move.quality === key).length;
    return result;
  }, {});
  const accuracyValues = moves.map((move) => move.accuracy);
  const lossValues = moves.map((move) => move.lossCp);

  return {
    version: 1,
    generatedAt: new Date().toISOString(),
    final: Boolean(final),
    depth: Number.isFinite(depth) ? depth : null,
    totalMoves: Math.max(0, nodes.length - 1),
    analyzedMoves: moves.length,
    coverage: nodes.length > 1 ? rounded((moves.length / (nodes.length - 1)) * 100) : 0,
    overallAccuracy: rounded(mean(accuracyValues)),
    whiteAccuracy: rounded(mean(whiteMoves.map((move) => move.accuracy))),
    blackAccuracy: rounded(mean(blackMoves.map((move) => move.accuracy))),
    averageCentipawnLoss: rounded(mean(lossValues)),
    whiteAverageCentipawnLoss: rounded(mean(whiteMoves.map((move) => move.lossCp))),
    blackAverageCentipawnLoss: rounded(mean(blackMoves.map((move) => move.lossCp))),
    counts,
    moves,
    playerColor: playerColor === "w" || playerColor === "b" ? playerColor : null,
    criticalMoments: selectCriticalMoments(moves, { playerColor, limit: 3 }),
  };
}

export function reviewDepthForPlies(plies, preferredDepth = 15) {
  const adaptive = plies <= 40 ? 14 : plies <= 100 ? 12 : 10;
  const preferred = Number.isFinite(preferredDepth) ? preferredDepth : adaptive;
  return Math.max(8, Math.min(18, adaptive, preferred));
}

export function buildLearningSummary(report) {
  const allMoves = Array.isArray(report?.moves) ? report.moves.filter(Boolean) : [];
  const perspective = report?.playerColor === "w" || report?.playerColor === "b"
    ? report.playerColor
    : null;
  const moves = perspective
    ? allMoves.filter((move) => move.color === perspective)
    : allMoves;
  if (moves.length === 0) {
    return {
      strongestPhase: "Noch nicht zuverlässig erkennbar",
      strongestPhaseDetail: "Dafür müssen zuerst mehrere Züge vollständig analysiert werden.",
      biggestLesson: "Es liegt noch kein belastbarer Schlüsselmoment vor.",
      recurringPattern: "Mit weiteren analysierten Zügen kann der Coach wiederkehrende Muster erkennen.",
      learningGoal: "Analysiere zunächst eine vollständige Partie.",
      exercise: "Spiele oder importiere eine Partie und starte danach die vollständige Analyse.",
      confidence: "low",
    };
  }

  const phaseNames = ["Eröffnung", "Mittelspiel", "Endphase"];
  const phaseSize = Math.max(1, Math.ceil(moves.length / 3));
  const phases = phaseNames
    .map((name, index) => {
      const values = moves
        .slice(index * phaseSize, index === 2 ? moves.length : (index + 1) * phaseSize)
        .map((move) => move.accuracy)
        .filter(Number.isFinite);
      return { name, values, average: mean(values) };
    })
    .filter((phase) => phase.values.length > 0);
  const strongest = [...phases].sort((left, right) => right.average - left.average)[0];

  const biggest = [...moves]
    .filter((move) => Number.isFinite(move.winPercentLoss))
    .sort((left, right) => right.winPercentLoss - left.winPercentLoss)[0];
  const serious = moves.filter((move) => move.quality === "mistake" || move.quality === "blunder");
  const inaccuracies = moves.filter((move) => move.quality === "inaccuracy");
  const strong = moves.filter((move) => move.quality === "best" || move.quality === "excellent");
  const focusedMoment = (Array.isArray(report?.criticalMoments)
    ? report.criticalMoments.find((move) => !perspective || move?.color === perspective)
    : null) || biggest || moves[0];
  const focusedLabel = `${focusedMoment.moveNumber}${focusedMoment.color === "b" ? "…" : "."} ${focusedMoment.san}`;
  const focusedComparison = focusedMoment.bestSan
    ? `vergleiche danach mit Stockfishs ${focusedMoment.bestSan} und spiele die gespeicherte Hauptvariante nach`
    : Array.isArray(focusedMoment.bestPvSan) && focusedMoment.bestPvSan.length > 0
      ? "vergleiche danach mit der gespeicherten Stockfish-Hauptvariante"
      : "notiere deine Kandidatenzüge und prüfe danach mögliche Drohungen sowie ungedeckte Figuren";

  let recurringPattern;
  let learningGoal;
  let exercise;
  if (serious.length >= 2) {
    recurringPattern = `${serious.length} deutliche Stockfish-Bewertungseinbrüche zeigen wiederholt kritische Entscheidungen; ein gemeinsames Schachmotiv lässt sich daraus allein noch nicht sicher ableiten.`;
    learningGoal = "Vergleiche bei kritischen Entscheidungen deinen Zug mit Stockfishs erster Wahl und der zugehörigen Hauptvariante.";
    exercise = `Stelle die Position vor ${focusedLabel} erneut auf. Finde zuerst selbst den stärksten Zug, ${focusedComparison}.`;
  } else if (inaccuracies.length >= 2) {
    recurringPattern = `${inaccuracies.length} Ungenauigkeiten zeigen eher mehrere kleine Planungsverluste als einen einzelnen großen Einbruch.`;
    learningGoal = "Vergleiche die kleinen Abweichungen gezielt mit Stockfishs erster Wahl.";
    exercise = `Stelle die Position vor ${focusedLabel} erneut auf. Finde zuerst selbst den stärksten Zug, ${focusedComparison}.`;
  } else if (strong.length >= Math.max(2, Math.ceil(moves.length * 0.6))) {
    recurringPattern = "Die vorhandenen Bewertungen zeigen überwiegend stabile Entscheidungen ohne häufige klare Einbrüche.";
    learningGoal = "Untersuche, bei welchen Entscheidungen dein Zug mit Stockfishs erster Wahl übereinstimmte.";
    exercise = `Stelle die Position vor ${focusedLabel} erneut auf und erkläre, warum dein Zug die Stockfish-Bewertung stabil hielt.`;
  } else {
    recurringPattern = "Die vorhandenen Daten zeigen noch kein eindeutiges wiederkehrendes Fehlermuster.";
    learningGoal = "Arbeite zunächst mit den konkret gespeicherten Stockfish-Schlüsselmomenten.";
    exercise = `Stelle die Position vor ${focusedLabel} erneut auf. Finde zuerst selbst den stärksten Zug, ${focusedComparison}.`;
  }

  const biggestLesson = biggest
    ? `${biggest.moveNumber}${biggest.color === "b" ? "…" : "."} ${biggest.san}: ${biggest.explanation || explainMoveQuality(biggest)}`
    : "Kein einzelner Zug hebt sich zuverlässig als größter Fehler ab.";

  return {
    strongestPhase: strongest?.name || "Stabilste Phase",
    strongestPhaseDetail: strongest
      ? `Dort lag deine geschätzte Genauigkeit bei rund ${strongest.average.toFixed(0)} %.`
      : "Noch nicht zuverlässig erkennbar.",
    biggestLesson,
    recurringPattern,
    learningGoal,
    exercise,
    confidence: moves.length >= 8 ? "medium" : "low",
  };
}

export function buildFallbackFeedback(report) {
  if (!report || report.analyzedMoves === 0) {
    return "**Noch keine vollständige Bewertung:** Für ein aussagekräftiges Feedback braucht die Partie mindestens einen analysierten Zug.";
  }
  const perspective = report.playerColor === "w" || report.playerColor === "b"
    ? report.playerColor
    : null;
  const reportMoves = Array.isArray(report.moves) ? report.moves : [];
  const perspectiveMoves = reportMoves
    .filter((move) => move && typeof move === "object")
    .filter((move) => !perspective || move.color === perspective);
  const perspectiveAccuracy = perspective === "w"
    ? report.whiteAccuracy
    : perspective === "b"
      ? report.blackAccuracy
      : report.overallAccuracy;
  const accuracy = Number.isFinite(perspectiveAccuracy)
    ? `${perspectiveAccuracy.toFixed(1)} %`
    : "noch offen";
  const serious = perspectiveMoves
    .filter((move) => move.quality === "mistake" || move.quality === "blunder")
    .length;
  const criticalMoments = Array.isArray(report.criticalMoments) ? report.criticalMoments : [];
  const biggest = criticalMoments
    .find((move) => move && typeof move === "object" && (!perspective || move.color === perspective));
  const focus = biggest
    ? `Prüfe besonders **${biggest.moveNumber}${biggest.color === "b" ? "…" : "."} ${biggest.san}**. Dort veränderte sich die Stellung deutlich${biggest.bestSan ? `; stärker war **${biggest.bestSan}**` : ""}.`
    : "Die Partie enthält keinen klaren kritischen Einbruch.";
  const verdict = perspectiveAccuracy >= 90
    ? "Du hast sehr konstant gespielt."
    : perspectiveAccuracy >= 75
      ? "Die Partie war insgesamt solide, mit einigen konkreten Verbesserungsmöglichkeiten."
      : "Die größten Fortschritte liegen laut Auswertung in den Stellungen mit den stärksten Bewertungsabfällen.";
  const strongest = [...perspectiveMoves]
    .filter((move) => move.quality === "best" || move.quality === "excellent")
    .sort((left, right) => (right.accuracy || 0) - (left.accuracy || 0))[0];
  const strength = strongest
    ? `Besonders gelungen war **${strongest.moveNumber}${strongest.color === "b" ? "…" : "."} ${strongest.san}**: ${strongest.explanation || "Der Zug hielt die Stellung präzise zusammen."}`
    : "Die Partie hatte solide Phasen, auch wenn noch kein einzelner Zug deutlich herausragte.";

  return [
    `**Spielverlauf:** ${accuracy} geschätzte Engine-Genauigkeit. ${verdict}`,
    `**Engine-Muster:** ${serious} Fehler oder Patzer bei ${perspectiveMoves.length} eigenen analysierten Zügen. Ein gemeinsames taktisches Motiv wird ohne passende Stockfish-PV bewusst nicht behauptet.`,
    `**Das war stark:** ${strength}`,
    `**Das kannst du verbessern:** ${focus}`,
    "**Trainingsfokus:** Spiele die gespeicherten Stockfish-Hauptvarianten der größten Bewertungseinbrüche nach und vergleiche sie mit deinen Partiezügen.",
  ].join("\n\n");
}
