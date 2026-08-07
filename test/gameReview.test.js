import test from "node:test";
import assert from "node:assert/strict";
import { Chess } from "chess.js";
import { MoveTreeNode, addMoveToTree } from "../moveTree.js";
import {
  analysisEntryFromInfo,
  analysisEntryFromMultiPv,
  buildFallbackFeedback,
  buildCoachPhaseSummary,
  buildLearningSummary,
  buildPvFrames,
  calculateMoveAccuracy,
  classifyMoveReview,
  classifyWinChanceLoss,
  detectMaterialSacrifice,
  describeMoveAssessment,
  explainMoveQuality,
  formatPvWithMoveNumbers,
  groundedSuggestionReason,
  legalPv,
  legalUciMove,
  pathToNode,
  openingMoveReviewPresentation,
  moveAccuracy,
  reviewDepthForPlies,
  reviewPhaseForMove,
  scoreToWhiteCp,
  summarizeGameReview,
  terminalWhiteCp,
  terminalPositionState,
  winChance,
  verifiedMoveReview,
  verifiedSuggestionInfo,
} from "../gameReview.js";

const START_FEN = new Chess().fen();
const AFTER_E4_E5_FEN =
  "rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2";

test("Coach-Analyse trennt Eröffnung, Mittelspiel und Endspiel anhand der Stellung", () => {
  const opening = { moveNumber: 3, fenBefore: START_FEN };
  const middlegame = {
    moveNumber: 18,
    fenBefore: "r1bq1rk1/ppp2ppp/2n2n2/3pp3/3P4/2P1PN2/PP1NBPPP/R2Q1RK1 w - - 0 18",
  };
  const endgame = {
    moveNumber: 42,
    fenBefore: "8/8/8/4k3/8/4K3/4P3/8 w - - 0 42",
  };
  assert.equal(reviewPhaseForMove(opening), "opening");
  assert.equal(reviewPhaseForMove(middlegame), "middlegame");
  assert.equal(reviewPhaseForMove(endgame), "endgame");

  const phases = buildCoachPhaseSummary({
    playerColor: "w",
    moves: [
      { ...opening, color: "w", san: "Nf3", quality: "excellent", winPercentLoss: 0 },
      { ...middlegame, color: "w", san: "Re1", quality: "mistake", winPercentLoss: 8 },
      { ...endgame, color: "w", san: "Kf4", quality: "best", winPercentLoss: 0 },
    ],
  });
  assert.deepEqual(phases.map((phase) => phase.id), ["opening", "middlegame", "endgame"]);
  assert.match(phases[0].positive, /Nf3/);
  assert.match(phases[1].focus, /Re1/);
});

test("Brettmaterial hat bei der Phasenerkennung Vorrang vor der Zugnummer", () => {
  assert.equal(
    reviewPhaseForMove({
      moveNumber: 3,
      fenBefore: "8/8/8/4k3/8/4K3/4P3/8 w - - 0 3",
    }),
    "endgame",
  );
  assert.equal(
    reviewPhaseForMove({ moveNumber: 45, fenBefore: START_FEN }),
    "middlegame",
  );
});

test("Eröffnungszüge erhalten bei kleinen Unterschieden keine Engine-Rangliste", () => {
  const base = {
    moveNumber: 3,
    fenBefore: START_FEN,
    quality: "best",
    lossCp: 0,
  };
  assert.deepEqual(
    openingMoveReviewPresentation(base, { inOpeningBook: true }),
    {
      label: "Spielbare Eröffnungswahl",
      reason: "Dieser Zug steht im lokalen Eröffnungsbuch. In der Eröffnung gibt es oft mehrere gute Wege.",
      hideEngineRanking: true,
    },
  );
  assert.equal(
    openingMoveReviewPresentation({ ...base, quality: "mistake", lossCp: 180 }),
    null,
  );
  assert.equal(
    openingMoveReviewPresentation({ ...base, moveNumber: 18 }),
    null,
  );
  assert.equal(
    openingMoveReviewPresentation({ ...base, san: "Qxf7#" }, { inOpeningBook: true }),
    null,
  );
});

