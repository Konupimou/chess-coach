import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  assessCoachReadability,
  coachCorpusReportMarkdown,
  evaluateCoachCorpus,
  selectStratifiedCorpus,
} from "../scripts/evaluate-coach-corpus.mjs";

const INDEX_PATH = new URL("../data/pgn/coach-pgn-index.json", import.meta.url);

test("die Massentest-Auswahl ist reproduzierbar und über alle Elo-Phasen-Gruppen verteilt", async () => {
  const index = JSON.parse(await readFile(INDEX_PATH, "utf8"));
  const first = selectStratifiedCorpus(index, {
    samplesPerCell: 2,
    seed: "deterministic-test",
  });
  const second = selectStratifiedCorpus(index, {
    samplesPerCell: 2,
    seed: "deterministic-test",
  });

  assert.equal(first.cells.length, 12);
  assert.equal(first.selected.length, 24);
  assert.equal(first.selectionHash, second.selectionHash);
  assert.deepEqual(
    first.selected.map((record) => record.id),
    second.selected.map((record) => record.id),
  );
  assert.equal(new Set(first.selected.map((record) => record.positionKey)).size, 24);
});

test("die Sprachprüfung erkennt schwere Formulierungen und absolute Eröffnungsurteile", () => {
  const difficult = assessCoachReadability(
    "Über das Zielfeld d4 hinaus ist bei der aktuellen Analysetiefe nichts zuverlässig belegt. Das ist hier die genaueste Wahl.",
    {
      rating: 800,
      phase: "opening",
      legalMoveCount: 24,
      practicallyEquivalent: true,
    },
  );
  assert.equal(difficult.pass, false);
  assert.ok(difficult.issueCodes.includes("evidence-jargon"));
  assert.ok(difficult.issueCodes.includes("false-ranking"));
  assert.ok(difficult.issueCodes.includes("opening-ranking"));

  const friendly = assessCoachReadability(
    "Damit entwickelst du deinen Springer. Auch d4 ist eine gute Möglichkeit.",
    {
      rating: 800,
      phase: "opening",
      legalMoveCount: 24,
      practicallyEquivalent: true,
    },
  );
  assert.equal(friendly.pass, true);
});

test("ein repräsentativer Offline-Lauf besteht die harten Sicherheitsprüfungen", async () => {
  const result = await evaluateCoachCorpus({
    indexPath: INDEX_PATH.pathname,
    samplesPerCell: 1,
    seed: "safety-smoke-test",
  });

  assert.equal(result.corpus.sampledPositions, 12);
  assert.equal(result.overall.legalityPercent, 100);
  assert.equal(result.overall.evidencePercent, 100);
  assert.equal(result.overall.semanticsPercent, 100);
  assert.equal(result.overall.provenancePercent, 100);
  assert.ok(result.overall.exactDatabaseMatchPercent >= 0);
  assert.equal(result.gates.safetyReady, true);
  assert.equal(result.config.paidAiCalls, 0);
  assert.equal(result.config.engineEvaluationUsed, false);
  assert.ok(result.sourceCorpus.entries >= 15_000);
  assert.ok(result.sourceCorpus.byRating[800].entries >= 2_000);
  assert.equal(result.sourceCorpus.rawCommentsAreDirectCoachOutput, false);

  const report = coachCorpusReportMarkdown(result);
  assert.match(report, /Offline-Massentest/);
  assert.match(report, /Zuglegalität/);
  assert.match(report, /800\/1000\/1400\/1800/);
  assert.match(report, /Kein endlicher Test kann.*absolut beweisen/iu);
});
