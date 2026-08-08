const MINUTE = 60 * 1_000;
const DAY = 24 * 60 * MINUTE;

export function scoreTrainingResult({
  solved,
  attempts = 0,
  hintsUsed = 0,
  timeSpentSeconds = 0,
  solutionShown = false,
} = {}) {
  if (!solved) return 0;
  if (solutionShown) return 1;
  let quality = 5;
  quality -= Math.min(2, Math.max(0, attempts - 1));
  quality -= Math.min(2, Math.max(0, hintsUsed));
  if (timeSpentSeconds > 180) quality -= 2;
  else if (timeSpentSeconds > 90) quality -= 1;
  return Math.max(1, Math.min(5, quality));
}

export function reviewIntervalMs(quality, successStreak = 0) {
  const safeQuality = Math.max(0, Math.min(5, Number(quality) || 0));
  if (safeQuality === 0) return 10 * MINUTE;
  if (safeQuality === 1) return 6 * 60 * MINUTE;
  const baseDays = { 2: 1, 3: 2, 4: 4, 5: 7 }[safeQuality];
  const multiplier = 2 ** Math.max(0, Math.min(5, successStreak - 1));
  return Math.min(180 * DAY, baseDays * multiplier * DAY);
}

export function scheduleTrainingReview(previous, result, now = new Date()) {
  const quality = Number.isInteger(result?.quality)
    ? Math.max(0, Math.min(5, result.quality))
    : scoreTrainingResult(result);
  const previousStreak = Math.max(0, Number(previous?.successStreak) || 0);
  const successStreak = quality >= 3 ? previousStreak + 1 : 0;
  const nextReviewAt = new Date(now.getTime() + reviewIntervalMs(quality, successStreak));
  return {
    exerciseId: result.exerciseId,
    lastReviewedAt: now.toISOString(),
    nextReviewAt: nextReviewAt.toISOString(),
    quality,
    successStreak,
    lastSolved: Boolean(result.solved),
    lastAttempts: Math.max(0, Number(result.attempts) || 0),
    lastHintsUsed: Math.max(0, Number(result.hintsUsed) || 0),
    reviewCount: Math.max(0, Number(previous?.reviewCount) || 0) + 1,
  };
}
