import { MoveTreeNode } from "./moveTree.js";

export const ACCOUNT_SCHEMA_VERSION = 1;
export const ACCOUNT_STORAGE_PREFIX = "chess-coach.account.v1";
export const MAX_SAVED_GAMES = 40;
const MAX_DELETION_TOMBSTONES = 200;
const MAX_TREE_NODES = 1_200;

function cleanText(value, maximum = 120) {
  return typeof value === "string" ? value.trim().slice(0, maximum) : "";
}

export function storageKeyForIdentity(identity) {
  const email = cleanText(identity?.email, 254).toLowerCase();
  return email
    ? `${ACCOUNT_STORAGE_PREFIX}:${encodeURIComponent(email)}`
    : `${ACCOUNT_STORAGE_PREFIX}:local`;
}

export function createAccountState(profile = {}, now = new Date().toISOString()) {
  const email = cleanText(profile.email, 254).toLowerCase();
  const name = cleanText(profile.name, 80) || (email ? email.split("@")[0] : "Schachspieler");
  return {
    version: ACCOUNT_SCHEMA_VERSION,
    profile: {
      name,
      email,
      source: profile.source === "sites" ? "sites" : "local",
    },
    createdAt: now,
    updatedAt: now,
    games: [],
    deletedGames: [],
  };
}

function normalizeDeletion(record) {
  if (!record || typeof record !== "object") return null;
  const id = cleanText(record.id, 100);
  if (!id) return null;
  return {
    id,
    deletedAt: cleanText(record.deletedAt, 40) || new Date().toISOString(),
  };
}

function normalizeGameRecord(record) {
  if (!record || typeof record !== "object" || !record.id || !record.tree) return null;
  return {
    id: cleanText(record.id, 100),
    title: cleanText(record.title, 100) || "Gespeicherte Partie",
    createdAt: cleanText(record.createdAt, 40) || new Date().toISOString(),
    updatedAt: cleanText(record.updatedAt, 40) || new Date().toISOString(),
    result: ["1-0", "0-1", "1/2-1/2"].includes(record.result) ? record.result : "*",
    plyCount: Math.max(0, Math.min(300, Number.parseInt(record.plyCount, 10) || 0)),
    currentFen: cleanText(record.currentFen, 120),
    currentPath: Array.isArray(record.currentPath)
      ? record.currentPath
        .slice(0, 300)
        .map((value) => Number.parseInt(value, 10))
        .filter((value) => Number.isInteger(value) && value >= -1)
      : null,
    pgn: cleanText(record.pgn, 30_000),
    tree: record.tree,
    review: record.review && typeof record.review === "object" ? record.review : null,
  };
}

export function loadAccountState(storage, key, profile = {}) {
  const fallback = createAccountState(profile);
  if (!storage || typeof storage.getItem !== "function") return fallback;
  try {
    const raw = storage.getItem(key);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw);
    if (parsed?.version !== ACCOUNT_SCHEMA_VERSION || !Array.isArray(parsed.games)) return fallback;
    const storedProfile = parsed.profile && typeof parsed.profile === "object" ? parsed.profile : {};
    return {
      version: ACCOUNT_SCHEMA_VERSION,
      profile: {
        name: cleanText(profile.name, 80) || cleanText(storedProfile.name, 80) || fallback.profile.name,
        email: cleanText(profile.email, 254).toLowerCase()
          || cleanText(storedProfile.email, 254).toLowerCase(),
        source: profile.source === "sites" || storedProfile.source === "sites" ? "sites" : "local",
      },
      createdAt: cleanText(parsed.createdAt, 40) || fallback.createdAt,
      updatedAt: cleanText(parsed.updatedAt, 40) || fallback.updatedAt,
      games: parsed.games
        .map(normalizeGameRecord)
        .filter(Boolean)
        .slice(0, MAX_SAVED_GAMES),
      deletedGames: Array.isArray(parsed.deletedGames)
        ? parsed.deletedGames
          .map(normalizeDeletion)
          .filter(Boolean)
          .slice(0, MAX_DELETION_TOMBSTONES)
        : [],
    };
  } catch {
    return fallback;
  }
}

export function saveAccountState(storage, key, state) {
  if (!storage || typeof storage.setItem !== "function") return false;
  try {
    storage.setItem(key, JSON.stringify({
      ...state,
      version: ACCOUNT_SCHEMA_VERSION,
      updatedAt: new Date().toISOString(),
      games: Array.isArray(state?.games) ? state.games.slice(0, MAX_SAVED_GAMES) : [],
      deletedGames: Array.isArray(state?.deletedGames)
        ? state.deletedGames.slice(0, MAX_DELETION_TOMBSTONES)
        : [],
    }));
    return true;
  } catch {
    return false;
  }
}

export function createGameId(now = Date.now()) {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return `game-${now}-${Math.random().toString(36).slice(2, 10)}`;
}

function serializeNode(node, counter) {
  if (!node) return null;
  if (counter.count >= MAX_TREE_NODES) {
    throw new Error(`Eine Partie darf höchstens ${MAX_TREE_NODES} Variantenknoten enthalten.`);
  }
  counter.count += 1;
  return {
    move: node.move && typeof node.move === "object" ? { ...node.move } : null,
    fen: cleanText(node.fen, 120),
    result: cleanText(node.result, 12) || null,
    analysis: node.analysis && typeof node.analysis === "object"
      ? JSON.parse(JSON.stringify(node.analysis))
      : null,
    mainline: serializeNode(node.mainline, counter),
    variations: Array.isArray(node.variations)
      ? node.variations.map((variation) => serializeNode(variation, counter)).filter(Boolean)
      : [],
  };
}

