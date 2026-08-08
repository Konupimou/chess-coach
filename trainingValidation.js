import { Chess } from "chess.js";
import { getConceptById } from "./chessKnowledge/index.js";

export const TRAINING_EXERCISE_TYPES = Object.freeze(["best_move"]);
export const TRAINING_DIFFICULTIES = Object.freeze([
  "beginner",
  "intermediate",
  "advanced",
]);
export const TRAINING_SOURCE_TYPES = Object.freeze([
  "curated",
  "user_game",
  "generated",
]);
export const TRAINING_CATEGORIES = Object.freeze([
  "tactical",
  "positional",
  "endgame",
]);

const UCI_PATTERN = /^[a-h][1-8][a-h][1-8][qrbn]?$/;

function text(value, maximum = 2_000) {
  return typeof value === "string" ? value.trim().slice(0, maximum) : "";
}

function stringArray(value, maximum = 12) {
  return Array.isArray(value)
    ? [...new Set(value.map((entry) => text(entry, 160)).filter(Boolean))].slice(0, maximum)
    : [];
}

export function uciMoveSpec(uci) {
  const normalized = text(uci, 5).toLowerCase();
  if (!UCI_PATTERN.test(normalized)) return null;
  const move = { from: normalized.slice(0, 2), to: normalized.slice(2, 4) };
  if (normalized.length === 5) move.promotion = normalized[4];
  return move;
}

export function moveToUci(move) {
  if (!move?.from || !move?.to) return "";
  return `${move.from}${move.to}${move.promotion || ""}`.toLowerCase();
}

export function legalMoveFromUci(gameOrFen, uci) {
  let game;
  try {
    game = typeof gameOrFen === "string" ? new Chess(gameOrFen) : gameOrFen;
  } catch {
    return null;
  }
  const spec = uciMoveSpec(uci);
  if (!game || !spec) return null;
  try {
    return game.move(spec) || null;
  } catch {
    return null;
  }
}

export function moveLineToSan(fen, moves) {
  let game;
  try {
    game = new Chess(fen);
  } catch {
    return [];
  }
  const san = [];
  for (const uci of moves || []) {
    const move = legalMoveFromUci(game, uci);
    if (!move) return [];
    san.push(move.san);
  }
  return san;
}

function normalizeSource(source) {
  const type = TRAINING_SOURCE_TYPES.includes(source?.type) ? source.type : "curated";
  const normalized = {
    type,
    gameId: text(source?.gameId, 120) || null,
    ply: Number.isInteger(source?.ply) && source.ply >= 0 ? source.ply : null,
  };
  if (type === "user_game") {
    normalized.playedMove = text(source?.playedMove, 12) || null;
    normalized.evalBefore = Number.isFinite(source?.evalBefore) ? source.evalBefore : null;
    normalized.evalAfter = Number.isFinite(source?.evalAfter) ? source.evalAfter : null;
  }
  const reference = text(source?.reference, 160);
  if (reference) normalized.reference = reference;
  return normalized;
}

function normalizeExercise(input) {
  const source = normalizeSource(input?.source);
  const bestMoveUci = text(input?.solution?.bestMoveUci, 5).toLowerCase();
  const acceptableMoves = stringArray(
    input?.solution?.acceptableMoves?.length
      ? input.solution.acceptableMoves
      : [bestMoveUci],
  ).map((move) => move.toLowerCase());
  if (bestMoveUci && !acceptableMoves.includes(bestMoveUci)) {
    acceptableMoves.unshift(bestMoveUci);
  }
  return {
    schemaVersion: 1,
    id: text(input?.id, 100),
    fen: text(input?.fen, 120),
    sideToMove: input?.sideToMove === "black" ? "black" : "white",
    type: TRAINING_EXERCISE_TYPES.includes(input?.type) ? input.type : "best_move",
    category: TRAINING_CATEGORIES.includes(input?.category) ? input.category : "tactical",
    solution: {
      bestMoveUci,
      acceptableMoves,
      continuation: stringArray(input?.solution?.continuation, 3).map((move) => move.toLowerCase()),
    },
    concepts: stringArray(input?.concepts, 8),
    primaryConcept: text(input?.primaryConcept, 100),
    difficulty: TRAINING_DIFFICULTIES.includes(input?.difficulty)
      ? input.difficulty
      : "beginner",
    explanation: {
      short: text(input?.explanation?.short, 400),
      detailed: text(input?.explanation?.detailed, 2_000),
      takeaway: text(input?.explanation?.takeaway, 600),
    },
    hints: stringArray(input?.hints, 3),
    source,
    metadata: input?.metadata && typeof input.metadata === "object"
      ? structuredClone(input.metadata)
      : {},
  };
}

