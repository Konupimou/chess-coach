import test from "node:test";
import assert from "node:assert/strict";
import { Chess } from "chess.js";
import { ChessApp } from "../app.js";

function analysisApp({ perspective = "w", turn = "w", mode = "continue" } = {}) {
  const app = Object.create(ChessApp.prototype);
  app.analysisPerspective = perspective;
  app.analysisCoachMode = mode;
  app.game = { turn: () => turn };
  return app;
}

test("Weiterspielen verwendet unabhängig von der Zugfarbe die aktuelle Stellung", () => {
  const app = analysisApp({ perspective: "w", turn: "b", mode: "continue" });
  const positionContext = { kind: "position" };
  app.buildPositionCoachEngineContext = () => positionContext;
  app.buildMoveCoachEngineContext = () => {
    throw new Error("Zugreview darf im Weiterspielen-Modus nicht verwendet werden");
  };

  assert.equal(app.buildAnalysisCoachEngineContext(), positionContext);
});

test("Zug verstehen verwendet unabhängig von der Zugfarbe den letzten Zug", () => {
  const app = analysisApp({ perspective: "b", turn: "b", mode: "review" });
  const reviewedMove = { ply: 3, color: "w", san: "Nf3" };
  const moveContext = { kind: "move_review" };
  app.getLatestVerifiedMoveReview = () => reviewedMove;
  app.buildPositionCoachEngineContext = () => {
    throw new Error("Aktuelle Zugoptionen dürfen im Zug-verstehen-Modus nicht verwendet werden");
  };
  app.buildMoveCoachEngineContext = (move) => {
    assert.equal(move, reviewedMove);
    return moveContext;
  };

  assert.equal(app.buildAnalysisCoachEngineContext(), moveContext);
});

test("Coach-Modus fällt ohne gespeicherten Wert auf Weiterspielen zurück", () => {
  const app = analysisApp({ mode: "unknown" });
  assert.equal(app.getAnalysisCoachMode(), "continue");
  app.analysisCoachMode = "review";
  assert.equal(app.getAnalysisCoachMode(), "review");
});

test("der letzte Zug wird ohne Farbfilter anhand des aktuellen Halbzuges gefunden", () => {
  const app = analysisApp({ perspective: "b", turn: "w" });
  const game = new Chess();
  const path = [{ move: null, fen: game.fen() }];
  const e4 = game.move("e4");
  path.push({ move: e4, fen: game.fen() });
  const nc6 = game.move("Nc6");
  path.push({ move: nc6, fen: game.fen() });
  app.getCurrentPath = () => path;
  const expected = {
    ply: 2,
    color: "b",
    san: "Nc6",
    fenBefore: "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1",
    playedUci: "b8c6",
    bestUci: "b8c6",
    bestPvUci: ["b8c6"],
    fenAfter: path[2].fen,
  };
  app.liveAccuracyReport = { moves: [expected] };
  app.gameReviewReport = null;
  app.savedGameReview = null;

  assert.deepEqual(app.getLatestVerifiedMoveReview(), {
    ...expected,
    bestSan: "Nc6",
    bestPvSan: ["Nc6"],
    playedContinuationUci: ["b8c6"],
    playedContinuationSan: ["Nc6"],
  });
});
