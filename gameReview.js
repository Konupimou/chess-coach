import { Chess } from "chess.js";
import { classifyMoveNecessity } from "./moveNecessity.js";
import { PRACTICALLY_EQUIVALENT_LOSS_CP } from "./coachThresholds.js";

export const MATE_CENTIPAWNS = 10_000;

export const MOVE_QUALITY = Object.freeze({
  brilliant: { label: "Brillant", shortLabel: "Brillant", symbol: "!!", tone: "brilliant" },
  book: { label: "Buchzug", shortLabel: "Buch", symbol: "📖", tone: "book" },
  best: { label: "Bester Zug", shortLabel: "Best", symbol: "★", tone: "best" },
  excellent: { label: "Sehr gut", shortLabel: "Sehr gut", symbol: "✓", tone: "excellent" },
  good: { label: "Gut", shortLabel: "Gut", symbol: "✓", tone: "good" },
  inaccuracy: { label: "Ungenauigkeit", shortLabel: "Ungenau", symbol: "?!", tone: "inaccuracy" },
  mistake: { label: "Fehler", shortLabel: "Fehler", symbol: "?", tone: "mistake" },
  blunder: { label: "Grober Fehler", shortLabel: "Grober Fehler", symbol: "??", tone: "blunder" },
});

const LEGACY_MOVE_QUALITY_ALIASES = Object.freeze({
  great: "excellent",
  miss: "mistake",
});

export function normalizeMoveQuality(quality, fallback = "good") {
  const normalized = LEGACY_MOVE_QUALITY_ALIASES[quality] || quality;
  return Object.hasOwn(MOVE_QUALITY, normalized) ? normalized : fallback;
}

// Alle fachlichen Schwellen stehen an einer Stelle. Das System ist bewusst
// nachvollziehbar und ahmt keine proprietäre Klassifizierung exakt nach.
export const MOVE_CLASSIFICATION_CONFIG = Object.freeze({
  excellentMaxLoss: 2,
  goodMaxLoss: 5,
  inaccuracyMaxLoss: 10,
  mistakeMaxLoss: 20,
  brilliantMaxLoss: 1,
  brilliantMinimumSacrifice: 1.5,
});

export const POSITIVE_MOVE_QUALITIES = Object.freeze([
  "brilliant", "book", "best", "excellent", "good",
]);
export const CRITICAL_MOVE_QUALITIES = Object.freeze([
  "inaccuracy", "mistake", "blunder",
]);

/**
 * @typedef {"brilliant"|"book"|"best"|"excellent"|"good"|"inaccuracy"|"mistake"|"blunder"} MoveClassification
 *
 * MoveReview enthält zusätzlich ältere Aliasfelder (`playedUci`, `bestUci`,
 * `quality`, `winPercentLoss`), damit gespeicherte Analysen und der Coach
 * abwärtskompatibel bleiben. `evaluationBeforeCp` und `evaluationAfterCp`
 * sind immer aus Sicht des Spielers; Matt bleibt ausschließlich in
 * `mateBefore` und `mateAfter`.
 *
 * @typedef {Object} MoveReview
 * @property {number} ply
 * @property {number} moveNumber
 * @property {"w"|"b"} color
 * @property {string} san
 * @property {string} uci
 * @property {string} fenBefore
 * @property {string} fenAfter
 * @property {number|null} evaluationBeforeCp
 * @property {number|null} evaluationAfterCp
 * @property {number|null} mateBefore
 * @property {number|null} mateAfter
 * @property {string|null} bestMoveUci
 * @property {string|null} bestMoveSan
 * @property {string[]} principalVariation
 * @property {number} winChanceBefore
 * @property {number} winChanceAfter
 * @property {number} winChanceLoss
 * @property {MoveClassification} classification
 * @property {string} symbol
 * @property {number} accuracy
 *
 * @typedef {Object} GameReview
 * @property {number|null} whiteAccuracy
 * @property {number|null} blackAccuracy
 * @property {Record<MoveClassification, number>} whiteCounts
 * @property {Record<MoveClassification, number>} blackCounts
 * @property {MoveReview[]} moves
 */

const clamp = (value, minimum, maximum) => Math.max(minimum, Math.min(maximum, value));

const REVIEW_COACH_RATINGS = [800, 1000, 1400, 1800];

function normalizeReviewCoachRating(value, fallback = 800) {
  const raw = typeof value === "object" && value !== null
    ? value.coachRating ?? value.learnerProfile?.rating ?? value.rating
    : value;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return REVIEW_COACH_RATINGS.reduce((closest, candidate) => (
    Math.abs(candidate - parsed) < Math.abs(closest - parsed) ? candidate : closest
  ), REVIEW_COACH_RATINGS[0]);
}

function simpleReviewLanguage(value) {
  return normalizeReviewCoachRating(value) <= 1000;
}

function reviewPieceName(type) {
  return {
    p: "Bauer",
    n: "Springer",
    b: "Läufer",
    r: "Turm",
    q: "Dame",
  }[type] || "Figur";
}

