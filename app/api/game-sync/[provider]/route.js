import { parseCookies, LICHESS_COOKIES } from "../../../../api/lichess.js";
import { gameProviders } from "../../../../gameSync/providers/index.js";
import { ProviderHttpError } from "../../../../gameSync/providers/http.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request, context) {
  try {
    const { provider: providerId } = await context.params;
    const provider = gameProviders.get(providerId);
    const body = await request.json().catch(() => ({}));
    const username = provider.validateUsername(body.username);
    const cookies = parseCookies(request.headers.get("cookie"));
    const result = await provider.fetchGames({
      username,
      cursor: body.cursor,
      token: providerId === "lichess" ? cookies[LICHESS_COOKIES.token] || "" : "",
    });
    return Response.json(result, {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (error) {
    const status = error instanceof ProviderHttpError
      ? error.status
      : /username|provider/iu.test(error?.message || "") ? 400 : 502;
    return Response.json(
      { error: error?.message || "Game provider is unavailable." },
      { status, headers: { "Cache-Control": "private, no-store" } },
    );
  }
}
