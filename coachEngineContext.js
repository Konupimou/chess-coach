import { Chess } from "chess.js";

const MAX_LINES = 5;
const MAX_PV_MOVES = 20;
const MAX_REVIEW_MOMENTS = 8;
const UCI_PATTERN = /^[a-h][1-8][a-h][1-8][qrbn]?$/i;

const text = (value, maxLength = 120) => (
  typeof value === "string" ? value.trim().slice(0, maxLength) : ""
);

const finite = (value, minimum, maximum) => (
  Number.isFinite(value) ? Math.max(minimum, Math.min(maximum, value)) : null
);

function gameFromFen(fen) {
  if (typeof fen !== "string" || !fen.trim()) return null;
  const game = new Chess();
  try {
    game.load(fen);
    return game;
  } catch {
    return null;
  }
}

function normalizeFen(value) {
  const game = gameFromFen(text(value, 100));
  return game?.fen() || "";
}

function normalizeMove(value, fen) {
  if (!value || typeof value !== "object") return null;
  const uci = text(value.uci, 5).toLowerCase();
  if (!UCI_PATTERN.test(uci)) return null;
  const game = gameFromFen(fen);
  if (!game) return null;
  let move;
  try {
    move = game.move({
      from: uci.slice(0, 2),
      to: uci.slice(2, 4),
      promotion: uci.length > 4 ? uci.slice(4, 5) : undefined,
    });
  } catch {
    return null;
  }
  if (!move) return null;
  return {
    uci,
    san: move.san,
  };
}

export function normalizeEngineEvaluation(value) {
  if (!value || typeof value !== "object") return null;
  const unit = value.unit === "mate" ? "mate" : value.unit === "cp" ? "cp" : "";
  const numeric = finite(value.value, -100_000, 100_000);
  if (!unit || numeric === null) return null;
  return {
    unit,
    value: Math.round(numeric),
    perspective: "white",
  };
}

function normalizePv(value, fen, maxItems = MAX_PV_MOVES) {
  const game = gameFromFen(fen);
  if (!game) return { uci: [], san: [] };
  const uci = [];
  const san = [];
  const supplied = Array.isArray(value?.uci)
    ? value.uci.slice(0, maxItems)
    : [];
  for (const rawMove of supplied) {
    const move = text(rawMove, 5).toLowerCase();
    if (!UCI_PATTERN.test(move)) return { uci: [], san: [] };
    let legalMove;
    try {
      legalMove = game.move({
        from: move.slice(0, 2),
        to: move.slice(2, 4),
        promotion: move.length > 4 ? move.slice(4, 5) : undefined,
      });
    } catch {
      return { uci: [], san: [] };
    }
    if (!legalMove) return { uci: [], san: [] };
    uci.push(move);
    san.push(legalMove.san);
  }
  return { uci, san };
}

function normalizeLine(value, fallbackRank, fen) {
  if (!value || typeof value !== "object") return null;
  const pv = normalizePv(value.pv, fen);
  if (pv.uci.length === 0) return null;
  const bestMove = normalizeMove(value.bestMove, fen) || {
    uci: pv.uci[0],
    san: pv.san[0] || "",
  };
  if (bestMove.uci !== pv.uci[0]) return null;
  return {
    rank: Math.max(1, Math.min(MAX_LINES, Number.parseInt(value.rank, 10) || fallbackRank)),
    depth: Math.max(0, Math.min(99, Number.parseInt(value.depth, 10) || 0)),
    evaluation: normalizeEngineEvaluation(value.evaluation),
    bestMove,
    pv,
  };
}

