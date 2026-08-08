import test from "node:test";
import assert from "node:assert/strict";
import { buildPositionDiagnosis, POSITION_DIAGNOSIS_VERSION } from "../positionDiagnosis.js";
import { buildPositionEvidence } from "../positionEvidence.js";
import { recognizePositionPatterns } from "../patternRecognition.js";
import { COACH_EVALUATION_CASES } from "./fixtures/coachEvaluationCases.js";

function numericEvaluation(value) {
  if (value?.unit === "mate") return value.value > 0 ? 100_000 : -100_000;
  return Number(value?.value) || 0;
}

function diagnosisFromInput({
  fen,
  playedUci,
  candidateLines,
  playedLine,
  lossCp = null,
  extraPatterns = [],
  depth = 18,
}) {
  const best = candidateLines[0];
  const resolvedLoss = Number.isFinite(lossCp)
    ? lossCp
    : Math.max(
      0,
      numericEvaluation(best?.evaluation) - numericEvaluation(playedLine?.evaluation),
    );
  const positionEvidence = buildPositionEvidence({
    fenBefore: fen,
    playedUci,
    candidateLines,
    playedLine,
    lossCp: resolvedLoss,
    engineDepth: depth,
  });
  assert.equal(positionEvidence.valid, true);
  const recognizedPatterns = recognizePositionPatterns({
    fenBefore: fen,
    fenAfter: positionEvidence.after?.fen || "",
    engine: {
      lineUci: best?.pvUci || [],
      depth,
      lastMoveUci: playedUci,
      lastMoveWasCapture: Boolean(positionEvidence.playedMove?.capture),
    },
  });
  return buildPositionDiagnosis({
    engineContext: {
      source: "stockfish",
      kind: "move_review",
      depth,
      moveReview: {
        evaluationBefore: best?.evaluation || null,
        evaluationAfter: playedLine?.evaluation || null,
        lossCp: resolvedLoss,
      },
    },
    positionEvidence,
    recognizedPatterns: [...recognizedPatterns, ...extraPatterns],
  });
}

function diagnosisForCase(id, options = {}) {
  const fixture = COACH_EVALUATION_CASES.find((entry) => entry.id === id);
  assert.ok(fixture, `Fixture fehlt: ${id}`);
  return diagnosisFromInput({
    fen: fixture.fen,
    playedUci: fixture.playedMove,
    candidateLines: fixture.candidateLines,
    playedLine: fixture.playedLine,
    ...options,
  });
}

function structuralDiagnosis({ fen, move, concept, squares }) {
  return diagnosisFromInput({
    fen,
    playedUci: move,
    candidateLines: [{
      rank: 1,
      evaluation: { unit: "cp", value: 120, perspective: "player" },
      pvUci: [move],
    }],
    playedLine: {
      evaluation: { unit: "cp", value: 120, perspective: "player" },
      pvUci: [move],
    },
    extraPatterns: [{
      id: `test:${concept}`,
      type: concept,
      category: "strategic",
      side: "w",
      status: "active",
      timing: "created",
      move: null,
      criticalSquares: squares,
      confidence: 0.9,
      explanation: `Das Konzept ${concept} ist mit dem Hauptzug auf den kritischen Feldern verbunden.`,
    }],
  });
}

test("Diagnose-Schema enthält Bewertung, Hauptgrund, PV-Belege und Unsicherheiten", () => {
  const diagnosis = diagnosisForCase("tactic-hanging-queen");
  assert.equal(diagnosis.version, POSITION_DIAGNOSIS_VERSION);
  assert.equal(diagnosis.valid, true);
  assert.equal(diagnosis.evaluation.changeCp, -900);
  assert.equal(diagnosis.primaryReason.concept, "hanging_piece");
  assert.ok(diagnosis.primaryReason.confidence >= 0.8);
  assert.ok(diagnosis.pvEvidence.some((item) => (
    item.type === "capture" && item.capturedPiece === "q" && item.square === "d3"
  )));
  assert.ok(Array.isArray(diagnosis.uncertainties));
});

test("taktische Motive werden nur mit konkreter Linienverbindung zum Hauptgrund", () => {
  const cases = [
    ["tactic-knight-fork", "fork"],
    ["tactic-pin", "pin"],
    ["tactic-mate-threat", "mating_attack"],
  ];
  for (const [fixture, expected] of cases) {
    const diagnosis = diagnosisForCase(fixture);
    assert.equal(diagnosis.primaryReason?.concept, expected, fixture);
    assert.ok(diagnosis.primaryReason.signals.some((item) => (
      item.id.startsWith("pv:")
      || item.id.startsWith("comparison:")
      || item.id.startsWith("engine:")
    )), fixture);
  }

  const discovered = diagnosisFromInput({
    fen: "k3q3/8/8/8/8/8/4B3/K3R3 w - - 0 1",
    playedUci: "e2d3",
    candidateLines: [{
      rank: 1,
      evaluation: { unit: "cp", value: 250, perspective: "player" },
      pvUci: ["e2d3"],
    }],
    playedLine: {
      evaluation: { unit: "cp", value: 250, perspective: "player" },
      pvUci: ["e2d3"],
    },
  });
  assert.equal(discovered.primaryReason?.concept, "discovered_attack");
});

test("Materialverlust und taktischer Bewertungssprung werden aus derselben geprüften Folge verbunden", () => {
  const diagnosis = diagnosisForCase("tactic-hanging-queen");
  assert.equal(diagnosis.primaryReason.type, "material");
  assert.ok(diagnosis.evaluation.lossCp >= 800);
  assert.ok(diagnosis.primaryReason.signals.some((item) => item.id === "outcome:material"));
  assert.ok(diagnosis.primaryReason.signals.some((item) => item.id === "evaluation:swing_corroborates"));
});

