import test from "node:test";
import assert from "node:assert/strict";
import { Chess } from "chess.js";
import { MoveTreeNode, addMoveToTree } from "../moveTree.js";
import {
  analysisEntryFromInfo,
  buildFallbackFeedback,
  buildLearningSummary,
  buildPvFrames,
  calculateMoveAccuracy,
  describeMoveAssessment,
  explainMoveQuality,
  groundedSuggestionReason,
  legalPv,
  legalUciMove,
  pathToNode,
  reviewDepthForPlies,
  scoreToWhiteCp,
  summarizeGameReview,
  terminalWhiteCp,
  verifiedMoveReview,
} from "../gameReview.js";

const START_FEN = new Chess().fen();
const AFTER_E4_E5_FEN =
  "rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2";

test("Engine-Eintrag bewahrt Mattwert, Tiefe und vollständige Hauptvariante", () => {
  const pv = [
    "e2e4", "e7e5", "g1f3", "b8c6", "f1b5",
    "a7a6", "b5a4", "g8f6", "e1g1", "f8e7",
    "f1e1", "b7b5", "a4b3",
  ];
  const entry = analysisEntryFromInfo({
    fen: START_FEN,
    depth: 23,
    whiteScore: { unit: "mate", value: 5, pawns: 100 },
    pv,
  });
  assert.deepEqual(entry.evaluation, {
    unit: "mate",
    value: 5,
    perspective: "white",
  });
  assert.equal(entry.depth, 23);
  assert.deepEqual(entry.pv, pv);
});

test("Engine-Eintrag verwirft eine PV vollständig, sobald ein Zug im geprüften Präfix illegal ist", () => {
  assert.equal(
    analysisEntryFromInfo({
      fen: START_FEN,
      depth: 18,
      whiteScore: { unit: "cp", value: 24 },
      pv: ["e2e4", "e7e5", "g1g3"],
    }),
    null,
  );
});

test("PV-Vorschau erzeugt legale Frames, ohne die Ausgangsstellung zu verändern", () => {
  const game = new Chess();
  const startFen = game.fen();
  const frames = buildPvFrames(startFen, ["e2e4", "e7e5", "g1f3"], 2);
  assert.equal(frames.length, 2);
  assert.deepEqual(frames.map((frame) => frame.san), ["e4", "e5"]);
  assert.equal(game.fen(), startFen);
  assert.equal(buildPvFrames(startFen, ["e2e5", "e7e5"]).length, 0);
  assert.equal(legalUciMove(startFen, "e2e5"), null);
  assert.deepEqual(
    legalPv(startFen, ["e2e4", "e7e5", "g1g3"]).map((frame) => frame.uci),
    ["e2e4", "e7e5"],
  );
});

test("aktueller Variantenpfad folgt Elternknoten statt pauschal der Hauptlinie", () => {
  const game = new Chess();
  const root = new MoveTreeNode({ fen: game.fen() });
  const e4 = addMoveToTree(root, game.move("e4"), game.fen());
  addMoveToTree(e4, game.move("e5"), game.fen());
  game.load(root.fen);
  const d4 = addMoveToTree(root, game.move("d4"), game.fen());
  const d5 = addMoveToTree(d4, game.move("d5"), game.fen());
  assert.deepEqual(pathToNode(d5), [root, d4, d5]);
});

test("Genauigkeit ist für spiegelbildliche Fehler von Weiß und Schwarz symmetrisch", () => {
  const white = calculateMoveAccuracy(0, -100, "w");
  const black = calculateMoveAccuracy(0, 100, "b");
  assert.ok(white.accuracy > 60 && white.accuracy < 70);
  assert.equal(white.accuracy, black.accuracy);
  assert.equal(calculateMoveAccuracy(0, 50, "w").accuracy, 100);
  const alreadyLost = calculateMoveAccuracy(-1000, -2000, "w");
  assert.ok(alreadyLost.accuracy > 85);
  assert.notEqual(alreadyLost.quality, "blunder");
});

