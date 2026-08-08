import test from "node:test";
import assert from "node:assert/strict";
import { CURATED_TRAINING_EXERCISES, validateCuratedExerciseSet } from "../trainingExercises.js";
import { createTrainingExerciseFromAnalysis } from "../trainingExerciseAdapter.js";
import {
  completeTrainingExercise,
  createTrainingProgress,
  loadTrainingProgress,
  saveTrainingProgress,
  trainingStorageKey,
} from "../trainingProgress.js";
import { getTrainingQueue } from "../trainingQueue.js";
import {
  createExerciseAttempt,
  recordTrainingMove,
  revealNextHint,
  sessionSummary,
} from "../trainingSession.js";
import { buildConceptStats, buildTrainingStats } from "../trainingStats.js";
import {
  reviewIntervalMs,
  scheduleTrainingReview,
  scoreTrainingResult,
} from "../spacedRepetition.js";
import {
  parseTrainingExercise,
  validateTrainingExercise,
  validateTrainingMove,
} from "../trainingValidation.js";

const DAY = 24 * 60 * 60 * 1_000;

function exercise(overrides = {}) {
  return {
    id: "test-exercise",
    fen: "4k3/5q2/8/5N2/8/8/8/K7 w - - 0 1",
    sideToMove: "white",
    type: "best_move",
    category: "tactical",
    solution: {
      bestMoveUci: "f5d6",
      acceptableMoves: ["f5d6"],
      continuation: ["e8f8", "d6f7"],
    },
    concepts: ["tactics.fork"],
    primaryConcept: "tactics.fork",
    difficulty: "beginner",
    explanation: {
      short: "Springergabel.",
      detailed: "Nd6+ greift König und Dame an.",
      takeaway: "Suche Schachs mit einem zweiten Ziel.",
    },
    hints: ["Suche ein Schach.", "Nutze den Springer.", "Springe nach d6."],
    source: { type: "curated", gameId: null, ply: null },
    metadata: {},
    ...overrides,
  };
}

function memoryStorage() {
  const values = new Map();
  return {
    getItem(key) { return values.get(key) || null; },
    setItem(key, value) { values.set(key, value); },
  };
}

test("gültige Trainingsaufgaben werden normalisiert und SAN wird deterministisch erzeugt", () => {
  const parsed = parseTrainingExercise(exercise());
  assert.equal(parsed.solution.bestMoveSan, "Nd6+");
  assert.deepEqual(parsed.solution.continuationSan, ["Kf8", "Nxf7"]);
  assert.equal(parsed.sideToMove, "white");
});

test("ungültige FEN und widersprüchliche Zugfarbe werden abgelehnt", () => {
  const invalidFen = validateTrainingExercise(exercise({ fen: "keine fen" }));
  assert.equal(invalidFen.valid, false);
  assert.match(invalidFen.errors.join(" "), /gültige FEN/);

  const wrongSide = validateTrainingExercise(exercise({ sideToMove: "black" }));
  assert.equal(wrongSide.valid, false);
  assert.match(wrongSide.errors.join(" "), /widerspricht der FEN/);
});

test("richtige, falsche und illegale Züge werden über chess.js unterschieden", () => {
  const parsed = parseTrainingExercise(exercise());
  assert.deepEqual(
    { legal: validateTrainingMove(parsed, "f5d6").legal, correct: validateTrainingMove(parsed, "f5d6").correct },
    { legal: true, correct: true },
  );
  assert.deepEqual(
    { legal: validateTrainingMove(parsed, "f5h6").legal, correct: validateTrainingMove(parsed, "f5h6").correct },
    { legal: true, correct: false },
  );
  assert.equal(validateTrainingMove(parsed, "f5f6").reason, "illegal_move");
});

test("mehrere praktisch gleichwertige Lösungszüge werden akzeptiert", () => {
  const parsed = parseTrainingExercise(exercise({
    solution: {
      bestMoveUci: "f5d6",
      acceptableMoves: ["f5d6", "f5h6"],
      continuation: [],
    },
  }));
  assert.equal(validateTrainingMove(parsed, "f5h6").correct, true);
});

test("Umwandlung und Rochade werden als vollständige UCI-Züge geprüft", () => {
  const promotion = parseTrainingExercise(exercise({
    id: "promotion",
    fen: "7k/P7/8/8/8/8/8/K7 w - - 0 1",
    solution: { bestMoveUci: "a7a8q", acceptableMoves: ["a7a8q"], continuation: [] },
    concepts: ["pawns.passed-pawn"],
    primaryConcept: "pawns.passed-pawn",
    category: "endgame",
  }));
  assert.equal(validateTrainingMove(promotion, "a7a8q").correct, true);
  assert.equal(validateTrainingMove(promotion, "a7a8").legal, false);

  const castling = parseTrainingExercise(exercise({
    id: "castling",
    fen: "r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1",
    solution: { bestMoveUci: "e1g1", acceptableMoves: ["e1g1"], continuation: [] },
    concepts: ["opening.castling"],
    primaryConcept: "opening.castling",
    category: "positional",
  }));
  const result = validateTrainingMove(castling, "e1g1");
  assert.equal(result.correct, true);
  assert.equal(result.move.san, "O-O");
});

