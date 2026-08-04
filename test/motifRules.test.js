import test from "node:test";
import assert from "node:assert/strict";

import {
  EXECUTABLE_MOTIF_RULES,
  executableMotifRuleSummary,
  motifRuleFor,
} from "../motifRules.js";
import { recognizePositionPatterns } from "../patternRecognition.js";

test("zehn taktische Kernmotive sind mit kuratiertem Wissen und Prüfern verbunden", () => {
  const summary = executableMotifRuleSummary();

  assert.equal(EXECUTABLE_MOTIF_RULES.length, 10);
  assert.equal(summary.every((rule) => rule.hasKnowledge), true);
  assert.equal(summary.every((rule) => rule.validatorCount >= 3), true);
  assert.equal(motifRuleFor("fork")?.knowledgeId, "tactics.fork");
  assert.match(motifRuleFor("fork")?.knowledge?.exceptions[0] || "", /Gabel/);
});

test("ein erkanntes Motiv trägt Wissensregel, Prüfstatus und Provenienz", () => {
  const fen = "r1bqkbnr/ppp2p1p/2np2p1/6N1/2B5/4P3/PPPP1PPP/RNBQK2R w KQkq - 0 1";
  const patterns = recognizePositionPatterns({
    fenAfter: fen,
    engine: { lineUci: ["g5f7", "d8e7", "f7h8"], depth: 18 },
  });
  const fork = patterns.find((pattern) => pattern.type === "fork" && pattern.move?.uci === "g5f7");

  assert.ok(fork);
  assert.equal(fork.knowledgeId, "tactics.fork");
  assert.equal(fork.engineEvidence.status, "primary_line");
  assert.equal(fork.engineEvidence.depth, 18);
  assert.ok(fork.ruleChecks.some((check) => check.validator === "exchange_sequence" && check.status === "passed"));
  assert.ok(fork.provenance.includes("knowledge:tactics.fork"));
  assert.ok(fork.provenance.includes("stockfish_primary_line"));
});

test("das Fehlen in der einzelnen Engine-Hauptvariante widerlegt ein Motiv nicht", () => {
  const fen = "r1bqkbnr/ppp2p1p/2np2p1/6N1/2B5/4P3/PPPP1PPP/RNBQK2R w KQkq - 0 1";
  const fork = recognizePositionPatterns({
    fenAfter: fen,
    engine: { lineUci: ["g5e4"], depth: 18 },
  }).find((pattern) => pattern.type === "fork" && pattern.move?.uci === "g5f7");

  assert.ok(fork);
  assert.equal(fork.engineEvidence.status, "not_primary_line");
  assert.equal(fork.engineEvidence.absenceDoesNotRefute, true);
  assert.equal(fork.status, "winning");
});

test("ein Engine-Zwischenzug wird mit der vorhandenen Wissensregel verbunden", () => {
  const fen = "4k3/8/8/8/3p4/2P5/8/3QK3 w - - 0 1";
  const patterns = recognizePositionPatterns({
    fenAfter: fen,
    engine: {
      lineUci: ["d1h5"],
      depth: 18,
      lastMoveUci: "e5d4",
      lastMoveWasCapture: true,
    },
  });
  const zwischenzug = patterns.find((pattern) => pattern.type === "zwischenzug");

  assert.ok(zwischenzug);
  assert.equal(zwischenzug.move.san, "Qh5+");
  assert.equal(zwischenzug.knowledgeId, "tactics.zwischenzug");
  assert.equal(zwischenzug.engineEvidence.status, "primary_line");
});