function immediateReplyConsequence(move) {
  const verified = verifiedMoveReview(move);
  if (!verified || !Number.isFinite(verified.lossCp) || verified.lossCp < 120) return "";
  const replyUci = verified.playedContinuationUci?.[1];
  if (!replyUci) return "";

  const game = new Chess();
  try {
    game.load(verified.fenBefore);
    game.move({
      from: verified.playedUci.slice(0, 2),
      to: verified.playedUci.slice(2, 4),
      promotion: verified.playedUci.slice(4, 5) || undefined,
    });
    const reply = game.move({
      from: replyUci.slice(0, 2),
      to: replyUci.slice(2, 4),
      promotion: replyUci.slice(4, 5) || undefined,
    });
    if (!reply?.captured) return "";
    const pieceValues = { p: 1, n: 3, b: 3, r: 5, q: 9 };
    const canRecapture = game.moves({ verbose: true }).some((candidate) => (
      candidate.to === reply.to && Boolean(candidate.captured)
    ));
    const materialLossEvenAfterRecapture = (
      (pieceValues[reply.captured] || 0) > (pieceValues[reply.piece] || 0)
    );
    if (canRecapture && !materialLossEvenAfterRecapture) return "";
    const capturedSquare = reply.flags?.includes("e")
      ? `${reply.to[0]}${reply.from[1]}`
      : reply.to;
    const piece = reviewPieceName(reply.captured);
    const nominativeArticle = piece === "Dame" ? "deine" : "dein";
    const accusativeArticle = piece === "Dame" ? "deine" : "deinen";
    if (reply.captured === "p") {
      return `Nach ${reply.san} geht dein Bauer auf ${capturedSquare} verloren.`;
    }
    if (verified.lossCp >= 250) {
      return `Nach ${reply.san} geht ${nominativeArticle} ${piece} verloren.`;
    }
    return `Nach ${reply.san} kann dein Gegner ${accusativeArticle} ${piece} gewinnen.`;
  } catch {
    return "";
  }
}

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
  const candidateLines = (Array.isArray(move.candidateLines) ? move.candidateLines : [])
    .slice(0, 5)
    .flatMap((line, index) => {
      const frames = legalPv(move.fenBefore, line?.pvUci || [], 20);
      if (frames.length === 0 || frames.length !== (line?.pvUci || []).length) return [];
      return [{
        rank: Math.max(1, Number.parseInt(line.rank, 10) || index + 1),
        evaluation: line.evaluation || null,
        pvUci: frames.map((frame) => frame.uci),
        pvSan: frames.map((frame) => frame.san),
      }];
    })
    .sort((left, right) => left.rank - right.rank);
  const suppliedPlayedLine = move.playedLine;
  const playedLineFrames = legalPv(
    move.fenBefore,
    Array.isArray(suppliedPlayedLine?.pvUci)
      ? suppliedPlayedLine.pvUci
      : suppliedContinuation,
    20,
  );
  const playedLine = (
    playedLineFrames[0]?.uci === played.uci
    && playedLineFrames.length === (
      Array.isArray(suppliedPlayedLine?.pvUci)
        ? suppliedPlayedLine.pvUci.length
        : suppliedContinuation.length
    )
  )
    ? {
      evaluation: suppliedPlayedLine?.evaluation || null,
      pvUci: playedLineFrames.map((frame) => frame.uci),
      pvSan: playedLineFrames.map((frame) => frame.san),
    }
    : {
      evaluation: null,
      pvUci: continuationFrames.map((frame) => frame.uci),
      pvSan: continuationFrames.map((frame) => frame.san),
    };
  const quality = normalizeMoveQuality(move.quality) === "best" && played.uci !== best?.uci
    ? "excellent"
    : normalizeMoveQuality(move.quality);
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
    ...(Array.isArray(move.candidateLines) ? { candidateLines } : {}),
    ...(move.playedLine && typeof move.playedLine === "object" ? { playedLine } : {}),
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
  const terminal = terminalPositionState(fen);
  if (terminal.status === "checkmate") return terminal.whiteCp;
  if (terminal.status === "draw" || terminal.status === "stalemate") return 0;
  return null;
}

export function terminalPositionState(fen) {
  if (typeof fen !== "string") return { status: "invalid", fen: "", whiteCp: null };
  const game = new Chess();
  try {
    game.load(fen);
  } catch {
    return { status: "invalid", fen, whiteCp: null };
  }
  const sideToMove = game.turn();
  const sideName = sideToMove === "w" ? "Weiß" : "Schwarz";
  if (game.isCheckmate()) {
    const winner = sideToMove === "w" ? "Schwarz" : "Weiß";
    return {
      status: "checkmate",
      fen,
      result: sideToMove === "w" ? "0-1" : "1-0",
      whiteCp: sideToMove === "w" ? -MATE_CENTIPAWNS : MATE_CENTIPAWNS,
      sideToMove,
      sideName,
      winner,
      loser: sideName,
      inCheck: true,
      reason: `${sideName} steht matt. ${winner} gewinnt.`,
    };
  }
  if (game.isStalemate()) {
    return {
      status: "stalemate",
      fen,
      result: "1/2-1/2",
      whiteCp: 0,
      sideToMove,
      sideName,
      inCheck: false,
      reason: `${sideName} ist patt: kein legaler Zug, aber kein Schach.`,
    };
  }
  if (game.isDraw()) {
    let reason = "Remis nach den Schachregeln.";
    if (game.isThreefoldRepetition()) reason = "Remis durch dreifache Stellungswiederholung.";
    else if (game.isInsufficientMaterial()) reason = "Remis wegen unzureichenden Materials.";
    else if (game.isDrawByFiftyMoves?.()) reason = "Remis nach der 50-Züge-Regel.";
    return {
      status: "draw",
      fen,
      result: "1/2-1/2",
      whiteCp: 0,
      sideToMove,
      sideName,
      inCheck: game.isCheck(),
      reason,
    };
  }
  return {
    status: "ongoing",
    fen,
    result: "*",
    whiteCp: null,
    sideToMove,
    sideName,
    inCheck: game.isCheck(),
  };
}

export function formatPvWithMoveNumbers(fen, pv, limit = 20) {
  if (typeof fen !== "string" || !Array.isArray(pv) || pv.length === 0) return "";
  const game = new Chess();
  try {
    game.load(fen);
  } catch {
    return "";
  }
  const tokens = [];
  for (const raw of pv.slice(0, Math.max(1, limit))) {
    if (typeof raw !== "string" || !/^[a-h][1-8][a-h][1-8][qrbn]?$/i.test(raw)) break;
    const moveNumber = game.moveNumber();
    const color = game.turn();
    let move;
    try {
      move = game.move({
        from: raw.slice(0, 2),
        to: raw.slice(2, 4),
        promotion: raw.length > 4 ? raw.slice(4).toLowerCase() : undefined,
      });
    } catch {
      break;
    }
    if (!move) break;
    tokens.push(`${moveNumber}${color === "w" ? "." : "..."} ${move.san}`);
  }
  return tokens.join(" ");
}

export function winChance(cp) {
  if (!Number.isFinite(cp)) return null;
  const bounded = clamp(cp, -MATE_CENTIPAWNS, MATE_CENTIPAWNS);
  return 100 / (1 + Math.exp(-0.00368208 * bounded));
}

export const winPercentFromCp = winChance;

export function moveAccuracy(winChanceLoss) {
  if (!Number.isFinite(winChanceLoss)) return null;
  const boundedLoss = Math.max(0, winChanceLoss);
  if (boundedLoss === 0) return 100;
  const value = 103.1668 * Math.exp(-0.04354 * boundedLoss) - 3.1669;
  return clamp(value, 0, 100);
}

export function classifyWinChanceLoss(loss) {
  if (!Number.isFinite(loss) || loss < 0) return "good";
  if (loss <= MOVE_CLASSIFICATION_CONFIG.excellentMaxLoss) return "excellent";
  if (loss <= MOVE_CLASSIFICATION_CONFIG.goodMaxLoss) return "good";
  if (loss <= MOVE_CLASSIFICATION_CONFIG.inaccuracyMaxLoss) return "inaccuracy";
  if (loss <= MOVE_CLASSIFICATION_CONFIG.mistakeMaxLoss) return "mistake";
  return "blunder";
}

