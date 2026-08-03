import assert from "node:assert/strict";
import test from "node:test";
import {
  ENGINE_CONTEXT_MISSING_REPLY,
  allowedEngineMoveTokens,
  findUnsupportedBoardClaims,
  findUnsupportedEvaluationTokens,
  findUnsupportedMoveTokens,
  hasUsableEngineContext,
  normalizeEngineContext,
} from "../coachEngineContext.js";

const AFTER_E4_E5_FEN =
  "rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2";

const context = {
  source: "stockfish",
  kind: "position",
  fen: AFTER_E4_E5_FEN,
  depth: 18,
  evaluation: { unit: "cp", value: 32 },
  bestMove: { uci: "g1f3", san: "Nf3" },
  primaryVariation: {
    uci: ["g1f3", "b8c6", "f1b5"],
    san: ["Nf3", "Nc6", "Bb5"],
  },
  lines: [{
    rank: 1,
    depth: 18,
    evaluation: { unit: "cp", value: 32 },
    bestMove: { uci: "g1f3", san: "Nf3" },
    pv: {
      uci: ["g1f3", "b8c6", "f1b5"],
      san: ["Nf3", "Nc6", "Bb5"],
    },
  }],
};

test("Engine-Kontext bewahrt Quelle, Tiefe, Bewertung, besten Zug und vollständige PV", () => {
  const normalized = normalizeEngineContext(context);
  assert.equal(normalized.source, "stockfish");
  assert.equal(normalized.depth, 18);
  assert.deepEqual(normalized.evaluation, { unit: "cp", value: 32, perspective: "white" });
  assert.equal(normalized.bestMove.uci, "g1f3");
  assert.deepEqual(normalized.primaryVariation.san, ["Nf3", "Nc6", "Bb5"]);
  assert.equal(hasUsableEngineContext(normalized), true);
});

test("Coach-Zugwächter akzeptiert nur Stockfish-PV und deutsche Figurenkürzel", () => {
  const allowed = allowedEngineMoveTokens(context);
  assert.equal(allowed.has("Nf3"), true);
  assert.equal(allowed.has("Sf3"), true);
  assert.deepEqual(
    findUnsupportedMoveTokens("Stockfish bevorzugt Sf3, danach folgen Sc6 und Lb5.", context),
    [],
  );
  assert.deepEqual(
    findUnsupportedMoveTokens("Ich würde stattdessen d4 und später Qh5 spielen.", context),
    ["d4", "Qh5"],
  );
  assert.deepEqual(
    findUnsupportedMoveTokens("Die Folge wäre Sf3 Lb5 Sc6.", context),
    ["Sf3 Lb5 Sc6"],
  );
  assert.deepEqual(
    findUnsupportedMoveTokens("Danach folgt 0-0-0.", context),
    ["0-0-0"],
  );
  assert.deepEqual(
    findUnsupportedMoveTokens(
      "Der Springer auf f3 kontrolliert d4 und greift den Bauern e5 an.",
      context,
    ),
    [],
  );
  assert.deepEqual(
    findUnsupportedMoveTokens("Der Zug kontrolliert zusätzlich d5.", context),
    [],
  );
  assert.deepEqual(
    findUnsupportedMoveTokens(
      "Nach Nf3 kontrolliert der Springer **d4** und **e5**.",
      context,
    ),
    [],
  );
  assert.deepEqual(
    findUnsupportedMoveTokens(
      "Nach Nf3 greift der Springer den e5-Bauern an.",
      context,
    ),
    [],
  );
  assert.deepEqual(
    findUnsupportedMoveTokens(
      "Der Bauer greift die Bauern auf a4 und c4 an.",
      context,
    ),
    [],
  );
  assert.match(ENGINE_CONTEXT_MISSING_REPLY, /keinen konkreten Zug/);
  assert.doesNotMatch(ENGINE_CONTEXT_MISSING_REPLY, /Stockfish|Engine|PV|Centipawn/i);
});