test("Partiebericht aggregiert Farben, Verluste und kritische Momente", () => {
  const game = new Chess();
  const root = new MoveTreeNode({ fen: game.fen() });
  const e4 = addMoveToTree(root, game.move("e4"), game.fen());
  const e5 = addMoveToTree(e4, game.move("e5"), game.fen());
  const report = summarizeGameReview(
    [root, e4, e5],
    [
      { whiteCp: 20, pv: ["d2d4"] },
      { whiteCp: -80, pv: ["c7c5"] },
      { whiteCp: 70, pv: [] },
    ],
    { depth: 12, final: true },
  );
  assert.equal(report.totalMoves, 2);
  assert.equal(report.analyzedMoves, 2);
  assert.equal(report.coverage, 100);
  assert.ok(report.whiteAccuracy < 100);
  assert.ok(report.blackAccuracy < 100);
  assert.equal(report.criticalMoments.length, 2);
  assert.equal(report.moves[0].bestSan, "d4");
  assert.match(report.moves[0].explanation, /genauer war d4|Verschlechtert|Gibt etwas Vorteil ab/);
});

test("fokussierter Partiebericht zeigt höchstens die drei entscheidendsten eigenen Momente", () => {
  const game = new Chess();
  const root = new MoveTreeNode({ fen: game.fen() });
  const nodes = [root];
  let current = root;
  ["e4", "e5", "Nf3", "Nc6", "Bc4", "Nf6", "d3", "Bc5"].forEach((san) => {
    current = addMoveToTree(current, game.move(san), game.fen());
    nodes.push(current);
  });
  const evaluations = [0, -300, 100, -250, 150, -200, 200, -150, 250]
    .map((whiteCp) => ({ whiteCp, pv: [] }));

  const whiteReport = summarizeGameReview(nodes, evaluations, {
    depth: 12,
    final: true,
    playerColor: "w",
  });
  const blackReport = summarizeGameReview(nodes, evaluations, {
    depth: 12,
    final: true,
    playerColor: "b",
  });

  assert.equal(whiteReport.playerColor, "w");
  assert.equal(whiteReport.criticalMoments.length, 3);
  assert.ok(whiteReport.criticalMoments.every((move) => move.color === "w"));
  assert.equal(blackReport.criticalMoments.length, 3);
  assert.ok(blackReport.criticalMoments.every((move) => move.color === "b"));
  assert.deepEqual(
    whiteReport.criticalMoments.map((move) => move.winPercentLoss),
    [...whiteReport.criticalMoments]
      .map((move) => move.winPercentLoss)
      .sort((left, right) => right - left),
  );
});

test("nach nur einem weißen Zug bleibt die Genauigkeit für Schwarz offen", () => {
  const game = new Chess();
  const root = new MoveTreeNode({ fen: game.fen() });
  const e4 = addMoveToTree(root, game.move("e4"), game.fen());
  const report = summarizeGameReview(
    [root, e4],
    [
      { whiteCp: 20, pv: ["d2d4"] },
      { whiteCp: 10, pv: ["c7c5"] },
    ],
    { depth: 12, final: false },
  );

  assert.equal(report.analyzedMoves, 1);
  assert.ok(Number.isFinite(report.whiteAccuracy));
  assert.equal(report.blackAccuracy, null);
});

test("Matt, Score-Normalisierung und adaptive Tiefe sind begrenzt", () => {
  assert.equal(scoreToWhiteCp({ unit: "mate", value: -2 }), -10_000);
  assert.equal(scoreToWhiteCp({ pawns: 0.42 }), 42);
  assert.equal(terminalWhiteCp("7k/6Q1/6K1/8/8/8/8/8 b - - 0 1"), 10_000);
  assert.equal(reviewDepthForPlies(20, 18), 14);
  assert.equal(reviewDepthForPlies(120, 15), 10);
});