test("progressive Hinweise stoppen am letzten Level", () => {
  const parsed = parseTrainingExercise(exercise());
  let attempt = createExerciseAttempt(parsed, new Date("2026-08-07T10:00:00Z"));
  attempt = revealNextHint(attempt, parsed);
  attempt = revealNextHint(attempt, parsed);
  attempt = revealNextHint(attempt, parsed);
  attempt = revealNextHint(attempt, parsed);
  assert.equal(attempt.hintLevel, 3);
  assert.equal(attempt.hintsUsed, 3);
});

test("Versuche speichern die Zugfolge und den Erstversuch korrekt", () => {
  const parsed = parseTrainingExercise(exercise());
  let attempt = createExerciseAttempt(parsed, new Date("2026-08-07T10:00:00Z"));
  attempt = recordTrainingMove(attempt, validateTrainingMove(parsed, "f5h6"));
  attempt = recordTrainingMove(attempt, validateTrainingMove(parsed, "f5d6"));
  assert.equal(attempt.attempts, 2);
  assert.equal(attempt.solved, true);
  assert.deepEqual(attempt.moves.map((move) => move.correct), [false, true]);
});

test("Qualität unterscheidet Erstlösung, Hilfen und Fehlschlag", () => {
  assert.equal(scoreTrainingResult({ solved: true, attempts: 1, hintsUsed: 0, timeSpentSeconds: 20 }), 5);
  assert.equal(scoreTrainingResult({ solved: true, attempts: 2, hintsUsed: 1, timeSpentSeconds: 20 }), 3);
  assert.equal(scoreTrainingResult({ solved: true, attempts: 1, hintsUsed: 0, solutionShown: true }), 1);
  assert.equal(scoreTrainingResult({ solved: false, attempts: 3, hintsUsed: 2 }), 0);
});

test("Wiederholungsintervalle sind deterministisch und wachsen mit Erfolg", () => {
  assert.equal(reviewIntervalMs(0, 0), 10 * 60 * 1_000);
  assert.equal(reviewIntervalMs(2, 1), DAY);
  assert.equal(reviewIntervalMs(5, 1), 7 * DAY);
  assert.equal(reviewIntervalMs(5, 3), 28 * DAY);
});

test("Fehlschläge werden bald und gute Lösungen später angesetzt", () => {
  const now = new Date("2026-08-07T10:00:00Z");
  const failed = scheduleTrainingReview(null, { exerciseId: "x", solved: false, quality: 0 }, now);
  const successful = scheduleTrainingReview(null, { exerciseId: "x", solved: true, quality: 5 }, now);
  assert.equal(Date.parse(failed.nextReviewAt) - now.getTime(), 10 * 60 * 1_000);
  assert.equal(Date.parse(successful.nextReviewAt) - now.getTime(), 7 * DAY);
  assert.equal(successful.successStreak, 1);
});

test("Abschluss speichert Ergebnis, Quellenmetadaten und nächsten Termin", () => {
  const parsed = parseTrainingExercise(exercise());
  const base = createTrainingProgress("paul@example.com", "2026-08-07T09:00:00Z");
  const completion = completeTrainingExercise(base, parsed, {
    startedAt: "2026-08-07T09:59:30Z",
    solved: true,
    attempts: 1,
    hintsUsed: 0,
    timeSpentSeconds: 30,
    solutionShown: false,
  }, new Date("2026-08-07T10:00:00Z"));
  assert.equal(completion.result.firstMoveCorrect, true);
  assert.equal(completion.result.source.type, "curated");
  assert.equal(completion.result.concepts[0], "tactics.fork");
  assert.ok(completion.result.nextReviewAt);
});

test("Trainingsfortschritt bleibt pro Identität gespeichert", () => {
  const storage = memoryStorage();
  const key = trainingStorageKey({ email: "Paul@example.com" });
  const progress = createTrainingProgress("paul@example.com", "2026-08-07T10:00:00Z");
  assert.match(key, /paul%40example\.com/);
  assert.equal(saveTrainingProgress(storage, key, progress), true);
  assert.equal(loadTrainingProgress(storage, key).userId, "paul@example.com");
});

test("fällige Aufgaben stehen in der Queue vor neuen Aufgaben", () => {
  const [due, fresh, later] = CURATED_TRAINING_EXERCISES.slice(0, 3);
  const progress = createTrainingProgress();
  progress.schedule[due.id] = {
    exerciseId: due.id,
    nextReviewAt: "2026-08-06T10:00:00Z",
    lastSolved: true,
  };
  progress.schedule[later.id] = {
    exerciseId: later.id,
    nextReviewAt: "2026-08-20T10:00:00Z",
    lastSolved: true,
  };
  const queue = getTrainingQueue({
    exercises: [fresh, later, due],
    progress,
    limit: 5,
    now: new Date("2026-08-07T10:00:00Z"),
  });
  assert.equal(queue[0].id, due.id);
  assert.equal(queue[1].id, fresh.id);
});

