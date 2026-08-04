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
    perspective: value.perspective === "player" ? "player" : "white",
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
    ["brilliant", "brilliant"],
    ["brillant", "brilliant"],
    ["great", "excellent"],
    ["großartig", "excellent"],
    ["book", "book"],
    ["buchzug", "book"],
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
    ["miss", "mistake"],
    ["verpasste chance", "mistake"],
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
  const safeClassification = topMoveMismatch && classificationQuality === "best"
    ? "Sehr gut"
    : classificationQuality === "excellent" && ["great", "großartig"].includes(classification.toLowerCase())
      ? "Sehr gut"
      : classificationQuality === "mistake" && ["miss", "verpasste chance"].includes(classification.toLowerCase())
        ? "Fehler"
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
    onlyMove: value.onlyMove === true,
    onlyMoveEvidence: value.onlyMoveEvidence && typeof value.onlyMoveEvidence === "object"
      ? value.onlyMoveEvidence
      : null,
    moveNecessity: value.moveNecessity && typeof value.moveNecessity === "object"
      ? value.moveNecessity
      : null,
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
  const playedLine = normalizePv(
    value.playedLine
      ? { uci: value.playedLine.uci || value.playedLine.pvUci || [] }
      : null,
    fen,
  );
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
    playedLine: playedLine.uci.length > 0
      ? {
        evaluation: normalizeEngineEvaluation(value.playedLine?.evaluation),
        ...playedLine,
      }
      : null,
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
  const localized = `${map[source[0]] || source[0]}${source.slice(1)}`
    .replace(/=([QRBN])/gu, (_, piece) => `=${map[piece] || piece}`);
  if (localized !== source) {
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
  addPv(normalized.playedLine);
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
  add(normalized.playedLine);
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
  const openingMoves = Array.isArray(openingContext?.continuations)
    ? openingContext.continuations
    : [];
  openingMoves.forEach((move) => {
    if (typeof move?.uci === "string") allowed.add(move.uci.toLowerCase());
    localizedSanVariants(move?.san).forEach((value) => allowed.add(value));
  });
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
  // Markdown emphasis changes only presentation. Removing it here keeps a
  // bold square such as **d4** from being mistaken for an unsupported pawn move.
  checkedReply = checkedReply.replace(/[*_`]+/gu, "");
  const matches = [...checkedReply.matchAll(MOVE_TOKEN_PATTERN)].filter((match) => {
    if (!/^[a-h][1-8]$/i.test(match[0])) return true;
    const before = checkedReply.slice(Math.max(0, match.index - 42), match.index);
    const after = checkedReply.slice(
      match.index + match[0].length,
      match.index + match[0].length + 42,
    );
    const listedSquare = (
      /(?:feld(?:er|es)?|quadrat(?:e)?|auf|kontrolliert|besetzt|deckt|greift)[^.!?]{0,24}\b[a-h][1-8]\s*(?:,|und|oder)\s*$/iu
        .test(before)
    );
    return !(
      /(?:feld(?:es)?|quadrat|auf|von|nach|bis|über|kontrolliert(?:\s+(?:neu|zusätzlich|direkt|auch))?|besetzt|deckt|greift|bauer(?:n|ns)?|springer|läufer|turm|dame|könig)\s+$/iu
        .test(before)
      || listedSquare
      || /^\s*(?:-|als feld|wird kontrolliert|ist besetzt)/iu.test(after)
      || /^\s*(?:-|‑|–)\s*(?:Bauer|Bauern|Springer|Läufer|Turm|Dame|König)\b/iu
        .test(after)
      || /^(?:\s*(?:,|und|oder|sowie)\s*[a-h][1-8]){0,3}\s*(?:kontrolliert|beherrscht|angegriffen|gedeckt|besetzt)\b/iu
        .test(after)
    );
  });
  const unsupportedTokens = matches
    .map((match) => match[0])
    .filter((token) => !allowed.has(token) && !allowed.has(token.toLowerCase()));
  const unsupportedSequences = openingMoves.length > 0
    ? []
    : unsupportedNotationSequences(checkedReply, matches, context);
  return [...new Set([...unsupportedTokens, ...unsupportedSequences])];
}

const GERMAN_PIECE_TYPES = Object.freeze({
  bauer: "p",
  bauern: "p",
  springer: "n",
  läufer: "b",
  turm: "r",
  türme: "r",
  dame: "q",
  damen: "q",
  könig: "k",
  könige: "k",
});

const INITIAL_PIECE_COUNTS = Object.freeze({
  p: 8,
  n: 2,
  b: 2,
  r: 2,
  q: 1,
  k: 1,
});

const BOARD_PIECE_VALUES = Object.freeze({
  p: 1,
  n: 3,
  b: 3,
  r: 5,
  q: 9,
  k: 100,
});

const germanPieceType = (value) => (
  GERMAN_PIECE_TYPES[String(value || "").toLocaleLowerCase("de-DE")] || ""
);

function addContextLinePositions(timeline, fen, moves) {
  const game = gameFromFen(fen);
  if (!game) return;
  const captures = [];
  const lineEntries = [];
  for (const uci of Array.isArray(moves) ? moves : []) {
    let move;
    try {
      move = game.move({
        from: uci.slice(0, 2),
        to: uci.slice(2, 4),
        promotion: uci[4],
      });
    } catch {
      break;
    }
    if (!move) break;
    const tokens = new Set([uci.toLowerCase()]);
    localizedSanVariants(move.san).forEach((value) => (
      tokens.add(value.toLocaleLowerCase("de-DE"))
    ));
    if (move.captured) {
      const captureSquare = move.flags?.includes("e")
        ? `${move.to[0]}${move.from[1]}`
        : move.to;
      captures.push({
        piece: move.captured,
        color: move.color === "w" ? "b" : "w",
        square: captureSquare,
        by: move.color,
      });
    }
    lineEntries.push({
      fen: game.fen(),
      tokens: [...tokens],
      move: {
        color: move.color,
        piece: move.piece,
        from: move.from,
        to: move.to,
        promotion: move.promotion || "",
        flags: move.flags || "",
      },
      captures: captures.map((capture) => ({ ...capture })),
    });
  }
  const lineCaptures = captures.map((capture) => ({ ...capture }));
  lineEntries.forEach((entry) => timeline.afterMoves.push({
    ...entry,
    lineCaptures,
  }));
}

function contextPositionTimeline(context) {
  const normalized = normalizeEngineContext(context);
  if (!normalized) return { current: [], afterMoves: [], perspectiveColor: "" };
  const timeline = { current: new Set(), afterMoves: [] };
  if (normalized.fen) {
    timeline.current.add(normalized.fen);
    addContextLinePositions(timeline, normalized.fen, normalized.primaryVariation?.uci);
    normalized.lines.forEach((line) => (
      addContextLinePositions(timeline, normalized.fen, line?.pv?.uci)
    ));
    addContextLinePositions(timeline, normalized.fen, normalized.playedLine?.uci);
    if (normalized.kind === "move_review" && normalized.moveReview?.playedMove?.uci) {
      addContextLinePositions(
        timeline,
        normalized.fen,
        [normalized.moveReview.playedMove.uci],
      );
    }
  }
  normalized.reviewMoments.forEach((moment) => {
    timeline.current.add(moment.fen);
    addContextLinePositions(timeline, moment.fen, moment.pv?.uci);
    addContextLinePositions(timeline, moment.fen, [moment.playedMove?.uci]);
  });
  const seen = new Set();
  return {
    current: [...timeline.current],
    perspectiveColor: normalized.kind === "move_review"
      ? gameFromFen(normalized.fen)?.turn() || ""
      : "",
    afterMoves: timeline.afterMoves.filter((entry) => {
      const key = `${entry.fen}|${entry.tokens.join(",")}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    }),
  };
}

