import test from "node:test";
import assert from "node:assert/strict";

import {
  detectKnowledgeEvidence,
  determineGamePhase,
} from "../chessKnowledge/detector.js";
import { buildCoachKnowledgeContext } from "../chessKnowledge/context.js";

const context = (fen, overrides = {}) => ({
  source: "stockfish",
  kind: "position",
  fen,
  depth: 18,
  evaluation: { unit: "cp", value: 20 },
  bestMove: { uci: "e2e4", san: "e4" },
  primaryVariation: { uci: ["e2e4"], san: ["e4"] },
  lines: [],
  ...overrides,
});

function hasSignal(result, signal) {
  return result.signals.includes(signal);
}

test("ungültige oder fehlende Stellungen erzeugen keine Brettbehauptungen", () => {
  const missing = detectKnowledgeEvidence({ engineContext: null });
  const malformed = detectKnowledgeEvidence({ engineContext: context("kein fen") });

  assert.equal(missing.phase, null);
  assert.deepEqual(missing.signals, []);
  assert.equal(malformed.phase, null);
  assert.deepEqual(malformed.evidence, []);
  assert.equal(Object.isFrozen(malformed), true);
});

test("öffentliche Wissenshelfer behandeln null als leere Eingabe", () => {
  assert.doesNotThrow(() => detectKnowledgeEvidence(null));
  assert.doesNotThrow(() => buildCoachKnowledgeContext(null));
  assert.deepEqual(detectKnowledgeEvidence(null).signals, []);
  assert.deepEqual(buildCoachKnowledgeContext(null).concepts, []);
});

test("Stockfish-Fakten bleiben auch ohne verwertbare FEN erhalten", () => {
  const result = detectKnowledgeEvidence({
    engineContext: {
      source: "stockfish",
      kind: "move_review",
      moveReview: { classification: "Patzer" },
      lines: [],
    },
  });

  assert.equal(result.phase, null);
  assert.equal(hasSignal(result, "engine-classified-error"), true);
  assert.equal(hasSignal(result, "engine-classified-blunder"), true);
  assert.equal(result.evidence.some((entry) => entry.source === "board"), false);
});

test("Spielphase wird materiell und nicht nur nach Zugnummer bestimmt", () => {
  assert.equal(determineGamePhase("rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1"), "opening");
  assert.equal(determineGamePhase("4k3/8/8/8/8/8/4P3/4K3 w - - 0 12"), "endgame");
  assert.equal(determineGamePhase("r3k2r/ppp2ppp/2n5/3pp3/3PP3/2N5/PPP2PPP/R3K2R w KQkq - 0 24"), "middlegame");
});

test("früher Damenzug bei fehlender Entwicklung wird vorsichtig belegt", () => {
  const engineContext = context(
    "rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2",
    {
      kind: "move_review",
      moveReview: {
        playedMove: { uci: "d1h5", san: "Qh5" },
        bestMove: { uci: "g1f3", san: "Nf3" },
        classification: "Fehler",
        evaluationBefore: { unit: "cp", value: 20 },
        evaluationAfter: { unit: "cp", value: -120 },
        evaluationDeltaCp: -140,
        pv: { uci: ["g1f3"], san: ["Nf3"] },
      },
    },
  );

  const result = detectKnowledgeEvidence({ engineContext });
  assert.equal(result.phase, "opening");
  assert.equal(result.side, "w");
  assert.equal(hasSignal(result, "minor-pieces-on-starting-squares"), true);
  assert.equal(hasSignal(result, "early-queen-move-observed"), true);
  assert.equal(hasSignal(result, "premature-attack"), false);
  assert.equal(hasSignal(result, "engine-classified-error"), true);
  const queenEvidence = result.evidence.find((entry) => entry.signal === "early-queen-move-observed");
  assert.deepEqual(queenEvidence, {
    signal: "early-queen-move-observed",
    source: "review",
    detail: "Der geprüfte Zug führt die weiße Dame von d1 nach h5.",
  });
  assert.equal(
    result.evidence.some((entry) => entry.source === "board" && entry.detail.includes("h5")),
    false,
  );

  const knowledgeContext = buildCoachKnowledgeContext({ engineContext });
  const queenConcept = knowledgeContext.concepts.find(
    (concept) => concept.id === "opening.early-queen-development",
  );
  assert.equal(queenConcept?.basis, "review-relevance");
  assert.deepEqual(queenConcept?.evidence, [queenEvidence]);
});

