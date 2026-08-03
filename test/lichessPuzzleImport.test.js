import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { createZstdCompress } from "node:zlib";
import { Chess } from "chess.js";
import {
  classifyLichessPuzzleSource,
  importLichessPuzzles,
  normalizeLichessPuzzleFilters,
  parseLichessPuzzleRow,
  prepareLichessPuzzle,
  splitCsvRow,
} from "../lichessPuzzleImport.js";
import { parsePuzzleImportArguments } from "../scripts/import-lichess-puzzles.mjs";

const HEADER = "PuzzleId,FEN,Moves,Rating,RatingDeviation,Popularity,NbPlays,Themes,GameUrl,OpeningTags";
const START_FEN = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";

function row({
  id,
  moves,
  rating = 800,
  deviation = 70,
  popularity = 80,
  themes,
  url = "https://lichess.org/SecretGame/black#12",
  opening = "Secret Opening Name",
}) {
  return [
    id,
    START_FEN,
    moves,
    rating,
    deviation,
    popularity,
    1234,
    themes,
    url,
    opening,
  ].join(",");
}

test("CSV-Helfer lesen Anführungszeichen und verwerfen Attributionen früh", () => {
  assert.deepEqual(splitCsvRow('a,"b,c","d""e"'), ["a", "b,c", 'd"e']);
  const parsed = parseLichessPuzzleRow(row({
    id: "SecretPuzzleId",
    moves: "e2e4 e7e5 g1f3",
    themes: "short deflection",
  }));
  assert.deepEqual(Object.keys(parsed).sort(), [
    "fen",
    "moves",
    "popularity",
    "rating",
    "ratingDeviation",
    "themes",
  ]);
  assert.equal(JSON.stringify(parsed).includes("SecretPuzzleId"), false);
});

test("Startzug wird angewendet und die gespeicherte Lösung beginnt mit Zug zwei", () => {
  const parsed = parseLichessPuzzleRow(row({
    id: "PuzzleA",
    moves: "e2e4 e7e5 g1f3",
    themes: "deflection",
  }));
  const prepared = prepareLichessPuzzle(parsed);
  const expected = new Chess(START_FEN);
  expected.move({ from: "e2", to: "e4" });
  assert.equal(prepared.trainingFen, expected.fen());
  assert.deepEqual(prepared.solution, ["e7e5", "g1f3"]);
  assert.match(prepared.id, /^[a-f0-9]{16}$/);

  assert.throws(
    () => prepareLichessPuzzle({ ...parsed, moves: ["e2e4", "e2e3"] }),
    /Illegaler Lösungszug/,
  );
});

