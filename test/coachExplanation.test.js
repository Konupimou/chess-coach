import test from "node:test";
import assert from "node:assert/strict";
import { Chess } from "chess.js";
import {
  buildLocalMoveExplanation,
  buildTrustedExplanationEvidence,
  collectEvidenceIds,
  MOVE_EXPLANATION_SCHEMA_VERSION,
  moveExplanationCacheKey,
  verifyMoveExplanation,
} from "../coachExplanation.js";
import { requestMoveExplanation } from "../api/chat.js";
import { buildPositionEvidence } from "../positionEvidence.js";

const START_FEN = new Chess().fen();

const engineContext = {
  source: "stockfish",
  kind: "position",
  fen: START_FEN,
  depth: 18,
  evaluation: { unit: "cp", value: 35 },
  bestMove: { uci: "e2e4", san: "e4" },
  primaryVariation: {
    uci: ["e2e4", "e7e5", "g1f3", "b8c6"],
    san: ["e4", "e5", "Nf3", "Nc6"],
  },
  lines: [{
    rank: 1,
    depth: 18,
    evaluation: { unit: "cp", value: 35 },
    bestMove: { uci: "e2e4", san: "e4" },
    pv: {
      uci: ["e2e4", "e7e5", "g1f3", "b8c6"],
      san: ["e4", "e5", "Nf3", "Nc6"],
    },
  }],
};

const learnerProfile = {
  version: 1,
  source: "account_games",
  level: "beginner",
  estimatedRating: 900,
  explanationLimits: {
    variations: {
      maximumLines: 1,
      maximumPliesPerLine: 4,
    },
  },
};

function evidenceFixture() {
  return buildPositionEvidence({
    fenBefore: START_FEN,
    playedUci: "e2e4",
    lines: [{
      rank: 1,
      pv: ["e2e4", "e7e5", "g1f3", "b8c6"],
    }],
  });
}

function validStructuredExplanation() {
  return {
    schemaVersion: MOVE_EXPLANATION_SCHEMA_VERSION,
    subjectUci: "e2e4",
    subjectSan: "e4",
    headline: "e4: ein klarer Griff ins Zentrum",
    summary: [
      {
        claimKind: "assessment",
        text: "e4 ist hier die stärkste geprüfte Möglichkeit.",
        evidenceIds: ["engine.best_move"],
        moveRefs: [{
          lineEvidenceId: "engine.pv.1",
          startPly: 0,
          uci: ["e2e4"],
        }],
      },
      {
        claimKind: "move_effect",
        text: "Der Bauernzug ist in dieser Stellung legal.",
        evidenceIds: ["move.played.legal:e2e4"],
        moveRefs: [],
      },
      {
        claimKind: "position_change",
        text: "Er vergrößert sofort den weißen Einfluss im Zentrum.",
        evidenceIds: ["position.change.center"],
        moveRefs: [],
      },
      {
        claimKind: "variation",
        text: "Die geprüfte Fortsetzung beginnt mit e4 e5 Nf3 Nc6.",
        evidenceIds: ["engine.pv.1"],
        moveRefs: [{
          lineEvidenceId: "engine.pv.1",
          startPly: 0,
          uci: ["e2e4", "e7e5", "g1f3", "b8c6"],
        }],
      },
    ],
    deepDive: [
      {
        claimKind: "position_change",
        title: "Zentrum",
        text: "Weiß beeinflusst nach dem Zug zusätzliche zentrale Felder.",
        evidenceIds: ["position.change.center"],
        moveRefs: [],
      },
      {
        claimKind: "variation",
        title: "Antwortfolge",
        text: "In der geprüften Linie folgen auf e4 die Züge e5 Nf3 Nc6.",
        evidenceIds: ["engine.pv.1"],
        moveRefs: [{
          lineEvidenceId: "engine.pv.1",
          startPly: 0,
          uci: ["e2e4", "e7e5", "g1f3", "b8c6"],
        }],
      },
    ],
    confidence: "high",
  };
}

test("die lokale Erklärung enthält vier bis sechs belegte Sätze und behält die legale PV-Reihenfolge", () => {
  const positionEvidence = evidenceFixture();
  const explanation = buildLocalMoveExplanation({
    positionEvidence,
    engineContext,
    learnerProfile,
  });
  const trustedEvidence = buildTrustedExplanationEvidence({
    positionEvidence,
    engineContext,
  });
  const knownIds = collectEvidenceIds(trustedEvidence);

  assert.equal(positionEvidence.valid, true);
  assert.ok(explanation);
  assert.ok(explanation.summary.length >= 4);
  assert.ok(explanation.summary.length <= 6);
  assert.ok(
    explanation.summary.every(
      (sentence) => (
        typeof sentence.text === "string"
        && sentence.text.trim().length > 0
        && sentence.evidenceIds.length > 0
        && sentence.evidenceIds.every((id) => knownIds.has(id))
      ),
    ),
  );

  const pvSentence = explanation.summary.find(
    (sentence) => (
      sentence.evidenceIds.includes("engine.pv.1")
      && /e5/.test(sentence.text)
    ),
  );
  assert.ok(pvSentence);
  assert.match(pvSentence.text, /e4.*e5.*Nf3.*Nc6/);
  assert.doesNotMatch(pvSentence.text, /Nc6.*Nf3|Nf3.*e5|e5.*e4/);
});

