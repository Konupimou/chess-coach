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
import { learnerProfileForCoach } from "../learnerProfile.js";
import { validateCoachLanguage } from "../coachLanguageQuality.js";

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
  rating: 1000,
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
    verdict: {
      text: "e4 ist hier die stärkste geprüfte Möglichkeit.",
      evidenceIds: ["engine.best_move"],
      moveRefs: [{
        lineEvidenceId: "engine.pv.1",
        startPly: 0,
        uci: ["e2e4"],
      }],
    },
    moveIdea: {
      text: "Der Zug besetzt das Zentrum.",
      evidenceIds: ["position.change.center"],
      moveRefs: [],
    },
    opponentReply: {
      text: "Die geprüfte Fortsetzung beginnt mit e4 e5 Nf3 Nc6.",
      evidenceIds: ["engine.pv.1"],
      moveRefs: [{
        lineEvidenceId: "engine.pv.1",
        startPly: 0,
        uci: ["e2e4", "e7e5", "g1f3", "b8c6"],
      }],
    },
    concreteConsequence: null,
    alternative: null,
    comparison: null,
    takeaway: null,
    confidence: "high",
  };
}

function groundedStructuredExplanation() {
  return buildLocalMoveExplanation({
    positionEvidence: evidenceFixture(),
    engineContext,
    learnerProfile: learnerProfileForCoach(learnerProfile),
  });
}

test("die lokale Erklärung füllt nur belegte semantische Felder", () => {
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
  assert.equal(explanation.schemaVersion, 3);
  assert.ok(explanation.verdict);
  assert.ok(explanation.moveIdea);
  const claims = [
    explanation.verdict,
    explanation.moveIdea,
    explanation.opponentReply,
    explanation.concreteConsequence,
    explanation.alternative,
    explanation.comparison,
    explanation.takeaway,
  ].filter(Boolean);
  assert.ok(
    claims.every(
      (sentence) => (
        typeof sentence.text === "string"
        && sentence.text.trim().length > 0
        && sentence.evidenceIds.length > 0
        && sentence.evidenceIds.every((id) => knownIds.has(id))
      ),
    ),
  );

  const pvSentence = explanation.opponentReply;
  assert.ok(pvSentence);
  assert.match(pvSentence.text, /e5/);
  assert.doesNotMatch(pvSentence.text, /Nc6.*Nf3|Nf3.*e5/);
});

test("der lokale 800-Elo-Coach erklärt eine Entwicklung ohne Lob-Floskel", () => {
  const game = new Chess();
  game.move("e4");
  game.move("e5");
  const fen = game.fen();
  const context = {
    source: "stockfish",
    kind: "position",
    fen,
    depth: 18,
    evaluation: { unit: "cp", value: 29 },
    bestMove: { uci: "g1f3", san: "Nf3" },
    primaryVariation: {
      uci: ["g1f3", "b8c6"],
      san: ["Nf3", "Nc6"],
    },
    lines: [{
      rank: 1,
      depth: 18,
      evaluation: { unit: "cp", value: 29 },
      bestMove: { uci: "g1f3", san: "Nf3" },
      pv: {
        uci: ["g1f3", "b8c6"],
        san: ["Nf3", "Nc6"],
      },
    }],
  };
  const positionEvidence = buildPositionEvidence({
    fenBefore: fen,
    playedUci: "g1f3",
    lines: [{ rank: 1, pv: ["g1f3", "b8c6"] }],
  });

  const explanation = buildLocalMoveExplanation({
    positionEvidence,
    engineContext: context,
    learnerProfile: {
      ...learnerProfile,
      responseStyle: { id: "foundations" },
    },
  });

  assert.equal(
    explanation.moveIdea.text,
    "Damit entwickelst du den Springer nach f3. Er kontrolliert das Feld d4.",
  );
  assert.doesNotMatch(
    moveExplanationToMarkdown(explanation),
    /Sauber|genau das war gefragt/,
  );
});

