import {
  canonicalLocalOrigin,
  cookieHeader,
  createPkceChallenge,
  LICHESS_COOKIES,
  lichessAuthorizationUrl,
  lichessRequestOrigin,
  randomUrlToken,
} from "../../../../api/lichess.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request) {
  const origin = lichessRequestOrigin(request);
  const canonicalOrigin = canonicalLocalOrigin(origin);
  if (canonicalOrigin !== origin) {
    return new Response(null, {
      status: 307,
      headers: {
        "Cache-Control": "private, no-store",
        Location: `${canonicalOrigin}/api/lichess/connect`,
      },
    });
  }
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
