import test from "node:test";
import assert from "node:assert/strict";
import {
  Engine,
  parseBestMoveLine,
  parseInfoLine,
  scoreFromWhitePerspective,
} from "../engine.js";

function createReadyEngine({
  onInfo = () => {},
  onEvaluation = () => {},
  onBestMove = () => {},
  onReady = () => {},
} = {}) {
  const messages = [];
  const engine = Object.create(Engine.prototype);
  Object.assign(engine, {
    sf: {
      postMessage(message) {
        messages.push(message);
      },
      terminate() {},
    },
    isReady: true,
    depth: 15,
    currentTargetDepth: 15,
    searchSequence: 0,
    activeSearch: null,
    pendingSearch: null,
    searching: false,
    stopping: false,
    optionsDirty: false,
    latestPrimaryInfo: null,
    lastFen: null,
    onInfo,
    onEvaluation,
    onBestMove,
    onReady,
    multiPV: 3,
    threads: 1,
    hashMB: 128,
    analysisMode: true,
    limitStrength: false,
    targetElo: 2800,
    disposed: false,
    handshakeTimer: null,
  });
  return { engine, messages };
}

test("parseInfoLine liest Tiefe, MultiPV, Score und Zugfolge", () => {
  assert.deepEqual(
    parseInfoLine("info depth 18 multipv 2 score cp -37 nodes 10 pv e7e5 g1f3"),
    {
      depth: 18,
      multipv: 2,
      score: { unit: "cp", value: -37, pawns: -0.37 },
      pv: ["e7e5", "g1f3"],
    },
  );
  assert.equal(parseInfoLine("bestmove e2e4"), null);
});

test("parseBestMoveLine liest Zug, Umwandlung und Ponder-Zug", () => {
  assert.deepEqual(parseBestMoveLine("bestmove e7e8q ponder a2a1n"), {
    move: "e7e8q",
    ponder: "a2a1n",
  });
  assert.deepEqual(parseBestMoveLine("bestmove (none)"), {
    move: null,
    ponder: null,
  });
  assert.equal(parseBestMoveLine("info depth 12"), null);
});

test("Scores werden einschließlich Matt auf Weiß-Perspektive normalisiert", () => {
  const blackFen = "8/8/8/8/8/8/8/8 b - - 0 1";
  assert.deepEqual(
    scoreFromWhitePerspective({ unit: "cp", value: 35, pawns: 0.35 }, blackFen),
    { unit: "cp", value: -35, pawns: -0.35 },
  );
  assert.deepEqual(
    scoreFromWhitePerspective({ unit: "mate", value: 3, pawns: 100 }, blackFen),
    { unit: "mate", value: -3, pawns: -100 },
  );
});

test("readyok meldet die Engine-Bereitschaft", () => {
  const readyEvents = [];
  const { engine } = createReadyEngine({
    onReady: (event) => readyEvents.push(event),
  });
  engine.isReady = false;
  engine.activeWorkerPath = "/stockfish-test.js";
  engine._handleMessage("readyok");
  assert.equal(engine.isReady, true);
  assert.deepEqual(readyEvents, [{
    workerPath: "/stockfish-test.js",
    threads: 1,
  }]);
});

test("Spielstärke wird per UCI-Elo begrenzt und für Analysen wieder freigegeben", () => {
  const { engine, messages } = createReadyEngine();

  engine.setPlayingStrength(900);
  assert.equal(engine.analysisMode, false);
  assert.equal(engine.limitStrength, true);
  assert.equal(engine.targetElo, 1320);
  assert.deepEqual(messages.slice(-3), [
    "setoption name UCI_AnalyseMode value false",
    "setoption name UCI_LimitStrength value true",
    "setoption name UCI_Elo value 1320",
  ]);

  engine.setAnalysisStrength();
  assert.equal(engine.analysisMode, true);
  assert.equal(engine.limitStrength, false);
  assert.deepEqual(messages.slice(-2), [
    "setoption name UCI_AnalyseMode value true",
    "setoption name UCI_LimitStrength value false",
  ]);
});

