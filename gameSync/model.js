import { Chess } from "chess.js";
import { TIME_CONTROL_CATEGORIES } from "./timeControl.js";

export const GAME_PROVIDERS = Object.freeze(["chesscom", "lichess", "manual"]);
export const ANALYSIS_STATES = Object.freeze([
  "pending",
  "queued",
  "analyzing",
  "completed",
  "failed",
]);

function text(value, maximum = 500) {
  return String(value ?? "").trim().slice(0, maximum);
}

function rating(value) {
  const number = Number.parseInt(value, 10);
  return Number.isInteger(number) && number >= 0 && number <= 5_000 ? number : null;
}

function isoDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error("Game timestamp is invalid.");
  return date.toISOString();
}

function safeJson(value) {
  if (!value || typeof value !== "object") return {};
  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    return {};
  }
}

export function validatePgn(pgn) {
  const source = text(pgn, 100_000);
  if (!source) throw new Error("Game PGN is missing.");
  const game = new Chess();
  try {
    game.loadPgn(source, { strict: false });
  } catch (error) {
    throw new Error(`Game PGN is malformed: ${String(error?.message || error).slice(0, 160)}`);
  }
  if (game.history().length === 0) throw new Error("Game PGN contains no moves.");
  return source;
}

function hash(value) {
  let first = 0x811c9dc5;
  let second = 0x9e3779b9;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    first = Math.imul(first ^ code, 0x01000193) >>> 0;
    second = Math.imul(second ^ code, 0x85ebca6b) >>> 0;
  }
  return `${first.toString(16).padStart(8, "0")}${second.toString(16).padStart(8, "0")}`;
}

export function gameFingerprint({ playedAt, white, black, result, pgn }) {
  const game = new Chess();
  game.loadPgn(pgn, { strict: false });
  const moves = game.history().join(" ").toLowerCase();
  const timestamp = new Date(playedAt).toISOString().slice(0, 16);
  return hash([
    text(white?.username, 80).toLowerCase(),
    text(black?.username, 80).toLowerCase(),
    timestamp,
    result,
    moves,
  ].join("|"));
}

export function createAnalysisState(value = {}, importedAt = new Date().toISOString()) {
  const state = ANALYSIS_STATES.includes(value?.state) ? value.state : "pending";
  return {
    state,
    version: text(value?.version, 80) || null,
    profile: text(value?.profile, 40) || null,
    attempts: Math.max(0, Number.parseInt(value?.attempts, 10) || 0),
    error: text(value?.error, 1_000) || null,
    updatedAt: (() => {
      try { return isoDate(value?.updatedAt || importedAt); } catch { return importedAt; }
    })(),
    findings: Array.isArray(value?.findings) ? safeJson(value.findings) : [],
    context: value?.context && typeof value.context === "object" ? safeJson(value.context) : null,
    review: value?.review && typeof value.review === "object" ? safeJson(value.review) : null,
  };
}

export function createNormalizedGame(input, now = new Date()) {
  const provider = text(input?.provider, 20).toLowerCase();
  if (!GAME_PROVIDERS.includes(provider)) throw new Error("Game provider is invalid.");
  const providerGameId = text(input?.providerGameId, 160);
  if (!providerGameId) throw new Error("Provider game ID is missing.");
  const username = text(input?.username, 80);
  if (!username) throw new Error("Synced username is missing.");
  const playedAt = isoDate(input?.playedAt);
  const importedAt = isoDate(input?.importedAt || now);
  const pgn = validatePgn(input?.pgn);
  const timeControl = input?.timeControl && typeof input.timeControl === "object"
    ? safeJson(input.timeControl)
    : null;
  if (!timeControl || !TIME_CONTROL_CATEGORIES.includes(timeControl.category)) {
    throw new Error("Normalized time control is invalid.");
  }
  const userColor = input?.userColor === "white" || input?.userColor === "black"
    ? input.userColor
    : null;
  if (!userColor) throw new Error("User color is invalid.");
  const result = ["win", "loss", "draw"].includes(input?.result) ? input.result : null;
  if (!result) throw new Error("User result is invalid.");
  const normalized = {
    schemaVersion: 1,
    id: `${provider}:${providerGameId}`,
    provider,
    providerGameId,
    providerUrl: text(input?.providerUrl, 500),
    username,
    playedAt,
    white: {
      username: text(input?.white?.username, 80) || "Unknown",
      rating: rating(input?.white?.rating),
    },
    black: {
      username: text(input?.black?.username, 80) || "Unknown",
      rating: rating(input?.black?.rating),
    },
    userColor,
    result,
    rated: input?.rated === true ? true : input?.rated === false ? false : null,
    timeControl,
    pgn,
    opening: {
      eco: text(input?.opening?.eco, 12),
      name: text(input?.opening?.name, 160),
    },
    analysis: createAnalysisState(input?.analysis, importedAt),
    importedAt,
    metadata: safeJson(input?.metadata),
  };
  normalized.fingerprint = text(input?.fingerprint, 80)
    || gameFingerprint(normalized);
  return normalized;
}

export function isNormalizedGame(value) {
  try {
    createNormalizedGame(value, new Date(value?.importedAt || 0));
    return true;
  } catch {
    return false;
  }
}
