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
  const san = typeof move.san === "string" ? move.san : "";
  const bestSan = typeof move.bestSan === "string" && move.bestSan !== san
    ? move.bestSan
    : "";
  const motif = /^O-O/.test(san)
    ? "Bringt den König in Sicherheit"
    : /[+#]$/.test(san)
      ? "Erzeugt eine direkte Schachdrohung"
      : san.includes("x")
        ? "Klärt eine konkrete Materialfrage"
        : "";

  if (move.quality === "best") {
    return `${motif || "Hält die Stellung optimal"}; kein messbarer Vorteil geht verloren.`;
  }
  if (move.quality === "excellent") {
    return `${motif || "Setzt den richtigen Plan fort"}; die Abweichung zum besten Zug ist minimal.`;
  }
  if (move.quality === "good") {
    return `${motif || "Bleibt solide"}; nur ein kleiner Teil des Vorteils geht verloren.`;
  }
  if (move.quality === "inaccuracy") {
    return bestSan
      ? `Gibt etwas Vorteil ab; genauer war ${bestSan}.`
      : "Gibt etwas Vorteil ab und erlaubt dem Gegner mehr Gegenspiel.";
  }
  if (move.quality === "mistake") {
    return bestSan
      ? `Verschlechtert die Stellung deutlich; ${bestSan} hielt besser dagegen.`
      : "Verschlechtert die Stellung deutlich und übersieht eine stärkere Fortsetzung.";
  }
  if (move.quality === "blunder") {
    return bestSan
      ? `Kippt die Stellung; ${bestSan} hätte den großen Verlust vermieden.`
      : "Kippt die Stellung durch eine unmittelbare taktische oder positionelle Folge.";
  }
  return "Die Enginebewertung dieses Zuges ist noch nicht vollständig.";
}

export function analysisEntryFromInfo(info) {
  if (!info || typeof info !== "object") return null;
  const score = info.whiteScore || info.score;
  const whiteCp = scoreToWhiteCp(score);
  if (!Number.isFinite(whiteCp)) return null;
  return {
    whiteCp,
    depth: Number.isFinite(info.depth) ? info.depth : null,
    pv: Array.isArray(info.pv) ? info.pv.slice(0, 12) : [],
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

export function summarizeGameReview(path, evaluations, { depth = null, final = true } = {}) {
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
    const bestUci = Array.isArray(before?.pv) ? before.pv[0] || "" : "";

    const reportMove = {
      ply: index,
      moveNumber: Math.ceil(index / 2),
      color,
      san: node?.move?.san || "?",
      playedUci: node?.move
        ? `${node.move.from || ""}${node.move.to || ""}${node.move.promotion || ""}`
        : "",
      fenBefore: nodes[index - 1]?.fen || "",
      fenAfter: node?.fen || "",
      beforeCp,
      afterCp,
      bestUci,
      bestSan: uciToSan(nodes[index - 1]?.fen, bestUci),
      accuracy: rounded(metrics.accuracy),
      lossCp: Math.round(metrics.lossCp),
      winPercentLoss: rounded(metrics.winPercentLoss, 2),
      quality: metrics.quality,
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
    criticalMoments: [...moves]
      .filter((move) => move.accuracy < 97)
      .sort((left, right) => right.winPercentLoss - left.winPercentLoss)
      .slice(0, 6),
  };
}

export function reviewDepthForPlies(plies, preferredDepth = 15) {
  const adaptive = plies <= 40 ? 14 : plies <= 100 ? 12 : 10;
  const preferred = Number.isFinite(preferredDepth) ? preferredDepth : adaptive;
  return Math.max(8, Math.min(18, adaptive, preferred));
}

export function buildFallbackFeedback(report) {
  if (!report || report.analyzedMoves === 0) {
    return "**Noch keine vollständige Bewertung:** Für ein aussagekräftiges Feedback braucht die Partie mindestens einen analysierten Zug.";
  }
  const accuracy = Number.isFinite(report.overallAccuracy)
    ? `${report.overallAccuracy.toFixed(1)} %`
    : "noch offen";
  const serious = (report.counts?.mistake || 0) + (report.counts?.blunder || 0);
  const biggest = report.criticalMoments?.[0];
  const focus = biggest
    ? `Prüfe besonders **${biggest.moveNumber}${biggest.color === "b" ? "…" : "."} ${biggest.san}**. Dort gingen ungefähr ${(biggest.lossCp / 100).toFixed(2)} Bauerneinheiten verloren${biggest.bestSan ? `; stärker war **${biggest.bestSan}**` : ""}.`
    : "Die Partie enthält keinen klaren kritischen Einbruch.";
  const verdict = report.overallAccuracy >= 90
    ? "Du hast sehr konstant gespielt."
    : report.overallAccuracy >= 75
      ? "Die Partie war insgesamt solide, mit einigen konkreten Verbesserungsmöglichkeiten."
      : "Die größten Fortschritte liegen darin, vor jedem Zug gegnerische Drohungen und forcing moves zu prüfen.";
  const strongest = [...(report.moves || [])]
    .filter((move) => move.quality === "best" || move.quality === "excellent")
    .sort((left, right) => (right.accuracy || 0) - (left.accuracy || 0))[0];
  const strength = strongest
    ? `Besonders gelungen war **${strongest.moveNumber}${strongest.color === "b" ? "…" : "."} ${strongest.san}**: ${strongest.explanation || "Der Zug hielt die Stellung präzise zusammen."}`
    : "Die Partie hatte solide Phasen, auch wenn noch kein einzelner Zug deutlich herausragte.";

  return [
    `**Spielverlauf:** ${accuracy} geschätzte Engine-Genauigkeit. ${verdict}`,
    `**Hauptmotive:** ${serious} Fehler oder Patzer bei ${report.analyzedMoves} analysierten Zügen; entscheidend waren konkrete Drohungen und die Präzision an den kritischen Stellen.`,
    `**Das war stark:** ${strength}`,
    `**Das kannst du verbessern:** ${focus}`,
    "**Trainingsfokus:** Prüfe vor der Zugentscheidung immer Schachs, Schlagzüge und direkte Drohungen – zuerst für den Gegner, dann für dich.",
  ].join("\n\n");
}
