import assert from "node:assert/strict";
import test from "node:test";
import {
  ENGINE_CONTEXT_MISSING_REPLY,
  allowedEngineMoveTokens,
  findUnsupportedEvaluationTokens,
  findUnsupportedMoveTokens,
  hasUsableEngineContext,
  normalizeEngineContext,
} from "../coachEngineContext.js";

const context = {
  source: "stockfish",
  kind: "position",
  fen: "start",
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
  assert.match(ENGINE_CONTEXT_MISSING_REPLY, /keinen konkreten Zug/);
  assert.doesNotMatch(ENGINE_CONTEXT_MISSING_REPLY, /Stockfish|Engine|PV|Centipawn/i);
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
    fen: "mate-fen",
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
          san: ["Qh7+", "Kf8", "Qh8#"],
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
      "Stockfish bevorzugt Qh7+ und zeigt danach Kf8 sowie Qh8#.",
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
    fen: "before",
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

test("Bewertungswächter übernimmt nur tatsächlich gelieferte Centipawn- und Mattwerte", () => {
  assert.deepEqual(
    findUnsupportedEvaluationTokens("Stockfish bewertet die Stellung mit +0,32.", context),
    [],
  );
  assert.deepEqual(
    findUnsupportedEvaluationTokens("Die Bewertung beträgt plötzlich +1,80.", context),
    ["+1,80"],
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