test("ein syntaktisch gültiger, aber illegaler Review-Damenzug erzeugt keinen Beleg", () => {
  const result = detectKnowledgeEvidence({
    engineContext: context(
      "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1",
      {
        kind: "move_review",
        moveReview: { playedMove: { uci: "d1h5", san: "Qh5" } },
      },
    ),
  });

  assert.equal(hasSignal(result, "early-queen-move-observed"), false);
  assert.equal(result.evidence.some((entry) => entry.detail.includes("d1 nach h5")), false);
});

test("eine Dame außerhalb des Ausgangsfelds wird nur aus der aktuellen FEN als Brettbeleg beschrieben", () => {
  const result = detectKnowledgeEvidence({
    engineContext: context(
      "r1bqkbnr/pppp1ppp/2n5/4p2Q/4P3/8/PPPP1PPP/RNB1KBNR w KQkq - 1 3",
    ),
  });
  const queenEvidence = result.evidence.find((entry) => entry.signal === "early-queen-move-observed");

  assert.deepEqual(queenEvidence, {
    signal: "early-queen-move-observed",
    source: "board",
    detail: "Weißs Dame steht vor Zug 11 nicht mehr auf dem Ausgangsfeld, sondern auf h5.",
  });
});

test("angegriffene ungedeckte Figuren werden ohne Motiv-Raten erkannt", () => {
  const result = detectKnowledgeEvidence({
    engineContext: context("4k3/8/8/5p2/4B3/8/8/4K3 w - - 0 20"),
  });

  assert.equal(hasSignal(result, "loose-piece"), true);
  assert.equal(hasSignal(result, "hanging-piece"), false);
  assert.equal(hasSignal(result, "deflection"), false);
  assert.match(result.evidence.find((entry) => entry.signal === "loose-piece").detail, /e4/);
});

test("isolierte und durchgelaufene Bauern werden strukturell erkannt", () => {
  const result = detectKnowledgeEvidence({
    engineContext: context("4k3/p7/8/3P4/8/8/8/4K3 w - - 0 30"),
  });

  assert.equal(result.phase, "endgame");
  assert.equal(hasSignal(result, "isolated-pawn"), true);
  assert.equal(hasSignal(result, "passed-pawn"), true);
});

test("Opposition wird nur aus einer passenden Königskonstellation abgeleitet", () => {
  const result = detectKnowledgeEvidence({
    engineContext: context("8/8/8/4k3/8/4K3/3P4/8 w - - 0 40"),
  });

  assert.equal(result.phase, "endgame");
  assert.equal(hasSignal(result, "opposition"), true);
  assert.equal(hasSignal(result, "king-pawn-endgame"), true);
});

test("Stockfish-Daten werden nur als wörtliche Fakten und nicht als Motive erfasst", () => {
  const engineContext = context(
    "4k3/8/8/8/8/8/4Q3/4K3 w - - 0 30",
    {
      bestMove: { uci: "e2e8", san: "Qe8+" },
      primaryVariation: { uci: ["e2e8"], san: ["Qe8+"] },
      lines: [
        { rank: 1, pv: { uci: ["e2e8"], san: ["Qe8+"] } },
        { rank: 2, pv: { uci: ["e2e7"], san: ["Qe7+"] } },
      ],
      moveReview: {
        classification: "Patzer",
        playedMove: { uci: "e2a2", san: "Qa2" },
        bestMove: { uci: "e2e8", san: "Qe8+" },
        evaluationBefore: { unit: "cp", value: 50 },
        evaluationAfter: { unit: "cp", value: -500 },
        evaluationDeltaCp: -550,
        pv: { uci: ["e2e8"], san: ["Qe8+"] },
      },
    },
  );

  const result = detectKnowledgeEvidence({ engineContext });
  assert.equal(hasSignal(result, "engine-classified-error"), true);
  assert.equal(hasSignal(result, "engine-classified-blunder"), true);
  assert.equal(hasSignal(result, "multiple-engine-lines"), true);
  assert.equal(hasSignal(result, "pv-starts-with-check-or-capture"), true);
  assert.equal(hasSignal(result, "blunder-check-missed"), false);
  assert.equal(hasSignal(result, "candidate-moves-needed"), false);
  assert.equal(hasSignal(result, "forcing-moves"), false);
  assert.equal(hasSignal(result, "mating-net"), false);
});

