import test from "node:test";
import assert from "node:assert/strict";
import {
  hasOpeningKnowledge,
  OPENING_FAMILY_KNOWLEDGE,
  OPENING_KNOWLEDGE_SOURCE,
  openingKnowledgeForFamily,
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