test("mehrere Eröffnungsoptionen dürfen ohne Engine-Rangliste genannt werden", () => {
  const openingContext = {
    matched: true,
    continuations: [
      { uci: "g1f3", san: "Nf3" },
      { uci: "f1c4", san: "Bc4" },
    ],
  };
  assert.deepEqual(
    findUnsupportedMoveTokens("Du kannst Nf3 oder Bc4 spielen.", null, openingContext),
    [],
  );
  assert.deepEqual(
    findUnsupportedMoveTokens("Du kannst Nf3 oder d4 spielen.", null, openingContext),
    ["d4"],
  );
});

test("die übliche Null-Schreibweise der Rochade ist nur bei legal gelieferter Rochade erlaubt", () => {
  const castlingContext = {
    source: "stockfish",
    kind: "position",
    fen: "r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1",
    depth: 18,
    evaluation: { unit: "cp", value: 0 },
    bestMove: { uci: "e1g1", san: "O-O" },
    primaryVariation: {
      uci: ["e1g1", "e8c8"],
      san: ["O-O", "O-O-O"],
    },
    lines: [],
  };
  assert.deepEqual(
    findUnsupportedMoveTokens("0-0 0-0-0", castlingContext),
    [],
  );
});

test("Unvollständige oder fremde Analysedaten gelten nicht als Engine-Wahrheit", () => {
  assert.equal(hasUsableEngineContext({ source: "coach", kind: "position" }), false);
  assert.equal(hasUsableEngineContext({
    source: "stockfish",
    kind: "position",
    depth: 18,
    evaluation: { unit: "cp", value: 10 },
    primaryVariation: { uci: [], san: [] },
  }), false);
  assert.equal(hasUsableEngineContext({
    ...context,
    bestMove: { uci: "d2d4", san: "d4" },
  }), false);
});

test("MultiPV hält Linie 1 als Präferenz und bewahrt Mattinformationen", () => {
  const mateContext = normalizeEngineContext({
    source: "stockfish",
    kind: "position",
    fen: "6k1/5p2/8/7Q/8/8/8/K7 w - - 0 1",
    depth: 22,
    evaluation: { unit: "mate", value: 3 },
    lines: [
      {
        rank: 2,
        depth: 22,
        evaluation: { unit: "cp", value: 740 },
        pv: { uci: ["h5f7"], san: ["Qxf7+"] },
      },
      {
        rank: 1,
        depth: 22,
        evaluation: { unit: "mate", value: 3 },
        pv: {
          uci: ["h5h7", "g8f8", "h7h8"],
          san: ["Qh7+", "Kf8", "Qh8+"],
        },
      },
    ],
  });

  assert.equal(mateContext.lines[0].rank, 1);
  assert.deepEqual(mateContext.evaluation, {
    unit: "mate",
    value: 3,
    perspective: "white",
  });
  assert.equal(mateContext.bestMove.san, "Qh7+");
  assert.deepEqual(
    findUnsupportedMoveTokens(
      "Stockfish bevorzugt Qh7+ und zeigt danach Kf8 sowie Qh8+.",
      mateContext,
    ),
    [],
  );
  assert.deepEqual(
    findUnsupportedMoveTokens("Die Engine empfiehlt stattdessen Qxf7+ Kh8.", mateContext),
    ["Kh8"],
  );
});

test("Zugreview transportiert Spielerzug, Vorher/Nachher-Wert und Klassifizierung", () => {
  const moveReview = normalizeEngineContext({
    source: "stockfish",
    kind: "move_review",
    fen: AFTER_E4_E5_FEN,
    moveReview: {
      playedMove: { uci: "d1h5", san: "Qh5" },
      bestMove: { uci: "g1f3", san: "Nf3" },
      depth: 17,
      evaluationBefore: { unit: "cp", value: 25 },
      evaluationAfter: { unit: "cp", value: -135 },
      evaluationDeltaCp: -160,
      classification: "Fehler",
      pv: {
        uci: ["g1f3", "b8c6"],
        san: ["Nf3", "Nc6"],
      },
    },
  });

  assert.equal(hasUsableEngineContext(moveReview), true);
  assert.equal(moveReview.moveReview.playedMove.san, "Qh5");
  assert.equal(moveReview.moveReview.evaluationBefore.value, 25);
  assert.equal(moveReview.moveReview.evaluationAfter.value, -135);
  assert.equal(moveReview.moveReview.evaluationDeltaCp, -160);
  assert.equal(moveReview.moveReview.classification, "Fehler");
});

