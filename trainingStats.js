export function buildConceptStats(results = []) {
  const concepts = new Map();
  for (const result of results) {
    for (const conceptId of result?.concepts || []) {
      const current = concepts.get(conceptId) || {
        conceptId,
        attempts: 0,
        solved: 0,
        solvedFirstTry: 0,
        hintsUsed: 0,
      };
      current.attempts += 1;
      current.solved += Number(Boolean(result.solved));
      current.solvedFirstTry += Number(Boolean(result.firstMoveCorrect));
      current.hintsUsed += Math.max(0, Number(result.hintsUsed) || 0);
      concepts.set(conceptId, current);
    }
  }
  return [...concepts.values()].map((entry) => ({
    ...entry,
    accuracy: entry.attempts ? entry.solvedFirstTry / entry.attempts : 0,
    solveRate: entry.attempts ? entry.solved / entry.attempts : 0,
    averageHints: entry.attempts ? entry.hintsUsed / entry.attempts : 0,
  }));
}

function localDateKey(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export function buildTrainingStats(progress, now = new Date()) {
  const results = progress?.results || [];
  const today = localDateKey(now);
  const todayResults = results.filter((result) => localDateKey(result.completedAt) === today);
  const conceptStats = buildConceptStats(results);
  const ranked = conceptStats
    .filter((entry) => entry.attempts > 0)
    .sort((left, right) => left.accuracy - right.accuracy || right.attempts - left.attempts);
  const activeDays = new Set(results.map((result) => localDateKey(result.completedAt)).filter(Boolean));
  let streak = 0;
  const cursor = new Date(now);
  while (activeDays.has(localDateKey(cursor))) {
    streak += 1;
    cursor.setDate(cursor.getDate() - 1);
  }
  const solved = results.filter((result) => result.solved).length;
  const firstTry = results.filter((result) => result.firstMoveCorrect).length;
  return {
    total: results.length,
    solved,
    accuracy: results.length ? firstTry / results.length : 0,
    solveRate: results.length ? solved / results.length : 0,
    solvedToday: todayResults.filter((result) => result.solved).length,
    trainedToday: todayResults.length,
    currentStreak: streak,
    conceptStats: ranked,
    weakest: ranked.slice(0, 3),
    strongest: [...ranked].reverse().slice(0, 3),
  };
}
