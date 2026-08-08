import { createNormalizedGame } from "./model.js";

export const GAME_LIBRARY_SCHEMA_VERSION = 1;

const validProvider = (value) => ["chesscom", "lichess", "manual"].includes(value);
const validCategory = (value) => [
  "bullet", "blitz", "rapid", "classical", "correspondence", "unknown",
].includes(value);

export function createGameLibrary(now = new Date()) {
  const timestamp = new Date(now).toISOString();
  return {
    version: GAME_LIBRARY_SCHEMA_VERSION,
    createdAt: timestamp,
    updatedAt: timestamp,
    accounts: {},
    games: [],
  };
}

export function accountKey(provider, username) {
  return `${provider}:${String(username || "").trim().toLowerCase()}`;
}

export function mergeSyncBatch(library, {
  provider,
  username,
  games = [],
  cursor = null,
  errors = [],
  now = new Date(),
} = {}) {
  if (!validProvider(provider)) throw new Error("Invalid sync provider.");
  const cleanUsername = String(username || "").trim();
  if (!cleanUsername) throw new Error("Sync username is missing.");
  const base = library?.version === GAME_LIBRARY_SCHEMA_VERSION
    ? library
    : createGameLibrary(now);
  const byId = new Map((base.games || []).map((game) => [game.id, game]));
  const fingerprintToId = new Map((base.games || []).map((game) => [game.fingerprint, game.id]));
  let imported = 0;
  let updated = 0;
  let duplicates = 0;
  const batchErrors = Array.isArray(errors) ? [...errors] : [];

  for (const input of games) {
    try {
      const game = createNormalizedGame(input, now);
      if (game.provider !== provider) throw new Error("Game provider does not match sync provider.");
      const existing = byId.get(game.id);
      const matchingFingerprintId = fingerprintToId.get(game.fingerprint);
      if (!existing && matchingFingerprintId) {
        duplicates += 1;
        continue;
      }
      if (existing) {
        byId.set(game.id, {
          ...game,
          importedAt: existing.importedAt,
          analysis: existing.analysis,
        });
        updated += 1;
      } else {
        byId.set(game.id, game);
        fingerprintToId.set(game.fingerprint, game.id);
        imported += 1;
      }
    } catch (error) {
      batchErrors.push({
        providerGameId: String(input?.providerGameId || ""),
        message: String(error?.message || error).slice(0, 1_000),
      });
    }
  }

  const syncedAt = new Date(now).toISOString();
  const key = accountKey(provider, cleanUsername);
  const previousAccount = base.accounts?.[key] || {};
  const next = {
    ...base,
    updatedAt: syncedAt,
    accounts: {
      ...(base.accounts || {}),
      [key]: {
        provider,
        username: cleanUsername,
        connectedAt: previousAccount.connectedAt || syncedAt,
        lastSyncAt: syncedAt,
        cursor,
        lastError: batchErrors.length ? batchErrors.at(-1)?.message || "" : "",
      },
    },
    games: Array.from(byId.values())
      .sort((left, right) => right.playedAt.localeCompare(left.playedAt)),
  };
  return { library: next, imported, updated, duplicates, errors: batchErrors };
}

function finiteRange(value) {
  if (!value || typeof value !== "object") return null;
  const min = value.min !== null && value.min !== undefined && value.min !== ""
    && Number.isFinite(Number(value.min)) ? Number(value.min) : null;
  const max = value.max !== null && value.max !== undefined && value.max !== ""
    && Number.isFinite(Number(value.max)) ? Number(value.max) : null;
  return min === null && max === null ? null : { min, max };
}

export function normalizeGameQuery(query = {}) {
  const providers = Array.isArray(query.providers)
    ? query.providers.filter(validProvider)
    : [];
  const timeControls = Array.isArray(query.timeControls)
    ? query.timeControls.filter(validCategory)
    : [];
  const lastN = Number.parseInt(query.lastN, 10);
  const parseBoundary = (value, endOfDay = false) => {
    if (!value) return null;
    const source = /^\d{4}-\d{2}-\d{2}$/u.test(String(value))
      ? `${value}T${endOfDay ? "23:59:59.999" : "00:00:00.000"}Z`
      : value;
    const timestamp = Date.parse(source);
    return Number.isFinite(timestamp) ? timestamp : null;
  };
  return {
    providers: [...new Set(providers)],
    timeControls: [...new Set(timeControls)],
    from: parseBoundary(query.from),
    to: parseBoundary(query.to, true),
    lastN: Number.isInteger(lastN) && lastN > 0 ? Math.min(lastN, 100_000) : null,
    rated: query.rated === true ? true : query.rated === false ? false : null,
    results: Array.isArray(query.results)
      ? query.results.filter((value) => ["win", "loss", "draw"].includes(value))
      : [],
    colors: Array.isArray(query.colors)
      ? query.colors.filter((value) => ["white", "black"].includes(value))
      : [],
    playerRating: finiteRange(query.playerRating),
    opponentRating: finiteRange(query.opponentRating),
    opening: String(query.opening || "").trim().toLowerCase(),
  };
}

function inRange(value, range) {
  if (!range) return true;
  if (!Number.isFinite(value)) return false;
  return (range.min === null || value >= range.min)
    && (range.max === null || value <= range.max);
}

export function filterGames(games, query = {}) {
  const filters = normalizeGameQuery(query);
  const filtered = (Array.isArray(games) ? games : [])
    .filter((game) => {
      if (filters.providers.length && !filters.providers.includes(game.provider)) return false;
      if (filters.timeControls.length && !filters.timeControls.includes(game.timeControl?.category)) return false;
      const playedAt = Date.parse(game.playedAt);
      if (filters.from !== null && playedAt < filters.from) return false;
      if (filters.to !== null && playedAt > filters.to) return false;
      if (filters.rated !== null && game.rated !== filters.rated) return false;
      if (filters.results.length && !filters.results.includes(game.result)) return false;
      if (filters.colors.length && !filters.colors.includes(game.userColor)) return false;
      const own = game.userColor === "white" ? game.white : game.black;
      const opponent = game.userColor === "white" ? game.black : game.white;
      if (!inRange(own?.rating, filters.playerRating)) return false;
      if (!inRange(opponent?.rating, filters.opponentRating)) return false;
      if (filters.opening) {
        const opening = `${game.opening?.eco || ""} ${game.opening?.name || ""}`.toLowerCase();
        if (!opening.includes(filters.opening)) return false;
      }
      return true;
    })
    .sort((left, right) => right.playedAt.localeCompare(left.playedAt));
  return filters.lastN ? filtered.slice(0, filters.lastN) : filtered;
}

export function previewGameQuery(games, query = {}) {
  const selected = filterGames(games, query);
  const byTimeControl = {};
  const byProvider = {};
  for (const game of selected) {
    const category = game.timeControl?.category || "unknown";
    byTimeControl[category] = (byTimeControl[category] || 0) + 1;
    byProvider[game.provider] = (byProvider[game.provider] || 0) + 1;
  }
  return { count: selected.length, byTimeControl, byProvider, gameIds: selected.map((game) => game.id) };
}

export function periodQuery(period, now = new Date()) {
  const current = new Date(now);
  const daysAgo = (days) => new Date(current.getTime() - days * 86_400_000).toISOString();
  if (/^last-(10|20|50|100|200)$/u.test(period)) return { lastN: Number(period.slice(5)) };
  if (period === "30-days") return { from: daysAgo(30) };
  if (period === "3-months") return { from: daysAgo(90) };
  if (period === "6-months") return { from: daysAgo(183) };
  if (period === "1-year") return { from: daysAgo(365) };
  return {};
}
