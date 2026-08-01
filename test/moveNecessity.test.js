import test from "node:test";
import assert from "node:assert/strict";
import {
  classifyMoveNecessity,
  MOVE_NECESSITY,
} from "../moveNecessity.js";

const cp = (value) => ({ unit: "cp", value, perspective: "player" });

test("150 Centipawns Abstand allein erzeugen keine Nur-Zug-Aussage", () => {
  const result = classifyMoveNecessity({
    bestEvaluation: cp(300),
    secondEvaluation: cp(150),
  });
  assert.equal(result.type, MOVE_NECESSITY.clearlyBest);
  assert.equal(result.onlyMove, false);
});

test("Nur-Zug-Klassen benötigen eine Ergebnisgrenze oder exakt einen legalen Zug", () => {
  const avoidsLoss = classifyMoveNecessity({
    bestEvaluation: cp(0),
    secondEvaluation: cp(-200),
  });
  assert.equal(avoidsLoss.type, MOVE_NECESSITY.onlyMoveToAvoidLoss);
  assert.equal(avoidsLoss.onlyMove, true);

  const keepsAdvantage = classifyMoveNecessity({
    bestEvaluation: cp(250),
    secondEvaluation: cp(50),
  });
  assert.equal(keepsAdvantage.type, MOVE_NECESSITY.onlyMoveToKeepAdvantage);
  assert.equal(keepsAdvantage.onlyMove, true);

  const onlyLegal = classifyMoveNecessity({
    legalMoveCount: 1,
    bestEvaluation: cp(-500),
  });
  assert.equal(onlyLegal.type, MOVE_NECESSITY.onlyLegalMove);
  assert.equal(onlyLegal.onlyMove, true);
});

test("praktisch gleichwertige Kandidaten bleiben ausdrücklich gleichwertig", () => {
  const result = classifyMoveNecessity({
    bestEvaluation: cp(35),
    secondEvaluation: cp(12),
  });
  assert.equal(result.type, MOVE_NECESSITY.practicallyEquivalent);
  assert.equal(result.onlyMove, false);
});