test("stärkste Phase wird aus den Brettstellungen statt aus drei gleich großen Blöcken bestimmt", () => {
  const summary = buildLearningSummary({
    moves: [
      {
        moveNumber: 40,
        color: "w",
        san: "Kf4",
        fenBefore: "8/8/8/4k3/8/4K3/4P3/8 w - - 0 40",
        accuracy: 99,
        quality: "best",
        winPercentLoss: 0,
      },
      {
        moveNumber: 3,
        color: "w",
        san: "Nf3",
        fenBefore: START_FEN,
        accuracy: 55,
        quality: "inaccuracy",
        winPercentLoss: 5,
      },
      {
        moveNumber: 22,
        color: "w",
        san: "Re1",
        fenBefore: "r1bq1rk1/ppp2ppp/2n2n2/3pp3/3P4/2P1PN2/PP1NBPPP/R2Q1RK1 w - - 0 22",
        accuracy: 70,
        quality: "good",
        winPercentLoss: 2,
      },
    ],
  });

  assert.equal(summary.strongestPhase, "Endspiel");
  assert.match(summary.strongestPhaseDetail, /99 %/);
});

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

test("MultiPV-Eintrag bewahrt mindestens zwei bewertete Kandidatenlinien", () => {
  const entry = analysisEntryFromMultiPv([
    {
      fen: START_FEN,
      depth: 18,
      multipv: 1,
      whiteScore: { unit: "cp", value: 30 },
      pv: ["e2e4", "e7e5"],
    },
    {
      fen: START_FEN,
      depth: 18,
      multipv: 2,
      whiteScore: { unit: "cp", value: 24 },
      pv: ["d2d4", "d7d5"],
    },
  ]);

  assert.equal(entry.complete, true);
  assert.deepEqual(
    entry.candidateLines.map((line) => ({
      rank: line.rank,
      value: line.evaluation.value,
      first: line.pvUci[0],
    })),
    [
      { rank: 1, value: 30, first: "e2e4" },
      { rank: 2, value: 24, first: "d2d4" },
    ],
  );
});

