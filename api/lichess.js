const LICHESS_ORIGIN = "https://lichess.org";

export const LICHESS_COOKIES = Object.freeze({
  token: "chess_coach_lichess_token",
  state: "chess_coach_lichess_state",
  verifier: "chess_coach_lichess_verifier",
});

const PERF_TYPES = new Set([
  "ultraBullet",
  "bullet",
  "blitz",
  "rapid",
  "classical",
  "correspondence",
]);

function base64Url(bytes) {
  let binary = "";
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return btoa(binary)
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/g, "");
}

export function randomUrlToken(size = 32, cryptoImpl = globalThis.crypto) {
  if (!cryptoImpl?.getRandomValues) throw new Error("Sichere Zufallsquelle fehlt.");
  const bytes = new Uint8Array(Math.max(16, Math.min(64, size)));
  cryptoImpl.getRandomValues(bytes);
  return base64Url(bytes);
}

export async function createPkceChallenge(verifier, cryptoImpl = globalThis.crypto) {
  if (!cryptoImpl?.subtle || typeof verifier !== "string" || verifier.length < 43) {
    throw new Error("PKCE konnte nicht erzeugt werden.");
  }
  const digest = await cryptoImpl.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(verifier),
  );
  return base64Url(new Uint8Array(digest));
}

export function requestOrigin(request) {
  const origin = new URL(request.url).origin;
  if (!/^https?:\/\/[A-Za-z0-9.-]+(?::\d+)?$/.test(origin)) {
    throw new Error("Ungültige Anwendungsadresse.");
  }
  return origin;
}

export function lichessClientId(origin) {
  const configured = typeof process.env.LICHESS_CLIENT_ID === "string"
    ? process.env.LICHESS_CLIENT_ID.trim()
    : "";
  return configured || new URL(origin).host;
}

export function lichessCallbackUrl(origin) {
  return `${origin}/api/lichess/callback`;
}

export function lichessAuthorizationUrl({ origin, state, challenge }) {
  const url = new URL("/oauth", LICHESS_ORIGIN);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", lichessClientId(origin));
  url.searchParams.set("redirect_uri", lichessCallbackUrl(origin));
  url.searchParams.set("code_challenge_method", "S256");
  url.searchParams.set("code_challenge", challenge);
  url.searchParams.set("state", state);
  return url.toString();
}

export function parseCookies(header) {
  const cookies = {};
  String(header || "").split(";").forEach((part) => {
    const separator = part.indexOf("=");
    if (separator < 1) return;
    const name = part.slice(0, separator).trim();
    const value = part.slice(separator + 1).trim();
    try {
      cookies[name] = decodeURIComponent(value);
    } catch {
      cookies[name] = "";
    }
  });
  return cookies;
}

export function cookieHeader(
  name,
  value,
  {
    maxAge = 600,
    secure = true,
    httpOnly = true,
    sameSite = "Lax",
    path = "/api/lichess",
  } = {},
) {
  const parts = [
    `${name}=${encodeURIComponent(value || "")}`,
    `Path=${path}`,
    `Max-Age=${Math.max(0, Math.floor(maxAge))}`,
    `SameSite=${sameSite}`,
  ];
  if (httpOnly) parts.push("HttpOnly");
  if (secure) parts.push("Secure");
  return parts.join("; ");
}

export function clearLichessCookie(name, secure = true) {
  return cookieHeader(name, "", { maxAge: 0, secure });
}

export function normalizeGameFilters(searchParams) {
  const maximum = Number.parseInt(searchParams.get("max"), 10);
  const max = Number.isInteger(maximum) ? Math.max(1, Math.min(40, maximum)) : 10;
  const sinceRaw = Number.parseInt(searchParams.get("since"), 10);
  const since = Number.isInteger(sinceRaw) && sinceRaw >= 1_356_998_400_070
    ? sinceRaw
    : null;
  const ratedRaw = searchParams.get("rated");
  const rated = ratedRaw === "true" || ratedRaw === "false" ? ratedRaw : null;
  const colorRaw = searchParams.get("color");
  const color = colorRaw === "white" || colorRaw === "black" ? colorRaw : null;
  const perfType = String(searchParams.get("perfType") || "")
    .split(",")
    .map((value) => value.trim())
    .filter((value) => PERF_TYPES.has(value))
    .join(",");
  return { max, since, rated, color, perfType: perfType || null };
}