test("Engine-Kontext verwirft illegale Züge und die gesamte fehlerhafte PV", () => {
  assert.equal(normalizeEngineContext({
    ...context,
    bestMove: { uci: "e2e5", san: "e5" },
    primaryVariation: { uci: ["e2e5"], san: ["e5"] },
    lines: [],
  })?.bestMove, null);

  const normalized = normalizeEngineContext({
    ...context,
    bestMove: { uci: "g1f3", san: "absichtlich falsch" },
    primaryVariation: {
      uci: ["g1f3", "b8c6", "g1g3"],
      san: ["falsch", "falsch", "falsch"],
    },
    lines: [],
  });
  assert.deepEqual(normalized.primaryVariation, {
    uci: [],
    san: [],
  });
  assert.deepEqual(normalized.bestMove, { uci: "g1f3", san: "Nf3" });
  assert.equal(hasUsableEngineContext(normalized), false);
});

test("auch MultiPV- und Zugreview-Linien mit illegalem Rest sind unbrauchbar", () => {
  const malformedLine = normalizeEngineContext({
    ...context,
    primaryVariation: { uci: [], san: [] },
    lines: [{
      rank: 1,
      depth: 18,
      evaluation: { unit: "cp", value: 32 },
      bestMove: { uci: "g1f3", san: "Nf3" },
      pv: {
        uci: ["g1f3", "b8c6", "g1g3"],
        san: ["Nf3", "Nc6", "Ng3"],
      },
    }],
  });
  assert.deepEqual(malformedLine.lines, []);
  assert.deepEqual(malformedLine.primaryVariation, { uci: [], san: [] });
  assert.equal(hasUsableEngineContext(malformedLine), false);

  const malformedReview = normalizeEngineContext({
    source: "stockfish",
    kind: "move_review",
    fen: AFTER_E4_E5_FEN,
    moveReview: {
      playedMove: { uci: "d1h5", san: "Qh5" },
      bestMove: { uci: "g1f3", san: "Nf3" },
      evaluationBefore: { unit: "cp", value: 25 },
      evaluationAfter: { unit: "cp", value: -135 },
      classification: "Fehler",
      pv: {
        uci: ["g1f3", "b8c6", "g1g3"],
        san: ["Nf3", "Nc6", "Ng3"],
      },
    },
  });
  assert.deepEqual(malformedReview.moveReview.pv, { uci: [], san: [] });
  assert.equal(hasUsableEngineContext(malformedReview), false);
});

test("Zugreview stuft einen bewertungsgleichen anderen Zug nie als besten Zug ein", () => {
  const differentMove = normalizeEngineContext({
    source: "stockfish",
    kind: "move_review",
    fen: AFTER_E4_E5_FEN,
    moveReview: {
      playedMove: { uci: "d1h5", san: "Qh5" },
      bestMove: { uci: "g1f3", san: "Nf3" },
      evaluationBefore: { unit: "cp", value: 25 },
      evaluationAfter: { unit: "cp", value: 25 },
      classification: "Bester Zug",
      quality: "best",
      accuracy: 100,
      lossCp: 0,
      pv: {
        uci: ["g1f3", "b8c6"],
        san: ["Nf3", "Nc6"],
      },
    },
  });
  assert.equal(differentMove.moveReview.quality, "excellent");
  assert.equal(differentMove.moveReview.classification, "Sehr gut");
  assert.equal(hasUsableEngineContext(differentMove), true);

  const actualBest = normalizeEngineContext({
    source: "stockfish",
    kind: "move_review",
    fen: AFTER_E4_E5_FEN,
    moveReview: {
      playedMove: { uci: "g1f3", san: "Nf3" },
      bestMove: { uci: "g1f3", san: "Nf3" },
      evaluationBefore: { unit: "cp", value: 25 },
      evaluationAfter: { unit: "cp", value: 25 },
      classification: "Bester Zug",
      quality: "best",
      accuracy: 100,
      lossCp: 0,
      pv: {
        uci: ["g1f3", "b8c6"],
        san: ["Nf3", "Nc6"],
      },
    },
  });
  assert.equal(actualBest.moveReview.quality, "best");
  assert.equal(actualBest.moveReview.classification, "Bester Zug");
});