test("zuletzt fehlgeschlagene und schwache Konzepte werden priorisiert", () => {
  const [fork, pin, loose] = [
    CURATED_TRAINING_EXERCISES.find((item) => item.primaryConcept === "tactics.fork"),
    CURATED_TRAINING_EXERCISES.find((item) => item.primaryConcept === "tactics.pin"),
    CURATED_TRAINING_EXERCISES.find((item) => item.primaryConcept === "tactics.loose-piece"),
  ];
  const progress = createTrainingProgress();
  progress.schedule[pin.id] = {
    exerciseId: pin.id,
    nextReviewAt: "2026-09-01T00:00:00Z",
    lastSolved: false,
  };
  progress.results = [{
    exerciseId: fork.id,
    solved: false,
    firstMoveCorrect: false,
    hintsUsed: 2,
    concepts: ["tactics.fork"],
    completedAt: "2026-08-06T10:00:00Z",
  }];
  const queue = getTrainingQueue({
    exercises: [loose, fork, pin],
    progress,
    limit: 5,
    now: new Date("2026-08-07T10:00:00Z"),
  });
  assert.equal(queue[0].id, pin.id);
  assert.equal(queue[1].id, fork.id);
});

test("Queue-Filter unterstützen Konzept, Schwierigkeit, Quelle und fällige Reviews", () => {
  const progress = createTrainingProgress();
  const fork = CURATED_TRAINING_EXERCISES.find((item) => item.primaryConcept === "tactics.fork");
  progress.schedule[fork.id] = { nextReviewAt: "2026-08-06T00:00:00Z", lastSolved: true };
  const queue = getTrainingQueue({
    exercises: CURATED_TRAINING_EXERCISES,
    progress,
    limit: 20,
    filters: { concept: "tactics.fork", source: "curated", dueOnly: true },
    now: new Date("2026-08-07T00:00:00Z"),
  });
  assert.deepEqual(queue.map((item) => item.id), [fork.id]);
});

test("Konzeptstatistik berechnet Erstversuchsquote und Hinweisniveau", () => {
  const stats = buildConceptStats([
    { concepts: ["tactics.fork"], solved: true, firstMoveCorrect: true, hintsUsed: 0 },
    { concepts: ["tactics.fork"], solved: true, firstMoveCorrect: false, hintsUsed: 2 },
  ]);
  assert.equal(stats[0].attempts, 2);
  assert.equal(stats[0].accuracy, 0.5);
  assert.equal(stats[0].averageHints, 1);
});

test("Gesamtstatistik enthält heutige Lösungen, Serie und schwächste Motive", () => {
  const progress = createTrainingProgress();
  progress.results = [
    { completedAt: "2026-08-07T10:00:00Z", solved: true, firstMoveCorrect: true, hintsUsed: 0, concepts: ["tactics.fork"] },
    { completedAt: "2026-08-06T10:00:00Z", solved: false, firstMoveCorrect: false, hintsUsed: 2, concepts: ["tactics.pin"] },
  ];
  const stats = buildTrainingStats(progress, new Date("2026-08-07T12:00:00Z"));
  assert.equal(stats.solvedToday, 1);
  assert.equal(stats.currentStreak, 2);
  assert.equal(stats.weakest[0].conceptId, "tactics.pin");
});

test("Session-Zusammenfassung trennt sofort, mit Hilfe und ungelöst", () => {
  const summary = sessionSummary([
    { solved: true, firstMoveCorrect: true },
    { solved: true, firstMoveCorrect: false },
    { solved: false, firstMoveCorrect: false },
  ]);
  assert.deepEqual(summary, {
    total: 3,
    solvedFirstTry: 1,
    solvedWithHelp: 1,
    failed: 1,
    accuracy: 1 / 3,
  });
});

test("Analyseadapter übernimmt zukünftige User-Game-Metadaten ohne neues Schema", () => {
  const adapted = createTrainingExerciseFromAnalysis({
    ...exercise(),
    id: "from-game",
    gameId: "game-42",
    ply: 37,
    playedMove: "Nxh6",
    evalBefore: 0.3,
    evalAfter: -2.4,
    bestMoveUci: "f5d6",
    acceptableMoves: ["f5d6"],
    continuation: ["e8f8", "d6f7"],
  });
  assert.equal(adapted.source.type, "user_game");
  assert.equal(adapted.source.gameId, "game-42");
  assert.equal(adapted.source.ply, 37);
  assert.equal(adapted.metadata.generation.requiresStockfishValidation, true);
});

test("widersprüchliche Stockfish-Metadaten markieren die Aufgabe als ungültig", () => {
  const validation = validateTrainingExercise(exercise({
    metadata: { validation: { stockfishBestMoves: ["f5h4"] } },
  }));
  assert.equal(validation.valid, false);
  assert.match(validation.errors.join(" "), /Stockfish-Prüfung/);
});

test("alle 27 kuratierten MVP-Aufgaben bestehen die automatische Validierung", () => {
  const validation = validateCuratedExerciseSet();
  assert.equal(validation.valid, true, validation.errors.join("\n"));
  assert.equal(validation.count, 27);
  assert.ok(CURATED_TRAINING_EXERCISES.every((item) => item.solution.bestMoveSan));
});