function explicitPositionsForBoardClaim(sentence, timeline) {
  const normalized = String(sentence || "")
    .replace(/\*+/g, "")
    .trim()
    .toLocaleLowerCase("de-DE");
  return timeline.afterMoves.filter((entry) => (
    entry.tokens.some((token) => {
      const escaped = token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      return new RegExp(
        `(?:^(?:(?:stärkste antwort|typische antwort|alternative|konkrete folge|der unterschied|besser|genauer|genauso gut|weitere möglichkeit|einziger haltender zug):\\s*){0,2}${escaped}(?=\\s|[,.:;!?]|$)|\\b(?:nach|mit|durch)\\s+(?:\\d+\\.{1,3}\\s*)?${escaped}(?=\\s|[,.:;!?]|$)|^\\d+\\.{1,3}\\s*${escaped}(?=\\s|[,.:;!?]|$))`,
        "iu",
      ).test(normalized);
    })
  ));
}

function positionsForBoardClaim(sentence, timeline) {
  const explicit = explicitPositionsForBoardClaim(sentence, timeline);
  return explicit.length > 0
    ? [...new Set(explicit.map((entry) => entry.fen))]
    : timeline.current;
}

function pieceMatches(game, square, expectedType) {
  const piece = game.get(square);
  return Boolean(piece && (!expectedType || piece.type === expectedType));
}

function supportsAttackClaim(fen, sourceType, from, targetType, to) {
  const game = gameFromFen(fen);
  const source = game?.get(from);
  const target = game?.get(to);
  if (!game || !source || source.type !== sourceType) return false;
  if (targetType && (!target || target.type !== targetType)) return false;
  if (target && target.color === source.color) return false;
  if (!game.attackers(to, source.color).includes(from)) return false;
  if (!target || target.type === "k") return true;

  const fields = game.fen().split(/\s+/);
  fields[1] = source.color;
  const sourceTurnGame = gameFromFen(fields.join(" "));
  if (!sourceTurnGame) return false;
  return sourceTurnGame.moves({ square: from, verbose: true })
    .some((move) => move.to === to && Boolean(move.captured));
}

function supportsAttackWithoutSource(fen, sourceType, targetType, to, sourceColor = "") {
  const game = gameFromFen(fen);
  const target = game?.get(to);
  if (!game) return false;
  if (targetType && (!target || target.type !== targetType)) return false;
  return ["w", "b"].some((color) => (
    (!sourceColor || color === sourceColor)
    &&
    (!target || target.color !== color)
    && game.attackers(to, color).some((from) => (
      game.get(from)?.type === sourceType
      && supportsAttackClaim(fen, sourceType, from, targetType, to)
    ))
  ));
}

function supportsControlClaim(
  fen,
  sourceType,
  from,
  to,
  sourceColor = "",
  targetType = "",
) {
  const game = gameFromFen(fen);
  const source = game?.get(from);
  const target = game?.get(to);
  return Boolean(
    game
    && source
    && source.type === sourceType
    && (!targetType || target?.type === targetType)
    && (!sourceColor || source.color === sourceColor)
    && game.attackers(to, source.color).includes(from),
  );
}

function supportsControlWithoutSource(
  fen,
  sourceType,
  to,
  sourceColor = "",
  targetType = "",
) {
  const game = gameFromFen(fen);
  if (!game) return false;
  return ["w", "b"].some((color) => (
    (!sourceColor || color === sourceColor)
    && game.attackers(to, color).some((from) => (
      game.get(from)?.type === sourceType
      && supportsControlClaim(fen, sourceType, from, to, color, targetType)
    ))
  ));
}

function supportsUndefendedClaim(fen, pieceType, square) {
  const game = gameFromFen(fen);
  const piece = game?.get(square);
  if (!game || !piece || piece.type !== pieceType) return false;
  return game.attackers(square, piece.color).length === 0;
}

function boardPieces(game) {
  return game.board().flatMap((rank) => rank.filter(Boolean));
}

function pieceCount(game, color, type) {
  return boardPieces(game).filter((piece) => (
    piece.color === color && piece.type === type
  )).length;
}

function explicitClaimColor(sentence) {
  const matches = [
    { color: "w", match: /(?<!\p{L})wei(?:ß|ss)(?:e[nrms]?)?(?!\p{L})/iu.exec(sentence) },
    { color: "b", match: /(?<!\p{L})schwarz(?:e[nrms]?)?(?!\p{L})/iu.exec(sentence) },
  ].filter((entry) => entry.match).sort((left, right) => (
    left.match.index - right.match.index
  ));
  return matches[0]?.color || "";
}

const hasPersonalPerspective = (sentence) => (
  /\b(?:du|dein(?:e[nrms]?)?|dir|dich)\b/iu.test(sentence)
);

function claimColor(sentence, timeline) {
  const explicit = explicitClaimColor(sentence);
  if (explicit) return explicit;
  return hasPersonalPerspective(sentence) ? timeline.perspectiveColor || "" : "";
}

function captureSupportsClaim(entry, pieceType, color, square = "") {
  return (entry?.captures || []).some((capture) => (
    (!pieceType || capture.piece === pieceType)
    && (!color || capture.color === color)
    && (!square || capture.square === square)
  ));
}

function lineSupportsNetMaterialGain(
  entry,
  color,
  claimedType = "",
  genericFigure = false,
) {
  if (!entry || !["w", "b"].includes(color)) return false;
  const captures = Array.isArray(entry.lineCaptures)
    ? entry.lineCaptures
    : entry.captures || [];
  const relevantCapture = captures.some((capture) => (
    capture.by === color
    && (!claimedType || capture.piece === claimedType)
    && (!genericFigure || ["n", "b", "r", "q"].includes(capture.piece))
  ));
  if (!relevantCapture) return false;
  const netValue = captures.reduce((sum, capture) => {
    const value = BOARD_PIECE_VALUES[capture.piece] || 0;
    if (capture.by === color) return sum + value;
    if (capture.color === color) return sum - value;
    return sum;
  }, 0);
  const requiredValue = claimedType
    ? BOARD_PIECE_VALUES[claimedType] || 1
    : genericFigure
      ? 3
      : 1;
  return netValue >= requiredValue;
}