export function classifyCentipawnLoss(lossCp) {
  if (!Number.isFinite(lossCp) || lossCp < 0) return "good";
  if (lossCp <= 10) return "best";
  if (lossCp <= PRACTICALLY_EQUIVALENT_LOSS_CP) return "excellent";
  if (lossCp <= 70) return "good";
  if (lossCp < 140) return "inaccuracy";
  if (lossCp < 300) return "mistake";
  return "blunder";
}

function reviewQualityForDisplay(move) {
  const supplied = normalizeMoveQuality(move?.quality);
  const isStructuredClassification = move?.classification === supplied
    && Number.isFinite(move?.winChanceLoss);
  if (!isStructuredClassification && Number.isFinite(move?.lossCp)) {
    const measured = classifyCentipawnLoss(move.lossCp);
    if (measured !== "best") return measured;
  }
  if (
    supplied === "best"
    && move?.playedUci
    && move?.bestUci
    && move.playedUci !== move.bestUci
  ) return "excellent";
  return supplied;
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
  const beforeWin = winChance(beforeMoverCp);
  const afterWin = winChance(afterMoverCp);
  const winPercentLoss = Math.max(0, beforeWin - afterWin);
  const accuracy = moveAccuracy(winPercentLoss);

  return {
    accuracy,
    lossCp,
    winPercentLoss,
    quality: classifyWinChanceLoss(winPercentLoss),
  };
}

export function explainMoveQuality(move, options = {}) {
  if (!move || typeof move !== "object") return "Für diesen Zug liegt noch keine Bewertung vor.";
  const rating = normalizeReviewCoachRating(
    typeof options === "number" ? options : options?.rating ?? move,
  );
  const verified = verifiedMoveReview(move);
  const bestSan = verifiedBestSan(verified);
  const quality = reviewQualityForDisplay(verified || move);
  const practicallyEqual = Boolean(
    bestSan
    && verified?.playedUci !== verified?.bestUci
    && (
      (Number.isFinite(verified?.lossCp)
        && verified.lossCp <= PRACTICALLY_EQUIVALENT_LOSS_CP)
      || move.quality === "best"
    )
  );
  const consequence = immediateReplyConsequence(verified || move);

  if (quality === "brilliant") return "Starker Fund: Du gibst bewusst Material und bekommst dafür genug Spiel.";
  if (quality === "book") return "Der Zug steht im Eröffnungsbuch und ist hier eine gute Wahl.";
  if (practicallyEqual) {
    return `${bestSan} geht genauso gut.`;
  }
  if (quality === "best") {
    if (rating === 800) return "Das ist ein starker Zug. Du machst deine Stellung nicht schlechter.";
    if (rating === 1000) return "Der Zug ist stark und hält deine Stellung.";
    if (rating === 1400) return "Der Zug hält die Bewertung fast vollständig.";
    return "Der Zug hält die Bewertung ohne messbaren Verlust.";
  }
  if (quality === "excellent") {
    if (rating === 800) {
      return bestSan
        ? `Dein Zug ist gut. ${bestSan} war auch eine gute Möglichkeit.`
        : "Dein Zug ist gut. Du gibst fast nichts ab.";
    }
    if (rating === 1000) {
      return bestSan
        ? `Dein Zug ist sehr gut. ${bestSan} war nur wenig besser.`
        : "Dein Zug ist sehr gut und gibt fast nichts ab.";
    }
    if (rating === 1400) {
      return bestSan
        ? `Der Zug ist fast gleichwertig mit ${bestSan}.`
        : "Der Zug hält die Bewertung fast vollständig.";
    }
    return bestSan
      ? `Der Bewertungsverlust gegenüber ${bestSan} ist minimal.`
      : "Der Bewertungsverlust ist minimal.";
  }
  if (quality === "good") {
    if (rating === 800) {
      return bestSan
        ? `Der Zug ist spielbar. ${bestSan} war etwas besser.`
        : "Der Zug ist spielbar. Deine Stellung bleibt in Ordnung.";
    }
    if (rating === 1000) {
      return bestSan
        ? `Der Zug ist gut spielbar. ${bestSan} war etwas besser.`
        : "Der Zug ist gut spielbar und kostet dich nur wenig.";
    }
    if (rating === 1400) {
      return bestSan
        ? `Der Zug bleibt nah an ${bestSan}; du gibst nur wenig ab.`
        : "Der Zug ist solide und gibt nur wenig von der Stellung ab.";
    }
    return bestSan
      ? `Gegenüber ${bestSan} kostet der Zug nur wenig in der Bewertung.`
      : "Der Bewertungsverlust bleibt klein.";
  }
  if (quality === "inaccuracy") {
    if (rating === 800) {
      return bestSan
        ? `Du gibst etwas von deiner Stellung ab. Besser war ${bestSan}.`
        : "Du gibst etwas von deiner Stellung ab.";
    }
    if (rating === 1000) {
      return bestSan
        ? `Deine Stellung wird etwas schlechter. Besser war ${bestSan}.`
        : "Der Zug gibt etwas von deiner Stellung ab.";
    }
    if (rating === 1400) {
      return bestSan
        ? `Deine Stellung wird etwas schlechter. Besser war ${bestSan}.`
        : "Deine Stellung wird etwas schlechter.";
    }
    return bestSan
      ? `Die Bewertung fällt spürbar. ${bestSan} hielt die Stellung besser.`
      : "Die Bewertung fällt spürbar.";
  }
  if (quality === "mistake") {
    const verdict = consequence || "Das ist ein klarer Fehler und deine Stellung wird deutlich schlechter.";
    return bestSan ? `${verdict} Besser war ${bestSan}.` : verdict;
  }
  if (quality === "blunder") {
    const verdict = consequence || "Das ist ein grober Fehler und deine Stellung wird viel schlechter.";
    return bestSan ? `${verdict} Besser war ${bestSan}.` : verdict;
  }
  return "Dieser Zug ist noch nicht vollständig bewertet.";
}

