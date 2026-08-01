import { createHash } from "node:crypto";
import { Chess } from "chess.js";

export const PGN_PIPELINE_VERSION = 1;
export const ANNOTATION_STATUS = Object.freeze([
  "unverified",
  "engine_confirmed",
  "compatible",
  "strategic_only",
  "conflicting",
  "invalid",
  "human_approved",
]);

const RESULT_TOKENS = new Set(["1-0", "0-1", "1/2-1/2", "*"]);
const SYMBOLIC_NAGS = Object.freeze({
  "!": 1,
  "?": 2,
  "!!": 3,
  "??": 4,
  "!?": 5,
  "?!": 6,
  "□": 7,
  "=": 10,
  "∞": 13,
  "+=": 14,
  "=+": 15,
  "+-": 18,
  "-+": 19,
});

const FIELD_PATTERNS = Object.freeze({
  moveIdea: [
    /\b(?:idea|idee|plan|intention|ziel|purpose)\b[^.!?;:]*/iu,
    /\b(?:prepare|prepar|ermöglich|activate|aktivier|develop|entwickl)\w*\b[^.!?;:]*/iu,
  ],
  tacticalMotif: [
    /\b(?:fork|gabel|pin|fessel|skewer|spieß|deflection|ablenkung|overload|überlast|discovered attack|abzug|zwischenzug|mate|matt|sacrifice|opfer)\w*\b[^.!?;:]*/iu,
  ],
  strategicMotif: [
    /\b(?:weak square|schwaches feld|outpost|vorposten|open file|offene linie|space|raum|minority attack|minderheitsangriff|pawn structure|bauernstruktur|bad bishop|schlechter läufer|prophyl)\w*\b[^.!?;:]*/iu,
  ],
  immediateThreat: [
    /\b(?:threatens?|droht|immediate threat|direkte drohung|mate threat|mattdrohung)\b[^.!?;:]*/iu,
  ],
  longTermDanger: [
    /\b(?:long[- ]term|langfristig|danger|gefahr|weakness|schwäche|vulnerable|verwundbar)\w*\b[^.!?;:]*/iu,
  ],
  criticizedProperty: [
    /\b(?:mistake|blunder|inaccuracy|error|fehler|patzer|ungenau|too slow|zu langsam|premature|verfrüht|loses?|verliert)\w*\b[^.!?;:]*/iu,
  ],
  positionalConsequence: [
    /\b(?:leads? to|führt zu|results? in|ergibt|leaves?|lässt|creates?|schafft|opens?|öffnet|closes?|schließt)\b[^.!?;:]*/iu,
  ],
  learningPrinciple: [
    /\b(?:remember|merke|rule|regel|principle|prinzip|always|immer|never|nie)\b[^.!?;:]*/iu,
  ],
});

function sha1(value) {
  return createHash("sha1").update(String(value || "")).digest("hex");
}

function normalizeWhitespace(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

export function parsePgnHeaders(rawPgn) {
  const headers = {};
  for (const match of String(rawPgn || "").matchAll(/^\s*\[([^\s\]]+)\s+"((?:\\.|[^"\\])*)"\]\s*$/gmu)) {
    headers[match[1]] = match[2].replace(/\\"/g, '"').replace(/\\\\/g, "\\");
  }
  return headers;
}

function movetextOf(rawPgn) {
  return String(rawPgn || "").replace(/^\s*\[[^\n\r]*\]\s*$/gmu, " ");
}

