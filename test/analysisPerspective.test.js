import test from "node:test";
import assert from "node:assert/strict";
import { ChessApp } from "../app.js";

function analysisApp({ perspective = "w", turn = "w" } = {}) {
  const app = Object.create(ChessApp.prototype);
  app.analysisPerspective = perspective;
  app.game = { turn: () => turn };
  return app;
}

test("eigener Zug verwendet die aktuelle Stellung als Coach-Kontext", () => {
  const app = analysisApp({ perspective: "w", turn: "w" });
  const positionContext = { kind: "position" };
  app.buildPositionCoachEngineContext = () => positionContext;
  app.buildMoveCoachEngineContext = () => {
    throw new Error("Zugreview darf bei eigenem Zug nicht verwendet werden");
  };

  assert.equal(app.buildAnalysisCoachEngineContext(), positionContext);
});

test("gegnerischer Zug verwendet die Bewertung des letzten eigenen Zuges", () => {
  const app = analysisApp({ perspective: "w", turn: "b" });
  const reviewedMove = { ply: 3, color: "w", san: "Nf3" };
  const moveContext = { kind: "move_review" };
  app.getLastPerspectiveMoveReview = () => reviewedMove;
  app.buildPositionCoachEngineContext = () => {
    throw new Error("Aktuelle Zugoptionen dürfen hier nicht als Nutzerempfehlung dienen");
  };
  app.buildMoveCoachEngineContext = (move) => {
    assert.equal(move, reviewedMove);
    return moveContext;
  };

  assert.equal(app.buildAnalysisCoachEngineContext(), moveContext);
});

test("letzter eigener Zug wird anhand von Farbe und aktuellem Halbzug gefunden", () => {
  const app = analysisApp({ perspective: "b", turn: "w" });
  app.getCurrentPath = () => [
    { move: null },
    { move: { color: "w" } },
    { move: { color: "b" } },
  ];
  const expected = {
    ply: 2,
    color: "b",
    san: "Nc6",
    fenBefore: "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1",
    playedUci: "b8c6",
    bestUci: "b8c6",
    bestPvUci: ["b8c6"],
  };
  app.liveAccuracyReport = { moves: [expected] };
  app.gameReviewReport = null;
  app.savedGameReview = null;

  assert.deepEqual(app.getLastPerspectiveMoveReview(), {
    ...expected,
    bestSan: "Nc6",
    bestPvSan: ["Nc6"],
    playedContinuationUci: ["b8c6"],
    playedContinuationSan: ["Nc6"],
  });
});