test("der lokale 800-Elo-Coach erklärt d4 als einfachen Zentrumszug", () => {
  const context = {
    ...engineContext,
    bestMove: { uci: "d2d4", san: "d4" },
    primaryVariation: {
      uci: ["d2d4", "d7d5"],
      san: ["d4", "d5"],
    },
    lines: [{
      ...engineContext.lines[0],
      bestMove: { uci: "d2d4", san: "d4" },
      pv: { uci: ["d2d4", "d7d5"], san: ["d4", "d5"] },
    }],
  };
  const positionEvidence = buildPositionEvidence({
    fenBefore: START_FEN,
    playedUci: "d2d4",
    lines: [{ rank: 1, pv: ["d2d4", "d7d5"] }],
  });
  const explanation = buildLocalMoveExplanation({
    positionEvidence,
    engineContext: context,
    learnerProfile: {
      ...learnerProfile,
      responseStyle: { id: "foundations" },
    },
  });

  assert.equal(
    explanation.moveIdea.text,
    "Damit stellst du einen Bauern auf d4 ins Zentrum. Von dort kontrolliert er das Feld e5.",
  );
  assert.doesNotMatch(explanation.moveIdea.text, /Analysetiefe|Zielfeld/);
});

test("lokale Schweregrade folgen dem gemessenen Verlust statt einem widersprüchlichen Label", () => {
  const explanationFor = (lossCp, quality) => {
    const context = {
      source: "stockfish",
      kind: "move_review",
      fen: START_FEN,
      depth: 18,
      evaluation: { unit: "cp", value: 20, perspective: "white" },
      bestMove: { uci: "e2e4", san: "e4" },
      primaryVariation: { uci: ["e2e4", "e7e5"], san: ["e4", "e5"] },
      lines: [{
        rank: 1,
        depth: 18,
        evaluation: { unit: "cp", value: 20, perspective: "white" },
        bestMove: { uci: "e2e4", san: "e4" },
        pv: { uci: ["e2e4", "e7e5"], san: ["e4", "e5"] },
      }],
      playedLine: {
        evaluation: { unit: "cp", value: 20 - lossCp, perspective: "white" },
        uci: ["a2a3", "e7e5"],
        san: ["a3", "e5"],
      },
      moveReview: {
        playedMove: { uci: "a2a3", san: "a3" },
        bestMove: { uci: "e2e4", san: "e4" },
        quality,
        lossCp,
        evaluationBefore: { unit: "cp", value: 20, perspective: "white" },
        evaluationAfter: { unit: "cp", value: 20 - lossCp, perspective: "white" },
        pv: { uci: ["e2e4", "e7e5"], san: ["e4", "e5"] },
      },
    };
    const positionEvidence = buildPositionEvidence({
      fenBefore: START_FEN,
      playedUci: "a2a3",
      candidateLines: [{
        rank: 1,
        evaluation: { unit: "cp", value: 20, perspective: "white" },
        pvUci: ["e2e4", "e7e5"],
      }],
      playedLine: {
        evaluation: { unit: "cp", value: 20 - lossCp, perspective: "white" },
        pvUci: ["a2a3", "e7e5"],
      },
      lossCp,
      quality,
      engineDepth: 18,
    });
    return buildLocalMoveExplanation({
      positionEvidence,
      engineContext: context,
      learnerProfile: {
        ...learnerProfile,
        responseStyle: { id: "foundations" },
      },
    });
  };

  const mislabeledSmallLoss = explanationFor(80, "blunder");
  assert.doesNotMatch(
    moveExplanationToMarkdown(mislabeledSmallLoss, { deep: true }),
    /grober Fehler|klarer Fehler|viel schlechter|deutlich schlechter/iu,
  );
  assert.match(explanationFor(150, "good").verdict.text, /klarer Fehler/iu);
  assert.match(explanationFor(300, "good").verdict.text, /grober Fehler/iu);
});

