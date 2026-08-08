import { buildConceptStats } from "./trainingStats.js";

function filterExercises(exercises, filters = {}) {
  return exercises.filter((exercise) => {
    if (filters.difficulty && exercise.difficulty !== filters.difficulty) return false;
    if (filters.category && exercise.category !== filters.category) return false;
    if (filters.concept && !exercise.concepts.includes(filters.concept)) return false;
    if (filters.source && exercise.source.type !== filters.source) return false;
    if (filters.userMistakesOnly && exercise.source.type !== "user_game") return false;
    return true;
  });
}

export function getTrainingQueue({
  exercises,
  progress,
  limit = 10,
  filters = {},
  now = new Date(),
} = {}) {
  const safeLimit = [5, 10, 20].includes(limit) ? limit : Math.max(1, Math.min(20, Number(limit) || 10));
  const conceptStats = buildConceptStats(progress?.results || []);
  const weakness = new Map(conceptStats.map((entry) => [entry.conceptId, 1 - entry.accuracy]));
  const nowMs = now.getTime();

  return filterExercises(exercises || [], filters)
    .map((exercise, index) => {
      const schedule = progress?.schedule?.[exercise.id];
      const nextReviewMs = Date.parse(schedule?.nextReviewAt || "") || Number.POSITIVE_INFINITY;
      const due = nextReviewMs <= nowMs;
      const failed = schedule?.lastSolved === false;
      const weakScore = Math.max(0, ...exercise.concepts.map((id) => weakness.get(id) || 0));
      const isNew = !schedule;
      const bucket = due ? 0 : failed ? 1 : weakScore > 0 ? 2 : isNew ? 3 : 4;
      return { exercise, index, bucket, nextReviewMs, failed, weakScore, isNew };
    })
    .filter((entry) => !filters.dueOnly || entry.bucket === 0)
    .sort((left, right) => (
      left.bucket - right.bucket
      || left.nextReviewMs - right.nextReviewMs
      || Number(right.failed) - Number(left.failed)
      || right.weakScore - left.weakScore
      || left.index - right.index
    ))
    .slice(0, safeLimit)
    .map((entry) => entry.exercise);
}
