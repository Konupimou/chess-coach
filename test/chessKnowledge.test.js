import test from "node:test";
import assert from "node:assert/strict";

import {
  CORE_CHESS_CONCEPTS,
  KNOWLEDGE_SCHEMA_VERSION,
  KNOWLEDGE_TAXONOMY,
  getConceptById,
  listConceptsByCategory,
  retrieveConcepts,
  validateKnowledgeBase,
  validateTaxonomy,
} from "../chessKnowledge/index.js";
import { CORE_CHESS_CONCEPTS as DIRECT_CONCEPTS } from "../chessKnowledge/concepts.js";
import { KNOWLEDGE_TAXONOMY as DIRECT_TAXONOMY } from "../chessKnowledge/taxonomy.js";

const REQUIRED_CATEGORY_IDS = [
  "opening",
  "tactical-motifs",
  "checkmate-patterns",
  "strategy",
  "positional-play",
  "piece-activity",
  "piece-evaluation",
  "pawn-structures",
  "pawn-play",
  "attack",
  "king-attack",
  "defence",
  "prophylaxis",
  "exchanges-and-transformations",
  "calculation",
  "evaluation",
  "planning",
  "decision-making",
  "pawn-endgames",
  "rook-endgames",
  "queen-endgames",
  "bishop-endgames",
  "knight-endgames",
  "bishop-versus-knight",
  "minor-piece-endgames",
  "mixed-material-endgames",
  "fortresses-and-drawing-mechanisms",
  "conversion-of-advantages",
  "practical-chess",
  "psychology",
  "time-management",
  "training-methods",
  "game-analysis",
  "mistake-classification",
  "opening-preparation",
  "pattern-recognition",
];

const BEGINNER_CONCEPT_IDS = [
  "calculation.beginner-safety-check",
  "strategy.good-exchange",
  "strategy.exchange-sacrifice",
  "pawns.pawn-majority",
  "defence.active-defence",
  "endgame.active-king",
  "endgame.rule-of-square",
  "endgame.rook-activity",
  "endgame.rook-behind-passed-pawn",
  "endgame.minor-piece-fit",
  "endgame.drawing-resources",
];

function clone(value) {
  return structuredClone(value);
}

test("Taxonomie enthält alle vorgegebenen Kategorien mit stabilen eindeutigen IDs", () => {
  assert.deepEqual(validateTaxonomy(KNOWLEDGE_TAXONOMY), { valid: true, errors: [] });
  const ids = KNOWLEDGE_TAXONOMY.map((category) => category.id);
  for (const requiredId of REQUIRED_CATEGORY_IDS) {
    assert.ok(ids.includes(requiredId), `Kategorie fehlt: ${requiredId}`);
  }
  assert.equal(new Set(ids).size, ids.length);
  assert.ok(ids.every((id) => /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id)));
});

test("Wissensbasis enthält genau 41 vollständig validierte Kernkonzepte", () => {
  assert.equal(KNOWLEDGE_SCHEMA_VERSION, 1);
  assert.equal(CORE_CHESS_CONCEPTS.length, 41);
  assert.deepEqual(
    validateKnowledgeBase({ taxonomy: KNOWLEDGE_TAXONOMY, concepts: CORE_CHESS_CONCEPTS }),
    { valid: true, errors: [] },
  );

  for (const concept of CORE_CHESS_CONCEPTS) {
    assert.ok(concept.definition.de.length >= 40, `${concept.id}: Definition zu kurz`);
    assert.ok(concept.explanation.de.length >= 80, `${concept.id}: Erklärung zu kurz`);
    assert.ok(concept.recognitionCues.de.length >= 2, `${concept.id}: Erkennungsmerkmale fehlen`);
    assert.ok(concept.recommendations.de.length >= 2, `${concept.id}: Empfehlungen fehlen`);
    assert.ok(concept.commonMistakes.de.length >= 1, `${concept.id}: typische Fehler fehlen`);
    assert.ok(concept.practicalQuestions.de.length >= 2, `${concept.id}: Prüffragen fehlen`);
    assert.ok(concept.training.de.length >= 40, `${concept.id}: Training fehlt`);
  }
});