function supportsMissingPieceClaim(fen, pieceType, color = "", requireNone = false) {
  const game = gameFromFen(fen);
  const initial = INITIAL_PIECE_COUNTS[pieceType];
  if (!game || !initial) return false;
  const supportsColor = (candidate) => (
    requireNone
      ? pieceCount(game, candidate, pieceType) === 0
      : pieceCount(game, candidate, pieceType) < initial
  );
  if (color) return supportsColor(color);
  return ["w", "b"].some((candidate) => (
    supportsColor(candidate)
  ));
}

function supportsMaterialDeficitClaim(fen, pieceType, color) {
  const game = gameFromFen(fen);
  if (!game || !color) return false;
  const opponent = color === "w" ? "b" : "w";
  return pieceCount(game, color, pieceType) < pieceCount(game, opponent, pieceType);
}

function supportsHangingClaim(fen, pieceType, square = "") {
  const game = gameFromFen(fen);
  if (!game) return false;
  const candidates = game.board().flatMap((rank) => rank.filter((piece) => (
    piece && piece.type === pieceType && (!square || piece.square === square)
  )));
  return candidates.some((piece) => {
    const opponent = piece.color === "w" ? "b" : "w";
    if (game.attackers(piece.square, piece.color).length > 0) return false;
    return game.attackers(piece.square, opponent).some((from) => (
      supportsAttackClaim(fen, game.get(from)?.type, from, piece.type, piece.square)
    ));
  });
}

function legalAttackedTargets(fen, source) {
  const game = gameFromFen(fen);
  if (!game || !source) return [];
  return game.board().flatMap((rank) => rank.filter((target) => (
    target
    && target.color !== source.color
    && supportsAttackClaim(
      fen,
      source.type,
      source.square,
      target.type,
      target.square,
    )
  )));
}

function multisetContainsTypes(targets, expectedTypes) {
  const available = targets.map((target) => target.type);
  return expectedTypes.every((type) => {
    const index = available.indexOf(type);
    if (index < 0) return false;
    available.splice(index, 1);
    return true;
  });
}

function supportsForkClaim(
  fen,
  { sourceType = "", sourceSquare = "", targetTypes = [] } = {},
) {
  const game = gameFromFen(fen);
  if (!game) return false;
  const sources = game.board().flatMap((rank) => rank.filter((piece) => (
    piece
    && piece.type !== "k"
    && (!sourceType || piece.type === sourceType)
    && (!sourceSquare || piece.square === sourceSquare)
  )));
  return sources.some((source) => {
    const targets = legalAttackedTargets(fen, source);
    const meaningfulTargets = targetTypes.length > 0
      ? targets
      : targets.filter((target) => target.type !== "p");
    return meaningfulTargets.length >= 2
      && multisetContainsTypes(meaningfulTargets, targetTypes);
  });
}

const rayStep = (square, fileStep, rankStep, distance) => {
  const file = square.charCodeAt(0) - 97 + (fileStep * distance);
  const rank = Number.parseInt(square[1], 10) + (rankStep * distance);
  if (file < 0 || file > 7 || rank < 1 || rank > 8) return "";
  return `${String.fromCharCode(97 + file)}${rank}`;
};

function pinsInPosition(fen) {
  const game = gameFromFen(fen);
  if (!game) return [];
  const diagonal = [[1, 1], [1, -1], [-1, 1], [-1, -1]];
  const straight = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  const pins = [];
  for (const attacker of boardPieces(game).filter((piece) => (
    ["b", "r", "q"].includes(piece.type)
  ))) {
    const directions = attacker.type === "b"
      ? diagonal
      : attacker.type === "r"
        ? straight
        : [...diagonal, ...straight];
    for (const [fileStep, rankStep] of directions) {
      const encountered = [];
      for (let distance = 1; distance < 8; distance += 1) {
        const square = rayStep(attacker.square, fileStep, rankStep, distance);
        if (!square) break;
        const piece = game.get(square);
        if (piece) encountered.push({ ...piece, square });
        if (encountered.length >= 2) break;
      }
      const [pinned, target] = encountered;
      if (
        !pinned
        || !target
        || pinned.color === attacker.color
        || target.color !== pinned.color
        || BOARD_PIECE_VALUES[target.type] <= BOARD_PIECE_VALUES[pinned.type]
        || !supportsAttackClaim(
          fen,
          attacker.type,
          attacker.square,
          pinned.type,
          pinned.square,
        )
      ) continue;
      pins.push({ attacker, pinned, target });
    }
  }
  return pins;
}

function supportsPinClaim(
  fen,
  { pinnedType = "", pinnedSquare = "", attackerType = "", attackerSquare = "" } = {},
) {
  return pinsInPosition(fen).some((pin) => (
    (!pinnedType || pin.pinned.type === pinnedType)
    && (!pinnedSquare || pin.pinned.square === pinnedSquare)
    && (!attackerType || pin.attacker.type === attackerType)
    && (!attackerSquare || pin.attacker.square === attackerSquare)
  ));
}

function gameForTurn(fen, color) {
  const game = gameFromFen(fen);
  if (!game || !["w", "b"].includes(color)) return null;
  const fields = game.fen().split(/\s+/);
  fields[1] = color;
  return gameFromFen(fields.join(" "));
}

function supportsCheckClaim(fen, color = "", square = "", mate = false) {
  const game = gameFromFen(fen);
  if (!game) return false;
  const squarePiece = square ? game.get(square) : null;
  if (square && squarePiece?.type !== "k") return false;
  const candidates = squarePiece
    ? [squarePiece.color]
    : color
      ? [color]
      : [game.turn()];
  return candidates.some((candidate) => {
    if (color && candidate !== color) return false;
    const turnGame = gameForTurn(fen, candidate);
    return mate ? turnGame?.isCheckmate() === true : turnGame?.isCheck() === true;
  });
}

function supportsPassedPawnClaim(fen, color = "", square = "") {
  const game = gameFromFen(fen);
  if (!game) return false;
  const candidates = boardPieces(game).filter((piece) => (
    piece.type === "p"
    && (!color || piece.color === color)
    && (!square || piece.square === square)
  ));
  return candidates.some((pawn) => {
    const file = pawn.square.charCodeAt(0) - 97;
    const rank = Number.parseInt(pawn.square[1], 10);
    return !boardPieces(game).some((other) => {
      if (other.type !== "p" || other.color === pawn.color) return false;
      const otherFile = other.square.charCodeAt(0) - 97;
      const otherRank = Number.parseInt(other.square[1], 10);
      return Math.abs(otherFile - file) <= 1
        && (pawn.color === "w" ? otherRank > rank : otherRank < rank);
    });
  });
}

function supportsDoubledPawnClaim(fen, color = "", file = "") {
  const game = gameFromFen(fen);
  if (!game) return false;
  return ["w", "b"].some((candidate) => {
    if (color && candidate !== color) return false;
    const counts = new Map();
    boardPieces(game)
      .filter((piece) => piece.type === "p" && piece.color === candidate)
      .forEach((pawn) => counts.set(
        pawn.square[0],
        (counts.get(pawn.square[0]) || 0) + 1,
      ));
    return file ? (counts.get(file) || 0) >= 2 : [...counts.values()].some((count) => count >= 2);
  });
}