test("Bewertungswächter übernimmt nur tatsächlich gelieferte Centipawn- und Mattwerte", () => {
  assert.deepEqual(
    findUnsupportedEvaluationTokens("Stockfish bewertet die Stellung mit +0,32.", context),
    [],
  );
  assert.deepEqual(
    findUnsupportedEvaluationTokens("Die Bewertung beträgt plötzlich +1,80.", context),
    ["+1,80"],
  );
  assert.deepEqual(
    findUnsupportedEvaluationTokens("Weiß hat angeblich 0,75 Bauern Vorteil.", context),
    ["0,75"],
  );
  assert.deepEqual(
    findUnsupportedEvaluationTokens("Der belegte Vorteil beträgt 0,32 Bauern.", context),
    [],
  );
  assert.deepEqual(
    findUnsupportedEvaluationTokens("Der Springer greift den Bauern e5 an.", context),
    [],
  );
  const mateContext = {
    ...context,
    evaluation: { unit: "mate", value: -4 },
    lines: [{
      ...context.lines[0],
      evaluation: { unit: "mate", value: -4 },
    }],
  };
  assert.deepEqual(
    findUnsupportedEvaluationTokens("Stockfish zeigt Matt in 4.", mateContext),
    [],
  );
});

test("Brettwächter prüft konkrete Angriffe und ungedeckte Figuren entlang legaler Linien", () => {
  assert.deepEqual(
    findUnsupportedBoardClaims(
      "Nach Nf3 greift der Springer auf f3 den Bauern auf e5 an.",
      context,
    ),
    [],
  );
  assert.deepEqual(
    findUnsupportedBoardClaims(
      "Nach Nf3 greift der Springer den Bauern auf e5 an.",
      context,
    ),
    [],
  );
  assert.deepEqual(
    findUnsupportedBoardClaims(
      "Der Springer auf f3 greift den Bauern auf e5 an.",
      context,
    ),
    ["Der Springer auf f3 greift den Bauern auf e5 an"],
  );
  assert.deepEqual(
    findUnsupportedBoardClaims(
      "Der Springer auf g1 greift die Dame auf d8 an.",
      context,
    ),
    ["Der Springer auf g1 greift die Dame auf d8 an"],
  );
  assert.deepEqual(
    findUnsupportedBoardClaims(
      "Deine Dame auf d1 ist jetzt ungedeckt.",
      context,
    ),
    ["Deine Dame auf d1 ist jetzt ungedeckt"],
  );
  [
    "Der Springer g1 greift die Dame d8 an.",
    "Von g1 aus greift der Springer die Dame auf d8 an.",
    "Dein Springer greift von g1 aus die Dame auf d8 an.",
    "Auf g1 greift dein Springer die Dame auf d8 an.",
    "Der Springer greift die Dame auf d8 an.",
    "Die Dame d1 ist ungedeckt.",
    "Auf d1 steht deine Dame ungedeckt.",
    "Deine Dame steht auf d1 ungedeckt.",
  ].forEach((claim) => {
    assert.equal(findUnsupportedBoardClaims(claim, context).length, 1, claim);
  });
});

