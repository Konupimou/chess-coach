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

function normalizeMove(value) {
  if (!value || typeof value !== "object") return null;
  const uci = text(value.uci, 5).toLowerCase();
  const san = text(value.san, 24);
  if (!UCI_PATTERN.test(uci) && !san) return null;
  return {
    uci: UCI_PATTERN.test(uci) ? uci : "",
    san,
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

function normalizePv(value, maxItems = MAX_PV_MOVES) {
  const uci = [];
  if (Array.isArray(value?.uci)) {
    for (const rawMove of value.uci.slice(0, maxItems)) {
      const move = text(rawMove, 5).toLowerCase();
      if (!UCI_PATTERN.test(move)) break;
      uci.push(move);
    }
  }
  const san = Array.isArray(value?.san)
    ? value.san
      .slice(0, uci.length || maxItems)
      .map((move) => text(move, 24))
      .filter(Boolean)
    : [];
  return { uci, san };
}

function normalizeLine(value, fallbackRank) {
  if (!value || typeof value !== "object") return null;
  const pv = normalizePv(value.pv);
  if (pv.uci.length === 0) return null;
  const bestMove = normalizeMove(value.bestMove) || {
    uci: pv.uci[0],
    san: pv.san[0] || "",
  };
  return {
    rank: Math.max(1, Math.min(MAX_LINES, Number.parseInt(value.rank, 10) || fallbackRank)),
    depth: Math.max(0, Math.min(99, Number.parseInt(value.depth, 10) || 0)),
    evaluation: normalizeEngineEvaluation(value.evaluation),
    bestMove,
    pv,
  };
}

function normalizeMoveReview(value) {
  if (!value || typeof value !== "object") return null;
  const playedMove = normalizeMove(value.playedMove);
  const bestMove = normalizeMove(value.bestMove);
  const pv = normalizePv(value.pv);
  if (!playedMove && !bestMove && pv.uci.length === 0) return null;
  return {
    playedMove,
    bestMove: bestMove || (pv.uci[0] ? { uci: pv.uci[0], san: pv.san[0] || "" } : null),
    depth: Math.max(0, Math.min(99, Number.parseInt(value.depth, 10) || 0)),
    evaluationBefore: normalizeEngineEvaluation(value.evaluationBefore),
    evaluationAfter: normalizeEngineEvaluation(value.evaluationAfter),
    evaluationDeltaCp: finite(value.evaluationDeltaCp, -100_000, 100_000),
    classification: text(value.classification, 32),
    pv,
  };
}

export function normalizeEngineContext(value) {
  if (!value || typeof value !== "object" || value.source !== "stockfish") return null;
  const kind = ["position", "move_review", "game_review"].includes(value.kind)
    ? value.kind
    : "position";
  const lines = Array.isArray(value.lines)
    ? value.lines
      .slice(0, MAX_LINES)
      .map((line, index) => normalizeLine(line, index + 1))
      .filter(Boolean)
      .sort((left, right) => left.rank - right.rank)
    : [];
  const primary = lines.find((line) => line.rank === 1) || lines[0] || null;
  const suppliedBestMove = normalizeMove(value.bestMove);
  const bestMove = suppliedBestMove || primary?.bestMove || null;
  const primaryVariation = normalizePv(value.primaryVariation);
  const pv = primaryVariation.uci.length > 0
    ? primaryVariation
    : primary?.pv || { uci: [], san: [] };
  const reviewMoments = Array.isArray(value.reviewMoments)
    ? value.reviewMoments
      .slice(0, MAX_REVIEW_MOMENTS)
      .map((moment) => {
        const review = normalizeMoveReview(moment);
        if (!review) return null;
        return {
          label: text(moment?.label, 48),
          fen: text(moment?.fen, 100),
          ...review,
        };
      })
      .filter(Boolean)
    : [];

  return {
    version: 1,
    source: "stockfish",
    kind,
    fen: text(value.fen, 100),
    depth: Math.max(0, Math.min(99, Number.parseInt(value.depth, 10) || primary?.depth || 0)),
    evaluation: normalizeEngineEvaluation(value.evaluation) || primary?.evaluation || null,
    bestMove,
    primaryVariation: pv,
    lines,
    moveReview: normalizeMoveReview(value.moveReview),
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
  /\b(?:[a-h][1-8][a-h][1-8][qrbn]?|O-O(?:-O)?[+#]?|[KQRBNDTLS][a-h]?[1-8]?x?[a-h][1-8](?:=[QRBNDTLS])?[+#]?|[a-h](?:x[a-h])?[1-8](?:=[QRBNDTLS])?[+#]?)\b/gi;

export function findUnsupportedMoveTokens(reply, context) {
  if (typeof reply !== "string") return [];
  const allowed = allowedEngineMoveTokens(context);
  return [...new Set(
    [...reply.matchAll(MOVE_TOKEN_PATTERN)]
      .map((match) => match[0])
      .filter((token) => !allowed.has(token) && !allowed.has(token.toLowerCase())),
  )];
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
  });
  const found = [
    ...reply.matchAll(/[+-]\s?\d+(?:[.,]\d+)?|(?:Matt in|M)\s?\d+/gi),
  ].map((match) => match[0].replace(/\s+/g, " ").trim());
  return [...new Set(found.filter((token) => !allowed.has(token.toLowerCase())))];
}

export const ENGINE_CONTEXT_MISSING_REPLY =
  "Für diese Stellung liegt derzeit keine vollständige Stockfish-Analyse vor. Deshalb gebe ich bewusst keine konkrete Zugempfehlung.";

export const ENGINE_CONTEXT_REJECTED_REPLY =
  "Die Coach-Erklärung wurde verworfen, weil sie nicht vollständig durch die vorliegenden Stockfish-Daten belegt war. Es wird bewusst keine alternative Zugempfehlung ergänzt.";
