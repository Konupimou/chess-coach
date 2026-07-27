import {
  fetchLichessAccount,
  LICHESS_COOKIES,
  parseCookies,
} from "../../../../api/lichess.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function publicPerfs(value) {
  if (!value || typeof value !== "object") return {};
  const result = {};
  [
    "ultraBullet",
    "bullet",
    "blitz",
    "rapid",
    "classical",
    "correspondence",
  ].forEach((key) => {
    const entry = value[key];
    const rating = Number.parseInt(entry?.rating, 10);
    if (!Number.isInteger(rating) || rating < 100 || rating > 4_000) return;
    result[key] = {
      rating,
      games: Math.max(0, Math.min(1_000_000, Number.parseInt(entry?.games, 10) || 0)),
      prov: entry?.prov === true,
    };
  });
  return result;
}

export async function GET(request) {
  const cookies = parseCookies(request.headers.get("cookie"));
  const token = cookies[LICHESS_COOKIES.token];
  if (!token) {
    return Response.json(
      { connected: false },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  }
  try {
    const account = await fetchLichessAccount(token);
    return Response.json(
      {
        connected: true,
        user: {
          id: String(account.id || "").slice(0, 32),
          username: String(account.username || account.name || "").slice(0, 40),
          title: String(account.title || "").slice(0, 8),
          online: account.online === true,
          perfs: publicPerfs(account.perfs),
        },
      },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (error) {
    return Response.json(
      {
        connected: false,
        expired: error?.status === 401,
      },
      {
        status: error?.status === 401 ? 401 : 502,
        headers: { "Cache-Control": "private, no-store" },
      },
    );
  }
}
