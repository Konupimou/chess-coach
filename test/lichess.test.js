import test from "node:test";
import assert from "node:assert/strict";
import {
  canonicalLocalOrigin,
  cookieHeader,
  createPkceChallenge,
  lichessAuthorizationUrl,
  lichessGamesUrl,
  lichessRequestOrigin,
  normalizeGameFilters,
  parseCookies,
  sanitizeLichessGame,
} from "../api/lichess.js";
import { GET as startLichessConnect } from "../app/api/lichess/connect/route.js";

test("Lokales OAuth startet auf localhost statt auf der Bind-Adresse", async () => {
  assert.equal(
    canonicalLocalOrigin("http://0.0.0.0:3000"),
    "http://localhost:3000",
  );
  assert.equal(
    canonicalLocalOrigin("http://localhost:3000"),
    "http://localhost:3000",
  );
  assert.equal(
    canonicalLocalOrigin("https://coach.example"),
    "https://coach.example",
  );

  const response = await startLichessConnect(
    new Request("http://0.0.0.0:3000/api/lichess/connect", {
      headers: { Host: "0.0.0.0:3000" },
    }),
  );
  assert.equal(response.status, 307);
  assert.equal(response.headers.get("location"), "http://localhost:3000/api/lichess/connect");
  assert.equal(response.headers.get("set-cookie"), null);

  const localhostRequest = new Request("http://0.0.0.0:3000/api/lichess/connect", {
    headers: { Host: "localhost:3000" },
  });
  assert.equal(lichessRequestOrigin(localhostRequest), "http://localhost:3000");
  const localhostResponse = await startLichessConnect(localhostRequest);
  assert.equal(localhostResponse.status, 302);
  assert.match(
    localhostResponse.headers.get("location"),
    /^https:\/\/lichess\.org\/oauth\?/,
  );
  assert.match(localhostResponse.headers.get("set-cookie"), /chess_coach_lichess_state=/);
});

test("Lichess OAuth verwendet PKCE S256 ohne zusätzliche Berechtigungen", async () => {
  const verifier = "a".repeat(64);
  const challenge = await createPkceChallenge(verifier);
  const authorization = new URL(lichessAuthorizationUrl({
    origin: "https://coach.example",
    state: "sicherer-zustand",
    challenge,
  }));

  assert.equal(authorization.origin, "https://lichess.org");
  assert.equal(authorization.pathname, "/oauth");
  assert.equal(authorization.searchParams.get("code_challenge_method"), "S256");
  assert.equal(authorization.searchParams.get("redirect_uri"), "https://coach.example/api/lichess/callback");
  assert.equal(authorization.searchParams.get("scope"), null);
  assert.ok(challenge.length >= 43);
});

test("Lichess-Cookies sind serverseitig geschützt und lesbar", () => {
  const header = cookieHeader("token", "abc_123", { secure: true, maxAge: 60 });
  assert.match(header, /HttpOnly/);
  assert.match(header, /Secure/);
  assert.match(header, /SameSite=Lax/);
  assert.match(header, /Path=\/api\/lichess/);
  assert.deepEqual(parseCookies("a=1; token=abc_123"), { a: "1", token: "abc_123" });
});

test("Partieabfrage begrenzt Filter und schließt laufende Partien aus", () => {
  const params = new URLSearchParams({
    max: "999",
    perfType: "rapid,invalid,blitz",
    rated: "true",
    color: "white",
  });
  const filters = normalizeGameFilters(params);
  assert.deepEqual(filters, {
    max: 40,
    since: null,
    rated: "true",
    color: "white",
    perfType: "rapid,blitz",
  });
  const url = lichessGamesUrl("Paul_Chess", filters);
  assert.equal(url.searchParams.get("finished"), "true");
  assert.equal(url.searchParams.get("ongoing"), "false");
  assert.equal(url.searchParams.get("max"), "40");
  assert.equal(url.searchParams.get("accuracy"), "true");
});

test("Lichess-Antworten werden auf benötigte Partiedaten reduziert", () => {
  const game = sanitizeLichessGame({
    id: "AbCd1234",
    rated: true,
    variant: "standard",
    speed: "rapid",
    createdAt: 1_800_000_000_000,
    status: "mate",
    winner: "white",
    moves: "e4 e5",
    players: {
      white: { user: { id: "paul", name: "Paul" }, rating: 1700 },
      black: { user: { id: "max", name: "Max" }, rating: 1650 },
    },
    unexpectedSecret: "wird nicht übernommen",
  });
  assert.equal(game.id, "AbCd1234");
  assert.equal(game.players.white.user.name, "Paul");
  assert.equal(Object.hasOwn(game, "unexpectedSecret"), false);
});