function supportsIsolatedPawnClaim(fen, color = "", square = "") {
  const game = gameFromFen(fen);
  if (!game) return false;
  const pawns = boardPieces(game).filter((piece) => (
    piece.type === "p"
    && (!color || piece.color === color)
    && (!square || piece.square === square)
  ));
  return pawns.some((pawn) => {
    const file = pawn.square.charCodeAt(0) - 97;
    return !boardPieces(game).some((other) => (
      other.type === "p"
      && other.color === pawn.color
      && Math.abs(other.square.charCodeAt(0) - 97 - file) === 1
    ));
  });
}

function supportsPawnMajorityClaim(fen, color = "", wing = "") {
  const game = gameFromFen(fen);
  if (!game || !color || !["queenside", "kingside"].includes(wing)) return false;
  const opponent = color === "w" ? "b" : "w";
  const files = wing === "queenside"
    ? new Set(["a", "b", "c", "d"])
    : new Set(["e", "f", "g", "h"]);
  const count = (candidate) => boardPieces(game).filter((piece) => (
    piece.type === "p"
    && piece.color === candidate
    && files.has(piece.square[0])
  )).length;
  return count(color) > count(opponent);
}

function kingRingSquares(square) {
  const result = [];
  for (const fileStep of [-1, 0, 1]) {
    for (const rankStep of [-1, 0, 1]) {
      if (fileStep === 0 && rankStep === 0) continue;
      const target = rayStep(square, fileStep, rankStep, 1);
      if (target) result.push(target);
    }
  }
  return result;
}

function supportsKingSafetyClaim(fen, color = "", square = "", expected = "safe") {
  const game = gameFromFen(fen);
  if (!game) return false;
  const kings = boardPieces(game).filter((piece) => (
    piece.type === "k"
    && (!color || piece.color === color)
    && (!square || piece.square === square)
  ));
  return kings.some((king) => {
    const opponent = king.color === "w" ? "b" : "w";
    const direction = king.color === "w" ? 1 : -1;
    const shieldSquares = [-1, 0, 1]
      .map((fileStep) => rayStep(king.square, fileStep, direction, 1))
      .filter(Boolean);
    const shield = shieldSquares.filter((target) => {
      const piece = game.get(target);
      return piece?.type === "p" && piece.color === king.color;
    }).length;
    const directAttack = game.attackers(king.square, opponent).length > 0;
    const attackedRing = kingRingSquares(king.square).filter((target) => (
      game.attackers(target, opponent).length > 0
    )).length;
    const safe = !directAttack && shield >= 2 && attackedRing <= 1;
    const unsafe = directAttack || (shield === 0 && attackedRing >= 2);
    return expected === "unsafe" ? unsafe : safe;
  });
}

function supportsKingInCenterClaim(fen, color = "", square = "") {
  const game = gameFromFen(fen);
  if (!game) return false;
  return boardPieces(game).some((piece) => (
    piece.type === "k"
    && ["d", "e"].includes(piece.square[0])
    && (!color || piece.color === color)
    && (!square || piece.square === square)
  ));
}

const CENTER_SQUARES = Object.freeze(["d4", "e4", "d5", "e5"]);

function centerControlCount(game, color) {
  return CENTER_SQUARES.filter((square) => (
    game.get(square)?.color === color
    || game.attackers(square, color).length > 0
  )).length;
}

function supportsCenterControlClaim(fen, color = "", requireDominance = false) {
  const game = gameFromFen(fen);
  if (!game || !color) return false;
  const opponent = color === "w" ? "b" : "w";
  const ownControl = centerControlCount(game, color);
  const opponentControl = centerControlCount(game, opponent);
  return ownControl >= 3 && (!requireDominance || ownControl > opponentControl);
}

function supportsOpenFileClaim(fen, file = "") {
  const game = gameFromFen(fen);
  if (!game || !/^[a-h]$/u.test(file)) return false;
  return !boardPieces(game).some((piece) => (
    piece.type === "p" && piece.square[0] === file
  ));
}

function supportsOutpostClaim(fen, color = "", pieceType = "", square = "") {
  const game = gameFromFen(fen);
  if (!game) return false;
  const pieces = boardPieces(game).filter((piece) => (
    piece.type !== "p"
    && piece.type !== "k"
    && (!color || piece.color === color)
    && (!pieceType || piece.type === pieceType)
    && (!square || piece.square === square)
  ));
  return pieces.some((piece) => {
    const rank = Number.parseInt(piece.square[1], 10);
    const advanced = piece.color === "w" ? rank >= 5 : rank <= 4;
    if (!advanced) return false;
    const protectedByPawn = game.attackers(piece.square, piece.color).some((from) => (
      game.get(from)?.type === "p"
    ));
    if (!protectedByPawn) return false;
    const opponent = piece.color === "w" ? "b" : "w";
    const file = piece.square.charCodeAt(0) - 97;
    const canBeChasedByPawn = boardPieces(game).some((pawn) => {
      if (pawn.type !== "p" || pawn.color !== opponent) return false;
      const pawnFile = pawn.square.charCodeAt(0) - 97;
      if (Math.abs(pawnFile - file) !== 1) return false;
      const pawnRank = Number.parseInt(pawn.square[1], 10);
      return piece.color === "w" ? pawnRank > rank : pawnRank < rank;
    });
    return !canBeChasedByPawn;
  });
}

function supportsCastlingClaim(fen, color = "", side = "") {
  const game = gameFromFen(fen);
  if (!game) return false;
  return ["w", "b"].some((candidate) => {
    if (color && candidate !== color) return false;
    const turnGame = gameForTurn(fen, candidate);
    const king = boardPieces(turnGame || game).find((piece) => (
      piece.type === "k" && piece.color === candidate
    ));
    if (!turnGame || !king) return false;
    return turnGame.moves({ square: king.square, verbose: true }).some((move) => (
      side === "short"
        ? move.flags?.includes("k")
        : side === "long"
          ? move.flags?.includes("q")
          : move.flags?.includes("k") || move.flags?.includes("q")
    ));
  });
}

function promotionSupportsClaim(entry, color = "", from = "", promotedType = "") {
  const move = entry?.move;
  return Boolean(
    move?.promotion
    && (!color || move.color === color)
    && (!from || move.from === from)
    && (!promotedType || move.promotion === promotedType),
  );
}

function supportsDefenseClaim(fen, sourceType, from, targetType, to) {
  const game = gameFromFen(fen);
  const source = game?.get(from);
  const target = game?.get(to);
  if (!game || !source || source.type !== sourceType || !target) return false;
  if (targetType && target.type !== targetType) return false;
  if (target.color !== source.color) return false;
  if (!game.attackers(to, source.color).includes(from)) return false;
  if (target.type === "k") return true;

  const probe = gameFromFen(game.fen());
  if (!probe) return false;
  probe.remove(to);
  probe.put({ type: "p", color: source.color === "w" ? "b" : "w" }, to);
  const fields = probe.fen().split(/\s+/);
  fields[1] = source.color;
  const sourceTurnGame = gameFromFen(fields.join(" "));
  return Boolean(sourceTurnGame?.moves({ square: from, verbose: true })
    .some((move) => move.to === to && Boolean(move.captured)));
}

