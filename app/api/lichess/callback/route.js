import {
  clearLichessCookie,
  cookieHeader,
  fetchLichessAccount,
  LICHESS_COOKIES,
  lichessCallbackUrl,
  lichessClientId,
  lichessRequestOrigin,
  parseCookies,
} from "../../../../api/lichess.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function appRedirect(origin, outcome) {
  const url = new URL("/", origin);
  url.searchParams.set("lichess", outcome);
  return url.toString();
}

function redirectWithClearedHandshake(origin, secure, outcome) {
  const headers = new Headers({
    "Cache-Control": "private, no-store",
    Location: appRedirect(origin, outcome),
  });
  headers.append("Set-Cookie", clearLichessCookie(LICHESS_COOKIES.state, secure));
  headers.append("Set-Cookie", clearLichessCookie(LICHESS_COOKIES.verifier, secure));
  return new Response(null, { status: 302, headers });
}

export async function GET(request) {
  const origin = lichessRequestOrigin(request);
  const secure = origin.startsWith("https://");
  const url = new URL(request.url);
  const code = url.searchParams.get("code") || "";
  const returnedState = url.searchParams.get("state") || "";
  const error = url.searchParams.get("error");
  const cookies = parseCookies(request.headers.get("cookie"));
  const expectedState = cookies[LICHESS_COOKIES.state] || "";
  const verifier = cookies[LICHESS_COOKIES.verifier] || "";

  if (
    error
    || !code
    || !returnedState
    || returnedState !== expectedState
    || verifier.length < 43
  ) {
    return redirectWithClearedHandshake(
      origin,
      secure,
      error === "access_denied" ? "cancelled" : "error",
    );
  }

  try {
    const tokenResponse = await fetch("https://lichess.org/api/token", {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code,
        code_verifier: verifier,
        redirect_uri: lichessCallbackUrl(origin),
        client_id: lichessClientId(origin),
      }),
      cache: "no-store",
    });
    if (!tokenResponse.ok) throw new Error("Token-Austausch fehlgeschlagen.");
    const tokenResult = await tokenResponse.json();
    const accessToken = typeof tokenResult.access_token === "string"
      ? tokenResult.access_token
      : "";
    if (!/^[A-Za-z0-9_]+$/.test(accessToken)) {
      throw new Error("Ungültiger Lichess-Token.");
    }
    await fetchLichessAccount(accessToken);
    const expiresIn = Number.isFinite(tokenResult.expires_in)
      ? Math.max(300, Math.min(31_536_000, tokenResult.expires_in))
      : 31_536_000;
    const headers = new Headers({
      "Cache-Control": "private, no-store",
      Location: appRedirect(origin, "connected"),
    });
    headers.append(
      "Set-Cookie",
      cookieHeader(LICHESS_COOKIES.token, accessToken, {
        maxAge: expiresIn,
        secure,
      }),
    );
    headers.append("Set-Cookie", clearLichessCookie(LICHESS_COOKIES.state, secure));
    headers.append("Set-Cookie", clearLichessCookie(LICHESS_COOKIES.verifier, secure));
    return new Response(null, { status: 302, headers });
  } catch {
    return redirectWithClearedHandshake(origin, secure, "error");
  }
}
