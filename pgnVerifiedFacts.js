import { Chess } from "chess.js";

export const EXACT_PGN_MOVE_FACT_SCOPE = "exact_position_move";

const STARTING_MINOR_SQUARES = Object.freeze({
  w: new Set(["b1", "c1", "f1", "g1"]),
  b: new Set(["b8", "c8", "f8", "g8"]),
});
const OWN_BACK_RANK = Object.freeze({ w: "1", b: "8" });
const CENTER_SQUARES = new Set(["d4", "e4", "d5", "e5"]);
const PIECE_NAMES = Object.freeze({
  p: { object: "den Bauern", accusative: "einen Bauern" },
  n: { object: "den Springer", accusative: "einen Springer" },
  b: { object: "den Läufer", accusative: "einen Läufer" },
  r: { object: "den Turm", accusative: "einen Turm" },
  q: { object: "die Dame", accusative: "eine Dame" },
  k: { object: "den König", accusative: "den König" },
});

function normalizedPositionKey(fen) {
  if (typeof fen !== "string") return "";
  const fields = fen.trim().split(/\s+/u);
  return fields.length >= 4 ? fields.slice(0, 4).join(" ") : "";
}

function verifiedClaim(kind, move, comment) {
  return {
    field: `boardFact.${kind}`,
    value: move.san,
    excerpt: comment,
    confidence: 1,
    source: "fen_and_legal_pgn_move",
    verificationStatus: "automatically_verified",
    scope: EXACT_PGN_MOVE_FACT_SCOPE,
  };
}

function fact(kind, comment, topics, move) {
  return {
    kind,
    comment,
    topics,
    scope: EXACT_PGN_MOVE_FACT_SCOPE,
    annotation: {
      type: "deterministic_move_fact",
      scope: EXACT_PGN_MOVE_FACT_SCOPE,
      claims: [verifiedClaim(kind, move, comment)],
      alternatives: [],
    },
  };
}

function isNarrowDevelopment(move) {
  return (
    (move.piece === "n" || move.piece === "b")
    && STARTING_MINOR_SQUARES[move.color]?.has(move.from)
    && move.to[1] !== OWN_BACK_RANK[move.color]
  );
}

function hasCentralPawnPair(game, color) {
  const squares = color === "w" ? ["d4", "e4"] : ["d5", "e5"];
  return squares.every((square) => {
    const piece = game.get(square);
    return piece?.type === "p" && piece.color === color;
  });
}

/**
 * Produces only facts that can be recomputed from the exact position and one
 * legal PGN move. It never reads annotation prose, player names or source
 * metadata. The returned sentences describe a move; they do not rate it.
 */
export function deterministicPgnMoveFacts(record = {}) {
  const fenBefore = typeof record.fenBefore === "string" ? record.fenBefore : "";
  const uci = typeof record.uci === "string" ? record.uci.toLowerCase() : "";
  if (!normalizedPositionKey(fenBefore) || !/^[a-h][1-8][a-h][1-8][qrbn]?$/u.test(uci)) {
    return [];
  }

  let game;
  let move;
  try {
    game = new Chess(fenBefore);
    move = game.move({
      from: uci.slice(0, 2),
      to: uci.slice(2, 4),
      promotion: uci.slice(4, 5) || undefined,
    });
  } catch {
    return [];
  }
  if (!move) return [];

  const fenAfter = game.fen();
  if (
    typeof record.fenAfter === "string"
    && record.fenAfter.trim()
    && normalizedPositionKey(record.fenAfter) !== normalizedPositionKey(fenAfter)
  ) return [];

  const facts = [];
  if (game.isCheckmate()) {
    facts.push(fact("checkmate", `${move.san} setzt den König matt.`, ["tactics"], move));
  } else if (game.isCheck()) {
    facts.push(fact("check", `Nach ${move.san} steht der König im Schach.`, ["tactics"], move));
  }

  if (move.flags.includes("k")) {
    facts.push(fact("castle_kingside", `${move.san} ist die kurze Rochade.`, ["king_safety"], move));
  } else if (move.flags.includes("q")) {
    facts.push(fact("castle_queenside", `${move.san} ist die lange Rochade.`, ["king_safety"], move));
  }

  if (move.promotion && PIECE_NAMES[move.promotion]) {
    facts.push(fact(
      "promotion",
      `${move.san} verwandelt den Bauern in ${PIECE_NAMES[move.promotion].accusative}.`,
      ["tactics", "endgame"],
      move,
    ));
  }

  if (move.captured && PIECE_NAMES[move.captured]) {
    const captureSquare = move.flags.includes("e")
      ? `${move.to[0]}${move.from[1]}`
      : move.to;
    facts.push(fact(
      "capture",
      `${move.san} schlägt auf ${captureSquare} ${PIECE_NAMES[move.captured].accusative}.`,
      [],
      move,
    ));
  }

  if (isNarrowDevelopment(move)) {
    facts.push(fact(
      "development",
      `${move.san} entwickelt ${PIECE_NAMES[move.piece].object}.`,
      ["development"],
      move,
    ));
  }

  if (move.piece === "p" && CENTER_SQUARES.has(move.to)) {
    if (hasCentralPawnPair(game, move.color)) {
      const side = move.color === "w" ? "weiße" : "schwarze";
      facts.push(fact(
        "central_pawn_pair",
        `Nach ${move.san} stehen zwei ${side} Bauern im Zentrum.`,
        ["center", "pawn_structure"],
        move,
      ));
    } else {
      facts.push(fact(
        "central_pawn",
        `Nach ${move.san} steht ein Bauer im Zentrum.`,
        ["center"],
        move,
      ));
    }
  }

  return facts;
}

const FACT_PRIORITY = Object.freeze([
  "checkmate",
  "castle_kingside",
  "castle_queenside",
  "promotion",
  "capture",
  "check",
  "development",
  "central_pawn_pair",
  "central_pawn",
]);

/** Returns one short fact so beginner prompts never receive a fact bundle. */
export function primaryDeterministicPgnMoveFact(record = {}) {
  const facts = deterministicPgnMoveFacts(record);
  return FACT_PRIORITY.map((kind) => facts.find((entry) => entry.kind === kind)).find(Boolean) || null;
}

export function isExactPgnMoveFact(entry) {
  return (
    entry?.scope === EXACT_PGN_MOVE_FACT_SCOPE
    || entry?.annotation?.scope === EXACT_PGN_MOVE_FACT_SCOPE
    || entry?.annotation?.type === "deterministic_move_fact"
  );
}
