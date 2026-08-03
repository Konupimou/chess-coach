import test from "node:test";
import assert from "node:assert/strict";
import {
  normalizedPgnPositionKey,
  pgnKnowledgeForEngineContext,
  pgnKnowledgeForPosition,
  pgnKnowledgeIndexStats,
  pgnQuestionTopics,
  isCoachReadyPgnEntry,
} from "../pgnKnowledge.js";
import {
  compactPositionSimilarityProfile,
  positionSimilarityProfile,
} from "../positionSimilarity.js";

const fen = "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1";
const key = "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq -";
const approved = (entry, status = "human_approved") => ({
  ...entry,
  annotation: {
    type: "strategic",
    claims: [{ field: "idea", verificationStatus: status }],
    alternatives: [],
  },
});
const index = {
  version: 1,
  stats: { positions: 1, commentsIndexed: 2, uniqueFiles: 2 },
  positions: {
    [key]: [
      approved({
        id: "advanced",
        comment: "Der Bauer nimmt Raum und hält ein Feld im Zentrum.",
        topics: ["strategy", "center"],
        audienceRating: 1800,
      }),
      approved({
        id: "basic",
        comment: "Der Bauer nimmt Raum im Zentrum.",
        topics: ["center"],
        audienceRating: 800,
      }),
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
      [similarKey]: [approved({
        id: "structure",
        comment: "Bring erst deine übrigen Figuren ins Spiel. Greife danach im Zentrum an.",
        topics: ["development", "center"],
        audienceRating: 800,
      })],
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

test("zuggebundene PGN-Brettfakten gelten nur für die exakte FEN", () => {
  const storedKey = "rnbqkbnr/pppppppp/8/8/4P3/5N2/PPPP1PPP/RNBQKB1R b KQkq -";
  const exactMoveFact = {
    id: "exact-development",
    comment: "Nf3 entwickelt den Springer.",
    topics: ["development"],
    audienceRating: 800,
    category: "opening",
    uci: "g1f3",
    annotation: {
      type: "deterministic_move_fact",
      scope: "exact_position_move",
      claims: [{
        field: "boardFact.development",
        confidence: 1,
        verificationStatus: "automatically_verified",
      }],
      alternatives: [],
    },
  };
  const factIndex = {
    positions: { [storedKey]: [exactMoveFact] },
    profiles: {
      [storedKey]: compactPositionSimilarityProfile(
        positionSimilarityProfile(storedKey, { openingFamily: "King's Pawn Game" }),
      ),
    },
  };

  const exact = pgnKnowledgeForPosition({
    fen: `${storedKey} 0 2`,
    rating: 800,
    allowedExactMoveUcis: ["g1f3"],
    index: factIndex,
  });
  assert.equal(exact.length, 1);
  assert.match(exact[0].usage, /sicheren Brettfakt/u);
  assert.equal(exact[0].provenance.uci, "g1f3");

  assert.deepEqual(pgnKnowledgeForPosition({
    fen: `${storedKey} 0 2`,
    rating: 800,
    allowedExactMoveUcis: ["b1c3"],
    index: factIndex,
  }), []);
  assert.deepEqual(pgnKnowledgeForPosition({
    fen: `${storedKey} 0 2`,
    rating: 800,
    index: factIndex,
  }), []);

  const similar = pgnKnowledgeForPosition({
    fen,
    rating: 800,
    question: "Wie entwickle ich meine Figuren?",
    openingFamily: "King's Pawn Game",
    index: factIndex,
  });
  assert.deepEqual(similar, []);
});

test("Engine-Kontext liefert einen Brettfakt nur für einen geprüften Zug", () => {
  const startKey = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq -";
  const exactMoveFact = {
    id: "e4-fact",
    comment: "Nach e4 steht ein Bauer im Zentrum.",
    topics: ["center"],
    audienceRating: 800,
    category: "opening",
    uci: "e2e4",
    annotation: {
      type: "deterministic_move_fact",
      scope: "exact_position_move",
      claims: [{
        field: "boardFact.central_pawn",
        confidence: 1,
        verificationStatus: "automatically_verified",
      }],
      alternatives: [],
    },
  };
  const factIndex = { positions: { [startKey]: [exactMoveFact] }, profiles: {} };

  const wrongMove = pgnKnowledgeForEngineContext({
    engineContext: {
      fen: `${startKey} 0 1`,
      moveReview: { playedMove: { uci: "g1f3" } },
      lines: [{ bestMove: { uci: "d2d4" } }],
    },
    rating: 800,
    index: factIndex,
  });
  assert.deepEqual(wrongMove, []);

  const matchingCandidate = pgnKnowledgeForEngineContext({
    engineContext: {
      fen: `${startKey} 0 1`,
      moveReview: { playedMove: { uci: "g1f3" } },
      lines: [{ bestMove: { uci: "e2e4" } }],
    },
    rating: 800,
    index: factIndex,
  });
  assert.equal(matchingCandidate.length, 1);
  assert.equal(matchingCandidate[0].provenance.uci, "e2e4");
  assert.equal(matchingCandidate[0].positionRole, "before");
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
      [known]: [["concept", "Nutze deine Bauernmehrheit und schütze deinen König.", ["strategy"], 1000, "middlegame", ["game", 1, 1, "w", "Bb6", "a5b6", true], ["strategic", [["idea", 90, "human_approved"]], []]]],
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

test("anonymisiertes Kommentarwissen wird nur mit demselben Brettkonzept übertragen", () => {
  const known = "1b2q1k1/p7/p1p2p2/B1P3pp/3P1p2/7P/PP1Q1PPK/8 w - -";
  const unknown = "1b2q1k1/p7/pBp2p2/2P3pp/3P1p2/7P/PP1Q1PPK/8 b - -";
  const profile = positionSimilarityProfile(known);
  const commentIndex = {
    positionKeys: [known],
    searchBuckets: Object.fromEntries([
      ...profile.concepts.conceptIds.map((id) => [`concept:${id}`, [0]]),
      [`phase:${profile.concepts.phase}`, [0]],
    ]),
    positions: {
      [known]: [[
        "comment-concept",
        "Ein isolierter Bauer braucht aktives Figurenspiel. Nutze dafür offene Linien.",
        ["pawn_structure", "strategy"],
        1000,
        "middlegame",
        ["game", 1, 1, "w", "Bb6", "a5b6", true],
        [
          "comment_derived_concept",
          [["commentConcept.isolated_pawn", 96, "consensus_verified"]],
          [],
          "structural_concept",
          ["isolated_pawn"],
        ],
      ]],
    },
    profiles: { [known]: compactPositionSimilarityProfile(profile) },
  };

  const result = pgnKnowledgeForPosition({
    fen: `${unknown} 0 1`,
    question: "Was ist hier der Plan?",
    index: commentIndex,
  });
  assert.equal(result.length, 1);
  assert.equal(result[0].annotation.type, "comment_derived_concept");
  assert.equal(result[0].annotation.scope, "structural_concept");
  assert.equal(result[0].match.type, "concept_transfer");
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
      [key]: [["compact", "Der Bauer auf e4 greift das Zentrum an.", ["center"], 800, "opening", ["game", 1, 1, "w", "e4", "e2e4", true], ["strategic", [["idea", 90, "human_approved"]], []]]],
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
    verifiedFacts: 0,
    commentInsights: 0,
    consensusInsights: 0,
    coachReady: 2,
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
      [beforeKey]: [approved({ id: "before", comment: "Bring vor dem Angriff deine Figuren ins Spiel.", topics: ["development"], category: "opening", audienceRating: 800 })],
      [afterE4Key]: [approved({ id: "after", comment: "Der Bauer auf e4 greift nun das Zentrum an.", topics: ["center"], category: "opening", audienceRating: 800 })],
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

test("nur freigegebene, verständliche deutsche PGN-Hinweise erreichen den Coach", () => {
  assert.equal(isCoachReadyPgnEntry(approved({
    comment: "Der Springer auf f3 greift den Bauern auf e5 an.",
    audienceRating: 800,
    category: "opening",
  })), true);
  assert.equal(isCoachReadyPgnEntry(approved({
    comment: "The knight on f3 attacks the pawn on e5.",
    audienceRating: 800,
    category: "opening",
  })), false);
  assert.equal(isCoachReadyPgnEntry(approved({
    comment: "Moving away from the danger diagonal.",
    audienceRating: 800,
    category: "opening",
  })), false);
  assert.equal(isCoachReadyPgnEntry(approved({
    comment: "Der Springer auf f3 greift den Bauern auf e5 an.",
    audienceRating: 800,
    category: "opening",
  }, "strategic_only")), false);
  assert.equal(isCoachReadyPgnEntry(approved({
    comment: "Der Springer auf f3 greift den Bauern auf e5 an.",
    audienceRating: 800,
    category: "opening",
  }, "unverified")), false);
  assert.equal(isCoachReadyPgnEntry(approved({
    comment: "Laut Kapitel 4 sollte der Springer nach f3.",
    audienceRating: 800,
    category: "opening",
  })), false);
});

test("vorläufige PGN-Statuswerte bleiben auch bei gutem deutschem Text gesperrt", () => {
  const entry = {
    comment: "Der Springer auf f3 greift den Bauern auf e5 an.",
    audienceRating: 800,
    category: "opening",
  };

  ["strategic_only", "unverified", "pending", "auto_extracted", ""].forEach((status) => {
    assert.equal(isCoachReadyPgnEntry(approved(entry, status)), false, status);
  });
  [
    "automatically_verified",
    "engine_confirmed",
    "compatible",
    "consensus_verified",
    "human_approved",
  ].forEach((status) => {
    assert.equal(isCoachReadyPgnEntry(approved(entry, status)), true, status);
  });
});