export function tokenizePgnMovetext(rawPgn) {
  const input = movetextOf(rawPgn);
  const tokens = [];
  let index = 0;
  while (index < input.length) {
    const char = input[index];
    if (/\s/u.test(char)) {
      index += 1;
      continue;
    }
    if (char === "{") {
      const start = index;
      let depth = 1;
      index += 1;
      while (index < input.length && depth > 0) {
        if (input[index] === "{") depth += 1;
        else if (input[index] === "}") depth -= 1;
        index += 1;
      }
      tokens.push({
        type: "comment",
        value: input.slice(start + 1, depth === 0 ? index - 1 : index),
        style: "brace",
        closed: depth === 0,
      });
      continue;
    }
    if (char === ";") {
      const end = input.indexOf("\n", index + 1);
      tokens.push({
        type: "comment",
        value: input.slice(index + 1, end < 0 ? input.length : end),
        style: "semicolon",
        closed: true,
      });
      index = end < 0 ? input.length : end + 1;
      continue;
    }
    if (char === "(" || char === ")") {
      tokens.push({ type: char === "(" ? "variationStart" : "variationEnd", value: char });
      index += 1;
      continue;
    }
    let end = index + 1;
    while (end < input.length && !/[\s{}();]/u.test(input[end])) end += 1;
    const word = input.slice(index, end);
    index = end;
    const combinedMoveNumber = word.match(/^(\d+)\.(\.\.)?([^\.].*)$/u);
    if (combinedMoveNumber) {
      tokens.push({ type: "moveNumber", value: `${combinedMoveNumber[1]}.${combinedMoveNumber[2] || ""}` });
      tokens.push({ type: "word", value: combinedMoveNumber[3] });
      continue;
    }
    if (/^\d+\.(?:\.\.)?$/u.test(word) || word === "...") {
      tokens.push({ type: "moveNumber", value: word });
    } else if (/^\$\d+$/u.test(word)) {
      tokens.push({ type: "nag", value: Number.parseInt(word.slice(1), 10), raw: word });
    } else if (RESULT_TOKENS.has(word)) {
      tokens.push({ type: "result", value: word });
    } else {
      tokens.push({ type: "word", value: word });
    }
  }
  return tokens;
}

function splitSanAndNag(word) {
  const match = String(word || "").match(/^(.*?)(!!|\?\?|!\?|\?!|!|\?|□)$/u);
  if (!match || !match[1]) return { san: word, nag: null };
  return { san: match[1], nag: SYMBOLIC_NAGS[match[2]] || null };
}

function createGameFromHeaders(headers) {
  try {
    return headers.SetUp === "1" && headers.FEN ? new Chess(headers.FEN) : new Chess();
  } catch {
    return null;
  }
}

function cloneAtFen(fen) {
  try {
    return new Chess(fen);
  } catch {
    return null;
  }
}

function uciOf(move) {
  return `${move.from}${move.to}${move.promotion || ""}`.toLowerCase();
}

function parseSequence(tokens, startIndex, game, {
  depth = 0,
  path = "main",
  errors,
  stopAtVariationEnd = false,
} = {}) {
  const nodes = [];
  let index = startIndex;
  let lastNode = null;
  let commentsBefore = [];
  let commentTargetsNextMove = true;
  let terminated = false;

  while (index < tokens.length) {
    const token = tokens[index];
    if (token.type === "variationEnd") {
      if (stopAtVariationEnd) return { nodes, index: index + 1, terminated };
      errors.push({ code: "unexpected_variation_end", tokenIndex: index, path });
      index += 1;
      continue;
    }
    if (token.type === "result") {
      return { nodes, index: index + 1, terminated: true, result: token.value };
    }
    if (token.type === "moveNumber") {
      commentTargetsNextMove = true;
      index += 1;
      continue;
    }
    if (token.type === "comment") {
      const value = token.value;
      if (!token.closed) {
        errors.push({ code: "unclosed_comment", tokenIndex: index, path });
      }
      if (!lastNode || commentTargetsNextMove) commentsBefore.push(value);
      else lastNode.commentsAfter.push(value);
      index += 1;
      continue;
    }
    if (token.type === "nag") {
      if (lastNode) lastNode.nags.push(token.value);
      else errors.push({ code: "orphan_nag", tokenIndex: index, path, value: token.value });
      index += 1;
      continue;
    }
    if (token.type === "variationStart") {
      const baseFen = lastNode?.fenBefore || game.fen();
      const variationGame = cloneAtFen(baseFen);
      if (!variationGame) {
        errors.push({ code: "invalid_variation_start", tokenIndex: index, path, fen: baseFen });
        index += 1;
        continue;
      }
      const variationIndex = lastNode?.variations.length || 0;
      const parsed = parseSequence(tokens, index + 1, variationGame, {
        depth: depth + 1,
        path: `${path}.${nodes.length || 0}v${variationIndex + 1}`,
        errors,
        stopAtVariationEnd: true,
      });
      if (lastNode) lastNode.variations.push(parsed.nodes);
      else errors.push({ code: "orphan_variation", tokenIndex: index, path });
      index = parsed.index;
      continue;
    }
    if (token.type !== "word") {
      index += 1;
      continue;
    }

    const { san, nag } = splitSanAndNag(token.value);
    const fenBefore = game.fen();
    const turn = game.turn();
    let move;
    try {
      move = game.move(san, { strict: false });
    } catch (error) {
      errors.push({
        code: "illegal_move",
        tokenIndex: index,
        path,
        san,
        fenBefore,
        message: String(error?.message || error).slice(0, 180),
      });
      return { nodes, index: index + 1, terminated: false, invalid: true };
    }
    if (!move) {
      errors.push({ code: "illegal_move", tokenIndex: index, path, san, fenBefore });
      return { nodes, index: index + 1, terminated: false, invalid: true };
    }
    const node = {
      path: `${path}.${nodes.length + 1}`,
      variationDepth: depth,
      mainline: depth === 0,
      ply: (Number.parseInt(fenBefore.split(/\s+/)[5], 10) - 1) * 2 + (turn === "b" ? 2 : 1),
      moveNumber: Number.parseInt(fenBefore.split(/\s+/)[5], 10),
      color: move.color,
      san: move.san,
      uci: uciOf(move),
      fenBefore,
      fenAfter: game.fen(),
      commentsBefore,
      commentsAfter: [],
      nags: nag ? [nag] : [],
      variations: [],
    };
    nodes.push(node);
    lastNode = node;
    commentsBefore = [];
    commentTargetsNextMove = false;
    index += 1;
  }
  if (stopAtVariationEnd) errors.push({ code: "unclosed_variation", tokenIndex: index, path });
  return { nodes, index, terminated };
}