export function describeMoveAssessment(move, options = {}) {
  const verified = verifiedMoveReview(move);
  if (!verified) return null;
  const rating = normalizeReviewCoachRating(
    typeof options === "number" ? options : options?.rating ?? move,
  );
  const quality = reviewQualityForDisplay(verified);
  const bestSan = verifiedBestSan(verified);
  const practicallyEqual = Boolean(
    bestSan
    && verified.playedUci !== verified.bestUci
    && (
      (Number.isFinite(verified.lossCp)
        && verified.lossCp <= PRACTICALLY_EQUIVALENT_LOSS_CP)
      || move.quality === "best"
    )
  );
  const consequence = immediateReplyConsequence(verified);
  const descriptions = {
    brilliant: {
      lead: "Brillant gefunden.",
      reason: "Du gibst bewusst Material und bekommst dafür genug Spiel.",
    },
    book: {
      lead: "Das ist ein Buchzug.",
      reason: "Der Zug ist aus dieser Eröffnungsstellung bekannt.",
    },
    best: {
      lead: "Das war der beste Zug.",
      reason: rating === 800
        ? "Du machst deine Stellung damit nicht schlechter."
        : rating === 1000
          ? "Der Zug hält deine Stellung."
          : rating === 1400
            ? "Der Zug hält die Bewertung fast vollständig."
            : "Der Zug hält die Bewertung ohne messbaren Verlust.",
    },
    excellent: {
      lead: "Stark gespielt.",
      reason: rating === 800
        ? "Du gibst damit fast nichts ab."
        : rating === 1000
          ? "Damit bleibst du fast genauso gut."
          : rating === 1400
            ? "Der Zug ist fast genauso gut."
            : "Der Unterschied zum ersten Vorschlag ist minimal.",
    },
    good: {
      lead: "Das passt.",
      reason: rating === 800
        ? "Du gibst mit diesem Zug nur wenig ab."
        : rating === 1000
          ? "Der Zug kostet dich nur wenig."
          : rating === 1400
            ? "Der Zug kostet nur wenig."
            : "Der Bewertungsverlust bleibt klein.",
    },
    inaccuracy: {
      lead: "Der Zug ist spielbar.",
      reason: rating === 800
        ? "Du gibst etwas von deiner Stellung ab."
        : rating === 1000
          ? "Deine Stellung wird etwas schlechter."
          : rating === 1400
            ? "Deine Stellung wird etwas schlechter."
            : "Die Bewertung fällt spürbar.",
    },
    mistake: {
      lead: "Das ist ein klarer Fehler.",
      reason: consequence || "Deine Stellung wird dadurch deutlich schlechter.",
    },
    blunder: {
      lead: "Das ist ein grober Fehler.",
      reason: consequence || "Deine Stellung wird dadurch viel schlechter.",
    },
  };
  return {
    tone: MOVE_QUALITY[quality].tone,
    label: MOVE_QUALITY[quality].label,
    lead: descriptions[quality].lead,
    reason: descriptions[quality].reason,
    alternative: bestSan
      ? practicallyEqual
        ? `Genauso gut geht ${bestSan}.`
        : `Besser war ${bestSan}.`
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
    idea = "Der Zug schlägt eine gegnerische Figur oder einen Bauern.";
  } else if (/^[a-h][1-8][a-h][1-8][qrbn]$/.test(move)) {
    idea = "Der Zug wandelt einen Bauern um und schafft dadurch unmittelbar neues Material.";
  } else if (["d4", "e4", "d5", "e5"].includes(move.slice(2, 4))) {
    idea = "Der Zug erhöht den Einfluss im Zentrum.";
  }
  if (idea) return idea;
  return rank === 1
    ? "Der Zug wurde als stärkste Möglichkeit berechnet."
    : "Der Zug ist spielbar. Der erste Vorschlag wurde besser bewertet.";
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
    rank: Math.max(1, Number.parseInt(info.multipv, 10) || 1),
    pv: frames.map((frame) => frame.uci),
    pvSan: frames.map((frame) => frame.san),
    complete: true,
  };
}

export function analysisEntryFromMultiPv(infos, { requiredLines = 2 } = {}) {
  const requested = Math.max(1, Math.min(5, Number.parseInt(requiredLines, 10) || 2));
  const byRank = new Map();
  (Array.isArray(infos) ? infos : []).forEach((info) => {
    const entry = info?.pv && Object.hasOwn(info, "whiteCp")
      ? info
      : analysisEntryFromInfo(info);
    if (!entry?.complete || !Array.isArray(entry.pv) || entry.pv.length === 0) return;
    const rank = Math.max(1, Number.parseInt(entry.rank ?? info?.multipv, 10) || 1);
    const previous = byRank.get(rank);
    if (!previous || (entry.depth || 0) >= (previous.depth || 0)) {
      byRank.set(rank, { ...entry, rank });
    }
  });
  const candidateLines = [...byRank.values()]
    .sort((left, right) => left.rank - right.rank)
    .slice(0, requested)
    .map((entry) => ({
      rank: entry.rank,
      evaluation: entry.evaluation,
      whiteCp: entry.whiteCp,
      depth: entry.depth,
      pvUci: [...entry.pv],
      pvSan: Array.isArray(entry.pvSan) ? [...entry.pvSan] : [],
    }));
  const primary = candidateLines.find((line) => line.rank === 1) || candidateLines[0];
  if (!primary) return null;
  return {
    whiteCp: primary.whiteCp,
    evaluation: primary.evaluation,
    depth: primary.depth,
    pv: [...primary.pvUci],
    pvSan: [...primary.pvSan],
    candidateLines,
    complete: candidateLines.length >= requested,
  };
}

function evaluationForPlayer(evaluation, whiteCp, color) {
  const sign = color === "b" ? -1 : 1;
  if (evaluation?.unit === "mate" && Number.isFinite(evaluation.value)) {
    return {
      unit: "mate",
      value: Math.round(evaluation.value * sign),
      perspective: "player",
    };
  }
  const cp = Number.isFinite(whiteCp)
    ? whiteCp
    : evaluation?.unit === "cp" && Number.isFinite(evaluation.value)
      ? evaluation.value
      : null;
  return Number.isFinite(cp)
    ? { unit: "cp", value: Math.round(cp * sign), perspective: "player" }
    : null;
}

function normalizedCandidateLines(entry, fen, color) {
  const supplied = Array.isArray(entry?.candidateLines) && entry.candidateLines.length > 0
    ? entry.candidateLines
    : Array.isArray(entry?.pv) && entry.pv.length > 0
      ? [{
        rank: 1,
        evaluation: entry.evaluation,
        whiteCp: entry.whiteCp,
        depth: entry.depth,
        pvUci: entry.pv,
        pvSan: entry.pvSan,
      }]
      : [];
  return supplied.flatMap((line, index) => {
    const frames = buildPvFrames(fen, line?.pvUci || line?.pv || [], 20);
    if (frames.length === 0) return [];
    return [{
      rank: Math.max(1, Number.parseInt(line.rank, 10) || index + 1),
      evaluation: evaluationForPlayer(
        line.evaluation,
        Number.isFinite(line.whiteCp) ? line.whiteCp : scoreToWhiteCp(line.evaluation),
        color,
      ),
      pvUci: frames.map((frame) => frame.uci),
      pvSan: frames.map((frame) => frame.san),
    }];
  }).sort((left, right) => left.rank - right.rank);
}

const MATERIAL_VALUES = Object.freeze({ p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 });

