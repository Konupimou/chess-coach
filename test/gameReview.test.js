import test from "node:test";
import assert from "node:assert/strict";
import { Chess } from "chess.js";
import { MoveTreeNode, addMoveToTree } from "../moveTree.js";
import {
  buildFallbackFeedback,
  buildLearningSummary,
  buildPvFrames,
  calculateMoveAccuracy,
  explainMoveQuality,
  pathToNode,
  reviewDepthForPlies,
  scoreToWhiteCp,
  summarizeGameReview,
  terminalWhiteCp,
} from "../gameReview.js";

test("PV-Vorschau erzeugt legale Frames, ohne die Ausgangsstellung zu verändern", () => {
  const game = new Chess();
  const startFen = game.fen();
  const frames = buildPvFrames(startFen, ["e2e4", "e7e5", "g1f3"], 2);
  assert.equal(frames.length, 2);
  assert.deepEqual(frames.map((frame) => frame.san), ["e4", "e5"]);
  assert.equal(game.fen(), startFen);
  assert.equal(buildPvFrames(startFen, ["e2e5", "e7e5"]).length, 0);
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
    explainMoveQuality({ san: "O-O", quality: "best" }),
    /König in Sicherheit/,
  );
  assert.match(
    explainMoveQuality({ san: "Qh5", bestSan: "Nf3", quality: "mistake" }),
    /Nf3/,
  );
  assert.match(
    explainMoveQuality({ san: "Qh7+", quality: "excellent" }),
    /Schachdrohung/,
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
  assert.match(feedback, /\*\*Hauptmotive:\*\*/);
  assert.match(feedback, /\*\*Das war stark:\*\*/);
  assert.match(feedback, /\*\*Das kannst du verbessern:\*\*/);
  assert.match(feedback, /\*\*Trainingsfokus:\*\*/);
});

test("Lernzusammenfassung leitet vorsichtige, konkrete Trainingsschritte aus vorhandenen Zügen ab", () => {
  const summary = buildLearningSummary({
    moves: [
      { moveNumber: 1, color: "w", san: "e4", accuracy: 96, quality: "excellent", winPercentLoss: 1, explanation: "Besetzt das Zentrum." },
      { moveNumber: 2, color: "w", san: "Qh5", accuracy: 41, quality: "mistake", winPercentLoss: 18, explanation: "Übersieht eine direkte Antwort." },
      { moveNumber: 3, color: "w", san: "Qxf7+", accuracy: 35, quality: "blunder", winPercentLoss: 25, explanation: "Die Dame gerät in Gefahr." },
      { moveNumber: 4, color: "w", san: "Nf3", accuracy: 91, quality: "excellent", winPercentLoss: 2, explanation: "Entwickelt eine Figur." },
    ],
  });

  assert.ok(["Eröffnung", "Mittelspiel", "Endphase"].includes(summary.strongestPhase));
  assert.match(summary.biggestLesson, /Qxf7\+/);
  assert.match(summary.recurringPattern, /2 deutliche Bewertungseinbrüche/);
  assert.match(summary.learningGoal, /Schachs, Schlagzüge und direkte Drohungen/);
  assert.match(summary.exercise, /zwei größten Fehler/);
});

test("Lernzusammenfassung behauptet bei fehlenden Daten kein präzises Muster", () => {
  const summary = buildLearningSummary({ moves: [] });
  assert.equal(summary.confidence, "low");
  assert.match(summary.strongestPhase, /nicht zuverlässig/);
  assert.match(summary.recurringPattern, /weitere.*Züge/i);
});