test("Brettwächter verwirft unbelegte Material-, Taktik- und Zukunftsbehauptungen", () => {
  [
    "Die schwarze Dame ist weg.",
    "Du hast einen Springer weniger.",
    "Das ist eine Gabel: Dein Springer greift Dame und Turm gleichzeitig an.",
    "Nf3 macht einen Doppelangriff.",
    "Der Springer auf c6 ist gefesselt.",
    "Nach Nf3 ist die Dame weg.",
    "Später hängt die Dame.",
    "Die Dame wurde vom Brett genommen.",
    "Du liegst einen Springer hinten.",
    "Der Springer greift gleichzeitig Dame und Turm an.",
    "Der Springer ist an den König gebunden.",
    "In zwei Zügen fällt die Dame.",
  ].forEach((claim) => {
    assert.equal(findUnsupportedBoardClaims(claim, context).length, 1, claim);
  });
});

test("Brettwächter akzeptiert Material-, Gabel-, Fesselungs- und Hängebelege", () => {
  const positionContext = (fen, uci = []) => ({
    source: "stockfish",
    kind: "position",
    fen,
    depth: 18,
    evaluation: { unit: "cp", value: 0 },
    primaryVariation: { uci },
    lines: [],
  });

  assert.deepEqual(
    findUnsupportedBoardClaims(
      "Die schwarze Dame ist weg.",
      positionContext(
        "rnb1kbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2",
      ),
    ),
    [],
  );
  assert.deepEqual(
    findUnsupportedBoardClaims(
      "Schwarz hat einen Springer weniger.",
      positionContext(
        "r1bqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2",
      ),
    ),
    [],
  );
  assert.deepEqual(
    findUnsupportedBoardClaims(
      "Nach Se4 macht der Springer auf e4 eine Gabel gegen Dame und Turm.",
      positionContext(
        "k7/8/3q1r2/8/8/2N5/8/7K w - - 0 1",
        ["c3e4"],
      ),
    ),
    [],
  );
  assert.deepEqual(
    findUnsupportedBoardClaims(
      "Nach Se4 greift der Springer auf e4 gleichzeitig Dame und Turm an.",
      positionContext(
        "k7/8/3q1r2/8/8/2N5/8/7K w - - 0 1",
        ["c3e4"],
      ),
    ),
    [],
  );
  assert.deepEqual(
    findUnsupportedBoardClaims(
      "Der Springer auf c6 ist gefesselt.",
      positionContext("4k3/8/2n5/1B6/8/8/8/4K3 w - - 0 1"),
    ),
    [],
  );
  assert.deepEqual(
    findUnsupportedBoardClaims(
      "Der Läufer auf b5 fesselt den Springer auf c6 an den König auf e8.",
      positionContext("4k3/8/2n5/1B6/8/8/8/4K3 w - - 0 1"),
    ),
    [],
  );
  assert.deepEqual(
    findUnsupportedBoardClaims(
      "Die Dame auf d4 hängt.",
      positionContext("4k3/6b1/8/8/3Q4/8/8/4K3 w - - 0 1"),
    ),
    [],
  );
});

test("Brettwächter trennt allgemeine Definitionen von aktuellen Behauptungen", () => {
  assert.deepEqual(
    findUnsupportedBoardClaims(
      "Eine Gabel ist ein Angriff auf zwei Ziele.",
      context,
    ),
    [],
  );
  assert.deepEqual(
    findUnsupportedBoardClaims(
      "Ein Freibauer hat keinen gegnerischen Bauern vor sich.",
      context,
    ),
    [],
  );
});

