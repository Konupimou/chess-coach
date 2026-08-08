import { parseTrainingExercise } from "./trainingValidation.js";

export function createTrainingExerciseFromAnalysis(input) {
  if (!input?.gameId || !Number.isInteger(input?.ply)) {
    throw new Error("Automatisch erzeugte Aufgaben brauchen gameId und ply.");
  }
  return parseTrainingExercise({
    id: input.id || `user-${input.gameId}-${input.ply}`,
    fen: input.fen,
    sideToMove: input.sideToMove,
    type: "best_move",
    category: input.category || "tactical",
    solution: {
      bestMoveUci: input.bestMoveUci,
      acceptableMoves: input.acceptableMoves || [input.bestMoveUci],
      continuation: input.continuation || [],
    },
    concepts: input.concepts,
    primaryConcept: input.primaryConcept || input.concepts?.[0],
    difficulty: input.difficulty || "intermediate",
    explanation: input.explanation,
    hints: input.hints,
    source: {
      type: "user_game",
      gameId: input.gameId,
      ply: input.ply,
      playedMove: input.playedMove,
      evalBefore: input.evalBefore,
      evalAfter: input.evalAfter,
    },
    metadata: {
      ...(input.metadata || {}),
      generation: {
        status: "candidate",
        requiresStockfishValidation: true,
      },
    },
  });
}
