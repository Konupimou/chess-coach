import { createAnalysisState } from "./model.js";
import { filterGames } from "./library.js";

export const CURRENT_ANALYSIS_VERSION = "game-review-v1";
export const ANALYSIS_PROFILES = Object.freeze(["quick", "standard", "deep"]);

function batchId(now) {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return `analysis-${new Date(now).getTime()}-${Math.random().toString(36).slice(2, 9)}`;
}

function contextFor(game) {
  const own = game.userColor === "white" ? game.white : game.black;
  return {
    provider: game.provider,
    providerGameId: game.providerGameId,
    playedAt: game.playedAt,
    userColor: game.userColor,
    playerRating: own?.rating ?? null,
    timeControl: game.timeControl,
  };
}

function reusable(game, version, profile) {
  return game.analysis?.state === "completed"
    && game.analysis?.version === version
    && game.analysis?.profile === profile;
}

function alreadyActive(game, version, profile) {
  return ["queued", "analyzing"].includes(game.analysis?.state)
    && game.analysis?.version === version
    && game.analysis?.profile === profile;
}

export function createAnalysisBatch(library, query, {
  analysisVersion = CURRENT_ANALYSIS_VERSION,
  profile = "standard",
  now = new Date(),
} = {}) {
  if (!ANALYSIS_PROFILES.includes(profile)) throw new Error("Invalid analysis profile.");
  const selected = filterGames(library?.games || [], query);
  const id = batchId(now);
  const timestamp = new Date(now).toISOString();
  const reusedGameIds = [];
  const activeGameIds = [];
  const jobs = [];
  const nextGames = (library?.games || []).map((game) => {
    if (!selected.some((selectedGame) => selectedGame.id === game.id)) return game;
    if (reusable(game, analysisVersion, profile)) {
      reusedGameIds.push(game.id);
      return game;
    }
    if (alreadyActive(game, analysisVersion, profile)) {
      activeGameIds.push(game.id);
      return game;
    }
    const job = {
      id: `${id}:${jobs.length + 1}`,
      gameId: game.id,
      status: "queued",
      attempts: 0,
      workerId: null,
      error: null,
      createdAt: timestamp,
      updatedAt: timestamp,
      analysisVersion,
      profile,
      context: contextFor(game),
    };
    jobs.push(job);
    return {
      ...game,
      analysis: createAnalysisState({
        ...game.analysis,
        state: "queued",
        version: analysisVersion,
        profile,
        error: null,
        context: job.context,
        updatedAt: timestamp,
      }, game.importedAt),
    };
  });
  return {
    library: { ...library, updatedAt: timestamp, games: nextGames },
    batch: {
      id,
      status: jobs.length ? "queued" : "completed",
      analysisVersion,
      profile,
      selectedCount: selected.length,
      reusedCount: reusedGameIds.length,
      alreadyActiveCount: activeGameIds.length,
      reusedGameIds,
      activeGameIds,
      jobs,
      createdAt: timestamp,
      updatedAt: timestamp,
    },
  };
}

export function claimNextJob(batch, workerId = "browser", now = new Date()) {
  const next = batch?.jobs?.find((job) => job.status === "queued");
  if (!next) return { batch, job: null };
  const timestamp = new Date(now).toISOString();
  const jobs = batch.jobs.map((job) => job.id === next.id ? {
    ...job,
    status: "analyzing",
    attempts: job.attempts + 1,
    workerId,
    error: null,
    updatedAt: timestamp,
  } : job);
  return {
    batch: { ...batch, status: "analyzing", jobs, updatedAt: timestamp },
    job: jobs.find((job) => job.id === next.id),
  };
}

function updateGameAnalysis(library, job, state, payload, now) {
  const timestamp = new Date(now).toISOString();
  return {
    ...library,
    updatedAt: timestamp,
    games: library.games.map((game) => game.id === job.gameId ? {
      ...game,
      analysis: createAnalysisState({
        ...game.analysis,
        state,
        version: job.analysisVersion,
        profile: job.profile,
        attempts: job.attempts,
        context: job.context,
        findings: payload?.findings || game.analysis?.findings || [],
        review: payload?.review || game.analysis?.review || null,
        error: payload?.error || null,
        updatedAt: timestamp,
      }, game.importedAt),
    } : game),
  };
}

export function finishAnalysisJob(library, batch, jobId, result = {}, now = new Date()) {
  const job = batch?.jobs?.find((candidate) => candidate.id === jobId);
  if (!job || job.status !== "analyzing") throw new Error("Analysis job is not active.");
  const timestamp = new Date(now).toISOString();
  const jobs = batch.jobs.map((candidate) => candidate.id === jobId
    ? { ...candidate, status: "completed", updatedAt: timestamp }
    : candidate);
  const status = jobs.every((candidate) => candidate.status === "completed") ? "completed" : "analyzing";
  return {
    library: updateGameAnalysis(library, job, "completed", result, now),
    batch: { ...batch, status, jobs, updatedAt: timestamp },
  };
}

export function failAnalysisJob(library, batch, jobId, error, now = new Date()) {
  const job = batch?.jobs?.find((candidate) => candidate.id === jobId);
  if (!job || job.status !== "analyzing") throw new Error("Analysis job is not active.");
  const timestamp = new Date(now).toISOString();
  const message = String(error?.message || error || "Analysis failed.").slice(0, 1_000);
  const jobs = batch.jobs.map((candidate) => candidate.id === jobId
    ? { ...candidate, status: "failed", error: message, updatedAt: timestamp }
    : candidate);
  return {
    library: updateGameAnalysis(library, job, "failed", { error: message }, now),
    batch: { ...batch, status: "failed", jobs, updatedAt: timestamp },
  };
}

export function retryFailedJobs(batch, now = new Date()) {
  const timestamp = new Date(now).toISOString();
  const jobs = (batch?.jobs || []).map((job) => ["failed", "analyzing"].includes(job.status)
    ? { ...job, status: "queued", workerId: null, error: null, updatedAt: timestamp }
    : job);
  return { ...batch, status: jobs.some((job) => job.status === "queued") ? "queued" : batch.status, jobs, updatedAt: timestamp };
}

export function analysisProgress(batch) {
  const jobs = batch?.jobs || [];
  return {
    total: jobs.length,
    completed: jobs.filter((job) => job.status === "completed").length,
    failed: jobs.filter((job) => job.status === "failed").length,
    analyzing: jobs.filter((job) => job.status === "analyzing").length,
    queued: jobs.filter((job) => job.status === "queued").length,
    reused: batch?.reusedCount || 0,
  };
}
