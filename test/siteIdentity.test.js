import test from "node:test";
import assert from "node:assert/strict";
import { siteIdentityFromHeaders } from "../api/siteIdentity.js";

test("Sites-Identität wird aus den vertrauenswürdigen Gateway-Headern gelesen", () => {
  const headers = new Headers({
    "oai-authenticated-user-email": " Paul@Example.com ",
    "oai-authenticated-user-full-name": "Paul Pieper",
  });
  assert.deepEqual(siteIdentityFromHeaders(headers), {
    authenticated: true,
    user: {
      email: "paul@example.com",
      name: "Paul Pieper",
    },
  });
  assert.deepEqual(siteIdentityFromHeaders(new Headers()), {
    authenticated: false,
    user: null,
  });
});
