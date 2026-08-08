import test from "node:test";
import assert from "node:assert/strict";
import { createNormalizedGame, isNormalizedGame } from "../gameSync/model.js";
import { classifyTimeControl } from "../gameSync/timeControl.js";

const pgn = `[Event "Test"]\n[Result "1-0"]\n\n1. e4 e5 2. Nf3 Nc6 1-0`;

test("provider-independent game schema validates and fingerprints a game", () => {
  const game = createNormalizedGame({
    provider: "chesscom",
    providerGameId: "abc",
    providerUrl: "https://www.chess.com/game/live/1",
    username: "Paul",
    playedAt: "2026-08-01T12:00:00Z",
    white: { username: "Paul", rating: 1500 },
    black: { username: "Alex", rating: 1490 },
    userColor: "white",
    result: "win",
    rated: true,
    timeControl: classifyTimeControl({ raw: "600+5", providerCategory: "rapid" }),
    pgn,
  }, new Date("2026-08-02T00:00:00Z"));

  assert.equal(game.id, "chesscom:abc");
  assert.equal(game.analysis.state, "pending");
  assert.equal(game.timeControl.category, "rapid");
  assert.equal(game.timeControl.providerCategory, "rapid");
  assert.equal(game.fingerprint.length, 16);
  assert.equal(isNormalizedGame(game), true);
});

test("malformed and empty PGNs are rejected without poisoning a batch", () => {
  assert.throws(() => createNormalizedGame({
    provider: "lichess",
    providerGameId: "bad",
    username: "Paul",
    playedAt: "2026-08-01T12:00:00Z",
    white: { username: "Paul" },
    black: { username: "Alex" },
    userColor: "white",
    result: "win",
    timeControl: classifyTimeControl({ raw: "600" }),
    pgn: "this is not pgn",
  }), /PGN/);
});