function normalizeMoveReview(value, fen) {
  if (!value || typeof value !== "object") return null;
  const playedMove = normalizeMove(value.playedMove, fen);
  const bestMove = normalizeMove(value.bestMove, fen);
  const pv = normalizePv(value.pv, fen);
  if (!playedMove) return null;
  if (bestMove && pv.uci.length > 0 && bestMove.uci !== pv.uci[0]) return null;
  const classification = text(value.classification, 32);
  const qualityAliases = new Map([
    ["best", "best"],
    ["bester zug", "best"],
    ["excellent", "excellent"],
    ["sehr gut", "excellent"],
    ["good", "good"],
    ["gut", "good"],
    ["inaccuracy", "inaccuracy"],
    ["ungenauigkeit", "inaccuracy"],
    ["mistake", "mistake"],
    ["fehler", "mistake"],
    ["blunder", "blunder"],
    ["patzer", "blunder"],
  ]);
  const resolvedBestMove = bestMove || (
    pv.uci[0] ? { uci: pv.uci[0], san: pv.san[0] || "" } : null
  );
  const requestedQuality =
    qualityAliases.get(text(value.quality || classification, 32).toLowerCase()) || "";
  const topMoveMismatch = resolvedBestMove?.uci !== playedMove.uci;
  const quality = requestedQuality === "best" && topMoveMismatch
    ? "excellent"
    : requestedQuality;
  const classificationQuality =
    qualityAliases.get(classification.toLowerCase()) || "";
  const safeClassification = classificationQuality === "best" && topMoveMismatch
    ? "Sehr gut"
    : classification;
  return {
    playedMove,
    bestMove: resolvedBestMove,
    depth: Math.max(0, Math.min(99, Number.parseInt(value.depth, 10) || 0)),
    evaluationBefore: normalizeEngineEvaluation(value.evaluationBefore),
    evaluationAfter: normalizeEngineEvaluation(value.evaluationAfter),
    evaluationDeltaCp: finite(value.evaluationDeltaCp, -100_000, 100_000),
    classification: safeClassification,
    quality,
    accuracy: finite(value.accuracy, 0, 100),
    lossCp: finite(value.lossCp, 0, 100_000),
    pv,
  };
}

export function normalizeEngineContext(value) {
  if (!value || typeof value !== "object" || value.source !== "stockfish") return null;
  const fen = normalizeFen(value.fen);
  if (!fen && value.kind !== "game_review") return null;
  const kind = ["position", "move_review", "game_review"].includes(value.kind)
    ? value.kind
    : "position";
  const lines = Array.isArray(value.lines)
    ? value.lines
      .slice(0, MAX_LINES)
      .map((line, index) => normalizeLine(line, index + 1, fen))
      .filter(Boolean)
      .sort((left, right) => left.rank - right.rank)
    : [];
  const primary = lines.find((line) => line.rank === 1) || lines[0] || null;
  const suppliedBestMove = normalizeMove(value.bestMove, fen);
  const bestMove = suppliedBestMove || primary?.bestMove || null;
  const primaryVariation = normalizePv(value.primaryVariation, fen);
  const pv = primaryVariation.uci.length > 0
    ? primaryVariation
    : primary?.pv || { uci: [], san: [] };
  const reviewMoments = Array.isArray(value.reviewMoments)
    ? value.reviewMoments
      .slice(0, MAX_REVIEW_MOMENTS)
      .map((moment) => {
        const momentFen = normalizeFen(moment?.fen);
        const review = normalizeMoveReview(moment, momentFen);
        if (!review) return null;
        return {
          label: text(moment?.label, 48),
          fen: momentFen,
          ...review,
        };
      })
      .filter(Boolean)
    : [];

  return {
    version: 1,
    source: "stockfish",
    kind,
    fen,
    depth: Math.max(0, Math.min(99, Number.parseInt(value.depth, 10) || primary?.depth || 0)),
    evaluation: normalizeEngineEvaluation(value.evaluation) || primary?.evaluation || null,
    bestMove,
    primaryVariation: pv,
    lines,
    moveReview: normalizeMoveReview(value.moveReview, fen),
    reviewMoments,
  };
}

export function hasUsableEngineContext(context) {
  const normalized = normalizeEngineContext(context);
  if (!normalized) return false;
  if (normalized.kind === "game_review") {
    return normalized.reviewMoments.some(
      (moment) => (
        moment.pv.uci.length > 0
        && moment.bestMove?.uci === moment.pv.uci[0]
        && moment.evaluationBefore
        && moment.evaluationAfter
      ),
    );
  }
  if (normalized.kind === "move_review") {
    return Boolean(
      normalized.moveReview
      && normalized.moveReview.pv.uci.length > 0
      && normalized.moveReview.bestMove?.uci === normalized.moveReview.pv.uci[0]
      && normalized.moveReview.evaluationBefore
      && normalized.moveReview.evaluationAfter
    );
  }
  return Boolean(
    normalized.bestMove
    && normalized.bestMove.uci === normalized.primaryVariation.uci[0]
    && normalized.primaryVariation.uci.length > 0
    && normalized.evaluation
    && normalized.depth > 0
  );
}

