import test from "node:test";
import assert from "node:assert/strict";
import {
  LICHESS_TRAINING_DATASET,
  LICHESS_TRAINING_THEME_IDS,
  lichessTrainingKnowledgeForCoach,
  lichessTrainingPromptData,
  relevantLichessTrainingThemes,
  validateLichessTrainingDocument,
} from "../lichessTrainingKnowledge.js";

function validDocument() {
  const entries = LICHESS_TRAINING_THEME_IDS.map((theme, index) => ({
    id: index.toString(16).padStart(16, "0"),
    theme,
    themes: [theme],
    rating: 800,
    trainingFen: "8/8/8/8/8/8/4k3/6K1 w - - 0 1",
    solution: ["g1f1"],
  }));
  return {
    schema: "chess-coach.lichess-puzzles.v1",
    license: "CC0-1.0",
    sourceUrl: "https://database.lichess.org/lichess_db_puzzle.csv.zst",
    filters: {
      minRating: 600,
      maxRating: 1100,
      themes: [...LICHESS_TRAINING_THEME_IDS],
    },
    counts: {
      accepted: entries.length,
      byTheme: Object.fromEntries(LICHESS_TRAINING_THEME_IDS.map((theme) => [theme, 1])),
    },
    entries,
  };
}

test("Lichess-Trainingsartefakt verlangt Schema, CC0 und saubere Einträge", () => {
  const document = validDocument();
  assert.deepEqual(validateLichessTrainingDocument(document), {
    valid: true,
    errors: [],
  });

  const invalid = structuredClone(document);
  invalid.license = "all-rights-reserved";
  invalid.sourceUrl = "https://database.lichess.org/anderer-export.csv.zst";
  invalid.entries[0].author = "Nicht im Laufzeitschema erlaubt";
  invalid.entries[1].solution = ["kein-zug"];
  invalid.counts.accepted = 99;
  const checked = validateLichessTrainingDocument(invalid);
  assert.equal(checked.valid, false);
  assert.match(checked.errors.join(" "), /CC0-1\.0/);
  assert.match(checked.errors.join(" "), /sourceUrl/);
  assert.match(checked.errors.join(" "), /unerlaubte/);
  assert.match(checked.errors.join(" "), /solution/);
  assert.match(checked.errors.join(" "), /counts\.accepted/);
});

test("Nachricht und Wissenskontext wählen nur passende Trainingsthemen", () => {
  assert.deepEqual(
    relevantLichessTrainingThemes({
      message: "Ich möchte Turmendspiele und Grundreihenschwächen üben.",
    }),
    ["rookEndgame", "backRankMate"],
  );
  assert.deepEqual(
    relevantLichessTrainingThemes({
      message: "Was sollte ich lernen?",
      knowledgeContext: {
        concepts: [{
          id: "strategy.prophylaxis",
          name: "Prophylaxe und gegnerischer Plan",
          matchedKeywords: [],
          matchedSignals: [],
        }],
      },
    }),
    ["defensiveMove"],
  );
  assert.deepEqual(
    relevantLichessTrainingThemes({ message: "Wie spät ist es?" }),
    [],
  );
});

test("Coach erhält ausschließlich Themen, Anzahlen und Ratingbereich", () => {
  assert.equal(LICHESS_TRAINING_DATASET.license, "CC0-1.0");
  assert.equal(LICHESS_TRAINING_DATASET.count, 7_394);
  const selected = lichessTrainingKnowledgeForCoach({
    message: "Gib mir Übungen zu Ablenkung und Grundreihenmatt.",
  });
  assert.equal(selected.used, true);
  assert.deepEqual(selected.themes.map((theme) => theme.id), [
    "deflection",
    "backRankMate",
  ]);
  assert.equal(selected.count, 1_500);
  assert.deepEqual(selected.ratingRange, { min: 600, max: 1100 });

  const prompt = JSON.stringify(lichessTrainingPromptData(selected));
  assert.match(prompt, /"themes"/);
  assert.match(prompt, /"count":1500/);
  assert.match(prompt, /"ratingRange":\{"min":600,"max":1100\}/);
  assert.doesNotMatch(prompt, /solution|trainingFen|e3e4|663f75430d5e5e7d/);

  const irrelevant = lichessTrainingKnowledgeForCoach({
    message: "Wie spät ist es?",
  });
  assert.equal(irrelevant.used, false);
  assert.equal(lichessTrainingPromptData(irrelevant), null);
});
