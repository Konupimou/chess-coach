import test from "node:test";
import assert from "node:assert/strict";
import { createNormalizedGame } from "../gameSync/model.js";
import { classifyTimeControl } from "../gameSync/timeControl.js";
import { createGameLibrary, mergeSyncBatch } from "../gameSync/library.js";
import {
  analysisProgress,
  claimNextJob,
  createAnalysisBatch,
  failAnalysisJob,
  finishAnalysisJob,
  retryFailedJobs,
} from "../gameSync/analysisQueue.js";
import { normalizedGameToSavedRecord } from "../gameSync/analysisAdapter.js";

const pgn = `[Result "1-0"]\n\n1. e4 e5 2. Nf3 Nc6 1-0`;
function syncedGame(id, analysis) {
  return createNormalizedGame({
    provider: "lichess", providerGameId: id, username: "Paul", playedAt: `2026-08-0${id}T12:00:00Z`,
    white: { username: "Paul", rating: 1500 }, black: { username: "Alex", rating: 1490 },
    userColor: "white", result: "win", rated: true,
    timeControl: classifyTimeControl({ raw: "600+0", providerCategory: "rapid" }),
    pgn, analysis,
  });
}

test("analysis batches reuse only current-version results and queue games individually", () => {
  const library = mergeSyncBatch(createGameLibrary(), {
    provider: "lichess", username: "Paul",
    games: [
      syncedGame("1", { state: "completed", version: "v2", profile: "standard" }),
      syncedGame("2", { state: "completed", version: "v1", profile: "standard" }),
      syncedGame("3"),
    ],
  }).library;
  const created = createAnalysisBatch(library, { timeControls: ["rapid"] }, { analysisVersion: "v2" });
  assert.equal(created.batch.selectedCount, 3);
  assert.equal(created.batch.reusedCount, 1);
  assert.equal(created.batch.jobs.length, 2);
  assert.ok(created.batch.jobs.every((job) => job.context.timeControl.category === "rapid"));
});

test("queue progress, failures, retries, and findings preserve analysis context", () => {
  let library = mergeSyncBatch(createGameLibrary(), {
    provider: "lichess", username: "Paul", games: [syncedGame("1"), syncedGame("2")],
  }).library;
  let { batch, library: queuedLibrary } = createAnalysisBatch(library, {}, { analysisVersion: "v2" });
  library = queuedLibrary;
  let claimed = claimNextJob(batch, "worker-1");
  batch = claimed.batch;
  let finished = finishAnalysisJob(library, batch, claimed.job.id, {
    findings: [{ ply: 2, classification: "mistake", patterns: ["hanging_piece"] }],
  });
  library = finished.library;
  batch = finished.batch;
  claimed = claimNextJob(batch, "worker-1");
  const failed = failAnalysisJob(library, claimed.batch, claimed.job.id, new Error("Stockfish stopped"));
  assert.deepEqual(analysisProgress(failed.batch), {
    total: 2, completed: 1, failed: 1, analyzing: 0, queued: 0, reused: 0,
  });
  assert.equal(failed.library.games.find((game) => game.id === "lichess:1").analysis.context.playerRating, 1500);
  assert.equal(retryFailedJobs(failed.batch).jobs[1].status, "queued");
});

test("normalized games adapt to the existing move-tree analysis pipeline", () => {
  const record = normalizedGameToSavedRecord(syncedGame("1"));
  assert.equal(record.id, "lichess:1");
  assert.equal(record.plyCount, 4);
  assert.equal(record.metadata.timeFormat, "rapid");
  assert.equal(record.metadata.playerRating, 1500);
  assert.ok(record.tree.root.mainline);
});