function materialBalance(game, color) {
  if (!game || !["w", "b"].includes(color)) return null;
  let balance = 0;
  game.board().flat().forEach((piece) => {
    if (!piece) return;
    const value = MATERIAL_VALUES[piece.type] || 0;
    balance += piece.color === color ? value : -value;
  });
  return balance;
}

/**
 * Vorsichtige Opfer-Heuristik: In einer legalen, von Stockfish gelieferten
 * Variante muss der Spieler vorübergehend mindestens den konfigurierten
 * Materialwert investieren. Ein normaler gleichwertiger Tausch zählt nicht.
 */
export function detectMaterialSacrifice({
  fenBefore,
  playedUci,
  principalVariation = [],
  color,
  minimumInvestment = MOVE_CLASSIFICATION_CONFIG.brilliantMinimumSacrifice,
} = {}) {
  if (
    typeof fenBefore !== "string"
    || typeof playedUci !== "string"
    || !["w", "b"].includes(color)
    || !Array.isArray(principalVariation)
    || principalVariation[0] !== playedUci
  ) return false;

  const game = new Chess();
  try {
    game.load(fenBefore);
  } catch {
    return false;
  }
  const beforeBalance = materialBalance(game, color);
  let lowestBalance = beforeBalance;
  let firstMove = null;
  for (const uci of principalVariation.slice(0, 6)) {
    let move;
    try {
      move = game.move({
        from: uci.slice(0, 2),
        to: uci.slice(2, 4),
        promotion: uci.slice(4, 5) || undefined,
      });
    } catch {
      return false;
    }
    if (!move) return false;
    firstMove ||= move;
    lowestBalance = Math.min(lowestBalance, materialBalance(game, color));
  }
  if (!firstMove) return false;
  const movedValue = MATERIAL_VALUES[firstMove.piece] || 0;
  const capturedValue = MATERIAL_VALUES[firstMove.captured] || 0;
  const ordinaryTrade = Boolean(firstMove.captured && capturedValue >= movedValue - 0.5);
  return !ordinaryTrade && beforeBalance - lowestBalance >= minimumInvestment;
}

function playerEvaluation(entry, color) {
  const evaluation = evaluationForPlayer(
    entry?.evaluation,
    Number.isFinite(entry?.whiteCp) ? entry.whiteCp : scoreToWhiteCp(entry),
    color,
  );
  if (evaluation?.unit === "mate") {
    const mate = evaluation.value === 0
      ? null
      : Math.round(evaluation.value);
    return {
      centipawns: null,
      mate,
      winChance: mate === null ? null : mate > 0 ? 100 : 0,
      detail: evaluation,
    };
  }
  const centipawns = evaluation?.unit === "cp" && Number.isFinite(evaluation.value)
    ? Math.round(evaluation.value)
    : null;
  return {
    centipawns,
    mate: null,
    winChance: winChance(centipawns),
    detail: evaluation,
  };
}

function winChanceForCandidate(line) {
  const evaluation = line?.evaluation;
  if (evaluation?.unit === "mate" && Number.isFinite(evaluation.value)) {
    return evaluation.value > 0 ? 100 : evaluation.value < 0 ? 0 : null;
  }
  return evaluation?.unit === "cp" && Number.isFinite(evaluation.value)
    ? winChance(evaluation.value)
    : null;
}

