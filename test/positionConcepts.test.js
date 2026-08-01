import test from "node:test";
import assert from "node:assert/strict";
import {
  buildPositionConceptFingerprint,
  compactConceptFingerprint,
  compareConceptFingerprints,
  conceptSearchTokens,
  expandConceptFingerprint,
} from "../positionConcepts.js";

test("Fingerabdruck erkennt Bauernstruktur, offene Linien und konkrete Konzeptbedingungen", () => {
  const fingerprint = buildPositionConceptFingerprint("4k3/8/8/8/3P4/8/8/4K2R w - - 0 1");
  assert.equal(fingerprint.phase, "endgame");
  assert.equal(fingerprint.conceptIds.includes("isolated_pawn"), true);
  assert.equal(fingerprint.conceptIds.includes("passed_pawn"), true);
  assert.equal(fingerprint.summary.openFiles.includes("e"), true);
  const isolated = fingerprint.concepts.find((concept) => concept.id === "isolated_pawn");
  assert.equal(isolated.prerequisites.includes("isolated_pawn:d4"), true);
  assert.equal(isolated.failureConditions.length > 0, true);
});

test("kompakter Fingerabdruck ist verlustfrei für Such- und Transferfelder", () => {
  const fingerprint = buildPositionConceptFingerprint("4k3/8/8/8/3P4/8/8/4K3 w - - 0 1");
  const expanded = expandConceptFingerprint(compactConceptFingerprint(fingerprint));
  assert.deepEqual(expanded.conceptIds, fingerprint.conceptIds);
  assert.equal(expanded.concepts[0].typicalPlan.length > 0, true);
  assert.equal(conceptSearchTokens(expanded).some((token) => token.startsWith("concept:")), true);
});

test("farbvertauschte Stellungen werden aus Sicht der Seite am Zug normalisiert", () => {
  const white = buildPositionConceptFingerprint("4k3/8/8/8/3P4/8/8/4K3 w - - 0 1");
  const black = buildPositionConceptFingerprint("4k3/8/8/3p4/8/8/8/4K3 b - - 0 1");
  const comparison = compareConceptFingerprints(white, black);
  assert.equal(comparison.matchType, "concept_structure");
  assert.equal(comparison.shared.includes("concept:isolated_pawn"), true);
});

test("Konzepttransfer nennt Gemeinsamkeiten, Unterschiede und übertragbaren Plan", () => {
  const query = buildPositionConceptFingerprint("4k3/8/8/8/3P4/8/8/4K2R w - - 0 1");
  const candidate = buildPositionConceptFingerprint("4k3/8/8/8/3P4/8/8/R3K3 w - - 0 1");
  const comparison = compareConceptFingerprints(query, candidate);
  const transfer = comparison.transferableConcepts.find((entry) => entry.id === "isolated_pawn");
  assert.equal(Boolean(transfer), true);
  assert.equal(transfer.sharedPrerequisites.includes("isolated_pawn:d4"), true);
  assert.equal(transfer.transferablePlan.includes("use_open_files"), true);
});

test("abweichende taktische Realität blockiert eine oberflächliche Übertragung", () => {
  const safe = buildPositionConceptFingerprint("4k3/8/8/8/3P4/8/8/4K3 w - - 0 1");
  const loose = buildPositionConceptFingerprint("4k3/8/8/8/3P4/8/4r3/4K2R w - - 0 1");
  const comparison = compareConceptFingerprints(safe, loose);
  assert.equal(comparison.tacticalMismatch, true);
  assert.equal(comparison.score < 55, true);
});
