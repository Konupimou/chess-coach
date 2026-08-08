export function createExerciseAttempt(exercise, now = new Date()) {
  return {
    exerciseId: exercise.id,
    startedAt: now.toISOString(),
    attempts: 0,
    hintsUsed: 0,
    hintLevel: 0,
    solved: false,
    solutionShown: false,
    moves: [],
  };
}

export function revealNextHint(attempt, exercise) {
  const nextLevel = Math.min(exercise.hints.length, (attempt.hintLevel || 0) + 1);
  return {
    ...attempt,
    hintLevel: nextLevel,
    hintsUsed: Math.max(attempt.hintsUsed || 0, nextLevel),
  };
}

export function recordTrainingMove(attempt, validation, now = new Date()) {
  if (!validation?.legal) return { ...attempt };
  const attempts = (attempt.attempts || 0) + 1;
  return {
    ...attempt,
    attempts,
    solved: Boolean(validation.correct),
    completedAt: validation.correct ? now.toISOString() : null,
    moves: [
      ...(attempt.moves || []),
      {
        uci: validation.move.uci,
        san: validation.move.san,
        correct: Boolean(validation.correct),
        playedAt: now.toISOString(),
      },
    ],
  };
}

export function revealTrainingSolution(attempt) {
  return { ...attempt, solutionShown: true, solved: false };
}

export function sessionSummary(results = []) {
  const total = results.length;
  const solvedFirstTry = results.filter((result) => result.firstMoveCorrect).length;
  const solvedWithHelp = results.filter((result) => (
    result.solved && !result.firstMoveCorrect
  )).length;
  const failed = results.filter((result) => !result.solved).length;
  return {
    total,
    solvedFirstTry,
    solvedWithHelp,
    failed,
    accuracy: total ? solvedFirstTry / total : 0,
  };
}