function localizedSanVariants(san) {
  const source = text(san, 24);
  if (!source) return [];
  const variants = new Set([source, source.replace(/[+#]+$/, "")]);
  if (/^O-O(?:-O)?[+#]?$/i.test(source)) {
    const numeric = source.replace(/O/g, "0");
    variants.add(numeric);
    variants.add(numeric.replace(/[+#]+$/, ""));
  }
  const map = { K: "K", Q: "D", R: "T", B: "L", N: "S" };
  if (map[source[0]]) {
    const localized = `${map[source[0]]}${source.slice(1)}`;
    variants.add(localized);
    variants.add(localized.replace(/[+#]+$/, ""));
  }
  return [...variants];
}

export function allowedEngineMoveTokens(context) {
  const normalized = normalizeEngineContext(context);
  const tokens = new Set();
  const addMove = (move) => {
    if (!move) return;
    if (move.uci) tokens.add(move.uci.toLowerCase());
    localizedSanVariants(move.san).forEach((value) => tokens.add(value));
  };
  const addPv = (pv) => {
    pv?.uci?.forEach((value) => tokens.add(value.toLowerCase()));
    pv?.san?.forEach((value) => localizedSanVariants(value).forEach((san) => tokens.add(san)));
  };
  if (!normalized) return tokens;
  addMove(normalized.bestMove);
  addPv(normalized.primaryVariation);
  normalized.lines.forEach((line) => {
    addMove(line.bestMove);
    addPv(line.pv);
  });
  if (normalized.moveReview) {
    addMove(normalized.moveReview.playedMove);
    addMove(normalized.moveReview.bestMove);
    addPv(normalized.moveReview.pv);
  }
  normalized.reviewMoments.forEach((moment) => {
    addMove(moment.playedMove);
    addMove(moment.bestMove);
    addPv(moment.pv);
  });
  return tokens;
}

const MOVE_TOKEN_PATTERN =
  /\b(?:[a-h][1-8][a-h][1-8][qrbn]?|(?:O-O(?:-O)?|0-0(?:-0)?)[+#]?|[KQRBNDTLS][a-h]?[1-8]?x?[a-h][1-8](?:=[QRBNDTLS])?[+#]?|[a-h](?:x[a-h])?[1-8](?:=[QRBNDTLS])?[+#]?)\b/gi;

function normalizedMoveToken(value) {
  return text(value, 24)
    .replace(/[+#]+$/, "")
    .replace(/^0-0-0$/i, "O-O-O")
    .replace(/^0-0$/i, "O-O")
    .toLowerCase();
}

function legalEngineMoveLines(context) {
  const normalized = normalizeEngineContext(context);
  if (!normalized) return [];
  const lines = [];
  const seen = new Set();
  const add = (pv) => {
    const uci = Array.isArray(pv?.uci) ? pv.uci : [];
    const san = Array.isArray(pv?.san) ? pv.san : [];
    if (uci.length === 0 || uci.length !== san.length) return;
    const signature = uci.join(" ");
    if (seen.has(signature)) return;
    seen.add(signature);
    lines.push(uci.map((move, index) => ({
      uci: move,
      san: san[index],
    })));
  };
  add(normalized.primaryVariation);
  normalized.lines.forEach((line) => add(line.pv));
  add(normalized.moveReview?.pv);
  normalized.reviewMoments.forEach((moment) => add(moment.pv));
  return lines;
}

function tokenMatchesLineMove(token, move) {
  const normalized = normalizedMoveToken(token);
  if (!normalized) return false;
  if (normalizedMoveToken(move?.uci) === normalized) return true;
  return localizedSanVariants(move?.san)
    .some((alias) => normalizedMoveToken(alias) === normalized);
}

function notationOnlySeparator(value) {
  return value
    .replace(/\d+\.(?:\.\.)?/g, "")
    .replace(/[\s,;:()[\]{}\-–—→>]+/g, "") === "";
}

function unsupportedNotationSequences(reply, matches, context) {
  if (matches.length < 2) return [];
  const clusters = [];
  let current = [matches[0]];
  for (let index = 1; index < matches.length; index += 1) {
    const previous = matches[index - 1];
    const next = matches[index];
    const between = reply.slice(
      previous.index + previous[0].length,
      next.index,
    );
    if (notationOnlySeparator(between)) {
      current.push(next);
    } else {
      if (current.length > 1) clusters.push(current);
      current = [next];
    }
  }
  if (current.length > 1) clusters.push(current);
  if (clusters.length === 0) return [];

  const legalLines = legalEngineMoveLines(context);
  return clusters
    .filter((cluster) => !legalLines.some((line) => (
      line.some((_, start) => (
        start + cluster.length <= line.length
        && cluster.every((match, offset) => (
          tokenMatchesLineMove(match[0], line[start + offset])
        ))
      ))
    )))
    .map((cluster) => cluster.map((match) => match[0]).join(" "));
}

export function findUnsupportedMoveTokens(reply, context, openingContext = null) {
  if (typeof reply !== "string") return [];
  const allowed = allowedEngineMoveTokens(context);
  let checkedReply = reply;
  if (openingContext?.matched === true) {
    [openingContext.sourceName, openingContext.displayName]
      .filter((name) => typeof name === "string" && name.trim())
      .forEach((name) => {
        checkedReply = checkedReply.split(name.trim()).join("");
      });
  }
  if (openingContext?.suggestedOpening?.matched === true) {
    [
      openingContext.suggestedOpening.sourceName,
      openingContext.suggestedOpening.displayName,
    ]
      .filter((name) => typeof name === "string" && name.trim())
      .forEach((name) => {
        checkedReply = checkedReply.split(name.trim()).join("");
      });
  }
  const matches = [...checkedReply.matchAll(MOVE_TOKEN_PATTERN)];
  const unsupportedTokens = matches
    .map((match) => match[0])
    .filter((token) => !allowed.has(token) && !allowed.has(token.toLowerCase()));
  const unsupportedSequences = unsupportedNotationSequences(
    checkedReply,
    matches,
    context,
  );
  return [...new Set([...unsupportedTokens, ...unsupportedSequences])];
}

function engineEvaluations(context) {
  const normalized = normalizeEngineContext(context);
  if (!normalized) return [];
  const values = [];
  const add = (evaluation) => {
    if (evaluation) values.push(evaluation);
  };
  add(normalized.evaluation);
  normalized.lines.forEach((line) => add(line.evaluation));
  if (normalized.moveReview) {
    add(normalized.moveReview.evaluationBefore);
    add(normalized.moveReview.evaluationAfter);
  }
  normalized.reviewMoments.forEach((moment) => {
    add(moment.evaluationBefore);
    add(moment.evaluationAfter);
  });
  return values;
}

export function findUnsupportedEvaluationTokens(reply, context) {
  if (typeof reply !== "string") return [];
  const allowed = new Set();
  engineEvaluations(context).forEach((evaluation) => {
    if (evaluation.unit === "mate") {
      const distance = Math.abs(evaluation.value);
      allowed.add(`matt in ${distance}`);
      allowed.add(`m${distance}`);
      allowed.add(`${evaluation.value >= 0 ? "+" : "-"}m${distance}`);
      return;
    }
    const pawns = evaluation.value / 100;
    const signed = `${pawns >= 0 ? "+" : ""}${pawns.toFixed(2)}`;
    allowed.add(signed);
    allowed.add(signed.replace(".", ","));
    const absolute = Math.abs(pawns).toFixed(2);
    allowed.add(absolute);
    allowed.add(absolute.replace(".", ","));
  });
  const signedOrMate = [
    ...reply.matchAll(/[+-]\s?\d+(?:[.,]\d+)?|(?:Matt in|M)\s?\d+/gi),
  ].map((match) => match[0].replace(/\s+/g, " ").trim());
  const contextualDecimals = [
    ...reply.matchAll(
      /\b(?:bewertung|evaluation|vorteil|nachteil|bauern(?:einheiten)?)\D{0,24}([+-]?\d+(?:[.,]\d+)?)|([+-]?\d+(?:[.,]\d+)?)\s*(?:bauern(?:einheiten)?|bewertung|evaluation|vorteil|nachteil)\b/gi,
    ),
  ].map((match) => (match[1] || match[2] || "").replace(/\s+/g, "").trim());
  const signedNumericMagnitudes = new Set(
    signedOrMate
      .filter((token) => /^[+-]/.test(token))
      .map((token) => token.replace(/^[+-]\s*/, "")),
  );
  const found = [
    ...signedOrMate,
    ...contextualDecimals.filter(
      (token) => !signedNumericMagnitudes.has(token.replace(/^[+-]\s*/, "")),
    ),
  ];
  const canonical = (token) => token.toLowerCase().replace(/\s+/g, "");
  const canonicalAllowed = new Set([...allowed].map(canonical));
  return [...new Set(
    found.filter((token) => !canonicalAllowed.has(canonical(token))),
  )];
}

export const ENGINE_CONTEXT_MISSING_REPLY =
  "Die Analyse ist noch nicht vollständig. Deshalb zeige ich lieber noch keinen konkreten Zug.";

export const ENGINE_CONTEXT_REJECTED_REPLY =
  "Die Erklärung war nicht sicher genug belegt. Deshalb zeige ich lieber keinen zusätzlichen Zug.";
