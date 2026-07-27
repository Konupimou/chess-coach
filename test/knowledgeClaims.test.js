import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  KNOWLEDGE_CLAIMS,
  KNOWLEDGE_FEATURE_IDS,
  KNOWLEDGE_SOURCES,
  buildCoachKnowledgeContext,
  normalizeLearnerLevel,
  retrieveKnowledgeClaims,
  validateKnowledgeDocument,
} from "../knowledgeClaims.js";

const rawDocument = JSON.parse(
  readFileSync(
    new URL("../data/knowledge/claims.json", import.meta.url),
    "utf8",
  ),
);

test("Wissensdokument ist valide, paraphrasiert und quellenbewusst", () => {
  const result = validateKnowledgeDocument(rawDocument);
  assert.deepEqual(result, { valid: true, errors: [] });
  assert.equal(rawDocument.contentPolicy.mode, "paraphrase-only");
  assert.ok(KNOWLEDGE_CLAIMS.length >= 35);
  assert.ok(KNOWLEDGE_SOURCES.length >= 5);
  assert.ok(KNOWLEDGE_FEATURE_IDS.length >= 50);

  KNOWLEDGE_CLAIMS.forEach((claim) => {
    assert.equal(claim.reviewStatus, "reviewed");
    assert.ok(claim.confidence >= 0.8);
    assert.ok(claim.paraphrase.length > 40);
    assert.ok(claim.rationale.length > 30);
    assert.ok(claim.requiredFeatures.length > 0);
    assert.ok(claim.sources.length > 0);
    claim.sources.forEach((source) => {
      assert.equal(source.reviewStatus, "reviewed");
      assert.equal(source.referenceReviewStatus, "reviewed");
      assert.match(source.usage, /^paraphrased-/);
      assert.ok(source.title);
      assert.ok(source.author);
      assert.ok(source.locator);
    });
  });
});

test("alle Concept-IDs verweisen auf die bestehende Schach-Ontology", () => {
  const ontology = JSON.parse(
    readFileSync(new URL("../chess-ontology.json", import.meta.url), "utf8"),
  );
  const conceptIds = new Set(ontology.concepts.map((concept) => concept.id));
  const missing = KNOWLEDGE_CLAIMS.flatMap((claim) => (
    claim.conceptIds.filter((id) => !conceptIds.has(id))
  ));
  assert.deepEqual(missing, []);
});

test("Retriever verlangt alle Features und respektiert Ausschlüsse", () => {
  const matching = retrieveKnowledgeClaims({
    phase: "opening",
    featureIds: ["development.lead", "king.opponent_uncastled", "center.break_available"],
    learnerLevel: "intermediate",
    limit: 5,
  });
  assert.ok(matching.some((claim) => claim.id === "development-open-center-with-lead"));

  const incomplete = retrieveKnowledgeClaims({
    phase: "opening",
    featureIds: ["development.lead", "king.opponent_uncastled"],
    learnerLevel: "intermediate",
    limit: 5,
  });
  assert.ok(!incomplete.some((claim) => claim.id === "development-open-center-with-lead"));

  const excluded = retrieveKnowledgeClaims({
    phase: "opening",
    featureIds: [
      "development.lead",
      "king.opponent_uncastled",
      "center.break_available",
      "king.own_exposed",
    ],
    learnerLevel: "intermediate",
    limit: 5,
  });
  assert.ok(!excluded.some((claim) => claim.id === "development-open-center-with-lead"));
});

test("Phase verhindert unpassende Claims", () => {
  const opening = retrieveKnowledgeClaims({
    phase: "opening",
    featureIds: ["file.open", "piece.rook_can_occupy"],
    learnerLevel: "beginner",
  });
  assert.deepEqual(opening, []);

  const endgame = retrieveKnowledgeClaims({
    phase: "endspiel",
    featureIds: ["file.open", "piece.rook_can_occupy"],
    learnerLevel: "anfänger",
  });
  assert.deepEqual(
    endgame.map((claim) => claim.id),
    ["open-lines-rook-on-open-file"],
  );
});

