import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { Chess } from "chess.js";
import { createOpeningBook } from "../openingRecognition.js";
import {
  deriveOpeningLifecycle,
  openingAnnouncementContext,
} from "../openingLifecycle.js";

const runtime = JSON.parse(
  await readFile(new URL("../public/data/openings/openings.runtime.json", import.meta.url), "utf8"),
);
const book = createOpeningBook(runtime);

function pathFromSan(moves) {
  const game = new Chess();
  const path = [{ fen: game.fen() }];
  for (const san of moves) {
    const move = game.move(san);
    path.push({ move, fen: game.fen() });
  }
  return path;
}

test("generische erste Namen bleiben stumm und Italienisch wird einmal erkannt", () => {
  const lifecycle = deriveOpeningLifecycle(
    pathFromSan(["e4", "e5", "Nf3", "Nc6", "Bc4"]),
    book,
  );
  assert.deepEqual(
    lifecycle.events.map((event) => [event.kind, event.familyKey]),
    [["family", "Italian Game"]],
  );
  assert.equal(lifecycle.currentEvent?.familyDisplay, "Italienische Partie");
});

test("eine konkrete Familie und spätere Variante werden nicht bei jedem Zug wiederholt", () => {
  const lifecycle = deriveOpeningLifecycle(
    pathFromSan(["e4", "e5", "Nf3", "Nc6", "Bc4", "Nf6", "d4"]),
    book,
  );
  const familyEvents = lifecycle.events.filter((event) => event.kind === "family");
  const variationEvents = lifecycle.events.filter((event) => event.kind === "variation");
  assert.equal(familyEvents.length, 1);
  assert.equal(familyEvents[0].familyKey, "Italian Game");
  assert.equal(variationEvents.length, 1);
  assert.equal(variationEvents[0].variationKey, "Two Knights Defense");
  assert.equal(variationEvents[0].triggerPly, 6);
  assert.equal(new Set(lifecycle.events.map((event) => event.id)).size, lifecycle.events.length);
});

test("das Verlassen der lokalen Theorie erscheint genau am Abweichungszug", () => {
  const path = pathFromSan(["e4", "e5", "Nf3", "Nc6", "Bc4", "Nf6", "a3"]);
  const lifecycle = deriveOpeningLifecycle(path, book);
  const exits = lifecycle.events.filter((event) => event.kind === "database_exit");
  assert.equal(exits.length, 1);
  assert.equal(exits[0].triggerPly, 7);
  assert.equal(exits[0].sequenceExitMove, "a2a3");
  assert.ok(exits[0].continuation?.uci?.length > 0);
  assert.equal(lifecycle.currentEvent?.kind, "database_exit");

  const context = openingAnnouncementContext(lifecycle.currentEvent);
  assert.equal(context.kind, "database_exit");
  assert.equal(context.continuation.uci.length, context.continuation.san.length);
});

test("Undo und erneute Ableitung erzeugen dieselben stabilen Ereignisse", () => {
  const full = pathFromSan(["e4", "e5", "Nf3", "Nc6", "Bc4", "Nf6"]);
  const first = deriveOpeningLifecycle(full, book).events.map((event) => event.id);
  deriveOpeningLifecycle(full.slice(0, -1), book);
  const second = deriveOpeningLifecycle(full, book).events.map((event) => event.id);
  assert.deepEqual(second, first);
});

test("eine echte frühe Eröffnung darf einmal genannt werden", () => {
  const lifecycle = deriveOpeningLifecycle(pathFromSan(["c4"]), book);
  assert.equal(lifecycle.events.length, 1);
  assert.equal(lifecycle.currentEvent?.familyKey, "English Opening");
});

test("eine konkrete Variante wird exakt beim Eintritt statt verspätet angekündigt", () => {
  const lifecycle = deriveOpeningLifecycle(pathFromSan([
    "e4", "c5", "Nf3", "d6", "d4", "cxd4",
    "Nxd4", "Nf6", "Nc3", "a6", "Be3",
  ]), book);
  const variations = lifecycle.events.filter((event) => event.kind === "variation");
  assert.equal(variations.length, 2);
  assert.equal(variations[0].variationKey, "Najdorf Variation");
  assert.equal(variations[0].triggerPly, 10);
  assert.equal(
    variations[1].variationKey,
    "Najdorf Variation, English Attack",
  );
  assert.equal(variations[1].triggerPly, 11);
  assert.match(variations[1].fullDisplay, /Najdorf-Variante, Englischer Angriff/);
});

test("nach dem Datenbank-Ausstieg wird keine zweite Eröffnungsfamilie behauptet", () => {
  const lifecycle = deriveOpeningLifecycle(
    pathFromSan(["Nf3", "Nf6", "c4", "e6", "d4", "b6"]),
    book,
  );
  assert.equal(
    lifecycle.events.filter((event) => event.kind === "family").length,
    1,
  );
  assert.equal(
    lifecycle.events.filter((event) => event.kind === "database_exit").length,
    1,
  );
  assert.equal(lifecycle.events.at(-1)?.kind, "database_exit");
});

test("technische Normal- und Hauptlinien-Zusätze gelangen nicht in die Anzeige", () => {
  const lifecycle = deriveOpeningLifecycle(pathFromSan([
    "e4", "e5", "Nf3", "Nc6", "Bc4", "Bc5", "d3", "Nf6",
    "O-O", "d6", "c3", "O-O",
  ]), book);
  const labels = lifecycle.events
    .map((event) => `${event.variationKey || ""} ${event.fullDisplay || ""}`)
    .join(" ");
  assert.doesNotMatch(labels, /\b(?:Normal|Main Line|Rare Defenses|with)\b/i);
});

test("technische with-Zusätze werden auch aus Familiennamen entfernt", () => {
  const lifecycle = deriveOpeningLifecycle(
    pathFromSan(["d4", "d5", "Nc3", "e6", "Bf4"]),
    book,
  );
  assert.equal(lifecycle.presentation?.familyKey, "Rapport-Jobava System");
  assert.doesNotMatch(lifecycle.presentation?.fullDisplay || "", /\bwith\b/i);
});
