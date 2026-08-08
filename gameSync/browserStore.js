import { createGameLibrary, GAME_LIBRARY_SCHEMA_VERSION } from "./library.js";

const DATABASE_NAME = "chess-coach-game-sync";
const DATABASE_VERSION = 1;
const GAMES_STORE = "games";
const META_STORE = "meta";
const LIBRARY_META_KEY = "library";
const BATCHES_META_KEY = "analysis-batches";

function requestResult(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("IndexedDB request failed."));
  });
}

function transactionDone(transaction) {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error || new Error("IndexedDB transaction failed."));
    transaction.onabort = () => reject(transaction.error || new Error("IndexedDB transaction was aborted."));
  });
}

export async function openGameSyncDatabase(indexedDb = globalThis.indexedDB) {
  if (!indexedDb?.open) throw new Error("This browser cannot persist the synced game library.");
  const request = indexedDb.open(DATABASE_NAME, DATABASE_VERSION);
  request.onupgradeneeded = () => {
    const database = request.result;
    if (!database.objectStoreNames.contains(GAMES_STORE)) {
      const games = database.createObjectStore(GAMES_STORE, { keyPath: "id" });
      games.createIndex("playedAt", "playedAt");
      games.createIndex("provider", "provider");
    }
    if (!database.objectStoreNames.contains(META_STORE)) {
      database.createObjectStore(META_STORE, { keyPath: "key" });
    }
  };
  return requestResult(request);
}

export async function loadGameLibrary(indexedDb = globalThis.indexedDB) {
  const database = await openGameSyncDatabase(indexedDb);
  try {
    const transaction = database.transaction([GAMES_STORE, META_STORE], "readonly");
    const gamesPromise = requestResult(transaction.objectStore(GAMES_STORE).getAll());
    const metaPromise = requestResult(transaction.objectStore(META_STORE).get(LIBRARY_META_KEY));
    const [games, meta] = await Promise.all([gamesPromise, metaPromise]);
    await transactionDone(transaction);
    if (meta?.value?.version !== GAME_LIBRARY_SCHEMA_VERSION) return createGameLibrary();
    return { ...meta.value, games: Array.isArray(games) ? games : [] };
  } finally {
    database.close();
  }
}

export async function persistGameLibrary(library, changedGames = library?.games || [], indexedDb = globalThis.indexedDB) {
  const database = await openGameSyncDatabase(indexedDb);
  try {
    const transaction = database.transaction([GAMES_STORE, META_STORE], "readwrite");
    const gameStore = transaction.objectStore(GAMES_STORE);
    for (const game of changedGames) gameStore.put(game);
    const { games: _games, ...meta } = library;
    transaction.objectStore(META_STORE).put({ key: LIBRARY_META_KEY, value: meta });
    await transactionDone(transaction);
  } finally {
    database.close();
  }
}

export async function persistAnalysisBatch(batch, indexedDb = globalThis.indexedDB) {
  const database = await openGameSyncDatabase(indexedDb);
  try {
    const transaction = database.transaction(META_STORE, "readwrite");
    const store = transaction.objectStore(META_STORE);
    const existing = await requestResult(store.get(BATCHES_META_KEY));
    const batches = [batch, ...(existing?.value || []).filter((item) => item.id !== batch.id)].slice(0, 20);
    store.put({ key: BATCHES_META_KEY, value: batches });
    await transactionDone(transaction);
  } finally {
    database.close();
  }
}

export async function loadAnalysisBatches(indexedDb = globalThis.indexedDB) {
  const database = await openGameSyncDatabase(indexedDb);
  try {
    const transaction = database.transaction(META_STORE, "readonly");
    const result = await requestResult(transaction.objectStore(META_STORE).get(BATCHES_META_KEY));
    await transactionDone(transaction);
    return Array.isArray(result?.value) ? result.value : [];
  } finally {
    database.close();
  }
}
