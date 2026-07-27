import test from "node:test";
import assert from "node:assert/strict";
import { Chess } from "chess.js";
import {
  buildLocalMoveExplanation,
  buildTrustedExplanationEvidence,
  collectEvidenceIds,
  compactMoveExplanationClaims,
  MOVE_EXPLANATION_SCHEMA_VERSION,
  moveExplanationCacheKey,
  moveExplanationToMarkdown,
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

test("numerische Rochaden werden wie jede andere Zugnotation gegen legale Linien geprüft", () => {
  const castlingFen = "r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1";
  const castlingEvidence = buildPositionEvidence({
    fenBefore: castlingFen,
    playedUci: "e1g1",
    lines: [{ rank: 1, pv: ["e1g1", "e8c8"] }],
  });
  const castlingContext = {
    source: "stockfish",
    kind: "position",
    fen: castlingFen,
    depth: 18,
    evaluation: { unit: "cp", value: 0 },
    bestMove: { uci: "e1g1", san: "O-O" },
    primaryVariation: {
      uci: ["e1g1", "e8c8"],
      san: ["O-O", "O-O-O"],
    },
    lines: [{
      rank: 1,
      depth: 18,
      evaluation: { unit: "cp", value: 0 },
      bestMove: { uci: "e1g1", san: "O-O" },
      pv: {
        uci: ["e1g1", "e8c8"],
        san: ["O-O", "O-O-O"],
      },
    }],
  };
  const trustedCastlingEvidence = buildTrustedExplanationEvidence({
    positionEvidence: castlingEvidence,
    engineContext: castlingContext,
  });
  const legalCastling = {
    schemaVersion: MOVE_EXPLANATION_SCHEMA_VERSION,
    subjectUci: "e1g1",
    subjectSan: "O-O",
    headline: "Die kurze Rochade",
    summary: [
      {
        claimKind: "assessment",
        text: "0-0 ist die stärkste geprüfte Möglichkeit.",
        evidenceIds: ["engine.best_move"],
        moveRefs: [{
          lineEvidenceId: "engine.pv.1",
          startPly: 0,
          uci: ["e1g1"],
        }],
      },
      {
        claimKind: "move_effect",
        text: "Mit 0-0 wird in dieser Stellung legal rochiert.",
        evidenceIds: ["move.played.legal:e1g1", "move.played.properties"],
        moveRefs: [{
          lineEvidenceId: "move.played.legal:e1g1",
          startPly: 0,
          uci: ["e1g1"],
        }],
      },
      {
        claimKind: "position_change",
        text: "Die Rochade verändert die Königssicherheit konkret.",
        evidenceIds: ["position.change.king_safety"],
        moveRefs: [],
      },
      {
        claimKind: "variation",
        text: "Die geprüfte Folge lautet 0-0 0-0-0.",
        evidenceIds: ["engine.pv.1"],
        moveRefs: [{
          lineEvidenceId: "engine.pv.1",
          startPly: 0,
          uci: ["e1g1", "e8c8"],
        }],
      },
    ],
    deepDive: [
      {
        claimKind: "move_effect",
        title: "Legalität",
        text: "Die kurze Rochade ist in der geprüften Stellung legal.",
        evidenceIds: ["move.played.legal:e1g1", "move.played.properties"],
        moveRefs: [],
      },
      {
        claimKind: "variation",
        title: "Fortsetzung",
        text: "Auf 0-0 folgt in der legal geprüften Linie 0-0-0.",
        evidenceIds: ["engine.pv.1"],
        moveRefs: [{
          lineEvidenceId: "engine.pv.1",
          startPly: 0,
          uci: ["e1g1", "e8c8"],
        }],
      },
    ],
    confidence: "high",
  };
  const accepted = verifyMoveExplanation(legalCastling, {
    positionEvidence: trustedCastlingEvidence,
    engineContext: castlingContext,
  });
  assert.equal(accepted.valid, true, accepted.errors.join(" "));

  const positionEvidence = evidenceFixture();
  const trustedEvidence = buildTrustedExplanationEvidence({
    positionEvidence,
    engineContext,
  });
  const explanation = validStructuredExplanation();
  explanation.summary[3].text = "In der geprüften Folge wird danach 0-0-0 gespielt.";

  const result = verifyMoveExplanation(explanation, {
    positionEvidence: trustedEvidence,
    engineContext,
  });

  assert.equal(result.valid, false);
  assert.ok(
    result.errors.some((error) => /Zugnotation|Teilfolge|legal/i.test(error)),
    result.errors.join(" "),
  );
});

test("ein Beleg zu einem anderen Stellungseffekt rechtfertigt keine konkrete Linienöffnung", () => {
  const positionEvidence = evidenceFixture();
  const trustedEvidence = buildTrustedExplanationEvidence({
    positionEvidence,
    engineContext,
  });
  const explanation = validStructuredExplanation();
  explanation.summary[2] = {
    claimKind: "position_change",
    text: "Der Zug öffnet die h-Linie.",
    evidenceIds: ["position.change.center"],
    moveRefs: [],
  };

  const result = verifyMoveExplanation(explanation, {
    positionEvidence: trustedEvidence,
    engineContext,
  });

  assert.equal(result.valid, false);
  assert.ok(
    result.errors.some((error) => /Linienöffnung|nicht nachgewiesen/i.test(error)),
    result.errors.join(" "),
  );
});

test("ein ruhiger Figurenzug wird lokal als neutrale Brettveränderung beschrieben", () => {
  const fen = "k7/8/8/8/8/8/6K1/8 w - - 0 1";
  const positionEvidence = buildPositionEvidence({
    fenBefore: fen,
    playedUci: "g2h1",
    lines: [{ rank: 1, pv: ["g2h1", "a8b7"] }],
  });
  const quietMoveContext = {
    source: "stockfish",
    kind: "position",
    fen,
    depth: 18,
    evaluation: { unit: "cp", value: 0 },
    bestMove: { uci: "g2h1", san: "Kh1" },
    primaryVariation: {
      uci: ["g2h1", "a8b7"],
      san: ["Kh1", "Kb7"],
    },
    lines: [{
      rank: 1,
      depth: 18,
      evaluation: { unit: "cp", value: 0 },
      bestMove: { uci: "g2h1", san: "Kh1" },
      pv: {
        uci: ["g2h1", "a8b7"],
        san: ["Kh1", "Kb7"],
      },
    }],
  };

  const explanation = buildLocalMoveExplanation({
    positionEvidence,
    engineContext: quietMoveContext,
    learnerProfile,
  });
  const moveEffect = explanation?.summary.find(
    (claim) => claim.claimKind === "move_effect",
  );

  assert.ok(explanation);
  assert.ok(moveEffect);
  assert.match(moveEffect.text, /Kh1|König/i);
  assert.doesNotMatch(
    moveEffect.text,
    /\b(?:aktiv|verbessert|besser|sicher)\w*/i,
  );
});

test("eine Erklärung wiederholt weder denselben Satz noch den Bestzug-Vergleich", () => {
  const positionEvidence = evidenceFixture();
  const trustedEvidence = buildTrustedExplanationEvidence({
    positionEvidence,
    engineContext,
  });

  const duplicate = validStructuredExplanation();
  duplicate.summary[1] = structuredClone(duplicate.summary[0]);
  const duplicateResult = verifyMoveExplanation(duplicate, {
    positionEvidence: trustedEvidence,
    engineContext,
  });
  assert.equal(duplicateResult.valid, false);
  assert.ok(
    duplicateResult.errors.some((error) => /wiederhol|doppelt/i.test(error)),
    duplicateResult.errors.join(" "),
  );

  const repeatedComparison = validStructuredExplanation();
  repeatedComparison.summary[1] = {
    claimKind: "assessment",
    text: "Diese Wahl ist ebenfalls die beste geprüfte Möglichkeit.",
    evidenceIds: ["engine.best_move"],
    moveRefs: [],
  };
  const comparisonResult = verifyMoveExplanation(repeatedComparison, {
    positionEvidence: trustedEvidence,
    engineContext,
  });
  assert.equal(comparisonResult.valid, false);
  assert.ok(
    comparisonResult.errors.some((error) => /Vergleich|beste Möglichkeit|wiederholt/i.test(error)),
    comparisonResult.errors.join(" "),
  );
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
  assert.match(first, /^v3:[a-f0-9]{64}$/);
});

test("Eröffnungsankündigungen und Zugumstellungen gehören zum Cache-Schlüssel", () => {
  const positionEvidence = evidenceFixture();
  const baseOpening = {
    matched: true,
    eco: "B00",
    displayName: "Königbauernspiel",
    family: "King's Pawn Game",
    source: "lichess-chess-openings",
    matchedPly: 1,
  };
  const shared = {
    fen: START_FEN,
    subjectUci: "e2e4",
    engineDepth: 18,
    learnerProfile,
    engineContext,
    positionEvidence,
  };
  const withoutAnnouncement = moveExplanationCacheKey({
    ...shared,
    openingContext: baseOpening,
  });
  const familyAnnouncement = moveExplanationCacheKey({
    ...shared,
    openingContext: {
      ...baseOpening,
      announcement: {
        kind: "family",
        displayName: "Königbauernspiel",
        triggerPly: 1,
        transposition: false,
      },
    },
  });
  const variationAnnouncement = moveExplanationCacheKey({
    ...shared,
    openingContext: {
      ...baseOpening,
      announcement: {
        kind: "variation",
        displayName: "Königbauernspiel: Hauptvariante",
        triggerPly: 1,
        transposition: false,
      },
    },
  });
  const transpositionAnnouncement = moveExplanationCacheKey({
    ...shared,
    openingContext: {
      ...baseOpening,
      announcement: {
        kind: "family",
        displayName: "Königbauernspiel",
        triggerPly: 1,
        transposition: true,
      },
    },
  });

  assert.notEqual(withoutAnnouncement, familyAnnouncement);
  assert.notEqual(familyAnnouncement, variationAnnouncement);
  assert.notEqual(familyAnnouncement, transpositionAnnouncement);
});

test("kompakte Erklärungen priorisieren konkrete Wirkungen und Prinzipien", () => {
  const explanation = {
    summary: [
      { claimKind: "assessment", text: "e4 ist stark." },
      { claimKind: "opening", text: "Das ist ein Königbauernspiel." },
      { claimKind: "variation", text: "Es kann e4 e5 Nf3 folgen." },
      { claimKind: "principle", text: "Entwickle Figuren zügig." },
      { claimKind: "move_effect", text: "Der Läufer auf f1 erhält eine offene Linie." },
      { claimKind: "position_change", text: "Weiß kontrolliert danach zusätzlich d5 und f5." },
    ],
  };

  const compact = compactMoveExplanationClaims(explanation, { maximum: 3 });

  assert.deepEqual(
    compact.map((claim) => claim.claimKind),
    ["position_change", "move_effect", "principle"],
  );
});

test("Markdown wiederholt wortgleiche Texte nicht im Deep Dive", () => {
  const repeatedSummary = "Der Zug verstärkt sofort die Kontrolle im Zentrum.";
  const repeatedDeepDive = "Achte danach auf die Entwicklung des Königsläufers.";
  const markdown = moveExplanationToMarkdown({
    headline: "Ein sinnvoller Entwicklungszug",
    summary: [
      { text: repeatedSummary },
      { text: repeatedSummary },
      { text: "Die Stellung bleibt dabei flexibel." },
    ],
    deepDive: [
      { title: "Zentrum", text: repeatedSummary },
      { title: "Entwicklung", text: repeatedDeepDive },
      { title: "Noch einmal", text: repeatedDeepDive },
    ],
  }, { deep: true });

  assert.equal(markdown.split(repeatedSummary).length - 1, 1);
  assert.equal(markdown.split(repeatedDeepDive).length - 1, 1);
  assert.doesNotMatch(markdown, /\*\*Zentrum:\*\*/);
  assert.match(markdown, /\*\*Entwicklung:\*\*/);
  assert.doesNotMatch(markdown, /\*\*Noch einmal:\*\*/);
});

test("lokale Erklärungen nennen Eröffnungswissen nur bei angekündigter Familie oder Variante", () => {
  const positionEvidence = evidenceFixture();
  const openingContext = {
    matched: true,
    eco: "B00",
    displayName: "Königbauernspiel",
    sourceName: "King's Pawn Game",
    family: "King's Pawn Game",
    source: "lichess-chess-openings",
    matchedPly: 1,
    currentPly: 1,
  };
  const withoutAnnouncement = buildLocalMoveExplanation({
    positionEvidence,
    engineContext,
    learnerProfile,
    openingContext,
  });

  assert.ok(withoutAnnouncement);
  assert.equal(
    withoutAnnouncement.summary.some((claim) => claim.claimKind === "opening"),
    false,
  );
  assert.doesNotMatch(
    withoutAnnouncement.summary.map((claim) => claim.text).join(" "),
    /Königbauernspiel/,
  );

  for (const kind of ["family", "variation"]) {
    const announced = buildLocalMoveExplanation({
      positionEvidence,
      engineContext,
      learnerProfile,
      openingContext: {
        ...openingContext,
        announcement: {
          kind,
          displayName: "Königbauernspiel",
          transposition: false,
        },
      },
    });
    const openingClaims = announced.summary.filter(
      (claim) => claim.claimKind === "opening",
    );

    assert.equal(openingClaims.length, 1, `Ankündigungsart ${kind}`);
    assert.match(openingClaims[0].text, /Königbauernspiel/);
  }
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