test("Na4 im Stafford-Gambit wird klar als Bxf2-Schach bewertet", async () => {
  const fen = "r1bqk2r/ppp2ppp/2p5/2b5/4P1n1/2NP4/PPP2PPP/R1BQKB1R w KQkq - 3 7";
  const reviewContext = {
    source: "stockfish",
    kind: "move_review",
    fen,
    depth: 18,
    evaluation: { unit: "cp", value: -30, perspective: "white" },
    bestMove: { uci: "c1e3", san: "Be3" },
    primaryVariation: {
      uci: ["c1e3", "g4e3", "f2e3"],
      san: ["Be3", "Nxe3", "fxe3"],
    },
    lines: [{
      rank: 1,
      depth: 18,
      evaluation: { unit: "cp", value: -30, perspective: "white" },
      bestMove: { uci: "c1e3", san: "Be3" },
      pv: {
        uci: ["c1e3", "g4e3", "f2e3"],
        san: ["Be3", "Nxe3", "fxe3"],
      },
    }],
    playedLine: {
      evaluation: { unit: "cp", value: -310, perspective: "white" },
      uci: ["c3a4", "c5f2"],
      san: ["Na4", "Bxf2+"],
    },
    moveReview: {
      playedMove: { uci: "c3a4", san: "Na4" },
      bestMove: { uci: "c1e3", san: "Be3" },
      quality: "mistake",
      lossCp: 280,
      evaluationBefore: { unit: "cp", value: -30, perspective: "white" },
      evaluationAfter: { unit: "cp", value: -310, perspective: "white" },
      pv: {
        uci: ["c1e3", "g4e3", "f2e3"],
        san: ["Be3", "Nxe3", "fxe3"],
      },
    },
  };
  const positionEvidence = buildPositionEvidence({
    fenBefore: fen,
    playedUci: "c3a4",
    candidateLines: [{
      rank: 1,
      evaluation: { unit: "cp", value: -30, perspective: "white" },
      pv: ["c1e3", "g4e3", "f2e3"],
    }],
    playedLine: {
      evaluation: { unit: "cp", value: -310, perspective: "white" },
      pvUci: ["c3a4", "c5f2"],
    },
    lossCp: 280,
    quality: "mistake",
    engineDepth: 18,
  });
  const explanation = buildLocalMoveExplanation({
    positionEvidence,
    engineContext: reviewContext,
    learnerProfile: {
      ...learnerProfile,
      responseStyle: { id: "foundations" },
    },
  });

  assert.match(explanation.verdict.text, /Na4 ist ein klarer Fehler/);
  assert.match(explanation.verdict.text, /stellst deinen Bauern auf f2 ein/);
  assert.match(explanation.verdict.text, /Bxf2\+/);
  assert.match(explanation.verdict.text, /Bauern auf f2/);
  assert.match(explanation.verdict.text, /Schach/);
  assert.equal(explanation.opponentReply, null);
  assert.doesNotMatch(
    moveExplanationToMarkdown(explanation),
    /konkreter Grund ist .* nicht zuverlässig erklärbar/i,
  );
  assert.equal(
    compactMoveExplanationClaims(explanation, { maximum: 7 })
      .some((claim) => claim.semanticField === "verdict"),
    true,
  );
  const staffordLanguage = validateCoachLanguage(
    moveExplanationToMarkdown(explanation, { deep: true }),
    {
      rating: 800,
      phase: "opening",
      evidence: {
        materialLoss: true,
        significantLoss: true,
        severeLoss: false,
      },
      strict: true,
    },
  );
  assert.equal(staffordLanguage.valid, true, JSON.stringify(staffordLanguage));

  const trustedEvidence = buildTrustedExplanationEvidence({
    positionEvidence,
    engineContext: reviewContext,
  });
  const checkedLocal = verifyMoveExplanation(explanation, {
    positionEvidence: trustedEvidence,
    engineContext: reviewContext,
  });
  assert.equal(checkedLocal.valid, true, checkedLocal.errors.join(" "));

  const falseMaterialClaims = [
    explanation.verdict.text.replace("deinen Bauern", "deine Dame"),
    explanation.verdict.text.replace("auf f2 ein", "auf e2 ein"),
  ];
  for (const falseVerdict of falseMaterialClaims) {
    const candidate = structuredClone(explanation);
    candidate.verdict.text = falseVerdict;
    const result = await requestMoveExplanation(
      {
        engineContext: reviewContext,
        learnerProfile: {
          ...learnerProfile,
          responseStyle: { id: "foundations" },
        },
        openingContext: null,
      },
      {
        apiKey: "test-key",
        cache: new Map(),
        fetchImpl: async () => ({
          ok: true,
          async json() {
            return { output_text: JSON.stringify(candidate) };
          },
        }),
      },
    );

    assert.equal(result.source, "local");
    assert.equal(result.reason, "ai_wording_rejected");
    assert.match(result.explanation.verdict.text, /Bauern auf f2/);
    assert.doesNotMatch(result.explanation.verdict.text, /Dame|auf e2 ein/);
  }

  const falseLoss = structuredClone(explanation);
  falseLoss.verdict.text = "Na4 ist ein klarer Fehler. Du verlierst deine Dame auf f2: Bxf2+ nimmt sie mit Schach.";
  const checkedFalseLoss = verifyMoveExplanation(falseLoss, {
    positionEvidence: trustedEvidence,
    engineContext: reviewContext,
  });
  assert.equal(checkedFalseLoss.valid, false);
  assert.ok(checkedFalseLoss.errors.some((error) => /Figurenart|Schlagfeld/.test(error)));

  const falseCapture = structuredClone(explanation);
  falseCapture.verdict.text = "Na4 ist ein klarer Fehler. Bxf2+ nimmt deine Dame auf f2 mit Schach.";
  const checkedFalseCapture = verifyMoveExplanation(falseCapture, {
    positionEvidence: trustedEvidence,
    engineContext: reviewContext,
  });
  assert.equal(checkedFalseCapture.valid, false);
  assert.ok(checkedFalseCapture.errors.some((error) => /Figurenart|Schlagfeld/.test(error)));
});

