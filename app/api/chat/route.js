import {
  normalizeChatPayload,
  requestCoachResponse,
} from "../../../api/chat.js";

export const runtime = "nodejs";

const RATE_LIMIT = 15;
const RATE_WINDOW_MS = 60_000;
const rateLimitBuckets = globalThis.__chessCoachRateLimits || new Map();
globalThis.__chessCoachRateLimits = rateLimitBuckets;

function json(body, status = 200, headers = {}) {
  return Response.json(body, { status, headers });
}

function clientAddress(request) {
  const forwarded = request.headers.get("x-forwarded-for");
  return forwarded?.split(",")[0]?.trim() || request.headers.get("x-real-ip") || "local";
}

function checkRateLimit(request) {
  const now = Date.now();
  const key = clientAddress(request);
  const current = rateLimitBuckets.get(key);

  if (!current || now >= current.resetAt) {
    rateLimitBuckets.set(key, { count: 1, resetAt: now + RATE_WINDOW_MS });
    return null;
  }

  current.count += 1;
  if (current.count <= RATE_LIMIT) return null;
  return Math.max(1, Math.ceil((current.resetAt - now) / 1_000));
}

async function safetyIdentifier(request) {
  const salt = process.env.SAFETY_ID_SALT;
  if (!salt) return undefined;
  const data = new TextEncoder().encode(`${salt}:${clientAddress(request)}`);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hash), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function POST(request) {
  const contentLength = Number.parseInt(request.headers.get("content-length") || "0", 10);
  if (contentLength > 32_768) {
    return json({ error: "Die Anfrage ist zu groß." }, 413);
  }

  const retryAfter = checkRateLimit(request);
  if (retryAfter) {
    return json(
      { error: "Zu viele Anfragen. Bitte warte kurz." },
      429,
      { "Retry-After": String(retryAfter) },
    );
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: "Ungültiges JSON." }, 400);
  }

  const normalized = normalizeChatPayload(body);
  if (normalized.error) {
    return json({ error: normalized.error }, 400);
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 35_000);

  try {
    const reply = await requestCoachResponse(normalized.value, {
      signal: controller.signal,
      safetyIdentifier: await safetyIdentifier(request),
    });
    return json({ reply });
  } catch (error) {
    if (error?.code === "missing_api_key") {
      return json(
        { error: "Der Coach ist noch nicht konfiguriert. Hinterlege OPENAI_API_KEY in deiner .env-Datei." },
        503,
      );
    }
    if (error?.name === "AbortError") {
      return json({ error: "Die Coach-Anfrage hat zu lange gedauert." }, 504);
    }
    console.error("[Chat API]", error?.message || error);
    return json({ error: "Der Coach ist momentan nicht erreichbar." }, 502);
  } finally {
    clearTimeout(timeout);
  }
}