test("Importer filtert, quotiert, anonymisiert und liefert deterministisches JSON", async () => {
  const directory = await mkdtemp(join(tmpdir(), "lichess-puzzles-"));
  const filename = join(directory, "sample.csv");
  const csv = [
    HEADER,
    row({ id: "PrivateOne", moves: "e2e4 e7e5 g1f3", themes: "deflection short" }),
    row({ id: "TooStrong", moves: "d2d4 d7d5 c1f4", rating: 1600, themes: "rookEndgame" }),
    row({ id: "Illegal", moves: "e2e4 e2e3", themes: "rookEndgame" }),
    row({ id: "PrivateTwo", moves: "d2d4 d7d5 c1f4", themes: "rookEndgame endgame" }),
    row({ id: "NeverRead", moves: "c2c4 e7e5 b1c3", themes: "deflection" }),
  ].join("\n");
  await writeFile(filename, `${csv}\n`);

  try {
    const options = {
      source: filename,
      themes: ["deflection", "rookEndgame"],
      perThemeQuota: 1,
    };
    const first = await importLichessPuzzles(options);
    const second = await importLichessPuzzles(options);
    assert.deepEqual(first, second);
    assert.equal(first.counts.accepted, 2);
    assert.equal(first.counts.rowsRead, 4);
    assert.deepEqual(first.counts.byTheme, { deflection: 1, rookEndgame: 1 });
    assert.equal(first.counts.skipped.rating, 1);
    assert.equal(first.counts.skipped.illegal, 1);
    assert.equal(first.counts.stoppedAfterQuota, true);
    assert.deepEqual(first.entries.map((entry) => entry.solution[0]), ["d7d5", "e7e5"]);

    const serialized = JSON.stringify(first);
    assert.doesNotMatch(serialized, /PrivateOne|PrivateTwo|SecretGame|Secret Opening|NeverRead/);
    assert.equal(first.license, "CC0-1.0");
    assert.match(first.sourceUrl, /^https:\/\/database\.lichess\.org\//);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("CSV.ZST wird gestreamt und dieselben Standardfilter gelten", async () => {
  const directory = await mkdtemp(join(tmpdir(), "lichess-puzzles-zst-"));
  const filename = join(directory, "sample.csv.zst");
  const csv = `${HEADER}\n${row({
    id: "CompressedPuzzle",
    moves: "e2e4 e7e5 g1f3",
    themes: "defensiveMove",
  })}\n`;

  try {
    const compressed = [];
    for await (const chunk of Readable.from([csv]).pipe(createZstdCompress())) {
      compressed.push(chunk);
    }
    const metadata = Buffer.from([0x50, 0x2a, 0x4d, 0x18, 0x04, 0x00, 0x00, 0x00, 1, 2, 3, 4]);
    await writeFile(filename, Buffer.concat([metadata, ...compressed]));
    const result = await importLichessPuzzles({
      source: filename,
      themes: ["defensiveMove"],
      perThemeQuota: 1,
    });
    assert.equal(result.counts.accepted, 1);
    assert.equal(result.entries[0].theme, "defensiveMove");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("Filtergrenzen und Themen-Whitelist werden validiert", () => {
  assert.deepEqual(
    normalizeLichessPuzzleFilters().themes,
    [
      "pawnEndgame",
      "rookEndgame",
      "bishopEndgame",
      "knightEndgame",
      "deflection",
      "capturingDefender",
      "backRankMate",
      "defensiveMove",
      "equality",
      "sacrifice",
    ],
  );
  assert.throws(
    () => normalizeLichessPuzzleFilters({ themes: ["privateAuthorTag"] }),
    /Nicht erlaubtes/,
  );
  assert.throws(
    () => normalizeLichessPuzzleFilters({ minRating: 1200, maxRating: 900 }),
    /minRating/,
  );
});

test("Remote-Import ist auf den exakten offiziellen Lichess-Pfad beschränkt", async () => {
  assert.equal(
    classifyLichessPuzzleSource("https://database.lichess.org/lichess_db_puzzle.csv.zst").kind,
    "https",
  );
  assert.throws(
    () => classifyLichessPuzzleSource("https://example.com/lichess_db_puzzle.csv.zst"),
    /offiziellen Lichess-Puzzle-Datenbank/,
  );
  assert.throws(
    () => classifyLichessPuzzleSource("https://database.lichess.org.evil.example/lichess_db_puzzle.csv.zst"),
    /offiziellen Lichess-Puzzle-Datenbank/,
  );
  assert.throws(
    () => classifyLichessPuzzleSource("https://database.lichess.org/other.csv.zst"),
    /offiziellen Lichess-Puzzle-Datenbank/,
  );
  assert.throws(
    () => classifyLichessPuzzleSource("https://database.lichess.org/lichess_db_puzzle.csv.zst?mirror=1"),
    /offiziellen Lichess-Puzzle-Datenbank/,
  );
  await assert.rejects(
    importLichessPuzzles({ source: "https://attacker.example/puzzles.csv.zst" }),
    /offiziellen Lichess-Puzzle-Datenbank/,
  );
});

test("800-Elo-NPM-Script pinnt Ziel, Filter und alle aktuellen Themenquoten", async () => {
  const packageJson = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
  const command = packageJson.scripts["puzzles:import:800"];
  assert.equal(typeof command, "string");
  const parsed = parsePuzzleImportArguments(command.split(" ").slice(2));
  assert.equal(parsed.source, "https://database.lichess.org/lichess_db_puzzle.csv.zst");
  assert.match(parsed.output, /data\/knowledge\/lichess-puzzles-800\.json$/);
  assert.deepEqual(parsed.options, {
    perThemeQuota: {
      pawnEndgame: "1000",
      rookEndgame: "1000",
      bishopEndgame: "600",
      knightEndgame: "600",
      deflection: "750",
      capturingDefender: "750",
      backRankMate: "750",
      defensiveMove: "1000",
      equality: "500",
      sacrifice: "500",
    },
    minRating: "600",
    maxRating: "1100",
    maxRatingDeviation: "100",
    minPopularity: "60",
    themes: [
      "pawnEndgame",
      "rookEndgame",
      "bishopEndgame",
      "knightEndgame",
      "deflection",
      "capturingDefender",
      "backRankMate",
      "defensiveMove",
      "equality",
      "sacrifice",
    ],
  });
  assert.throws(
    () => parsePuzzleImportArguments([
      "local.csv",
      "--themes", "pawnEndgame,rookEndgame",
      "--theme-quota", "pawnEndgame=1000",
    ]),
    /Explizite Quoten fehlen für: rookEndgame/,
  );
});