test("Partiebericht speichert Kandidaten und eine eigene Fortsetzung des gespielten Zuges", () => {
  const game = new Chess();
  const root = new MoveTreeNode({ fen: game.fen() });
  const d4 = addMoveToTree(root, game.move("d4"), game.fen());
  const report = summarizeGameReview(
    [root, d4],
    [
      {
        whiteCp: 30,
        evaluation: { unit: "cp", value: 30, perspective: "white" },
        depth: 18,
        pv: ["e2e4", "e7e5"],
        candidateLines: [
          {
            rank: 1,
            whiteCp: 30,
            evaluation: { unit: "cp", value: 30, perspective: "white" },
            pvUci: ["e2e4", "e7e5"],
            pvSan: ["e4", "e5"],
          },
          {
            rank: 2,
            whiteCp: 24,
            evaluation: { unit: "cp", value: 24, perspective: "white" },
            pvUci: ["d2d4", "d7d5"],
            pvSan: ["d4", "d5"],
          },
        ],
      },
      {
        whiteCp: 24,
        evaluation: { unit: "cp", value: 24, perspective: "white" },
        depth: 18,
        pv: ["d7d5"],
        candidateLines: [{
          rank: 1,
          whiteCp: 24,
          evaluation: { unit: "cp", value: 24, perspective: "white" },
          pvUci: ["d7d5"],
          pvSan: ["d5"],
        }],
      },
    ],
    { depth: 18, final: true, learnerProfile: { rating: 1000 } },
  );

  assert.equal(report.version, 3);
  assert.equal(report.coachRating, 1000);
  assert.equal(report.moves[0].coachRating, 1000);
  assert.equal(report.moves[0].candidateLines.length, 2);
  assert.deepEqual(report.moves[0].playedLine.pvUci, ["d2d4", "d7d5"]);
  assert.equal(report.moves[0].playedLine.evaluation.perspective, "player");
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

test("Vorschlagsanzeige behält einen legalen PV-Präfix und verwirft nur den fehlerhaften Rest", () => {
  const partial = verifiedSuggestionInfo({
    fen: START_FEN,
    depth: 18,
    whiteScore: { unit: "cp", value: 24, pawns: 0.24 },
    pv: ["e2e4", "e7e5", "g1g3", "b8c6"],
  });
  assert.deepEqual(partial.pv, ["e2e4", "e7e5"]);
  assert.equal(partial.pvComplete, false);
  assert.equal(partial.rejectedPvTailLength, 2);

  const complete = verifiedSuggestionInfo({
    fen: START_FEN,
    pv: ["e2e4", "e7e5", "g1f3"],
  });
  assert.equal(complete.pvComplete, true);
  assert.equal(complete.rejectedPvTailLength, 0);
  assert.equal(
    verifiedSuggestionInfo({ fen: START_FEN, pv: ["e2e5", "e7e5"] }),
    null,
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

test("Gewinnwahrscheinlichkeit und Genauigkeit folgen den festgelegten Formeln", () => {
  assert.equal(winChance(0), 50);
  assert.ok(Math.abs(winChance(100) - 59.101) < 0.01);
  assert.equal(moveAccuracy(0), 100);
  assert.ok(Math.abs(moveAccuracy(10) - 63.61) < 0.1);
  assert.equal(moveAccuracy(10_000), 0);
});

test("alle Verlustschwellen werden einschließlich ihrer Grenze klassifiziert", () => {
  assert.equal(classifyWinChanceLoss(2), "excellent");
  assert.equal(classifyWinChanceLoss(2.01), "good");
  assert.equal(classifyWinChanceLoss(5), "good");
  assert.equal(classifyWinChanceLoss(5.01), "inaccuracy");
  assert.equal(classifyWinChanceLoss(10), "inaccuracy");
  assert.equal(classifyWinChanceLoss(10.01), "mistake");
  assert.equal(classifyWinChanceLoss(20), "mistake");
  assert.equal(classifyWinChanceLoss(20.01), "blunder");
});

test("Spezialkategorien beachten Priorität, Matt und den einzigen legalen Zug", () => {
  const base = {
    playedUci: "e2e4",
    bestMoveUci: "e2e4",
    winChanceBefore: 70,
    winChanceAfter: 70,
    secondBestWinChance: 50,
  };
  assert.equal(classifyMoveReview(base).classification, "best");
  assert.equal(classifyMoveReview({ ...base, isOnlyMove: true }).classification, "best");
  assert.equal(classifyMoveReview({ ...base, isBookMove: true }).classification, "book");
  assert.equal(classifyMoveReview({ ...base, isSacrifice: true }).classification, "brilliant");
  assert.equal(classifyMoveReview({
    playedUci: "a2a3",
    bestMoveUci: "e2e4",
    winChanceBefore: 100,
    winChanceAfter: 72,
    mateBefore: 3,
  }).classification, "blunder");
  const allowedMate = classifyMoveReview({
    playedUci: "a2a3",
    bestMoveUci: "e2e4",
    winChanceBefore: 45,
    winChanceAfter: 0,
    mateAfter: -2,
  });
  assert.equal(allowedMate.classification, "blunder");
  assert.equal(allowedMate.flags.allowedMate, true);
  assert.equal(classifyMoveReview({
    ...base,
    playedUci: "f6f7",
    bestMoveUci: "f6f7",
    isBookMove: true,
    isCheckmate: true,
  }).classification, "best");
  assert.equal(classifyMoveReview({
    ...base,
    playedUci: "g8f6",
    bestMoveUci: "d8e7",
    isBookMove: true,
    mateAfter: -1,
  }).classification, "blunder");
});

test("eine zugelassene Mattantwort wird konkret und nicht als bereits geschehen erklärt", () => {
  const explanation = explainMoveQuality({
    ply: 6,
    moveNumber: 3,
    color: "b",
    san: "Nf6",
    playedUci: "g8f6",
    fenBefore: "r1bqkbnr/pppp1ppp/2n5/4p2Q/2B1P3/8/PPPP1PPP/RNB1K1NR b KQkq - 3 3",
    fenAfter: "r1bqkb1r/pppp1ppp/2n2n2/4p2Q/2B1P3/8/PPPP1PPP/RNB1K1NR w KQkq - 4 4",
    lossCp: 900,
    quality: "blunder",
    classification: "blunder",
    bestUci: "d8e7",
    bestSan: "Qe7",
    playedContinuationUci: ["g8f6", "h5f7"],
    playedContinuationSan: ["Nf6", "Qxf7#"],
  });
  assert.match(explanation, /Weiß.*Qxf7#.*mattsetzen/);
  assert.doesNotMatch(explanation, /Das ist Matt|Partie ist vorbei/);
});

test("Lernübung lobt keinen Zug, der als Ungenauigkeit im Fokus steht", () => {
  const moves = [
    { moveNumber: 1, color: "w", san: "e4", quality: "best", accuracy: 100, winPercentLoss: 0 },
    { moveNumber: 2, color: "w", san: "Qh5", quality: "inaccuracy", accuracy: 80, winPercentLoss: 8 },
    { moveNumber: 3, color: "w", san: "Bc4", quality: "best", accuracy: 100, winPercentLoss: 0 },
    { moveNumber: 4, color: "w", san: "Qxf7#", quality: "best", accuracy: 100, winPercentLoss: 0 },
  ];
  const summary = buildLearningSummary({ moves, criticalMoments: [moves[1]], playerColor: "w" });
  assert.match(summary.exercise, /Finde selbst einen guten Zug/);
  assert.doesNotMatch(summary.exercise, /warum dein Zug dort gut funktioniert/);
});

test("Materialopfer-Heuristik verlangt eine legale bestätigte Investition", () => {
  assert.equal(detectMaterialSacrifice({
    fenBefore: "r3k3/p7/8/8/8/8/8/R3K3 w - - 0 1",
    playedUci: "a1a7",
    principalVariation: ["a1a7", "a8a7"],
    color: "w",
  }), true);
  assert.equal(detectMaterialSacrifice({
    fenBefore: "4k3/r7/8/8/8/8/8/R3K3 w - - 0 1",
    playedUci: "a1a7",
    principalVariation: ["a1a7"],
    color: "w",
  }), false);
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
  assert.equal(report.moves[0].explanation, "Du gibst etwas von deiner Stellung ab. Besser war d4.");
});

test("Partiebericht liefert das vollständige strukturierte Modell und getrennte Farbzähler", () => {
  const game = new Chess();
  const root = new MoveTreeNode({ fen: game.fen() });
  const e4 = addMoveToTree(root, game.move("e4"), game.fen());
  const e5 = addMoveToTree(e4, game.move("e5"), game.fen());
  const report = summarizeGameReview(
    [root, e4, e5],
    [
      { whiteCp: 20, evaluation: { unit: "cp", value: 20 }, pv: ["e2e4", "e7e5"] },
      { whiteCp: 20, evaluation: { unit: "cp", value: 20 }, pv: ["e7e5"] },
      { whiteCp: 20, evaluation: { unit: "cp", value: 20 }, pv: ["g1f3"] },
    ],
    { depth: 16, bookMovePlies: new Set([1]) },
  );
  const first = report.moves[0];
  assert.equal(first.classification, "book");
  assert.equal(first.symbol, "📖");
  assert.equal(first.uci, "e2e4");
  assert.equal(first.bestMoveUci, "e2e4");
  assert.deepEqual(first.principalVariation, ["e2e4", "e7e5"]);
  assert.equal(first.flags.isBookMove, true);
  assert.equal(first.accuracy, 100);
  assert.equal(report.whiteCounts.book, 1);
  assert.equal(report.blackCounts.best, 1);
  assert.equal(Object.keys(report.whiteCounts).length, 8);
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
  assert.equal(scoreToWhiteCp({ unit: "cp", value: 10_000 }), 10_000);
  assert.equal(scoreToWhiteCp({ pawns: 0.42 }), 42);
  assert.equal(terminalWhiteCp("7k/6Q1/6K1/8/8/8/8/8 b - - 0 1"), 10_000);
  assert.equal(reviewDepthForPlies(20, 18), 14);
  assert.equal(reviewDepthForPlies(120, 15), 10);
});

test("terminaler Zustand unterscheidet Matt, Patt und laufende Partie", () => {
  const mate = terminalPositionState("7k/6Q1/6K1/8/8/8/8/8 b - - 0 1");
  assert.equal(mate.status, "checkmate");
  assert.equal(mate.result, "1-0");
  assert.equal(mate.whiteCp, 10_000);
  assert.match(mate.reason, /matt/i);

  const stalemate = terminalPositionState("7k/5Q2/6K1/8/8/8/8/8 b - - 0 1");
  assert.equal(stalemate.status, "stalemate");
  assert.equal(stalemate.result, "1/2-1/2");
  assert.equal(stalemate.whiteCp, 0);
  assert.equal(stalemate.inCheck, false);
  assert.match(stalemate.reason, /patt.*kein legaler Zug.*kein Schach/i);

  assert.equal(terminalPositionState(START_FEN).status, "ongoing");
});

test("mehrzügige Varianten erhalten korrekte Zugnummern für Weiß und Schwarz", () => {
  assert.equal(
    formatPvWithMoveNumbers(START_FEN, ["e2e4", "e7e5", "g1f3", "b8c6"]),
    "1. e4 1... e5 2. Nf3 2... Nc6",
  );
  assert.equal(
    formatPvWithMoveNumbers(
      "8/8/8/8/8/8/8/K6k b - - 0 6",
      ["h1g1", "a1b1"],
    ),
    "6... Kg1 7. Kb1",
  );
});

test("jede Zugqualität erhält eine kurze Begründung", () => {
  assert.equal(
    explainMoveQuality({
      fenBefore: START_FEN,
      san: "e4",
      playedUci: "e2e4",
      bestUci: "e2e4",
      bestPvUci: ["e2e4"],
      quality: "best",
    }),
    "Das ist ein starker Zug. Du machst deine Stellung nicht schlechter.",
  );
  assert.equal(
    explainMoveQuality({
      fenBefore: AFTER_E4_E5_FEN,
      san: "Qh5",
      playedUci: "d1h5",
      bestUci: "g1f3",
      bestPvUci: ["g1f3"],
      quality: "mistake",
      lossCp: 200,
    }),
    "Das ist ein klarer Fehler und deine Stellung wird deutlich schlechter. Besser war Nf3.",
  );
  assert.equal(
    explainMoveQuality({ san: "Qh7+", quality: "excellent" }),
    "Dein Zug ist gut. Du gibst fast nichts ab.",
  );
});

test("800- und 1000-Elo-Texte vermeiden Engine-Jargon, höhere Stufen erhalten etwas mehr Detail", () => {
  const move = {
    fenBefore: START_FEN,
    san: "e4",
    playedUci: "e2e4",
    bestUci: "e2e4",
    bestPvUci: ["e2e4"],
    quality: "best",
  };
  const foundations = explainMoveQuality(move, { rating: 800 });
  const building = explainMoveQuality(move, { rating: 1000 });
  const club = explainMoveQuality(move, { rating: 1400 });
  const advanced = explainMoveQuality(move, { rating: 1800 });

  assert.doesNotMatch(foundations, /Stockfish|Engine|Bewertung|Gegenspiel|Hauptvariante/i);
  assert.doesNotMatch(building, /Stockfish|Engine|Bewertung|Gegenspiel|Hauptvariante/i);
  assert.match(advanced, /Bewertung/);
  assert.equal(new Set([foundations, building, club, advanced]).size, 4);
});

test("Zugbewertungen behaupten in ausgeglichenen oder schlechteren Stellungen keinen Vorteil", () => {
  const bestMove = {
    fenBefore: START_FEN,
    san: "e4",
    playedUci: "e2e4",
    bestUci: "e2e4",
    bestPvUci: ["e2e4"],
    quality: "best",
    beforeCp: -450,
    afterCp: -450,
    lossCp: 0,
  };
  const inaccurateMove = {
    ...bestMove,
    san: "a3",
    playedUci: "a2a3",
    bestUci: "e2e4",
    bestPvUci: ["e2e4"],
    quality: "inaccuracy",
    lossCp: 100,
  };

  [800, 1000, 1400, 1800].forEach((rating) => {
    const texts = [
      explainMoveQuality(bestMove, { rating }),
      explainMoveQuality(inaccurateMove, { rating }),
      describeMoveAssessment(bestMove, { rating }).reason,
      describeMoveAssessment(inaccurateMove, { rating }).reason,
    ];
    texts.forEach((text) => assert.doesNotMatch(text, /dein(?:em|en)? Vorteil|Vorteil ab/iu));
  });
});

test("sichtbare Schweregrade folgen dem Verlust und nicht einem widersprüchlichen Qualitätslabel", () => {
  const moveAt = (lossCp, quality) => ({
    fenBefore: START_FEN,
    san: "a3",
    playedUci: "a2a3",
    bestUci: "e2e4",
    bestPvUci: ["e2e4"],
    lossCp,
    quality,
  });

  const small = moveAt(90, "blunder");
  assert.doesNotMatch(explainMoveQuality(small), /grober Fehler|klarer Fehler/);
  assert.equal(describeMoveAssessment(small).lead, "Der Zug ist spielbar.");

  const clear = moveAt(140, "good");
  assert.match(explainMoveQuality(clear), /klarer Fehler/);
  assert.equal(describeMoveAssessment(clear).lead, "Das ist ein klarer Fehler.");

  const severe = moveAt(300, "good");
  assert.match(explainMoveQuality(severe), /grober Fehler/);
  assert.equal(describeMoveAssessment(severe).lead, "Das ist ein grober Fehler.");
});

test("ein belegter sofortiger Bauernverlust wird klar benannt", () => {
  const move = {
    fenBefore: "4k3/8/8/2b5/6n1/8/1N2PP2/4K3 w - - 0 1",
    san: "Na4",
    playedUci: "b2a4",
    bestUci: "e2e3",
    bestPvUci: ["e2e3"],
    playedContinuationUci: ["b2a4", "c5f2"],
    lossCp: 310,
    quality: "blunder",
  };

  assert.equal(
    explainMoveQuality(move, { rating: 800 }),
    "Nach Bxf2+ geht dein Bauer auf f2 verloren. Besser war e3.",
  );
  assert.equal(
    describeMoveAssessment(move, { rating: 800 }).reason,
    "Nach Bxf2+ geht dein Bauer auf f2 verloren.",
  );
});

test("beim En-passant-Schlag nennt der Rückblick das Feld des geschlagenen Bauern", () => {
  const move = {
    fenBefore: "4k3/8/8/8/4p3/8/3P4/4K3 w - - 0 1",
    san: "d4",
    playedUci: "d2d4",
    bestUci: "e1f1",
    bestPvUci: ["e1f1"],
    playedContinuationUci: ["d2d4", "e4d3"],
    lossCp: 310,
    quality: "blunder",
  };

  const explanation = explainMoveQuality(move, { rating: 800 });
  assert.match(explanation, /Bauer auf d4 verloren/);
  assert.doesNotMatch(explanation, /Bauer auf d3 verloren/);
});

test("ein normaler Abtausch wird nicht fälschlich als eingestellte Figur bezeichnet", () => {
  const move = {
    fenBefore: "4k3/8/8/8/6b1/5N2/6PP/4K3 w - - 0 1",
    san: "h3",
    playedUci: "h2h3",
    bestUci: "e1d2",
    bestPvUci: ["e1d2"],
    playedContinuationUci: ["h2h3", "g4f3"],
    lossCp: 300,
    quality: "blunder",
  };

  const explanation = explainMoveQuality(move, { rating: 800 });
  assert.match(explanation, /grober Fehler/);
  assert.doesNotMatch(explanation, /Figur ein|Springer.*verloren/);
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
  assert.equal(assessment.lead, "Stark gespielt.");
  assert.equal(assessment.alternative, "Genauso gut geht d4.");
  assert.doesNotMatch(assessment.lead, /beste[rn]? Zug/i);
  assert.equal(explanation, "d4 geht genauso gut.");
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
  assert.equal(report.moves[0].explanation, "d4 geht genauso gut.");
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
      reason: "Du machst deine Stellung damit nicht schlechter.",
      alternative: "",
    },
  );
  const mistake = describeMoveAssessment({
    fenBefore: AFTER_E4_E5_FEN,
    san: "Qh5",
    playedUci: "d1h5",
    bestUci: "g1f3",
    quality: "mistake",
    lossCp: 200,
    bestPvUci: ["g1f3", "b8c6"],
  });
  assert.equal(mistake.lead, "Das ist ein klarer Fehler.");
  assert.match(mistake.reason, /deutlich schlechter/);
  assert.equal(
    mistake.alternative,
    "Besser war Nf3.",
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
    "Der Zug erhöht den Einfluss im Zentrum.",
  );
  assert.match(
    groundedSuggestionReason({ rank: 1, san: "Qh7+", uci: "d3h7" }),
    /greift den König direkt an/,
  );
  assert.match(
    groundedSuggestionReason({ rank: 2, san: "Nf3", uci: "g1f3" }),
    /erste Vorschlag wurde besser bewertet/,
  );
});

test("Fallback-Coach fasst Verlauf, Stärke, wichtigsten Moment und Training einfach zusammen", () => {
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
  assert.match(feedback, /\*\*Kurz gesagt:\*\*/);
  assert.match(feedback, /\*\*Das war gut:\*\*/);
  assert.match(feedback, /\*\*Nächster Schritt:\*\*/);
  assert.doesNotMatch(feedback, /Stockfish|Engine|Hauptvariante|Bewertungseinbruch/i);
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
  assert.match(feedback, /0 große Fehler in 0 Zügen/);
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
        lossCp: 300,
        winPercentLoss: 25,
        explanation: "Die Dame gerät in Gefahr.",
      },
    ],
    moves: [
      { moveNumber: 1, color: "w", san: "e4", accuracy: 96, quality: "excellent", winPercentLoss: 1, explanation: "Besetzt das Zentrum." },
      { moveNumber: 2, color: "w", san: "Qh5", accuracy: 41, quality: "mistake", lossCp: 180, winPercentLoss: 18, explanation: "Übersieht eine direkte Antwort." },
      { moveNumber: 3, color: "w", san: "Qxf7+", accuracy: 35, quality: "blunder", lossCp: 300, winPercentLoss: 25, explanation: "Die Dame gerät in Gefahr." },
      { moveNumber: 4, color: "w", san: "Nf3", accuracy: 91, quality: "excellent", winPercentLoss: 2, explanation: "Entwickelt eine Figur." },
    ],
  });

  assert.ok(["Eröffnung", "Mittelspiel", "Endspiel"].includes(summary.strongestPhase));
  assert.match(summary.biggestLesson, /Qxf7\+/);
  assert.match(summary.recurringPattern, /Bei 2 Zügen wurde deine Stellung deutlich schlechter/);
  assert.match(summary.learningGoal, /Antwort des Gegners/);
  assert.match(summary.exercise, /3\. Qxf7\+/);
  assert.doesNotMatch(summary.exercise, /Nf3/);
  assert.match(summary.exercise, /zwei mögliche Züge/);
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
      { moveNumber: 2, color: "w", san: "Nf3", bestSan: "Bc4", quality: "mistake", lossCp: 180, winPercentLoss: 12, explanation: "Verliert etwas Initiative." },
    ],
    moves: [
      { moveNumber: 1, color: "w", san: "e4", accuracy: 98, quality: "excellent", winPercentLoss: 1, explanation: "Stabil." },
      { moveNumber: 1, color: "b", san: "e5", accuracy: 10, quality: "blunder", lossCp: 300, winPercentLoss: 35, explanation: "Großer Einbruch." },
      { moveNumber: 2, color: "w", san: "Nf3", accuracy: 65, quality: "mistake", lossCp: 180, winPercentLoss: 12, explanation: "Verliert etwas Initiative." },
      { moveNumber: 2, color: "b", san: "Nc6", accuracy: 20, quality: "blunder", lossCp: 300, winPercentLoss: 30, explanation: "Noch ein Einbruch." },
    ],
  };

  const summary = buildLearningSummary(report);
  const feedback = buildFallbackFeedback(report);

  assert.match(summary.biggestLesson, /Nf3/);
  assert.doesNotMatch(summary.biggestLesson, /e5|Nc6/);
  assert.doesNotMatch(summary.recurringPattern, /2 deutliche/);
  assert.match(feedback, /81\.0 %/);
  assert.match(feedback, /einen großen Fehler in 2 Zügen/);
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
  assert.equal(summary.biggestLessonTitle, "Das hat gut funktioniert");
});

test("Fallback erfindet ohne belegten guten Zug keine gute Entscheidung", () => {
  const feedback = buildFallbackFeedback({
    playerColor: "w",
    whiteAccuracy: 35,
    analyzedMoves: 1,
    criticalMoments: [],
    moves: [{
      moveNumber: 1,
      color: "w",
      san: "a3",
      quality: "mistake",
      accuracy: 35,
    }],
  });

  assert.doesNotMatch(feedback, /Wähle einen deiner guten Züge/);
  assert.match(feedback, /1\. a3/);
  assert.match(feedback, /Antwort des Gegners/);
});

test("Lernzusammenfassung behauptet bei fehlenden Daten kein präzises Muster", () => {
  const summary = buildLearningSummary({ moves: [] });
  assert.equal(summary.confidence, "low");
  assert.match(summary.strongestPhase, /nicht zuverlässig/);
  assert.match(summary.recurringPattern, /mehr bewerteten Zügen/i);
});