test("Niveau folgt Account-Rating und schützt Anfänger vor Spezialclaims", () => {
  assert.equal(normalizeLearnerLevel(900), "beginner");
  assert.equal(normalizeLearnerLevel({ rating: 1200 }), "intermediate");
  assert.equal(normalizeLearnerLevel({ elo: 1799 }), "intermediate");
  assert.equal(normalizeLearnerLevel(1800), "advanced");
  assert.equal(normalizeLearnerLevel("Experte"), "advanced");

  const features = ["position.no_forcing_priority", "opponent.restrictable_plan"];
  assert.deepEqual(
    retrieveKnowledgeClaims({
      phase: "middlegame",
      featureIds: features,
      learnerLevel: 900,
    }),
    [],
  );
  assert.deepEqual(
    retrieveKnowledgeClaims({
      phase: "middlegame",
      featureIds: features,
      learnerLevel: 1900,
    }).map((claim) => claim.id),
    ["prophylaxis-useful-waiting-move"],
  );
});

test("unfreigegebene Claims und Quellen werden nie ausgeliefert", () => {
  const approved = KNOWLEDGE_CLAIMS.find(
    (claim) => claim.id === "tactics-loose-pieces",
  );
  const query = {
    phase: "middlegame",
    featureIds: ["tactic.loose_piece"],
    learnerLevel: "intermediate",
  };

  const draftClaim = { ...approved, reviewStatus: "draft" };
  assert.deepEqual(
    retrieveKnowledgeClaims(query, { claims: [draftClaim] }),
    [],
  );

  const draftSource = {
    ...approved,
    sources: approved.sources.map((source, index) => (
      index === 0
        ? { ...source, referenceReviewStatus: "draft" }
        : source
    )),
  };
  assert.deepEqual(
    retrieveKnowledgeClaims(query, { claims: [draftSource] }),
    [],
  );
});

test("ohne Stellungsevidenz gibt es keine pauschalen Lehrbuchsätze", () => {
  assert.deepEqual(
    retrieveKnowledgeClaims({
      phase: "opening",
      featureIds: [],
      learnerLevel: "beginner",
    }),
    [],
  );
  assert.deepEqual(
    retrieveKnowledgeClaims({
      featureIds: ["center.contested"],
      learnerLevel: "beginner",
    }),
    [],
  );
});

test("Coach-Kontext ist knapp, belegt und enthält keinen Buchtext", () => {
  const context = buildCoachKnowledgeContext({
    phase: "opening",
    featureIds: ["center.contested"],
    learnerLevel: "beginner",
    limit: 1,
  });
  assert.equal(context.length, 1);
  assert.deepEqual(Object.keys(context[0]).sort(), [
    "conceptIds",
    "confidence",
    "id",
    "matchedFeatures",
    "principle",
    "rationale",
    "reviewStatus",
    "sources",
  ]);
  assert.deepEqual(context[0].matchedFeatures, ["center.contested"]);
  assert.equal(context[0].reviewStatus, "reviewed");
  assert.equal(context[0].sources[0].reviewStatus, "reviewed");
  assert.ok(!("quote" in context[0]));
  assert.ok(!("excerpt" in context[0]));
});

test("Validator meldet unbekannte Quellen und widersprüchliche Features", () => {
  const invalid = structuredClone(rawDocument);
  invalid.claims[0].sources[0].sourceId = "unknown-source";
  invalid.claims[0].excludedFeatures.push(
    invalid.claims[0].requiredFeatures[0],
  );
  const result = validateKnowledgeDocument(invalid);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((error) => /unbekannte Quelle/.test(error)));
  assert.ok(result.errors.some((error) => /verlangt und verbietet zugleich/.test(error)));
});