test("jede Zugqualität erhält eine kurze Begründung", () => {
  assert.match(
    explainMoveQuality({
      fenBefore: START_FEN,
      san: "e4",
      playedUci: "e2e4",
      bestUci: "e2e4",
      bestPvUci: ["e2e4"],
      quality: "best",
    }),
    /Stockfish-Wahl/,
  );
  assert.match(
    explainMoveQuality({
      fenBefore: AFTER_E4_E5_FEN,
      san: "Qh5",
      playedUci: "d1h5",
      bestUci: "g1f3",
      bestPvUci: ["g1f3"],
      quality: "mistake",
    }),
    /Nf3/,
  );
  assert.match(
    explainMoveQuality({ san: "Qh7+", quality: "excellent" }),
    /Stockfish-Bewertung/,
  );
});

test("nur der tatsächlich erste Engine-Zug darf als bester Zug bezeichnet werden", () => {
  const differentButEqual = {
    fenBefore: START_FEN,
    san: "e4",
    playedUci: "e2e4",
    bestUci: "d2d4",
    bestPvUci: ["d2d4", "d7d5"],
    quality: "best",
  };
  const verified = verifiedMoveReview(differentButEqual);
  const assessment = describeMoveAssessment(differentButEqual);
  const explanation = explainMoveQuality(differentButEqual);

  assert.equal(verified.quality, "excellent");
  assert.equal(assessment.label, "Sehr gut");
  assert.equal(assessment.lead, "Das war sehr gut.");
  assert.match(assessment.alternative, /d4/);
  assert.doesNotMatch(assessment.lead, /beste[rn]? Zug/i);
  assert.match(explanation, /erster Wahl d4/);
  assert.doesNotMatch(explanation, /Entspricht der ersten Stockfish-Wahl/);
});

test("gleiche Bewertung bei einem anderen Zug wird im Partiebericht höchstens sehr gut", () => {
  const game = new Chess();
  const root = new MoveTreeNode({ fen: game.fen() });
  const e4 = addMoveToTree(root, game.move("e4"), game.fen());
  const report = summarizeGameReview(
    [root, e4],
    [
      { whiteCp: 20, pv: ["d2d4", "d7d5"] },
      { whiteCp: 20, pv: ["e7e5"] },
    ],
    { depth: 16, final: true },
  );

  assert.equal(report.moves[0].playedUci, "e2e4");
  assert.equal(report.moves[0].bestUci, "d2d4");
  assert.equal(report.moves[0].accuracy, 100);
  assert.equal(report.moves[0].quality, "excellent");
  assert.match(report.moves[0].explanation, /erster Wahl d4/);
  assert.doesNotMatch(
    report.moves[0].explanation,
    /Entspricht der ersten Stockfish-Wahl/,
  );
});

test("Perspektivbewertung spricht gute und schlechte eigene Züge direkt an", () => {
  assert.deepEqual(
    describeMoveAssessment({
      fenBefore: START_FEN,
      san: "e4",
      playedUci: "e2e4",
      bestUci: "e2e4",
      bestPvUci: ["e2e4"],
      quality: "best",
    }),
    {
      tone: "best",
      label: "Bester Zug",
      lead: "Das war der beste Zug.",
      reason: "Du hast damit keinen messbaren Vorteil abgegeben.",
      alternative: "",
    },
  );
  const mistake = describeMoveAssessment({
    fenBefore: AFTER_E4_E5_FEN,
    san: "Qh5",
    playedUci: "d1h5",
    bestUci: "g1f3",
    quality: "mistake",
    bestPvUci: ["g1f3", "b8c6"],
  });
  assert.equal(mistake.lead, "Das war ein Fehler.");
  assert.match(mistake.reason, /deutlich schwieriger/);
  assert.equal(
    mistake.alternative,
    "Statt Qh5 war Nf3 in der Stellung davor besser.",
  );
});