test("ein direkter Figurenverlust wird einfach und deutlich benannt", () => {
  const fen = "3q2k1/8/8/8/8/8/3Q4/6K1 w - - 0 1";
  const reviewContext = {
    source: "stockfish",
    kind: "move_review",
    fen,
    depth: 18,
    evaluation: { unit: "cp", value: 0, perspective: "white" },
    bestMove: { uci: "d2e3", san: "Qe3" },
    lines: [{
      rank: 1,
      depth: 18,
      evaluation: { unit: "cp", value: 0, perspective: "white" },
      bestMove: { uci: "d2e3", san: "Qe3" },
      pv: { uci: ["d2e3", "g8f7"], san: ["Qe3", "Kf7"] },
    }],
    playedLine: {
      evaluation: { unit: "cp", value: -900, perspective: "white" },
      uci: ["d2d3", "d8d3"],
      san: ["Qd3", "Qxd3"],
    },
    moveReview: {
      playedMove: { uci: "d2d3", san: "Qd3" },
      bestMove: { uci: "d2e3", san: "Qe3" },
      quality: "blunder",
      lossCp: 900,
    },
  };
  const positionEvidence = buildPositionEvidence({
    fenBefore: fen,
    playedUci: "d2d3",
    candidateLines: [{
      rank: 1,
      evaluation: { unit: "cp", value: 0, perspective: "white" },
      pvUci: ["d2e3", "g8f7"],
    }],
    playedLine: {
      evaluation: { unit: "cp", value: -900, perspective: "white" },
      pvUci: ["d2d3", "d8d3"],
    },
    lossCp: 900,
    quality: "blunder",
    engineDepth: 18,
  });

  const explanation = buildLocalMoveExplanation({
    positionEvidence,
    engineContext: reviewContext,
    learnerProfile: {
      ...learnerProfile,
      responseStyle: { id: "foundations" },
    },
  });

  assert.match(explanation.verdict.text, /Qd3 ist ein grober Fehler/);
  assert.match(explanation.verdict.text, /stellst deine Dame auf d3 ein/);
  assert.match(explanation.verdict.text, /Qxd3 nimmt sie/);
  assert.match(explanation.verdict.text, /Stellung wird dadurch viel schlechter/);
  assert.doesNotMatch(explanation.verdict.text, /Antwortfolge|Analysetiefe|Bewertungszahl/);
  const hangingQueenLanguage = validateCoachLanguage(
    moveExplanationToMarkdown(explanation, { deep: true }),
    {
      rating: 800,
      phase: "middlegame",
      evidence: {
        materialLoss: true,
        significantLoss: true,
        severeLoss: true,
      },
      strict: true,
    },
  );
  assert.equal(
    hangingQueenLanguage.valid,
    true,
    JSON.stringify(hangingQueenLanguage),
  );
  const checkedQueenLoss = verifyMoveExplanation(explanation, {
    positionEvidence: buildTrustedExplanationEvidence({
      positionEvidence,
      engineContext: reviewContext,
    }),
    engineContext: reviewContext,
  });
  assert.equal(
    checkedQueenLoss.valid,
    true,
    checkedQueenLoss.errors.join(" "),
  );
});