function supportsDefenseWithoutSource(fen, sourceType, targetType, to) {
  const game = gameFromFen(fen);
  const target = game?.get(to);
  if (!game || !target || (targetType && target.type !== targetType)) return false;
  return game.attackers(to, target.color).some((from) => (
    game.get(from)?.type === sourceType
    && supportsDefenseClaim(fen, sourceType, from, targetType, to)
  ));
}

function sentenceBoardTokens(sentence) {
  const pieces = [...sentence.matchAll(
    /\b(Bauer|Bauern|Springer|Läufer|Turm|Türme|Dame|Damen|König|Könige)\b/giu,
  )].map((match) => ({
    type: germanPieceType(match[1]),
    index: match.index,
  }));
  const squares = [...sentence.matchAll(/(?<![a-z])([a-h][1-8])(?![a-z0-9])/giu)]
    .map((match) => ({ square: match[1].toLowerCase(), index: match.index }));
  return { pieces, squares };
}

function adjacentSquareForPiece(tokens, piece) {
  if (!piece) return "";
  return tokens.squares.find((square) => (
    square.index > piece.index && square.index - piece.index <= 18
  ))?.square || "";
}

function forkClaimParts(sentence, tokens) {
  let source = tokens.pieces[0] || null;
  const passive = /\b(?:von|durch)\s+(?:den|die|das|einen|eine)?\s*(Bauer|Springer|Läufer|Turm|Dame|König)\b/iu
    .exec(sentence);
  if (passive) {
    const passiveIndex = (passive.index || 0) + passive[0].lastIndexOf(passive[1]);
    source = tokens.pieces.find((piece) => piece.index === passiveIndex) || source;
  }
  const compound = /\b(Bauern|Springer|Läufer|Turm|Damen|Königs)gabel\b/iu.exec(sentence);
  const sourceType = compound
    ? germanPieceType(compound[1].replace(/s$/iu, ""))
    : source?.type || "";
  return {
    sourceType,
    sourceSquare: adjacentSquareForPiece(tokens, source),
    targetTypes: tokens.pieces
      .filter((piece) => piece !== source)
      .map((piece) => piece.type),
  };
}

function pinClaimParts(sentence, tokens) {
  const active = /\b(?:fesselt|hält)\b/iu.exec(sentence);
  if (active) {
    const attacker = [...tokens.pieces]
      .reverse()
      .find((piece) => piece.index < active.index) || null;
    const pinned = tokens.pieces.find((piece) => piece.index > active.index) || null;
    return {
      attackerType: attacker?.type || "",
      attackerSquare: adjacentSquareForPiece(tokens, attacker),
      pinnedType: pinned?.type || "",
      pinnedSquare: adjacentSquareForPiece(tokens, pinned),
    };
  }
  const pinned = tokens.pieces[0] || null;
  return {
    pinnedType: pinned?.type || "",
    pinnedSquare: adjacentSquareForPiece(tokens, pinned),
  };
}

function isGeneralBoardDefinition(sentence, tokens) {
  const concreteReference = (
    tokens.squares.length > 0
    || hasPersonalPerspective(sentence)
    || /\b(?:hier|jetzt|aktuell|diese[rmns]?\s+(?:stellung|zug|figur|bauer)|auf\s+dem\s+brett|wei(?:ß|ss)|schwarz)\b/iu
      .test(sentence)
  );
  if (concreteReference) return false;
  return (
    /^(?:bei\s+)?(?:ein(?:e|er|en|em|es)?|der|die|das)\s+(?:gabel|fesselung|freibauer|doppelbauer|doppelbauern|isolierte[rmns]?\s+bauer|bauernmehrheit|offene[rmns]?\s+linie|außenposten|rochade|umwandlung)\b/iu
      .test(sentence)
    || /^unter\s+(?:einer\s+)?(?:gabel|fesselung|rochade|umwandlung)\b/iu
      .test(sentence)
    || /^(?:ein(?:e|er|en|em|es)?|der|die|das)\b[^.!?]{0,100}\b(?:bedeutet|heißt|nennt\s+man|wenn)\b/iu
      .test(sentence)
    || /^(?:isolierte?\s+bauern?|bauernmehrheit|bauernüberzahl|offene?\s+linie|außenposten)\b[^.!?]{0,80}\b(?:bedeutet|heißt|nennt\s+man)\b/iu
      .test(sentence)
  );
}

/**
 * Prüft einfache konkrete Brettbehauptungen in freien KI-Antworten gegen die
 * aktuelle Stellung. Eine spätere Variantenstellung zählt nur, wenn derselbe
 * Satz sie mit „Nach Nf3“, „Mit Nf3“ oder einem Zug am Satzanfang klar nennt.
 * Erkannte Satzformen sind fail-closed.
 */