test("Zugrückblicke verwerfen illegale Spielerzüge, Alternativen und PV-Reste", () => {
  assert.equal(
    verifiedMoveReview({
      fenBefore: START_FEN,
      playedUci: "e2e5",
      bestUci: "d2d4",
      bestPvUci: ["d2d4"],
    }),
    null,
  );
  const verified = verifiedMoveReview({
    fenBefore: START_FEN,
    playedUci: "e2e4",
    bestUci: "d2d4",
    bestPvUci: ["d2d4", "d7d5", "d1h5"],
  });
  assert.equal(verified.bestSan, "d4");
  assert.deepEqual(verified.bestPvUci, ["d2d4", "d7d5"]);
});

test("nicht belegte Coach-Erklärungen erhalten einen sicheren lokalen Ersatz", () => {
  assert.equal(
    groundedSuggestionReason({ rank: 1, san: "e4", uci: "e2e4" }),
    "Der Zug erhöht den Einfluss im Zentrum. Achte besonders darauf, wie die gezeigte Antwortfolge diese Idee unterstützt.",
  );
  assert.match(
    groundedSuggestionReason({ rank: 1, san: "Qh7+", uci: "d3h7" }),
    /greift den König direkt an/,
  );
  assert.match(
    groundedSuggestionReason({ rank: 2, san: "Nf3", uci: "g1f3" }),
    /erste Zugidee löst die Aufgaben/,
  );
});

test("Fallback-Coach fasst Verlauf, Motive, Stärke, Verbesserung und Training zusammen", () => {
  const feedback = buildFallbackFeedback({
    overallAccuracy: 88,
    analyzedMoves: 2,
    counts: { mistake: 0, blunder: 0 },
    criticalMoments: [],
    moves: [{
      moveNumber: 1,
      color: "w",
      san: "e4",
      quality: "best",
      accuracy: 100,
      explanation: "Besetzt das Zentrum.",
    }],
  });
  assert.match(feedback, /\*\*Spielverlauf:\*\*/);
  assert.match(feedback, /\*\*Engine-Muster:\*\*/);
  assert.match(feedback, /\*\*Das war stark:\*\*/);
  assert.match(feedback, /\*\*Das kannst du verbessern:\*\*/);
  assert.match(feedback, /\*\*Trainingsfokus:\*\*/);
});

test("Fallback-Coach behandelt nicht-arrayförmige Züge und kritische Momente als leer", () => {
  const malformedCollections = {
    overallAccuracy: 72,
    analyzedMoves: 1,
    moves: { 0: { quality: "blunder" } },
    criticalMoments: "kein Array",
  };

  assert.doesNotThrow(() => buildFallbackFeedback(malformedCollections));
  const feedback = buildFallbackFeedback(malformedCollections);
  assert.match(feedback, /0 Fehler oder Patzer bei 0 eigenen analysierten Zügen/);
  assert.match(feedback, /keinen klaren kritischen Einbruch/);
});

test("Lernzusammenfassung leitet vorsichtige, konkrete Trainingsschritte aus vorhandenen Zügen ab", () => {
  const summary = buildLearningSummary({
    criticalMoments: [
      {
        moveNumber: 3,
        color: "w",
        san: "Qxf7+",
        bestSan: "Nf3",
        bestPvSan: ["Nf3", "Nc6", "Bc4"],
        fenBefore: "example-fen",
        accuracy: 35,
        quality: "blunder",
        winPercentLoss: 25,
        explanation: "Die Dame gerät in Gefahr.",
      },
    ],
    moves: [
      { moveNumber: 1, color: "w", san: "e4", accuracy: 96, quality: "excellent", winPercentLoss: 1, explanation: "Besetzt das Zentrum." },
      { moveNumber: 2, color: "w", san: "Qh5", accuracy: 41, quality: "mistake", winPercentLoss: 18, explanation: "Übersieht eine direkte Antwort." },
      { moveNumber: 3, color: "w", san: "Qxf7+", accuracy: 35, quality: "blunder", winPercentLoss: 25, explanation: "Die Dame gerät in Gefahr." },
      { moveNumber: 4, color: "w", san: "Nf3", accuracy: 91, quality: "excellent", winPercentLoss: 2, explanation: "Entwickelt eine Figur." },
    ],
  });

  assert.ok(["Eröffnung", "Mittelspiel", "Endphase"].includes(summary.strongestPhase));
  assert.match(summary.biggestLesson, /Qxf7\+/);
  assert.match(summary.recurringPattern, /2 deutliche Stockfish-Bewertungseinbrüche/);
  assert.match(summary.learningGoal, /Stockfishs erster Wahl/);
  assert.match(summary.exercise, /3\. Qxf7\+/);
  assert.match(summary.exercise, /Nf3/);
  assert.doesNotMatch(summary.exercise, /zwei|drei/i);
});