test("eine neue Suche wartet auf bestmove und nur die neueste wird gestartet", () => {
  const { engine, messages } = createReadyEngine();
  const fenA = "8/8/8/8/8/8/8/K6k w - - 0 1";
  const fenB = "8/8/8/8/8/8/8/K6k b - - 0 1";
  const fenC = "8/8/8/8/8/8/K7/7k w - - 0 2";

  engine.evaluate(fenA, 12);
  engine.evaluate(fenB, 12);
  engine.evaluate(fenC, 12);

  assert.deepEqual(messages, [
    `position fen ${fenA}`,
    "go depth 12",
    "stop",
  ]);

  engine._handleMessage("bestmove a1a2");
  assert.deepEqual(messages.slice(-2), [
    `position fen ${fenC}`,
    "go depth 12",
  ]);
  assert.ok(!messages.includes(`position fen ${fenB}`));
});

test("alte Info während stop wird ignoriert und PV 1 liefert den finalen Eval", () => {
  const infos = [];
  const evaluations = [];
  const { engine } = createReadyEngine({
    onInfo: (info) => infos.push(info),
    onEvaluation: (value, meta) => evaluations.push({ value, meta }),
  });
  const fen = "8/8/8/8/8/8/8/K6k b - - 0 1";
  const searchId = engine.evaluate(fen, 15);

  engine._handleMessage("info depth 10 multipv 1 score cp 40 pv h1h2");
  engine._handleMessage("info depth 10 multipv 3 score cp -20 pv h1g1");
  engine._handleMessage("bestmove h1h2");

  assert.equal(infos[0].whiteScore.pawns, -0.4);
  assert.deepEqual(evaluations, [{
    value: -0.4,
    meta: { fen, searchId },
  }]);

  engine.evaluate(fen, 15);
  engine.evaluate(`${fen.slice(0, -1)}2`, 15);
  engine._handleMessage("info depth 15 multipv 1 score cp 99 pv h1h2");
  assert.equal(infos.length, 2);
});

test("cancelSearch verwirft Warteschlange und stoppt nur eine laufende Suche", () => {
  const { engine, messages } = createReadyEngine();
  const fen = "8/8/8/8/8/8/8/K6k w - - 0 1";
  engine.evaluate(fen, 12);
  engine.pendingSearch = { id: 99, fen, depth: 12 };
  engine.cancelSearch();
  assert.equal(engine.pendingSearch, null);
  assert.equal(engine.stopping, true);
  assert.equal(messages.at(-1), "stop");
  engine.cancelSearch();
  assert.equal(messages.filter((message) => message === "stop").length, 1);
});

test("natürliches bestmove meldet Suche und Kontext, abgebrochene Suchen nicht", async () => {
  const bestMoves = [];
  const { engine } = createReadyEngine({
    onBestMove: (payload) => bestMoves.push(payload),
  });
  const fen = "8/8/8/8/8/8/8/K6k w - - 0 1";
  const searchId = engine.evaluate(fen, 7, {
    purpose: "play-move",
    generation: 4,
  });
  engine._handleMessage("info depth 7 multipv 1 score cp 20 pv a1a2");
  engine._handleMessage("bestmove a1a2");
  await Promise.resolve();

  assert.equal(bestMoves.length, 1);
  assert.equal(bestMoves[0].move, "a1a2");
  assert.equal(bestMoves[0].fen, fen);
  assert.equal(bestMoves[0].searchId, searchId);
  assert.deepEqual(bestMoves[0].context, {
    purpose: "play-move",
    generation: 4,
  });

  engine.evaluate(fen, 7, { purpose: "play-move", generation: 5 });
  engine.cancelSearch();
  engine._handleMessage("bestmove a1a2");
  await Promise.resolve();
  assert.equal(bestMoves.length, 1);
});