export function lichessGamesUrl(username, filters) {
  const safeUsername = String(username || "").trim();
  if (!/^[A-Za-z0-9_-]{1,32}$/.test(safeUsername)) {
    throw new Error("Ungültiger Lichess-Benutzername.");
  }
  const url = new URL(`/api/games/user/${encodeURIComponent(safeUsername)}`, LICHESS_ORIGIN);
  url.searchParams.set("max", String(filters.max));
  url.searchParams.set("finished", "true");
  url.searchParams.set("ongoing", "false");
  url.searchParams.set("moves", "true");
  url.searchParams.set("tags", "true");
  url.searchParams.set("clocks", "true");
  url.searchParams.set("opening", "true");
  url.searchParams.set("accuracy", "true");
  url.searchParams.set("sort", "dateDesc");
  if (filters.since) url.searchParams.set("since", String(filters.since));
  if (filters.rated) url.searchParams.set("rated", filters.rated);
  if (filters.color) url.searchParams.set("color", filters.color);
  if (filters.perfType) url.searchParams.set("perfType", filters.perfType);
  return url;
}

export async function fetchLichessAccount(token, fetchImpl = fetch) {
  const response = await fetchImpl(`${LICHESS_ORIGIN}/api/account`, {
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${token}`,
    },
    cache: "no-store",
  });
  if (!response.ok) {
    const error = new Error(response.status === 401
      ? "Die Lichess-Verbindung ist abgelaufen."
      : "Lichess konnte das Profil nicht laden.");
    error.status = response.status;
    throw error;
  }
  return response.json();
}

export function sanitizeLichessGame(game) {
  if (!game || typeof game !== "object") return null;
  const id = typeof game.id === "string" ? game.id.slice(0, 16) : "";
  if (!/^[A-Za-z0-9]{8,16}$/.test(id)) return null;
  const cleanPlayer = (player) => ({
    user: player?.user && typeof player.user === "object"
      ? {
        id: String(player.user.id || "").slice(0, 32),
        name: String(player.user.name || "").slice(0, 40),
        title: String(player.user.title || "").slice(0, 8),
      }
      : null,
    rating: Number.isInteger(player?.rating) ? player.rating : null,
    aiLevel: Number.isInteger(player?.aiLevel) ? player.aiLevel : null,
  });
  return {
    id,
    rated: game.rated === true,
    variant: String(game.variant || "").slice(0, 30),
    speed: String(game.speed || "").slice(0, 30),
    perf: String(game.perf || "").slice(0, 30),
    createdAt: Number.isFinite(game.createdAt) ? game.createdAt : null,
    lastMoveAt: Number.isFinite(game.lastMoveAt) ? game.lastMoveAt : null,
    status: String(game.status || "").slice(0, 30),
    winner: game.winner === "white" || game.winner === "black" ? game.winner : null,
    initialFen: typeof game.initialFen === "string" ? game.initialFen.slice(0, 120) : "",
    moves: typeof game.moves === "string" ? game.moves.slice(0, 30_000) : "",
    players: {
      white: cleanPlayer(game.players?.white),
      black: cleanPlayer(game.players?.black),
    },
    opening: game.opening && typeof game.opening === "object"
      ? {
        eco: String(game.opening.eco || "").slice(0, 8),
        name: String(game.opening.name || "").slice(0, 100),
      }
      : null,
    clock: game.clock && typeof game.clock === "object"
      ? {
        initial: Number.isInteger(game.clock.initial) ? game.clock.initial : null,
        increment: Number.isInteger(game.clock.increment) ? game.clock.increment : null,
      }
      : null,
    daysPerTurn: Number.isInteger(game.daysPerTurn) ? game.daysPerTurn : null,
  };
}

export async function fetchLichessGames(token, username, filters, fetchImpl = fetch) {
  const response = await fetchImpl(lichessGamesUrl(username, filters), {
    headers: {
      Accept: "application/x-ndjson",
      Authorization: `Bearer ${token}`,
    },
    cache: "no-store",
  });
  if (!response.ok) {
    const error = new Error(response.status === 429
      ? "Lichess begrenzt gerade die Anfragen. Bitte warte eine Minute."
      : "Die Lichess-Partien konnten nicht geladen werden.");
    error.status = response.status;
    throw error;
  }
  const text = await response.text();
  if (text.length > 4_000_000) throw new Error("Die Lichess-Antwort ist zu groß.");
  return text
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => {
      try {
        return sanitizeLichessGame(JSON.parse(line));
      } catch {
        return null;
      }
    })
    .filter(Boolean)
    .slice(0, filters.max);
}

export async function revokeLichessToken(token, fetchImpl = fetch) {
  if (!token) return;
  try {
    await fetchImpl(`${LICHESS_ORIGIN}/api/token`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
    });
  } catch {
    // Der lokale Cookie wird auch gelöscht, wenn Lichess nicht erreichbar ist.
  }
}
