import test from "node:test";
import assert from "node:assert/strict";
import {
  describeLiveMove,
  engineOpponentLabel,
  ENGINE_LEVELS,
  nextStrongMoveStreak,
  normalizeEngineLevel,
  resolvePlayerColor,
} from "../playMode.js";

test("Spielstufen bleiben stabil und unbekannte Werte fallen auf Mittel zurück", () => {
  assert.equal(normalizeEngineLevel("hard"), "hard");
  assert.equal(normalizeEngineLevel("unbekannt"), "medium");
  assert.equal(ENGINE_LEVELS.medium.depth, 10);
  assert.equal(ENGINE_LEVELS.medium.elo, 1700);
  assert.equal(engineOpponentLabel("hard"), "Stockfish · Schwer");
});

test("Spielerfarbe unterstützt feste und zufällige Auswahl", () => {
  assert.equal(resolvePlayerColor("w", () => 0.9), "w");
  assert.equal(resolvePlayerColor("b", () => 0.1), "b");
  assert.equal(resolvePlayerColor("random", () => 0.1), "w");
  assert.equal(resolvePlayerColor("random", () => 0.9), "b");
});

test("nur beste und sehr gute Züge bauen den Präzisions-Streak auf", () => {
  assert.equal(nextStrongMoveStreak(0, "best"), 1);
  assert.equal(nextStrongMoveStreak(1, "excellent"), 2);
  assert.equal(nextStrongMoveStreak(2, "good"), 0);
  assert.equal(nextStrongMoveStreak(4, "blunder"), 0);
});

test("Live-Feedback nennt die Qualität knapp und verrät keinen nächsten Zug", () => {
  assert.deepEqual(describeLiveMove({
    moveNumber: 12,
    color: "w",
    san: "Nf3",
    quality: "best",
    accuracy: 100,
    bestSan: "Nf3",
  }), {
    tone: "best",
    badge: "Bester Zug",
    title: "12. Nf3",
    detail: "Stockfish bewertet ihn als erste Wahl; es ist kein messbarer Bewertungsverlust entstanden.",
  });

  const mistake = describeLiveMove({
    moveNumber: 8,
    color: "b",
    san: "Qh4",
    quality: "mistake",
    accuracy: 52.4,
    bestSan: "Nf6",
  });
  assert.equal(mistake.badge, "Fehler");
  assert.equal(mistake.title, "8… Qh4");
  assert.doesNotMatch(mistake.detail, /Nf6|besser war/i);
  assert.match(mistake.detail, /Stockfish-Bewertung/);
});
