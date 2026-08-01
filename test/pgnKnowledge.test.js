import test from "node:test";
import assert from "node:assert/strict";
import {
  normalizedPgnPositionKey,
  pgnKnowledgeForEngineContext,
  pgnKnowledgeForPosition,
  pgnKnowledgeIndexStats,
  pgnQuestionTopics,
} from "../pgnKnowledge.js";
import {
  compactPositionSimilarityProfile,
  positionSimilarityProfile,
} from "../positionSimilarity.js";

const fen = "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1";
const key = "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq -";
const index = {
  version: 1,
  stats: { positions: 1, commentsIndexed: 2, uniqueFiles: 2 },
  positions: {
    [key]: [
      {
        id: "advanced",
        comment: "A demanding strategic explanation for this exact position.",
        topics: ["strategy", "center"],
        audienceRating: 1800,
      },
      {
        id: "basic",
        comment: "The pawn takes space in the center.",
        topics: ["center"],
        audienceRating: 800,
      },
    ],
  },
};

test("PGN-Wissen wird nur für die exakt normalisierte Stellung geliefert", () => {
  assert.equal(normalizedPgnPositionKey(fen), key);
  assert.equal(
    normalizedPgnPositionKey(fen.replace("0 1", "17 42")),
    key,
  );
  assert.equal(pgnKnowledgeForPosition({
    fen: fen.replace(" b ", " w "),
    index,
  }).length, 0);
});

test("ähnliche ruhige Stellungen liefern vorsichtig markiertes Strukturwissen", () => {
  const similarKey = "rnbqkbnr/pppppppp/8/8/4P3/5N2/PPPP1PPP/RNBQKB1R b KQkq -";
  const structuralIndex = {
    positions: {
      [similarKey]: [{
        id: "structure",
        comment: "Develop the remaining pieces before starting an attack in the center.",
        topics: ["development", "center"],
        audienceRating: 800,
      }],
    },
    profiles: {
      [similarKey]: compactPositionSimilarityProfile(
        positionSimilarityProfile(similarKey, { openingFamily: "King's Pawn Game" }),
      ),
    },
  };
  const result = pgnKnowledgeForPosition({
    fen,
    rating: 800,
    question: "Wie entwickle ich meine Figuren?",
    openingFamily: "King's Pawn Game",
    index: structuralIndex,
  });

  assert.equal(result.length, 1);
  assert.notEqual(result[0].match.type, "exact");
  assert.match(result[0].match.label, /Eröffnung|Bauernstruktur|Stellungsaufbau|Stellungskonzept/);
  assert.match(result[0].usage, /übertragbaren Plan/);

  const tactical = pgnKnowledgeForPosition({
    fen,
    question: "Gibt es hier eine Taktik?",
    openingFamily: "King's Pawn Game",
    index: structuralIndex,
  });
  assert.deepEqual(tactical, []);
});

test("kompakt gespeicherte Konzepte werden in einer unbekannten Stellung ausgegeben", () => {
  const known = "1b2q1k1/p7/p1p2p2/B1P3pp/3P1p2/7P/PP1Q1PPK/8 w - -";
  const unknown = "1b2q1k1/p7/pBp2p2/2P3pp/3P1p2/7P/PP1Q1PPK/8 b - -";
  const profile = positionSimilarityProfile(known);
  const indexedConcept = profile.concepts.conceptIds.find((id) => id === "isolated_pawn");
  assert.equal(indexedConcept, "isolated_pawn");
  const compactProfile = compactPositionSimilarityProfile(profile);
  const conceptIndex = {
    positionKeys: [known],
    searchBuckets: Object.fromEntries([
      ...profile.concepts.conceptIds.map((id) => [`concept:${id}`, [0]]),
      [`phase:${profile.concepts.phase}`, [0]],
    ]),
    positions: {
      [known]: [["concept", "Use the pawn majority and keep the king safe.", ["strategy"], 1000, "middlegame", ["game", 1, 1, "w", "Bb6", "a5b6", true], ["strategic", [], []]]],
    },
    profiles: { [known]: compactProfile },
  };
  const result = pgnKnowledgeForPosition({
    fen: `${unknown} 0 1`,
    question: "Was ist hier der Plan?",
    index: conceptIndex,
    limit: 3,
  });

  assert.equal(result.length > 0, true);
  assert.equal(result[0].match.type, "concept_transfer");
  assert.equal(result[0].match.conceptTransfer.some((entry) => (
    entry.id === "isolated_pawn" && entry.transferablePlan.length > 0
  )), true);
});

test("PGN-Hinweise werden nach Coach-Elo sortiert und kompakt begrenzt", () => {
  const beginner = pgnKnowledgeForPosition({ fen, rating: 800, index, limit: 1 });
  assert.equal(beginner.length, 1);
  assert.equal(beginner[0].id, "pgn.basic");
  assert.equal(beginner[0].audienceRating, 800);
  assert.match(beginner[0].usage, /nicht als Beleg/);

  const advanced = pgnKnowledgeForPosition({ fen, rating: 1800, index, limit: 1 });
  assert.equal(advanced[0].id, "pgn.advanced");
});

test("die konkrete Frage priorisiert thematisch passende PGN-Hinweise", () => {
  const plan = pgnKnowledgeForPosition({
    fen,
    rating: 800,
    question: "Was ist hier der Plan?",
    index,
    limit: 1,
  });
  assert.equal(plan[0].id, "pgn.advanced");
  assert.deepEqual(pgnQuestionTopics("Welche Gefahr übersehe ich?"), [
    "tactics",
  ]);
});

test("kompakte Laufzeiteinträge enthalten nur neutrale Wissensdaten", () => {
  const compactIndex = {
    positions: {
      [key]: [["compact", "Control the center.", ["center"], 800, "opening", ["game", 1, 1, "w", "e4", "e2e4", true], ["strategic", [], []]]],
    },
  };
  const result = pgnKnowledgeForPosition({ fen, rating: 800, index: compactIndex });
  assert.equal(result[0].id, "pgn.compact");
  assert.equal(result[0].category, "opening");
  assert.equal("source" in result[0], false);
});

test("PGN-Indexstatistik bleibt klein und explizit", () => {
  assert.deepEqual(pgnKnowledgeIndexStats(index), {
    version: 1,
    positions: 1,
    comments: 2,
    sources: 2,
    categoryCounts: {},
  });
});

test("Zugerklärung sucht Wissen vor dem Zug und nach gespieltem Zug sowie Alternativen", () => {
  const beforeKey = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq -";
  const afterE4Key = key;
  const multiPositionIndex = {
    version: 4,
    stats: { positions: 2, commentsIndexed: 2, uniqueFiles: 1 },
    positions: {
      [beforeKey]: [{ id: "before", comment: "Before the move, finish development carefully.", topics: ["development"], category: "opening", audienceRating: 800 }],
      [afterE4Key]: [{ id: "after", comment: "After the pawn move, the center has changed.", topics: ["center"], category: "opening", audienceRating: 800 }],
    },
    profiles: {},
  };
  const result = pgnKnowledgeForEngineContext({
    engineContext: {
      fen: `${beforeKey} 0 1`,
      moveReview: { playedMove: { uci: "e2e4" } },
      lines: [{ bestMove: { uci: "d2d4" } }],
    },
    rating: 800,
    index: multiPositionIndex,
  });
  assert.equal(result.some((entry) => entry.positionRole === "before"), true);
  assert.equal(result.some((entry) => entry.positionRole === "after_played"), true);
});
