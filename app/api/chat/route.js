import {
  coachResponseMetadata,
  normalizeChatPayload,
  requestCoachResponse,
  requestMoveExplanation,
} from "../../../api/chat.js";

export const runtime = "nodejs";

const RATE_LIMITS = Object.freeze({
  chat: 15,
  move_explanation: 30,
});
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

function checkRateLimit(request, task = "chat") {
  const now = Date.now();
  const bucket = task === "move_explanation" ? "move_explanation" : "chat";
  const key = `${clientAddress(request)}:${bucket}`;
  const limit = RATE_LIMITS[bucket];
  const current = rateLimitBuckets.get(key);

  if (!current || now >= current.resetAt) {
    rateLimitBuckets.set(key, { count: 1, resetAt: now + RATE_WINDOW_MS });
    return null;
  }

  current.count += 1;
  if (current.count <= limit) return null;
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
  const retryAfter = checkRateLimit(request, normalized.value.task);
  if (retryAfter) {
    return json(
      { error: "Zu viele Anfragen. Bitte warte kurz." },
      429,
      { "Retry-After": String(retryAfter) },
    );
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 45_000);
  const abortFromClient = () => controller.abort();
  if (request.signal.aborted) {
    controller.abort();
  } else {
    request.signal.addEventListener("abort", abortFromClient, { once: true });
  }

  try {
    if (normalized.value.task === "move_explanation") {
      const result = await requestMoveExplanation(normalized.value, {
        signal: controller.signal,
        safetyIdentifier: await safetyIdentifier(request),
      });
      return json(result);
    }
    const reply = await requestCoachResponse(normalized.value, {
      signal: controller.signal,
      safetyIdentifier: await safetyIdentifier(request),
    });
    return json({ reply, ...coachResponseMetadata(normalized.value) });
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
    request.signal.removeEventListener("abort", abortFromClient);
  }
}