test("Wissensbasis enthält die einfachen Strategie- und Endspielkarten für 800 Elo", () => {
  for (const id of BEGINNER_CONCEPT_IDS) {
    const concept = getConceptById(id);
    assert.ok(concept, `Anfängerkonzept fehlt: ${id}`);
    assert.ok(concept.difficulty.includes("beginner"), `${id}: nicht für Anfänger markiert`);
    assert.ok(concept.retrieval.signals.length >= 3, `${id}: zu wenige klare Retrieval-Signale`);
  }

  const rookEndgame = retrieveConcepts({ signals: ["rook-endgame"], phases: ["endgame"], limit: 3 });
  assert.equal(rookEndgame[0].concept.id, "endgame.rook-activity");

  const exchangeSacrifice = retrieveConcepts({ query: "Ist hier ein Qualitätsopfer gut?", phases: ["middlegame"] });
  assert.equal(exchangeSacrifice[0].concept.id, "strategy.exchange-sacrifice");

  assert.deepEqual(
    retrieveConcepts({ signals: ["rule-of-square"], phases: ["opening"] }),
    [],
  );
});

test("Schema meldet doppelte IDs, ungültige Kategorien und kaputte Beziehungen", () => {
  const duplicate = clone(CORE_CHESS_CONCEPTS[0]);
  const invalid = clone(CORE_CHESS_CONCEPTS[1]);
  invalid.categories = ["nicht-vorhanden"];
  invalid.relatedConcepts = ["unbekanntes-konzept"];

  const result = validateKnowledgeBase({
    taxonomy: KNOWLEDGE_TAXONOMY,
    concepts: [...CORE_CHESS_CONCEPTS, duplicate, invalid],
  });

  assert.equal(result.valid, false);
  assert.ok(result.errors.some((error) => error.includes("doppelte Konzept-ID")));
  assert.ok(result.errors.some((error) => error.includes("unbekannte Kategorie")));
  assert.ok(result.errors.some((error) => error.includes("unbekanntes verwandtes Konzept")));
});

test("Validator behandelt fehlerhafte Taxonomien als Datenfehler statt zu werfen", () => {
  const malformed = validateKnowledgeBase({ taxonomy: {}, concepts: CORE_CHESS_CONCEPTS });
  assert.equal(malformed.valid, false);
  assert.ok(malformed.errors.some((error) => error.includes("Taxonomie")));

  const invalidOrder = clone(KNOWLEDGE_TAXONOMY);
  invalidOrder[1].order = invalidOrder[0].order;
  assert.equal(validateTaxonomy(invalidOrder).valid, false);

  const unknownField = clone(KNOWLEDGE_TAXONOMY);
  unknownField[0].unplanned = true;
  assert.equal(validateTaxonomy(unknownField).valid, false);
});

test("Konzepte sind stabil per ID und Kategorie abrufbar", () => {
  assert.equal(getConceptById("opening.development-before-attack")?.name.de, "Entwicklung vor Angriff");
  assert.equal(getConceptById("nicht-vorhanden"), null);

  const openingConcepts = listConceptsByCategory("opening");
  assert.ok(openingConcepts.length >= 6);
  assert.ok(openingConcepts.every((concept) => concept.categories.includes("opening")));
  assert.equal(Object.isFrozen(openingConcepts), true);
  assert.deepEqual(listConceptsByCategory("nicht-vorhanden"), []);
});

test("Retriever liefert begrenzt relevante Karten über Signale und Suchbegriffe", () => {
  const bySignal = retrieveConcepts({
    signals: ["minor-pieces-on-starting-squares", "more-minor-pieces-on-starting-squares-than-opponent"],
    limit: 3,
  });
  assert.equal(bySignal[0].concept.id, "opening.development-before-attack");
  assert.ok(bySignal[0].matchedSignals.includes("more-minor-pieces-on-starting-squares-than-opponent"));
  assert.ok(bySignal.length <= 3);
  assert.equal(Object.isFrozen(bySignal), true);

  const byText = retrieveConcepts({ query: "Wie verhindere ich einen Gabelangriff?", limit: 2 });
  assert.equal(byText[0].concept.id, "tactics.fork");
  assert.ok(byText[0].score > 0);

  assert.deepEqual(
    retrieveConcepts({ query: "Opposition", phases: ["opening"], limit: 3 }),
    [],
  );
  assert.deepEqual(retrieveConcepts({ query: "", signals: [], limit: 3 }), []);
});

test("Zurückgegebene Wissensdaten können nicht versehentlich mutiert werden", () => {
  assert.equal(Object.isFrozen(DIRECT_CONCEPTS), true);
  assert.equal(Object.isFrozen(DIRECT_TAXONOMY), true);
  assert.equal(Object.isFrozen(DIRECT_TAXONOMY[0].name), true);

  const concept = getConceptById("tactics.fork");
  assert.equal(Object.isFrozen(concept), true);
  assert.equal(Object.isFrozen(concept.recommendations.de), true);
  assert.throws(() => concept.recommendations.de.push("Manipulation"), TypeError);
});
