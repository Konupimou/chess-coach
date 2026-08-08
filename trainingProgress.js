import { scheduleTrainingReview, scoreTrainingResult } from "./spacedRepetition.js";

export const TRAINING_PROGRESS_SCHEMA_VERSION = 1;
export const TRAINING_STORAGE_PREFIX = "chess-coach.training.v1";
const MAX_RESULTS = 1_000;

function cleanId(value, maximum = 120) {
  return typeof value === "string" ? value.trim().slice(0, maximum) : "";
}

export function trainingStorageKey(identity) {
  const email = cleanId(identity?.email, 254).toLowerCase();
  return email
    ? `${TRAINING_STORAGE_PREFIX}:${encodeURIComponent(email)}`
    : `${TRAINING_STORAGE_PREFIX}:local`;
}

export function createTrainingProgress(userId = "local-user", now = new Date().toISOString()) {
  return {
    version: TRAINING_PROGRESS_SCHEMA_VERSION,
    userId: cleanId(userId) || "local-user",
    createdAt: now,
    updatedAt: now,
    results: [],
    schedule: {},
  };
}

function normalizeResult(value) {
  if (!value || typeof value !== "object") return null;
  const exerciseId = cleanId(value.exerciseId);
  if (!exerciseId) return null;
  return {
    id: cleanId(value.id) || `${exerciseId}-${Date.now()}`,
    exerciseId,
    userId: cleanId(value.userId) || "local-user",
    startedAt: cleanId(value.startedAt, 40),
    completedAt: cleanId(value.completedAt, 40),
    solved: Boolean(value.solved),
    attempts: Math.max(0, Number(value.attempts) || 0),
    hintsUsed: Math.max(0, Number(value.hintsUsed) || 0),
    firstMoveCorrect: Boolean(value.firstMoveCorrect),
    solutionShown: Boolean(value.solutionShown),
    timeSpentSeconds: Math.max(0, Number(value.timeSpentSeconds) || 0),
    quality: Math.max(0, Math.min(5, Number(value.quality) || 0)),
    nextReviewAt: cleanId(value.nextReviewAt, 40),
    concepts: Array.isArray(value.concepts)
      ? [...new Set(value.concepts.map((id) => cleanId(id, 100)).filter(Boolean))]
      : [],
    source: value.source && typeof value.source === "object"
      ? structuredClone(value.source)
      : { type: "curated" },
    metadata: value.metadata && typeof value.metadata === "object"
      ? structuredClone(value.metadata)
      : {},
  };
}

export function loadTrainingProgress(storage, key, userId = "local-user") {
  const fallback = createTrainingProgress(userId);
  if (!storage?.getItem) return fallback;
  try {
    const parsed = JSON.parse(storage.getItem(key));
    if (parsed?.version !== TRAINING_PROGRESS_SCHEMA_VERSION) return fallback;
    return {
      ...fallback,
      userId: cleanId(parsed.userId) || fallback.userId,
      createdAt: cleanId(parsed.createdAt, 40) || fallback.createdAt,
      updatedAt: cleanId(parsed.updatedAt, 40) || fallback.updatedAt,
      results: Array.isArray(parsed.results)
        ? parsed.results.map(normalizeResult).filter(Boolean).slice(0, MAX_RESULTS)
        : [],
      schedule: parsed.schedule && typeof parsed.schedule === "object"
        ? structuredClone(parsed.schedule)
        : {},
    };
  } catch {
    return fallback;
  }
}

export function saveTrainingProgress(storage, key, progress) {
  if (!storage?.setItem) return false;
  try {
    storage.setItem(key, JSON.stringify({
      ...progress,
      version: TRAINING_PROGRESS_SCHEMA_VERSION,
      updatedAt: new Date().toISOString(),
      results: (progress?.results || []).slice(0, MAX_RESULTS),
    }));
    return true;
  } catch {
    return false;
  }
}

export function completeTrainingExercise(progress, exercise, attempt, now = new Date()) {
  const quality = scoreTrainingResult(attempt);
  const base = {
    exerciseId: exercise.id,
    solved: Boolean(attempt.solved),
    attempts: attempt.attempts,
    hintsUsed: attempt.hintsUsed,
    timeSpentSeconds: attempt.timeSpentSeconds,
    solutionShown: Boolean(attempt.solutionShown),
    quality,
  };
  const schedule = scheduleTrainingReview(progress?.schedule?.[exercise.id], base, now);
  const result = normalizeResult({
    id: globalThis.crypto?.randomUUID?.() || `${exercise.id}-${now.getTime()}`,
    userId: progress?.userId || "local-user",
    startedAt: attempt.startedAt,
    completedAt: now.toISOString(),
    firstMoveCorrect: Boolean(attempt.solved && attempt.attempts === 1 && attempt.hintsUsed === 0),
    concepts: exercise.concepts,
    source: exercise.source,
    metadata: attempt.metadata,
    ...base,
    quality,
    nextReviewAt: schedule.nextReviewAt,
  });
  return {
    progress: {
      ...(progress || createTrainingProgress()),
      updatedAt: now.toISOString(),
      results: [result, ...(progress?.results || [])].slice(0, MAX_RESULTS),
      schedule: { ...(progress?.schedule || {}), [exercise.id]: schedule },
    },
    result,
  };
}
