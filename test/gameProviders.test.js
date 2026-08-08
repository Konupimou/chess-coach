import test from "node:test";
import assert from "node:assert/strict";
import {
  fetchChessComGames,
  normalizeChessComGame,
} from "../gameSync/providers/chessCom.js";
import {
  fetchLichessPublicGames,
  normalizeLichessGame,
} from "../gameSync/providers/lichess.js";

const chessPgn = `[Event "Live Chess"]\n[White "Paul"]\n[Black "Alex"]\n[Result "1-0"]\n[TimeControl "600+5"]\n\n1. e4 e5 2. Nf3 Nc6 1-0`;

test("Chess.com games normalize into the provider-independent schema", () => {
  const game = normalizeChessComGame({
    uuid: "cc-1",
    url: "https://www.chess.com/game/live/123",
    pgn: chessPgn,
    end_time: 1_800_000_000,
    rated: true,
    time_control: "600+5",
    time_class: "rapid",
    rules: "chess",
    white: { username: "Paul", rating: 1550, result: "win" },
    black: { username: "Alex", rating: 1530, result: "resigned" },
  }, "paul");
  assert.equal(game.provider, "chesscom");
  assert.equal(game.result, "win");
  assert.equal(game.userColor, "white");
  assert.equal(game.timeControl.category, "rapid");
  assert.equal(game.timeControl.raw, "600+5");
});

test("Lichess games normalize into the same schema", () => {
  const game = normalizeLichessGame({
    id: "AbCd1234",
    rated: true,
    variant: "standard",
    speed: "blitz",
    perf: "blitz",
    createdAt: 1_800_000_000_000,
    lastMoveAt: 1_800_000_100_000,
    status: "resign",
    winner: "black",
    moves: "e4 e5 Nf3 Nc6",
    players: {
      white: { user: { id: "alex", name: "Alex" }, rating: 1500 },
      black: { user: { id: "paul", name: "Paul" }, rating: 1510 },
    },
    clock: { initial: 180, increment: 2 },
  }, "Paul");
  assert.equal(game.provider, "lichess");
  assert.equal(game.result, "win");
  assert.equal(game.userColor, "black");
  assert.equal(game.timeControl.category, "blitz");
  assert.equal(game.analysis.state, "pending");
});

test("Chess.com sync backfills incrementally and uses conditional archive requests", async () => {
  const archives = ["2026/06", "2026/07", "2026/08"].map((month) => `https://api.chess.com/pub/player/Paul/games/${month}`);
  const fetchImpl = async (input) => {
    const url = String(input);
    if (url.endsWith("/archives")) return Response.json({ archives });
    const month = url.slice(-2);
    return Response.json({ games: [{
      uuid: `game-${month}`,
      url: `https://www.chess.com/game/live/${month}`,
      pgn: chessPgn,
      end_time: 1_800_000_000 + Number(month),
      rated: true,
      time_control: "600",
      time_class: "rapid",
      rules: "chess",
      white: { username: "Paul", rating: 1500, result: "win" },
      black: { username: "Alex", rating: 1490, result: "resigned" },
    }] }, { headers: { ETag: `etag-${month}` } });
  };
  const first = await fetchChessComGames({ username: "Paul", fetchImpl });
  assert.equal(first.games.length, 3);
  assert.equal(first.cursor.fullHistoryComplete, true);

  const secondFetch = async (input, options = {}) => {
    const url = String(input);
    if (url.endsWith("/archives")) return Response.json({ archives });
    assert.match(options.headers["If-None-Match"], /^etag-/u);
    return new Response(null, { status: 304 });
  };
  const second = await fetchChessComGames({ username: "Paul", cursor: first.cursor, fetchImpl: secondFetch });
  assert.equal(second.games.length, 0);
  assert.equal(second.cursor.fullHistoryComplete, true);
});

test("Chess.com backfill keeps older pages, then limits later syncs to recent months", async () => {
  const archives = ["2026/05", "2026/06", "2026/07", "2026/08"].map((month) => `https://api.chess.com/pub/player/Paul/games/${month}`);
  const requestedArchives = [];
  const fetchImpl = async (input) => {
    const url = String(input);
    if (url.endsWith("/archives")) return Response.json({ archives });
    requestedArchives.push(url);
    const month = url.slice(-2);
    return Response.json({ games: [{
      uuid: `game-${month}`, url: `https://www.chess.com/game/live/${month}`,
      pgn: chessPgn, end_time: Date.UTC(2026, Number(month) - 1, 15) / 1_000, rated: true,
      time_control: "600", time_class: "rapid", rules: "chess",
      white: { username: "Paul", rating: 1500, result: "win" },
      black: { username: "Alex", rating: 1490, result: "resigned" },
    }] });
  };
  const first = await fetchChessComGames({ username: "Paul", fetchImpl });
  assert.equal(first.hasMore, true);
  const second = await fetchChessComGames({ username: "Paul", cursor: first.cursor, fetchImpl });
  assert.equal(second.games.length, 1);
  assert.equal(second.cursor.mode, "incremental");
  requestedArchives.length = 0;
  await fetchChessComGames({ username: "Paul", cursor: second.cursor, fetchImpl });
  assert.equal(requestedArchives.length, 1);
});

test("Lichess sync uses since after history is complete and isolates malformed games", async () => {
  let requestedUrl;
  const valid = {
    id: "AbCd1234", rated: true, variant: "standard", speed: "rapid", perf: "rapid",
    createdAt: 1_800_000_000_000, status: "mate", winner: "white", moves: "e4 e5",
    players: {
      white: { user: { id: "paul", name: "Paul" }, rating: 1500 },
      black: { user: { id: "alex", name: "Alex" }, rating: 1490 },
    },
    clock: { initial: 600, increment: 0 },
  };
  const result = await fetchLichessPublicGames({
    username: "Paul",
    cursor: { fullHistoryComplete: true, latestGameTimestamp: 1_700_000_000_000 },
    fetchImpl: async (input) => {
      requestedUrl = new URL(input);
      return new Response(`${JSON.stringify(valid)}\n${JSON.stringify({ ...valid, id: "BadGame1", moves: "illegal" })}\n`);
    },
  });
  assert.equal(requestedUrl.searchParams.get("since"), "1700000000001");
  assert.equal(result.games.length, 1);
  assert.equal(result.errors.length, 1);
});

test("provider API errors are surfaced with useful status", async () => {
  await assert.rejects(
    () => fetchLichessPublicGames({
      username: "Paul",
      fetchImpl: async () => new Response("rate limited", { status: 429 }),
    }),
    (error) => error.status === 429,
  );
});
