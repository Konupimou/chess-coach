import test from "node:test";
import assert from "node:assert/strict";
import {
  hasOpeningKnowledge,
  OPENING_FAMILY_KNOWLEDGE,
  OPENING_KNOWLEDGE_SOURCE,
  OPENING_VARIATION_KNOWLEDGE,
  openingGuidanceForPerspective,
  openingKnowledgeForFamily,
  openingKnowledgeForVariation,
} from "../openingKnowledge.js";

const requiredLists = [
  "pawnStructures",
  "development",
  "whitePlans",
  "blackPlans",
  "commonMistakes",
  "explanations",
];

test("häufige Eröffnungsfamilien besitzen strukturiertes Coach-Wissen", () => {
  assert.ok(Object.keys(OPENING_FAMILY_KNOWLEDGE).length >= 30);
  [
    "Sicilian Defense",
    "Ruy Lopez",
    "French Defense",
    "Queen's Gambit Declined",
    "Italian Game",
    "English Opening",
    "King's Indian Defense",
    "Caro-Kann Defense",
    "Nimzo-Indian Defense",
    "London System",
  ].forEach((name) => {
    const knowledge = openingKnowledgeForFamily(name);
    assert.equal(knowledge.source, OPENING_KNOWLEDGE_SOURCE);
    assert.equal(knowledge.scope, "family");
    assert.equal(knowledge.family, name);
    assert.ok(knowledge.overview.length > 40);
    requiredLists.forEach((field) => {
      assert.ok(Array.isArray(knowledge[field]));
      assert.ok(knowledge[field].length >= 2);
      assert.ok(knowledge[field].every((entry) => entry.length > 20));
    });
    assert.equal(hasOpeningKnowledge(knowledge), true);
  });
});

test("seltene oder noch unbekannte Familien erhalten nur allgemeine Prinzipien", () => {
  const knowledge = openingKnowledgeForFamily("Unbekannte Test-Eröffnung");
  assert.equal(knowledge.scope, "general");
  assert.equal(knowledge.family, null);
  assert.match(knowledge.overview, /Zentrum/);
  assert.equal(hasOpeningKnowledge(knowledge), true);
});

test("Eröffnungsdetails zeigen nur den Plan der gewählten Spielerfarbe", () => {
  const white = openingGuidanceForPerspective({
    familyName: "Sicilian Defense",
    color: "w",
  });
  const black = openingGuidanceForPerspective({
    familyName: "Sicilian Defense",
    color: "b",
  });

  assert.equal(white.sideName, "Weiß");
  assert.equal(black.sideName, "Schwarz");
  assert.match(white.plan, /Entwicklungsvorsprung/);
  assert.match(black.plan, /c-Linie/);
  assert.notEqual(white.plan, black.plan);
  assert.doesNotMatch(white.plan, /^Weiß:/);
  assert.doesNotMatch(black.plan, /^Schwarz:/);
});

test("die Borg-Verteidigung besitzt eigenes statt allgemeines Eröffnungswissen", () => {
  const knowledge = openingKnowledgeForFamily("Borg Defense");
  assert.equal(knowledge.scope, "family");
  assert.match(knowledge.overview, /riskante Antwort/);
  assert.match(knowledge.blackPlans[0], /Königsflügel/);
  assert.match(knowledge.whitePlans[0], /Zentrum/);
});

test("häufige Varianten besitzen eigene Ideen, ohne unbekannte Varianten zu erfinden", () => {
  assert.ok(Object.keys(OPENING_VARIATION_KNOWLEDGE).length >= 15);
  const twoKnights = openingKnowledgeForVariation(
    "Italian Game",
    "Two Knights Defense",
  );
  assert.equal(twoKnights.scope, "variation");
  assert.equal(twoKnights.family, "Italian Game");
  assert.match(twoKnights.idea, /Königsspringer/);
  assert.ok(twoKnights.whitePlan.length > 30);
  assert.ok(twoKnights.blackPlan.length > 30);
  assert.ok(twoKnights.watchFor.length > 30);
  assert.equal(
    openingKnowledgeForVariation("Italian Game", "Erfundene Variante"),
    null,
  );
});