test("bei Fehlern kommt die Erklärung des gespielten Zuges vor der Alternative", () => {
  const reviewContext = {
    ...engineContext,
    kind: "move_review",
    moveReview: {
      playedMove: { uci: "e2e4", san: "e4" },
      bestMove: { uci: "d2d4", san: "d4" },
      quality: "mistake",
      pv: { uci: ["d2d4", "d7d5"], san: ["d4", "d5"] },
    },
  };
  const positionEvidence = evidenceFixture();
  const trustedEvidence = buildTrustedExplanationEvidence({
    positionEvidence,
    engineContext: reviewContext,
  });
  const wrongOrder = validStructuredExplanation();
  wrongOrder.verdict = null;
  wrongOrder.alternative = {
    text: "d4 wäre besser.",
    evidenceIds: ["engine.move_assessment"],
    moveRefs: [],
  };
  const checked = verifyMoveExplanation(wrongOrder, {
    positionEvidence: trustedEvidence,
    engineContext: reviewContext,
  });
  assert.equal(checked.valid, false);
  assert.ok(checked.errors.some((error) => /erst nach der Erklärung/.test(error)));
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
  unknownEvidence.verdict.evidenceIds = ["evidence.erfunden"];
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
  reversedLine.opponentReply.text =
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
  illegalFirstMove.alternative = {
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
  skippedPly.opponentReply.text = "Die Fortsetzung beginnt mit e4 Nf3.";
  skippedPly.opponentReply.moveRefs[0].uci = ["e2e4", "g1f3"];
  const skippedResult = verifyMoveExplanation(skippedPly, {
    positionEvidence: trustedEvidence,
    engineContext,
  });
  assert.equal(skippedResult.valid, false);
  assert.ok(skippedResult.errors.some((error) => /zusammenhängende Teilfolge/.test(error)));

  const inventedWin = validStructuredExplanation();
  inventedWin.opponentReply = {
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
  explanation.opponentReply.text = "In der geprüften Folge wird danach 0-0-0 gespielt.";

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
  explanation.comparison = {
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
  const moveEffect = explanation?.moveIdea;

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
  duplicate.moveIdea = structuredClone(duplicate.verdict);
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
  repeatedComparison.moveIdea = {
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
  assert.match(first, /^v9:[a-f0-9]{64}$/);
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

test("Zugerklärungen wiederholen keine separaten Eröffnungsankündigungen", () => {
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
  assert.doesNotMatch(
    moveExplanationToMarkdown(withoutAnnouncement, { deep: true }),
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
    assert.ok(announced, `Ankündigungsart ${kind}`);
    assert.doesNotMatch(
      moveExplanationToMarkdown(announced, { deep: true }),
      /Königbauernspiel/,
    );
  }
});

test("erkannte Eröffnungen zeigen nur datenbankbelegte Antworten als typisch", () => {
  const positionEvidence = evidenceFixture();
  const baseOpening = {
    matched: true,
    eco: "C20",
    displayName: "Königbauernspiel",
    sourceName: "King's Pawn Game",
    family: "King's Pawn Game",
    source: "lichess-chess-openings",
    matchedPly: 1,
    currentPly: 1,
  };
  const withoutReplyEvidence = buildLocalMoveExplanation({
    positionEvidence,
    engineContext,
    learnerProfile,
    openingContext: {
      ...baseOpening,
      continuations: [{
        uci: "g1f3",
        san: "Nf3",
        source: "lichess-chess-openings",
      }],
    },
  });

  assert.ok(withoutReplyEvidence);
  assert.equal(withoutReplyEvidence.opponentReply, null);
  assert.doesNotMatch(
    moveExplanationToMarkdown(withoutReplyEvidence, { deep: true }),
    /(?:Stärkste|Typische) Antwort/,
  );

  const withReplyEvidence = buildLocalMoveExplanation({
    positionEvidence,
    engineContext,
    learnerProfile,
    openingContext: {
      ...baseOpening,
      continuations: [{
        uci: "e7e5",
        san: "e5",
        variationCount: 12,
        source: "lichess-chess-openings",
      }],
    },
  });
  const markdown = moveExplanationToMarkdown(withReplyEvidence, { deep: true });

  assert.ok(withReplyEvidence?.opponentReply);
  assert.ok(withReplyEvidence.opponentReply.evidenceIds.includes(
    "opening.continuation:e7e5",
  ));
  assert.match(markdown, /\*\*Typische Antwort:\*\* Danach folgt oft e5\./);
  assert.doesNotMatch(markdown, /(?:stärkste|beste) Antwort|Am stärksten/iu);
});

test("außerhalb erkannter Eröffnungen bleibt die stärkste Antwort kompakt", () => {
  const explanation = buildLocalMoveExplanation({
    positionEvidence: evidenceFixture(),
    engineContext,
    learnerProfile,
  });
  const markdown = moveExplanationToMarkdown(explanation, { deep: true });

  assert.match(markdown, /\*\*Stärkste Antwort:\*\* Danach folgt e5\./);
  assert.doesNotMatch(markdown, /Stärkste Antwort:\*\*\s*Am stärksten/iu);
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
          output_text: JSON.stringify(groundedStructuredExplanation()),
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

  assert.equal(first.source, "ai", first.reason);
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
  assert.match(
    captured.body.instructions,
    /erkannte[nr]? Eröffnung.*typische.*niemals als beste oder stärkste Antwort/iu,
  );
  assert.match(captured.body.input, /<position_evidence>/);
  assert.match(captured.body.input, /<verified_knowledge>/);
  assert.match(captured.body.input, /<grounded_draft>/);
  assert.match(captured.body.input, /evidenceIds und moveRefs daraus exakt/);
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
  assert.ok(malformed.explanation.verdict);
  assert.ok(malformed.explanation.moveIdea);

  const fabricated = groundedStructuredExplanation();
  fabricated.verdict.evidenceIds = ["evidence.erfunden"];
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

  assert.equal(ungrounded.source, "ai", ungrounded.reason);
  assert.equal(ungrounded.reason, "");
  assert.doesNotMatch(
    JSON.stringify(ungrounded.explanation),
    /evidence\.erfunden/,
  );
  assert.ok(ungrounded.explanation);
});

test("eine KI-Lobfloskel wird aus der strukturierten Zugerklärung entfernt", async () => {
  const candidate = groundedStructuredExplanation();
  candidate.verdict = {
    ...candidate.verdict,
    text: "Sauber – genau das war hier gefragt.",
  };
  const result = await requestMoveExplanation(
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
          return { output_text: JSON.stringify(candidate) };
        },
      }),
    },
  );

  assert.equal(result.source, "local");
  assert.equal(result.reason, "ai_wording_rejected");
  assert.doesNotMatch(result.reply, /Sauber|genau das war/iu);
});

test("lokaler Fallback erklärt erst das erlaubte Schach und dann die Alternative", () => {
  const game = new Chess();
  game.move("f3");
  game.move("e5");
  const fen = game.fen();
  const candidateLines = [
    {
      rank: 1,
      evaluation: { unit: "cp", value: 0, perspective: "white" },
      pvUci: ["g2g3", "b8c6"],
    },
    {
      rank: 2,
      evaluation: { unit: "cp", value: -20, perspective: "white" },
      pvUci: ["g1h3", "b8c6"],
    },
  ];
  const positionEvidence = buildPositionEvidence({
    fenBefore: fen,
    playedUci: "g2g4",
    candidateLines,
    playedLine: {
      evaluation: { unit: "mate", value: -1, perspective: "white" },
      pvUci: ["g2g4", "d8h4"],
    },
    lossCp: 10_000,
  });
  const context = {
    source: "stockfish",
    kind: "move_review",
    fen,
    depth: 18,
    bestMove: { uci: "g2g3", san: "g3" },
    primaryVariation: { uci: ["g2g3", "b8c6"], san: ["g3", "Nc6"] },
    lines: candidateLines.map((line) => ({
      rank: line.rank,
      depth: 18,
      evaluation: line.evaluation,
      bestMove: {
        uci: line.pvUci[0],
        san: line.rank === 1 ? "g3" : "Nh3",
      },
      pv: {
        uci: line.pvUci,
        san: line.rank === 1 ? ["g3", "Nc6"] : ["Nh3", "Nc6"],
      },
    })),
    playedLine: {
      evaluation: { unit: "mate", value: -1, perspective: "player" },
      uci: ["g2g4", "d8h4"],
      san: ["g4", "Qh4#"],
    },
    moveReview: {
      playedMove: { uci: "g2g4", san: "g4" },
      bestMove: { uci: "g2g3", san: "g3" },
      quality: "blunder",
      lossCp: 10_000,
      pv: { uci: ["g2g3", "b8c6"], san: ["g3", "Nc6"] },
    },
  };
  const explanation = buildLocalMoveExplanation({
    positionEvidence,
    engineContext: context,
  });

  assert.ok(explanation);
  assert.match(explanation.verdict.text, /Qh4#/);
  assert.match(explanation.opponentReply.text, /Qh4#/);
  assert.match(explanation.alternative.text, /g3/);
  assert.match(explanation.comparison.text, /Schach|Matt/i);
  assert.match(explanation.takeaway.text, /König direkt angreifen/i);
  assert.doesNotMatch(
    moveExplanationToMarkdown(explanation, { deep: true }),
    /wechselt auf|verändert die Bauernstellung|sicherer Bezugspunkt/i,
  );
});

test("bei knapper Faktenlage bleiben optionale Felder null statt Fülltext zu erzeugen", () => {
  const fen = "k7/8/8/8/8/8/6K1/8 w - - 0 1";
  const positionEvidence = buildPositionEvidence({
    fenBefore: fen,
    playedUci: "g2h1",
    candidateLines: [{
      rank: 1,
      evaluation: { unit: "cp", value: 0, perspective: "white" },
      pvUci: ["g2h1", "a8b7"],
    }],
  });
  const context = {
    source: "stockfish",
    kind: "position",
    fen,
    depth: 12,
    evaluation: { unit: "cp", value: 0, perspective: "white" },
    bestMove: { uci: "g2h1", san: "Kh1" },
    primaryVariation: { uci: ["g2h1", "a8b7"], san: ["Kh1", "Kb7"] },
    lines: [{
      rank: 1,
      depth: 12,
      evaluation: { unit: "cp", value: 0, perspective: "white" },
      bestMove: { uci: "g2h1", san: "Kh1" },
      pv: { uci: ["g2h1", "a8b7"], san: ["Kh1", "Kb7"] },
    }],
  };
  const explanation = buildLocalMoveExplanation({ positionEvidence, engineContext: context });

  assert.ok(explanation.verdict);
  assert.ok(explanation.moveIdea);
  assert.equal(explanation.alternative, null);
  assert.equal(explanation.comparison, null);
  assert.equal(explanation.takeaway, null);
});

test("im Positionsmodus darf der zweitplatzierte Endspielzug als gleichwertige Alternative erscheinen", () => {
  const fen = "8/5k2/8/8/8/5K2/6P1/8 w - - 0 40";
  const candidateLines = [
    {
      rank: 1,
      evaluation: { unit: "cp", value: 0, perspective: "white" },
      pvUci: ["g2g3", "f7e8"],
    },
    {
      rank: 2,
      evaluation: { unit: "cp", value: -5, perspective: "white" },
      pvUci: ["g2g4", "f7e8"],
    },
  ];
  const positionEvidence = buildPositionEvidence({
    fenBefore: fen,
    playedUci: "g2g3",
    candidateLines,
  });
  const context = {
    source: "stockfish",
    kind: "position",
    fen,
    depth: 15,
    evaluation: { unit: "cp", value: 0, perspective: "white" },
    bestMove: { uci: "g2g3", san: "g3" },
    primaryVariation: { uci: ["g2g3", "f7e8"], san: ["g3", "Ke8"] },
    lines: candidateLines.map((line) => ({
      rank: line.rank,
      depth: 15,
      evaluation: line.evaluation,
      bestMove: {
        uci: line.pvUci[0],
        san: line.rank === 1 ? "g3" : "g4",
      },
      pv: {
        uci: line.pvUci,
        san: [line.rank === 1 ? "g3" : "g4", "Ke8"],
      },
    })),
  };

  const explanation = buildLocalMoveExplanation({ positionEvidence, engineContext: context });

  assert.ok(explanation);
  assert.match(explanation.alternative.text, /g4/);
  assert.doesNotMatch(explanation.alternative.text, /besser|genauer/i);
  assert.equal(
    validateCoachLanguage(moveExplanationToMarkdown(explanation), {
      rating: 800,
      phase: "endgame",
      practicallyEquivalent: true,
    }).valid,
    true,
  );
});

test("onlyMove wird erklärt, ohne eine künstlich gleichwertige Alternative zu behaupten", () => {
  const onlyMoveFen = START_FEN.replace(/ 0 1$/u, " 0 20");
  const candidateLines = [
    {
      rank: 1,
      evaluation: { unit: "cp", value: 0, perspective: "white" },
      pvUci: ["e2e4", "e7e5"],
    },
    {
      rank: 2,
      evaluation: { unit: "cp", value: -200, perspective: "white" },
      pvUci: ["d2d4", "d7d5"],
    },
  ];
  const positionEvidence = buildPositionEvidence({
    fenBefore: onlyMoveFen,
    playedUci: "e2e4",
    candidateLines,
  });
  const context = {
    ...engineContext,
    fen: onlyMoveFen,
    kind: "move_review",
    lines: candidateLines.map((line) => ({
      rank: line.rank,
      depth: 18,
      evaluation: line.evaluation,
      bestMove: {
        uci: line.pvUci[0],
        san: line.rank === 1 ? "e4" : "d4",
      },
      pv: {
        uci: line.pvUci,
        san: line.rank === 1 ? ["e4", "e5"] : ["d4", "d5"],
      },
    })),
    moveReview: {
      playedMove: { uci: "e2e4", san: "e4" },
      bestMove: { uci: "e2e4", san: "e4" },
      quality: "best",
      lossCp: 0,
      onlyMove: true,
      onlyMoveEvidence: {
        type: "only_move_to_avoid_loss",
        gapCp: 200,
        bestCp: 0,
        secondCp: -200,
      },
      pv: { uci: ["e2e4", "e7e5"], san: ["e4", "e5"] },
    },
  };
  const explanation = buildLocalMoveExplanation({ positionEvidence, engineContext: context });

  assert.ok(explanation);
  assert.match(explanation.alternative.text, /deutlich schwächer/);
  assert.doesNotMatch(explanation.alternative.text, /gleichwertig/);
  assert.match(explanation.comparison.text, /klaren Nachteil/i);
});

test("eine direkte Rücknahme wird für Anfänger als vollständiger Tausch erklärt", () => {
  const fen = "4k3/8/8/2p5/3n4/3QP3/8/4K3 w - - 0 1";
  const line = ["d3d4", "c5d4", "e3d4"];
  const positionEvidence = buildPositionEvidence({
    fenBefore: fen,
    playedUci: "d3d4",
    candidateLines: [{
      rank: 1,
      evaluation: { unit: "cp", value: 0, perspective: "white" },
      pvUci: line,
    }],
    playedLine: {
      evaluation: { unit: "cp", value: 0, perspective: "white" },
      pvUci: line,
    },
    lossCp: 0,
    quality: "best",
    engineDepth: 18,
  });
  const context = {
    source: "stockfish",
    kind: "move_review",
    fen,
    depth: 18,
    evaluation: { unit: "cp", value: 0, perspective: "white" },
    bestMove: { uci: "d3d4", san: "Qxd4" },
    primaryVariation: { uci: line, san: ["Qxd4", "cxd4", "exd4"] },
    lines: [{
      rank: 1,
      depth: 18,
      evaluation: { unit: "cp", value: 0, perspective: "white" },
      bestMove: { uci: "d3d4", san: "Qxd4" },
      pv: { uci: line, san: ["Qxd4", "cxd4", "exd4"] },
    }],
    playedLine: {
      evaluation: { unit: "cp", value: 0, perspective: "white" },
      uci: line,
      san: ["Qxd4", "cxd4", "exd4"],
    },
    moveReview: {
      playedMove: { uci: "d3d4", san: "Qxd4" },
      bestMove: { uci: "d3d4", san: "Qxd4" },
      quality: "best",
      lossCp: 0,
    },
  };
  const explanation = buildLocalMoveExplanation({
    positionEvidence,
    engineContext: context,
    learnerProfile: learnerProfileForCoach({ rating: 800 }),
  });

  assert.ok(explanation?.opponentReply);
  assert.match(explanation.opponentReply.text, /cxd4 nimmt deine Dame/);
  assert.match(explanation.opponentReply.text, /mit exd4 den Bauern zurück/);
  assert.equal(explanation.opponentReply.moveRefs[0].uci.length, 2);
  assert.equal(
    verifyMoveExplanation(explanation, {
      positionEvidence: buildTrustedExplanationEvidence({
        positionEvidence,
        engineContext: context,
      }),
      engineContext: context,
    }).valid,
    true,
  );
});