test("Brettwächter prüft Schach, Matt, Bauernstruktur, Rochade und Umwandlung", () => {
  [
    "Der weiße König steht im Schach.",
    "Das ist Schachmatt.",
    "Nach Nf3 ist Schwarz matt.",
    "Nach Nf3 gewinnst du eine Figur.",
    "Der Bauer auf e4 ist ein Freibauer.",
    "Weiß hat Doppelbauern.",
    "Du kannst jetzt rochieren.",
    "Der Bauer auf e4 läuft zur Dame durch.",
    "Dein Bauer auf f2 ist weg.",
  ].forEach((claim) => {
    assert.equal(findUnsupportedBoardClaims(claim, context).length, 1, claim);
  });

  const positionContext = (fen, uci = []) => ({
    source: "stockfish",
    kind: "position",
    fen,
    primaryVariation: { uci },
    lines: [],
  });
  const supported = [
    [
      "Der schwarze König steht im Schach.",
      positionContext("4k3/8/8/8/8/8/8/4R1K1 b - - 0 1"),
    ],
    [
      "Das ist Schachmatt.",
      positionContext("7k/6Q1/5K2/8/8/8/8/8 b - - 0 1"),
    ],
    [
      "Nach Dxd8 gewinnt Weiß die schwarze Dame auf d8.",
      positionContext("3qk3/8/8/8/8/8/8/3QK3 w - - 0 1", ["d1d8"]),
    ],
    [
      "Der weiße Bauer auf e6 ist ein Freibauer.",
      positionContext("4k3/8/4P3/8/8/8/8/4K3 w - - 0 1"),
    ],
    [
      "Weiß hat Doppelbauern.",
      positionContext("4k3/8/8/8/8/2P5/2P5/4K3 w - - 0 1"),
    ],
    [
      "Weiß kann kurz rochieren.",
      positionContext("r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1"),
    ],
    [
      "Nach e8=D wird der Bauer auf e7 zur Dame.",
      positionContext("k7/4P3/8/8/8/8/8/7K w - - 0 1", ["e7e8q"]),
    ],
  ];
  supported.forEach(([claim, claimContext]) => {
    assert.deepEqual(findUnsupportedBoardClaims(claim, claimContext), [], claim);
  });
});

test("Verlustbehauptungen binden Figur, Besitz und Feld an den Schlag", () => {
  const captureContext = {
    source: "stockfish",
    kind: "position",
    fen: "4k3/8/8/2b5/8/8/5P2/4K3 b - - 0 1",
    primaryVariation: { uci: ["c5f2"] },
    lines: [],
  };
  assert.deepEqual(
    findUnsupportedBoardClaims(
      "Nach Lxf2 ist der weiße Bauer auf f2 weg.",
      captureContext,
    ),
    [],
  );
  assert.equal(
    findUnsupportedBoardClaims(
      "Nach Lxf2 ist der weiße Bauer auf e2 weg.",
      captureContext,
    ).length,
    1,
  );
  assert.equal(
    findUnsupportedBoardClaims(
      "Nach Lxf2 ist der weiße Springer auf f2 weg.",
      captureContext,
    ).length,
    1,
  );
});

test("Brettwächter versteht, dass eine gegnerische Antwort deine Figur nimmt", () => {
  const moveReviewContext = {
    source: "stockfish",
    kind: "move_review",
    fen: "rnbqkb1r/pp1ppppp/8/2p5/6nP/P7/1PPPPPPR/RNBQKBN1 w Qkq - 1 4",
    depth: 5,
    evaluation: { unit: "cp", value: 0 },
    primaryVariation: { uci: ["h2h1", "g4h2"] },
    playedLine: { uci: ["g1h3", "g4h2"] },
    moveReview: {
      playedMove: { uci: "g1h3", san: "Nh3" },
      bestMove: { uci: "h2h1", san: "Rh1" },
      quality: "blunder",
      lossCp: 403,
      pv: { uci: ["h2h1", "g4h2"] },
    },
  };
  assert.deepEqual(
    findUnsupportedBoardClaims(
      "**Stärkste Antwort:** Nxh2 nimmt deinen Turm auf h2.",
      moveReviewContext,
    ),
    [],
  );
  assert.equal(
    findUnsupportedBoardClaims(
      "**Stärkste Antwort:** Nxh2 nimmt deine Dame auf h2.",
      moveReviewContext,
    ).length,
    1,
  );
});

