import {
  cookieHeader,
  createPkceChallenge,
  LICHESS_COOKIES,
  lichessAuthorizationUrl,
  randomUrlToken,
  requestOrigin,
} from "../../../../api/lichess.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request) {
  const origin = requestOrigin(request);
  const verifier = randomUrlToken(48);
  const state = randomUrlToken(32);
  const challenge = await createPkceChallenge(verifier);
  const secure = origin.startsWith("https://");
  const headers = new Headers({
    "Cache-Control": "private, no-store",
    Location: lichessAuthorizationUrl({ origin, state, challenge }),
  });
  headers.append(
    "Set-Cookie",
    cookieHeader(LICHESS_COOKIES.state, state, { maxAge: 600, secure }),
  );
  headers.append(
    "Set-Cookie",
    cookieHeader(LICHESS_COOKIES.verifier, verifier, { maxAge: 600, secure }),
  );
  return new Response(null, { status: 302, headers });
}
