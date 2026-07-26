import {
  clearLichessCookie,
  LICHESS_COOKIES,
  parseCookies,
  requestOrigin,
  revokeLichessToken,
} from "../../../../api/lichess.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request) {
  const origin = requestOrigin(request);
  const secure = origin.startsWith("https://");
  const cookies = parseCookies(request.headers.get("cookie"));
  await revokeLichessToken(cookies[LICHESS_COOKIES.token]);
  const headers = new Headers({ "Cache-Control": "private, no-store" });
  headers.append("Set-Cookie", clearLichessCookie(LICHESS_COOKIES.token, secure));
  headers.append("Set-Cookie", clearLichessCookie(LICHESS_COOKIES.state, secure));
  headers.append("Set-Cookie", clearLichessCookie(LICHESS_COOKIES.verifier, secure));
  return Response.json({ disconnected: true }, { headers });
}
