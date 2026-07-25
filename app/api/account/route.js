import { siteIdentityFromHeaders } from "../../../api/siteIdentity.js";

export const runtime = "nodejs";

export function GET(request) {
  return Response.json(siteIdentityFromHeaders(request.headers), {
    headers: {
      "Cache-Control": "private, no-store",
    },
  });
}
