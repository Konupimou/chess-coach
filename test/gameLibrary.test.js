import test from "node:test";
import assert from "node:assert/strict";
import { gameLibraryModel } from "../gameLibrary.js";

test("Partiekarte ordnet Profil und Gegner den richtigen Farben zu", () => {
  const white = gameLibraryModel({
    draft: {
      playerColor: "w",
      opponent: "Marta",
      playedAt: "2026-07-27",
    },
    profile: { name: "Paul" },
    opening: "Schottische Partie",
    result: "1-0",
  });
  assert.equal(white.white, "Paul");
  assert.equal(white.black, "Marta");
  assert.equal(white.opening, "Schottische Partie");
  assert.equal(white.result, "1–0");
  assert.match(white.date, /27/);

  const black = gameLibraryModel({
    draft: {
      playerColor: "b",
      opponent: "Marta",
      playedAt: "2026-07-27",
    },
    profile: { name: "Paul" },
  });
  assert.equal(black.white, "Marta");
  assert.equal(black.black, "Paul");
});

test("explizite Spielernamen und neutrale Fallbacks bleiben erhalten", () => {
  const explicit = gameLibraryModel({
    draft: {
      whitePlayer: "Alice",
      blackPlayer: "Bob",
      result: "*",
    },
  });
  assert.equal(explicit.white, "Alice");
  assert.equal(explicit.black, "Bob");
  assert.equal(explicit.date, "Datum offen");
  assert.equal(explicit.result, "Partie läuft");
  assert.equal(explicit.opening, "Noch nicht erkannt");
});

test("ein vorgemerktes Ergebnis bleibt sichtbar, solange das Brett nicht terminal ist", () => {
  const model = gameLibraryModel({
    draft: { result: "1-0" },
    result: "*",
  });
  assert.equal(model.result, "1–0");
});