export function validateTrainingExercise(input) {
  const exercise = normalizeExercise(input);
  const errors = [];
  if (!exercise.id) errors.push("exercise.id fehlt.");
  if (!exercise.fen) errors.push("exercise.fen fehlt.");

  let game = null;
  try {
    game = new Chess(exercise.fen);
  } catch {
    errors.push("exercise.fen ist keine gültige FEN.");
  }

  if (game) {
    const expectedSide = game.turn() === "w" ? "white" : "black";
    if (exercise.sideToMove !== expectedSide) {
      errors.push(`sideToMove widerspricht der FEN (${expectedSide} ist am Zug).`);
    }
  }

  if (!exercise.solution.bestMoveUci) errors.push("solution.bestMoveUci fehlt.");
  if (!exercise.solution.acceptableMoves.length) errors.push("Mindestens ein akzeptabler Zug ist erforderlich.");
  if (!exercise.solution.acceptableMoves.includes(exercise.solution.bestMoveUci)) {
    errors.push("Der beste Zug muss in acceptableMoves enthalten sein.");
  }

  if (game) {
    for (const uci of exercise.solution.acceptableMoves) {
      const probe = new Chess(exercise.fen);
      if (!legalMoveFromUci(probe, uci)) errors.push(`Akzeptabler Zug ${uci} ist nicht legal.`);
    }
    const continuationGame = new Chess(exercise.fen);
    if (legalMoveFromUci(continuationGame, exercise.solution.bestMoveUci)) {
      for (const uci of exercise.solution.continuation) {
        if (!legalMoveFromUci(continuationGame, uci)) {
          errors.push(`Fortsetzungszug ${uci} ist nicht legal.`);
          break;
        }
      }
      exercise.solution.bestMoveSan = moveLineToSan(
        exercise.fen,
        [exercise.solution.bestMoveUci],
      )[0] || exercise.solution.bestMoveUci;
      exercise.solution.continuationSan = moveLineToSan(
        exercise.fen,
        [exercise.solution.bestMoveUci, ...exercise.solution.continuation],
      ).slice(1);
    }
  }

  if (!exercise.concepts.length) errors.push("Mindestens ein Konzept ist erforderlich.");
  for (const conceptId of exercise.concepts) {
    if (!getConceptById(conceptId)) errors.push(`Unbekannte Konzept-ID: ${conceptId}.`);
  }
  if (!exercise.primaryConcept || !exercise.concepts.includes(exercise.primaryConcept)) {
    errors.push("primaryConcept muss in concepts enthalten sein.");
  }
  if (!exercise.explanation.short || !exercise.explanation.detailed) {
    errors.push("Kurze und ausführliche Erklärung sind erforderlich.");
  }
  if (exercise.hints.length < 2) errors.push("Mindestens zwei progressive Hinweise sind erforderlich.");

  const engineMoves = stringArray(exercise.metadata?.validation?.stockfishBestMoves, 8)
    .map((move) => move.toLowerCase());
  if (
    engineMoves.length
    && !engineMoves.some((move) => exercise.solution.acceptableMoves.includes(move))
  ) {
    errors.push("Kein akzeptabler Zug wird von der hinterlegten Stockfish-Prüfung gestützt.");
  }

  return { valid: errors.length === 0, errors, exercise };
}

export function parseTrainingExercise(input) {
  const result = validateTrainingExercise(input);
  if (!result.valid) {
    throw new Error(`Ungültige Trainingsaufgabe ${input?.id || "ohne ID"}: ${result.errors.join(" ")}`);
  }
  return Object.freeze(result.exercise);
}

export function validateTrainingMove(exercise, uci) {
  let game;
  try {
    game = new Chess(exercise.fen);
  } catch {
    return { legal: false, correct: false, reason: "invalid_fen", move: null };
  }
  const move = legalMoveFromUci(game, uci);
  if (!move) return { legal: false, correct: false, reason: "illegal_move", move: null };
  const normalized = moveToUci(move);
  return {
    legal: true,
    correct: exercise.solution.acceptableMoves.includes(normalized),
    reason: exercise.solution.acceptableMoves.includes(normalized) ? "correct" : "incorrect",
    move: { ...move, uci: normalized },
    resultingFen: game.fen(),
  };
}
