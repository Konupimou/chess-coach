import { classifyTimeControl, parseTimeControl } from "../timeControl.js";
import { createNormalizedGame } from "../model.js";
import { GameProvider } from "../provider.js";
import { fetchWithRetry, jsonResponse, ProviderHttpError } from "./http.js";

const ORIGIN = "https://api.chess.com";
const ARCHIVES_PER_BATCH = 3;

export function validateChessComUsername(value) {
  const username = String(value || "").trim();
  if (!/^[A-Za-z0-9_-]{1,32}$/u.test(username)) {
    throw new Error("Invalid Chess.com username.");
  }
  return username;
}

function playerResult(game, userColor) {
  const own = game[userColor];
  const opponent = game[userColor === "white" ? "black" : "white"];
  if (own?.result === "win") return "win";
  if (opponent?.result === "win") return "loss";
  return "draw";
}

export function chessComGameId(game) {
  const uuid = String(game?.uuid || "").trim();
  if (uuid) return uuid;
  const match = String(game?.url || "").match(/\/game\/(?:live|daily)\/(\d+)/u);
  return match?.[1] || "";
}

export function normalizeChessComGame(game, username, now = new Date()) {
  if (!game || typeof game !== "object") throw new Error("Chess.com game is invalid.");
  if (game.rules && game.rules !== "chess") throw new Error("Only standard chess is supported.");
  const identity = validateChessComUsername(username).toLowerCase();
  const whiteName = String(game.white?.username || "").trim();
  const blackName = String(game.black?.username || "").trim();
  const userColor = whiteName.toLowerCase() === identity
    ? "white"
    : blackName.toLowerCase() === identity ? "black" : null;
  if (!userColor) throw new Error("Chess.com player could not be matched to the game.");
  const providerGameId = chessComGameId(game);
  if (!providerGameId) throw new Error("Chess.com game ID is missing.");
  const rawTimeControl = String(game.time_control || "").trim();
  const parsed = parseTimeControl(rawTimeControl);
  return createNormalizedGame({
    provider: "chesscom",
    providerGameId,
    providerUrl: game.url,
    username,
    playedAt: Number(game.end_time) * 1_000,
    white: { username: whiteName, rating: game.white?.rating },
    black: { username: blackName, rating: game.black?.rating },
    userColor,
    result: playerResult(game, userColor),
    rated: game.rated,
    timeControl: classifyTimeControl({
      ...parsed,
      raw: rawTimeControl,
      providerCategory: game.time_class,
    }),
    pgn: game.pgn,
    opening: { eco: "", name: game.eco },
    metadata: {
      source: "chess.com-pubapi",
      rules: game.rules || "chess",
      providerResult: {
        white: game.white?.result || "",
        black: game.black?.result || "",
      },
      accuracies: game.accuracies || null,
      rawTimeControl,
      rawTimeClass: String(game.time_class || ""),
    },
  }, now);
}

function archiveMonth(url) {
  const match = String(url).match(/\/(\d{4})\/(\d{2})$/u);
  return match ? `${match[1]}-${match[2]}` : "";
}

function monthOfTimestamp(timestamp) {
  if (!Number.isFinite(Number(timestamp))) return "";
  return new Date(Number(timestamp)).toISOString().slice(0, 7);
}

function safeCursor(value) {
  return {
    mode: value?.mode === "incremental" ? "incremental" : "backfill",
    archiveIndex: Math.max(0, Number.parseInt(value?.archiveIndex, 10) || 0),
    fullHistoryComplete: value?.fullHistoryComplete === true,
    latestGameTimestamp: Number.isFinite(Number(value?.latestGameTimestamp))
      ? Number(value.latestGameTimestamp)
      : null,
    validators: value?.validators && typeof value.validators === "object"
      ? value.validators
      : {},
  };
}

function requestHeaders(userAgent, validator) {
  return {
    Accept: "application/json",
    "User-Agent": userAgent,
    ...(validator?.etag ? { "If-None-Match": validator.etag } : {}),
    ...(validator?.lastModified ? { "If-Modified-Since": validator.lastModified } : {}),
  };
}

export async function fetchChessComGames({
  username,
  cursor,
  fetchImpl = fetch,
  now = new Date(),
  userAgent = process.env.CHESSCOM_USER_AGENT
    || "Chess-Coach/1.0 (public-game-sync; contact: admin@localhost.invalid)",
} = {}) {
  const cleanUsername = validateChessComUsername(username);
  const state = safeCursor(cursor);
  const archivesUrl = `${ORIGIN}/pub/player/${encodeURIComponent(cleanUsername)}/games/archives`;
  const archivesResponse = await fetchWithRetry(
    archivesUrl,
    { headers: requestHeaders(userAgent) },
    fetchImpl,
  );
  const archivePayload = await jsonResponse(archivesResponse, "Chess.com account was not found.");
  const allArchives = Array.isArray(archivePayload.archives)
    ? archivePayload.archives
      .filter((url) => String(url).startsWith(`${ORIGIN}/pub/player/`))
      .sort()
      .reverse()
    : [];

  let mode = state.mode;
  let relevantArchives = allArchives;
  if (state.fullHistoryComplete && cursor?.mode !== "backfill") mode = "incremental";
  if (mode === "incremental") {
    const cutoffMonth = monthOfTimestamp(state.latestGameTimestamp);
    relevantArchives = cutoffMonth
      ? allArchives.filter((url) => archiveMonth(url) >= cutoffMonth)
      : allArchives.slice(0, 1);
  }
  const selected = relevantArchives.slice(
    state.archiveIndex,
    state.archiveIndex + ARCHIVES_PER_BATCH,
  );
  const rawGames = [];
  const validators = { ...state.validators };
  for (const archiveUrl of selected) {
    const key = archiveMonth(archiveUrl);
    const response = await fetchWithRetry(
      archiveUrl,
      { headers: requestHeaders(userAgent, validators[key]) },
      fetchImpl,
    );
    if (response.status === 304) continue;
    const payload = await jsonResponse(response, "Chess.com archive is unavailable.");
    if (Array.isArray(payload.games)) rawGames.push(...payload.games);
    validators[key] = {
      etag: response.headers.get("etag") || "",
      lastModified: response.headers.get("last-modified") || "",
    };
  }

  const games = [];
  const errors = [];
  for (const rawGame of rawGames) {
    try {
      const game = normalizeChessComGame(rawGame, cleanUsername, now);
      if (mode === "backfill" || !state.latestGameTimestamp || Date.parse(game.playedAt) > state.latestGameTimestamp) {
        games.push(game);
      }
    } catch (error) {
      errors.push({ providerGameId: chessComGameId(rawGame), message: error.message });
    }
  }
  const latestGameTimestamp = Math.max(
    state.latestGameTimestamp || 0,
    ...games.map((game) => Date.parse(game.playedAt)),
  ) || null;
  const nextIndex = state.archiveIndex + selected.length;
  const hasMore = nextIndex < relevantArchives.length;
  return {
    username: cleanUsername,
    games,
    errors,
    hasMore,
    cursor: {
      mode: hasMore ? mode : "incremental",
      archiveIndex: hasMore ? nextIndex : 0,
      fullHistoryComplete: mode === "backfill" ? !hasMore : true,
      latestGameTimestamp,
      validators: Object.fromEntries(Object.entries(validators).slice(0, 6)),
    },
  };
}

export const ChessComProvider = new GameProvider({
  id: "chesscom",
  validateUsername: validateChessComUsername,
  fetchGames: fetchChessComGames,
  normalizeGame: normalizeChessComGame,
  getGameId: chessComGameId,
});

export { ProviderHttpError };