function flattenNodes(nodes, output = []) {
  for (const node of nodes) {
    output.push(node);
    for (const variation of node.variations) flattenNodes(variation, output);
  }
  return output;
}

function compactHeaders(headers) {
  const numeric = (value) => {
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) ? parsed : null;
  };
  return {
    event: normalizeWhitespace(headers.Event),
    site: normalizeWhitespace(headers.Site),
    date: normalizeWhitespace(headers.Date),
    round: normalizeWhitespace(headers.Round),
    white: normalizeWhitespace(headers.White),
    black: normalizeWhitespace(headers.Black),
    result: RESULT_TOKENS.has(headers.Result) ? headers.Result : "*",
    whiteElo: numeric(headers.WhiteElo),
    blackElo: numeric(headers.BlackElo),
    eco: normalizeWhitespace(headers.ECO),
    opening: normalizeWhitespace(headers.Opening || headers.Variation),
    timeControl: normalizeWhitespace(headers.TimeControl),
    annotator: normalizeWhitespace(headers.Annotator || headers.Commentator),
    source: normalizeWhitespace(headers.Source || headers.SourceDate),
    setUp: headers.SetUp === "1",
    startFen: normalizeWhitespace(headers.FEN),
  };
}

function statusClaim(field, value, excerpt, confidence, status = "unverified") {
  return {
    field,
    value: normalizeWhitespace(value),
    confidence: Math.max(0, Math.min(1, confidence)),
    source: "human_annotation",
    verificationStatus: ANNOTATION_STATUS.includes(status) ? status : "unverified",
    excerpt: normalizeWhitespace(excerpt).slice(0, 240),
  };
}

function firstPatternMatch(comment, patterns) {
  for (const pattern of patterns) {
    const match = comment.match(pattern);
    if (match?.[0]) return normalizeWhitespace(match[0]);
  }
  return "";
}

