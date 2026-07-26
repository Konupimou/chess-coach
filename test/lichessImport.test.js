import test from "node:test";
import assert from "node:assert/strict";
import { deserializeMoveTree } from "../gameStorage.js";
import {
  lichessGameToSavedRecord,
  lichessImportability,
} from "../lichessImport.js";

const rapidGame = {
  id: "AbCd1234",
  rated: true,
  variant: "standard",
  speed: "rapid",
  perf: "rapid",
  createdAt: Date.UTC(2026, 6, 20, 18, 30),
  status: "resign",
  winner: "white",
  moves: "e4 e5 Nf3 Nc6 Bb5 a6 Ba4 Nf6 O-O Be7",
  players: {
    white: { user: { id: "paul", name: "Paul" }, rating: 1720 },
    black: { user: { id: "opponent", name: "Opponent" }, rating: 1690 },
  },
  opening: { eco: "C60", name: "Ruy Lopez" },
  clock: { initial: 600, increment: 5 },
};

test("abgeschlossene Lichess-Partie wird als analysierbarer Speicherstand importiert", () => {
  const record = lichessGameToSavedRecord(
    rapidGame,
    "Paul",
    new Date("2026-07-21T10:00:00.000Z"),
  );
  assert.equal(record.id, "lichess:AbCd1234");
  assert.equal(record.result, "1-0");
  assert.equal(record.plyCount, 10);
  assert.equal(record.metadata.playerColor, "w");
  assert.equal(record.metadata.opponent, "Opponent");
  assert.equal(record.metadata.timeFormat, "rapid");
  assert.equal(record.metadata.timeControl, "600+5");
  assert.equal(record.metadata.opening, "Ruy Lopez");
  assert.equal(record.metadata.platform, "Lichess");
  assert.match(record.metadata.notes, /lichess\.org\/AbCd1234/);
  assert.match(record.pgn, /1\. e4 e5 2\. Nf3 Nc6/);

  const root = deserializeMoveTree(record.tree);
  assert.equal(root.mainline.move.san, "e4");
  assert.equal(record.currentPath.length, 10);
});

test("laufende Partien und Varianten werden nicht importiert", () => {
  assert.match(
    lichessImportability({ ...rapidGame, status: "started" }, "Paul"),
    /nicht abgeschlossen/,
  );
  assert.match(
    lichessImportability({ ...rapidGame, variant: "chess960" }, "Paul"),
    /Standardschach/,
  );
});

test("Lichess-Partie muss zum verbundenen Benutzer gehören", () => {
  assert.match(lichessImportability(rapidGame, "AnderePerson"), /zugeordnet/);
});