test("Lernzusammenfassung und Fallback beziehen sich nur auf die Züge des Spielers", () => {
  const report = {
    playerColor: "w",
    analyzedMoves: 4,
    overallAccuracy: 50,
    whiteAccuracy: 81,
    blackAccuracy: 19,
    criticalMoments: [
      { moveNumber: 1, color: "b", san: "e5", bestSan: "c5", quality: "blunder", winPercentLoss: 35, explanation: "Großer Einbruch." },
      { moveNumber: 2, color: "w", san: "Nf3", bestSan: "Bc4", quality: "mistake", winPercentLoss: 12, explanation: "Verliert etwas Initiative." },
    ],
    moves: [
      { moveNumber: 1, color: "w", san: "e4", accuracy: 98, quality: "excellent", winPercentLoss: 1, explanation: "Stabil." },
      { moveNumber: 1, color: "b", san: "e5", accuracy: 10, quality: "blunder", winPercentLoss: 35, explanation: "Großer Einbruch." },
      { moveNumber: 2, color: "w", san: "Nf3", accuracy: 65, quality: "mistake", winPercentLoss: 12, explanation: "Verliert etwas Initiative." },
      { moveNumber: 2, color: "b", san: "Nc6", accuracy: 20, quality: "blunder", winPercentLoss: 30, explanation: "Noch ein Einbruch." },
    ],
  };

  const summary = buildLearningSummary(report);
  const feedback = buildFallbackFeedback(report);

  assert.match(summary.biggestLesson, /Nf3/);
  assert.doesNotMatch(summary.biggestLesson, /e5|Nc6/);
  assert.doesNotMatch(summary.recurringPattern, /2 deutliche/);
  assert.match(feedback, /81\.0 %/);
  assert.match(feedback, /1 Fehler oder Patzer bei 2 eigenen/);
  assert.doesNotMatch(feedback, /Großer Einbruch|Noch ein Einbruch/);
});

test("auch ohne Fehler bleibt die Übung an eine konkrete eigene Stellung gebunden", () => {
  const summary = buildLearningSummary({
    playerColor: "w",
    criticalMoments: [],
    moves: [
      { moveNumber: 1, color: "w", san: "e4", accuracy: 100, quality: "best", winPercentLoss: 0, explanation: "Stabil." },
      { moveNumber: 1, color: "b", san: "c5", accuracy: 100, quality: "best", winPercentLoss: 0, explanation: "Stabil." },
    ],
  });

  assert.match(summary.exercise, /1\. e4/);
  assert.doesNotMatch(summary.exercise, /den wichtigsten Schlüsselmoment/);
});

test("Lernzusammenfassung behauptet bei fehlenden Daten kein präzises Muster", () => {
  const summary = buildLearningSummary({ moves: [] });
  assert.equal(summary.confidence, "low");
  assert.match(summary.strongestPhase, /nicht zuverlässig/);
  assert.match(summary.recurringPattern, /weitere.*Züge/i);
});