test("Mattwertung und Schachzug werden nicht zu Mattnetz oder Zwangsfolge hochgestuft", () => {
  const result = detectKnowledgeEvidence({
    engineContext: context("4k3/8/8/8/8/8/4Q3/4K3 w - - 0 30", {
      evaluation: { unit: "mate", value: 3 },
      primaryVariation: { uci: ["e2e8"], san: ["Qe8+"] },
      lines: [{ rank: 1, evaluation: { unit: "mate", value: 3 }, pv: { uci: ["e2e8"], san: ["Qe8+"] } }],
    }),
  });

  assert.equal(hasSignal(result, "mate-evaluation-present"), true);
  assert.equal(hasSignal(result, "pv-starts-with-check-or-capture"), true);
  assert.equal(hasSignal(result, "mating-net"), false);
  assert.equal(hasSignal(result, "forcing-moves"), false);
});

test("allgemeine Wissensfragen bleiben unabhängig von der aktuellen Spielphase abrufbar", () => {
  const result = buildCoachKnowledgeContext({
    message: "Was bedeutet Opposition?",
    engineContext: context("rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1"),
  });

  const opposition = result.concepts.find((concept) => concept.id === "endgame.opposition");
  assert.ok(opposition);
  assert.equal(opposition.basis, "question-only");
  assert.deepEqual(opposition.evidence, []);
});

test("Partiereviews sammeln Belege aus allen gelieferten kritischen Momenten", () => {
  const result = detectKnowledgeEvidence({
    engineContext: {
      source: "stockfish",
      kind: "game_review",
      fen: "",
      reviewMoments: [
        {
          label: "2. Qh5",
          fen: "rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2",
          classification: "Fehler",
          playedMove: { uci: "d1h5", san: "Qh5" },
          bestMove: { uci: "g1f3", san: "Nf3" },
          evaluationBefore: { unit: "cp", value: 20 },
          evaluationAfter: { unit: "cp", value: -120 },
          pv: { uci: ["g1f3"], san: ["Nf3"] },
        },
        {
          label: "20. Be4",
          fen: "4k3/8/8/5p2/4B3/8/8/4K3 w - - 0 20",
          classification: "Patzer",
          playedMove: { uci: "c2e4", san: "Be4" },
          bestMove: { uci: "c2f5", san: "Bf5" },
          evaluationBefore: { unit: "cp", value: 0 },
          evaluationAfter: { unit: "cp", value: -400 },
          pv: { uci: ["c2f5"], san: ["Bf5"] },
        },
      ],
    },
  });

  assert.equal(hasSignal(result, "early-queen-move-observed"), true);
  assert.equal(hasSignal(result, "loose-piece"), true);
  assert.equal(hasSignal(result, "engine-classified-blunder"), true);
  assert.ok(result.phases.includes("opening"));
  assert.ok(result.phases.includes("endgame"));
  assert.ok(result.evidence.some((entry) => entry.detail.startsWith("Moment 2:")));
  assert.equal(result.evidence.some((entry) => entry.detail.includes("Be4")), false);
});

test("Coach-Kontext liefert wenige Karten mit jeweils passenden Belegen", () => {
  const result = buildCoachKnowledgeContext({
    message: "Warum war meine frühe Dame ein Fehler?",
    engineContext: context(
      "rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2",
      {
        kind: "move_review",
        moveReview: {
          classification: "Fehler",
          playedMove: { uci: "d1h5", san: "Qh5" },
          bestMove: { uci: "g1f3", san: "Nf3" },
          evaluationBefore: { unit: "cp", value: 20 },
          evaluationAfter: { unit: "cp", value: -120 },
          evaluationDeltaCp: -140,
          pv: { uci: ["g1f3"], san: ["Nf3"] },
        },
      },
    ),
  });

  assert.ok(result.concepts.length >= 1 && result.concepts.length <= 4);
  assert.equal(result.concepts[0].id, "opening.early-queen-development");
  assert.ok(result.concepts[0].evidence.some((entry) => entry.signal === "early-queen-move-observed"));
  assert.ok(result.concepts.every((concept) => concept.evidence.length <= 3));
  assert.equal("retrieval" in result.concepts[0], false);
  assert.equal(Object.isFrozen(result), true);
});