export function findUnsupportedBoardClaims(reply, context) {
  if (typeof reply !== "string" || !reply.trim()) return [];
  const timeline = contextPositionTimeline(context);
  if (timeline.current.length === 0) return [];
  const unsupported = [];
  const sentences = reply.match(/[^.!?\n]+[.!?]?/gu) || [];
  for (const rawSentence of sentences) {
    const sentence = rawSentence.trim();
    const strippedSentence = sentence.replace(/[.!?]+$/u, "");
    const explicitPositions = explicitPositionsForBoardClaim(sentence, timeline);
    const positions = positionsForBoardClaim(sentence, timeline);
    const tokens = sentenceBoardTokens(sentence);
    if (isGeneralBoardDefinition(sentence, tokens)) continue;
    const futureRecommendation = /\b(?:solltest|soll|sollten|versuche|plane|achte)\b/iu
      .test(sentence);
    const hasUnclearFuture = (
      /(?:\b(?:später|bald|danach|dann|nachher|anschließend|langfristig|mittelfristig|gleich\s+darauf|als\s+nächstes|mit\s+der\s+zeit|am\s+ende)\b|\bin\s+(?:\d+|ein(?:em|en)|zwei|drei|einigen|mehreren|wenigen)\s+zügen?\b|\bim\s+(?:weiteren\s+verlauf|mittelspiel|endspiel)\b|\bnach\s+(?:der\s+)?(?:eröffnung|abtausch|tausch)\b)/iu
        .test(sentence)
      && explicitPositions.length === 0
      && !futureRecommendation
      && /\b(?:häng|ungedeckt|angegriffen|greif|deck|fessel|gabel|doppelangriff|verlier|gewinn|weg|matt|schach|f[aä]ll|verschwind|geschlagen|genommen|isoliert|bauernmehrheit|bauernüberzahl|sicher|unsicher|schutzlos|exponiert|zentrum|kontrollier|beherrsch|offene?\s+linie|linie\s+offen|außenposten|stärker|schwächer|freibauer|doppelbauer|rochier|umwand)\w*/iu
        .test(sentence)
    );
    if (hasUnclearFuture) {
      unsupported.push(strippedSentence);
      continue;
    }

    const perspective = claimColor(sentence, timeline);
    const unresolvedPersonalPerspective = hasPersonalPerspective(sentence) && !perspective;
    const kingToken = tokens.pieces.find((piece) => piece.type === "k") || null;
    const kingSquare = adjacentSquareForPiece(tokens, kingToken);
    const mateClaim = /\b(?:schachmatt|matt)\b/iu.test(sentence);
    if (mateClaim) {
      if (
        unresolvedPersonalPerspective
        || !positions.some((fen) => supportsCheckClaim(
          fen,
          perspective,
          kingSquare,
          true,
        ))
      ) unsupported.push(strippedSentence);
      continue;
    }

    const checkClaim = (
      /\bim\s+schach\b/iu.test(sentence)
      || /\b(?:gibt|bietet|setzt)\b[^.!?]{0,32}\bschach\b/iu.test(sentence)
      || /\bschachgebot\b/iu.test(sentence)
    );
    if (checkClaim) {
      if (
        unresolvedPersonalPerspective
        || !positions.some((fen) => supportsCheckClaim(
          fen,
          perspective,
          kingSquare,
          false,
        ))
      ) unsupported.push(strippedSentence);
      continue;
    }

    const materialGainClaim = /\b(?:gewinn(?:st|t|en)|erober(?:st|t|n)|hol(?:st|t|en)|nimm(?:st|t|en))\b[^.!?]{0,60}\b(?:Bauer|Springer|Läufer|Turm|Dame|Figur|Material)\w*/iu
      .exec(sentence);
    if (materialGainClaim) {
      const claimsNetGain = /\b(?:gewinn(?:st|t|en)|erober(?:st|t|n)|hol(?:st|t|en))\b/iu
        .test(materialGainClaim[0]);
      const objectMatch = /\b(Bauer|Springer|Läufer|Turm|Dame|Figur|Material)\w*/iu
        .exec(materialGainClaim[0]);
      const object = objectMatch?.[1]?.toLocaleLowerCase("de-DE") || "";
      const claimedType = germanPieceType(object);
      const genericFigure = object === "figur";
      const perspectiveOwnsTarget = Boolean(
        perspective
        && /\bdein(?:e[nrms]?)?\s+(?:Bauer|Springer|Läufer|Turm|Dame|Figur|Material)\w*/iu
          .test(materialGainClaim[0]),
      );
      const targetPiece = [...tokens.pieces].reverse().find((piece) => (
        !claimedType || piece.type === claimedType
      )) || null;
      const targetSquare = adjacentSquareForPiece(tokens, targetPiece);
      const supported = !unresolvedPersonalPerspective && explicitPositions.some((entry) => {
        const claimant = perspectiveOwnsTarget
          ? perspective === "w" ? "b" : "w"
          : perspective || entry.move?.color || "";
        const captures = claimsNetGain && Array.isArray(entry.lineCaptures)
          ? entry.lineCaptures
          : entry.captures || [];
        const matchingCapture = captures.some((capture) => (
          capture.by === claimant
          && (!claimedType || capture.piece === claimedType)
          && (!genericFigure || ["n", "b", "r", "q"].includes(capture.piece))
          && (!targetSquare || capture.square === targetSquare)
        ));
        return matchingCapture && (
          !claimsNetGain
          || lineSupportsNetMaterialGain(
            entry,
            claimant,
            claimedType,
            genericFigure,
          )
        );
      });
      if (!supported) unsupported.push(strippedSentence);
      continue;
    }

    const passedPawnClaim = /\b(?:freibauer|freibauern|freie[rmns]?\s+bauer|durchgelaufene[rmns]?\s+bauer)\b/iu
      .test(sentence);
    if (passedPawnClaim) {
      const pawn = tokens.pieces.find((piece) => piece.type === "p") || null;
      const square = adjacentSquareForPiece(tokens, pawn);
      if (
        unresolvedPersonalPerspective
        || !positions.some((fen) => supportsPassedPawnClaim(fen, perspective, square))
      ) unsupported.push(strippedSentence);
      continue;
    }

    const doubledPawnClaim = /\b(?:doppelbauer|doppelbauern|verdoppelte[rmns]?\s+bauern?)\b/iu
      .test(sentence);
    if (doubledPawnClaim) {
      const file = tokens.squares[0]?.square?.[0] || "";
      if (
        unresolvedPersonalPerspective
        || !positions.some((fen) => supportsDoubledPawnClaim(fen, perspective, file))
      ) unsupported.push(strippedSentence);
      continue;
    }

    const isolatedPawnClaim = (
      /\b(?:isoliert\w*\s+bauern?|bauern?\b[^.!?]{0,28}\bisoliert\w*)\b/iu
        .test(sentence)
    );
    if (isolatedPawnClaim) {
      const pawn = tokens.pieces.find((piece) => piece.type === "p") || null;
      const square = adjacentSquareForPiece(tokens, pawn);
      if (
        unresolvedPersonalPerspective
        || !positions.some((fen) => supportsIsolatedPawnClaim(
          fen,
          perspective,
          square,
        ))
      ) unsupported.push(strippedSentence);
      continue;
    }

    const pawnMajorityClaim = /\b(?:bauernmehrheit|bauernüberzahl|mehrheit\s+der\s+bauern)\b/iu
      .test(sentence);
    if (pawnMajorityClaim) {
      const wing = /\b(?:damenflügel|damenseite)\b/iu.test(sentence)
        ? "queenside"
        : /\b(?:königsflügel|königsseite)\b/iu.test(sentence)
          ? "kingside"
          : "";
      if (
        unresolvedPersonalPerspective
        || !wing
        || !positions.some((fen) => supportsPawnMajorityClaim(fen, perspective, wing))
      ) unsupported.push(strippedSentence);
      continue;
    }

    const king = tokens.pieces.find((piece) => piece.type === "k") || null;
    const strategicKingSquare = adjacentSquareForPiece(tokens, king);
    const unsafeKingClaim = (
      /\bkönig\w*\b[^.!?]{0,45}\b(?:ist|steht|bleibt|wirkt)\b[^.!?]{0,28}\b(?:unsicher|schutzlos|exponiert|offen)\w*\b/iu
        .test(sentence)
      || /\b(?:unsicher|schutzlos|exponiert)\w*\b[^.!?]{0,28}\bkönig\w*\b/iu
        .test(sentence)
    );
    const safeKingClaim = (
      !unsafeKingClaim
      && /\bkönig\w*\b[^.!?]{0,45}\b(?:ist|steht|bleibt|wirkt)\b[^.!?]{0,28}\b(?:sicher|geschützt)\w*\b/iu
        .test(sentence)
    );
    if (unsafeKingClaim || safeKingClaim) {
      if (
        unresolvedPersonalPerspective
        || !positions.some((fen) => supportsKingSafetyClaim(
          fen,
          perspective,
          strategicKingSquare,
          unsafeKingClaim ? "unsafe" : "safe",
        ))
      ) unsupported.push(strippedSentence);
      continue;
    }

    const kingInCenterClaim = (
      /\bkönig\w*\b[^.!?]{0,36}\b(?:ist|steht|bleibt)\b[^.!?]{0,20}\b(?:in\s+der\s+mitte|im\s+zentrum)\b/iu
        .test(sentence)
    );
    if (kingInCenterClaim) {
      if (
        unresolvedPersonalPerspective
        || !positions.some((fen) => supportsKingInCenterClaim(
          fen,
          perspective,
          strategicKingSquare,
        ))
      ) unsupported.push(strippedSentence);
      continue;
    }

    const centerControlClaim = (
      /\b(?:kontrolliert|beherrscht|dominiert)\b[^.!?]{0,28}\b(?:das\s+)?zentrum\b/iu
        .test(sentence)
      || /\b(?:zentrumskontrolle|kontrolle\s+(?:über|im)\s+(?:das\s+)?zentrum)\b/iu
        .test(sentence)
    );
    const concreteCenterReference = Boolean(
      explicitClaimColor(sentence)
      || hasPersonalPerspective(sentence)
      || explicitPositions.length > 0
      || /\b(?:hier|jetzt|aktuell|dieser\s+zug|der\s+zug|die\s+stellung)\b/iu
        .test(sentence),
    );
    if (centerControlClaim && concreteCenterReference) {
      const claimsDominance = /\b(?:beherrscht|dominiert|mehr|stärker|besser)\b/iu
        .test(sentence);
      if (
        unresolvedPersonalPerspective
        || !positions.some((fen) => supportsCenterControlClaim(
          fen,
          perspective,
          claimsDominance,
        ))
      ) unsupported.push(strippedSentence);
      continue;
    }

    const openFileMatch = (
      /\b([a-h])(?:-|‑|–)?linie\b[^.!?]{0,30}\b(?:offen|geöffnet)\w*\b/iu.exec(sentence)
      || /\boffene[rmns]?\b[^.!?]{0,14}\b([a-h])(?:-|‑|–)?linie\b/iu.exec(sentence)
    );
    if (openFileMatch) {
      const file = openFileMatch[1]?.toLocaleLowerCase("de-DE") || "";
      if (!positions.some((fen) => supportsOpenFileClaim(fen, file))) {
        unsupported.push(strippedSentence);
      }
      continue;
    }

    const outpostClaim = /\baußenposten\b/iu.test(sentence);
    if (outpostClaim) {
      const outpostPiece = tokens.pieces.find((piece) => piece.type !== "p" && piece.type !== "k")
        || null;
      const outpostSquare = adjacentSquareForPiece(tokens, outpostPiece)
        || tokens.squares[0]?.square
        || "";
      if (
        unresolvedPersonalPerspective
        || !positions.some((fen) => supportsOutpostClaim(
          fen,
          perspective,
          outpostPiece?.type || "",
          outpostSquare,
        ))
      ) unsupported.push(strippedSentence);
      continue;
    }

    const castlingClaim = (
      /\b(?:kann(?:st|t|en)?|könnte|darf|ist|bleibt)\b[^.!?]{0,40}\brochier\w*/iu.test(sentence)
      || /\brochade\b[^.!?]{0,28}\b(?:möglich|legal|erlaubt)\b/iu.test(sentence)
    );
    if (castlingClaim) {
      const side = /\b(?:kurz|königsflügel)\b/iu.test(sentence)
        ? "short"
        : /\b(?:lang|damenflügel)\b/iu.test(sentence)
          ? "long"
          : "";
      if (
        unresolvedPersonalPerspective
        || !positions.some((fen) => supportsCastlingClaim(fen, perspective, side))
      ) unsupported.push(strippedSentence);
      continue;
    }

    const promotionClaim = (
      tokens.pieces.some((piece) => piece.type === "p")
      && /\b(?:umwand\w*|verwand\w*|promotion|zur?\s+(?:dame|turm|läufer|springer)|neue\s+dame)\b/iu
        .test(sentence)
    );
    if (promotionClaim) {
      const pawn = tokens.pieces.find((piece) => piece.type === "p") || null;
      const from = adjacentSquareForPiece(tokens, pawn);
      const promoted = tokens.pieces.find((piece) => (
        piece !== pawn && ["q", "r", "b", "n"].includes(piece.type)
      ))?.type || "";
      const supported = !unresolvedPersonalPerspective && explicitPositions.some((entry) => (
        promotionSupportsClaim(entry, perspective, from, promoted)
      ));
      if (!supported) unsupported.push(strippedSentence);
      continue;
    }

    const forkClaim = (
      /(?:\b(?:gabel|doppelangriff)\w*|\b\w+gabel\b)/iu.test(sentence)
      || (
        /\b(?:greift|attackiert|bedroht)\b/iu.test(sentence)
        && (
          tokens.pieces.length >= 3
          || /\b(?:zwei|2)\s+(?:figuren|ziele)\b/iu.test(sentence)
        )
      )
    );
    if (forkClaim) {
      const claim = forkClaimParts(sentence, tokens);
      if (!positions.some((fen) => supportsForkClaim(fen, claim))) {
        unsupported.push(strippedSentence);
      }
      continue;
    }

    const pinClaim = (
      /\b(?:fessel\w*|gefesselt)\b/iu.test(sentence)
      || /\ban\s+(?:den|die|das|einen|eine)\s+(?:König|Dame|Turm)\s+gebunden\b/iu
        .test(sentence)
      || /\bhält\b[^.!?]{0,50}\bfest\b/iu.test(sentence)
      || /\b(?:darf|kann)\b[^.!?]{0,24}\bnicht\s+ziehen\b[^.!?]{0,50}\bkönig\b/iu
        .test(sentence)
    );
    if (pinClaim) {
      const claim = pinClaimParts(sentence, tokens);
      if (!positions.some((fen) => supportsPinClaim(fen, claim))) {
        unsupported.push(strippedSentence);
      }
      continue;
    }

    const requiresNoPiece = /\bkein(?:e[nrms]?)?\s+(?:Bauer|Springer|Läufer|Turm|Dame|König)\s+mehr\b/iu
      .test(sentence);
    const missingPieceClaim = (
      tokens.pieces.length > 0
      && (
        /\b(?:ist|sind|bleibt|bleiben)\s+(?:jetzt\s+)?(?:weg|verloren|verschwunden|vom\s+brett|nicht\s+mehr\s+da)\b/iu
          .test(sentence)
        || /\b(?:ist|sind)\s+(?:die|der|das|ein(?:e[nrms]?)?)\s+(?:Bauer|Springer|Läufer|Turm|Dame|König)\s+(?:jetzt\s+)?(?:weg|verloren|verschwunden|vom\s+brett|nicht\s+mehr\s+da)\b/iu
          .test(sentence)
        || /\bfehl(?:t|en)\b/iu.test(sentence)
        || /\b(?:ist|steht)\s+nicht\s+mehr\s+(?:auf|am)\s+(?:dem\s+)?brett\b/iu
          .test(sentence)
        || /\bwurde\b[^.!?]{0,40}\b(?:geschlagen|genommen|vom\s+brett\s+genommen)\b/iu
          .test(sentence)
        || /\b(?:futsch|verschwunden)\b/iu.test(sentence)
        || /\bweg\b/iu.test(sentence)
        || /\b(?:Bauer|Springer|Läufer|Turm|Dame|König)\s+verloren\b/iu
          .test(sentence)
        || requiresNoPiece
        || /\b(?:Bauer|Springer|Läufer|Turm|Dame|König)\b[^.!?]{0,24}\b(?:fällt|fallen)\b/iu
          .test(sentence)
      )
    );
    if (missingPieceClaim) {
      const piece = tokens.pieces[0];
      const pieceType = piece.type;
      const square = adjacentSquareForPiece(tokens, piece);
      const claimsCaptureEvent = (
        explicitPositions.length > 0
        || /\b(?:wurde|wird|nach|durch|dadurch|damit|jetzt)\b/iu.test(sentence)
      );
      const supported = !unresolvedPersonalPerspective && (
        claimsCaptureEvent
          ? explicitPositions.some((entry) => captureSupportsClaim(
            entry,
            pieceType,
            perspective,
            square,
          ))
          : square
            ? explicitPositions.some((entry) => captureSupportsClaim(
              entry,
              pieceType,
              perspective,
              square,
            ))
            : positions.some((fen) => supportsMissingPieceClaim(
              fen,
              pieceType,
              perspective,
              requiresNoPiece,
            ))
      );
      if (!supported) {
        unsupported.push(strippedSentence);
      }
      continue;
    }

    const materialDeficitClaim = (
      tokens.pieces.length > 0
      && /\b(?:einen?|eine)\s+(?:Bauern?|Springer|Läufer|Turm|Dame)\s+weniger\b/iu
        .test(sentence)
    );
    if (materialDeficitClaim) {
      const pieceType = tokens.pieces[0].type;
      if (
        unresolvedPersonalPerspective
        || !positions.some((fen) => supportsMaterialDeficitClaim(
          fen,
          pieceType,
          perspective,
        ))
      ) {
        unsupported.push(strippedSentence);
      }
      continue;
    }

    const materialBehindClaim = (
      tokens.pieces.length > 0
      && (
        /\b(?:liegst|liegt|bist|ist|steht)\b[^.!?]{0,36}\b(?:Bauern?|Springer|Läufer|Turm|Dame)\b[^.!?]{0,16}\b(?:hinten|im\s+rückstand)\b/iu
          .test(sentence)
        || /\b(?:bist|ist)\b[^.!?]{0,24}\b(?:Bauern?|Springer|Läufer|Turm|Dame)\b[^.!?]{0,12}\blos\b/iu
          .test(sentence)
      )
    );
    if (materialBehindClaim) {
      const pieceType = tokens.pieces[0].type;
      if (
        unresolvedPersonalPerspective
        || !positions.some((fen) => supportsMaterialDeficitClaim(
          fen,
          pieceType,
          perspective,
        ))
      ) {
        unsupported.push(strippedSentence);
      }
      continue;
    }

    if (/\b(?:hängt|hängen|hängend)\b/iu.test(sentence) && tokens.pieces.length > 0) {
      const piece = tokens.pieces[0];
      const square = adjacentSquareForPiece(tokens, piece);
      if (!positions.some((fen) => supportsHangingClaim(fen, piece.type, square))) {
        unsupported.push(strippedSentence);
      }
      continue;
    }

    const relation = /\b(greift|attackiert|bedroht|deckt|schützt|verteidigt|kontrolliert|beherrscht)\b/iu.exec(sentence);
    if (relation && tokens.pieces.length > 0 && tokens.squares.length > 0) {
      const sourceType = tokens.pieces[0].type;
      const targetType = tokens.pieces[1]?.type || "";
      const sourceSquareEntry = tokens.squares.find((square) => {
        if (square.index <= tokens.pieces[0].index || square.index >= relation.index) {
          return false;
        }
        const beforeSquare = sentence.slice(
          Math.max(tokens.pieces[0].index, square.index - 10),
          square.index,
        );
        return /\b(?:auf|von)\s*$/iu.test(beforeSquare);
      });
      const sourceSquare = sourceSquareEntry?.square || "";
      let targetSquares = tokens.squares
        .filter((square) => square.index > relation.index)
        .map((square) => square.square);
      if (
        targetSquares.length === 0
        && /^(?:kontrolliert|beherrscht)$/iu.test(relation[1])
      ) {
        targetSquares = tokens.squares
          .filter((square) => (
            square.index > tokens.pieces[0].index
            && square.index < relation.index
            && square !== sourceSquareEntry
          ))
          .map((square) => square.square);
      }
      const from = sourceSquare;
      const to = targetSquares.at(-1) || tokens.squares.at(-1).square;
      const supported = /^(?:deckt|schützt|verteidigt)$/iu.test(relation[1])
        ? positions.some((fen) => (
          from
            ? supportsDefenseClaim(fen, sourceType, from, targetType, to)
            : supportsDefenseWithoutSource(fen, sourceType, targetType, to)
        ))
        : /^(?:kontrolliert|beherrscht)$/iu.test(relation[1])
          ? targetSquares.length > 0 && targetSquares.every((targetSquare, index) => (
            positions.some((fen) => (
              from
                ? supportsControlClaim(
                  fen,
                  sourceType,
                  from,
                  targetSquare,
                  perspective,
                  index === targetSquares.length - 1 ? targetType : "",
                )
                : supportsControlWithoutSource(
                  fen,
                  sourceType,
                  targetSquare,
                  perspective,
                  index === targetSquares.length - 1 ? targetType : "",
                )
            ))
          ))
        : positions.some((fen) => (
          from
            ? supportsAttackClaim(fen, sourceType, from, targetType, to)
            : supportsAttackWithoutSource(fen, sourceType, targetType, to, perspective)
        ));
      if (!supported) unsupported.push(strippedSentence);
      continue;
    }

    if (
      /\b(?:ungedeckt|nicht\s+gedeckt)\b/iu.test(sentence)
      && tokens.pieces.length > 0
      && tokens.squares.length > 0
    ) {
      const expectedType = tokens.pieces[0].type;
      const square = tokens.squares.at(-1).square;
      const supported = /\bangegriffen\s+und\s+ungedeckt\b/iu.test(sentence)
        ? positions.some((fen) => supportsHangingClaim(fen, expectedType, square))
        : positions.some((fen) => supportsUndefendedClaim(fen, expectedType, square));
      if (!supported) unsupported.push(strippedSentence);
    }
  }
  return [...new Set(unsupported)];
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
      /\b(?:bewertung|evaluation|vorteil|nachteil|bauern(?:einheiten)?)\D{0,24}(?<![a-h])([+-]?\d+(?:[.,]\d+)?)|(?<![a-h])([+-]?\d+(?:[.,]\d+)?)\s*(?:bauern(?:einheiten)?|bewertung|evaluation|vorteil|nachteil)\b/gi,
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