test("unsicherer König wird durch stärkste Schachantwort und Zugvergleich priorisiert", () => {
  const diagnosis = diagnosisFromInput({
    fen: "rnbqkbnr/pppp1ppp/8/4p3/8/5P2/PPPPP1PP/RNBQKBNR w KQkq - 0 2",
    playedUci: "a2a3",
    candidateLines: [
      {
        rank: 1,
        evaluation: { unit: "cp", value: 0, perspective: "player" },
        pvUci: ["g2g3", "d8h4"],
      },
      {
        rank: 2,
        evaluation: { unit: "cp", value: -150, perspective: "player" },
        pvUci: ["a2a3", "d8h4"],
      },
    ],
    playedLine: {
      evaluation: { unit: "cp", value: -150, perspective: "player" },
      pvUci: ["a2a3", "d8h4"],
    },
  });
  assert.equal(diagnosis.primaryReason?.concept, "unsafe_king");
  assert.ok(diagnosis.pvEvidence.some((item) => item.type === "check"));
});

test("strategische Treiber decken Entwicklung, schwachen Bauern, Freibauern, Raum und Vorposten ab", () => {
  assert.equal(
    diagnosisForCase("opening-poor-development").primaryReason?.concept,
    "development_advantage",
  );
  assert.equal(
    structuralDiagnosis({
      fen: "4k3/8/2p5/8/3P4/8/8/4K3 w - - 0 1",
      move: "d4d5",
      concept: "isolated_pawn",
      squares: ["d4", "d5"],
    }).primaryReason?.concept,
    "isolated_pawn",
  );
  assert.equal(
    structuralDiagnosis({
      fen: "4k3/8/8/3P4/8/8/8/4K3 w - - 0 1",
      move: "d5d6",
      concept: "passed_pawn",
      squares: ["d5", "d6"],
    }).primaryReason?.concept,
    "passed_pawn",
  );
  assert.equal(
    structuralDiagnosis({
      fen: "4k3/8/5p2/8/4P3/8/8/4K3 w - - 0 1",
      move: "e4e5",
      concept: "space_advantage",
      squares: ["e4", "e5"],
    }).primaryReason?.concept,
    "space_advantage",
  );
  assert.equal(diagnosisForCase("strategy-outpost").primaryReason?.concept, "outpost");
});

test("positioneller Vorteil ohne Taktik und ruhige große Verbesserung bleiben erklärbar", () => {
  const positional = diagnosisForCase("strategy-open-file-rook");
  assert.equal(positional.primaryReason?.concept, "rook_on_open_file");
  assert.notEqual(positional.primaryReason?.type, "tactical");

  const quietImprovement = diagnosisFromInput({
    fen: "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1",
    playedUci: "a2a3",
    candidateLines: [
      {
        rank: 1,
        evaluation: { unit: "cp", value: 100, perspective: "player" },
        pvUci: ["g1f3", "g8f6"],
      },
      {
        rank: 2,
        evaluation: { unit: "cp", value: -150, perspective: "player" },
        pvUci: ["a2a3", "g8f6"],
      },
    ],
    playedLine: {
      evaluation: { unit: "cp", value: -150, perspective: "player" },
      pvUci: ["a2a3", "g8f6"],
    },
  });
  assert.equal(quietImprovement.primaryReason?.concept, "development_advantage");
  assert.equal(quietImprovement.evaluation.changeCp, -250);
  assert.equal(quietImprovement.pvEvidence.some((item) => item.type === "capture"), false);
  assert.equal(quietImprovement.pvEvidence.some((item) => item.type === "check"), false);
});

test("Königsaktivität verdrängt im Endspiel die generische Zentrumskontrolle", () => {
  const diagnosis = diagnosisForCase("endgame-king-centralization");
  assert.equal(diagnosis.phase, "endgame");
  assert.equal(diagnosis.primaryReason?.concept, "king_activity_endgame");
  assert.notEqual(diagnosis.secondaryReasons?.[0]?.concept, "center_control");
});

test("mehrere erkannte Muster werden nicht gleich gewichtet und ein unbelegter Grund bleibt offen", () => {
  const irrelevantPatterns = [
    {
      id: "background:space",
      type: "space_advantage",
      category: "strategic",
      status: "active",
      timing: "persistent",
      move: null,
      criticalSquares: ["a1"],
      confidence: 0.95,
      explanation: "Raumvorteil ist vorhanden, aber nicht mit der Hauptvariante verbunden.",
    },
    {
      id: "background:pawn",
      type: "isolated_pawn",
      category: "strategic",
      status: "warning",
      timing: "persistent",
      move: null,
      criticalSquares: ["h7"],
      confidence: 0.95,
      explanation: "Ein schwacher Bauer ist vorhanden, aber für die konkrete Folge nebensächlich.",
    },
  ];
  const focused = diagnosisForCase("tactic-hanging-queen", {
    extraPatterns: irrelevantPatterns,
  });
  assert.equal(focused.primaryReason?.concept, "hanging_piece");
  assert.ok(focused.detectedFeatures.some((item) => (
    item.concept === "space_advantage" && item.relevance === "background"
  )));
  assert.ok(focused.detectedFeatures.some((item) => (
    item.concept === "isolated_pawn" && item.relevance === "background"
  )));
  assert.ok(focused.primaryReason.relevanceScore > focused.backgroundFeatures[0].relevanceScore);

  const uncertain = diagnosisForCase("quiet-no-reliable-motif");
  assert.equal(uncertain.primaryReason, null);
  assert.equal(uncertain.confidence.level, "limited");
  assert.ok(uncertain.uncertainties.some((item) => item.code === "no_causal_feature_confirmed"));
});
