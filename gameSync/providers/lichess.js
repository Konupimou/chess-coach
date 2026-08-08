import { Chess } from "chess.js";
import { sanitizeLichessGame } from "../../api/lichess.js";
import { classifyTimeControl } from "../timeControl.js";
import { createNormalizedGame } from "../model.js";
import { GameProvider } from "../provider.js";
import { fetchWithRetry, ProviderHttpError } from "./http.js";

const ORIGIN = "https://lichess.org";
const BATCH_SIZE = 300;

export function validateLichessUsername(value) {
  const username = String(value || "").trim();
  if (!/^[A-Za-z0-9_-]{1,32}$/u.test(username)) throw new Error("Invalid Lichess username.");
  return username;
}

function identity(player) {
  return String(player?.user?.id || player?.user?.name || "").trim().toLowerCase();
}

function displayName(player) {
  return String(player?.user?.name || player?.user?.id || "Anonymous").trim();
}

function pgnFromLichessGame(game) {
  const chess = game.initialFen && game.initialFen !== "startpos"
    ? new Chess(game.initialFen)
    : new Chess();
  for (const san of String(game.moves || "").trim().split(/\s+/u).filter(Boolean)) {
    const move = chess.move(san, { strict: false });
    if (!move) throw new Error(`Lichess move could not be parsed: ${san}`);
  }
  const result = game.winner === "white" ? "1-0" : game.winner === "black" ? "0-1" : "1/2-1/2";
  chess.setHeader("Event", game.rated ? "Rated Lichess game" : "Casual Lichess game");
  chess.setHeader("Site", `${ORIGIN}/${game.id}`);
  chess.setHeader("Date", new Date(game.createdAt).toISOString().slice(0, 10).replaceAll("-", "."));
  chess.setHeader("White", displayName(game.players?.white));
  chess.setHeader("Black", displayName(game.players?.black));
  chess.setHeader("Result", result);
  if (game.initialFen && game.initialFen !== "startpos") {
    chess.setHeader("SetUp", "1");
    chess.setHeader("FEN", game.initialFen);
  }
  return chess.pgn({ maxWidth: 0, newline: "\n" });
}

export function normalizeLichessGame(input, username, now = new Date()) {
  const game = sanitizeLichessGame(input);
  if (!game) throw new Error("Lichess game is invalid.");
  if (game.variant !== "standard") throw new Error("Only standard chess is supported.");
  if (!game.moves?.trim()) throw new Error("Lichess game contains no moves.");
  if (["created", "started", "aborted", "noStart"].includes(game.status)) {
    throw new Error("Lichess game is not complete.");
  }
  const cleanUsername = validateLichessUsername(username);
  const userIdentity = cleanUsername.toLowerCase();
  const userColor = identity(game.players?.white) === userIdentity
    ? "white"
    : identity(game.players?.black) === userIdentity ? "black" : null;
  if (!userColor) throw new Error("Lichess player could not be matched to the game.");
  const result = !game.winner
    ? "draw"
    : game.winner === userColor ? "win" : "loss";
  const rawTimeControl = Number.isInteger(game.clock?.initial)
    ? `${game.clock.initial}+${game.clock.increment || 0}`
    : Number.isInteger(game.daysPerTurn) ? `${game.daysPerTurn}d/turn` : "";
  return createNormalizedGame({
    provider: "lichess",
    providerGameId: game.id,
    providerUrl: `${ORIGIN}/${game.id}`,
    username: cleanUsername,
    playedAt: game.createdAt,
    white: { username: displayName(game.players?.white), rating: game.players?.white?.rating },
    black: { username: displayName(game.players?.black), rating: game.players?.black?.rating },
    userColor,
    result,
    rated: game.rated,
    timeControl: classifyTimeControl({
      initialSeconds: game.clock?.initial,
      incrementSeconds: game.clock?.increment,
      providerCategory: game.speed || game.perf,
      raw: rawTimeControl,
      correspondenceDaysPerTurn: game.daysPerTurn,
    }),
    pgn: pgnFromLichessGame(game),
    opening: { eco: game.opening?.eco, name: game.opening?.name },
    metadata: {
      source: "lichess-api",
      status: game.status,
      lastMoveAt: game.lastMoveAt,
      rawSpeed: game.speed,
      rawPerf: game.perf,
      rawTimeControl,
    },
  }, now);
}

export async function fetchLichessPublicGames({
  username,
  cursor,
  token = "",
  fetchImpl = fetch,
  now = new Date(),
} = {}) {
  const cleanUsername = validateLichessUsername(username);
  const fullHistoryComplete = cursor?.fullHistoryComplete === true;
  const latestGameTimestamp = Number.isFinite(Number(cursor?.latestGameTimestamp))
    ? Number(cursor.latestGameTimestamp)
    : null;
  const until = Number.isFinite(Number(cursor?.until)) ? Number(cursor.until) : null;
  const url = new URL(`/api/games/user/${encodeURIComponent(cleanUsername)}`, ORIGIN);
  url.searchParams.set("max", String(BATCH_SIZE));
  url.searchParams.set("finished", "true");
  url.searchParams.set("ongoing", "false");
  url.searchParams.set("moves", "true");
  url.searchParams.set("tags", "true");
  url.searchParams.set("clocks", "false");
  url.searchParams.set("opening", "true");
  url.searchParams.set("sort", "dateDesc");
  if (fullHistoryComplete && latestGameTimestamp) {
    url.searchParams.set("since", String(latestGameTimestamp + 1));
  } else if (until) {
    url.searchParams.set("until", String(until));
  }
  const response = await fetchWithRetry(url, {
    headers: {
      Accept: "application/x-ndjson",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    cache: "no-store",
  }, fetchImpl);
  if (response.status === 404) throw new ProviderHttpError("Lichess account was not found.", 404);
  if (!response.ok) throw new ProviderHttpError(`Lichess request failed (${response.status}).`, response.status);
  const body = await response.text();
  if (body.length > 12_000_000) throw new ProviderHttpError("Lichess response is too large.");
  const rawGames = body.split(/\r?\n/u).filter(Boolean).map((line) => {
    try { return JSON.parse(line); } catch { return null; }
  }).filter(Boolean);
  const games = [];
  const errors = [];
  for (const rawGame of rawGames) {
    try {
      games.push(normalizeLichessGame(rawGame, cleanUsername, now));
    } catch (error) {
      errors.push({ providerGameId: String(rawGame?.id || ""), message: error.message });
    }
  }
  const timestamps = games.map((game) => Date.parse(game.playedAt));
  const nextLatest = Math.max(latestGameTimestamp || 0, ...timestamps) || null;
  const oldest = timestamps.length ? Math.min(...timestamps) : null;
  const hasMore = !fullHistoryComplete && rawGames.length === BATCH_SIZE && Number.isFinite(oldest);
  return {
    username: cleanUsername,
    games,
    errors,
    hasMore,
    cursor: {
      fullHistoryComplete: fullHistoryComplete || !hasMore,
      latestGameTimestamp: nextLatest,
      until: hasMore ? oldest - 1 : null,
    },
  };
}

export const LichessProvider = new GameProvider({
  id: "lichess",
  validateUsername: validateLichessUsername,
  fetchGames: fetchLichessPublicGames,
  normalizeGame: normalizeLichessGame,
  getGameId: (game) => String(game?.id || ""),
});
