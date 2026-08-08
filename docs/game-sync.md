# Chess.com and Lichess game sync

The game-sync layer implements one rule: import once, normalize once, analyze
selectively, and reuse every current result. Sync never starts Stockfish.

## Architecture

```text
Chess.com PubAPI ─┐
                  ├─ provider adapter ─ normalized game ─ IndexedDB library
Lichess API ──────┘                                      │
                                                        filter/count
                                                            │
                                                     one-game job queue
                                                            │
                                               existing move-tree review pipeline
```

`gameSync/provider.js` defines the small provider contract. A provider validates
the username, fetches one bounded page, normalizes a raw game, and returns its
stable provider ID. Provider-specific values stop at the adapter boundary.

The public endpoint is `POST /api/game-sync/{chesscom|lichess}` with:

```json
{ "username": "player", "cursor": null }
```

The response contains normalized `games`, per-game `errors`, `hasMore`, and an
opaque `cursor`. Send that cursor back for the next page or the next sync.

## Chess.com import

The adapter reads the official PubAPI archive list, newest first, then downloads
at most three monthly archives per request. A first sync walks those pages until
history is complete. Later syncs revisit only archive months at or after the
latest stored game. Monthly `ETag` and `Last-Modified` validators are retained in
the cursor and sent as conditional requests; a `304` creates no work.

Set `CHESSCOM_USER_AGENT` to a useful product and contact string. Requests are
serial inside a batch. Network and 5xx failures use short exponential backoff;
`429` is returned immediately so the user can retry later. See the official
[Chess.com PubAPI guide](https://support.chess.com/en/articles/9650547-what-is-the-pubapi-and-how-do-i-use-it).

## Lichess import

The adapter calls the official user-game export endpoint as NDJSON. Public
username sync works without a token; the existing OAuth cookie is used when it
is available. Historical pages move backwards with `until`. Once backfill is
complete, future requests use `since = latestGameTimestamp + 1`, so old history
is not downloaded again. See the official
[Lichess API](https://lichess.org/api#tag/Games/operation/apiGamesUser).

## Normalized game schema

Every provider produces `chess-coach` schema version 1:

```js
{
  id: "lichess:AbCd1234",
  provider: "lichess",
  providerGameId: "AbCd1234",
  providerUrl: "https://lichess.org/AbCd1234",
  username: "player",
  playedAt: "2026-08-01T12:00:00.000Z",
  white: { username: "player", rating: 1542 },
  black: { username: "opponent", rating: 1498 },
  userColor: "white",
  result: "win",
  rated: true,
  timeControl: {
    category: "rapid",
    initialSeconds: 600,
    incrementSeconds: 5,
    raw: "600+5",
    providerCategory: "rapid",
    correspondenceDaysPerTurn: null
  },
  pgn: "...",
  opening: { eco: "C60", name: "Ruy Lopez" },
  fingerprint: "...",
  analysis: {
    state: "pending",
    version: null,
    profile: null,
    attempts: 0,
    error: null,
    findings: [],
    context: null,
    review: null
  },
  importedAt: "...",
  metadata: { /* useful raw provider values */ }
}
```

The stable ID prevents overlap within a provider. A conservative fingerprint of
players, minute, result, and legal move sequence catches the same game entering
through an overlapping or manual import without merging merely similar games.
Malformed PGNs and unsupported variants are reported individually and do not
abort a page.

## Time-control classification

`gameSync/timeControl.js` is the only classifier. Recognized provider categories
map to the canonical enum: `bullet`, `blitz`, `rapid`, `classical`,
`correspondence`, or `unknown`. `ultraBullet` is currently grouped under bullet,
while its original label remains in `providerCategory`.

When no recognized category exists, the classifier estimates duration as
`initialSeconds + 40 * incrementSeconds`:

- under 180 seconds: bullet
- under 480 seconds: blitz
- under 1,500 seconds: rapid
- otherwise: classical

Chess.com correspondence values such as `1/259200` are retained and normalized
to days per turn. Both raw and normalized values are always stored for audits.

## Storage, filtering, and count previews

Synced PGNs live in their own IndexedDB database, not in the existing 40-game
localStorage account list. Account metadata stores the provider cursor,
`lastSyncAt`, and latest provider error. Pure functions in `gameSync/library.js`
perform deduplication and queries.

Queries already support provider, time controls, date boundaries, last N,
rated/unrated, result, player color, player/opponent rating ranges, and opening
text. `previewGameQuery` returns a count and provider/time-control breakdown
without loading Stockfish.

## Analysis jobs and reuse

`createAnalysisBatch` applies the query and creates one job per missing game.
Each job contains the game ID, profile, current analysis version, attempts,
error state, and a copy of the important context: timestamp, provider, time
control, player color, and player rating. A worker claims one queued job at a
time. Interrupted or failed jobs can be requeued independently.

A completed game is reused only when both `analysis.version` and
`analysis.profile` match the requested values. Changing the diagnosis or review
version therefore queues stale games again while preserving old data until the
replacement completes. `gameSync/analysisAdapter.js` converts a normalized PGN
to the existing serialized move-tree record consumed by the browser review
pipeline. Findings and the compact review are stored back on the normalized
game with their context.

The profile-page MVP persists the queue and shows how many games were queued or
reused. Queue execution is intentionally a separate worker concern; it must not
be folded into a provider request.

## Adding another provider

Implement the `GameProvider` contract, return the normalized schema, register
the adapter in `gameSync/providers/index.js`, and expose its identifier in the
route/UI. Filtering, deduplication, preview counts, analysis jobs, and the review
adapter require no provider-specific changes.
