import {
  fetchLichessAccount,
  LICHESS_COOKIES,
  parseCookies,
} from "../../../../api/lichess.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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