export function serializeMoveTree(root) {
  if (!root) return null;
  return {
    version: 1,
    root: serializeNode(root, { count: 0 }),
  };
}

function deserializeNode(value, parent, counter) {
  if (!value || typeof value !== "object") return null;
  if (counter.count >= MAX_TREE_NODES) {
    throw new Error(`Der gespeicherte Variantenbaum überschreitet ${MAX_TREE_NODES} Knoten.`);
  }
  counter.count += 1;
  const node = new MoveTreeNode({
    move: value.move && typeof value.move === "object" ? { ...value.move } : null,
    fen: cleanText(value.fen, 120),
    parent,
    result: cleanText(value.result, 12) || null,
    analysis: value.analysis && typeof value.analysis === "object" ? value.analysis : null,
  });
  node.analysis = value.analysis && typeof value.analysis === "object"
    ? JSON.parse(JSON.stringify(value.analysis))
    : null;
  node.mainline = deserializeNode(value.mainline, node, counter);
  node.variations = Array.isArray(value.variations)
    ? value.variations
      .map((variation) => deserializeNode(variation, node, counter))
      .filter(Boolean)
    : [];
  return node;
}

export function deserializeMoveTree(value) {
  if (!value || value.version !== 1 || !value.root) return null;
  return deserializeNode(value.root, null, { count: 0 });
}

export function nodePathFromRoot(node) {
  if (!node) return [];
  const path = [];
  let current = node;
  let guard = 0;
  while (current?.parent) {
    if (guard >= MAX_TREE_NODES) throw new Error("Der Variantenpfad ist zu lang.");
    const parent = current.parent;
    if (parent.mainline === current) {
      path.push(-1);
    } else {
      const variationIndex = Array.isArray(parent.variations)
        ? parent.variations.indexOf(current)
        : -1;
      if (variationIndex < 0) throw new Error("Der Variantenpfad ist beschädigt.");
      path.push(variationIndex);
    }
    current = parent;
    guard += 1;
  }
  return path.reverse();
}

export function findNodeByPath(root, path) {
  if (!root || !Array.isArray(path)) return null;
  let current = root;
  for (const step of path) {
    current = step === -1 ? current?.mainline : current?.variations?.[step];
    if (!current) return null;
  }
  return current;
}

export function upsertSavedGame(state, record) {
  const normalized = normalizeGameRecord(record);
  if (!normalized) return state;
  if (state?.deletedGames?.some((deletion) => deletion.id === normalized.id)) {
    throw new Error("Diese Partie wurde in einem anderen Tab gelöscht und wird nicht erneut gespeichert.");
  }
  const games = Array.isArray(state?.games)
    ? state.games.filter((game) => game.id !== normalized.id)
    : [];
  const isNewGame = !state?.games?.some((game) => game.id === normalized.id);
  if (isNewGame && games.length >= MAX_SAVED_GAMES) {
    throw new Error(`Es können höchstens ${MAX_SAVED_GAMES} Partien gespeichert werden. Lösche zuerst eine ältere Partie.`);
  }
  return {
    ...state,
    updatedAt: new Date().toISOString(),
    games: [normalized, ...games],
  };
}

export function mergeAccountStates(base, incoming) {
  const deletionMap = new Map();
  for (const deletion of [...(incoming?.deletedGames || []), ...(base?.deletedGames || [])]) {
    const normalized = normalizeDeletion(deletion);
    if (!normalized) continue;
    const existing = deletionMap.get(normalized.id);
    if (!existing || normalized.deletedAt > existing.deletedAt) {
      deletionMap.set(normalized.id, normalized);
    }
  }
  const deletedIds = new Set(deletionMap.keys());
  const merged = new Map();
  for (const game of [...(incoming?.games || []), ...(base?.games || [])]) {
    if (deletedIds.has(game.id)) continue;
    const existing = merged.get(game.id);
    if (!existing || String(game.updatedAt) > String(existing.updatedAt)) {
      merged.set(game.id, game);
    }
  }
  const games = Array.from(merged.values())
    .sort((left, right) => String(right.updatedAt).localeCompare(String(left.updatedAt)));
  if (games.length > MAX_SAVED_GAMES) {
    throw new Error(`Es können höchstens ${MAX_SAVED_GAMES} Partien gespeichert werden. Lösche zuerst eine ältere Partie.`);
  }
  return {
    ...base,
    profile: incoming?.profile || base?.profile,
    games,
    deletedGames: Array.from(deletionMap.values())
      .sort((left, right) => right.deletedAt.localeCompare(left.deletedAt))
      .slice(0, MAX_DELETION_TOMBSTONES),
  };
}

export function removeSavedGame(state, gameId, deletedAt = new Date().toISOString()) {
  const id = cleanText(gameId, 100);
  if (!id) return state;
  const deletedGames = [
    { id, deletedAt },
    ...(state?.deletedGames || []).filter((deletion) => deletion.id !== id),
  ].slice(0, MAX_DELETION_TOMBSTONES);
  return {
    ...state,
    updatedAt: deletedAt,
    games: Array.isArray(state?.games)
      ? state.games.filter((game) => game.id !== id)
      : [],
    deletedGames,
  };
}
