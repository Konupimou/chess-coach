import test from "node:test";
import assert from "node:assert/strict";
import {
  Engine,
  parseInfoLine,
  scoreFromWhitePerspective,
} from "../engine.js";

function createReadyEngine({ onInfo = () => {}, onEvaluation = () => {} } = {}) {
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
    multiPV: 3,
    threads: 1,
    hashMB: 128,
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