export function structureHumanAnnotation(node) {
  const originalComment = [...node.commentsBefore, ...node.commentsAfter]
    .map((value) => String(value || "").trim())
    .filter(Boolean)
    .join("\n");
  const claims = [];
  for (const [field, patterns] of Object.entries(FIELD_PATTERNS)) {
    const excerpt = firstPatternMatch(originalComment, patterns);
    if (!excerpt) continue;
    const status = ["strategicMotif", "longTermDanger", "learningPrinciple"].includes(field)
      ? "strategic_only"
      : "unverified";
    claims.push(statusClaim(field, excerpt, excerpt, status === "strategic_only" ? 0.62 : 0.72, status));
  }
  const evaluationNag = node.nags.find((nag) => [1, 2, 3, 4, 5, 6].includes(nag));
  if (evaluationNag) {
    const evaluation = ({ 1: "good", 2: "mistake", 3: "brilliant", 4: "blunder", 5: "interesting", 6: "dubious" })[evaluationNag];
    claims.push(statusClaim("moveAssessment", evaluation, `$${evaluationNag}`, 0.94));
  }
  const alternatives = node.variations.flatMap((variation) => {
    const first = variation[0];
    if (!first) return [];
    return [{
      san: first.san,
      uci: first.uci,
      fenAfter: first.fenAfter,
      lineSan: variation.slice(0, 12).map((move) => move.san),
      lineUci: variation.slice(0, 12).map((move) => move.uci),
      source: "pgn_variation",
      verificationStatus: "unverified",
      confidence: 0.98,
    }];
  });
  if (alternatives[0]) {
    claims.push(statusClaim(
      "recommendedAlternative",
      alternatives[0].san,
      alternatives[0].lineSan.join(" "),
      0.98,
    ));
    claims.push(statusClaim(
      "concreteVariation",
      alternatives[0].lineSan.join(" "),
      alternatives[0].lineSan.join(" "),
      0.99,
    ));
  }
  const type = claims.some((claim) => claim.field === "tacticalMotif")
    ? claims.some((claim) => claim.field === "strategicMotif") ? "mixed" : "tactical"
    : claims.some((claim) => claim.field === "strategicMotif") ? "strategic" : "unknown";
  return {
    version: 1,
    originalComment,
    nags: [...node.nags],
    type,
    claims,
    alternatives,
    provenance: {
      source: "human_pgn",
      movePath: node.path,
      processingVersion: PGN_PIPELINE_VERSION,
    },
  };
}

export function parseAnnotatedPgn(rawPgn, { source = "", gameOrdinal = 0 } = {}) {
  const headers = parsePgnHeaders(rawPgn);
  const metadata = compactHeaders(headers);
  const game = createGameFromHeaders(headers);
  if (!game) {
    return {
      version: PGN_PIPELINE_VERSION,
      gameId: sha1(`${source}\n${gameOrdinal}\n${rawPgn}`).slice(0, 20),
      source,
      metadata,
      moves: [],
      errors: [{ code: "invalid_start_fen", fen: headers.FEN || "" }],
      valid: false,
    };
  }
  const tokens = tokenizePgnMovetext(rawPgn);
  const errors = [];
  const parsed = parseSequence(tokens, 0, game, { errors });
  const moves = flattenNodes(parsed.nodes).map((node) => ({
    ...node,
    annotation: structureHumanAnnotation(node),
  }));
  const mainlineUci = moves.filter((move) => move.mainline).map((move) => move.uci).join(" ");
  const identity = [source, metadata.event, metadata.date, metadata.white, metadata.black, metadata.result, metadata.startFen, mainlineUci].join("\n");
  const gameId = sha1(identity).slice(0, 20);
  return {
    version: PGN_PIPELINE_VERSION,
    gameId,
    source,
    metadata,
    moves: moves.map((move) => ({ ...move, gameId })),
    errors,
    valid: errors.every((error) => !["invalid_start_fen", "illegal_move"].includes(error.code)),
  };
}

export function annotationRecords(parsedGame) {
  if (!parsedGame?.gameId || !Array.isArray(parsedGame.moves)) return [];
  return parsedGame.moves.flatMap((move) => {
    const annotation = move.annotation;
    if (!annotation?.originalComment && annotation?.nags?.length === 0 && annotation?.alternatives?.length === 0) {
      return [];
    }
    return [{
      id: sha1(`${parsedGame.gameId}\n${move.path}\n${move.uci}\n${annotation.originalComment}`).slice(0, 20),
      gameId: parsedGame.gameId,
      source: parsedGame.source,
      metadata: parsedGame.metadata,
      path: move.path,
      mainline: move.mainline,
      variationDepth: move.variationDepth,
      ply: move.ply,
      moveNumber: move.moveNumber,
      color: move.color,
      fenBefore: move.fenBefore,
      san: move.san,
      uci: move.uci,
      fenAfter: move.fenAfter,
      annotation,
      processing: {
        version: PGN_PIPELINE_VERSION,
        state: "generated",
        generatedAt: null,
      },
    }];
  });
}