test("Brettwächter bindet einen Zug auch hinter Coach- und Bewertungslabels", () => {
  const alternativeContext = {
    source: "stockfish",
    kind: "position",
    fen: "4k3/8/8/q7/8/8/8/R3K3 w Q - 0 1",
    depth: 5,
    evaluation: { unit: "cp", value: 0 },
    primaryVariation: { uci: ["a1a5"] },
    lines: [],
  };
  assert.deepEqual(
    findUnsupportedBoardClaims(
      "**Alternative:** Besser: Rxa5 nimmt die Dame auf a5.",
      alternativeContext,
    ),
    [],
  );
});

test("Brettwächter verwirft unbelegte strategische Stellungsbehauptungen", () => {
  [
    "Der weiße Bauer auf d4 ist isoliert.",
    "Weiß hat am Damenflügel eine Bauernmehrheit.",
    "Der weiße König auf e1 steht unsicher.",
    "Weiß kontrolliert das Zentrum.",
    "Die d-Linie ist offen.",
    "Der weiße Springer auf f3 steht auf einem Außenposten.",
  ].forEach((claim) => {
    assert.equal(findUnsupportedBoardClaims(claim, context).length, 1, claim);
  });
});

test("Brettwächter belegt Bauernstruktur, Königssicherheit, Zentrum, Linie und Außenposten", () => {
  const positionContext = (fen, uci = []) => ({
    source: "stockfish",
    kind: "position",
    fen,
    primaryVariation: { uci },
    lines: [],
  });
  const supported = [
    [
      "Der weiße Bauer auf d4 ist isoliert.",
      positionContext("4k3/8/8/8/3P4/8/8/4K3 w - - 0 1"),
    ],
    [
      "Weiß hat am Damenflügel eine Bauernmehrheit.",
      positionContext("4k3/pp6/8/8/8/8/PPP5/4K3 w - - 0 1"),
    ],
    [
      "Weiß hat am Königsflügel eine Bauernmehrheit.",
      positionContext("4k3/5ppp/8/8/8/8/4PPPP/4K3 w - - 0 1"),
    ],
    [
      "Der weiße König auf g1 steht sicher.",
      positionContext("6k1/8/8/8/8/8/5PPP/6K1 w - - 0 1"),
    ],
    [
      "Der weiße König auf e1 steht unsicher.",
      positionContext("4k3/8/8/8/8/8/4r3/4K3 w - - 0 1"),
    ],
    [
      "Nach d4 kontrolliert Weiß das Zentrum.",
      positionContext(
        "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1",
        ["e2e4", "d7d5", "d2d4"],
      ),
    ],
    [
      "Weiß kontrolliert das Zentrum.",
      positionContext("4k3/8/8/3pp3/3PP3/8/8/4K3 w - - 0 1"),
    ],
    [
      "Die d-Linie ist offen.",
      positionContext("4k3/8/3r4/8/8/3R4/8/4K3 w - - 0 1"),
    ],
    [
      "Der weiße Springer auf d5 steht auf einem Außenposten.",
      positionContext("4k3/8/8/3N4/2P5/8/8/4K3 w - - 0 1"),
    ],
  ];
  supported.forEach(([claim, claimContext]) => {
    assert.deepEqual(findUnsupportedBoardClaims(claim, claimContext), [], claim);
  });
  assert.equal(
    findUnsupportedBoardClaims(
      "Weiß dominiert das Zentrum.",
      positionContext("4k3/8/8/3pp3/3PP3/8/8/4K3 w - - 0 1"),
    ).length,
    1,
  );
});