test("der Cache-Schlüssel ist unabhängig von Objektschlüssel-Reihenfolgen, aber positionssensitiv", () => {
  const positionEvidence = evidenceFixture();
  const shared = {
    fen: START_FEN,
    subjectUci: "e2e4",
    engineDepth: 18,
    positionEvidence,
    knowledgeContext: [{ id: "knowledge.center", confidence: 0.9 }],
  };
  const first = moveExplanationCacheKey({
    ...shared,
    learnerProfile: {
      level: "beginner",
      preferences: { detail: "short", notation: "san" },
    },
  });
  const reordered = moveExplanationCacheKey({
    knowledgeContext: [{ confidence: 0.9, id: "knowledge.center" }],
    positionEvidence,
    engineDepth: 18,
    subjectUci: "e2e4",
    fen: START_FEN,
    learnerProfile: {
      preferences: { notation: "san", detail: "short" },
      level: "beginner",
    },
  });
  const changedMove = moveExplanationCacheKey({
    ...shared,
    subjectUci: "d2d4",
    learnerProfile: {
      level: "beginner",
      preferences: { detail: "short", notation: "san" },
    },
  });

  assert.equal(first, reordered);
  assert.notEqual(first, changedMove);
});

test("die Erklärungsprüfung verwirft fremde Belege, einen falschen Zug und verdrehte Varianten", () => {
  const positionEvidence = evidenceFixture();
  const trustedEvidence = buildTrustedExplanationEvidence({
    positionEvidence,
    engineContext,
  });
  const base = validStructuredExplanation();

  const valid = verifyMoveExplanation(base, {
    positionEvidence: trustedEvidence,
    engineContext,
  });
  assert.equal(valid.valid, true, valid.errors.join(" "));

  const unknownEvidence = structuredClone(base);
  unknownEvidence.summary[0].evidenceIds = ["evidence.erfunden"];
  const unknownResult = verifyMoveExplanation(unknownEvidence, {
    positionEvidence: trustedEvidence,
    engineContext,
  });
  assert.equal(unknownResult.valid, false);
  assert.ok(unknownResult.errors.some((error) => /unbekannte Belege/.test(error)));

  const fakeSubject = structuredClone(base);
  fakeSubject.subjectUci = "d2d4";
  fakeSubject.subjectSan = "d4";
  const fakeSubjectResult = verifyMoveExplanation(fakeSubject, {
    positionEvidence: trustedEvidence,
    engineContext,
  });
  assert.equal(fakeSubjectResult.valid, false);
  assert.ok(fakeSubjectResult.errors.some((error) => /UCI-Zug/.test(error)));
  assert.ok(fakeSubjectResult.errors.some((error) => /SAN-Zug/.test(error)));

  const reversedLine = structuredClone(base);
  reversedLine.summary[3].text =
    "Die angebliche Fortsetzung lautet e4 Nf3 e5 Nc6.";
  const reversedResult = verifyMoveExplanation(reversedLine, {
    positionEvidence: trustedEvidence,
    engineContext,
  });
  assert.equal(reversedResult.valid, false);
  assert.ok(
    reversedResult.errors.some((error) => /Zugnotation|Teilfolge/.test(error)),
  );
});

test("Einzelzüge, vermischte Linien und unbelegte Taktikbehauptungen werden verworfen", () => {
  const positionEvidence = evidenceFixture();
  const trustedEvidence = buildTrustedExplanationEvidence({
    positionEvidence,
    engineContext,
  });

  const illegalFirstMove = validStructuredExplanation();
  illegalFirstMove.summary[0] = {
    claimKind: "alternative",
    text: "Besser war e5.",
    evidenceIds: ["engine.pv.1", "engine.best_move"],
    moveRefs: [{
      lineEvidenceId: "engine.pv.1",
      startPly: 1,
      uci: ["e7e5"],
    }],
  };
  const illegalResult = verifyMoveExplanation(illegalFirstMove, {
    positionEvidence: trustedEvidence,
    engineContext,
  });
  assert.equal(illegalResult.valid, false);
  assert.ok(illegalResult.errors.some((error) => /nicht der belegte beste Zug/.test(error)));

  const skippedPly = validStructuredExplanation();
  skippedPly.summary[3].text = "Die Fortsetzung beginnt mit e4 Nf3.";
  skippedPly.summary[3].moveRefs[0].uci = ["e2e4", "g1f3"];
  const skippedResult = verifyMoveExplanation(skippedPly, {
    positionEvidence: trustedEvidence,
    engineContext,
  });
  assert.equal(skippedResult.valid, false);
  assert.ok(skippedResult.errors.some((error) => /zusammenhängende Teilfolge/.test(error)));

  const inventedWin = validStructuredExplanation();
  inventedWin.summary[3] = {
    claimKind: "variation",
    text: "Nach e4 gewinnt Weiß sofort eine Dame.",
    evidenceIds: ["engine.pv.1"],
    moveRefs: [{
      lineEvidenceId: "engine.pv.1",
      startPly: 0,
      uci: ["e2e4"],
    }],
  };
  const inventedResult = verifyMoveExplanation(inventedWin, {
    positionEvidence: trustedEvidence,
    engineContext,
  });
  assert.equal(inventedResult.valid, false);
  assert.ok(inventedResult.errors.some((error) => /nicht direkt bewiesen/.test(error)));
});

