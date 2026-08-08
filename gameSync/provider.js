const REQUIRED_METHODS = Object.freeze([
  "validateUsername",
  "fetchGames",
  "normalizeGame",
  "getGameId",
]);

export class GameProvider {
  constructor({ id, validateUsername, fetchGames, normalizeGame, getGameId }) {
    this.id = String(id || "").trim();
    Object.assign(this, { validateUsername, fetchGames, normalizeGame, getGameId });
    if (!this.id || REQUIRED_METHODS.some((method) => typeof this[method] !== "function")) {
      throw new Error("Game provider does not implement the required contract.");
    }
  }
}

export function createProviderRegistry(providers = []) {
  const registry = new Map();
  for (const provider of providers) {
    if (!(provider instanceof GameProvider)) throw new Error("Invalid game provider.");
    if (registry.has(provider.id)) throw new Error(`Duplicate game provider: ${provider.id}`);
    registry.set(provider.id, provider);
  }
  return Object.freeze({
    get(id) {
      const provider = registry.get(id);
      if (!provider) throw new Error(`Unknown game provider: ${id}`);
      return provider;
    },
    ids() { return Array.from(registry.keys()); },
  });
}