test("Brettwächter blockiert unbelegte Zukunftsbilder, aber keine Regeln oder Ratschläge", () => {
  [
    "Später wird der weiße König sicher.",
    "Langfristig kontrolliert Weiß das Zentrum.",
    "Im Endspiel ist der weiße Bauer auf e2 stärker.",
    "Nach der Eröffnung ist die d-Linie offen.",
  ].forEach((claim) => {
    assert.equal(findUnsupportedBoardClaims(claim, context).length, 1, claim);
  });

  [
    "Ein isolierter Bauer hat keine eigenen Bauern auf den Nachbarlinien.",
    "Eine Bauernmehrheit bedeutet mehr Bauern auf einem Flügel.",
    "Eine offene Linie enthält keine Bauern.",
    "Die d-Linie ist offen, wenn auf ihr keine Bauern stehen.",
    "Ein Außenposten ist ein geschütztes Feld.",
    "Später solltest du deinen König in Sicherheit bringen.",
  ].forEach((statement) => {
    assert.deepEqual(findUnsupportedBoardClaims(statement, context), [], statement);
  });
});

test("Brettwächter prüft kontrollierte Felder und die behauptete Figurenfarbe", () => {
  assert.deepEqual(
    findUnsupportedBoardClaims(
      "Nach Nf3 kontrolliert der weiße Springer d4.",
      context,
    ),
    [],
  );
  assert.deepEqual(
    findUnsupportedBoardClaims(
      "Nach Nf3 kontrolliert der weiße Springer d4 und e5.",
      context,
    ),
    [],
  );
  assert.equal(
    findUnsupportedBoardClaims(
      "Nach Nf3 kontrolliert der weiße Springer f4.",
      context,
    ).length,
    1,
  );

  const blackKnightOnly = {
    source: "stockfish",
    kind: "position",
    fen: "4k3/8/5n2/8/4P3/8/8/4K3 w - - 0 1",
    primaryVariation: { uci: [] },
    lines: [],
  };
  assert.equal(
    findUnsupportedBoardClaims(
      "Der weiße Springer greift den Bauern auf e4 an.",
      blackKnightOnly,
    ).length,
    1,
  );
  assert.deepEqual(
    findUnsupportedBoardClaims(
      "Der schwarze Springer greift den Bauern auf e4 an.",
      blackKnightOnly,
    ),
    [],
  );
});

test("ein schon vorher fehlendes Stück wird nicht dem aktuellen Zug zugeschrieben", () => {
  const missingQueenContext = {
    source: "stockfish",
    kind: "move_review",
    fen: "4k3/8/8/8/8/8/8/4K1N1 w - - 0 1",
    primaryVariation: { uci: ["g1f3"] },
    lines: [],
    playedLine: { uci: ["g1f3"] },
    moveReview: {
      playedMove: { uci: "g1f3", san: "Nf3" },
      bestMove: { uci: "g1f3", san: "Nf3" },
      quality: "best",
      lossCp: 0,
    },
  };
  assert.equal(
    findUnsupportedBoardClaims(
      "Nach Nf3 geht deine Dame verloren.",
      missingQueenContext,
    ).length,
    1,
  );
});

test("Materialgewinn zählt erst nach der vollständigen geprüften Tauschfolge", () => {
  const exchangeContext = {
    source: "stockfish",
    kind: "move_review",
    fen: "4k3/8/8/2p5/3n4/3QP3/8/4K3 w - - 0 1",
    primaryVariation: { uci: ["d3d4", "c5d4", "e3d4"] },
    lines: [],
    playedLine: { uci: ["d3d4", "c5d4", "e3d4"] },
    moveReview: {
      playedMove: { uci: "d3d4", san: "Qxd4" },
      bestMove: { uci: "d3d4", san: "Qxd4" },
      quality: "best",
      lossCp: 0,
    },
  };
  assert.equal(
    findUnsupportedBoardClaims(
      "Nach Qxd4 gewinnst du einen Springer.",
      exchangeContext,
    ).length,
    1,
  );
  assert.deepEqual(
    findUnsupportedBoardClaims(
      "Nach Qxd4 nimmst du den Springer auf d4.",
      exchangeContext,
    ),
    [],
  );
});