export function classifyMoveReview({
  playedUci = "",
  bestMoveUci = "",
  winChanceBefore = null,
  winChanceAfter = null,
  mateBefore = null,
  mateAfter = null,
  isBookMove = false,
  isOnlyMove = false,
  isSacrifice = false,
} = {}) {
  const loss = Number.isFinite(winChanceBefore) && Number.isFinite(winChanceAfter)
    ? Math.max(0, winChanceBefore - winChanceAfter)
    : 0;
  const isBestMove = Boolean(playedUci && bestMoveUci && playedUci === bestMoveUci);
  const missedMate = Number.isFinite(mateBefore) && mateBefore > 0
    && !(Number.isFinite(mateAfter) && mateAfter > 0);
  const allowedMate = Number.isFinite(mateAfter) && mateAfter < 0
    && !(Number.isFinite(mateBefore) && mateBefore < 0);

  let classification;
  if (isBookMove) classification = "book";
  else if (
    loss <= MOVE_CLASSIFICATION_CONFIG.brilliantMaxLoss
    && isSacrifice
    && Number.isFinite(winChanceAfter)
    && winChanceAfter >= 50
    && !isOnlyMove
  ) classification = "brilliant";
  else if (isBestMove) classification = "best";
  else if (allowedMate || missedMate) classification = "blunder";
  else classification = classifyWinChanceLoss(loss);

  return {
    classification,
    symbol: MOVE_QUALITY[classification].symbol,
    winChanceLoss: loss,
    flags: {
      isBookMove: Boolean(isBookMove),
      isBestMove,
      isOnlyMove: Boolean(isOnlyMove),
      isSacrifice: Boolean(isSacrifice),
      missedMate,
      allowedMate,
    },
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
      && CRITICAL_MOVE_QUALITIES.includes(move.quality)
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
  {
    depth = null,
    final = true,
    playerColor = null,
    coachRating = null,
    learnerProfile = null,
    bookMovePlies = null,
  } = {},
) {
  const nodes = Array.isArray(path) ? path : [];
  const entries = Array.isArray(evaluations) ? evaluations : [];
  const moves = [];
  const reviewCoachRating = normalizeReviewCoachRating(coachRating ?? learnerProfile);

  for (let index = 1; index < nodes.length; index += 1) {
    const node = nodes[index];
    const before = entries[index - 1];
    const after = entries[index];
    const beforeCp = scoreToWhiteCp(before);
    const afterCp = scoreToWhiteCp(after);
    const color = node?.move?.color;
    const metrics = calculateMoveAccuracy(beforeCp, afterCp, color);
    if (!metrics) continue;
    const beforePlayer = playerEvaluation(before, color);
    const afterPlayer = playerEvaluation(after, color);
    if (!Number.isFinite(beforePlayer.winChance) || !Number.isFinite(afterPlayer.winChance)) continue;
    const fenBefore = nodes[index - 1]?.fen || "";
    const candidateLines = normalizedCandidateLines(before, fenBefore, color);
    const bestCandidate = candidateLines.find((line) => line.rank === 1)
      || candidateLines[0]
      || null;
    const bestFrames = buildPvFrames(
      fenBefore,
      bestCandidate?.pvUci || (Array.isArray(before?.pv) ? before.pv : []),
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
    const playedCandidate = candidateLines.find(
      (line) => line.pvUci[0] === playedUci,
    );
    const playedEvaluation = evaluationForPlayer(
      after?.evaluation,
      afterCp,
      color,
    );
    const playedLine = {
      evaluation: playedCandidate?.evaluation || playedEvaluation,
      pvUci: playedCandidate?.pvUci || playedContinuationFrames.map((frame) => frame.uci),
      pvSan: playedCandidate?.pvSan || playedContinuationFrames.map((frame) => frame.san),
    };
    const secondCandidate = candidateLines.find((line) => line.rank === 2) || null;
    const onlyLegalMove = Number.isInteger(before?.legalMoveCount)
      && before.legalMoveCount === 1;
    const moveNecessity = classifyMoveNecessity({
      bestEvaluation: bestCandidate?.evaluation,
      secondEvaluation: secondCandidate?.evaluation,
      legalMoveCount: onlyLegalMove ? 1 : before?.legalMoveCount,
    });
    const playedContinuationUci = playedContinuationFrames.map((frame) => frame.uci);
    const isBookMove = bookMovePlies instanceof Set
      ? bookMovePlies.has(index)
      : typeof bookMovePlies === "function"
        ? Boolean(bookMovePlies(index, nodes.slice(0, index + 1)))
        : false;
    const isSacrifice = detectMaterialSacrifice({
      fenBefore,
      playedUci,
      principalVariation: playedContinuationUci,
      color,
    });
    const classificationResult = classifyMoveReview({
      playedUci,
      bestMoveUci: bestUci,
      winChanceBefore: beforePlayer.winChance,
      winChanceAfter: afterPlayer.winChance,
      mateBefore: beforePlayer.mate,
      mateAfter: afterPlayer.mate,
      secondBestWinChance: winChanceForCandidate(secondCandidate),
      isBookMove,
      isOnlyMove: moveNecessity.onlyMove,
      isSacrifice,
    });
    // Ein nachgewiesener Buchzug wird nicht gegen eine einzelne Engine-Hauptvariante
    // bestraft: In der Eröffnung können mehrere Züge gleichermaßen richtig sein.
    const accuracy = isBookMove ? 100 : moveAccuracy(classificationResult.winChanceLoss);

    const reportMove = {
      ply: index,
      moveNumber: Math.ceil(index / 2),
      color,
      san: node?.move?.san || "?",
      playedUci,
      uci: playedUci,
      fenBefore,
      fenAfter: node?.fen || "",
      beforeCp,
      afterCp,
      evaluationBefore: beforePlayer.detail,
      evaluationAfter: afterPlayer.detail,
      evaluationBeforeCp: beforePlayer.centipawns,
      evaluationAfterCp: afterPlayer.centipawns,
      mateBefore: beforePlayer.mate,
      mateAfter: afterPlayer.mate,
      evaluationDeltaCp: Math.round(afterCp - beforeCp),
      bestUci,
      bestMoveUci: bestUci || null,
      bestSan: bestFrames[0]?.san || "",
      bestMoveSan: bestFrames[0]?.san || null,
      bestPvUci: bestFrames.map((frame) => frame.uci),
      bestPvSan: bestFrames.map((frame) => frame.san),
      principalVariation: bestFrames.map((frame) => frame.uci),
      principalVariationSan: bestFrames.map((frame) => frame.san),
      playedContinuationUci,
      playedContinuationSan: playedContinuationFrames.map((frame) => frame.san),
      candidateLines,
      playedLine,
      onlyMove: moveNecessity.onlyMove,
      onlyMoveEvidence: {
        type: moveNecessity.type,
        legalMoveCount: onlyLegalMove ? 1 : null,
        gapCp: moveNecessity.gapCp,
        bestCp: moveNecessity.bestCp,
        secondCp: moveNecessity.secondCp,
        reason: moveNecessity.reason,
      },
      moveNecessity,
      engineDepth: Number.isFinite(before?.depth) ? before.depth : null,
      coachRating: reviewCoachRating,
      winChanceBefore: rounded(beforePlayer.winChance, 2),
      winChanceAfter: rounded(afterPlayer.winChance, 2),
      winChanceLoss: rounded(classificationResult.winChanceLoss, 2),
      accuracy: rounded(accuracy),
      lossCp: Math.round(metrics.lossCp),
      winPercentLoss: rounded(classificationResult.winChanceLoss, 2),
      classification: classificationResult.classification,
      symbol: classificationResult.symbol,
      flags: classificationResult.flags,
      quality: classificationResult.classification,
    };
    reportMove.quality = reviewQualityForDisplay(reportMove);
    reportMove.explanation = explainMoveQuality(reportMove, { rating: reviewCoachRating });
    moves.push(reportMove);
  }

  const forColor = (color) => moves.filter((move) => move.color === color);
  const whiteMoves = forColor("w");
  const blackMoves = forColor("b");
  const countsFor = (selectedMoves) => Object.keys(MOVE_QUALITY).reduce((result, key) => {
    result[key] = selectedMoves.filter((move) => move.quality === key).length;
    return result;
  }, {});
  const counts = Object.keys(MOVE_QUALITY).reduce((result, key) => {
    result[key] = moves.filter((move) => move.quality === key).length;
    return result;
  }, {});
  const accuracyValues = moves.map((move) => move.accuracy);
  const lossValues = moves.map((move) => move.lossCp);

  return {
    version: 3,
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
    whiteCounts: countsFor(whiteMoves),
    blackCounts: countsFor(blackMoves),
    moves,
    coachRating: reviewCoachRating,
    playerColor: playerColor === "w" || playerColor === "b" ? playerColor : null,
    criticalMoments: selectCriticalMoments(moves, { playerColor, limit: 3 }),
  };
}

export function reviewDepthForPlies(plies, preferredDepth = 15) {
  const adaptive = plies <= 40 ? 14 : plies <= 100 ? 12 : 10;
  const preferred = Number.isFinite(preferredDepth) ? preferredDepth : adaptive;
  return Math.max(8, Math.min(18, adaptive, preferred));
}

function reviewPositionPhaseFacts(fen) {
  if (typeof fen !== "string" || !fen.trim()) return null;
  const game = new Chess();
  try {
    game.load(fen);
  } catch {
    return null;
  }

  const phaseValues = { n: 1, b: 1, r: 2, q: 4 };
  let phaseUnits = 0;
  let nonPawnPieces = 0;
  let queens = 0;
  game.board().flat().forEach((piece) => {
    if (!piece || !Object.hasOwn(phaseValues, piece.type)) return;
    phaseUnits += phaseValues[piece.type];
    nonPawnPieces += 1;
    if (piece.type === "q") queens += 1;
  });

  const startingMinorPieces = [
    ["b1", "w", "n"], ["g1", "w", "n"],
    ["c1", "w", "b"], ["f1", "w", "b"],
    ["b8", "b", "n"], ["g8", "b", "n"],
    ["c8", "b", "b"], ["f8", "b", "b"],
  ];
  const undevelopedMinorPieces = startingMinorPieces.filter(([square, color, type]) => {
    const piece = game.get(square);
    return piece?.color === color && piece?.type === type;
  }).length;

  return { phaseUnits, nonPawnPieces, queens, undevelopedMinorPieces };
}

export function reviewPhaseForMove(move) {
  const moveNumber = Number.parseInt(move?.moveNumber, 10) || 1;
  const facts = reviewPositionPhaseFacts(move?.fenBefore || "");
  if (!facts) return moveNumber <= 12 ? "opening" : "middlegame";

  const { phaseUnits, nonPawnPieces, queens, undevelopedMinorPieces } = facts;
  if (
    phaseUnits <= 8
    || nonPawnPieces <= 4
    || (queens === 0 && phaseUnits <= 10)
  ) return "endgame";
  if (
    (moveNumber <= 8 && phaseUnits >= 12)
    || (moveNumber <= 16 && phaseUnits >= 14 && undevelopedMinorPieces >= 2)
    || (moveNumber <= 12 && phaseUnits >= 18)
  ) return "opening";
  return "middlegame";
}

export function openingMoveReviewPresentation(move, { inOpeningBook = false } = {}) {
  if (reviewPhaseForMove(move) !== "opening") return null;
  const quality = reviewQualityForDisplay(move);
  if (CRITICAL_MOVE_QUALITIES.includes(quality)) return null;
  return {
    label: inOpeningBook ? "Spielbare Eröffnungswahl" : "Eröffnungszug",
    reason: inOpeningBook
      ? "Dieser Zug steht im lokalen Eröffnungsbuch. In der Eröffnung gibt es oft mehrere gute Wege."
      : "Diese Stellung gehört noch zur Eröffnung. Ohne passenden Buchtreffer zeigt der Coach hier keine Bestzug-Rangliste.",
    hideEngineRanking: true,
  };
}

export function buildCoachPhaseSummary(report) {
  const labels = {
    opening: "Eröffnung",
    middlegame: "Mittelspiel",
    endgame: "Endspiel",
  };
  const perspective = ["w", "b"].includes(report?.playerColor) ? report.playerColor : null;
  const moves = (Array.isArray(report?.moves) ? report.moves : [])
    .filter((move) => move && (!perspective || move.color === perspective))
    .map((move) => ({ ...move, quality: reviewQualityForDisplay(move) }));
  return ["opening", "middlegame", "endgame"].flatMap((phase) => {
    const phaseMoves = moves.filter((move) => reviewPhaseForMove(move) === phase);
    if (phaseMoves.length === 0) return [];
    const strong = phaseMoves.filter((move) => POSITIVE_MOVE_QUALITIES.includes(move.quality));
    const critical = phaseMoves.filter((move) => CRITICAL_MOVE_QUALITIES.includes(move.quality));
    const bestExample = strong[0];
    const focus = [...critical].sort((left, right) => (
      (right.winPercentLoss || 0) - (left.winPercentLoss || 0)
    ))[0];
    const moveLabel = (move) => move
      ? `${move.moveNumber}${move.color === "b" ? "…" : "."} ${move.san}`
      : "";
    return [{
      id: phase,
      title: labels[phase],
      analyzedMoves: phaseMoves.length,
      strongMoves: strong.length,
      criticalMoves: critical.length,
      positive: bestExample
        ? `${moveLabel(bestExample)} war gut gespielt.`
        : "In dieser Phase ist noch kein klar starker Zug belegt.",
      focus: focus
        ? `${moveLabel(focus)} solltest du dir noch einmal ansehen.`
        : "In dieser Phase gab es keinen großen Fehler.",
    }];
  });
}

export function buildLearningSummary(report, options = {}) {
  const rating = normalizeReviewCoachRating(
    typeof options === "number" ? options : options?.rating ?? report,
  );
  const simple = simpleReviewLanguage(rating);
  const allMoves = Array.isArray(report?.moves)
    ? report.moves.filter(Boolean).map((move) => ({
      ...move,
      quality: reviewQualityForDisplay(move),
    }))
    : [];
  const perspective = report?.playerColor === "w" || report?.playerColor === "b"
    ? report.playerColor
    : null;
  const moves = perspective
    ? allMoves.filter((move) => move.color === perspective)
    : allMoves;
  if (moves.length === 0) {
    return {
      strongestPhase: "Noch nicht zuverlässig erkennbar",
      strongestPhaseDetail: "Dafür braucht der Coach zuerst mehrere bewertete Züge.",
      biggestLesson: "Es gibt noch keinen sicheren Schlüsselmoment.",
      biggestLessonTitle: "Noch kein Moment bewertet",
      recurringPattern: "Mit mehr bewerteten Zügen kann der Coach nach Mustern suchen.",
      learningGoal: "Lass zuerst eine vollständige Partie bewerten.",
      exercise: "Spiele oder importiere eine Partie und starte danach die Coach-Analyse.",
      confidence: "low",
    };
  }

  const phases = [
    ["opening", "Eröffnung"],
    ["middlegame", "Mittelspiel"],
    ["endgame", "Endspiel"],
  ]
    .map(([id, name]) => {
      const values = moves
        .filter((move) => reviewPhaseForMove(move) === id)
        .map((move) => move.accuracy)
        .filter(Number.isFinite);
      return { id, name, values, average: mean(values) };
    })
    .filter((phase) => phase.values.length > 0);
  const strongest = [...phases].sort((left, right) => right.average - left.average)[0];

  const biggest = [...moves]
    .filter((move) => Number.isFinite(move.winPercentLoss))
    .sort((left, right) => right.winPercentLoss - left.winPercentLoss)[0];
  const serious = moves.filter((move) => ["mistake", "blunder"].includes(move.quality));
  const inaccuracies = moves.filter((move) => move.quality === "inaccuracy");
  const strong = moves.filter((move) => POSITIVE_MOVE_QUALITIES.includes(move.quality));
  const focusedMoment = (Array.isArray(report?.criticalMoments)
    ? report.criticalMoments.find((move) => !perspective || move?.color === perspective)
    : null) || biggest || moves[0];
  const focusedLabel = `${focusedMoment.moveNumber}${focusedMoment.color === "b" ? "…" : "."} ${focusedMoment.san}`;
  const verifiedFocus = verifiedMoveReview(focusedMoment);
  const focusedComparison = verifiedFocus?.bestSan
    ? `Spiele danach ${verifiedFocus.bestSan} und die kurze Variante nach.`
    : verifiedFocus?.bestPvSan?.length > 0
      ? "Spiele danach die gespeicherte Variante nach."
      : "Notiere zwei mögliche Züge. Prüfe dann die Antwort des Gegners.";
  const focusedExercise = `Stelle die Position vor ${focusedLabel} wieder auf. Finde selbst einen guten Zug. ${focusedComparison}`;

  let recurringPattern;
  let learningGoal;
  let exercise;
  if (serious.length >= 2) {
    recurringPattern = simple
      ? `Bei ${serious.length} Zügen wurde deine Stellung deutlich schlechter. Ein gemeinsamer Grund ist noch nicht sicher.`
      : `${serious.length} klare Bewertungsverluste zeigen mehrere kritische Entscheidungen. Ein gemeinsames Motiv ist noch nicht sicher belegt.`;
    learningGoal = simple
      ? "Halte vor jedem Zug kurz an und prüfe die Antwort des Gegners."
      : "Vergleiche bei kritischen Entscheidungen deinen Zug mit der besten geprüften Variante.";
    exercise = focusedExercise;
  } else if (inaccuracies.length >= 2) {
    recurringPattern = simple
      ? `Bei ${inaccuracies.length} Zügen hast du jeweils etwas von deiner Stellung abgegeben.`
      : `${inaccuracies.length} kleine Verluste deuten auf mehrere ungenaue Entscheidungen statt eines großen Fehlers.`;
    learningGoal = simple
      ? "Suche vor deinem Zug nach zwei guten Möglichkeiten und vergleiche sie."
      : "Vergleiche bei diesen Entscheidungen mindestens zwei Kandidatenzüge.";
    exercise = focusedExercise;
  } else if (strong.length >= Math.max(2, Math.ceil(moves.length * 0.6))) {
    recurringPattern = simple
      ? "Du hast meist gute, sichere Züge gefunden."
      : "Du hast überwiegend stabile Entscheidungen ohne klare Einbrüche getroffen.";
    learningGoal = "Erkläre bei deinen guten Zügen, welche Aufgabe sie lösen.";
    exercise = `Stelle die Position vor ${focusedLabel} erneut auf und erkläre, warum dein Zug dort gut funktioniert.`;
  } else {
    recurringPattern = "Die bewerteten Züge zeigen noch kein klares Fehlermuster.";
    learningGoal = "Arbeite zuerst mit dem wichtigsten Moment dieser Partie.";
    exercise = focusedExercise;
  }

  const biggestLesson = biggest
    ? `${biggest.moveNumber}${biggest.color === "b" ? "…" : "."} ${biggest.san}: ${explainMoveQuality(biggest, { rating })}`
    : "Kein einzelner Zug hebt sich sicher als größter Fehler ab.";
  const biggestNeedsReview = Boolean(
    biggest && CRITICAL_MOVE_QUALITIES.includes(biggest.quality),
  );

  return {
    strongestPhase: strongest?.name || "Stabilste Phase",
    strongestPhaseDetail: strongest
      ? simple
        ? `Deine Züge hatten hier rund ${strongest.average.toFixed(0)} % Genauigkeit.`
        : `In dieser Phase lag deine Zuggenauigkeit bei rund ${strongest.average.toFixed(0)} %.`
      : "Noch nicht sicher erkennbar.",
    biggestLesson,
    biggestLessonTitle: !biggest
      ? "Noch kein Moment bewertet"
      : biggestNeedsReview
        ? "Hier lohnt sich ein zweiter Blick"
        : "Das hat gut funktioniert",
    recurringPattern,
    learningGoal,
    exercise,
    confidence: moves.length >= 8 ? "medium" : "low",
  };
}

export function buildFallbackFeedback(report, options = {}) {
  if (!report || report.analyzedMoves === 0) {
    return "**Noch keine vollständige Bewertung:** Der Coach braucht mindestens einen bewerteten Zug.";
  }
  const rating = normalizeReviewCoachRating(
    typeof options === "number" ? options : options?.rating ?? report,
  );
  const perspective = report.playerColor === "w" || report.playerColor === "b"
    ? report.playerColor
    : null;
  const reportMoves = Array.isArray(report.moves) ? report.moves : [];
  const perspectiveMoves = reportMoves
    .filter((move) => move && typeof move === "object")
    .filter((move) => !perspective || move.color === perspective)
    .map((move) => ({ ...move, quality: reviewQualityForDisplay(move) }));
  const perspectiveAccuracy = perspective === "w"
    ? report.whiteAccuracy
    : perspective === "b"
      ? report.blackAccuracy
      : report.overallAccuracy;
  const accuracy = Number.isFinite(perspectiveAccuracy)
    ? `Deine Zuggenauigkeit lag bei ${perspectiveAccuracy.toFixed(1)} %.`
    : "Deine Zuggenauigkeit ist noch offen.";
  const serious = perspectiveMoves
    .filter((move) => ["mistake", "blunder"].includes(move.quality))
    .length;
  const seriousLabel = serious === 1 ? "einen großen Fehler" : `${serious} große Fehler`;
  const moveCountLabel = perspectiveMoves.length === 1 ? "einem Zug" : `${perspectiveMoves.length} Zügen`;
  const criticalMoments = Array.isArray(report.criticalMoments) ? report.criticalMoments : [];
  const biggest = criticalMoments
    .find((move) => move && typeof move === "object" && (!perspective || move.color === perspective));
  const strongest = [...perspectiveMoves]
    .filter((move) => POSITIVE_MOVE_QUALITIES.includes(move.quality))
    .sort((left, right) => (right.accuracy || 0) - (left.accuracy || 0))[0];
  const strength = strongest
    ? `**${strongest.moveNumber}${strongest.color === "b" ? "…" : "."} ${strongest.san}** war ein guter Zug.`
    : "Es ist noch kein einzelner starker Zug sicher belegt.";
  const exercise = biggest
    ? `Stelle die Position vor **${biggest.moveNumber}${biggest.color === "b" ? "…" : "."} ${biggest.san}** wieder auf und suche zwei Züge. ${explainMoveQuality(biggest, { rating })}`
    : strongest
      ? `Sieh dir **${strongest.moveNumber}${strongest.color === "b" ? "…" : "."} ${strongest.san}** noch einmal an. Erkläre mit eigenen Worten, welche Aufgabe der Zug löst.`
      : perspectiveMoves.length > 0
        ? `Sieh dir **${perspectiveMoves[0].moveNumber}${perspectiveMoves[0].color === "b" ? "…" : "."} ${perspectiveMoves[0].san}** noch einmal an. Prüfe zuerst die Antwort des Gegners.`
        : "Lass zuerst mindestens einen eigenen Zug bewerten.";

  return [
    `**Kurz gesagt:** ${accuracy} Du hattest ${seriousLabel} in ${moveCountLabel}.`,
    `**Das war gut:** ${strength}`,
    `**Nächster Schritt:** ${exercise}`,
  ].join("\n\n");
}