test("der Cache-Digest ändert sich mit Variante, Bewertung und Wissensinhalt", () => {
  const firstEvidence = evidenceFixture();
  const changedEvidence = buildPositionEvidence({
    fenBefore: START_FEN,
    playedUci: "e2e4",
    lines: [{ rank: 1, pv: ["e2e4", "c7c5", "g1f3"] }],
  });
  const base = {
    fen: START_FEN,
    subjectUci: "e2e4",
    engineDepth: 18,
    learnerProfile,
  };
  const first = moveExplanationCacheKey({
    ...base,
    positionEvidence: firstEvidence,
    knowledgeContext: [{
      id: "knowledge.center",
      principle: "Besetze das Zentrum.",
    }],
  });
  const changedLine = moveExplanationCacheKey({
    ...base,
    positionEvidence: changedEvidence,
    knowledgeContext: [{
      id: "knowledge.center",
      principle: "Besetze das Zentrum.",
    }],
  });
  const changedKnowledge = moveExplanationCacheKey({
    ...base,
    positionEvidence: firstEvidence,
    knowledgeContext: [{
      id: "knowledge.center",
      principle: "Kontrolliere das Zentrum mit Figuren.",
    }],
  });

  assert.notEqual(first, changedLine);
  assert.notEqual(first, changedKnowledge);
  assert.match(first, /^v2:[a-f0-9]{64}$/);
});

test("die Online-Vertiefung nutzt Structured Outputs und anschließend den Cache", async () => {
  const cache = new Map();
  let requests = 0;
  let captured;
  const fetchImpl = async (url, options) => {
    requests += 1;
    captured = { url, options, body: JSON.parse(options.body) };
    return {
      ok: true,
      async json() {
        return {
          output_text: JSON.stringify(validStructuredExplanation()),
        };
      },
    };
  };
  const payload = {
    engineContext,
    learnerProfile,
    openingContext: null,
  };

  const first = await requestMoveExplanation(payload, {
    apiKey: "test-key",
    model: "test-model",
    safetyIdentifier: "safe-player",
    fetchImpl,
    cache,
  });
  const second = await requestMoveExplanation(payload, {
    apiKey: "test-key",
    model: "test-model",
    safetyIdentifier: "safe-player",
    fetchImpl,
    cache,
  });

  assert.equal(first.source, "ai");
  assert.equal(first.cached, false);
  assert.equal(second.source, "cache");
  assert.equal(second.cached, true);
  assert.equal(requests, 1);
  assert.equal(captured.url, "https://api.openai.com/v1/responses");
  assert.equal(captured.body.model, "test-model");
  assert.equal(captured.body.store, false);
  assert.equal(captured.body.safety_identifier, "safe-player");
  assert.equal(captured.body.reasoning.effort, "medium");
  assert.equal(captured.body.text.format.type, "json_schema");
  assert.equal(captured.body.text.format.name, "grounded_move_explanation");
  assert.equal(captured.body.text.format.strict, true);
  assert.equal(captured.body.text.format.schema.additionalProperties, false);
  assert.match(captured.body.instructions, /evidenceIds/);
  assert.match(captured.body.input, /<position_evidence>/);
  assert.match(captured.body.input, /<verified_knowledge>/);
  assert.equal(captured.options.headers.Authorization, "Bearer test-key");
});

test("eine ungültige strukturierte Antwort fällt sicher auf die lokale Erklärung zurück", async () => {
  const malformed = await requestMoveExplanation(
    {
      engineContext,
      learnerProfile,
      openingContext: null,
    },
    {
      apiKey: "test-key",
      cache: new Map(),
      fetchImpl: async () => ({
        ok: true,
        async json() {
          return { output_text: "{nicht-json" };
        },
      }),
    },
  );

  assert.equal(malformed.source, "local");
  assert.equal(malformed.cached, false);
  assert.equal(malformed.reason, "invalid_structured_json");
  assert.ok(malformed.explanation);
  assert.ok(malformed.explanation.summary.length >= 4);
  assert.ok(malformed.explanation.summary.length <= 6);

  const fabricated = validStructuredExplanation();
  fabricated.summary[0].evidenceIds = ["evidence.erfunden"];
  const ungrounded = await requestMoveExplanation(
    {
      engineContext,
      learnerProfile,
      openingContext: null,
    },
    {
      apiKey: "test-key",
      cache: new Map(),
      fetchImpl: async () => ({
        ok: true,
        async json() {
          return { output_text: JSON.stringify(fabricated) };
        },
      }),
    },
  );

  assert.equal(ungrounded.source, "local");
  assert.equal(ungrounded.reason, "evidence_validation_failed");
  assert.ok(ungrounded.explanation);
});
