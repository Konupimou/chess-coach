import {
  fetchLichessAccount,
  fetchLichessGames,
  LICHESS_COOKIES,
  normalizeGameFilters,
  parseCookies,
} from "../../../../api/lichess.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request) {
  const cookies = parseCookies(request.headers.get("cookie"));
  const token = cookies[LICHESS_COOKIES.token];
  if (!token) {
    return Response.json(
      { error: "Verbinde zuerst deinen Lichess-Account." },
      { status: 401, headers: { "Cache-Control": "private, no-store" } },
    );
  }
  try {
    const account = await fetchLichessAccount(token);
    const username = String(account.username || account.name || "");
    const filters = normalizeGameFilters(new URL(request.url).searchParams);
    const games = await fetchLichessGames(token, username, filters);
    return Response.json(
      { username, games },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (error) {
    const status = error?.status === 401
      ? 401
      : error?.status === 429 ? 429 : 502;
    return Response.json(
      { error: error?.message || "Lichess ist gerade nicht erreichbar." },
      { status, headers: { "Cache-Control": "private, no-store" } },
    );
  }
}
