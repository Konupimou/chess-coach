import test from "node:test";
import assert from "node:assert/strict";
import {
  approvedPgnCommentInsight,
  isKnownPgnCommentInsightSummary,
  pgnCommentInsightSummaries,
  pgnCommentKnowledgeCandidates,
  PGN_COMMENT_CONCEPT_SCOPE,
} from "../pgnCommentKnowledge.js";
import { positionSimilarityProfile } from "../positionSimilarity.js";
import { validateCoachLanguage } from "../coachLanguageQuality.js";

const passedPawnFen = "8/8/8/4P3/8/8/4K3/7k w - - 0 1";

function record(comment) {
  return {
    gameId: "anonymous-game",
    path: "main.1",
    fenBefore: passedPawnFen,
    annotation: { originalComment: comment },
  };
}

test("PGN-Kommentare aktivieren nur ein am Brett erkanntes Konzept", () => {
  const profile = positionSimilarityProfile(passedPawnFen);
  const candidates = pgnCommentKnowledgeCandidates(
    record("The passed pawn should be supported before it advances."),
    profile,
    { sourceId: "source.one", audienceRating: 800 },
  );

  assert.equal(candidates.length, 1);
  assert.deepEqual(candidates[0].requiredConceptIds, ["passed_pawn"]);
  assert.equal(candidates[0].scope, PGN_COMMENT_CONCEPT_SCOPE);
  assert.equal(isKnownPgnCommentInsightSummary(candidates[0].comment), true);

  assert.deepEqual(pgnCommentKnowledgeCandidates(
    record("The position contains a fork."),
    profile,
    { sourceId: "source.one" },
  ), []);
});

test("strategisches Kommentarwissen braucht zwei unabhängige Quellen", () => {
  const [candidate] = pgnCommentKnowledgeCandidates(
    record("Ein Freibauer ist ein wichtiger Trumpf."),
    positionSimilarityProfile(passedPawnFen),
    { sourceId: "source.one" },
  );

  assert.equal(approvedPgnCommentInsight(candidate, { independentSources: 1 }), null);
  const approved = approvedPgnCommentInsight(candidate, { independentSources: 2 });
  assert.equal(approved.annotation.claims[0].verificationStatus, "consensus_verified");
  assert.equal(approved.annotation.claims[0].independentSources, 2);
});

test("alle Kommentar-Erkenntnisse sind auch für 800 Elo leicht lesbar", () => {
  for (const summary of pgnCommentInsightSummaries()) {
    const result = validateCoachLanguage(summary, {
      rating: 800,
      phase: "middlegame",
      strict: true,
    });
    assert.equal(result.valid, true, `${summary}: ${(result.errors || []).join(", ")}`);
  }
});
