import test from "node:test";
import assert from "node:assert/strict";
import { createNormalizedGame } from "../gameSync/model.js";
import { classifyTimeControl } from "../gameSync/timeControl.js";
import {
  createGameLibrary,
  filterGames,
  mergeSyncBatch,
  periodQuery,
  previewGameQuery,
} from "../gameSync/library.js";

const pgn = `[Result "1-0"]\n\n1. e4 e5 2. Nf3 Nc6 1-0`;
function game(id, provider, playedAt, category = "rapid", extra = {}) {
  return createNormalizedGame({
    provider,
    providerGameId: id,
    username: "Paul",
    playedAt,
    white: { username: "Paul", rating: 1500 },
    black: { username: `Opponent-${id}`, rating: 1490 },
    userColor: "white",
    result: "win",
    rated: true,
    timeControl: classifyTimeControl({ providerCategory: category, raw: "600" }),
    pgn,
    ...extra,
  }, new Date("2026-08-07T00:00:00Z"));
}

test("sync deduplicates overlapping provider batches and advances account cursor", () => {
  const first = mergeSyncBatch(createGameLibrary(), {
    provider: "chesscom", username: "Paul",
    games: [game("1", "chesscom", "2026-08-01")],
    cursor: { latestGameTimestamp: 1 },
  });
  const second = mergeSyncBatch(first.library, {
    provider: "chesscom", username: "Paul",
    games: [game("1", "chesscom", "2026-08-01"), game("2", "chesscom", "2026-08-02")],
    cursor: { latestGameTimestamp: 2 },
  });
  assert.equal(first.imported, 1);
  assert.equal(second.imported, 1);
  assert.equal(second.updated, 1);
  assert.equal(second.library.games.length, 2);
  assert.equal(second.library.accounts["chesscom:paul"].cursor.latestGameTimestamp, 2);
});

test("multiple providers share one game library without provider-specific queries", () => {
  const chesscom = mergeSyncBatch(createGameLibrary(), {
    provider: "chesscom", username: "Paul",
    games: [game("cc", "chesscom", "2026-08-01")],
  }).library;
  const both = mergeSyncBatch(chesscom, {
    provider: "lichess", username: "Paul",
    games: [game("li", "lichess", "2026-08-02", "blitz")],
  }).library;
  assert.equal(both.games.length, 2);
  assert.equal(filterGames(both.games, { providers: ["lichess"] })[0].id, "lichess:li");
});

test("fallback fingerprints deduplicate the exact same game across import sources", () => {
  const shared = {
    playedAt: "2026-08-01T12:00:00Z",
    black: { username: "SameOpponent", rating: 1490 },
  };
  const first = mergeSyncBatch(createGameLibrary(), {
    provider: "chesscom", username: "Paul",
    games: [game("cc", "chesscom", shared.playedAt, "rapid", { black: shared.black })],
  }).library;
  const second = mergeSyncBatch(first, {
    provider: "lichess", username: "Paul",
    games: [game("li", "lichess", shared.playedAt, "rapid", { black: shared.black })],
  });
  assert.equal(second.imported, 0);
  assert.equal(second.duplicates, 1);
  assert.equal(second.library.games.length, 1);
});

test("date, last-N, time-control, and combined filters produce exact previews", () => {
  const games = [
    game("1", "chesscom", "2026-01-01", "rapid"),
    game("2", "chesscom", "2026-06-01", "blitz"),
    game("3", "lichess", "2026-07-01", "rapid"),
    game("4", "lichess", "2026-08-01", "classical"),
  ];
  assert.equal(filterGames(games, { from: "2026-06-15" }).length, 2);
  assert.deepEqual(filterGames(games, { lastN: 2 }).map((item) => item.providerGameId), ["4", "3"]);
  assert.equal(filterGames(games, { timeControls: ["rapid"] }).length, 2);
  const preview = previewGameQuery(games, {
    providers: ["lichess"], timeControls: ["rapid", "classical"], lastN: 2, rated: true,
  });
  assert.equal(preview.count, 2);
  assert.deepEqual(preview.byTimeControl, { classical: 1, rapid: 1 });
  assert.deepEqual(preview.byProvider, { lichess: 2 });
});

test("period presets support recent game counts and rolling dates", () => {
  assert.deepEqual(periodQuery("last-100"), { lastN: 100 });
  assert.equal(periodQuery("6-months", new Date("2026-08-07T00:00:00Z")).from, "2026-02-05T00:00:00.000Z");
});
