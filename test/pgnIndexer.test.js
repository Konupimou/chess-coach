import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  buildCoachPgnIndex,
  commentTopics,
  compactCoachPgnIndex,
  knowledgeCategoryForRecord,
  neutralizePgnKnowledgeText,
  normalizedPositionKey,
  sanitizePgnComment,
} from "../scripts/build-coach-pgn-index.mjs";

const annotatedPgn = `[Event "Geheime Lektion"]
[Annotator "Max Mustermann"]
[Result "*"]

1. e4 {[%eval 0.20] According to Max Mustermann: Controls the center and helps development. A second supporting sentence. A third sentence is omitted.} e5
2. Nf3 {Develops a piece and attacks the center.} *
`;

test("PGN-Importer dedupliziert Dateien und indexiert kommentierte Stellungen", async () => {
  const directory = await mkdtemp(join(tmpdir(), "coach-pgn-"));
  try {
    await writeFile(join(directory, "Beginner Fundamentals.pgn"), annotatedPgn);
    await writeFile(join(directory, "copy.pgn"), annotatedPgn);
    await writeFile(join(directory, "empty.pgn"), `[Event "Ohne Kommentar"]\n\n1. d4 d5 *\n`);

    const index = await buildCoachPgnIndex({
      inputDir: directory,
      sourceLimit: 10,
      positionLimit: 2,
      totalLimit: 20,
    });

    assert.equal(index.stats.files, 3);
    assert.equal(index.stats.uniqueFiles, 2);
    assert.equal(index.stats.duplicateFiles, 1);
    assert.equal(index.stats.commentsIndexed, 2);
    assert.equal(index.stats.positions, 2);
    assert.match(index.duplicateFiles[0].sourceId, /^source\.[a-f0-9]{12}$/);
    const entries = Object.values(index.positions).flat();
    assert.equal(entries.every((entry) => entry.audienceRating === 800), true);
    assert.equal(entries.some((entry) => entry.comment.includes("[%eval")), false);
    assert.equal(entries.some((entry) => entry.topics.includes("center")), true);
    const compact = compactCoachPgnIndex(index);
    assert.equal(compact.version, 5);
    assert.equal(Array.isArray(Object.values(compact.positions)[0][0]), true);
    assert.equal(Array.isArray(Object.values(compact.profiles)[0]), true);
    assert.equal("sourceNames" in compact, false);
    assert.equal(compact.sourceCount, 2);
    assert.deepEqual(compact.categories, ["opening", "middlegame", "endgame", "other"]);
    assert.equal(compact.categoryBuckets.opening.length > 0, true);
    assert.equal(compact.categorySummaries.opening.entries, 2);
    assert.equal(Array.isArray(compact.positionKeys), true);
    assert.equal(Object.keys(compact.searchBuckets).length > 0, true);
    assert.equal(Object.values(compact.positions)[0][0].length, 7);
    assert.equal("sources" in compact, false);
    const serialized = JSON.stringify(compact);
    assert.doesNotMatch(serialized, /Beginner Fundamentals|Max Mustermann|Geheime Lektion/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("PGN-Helfer entfernen Direktiven und bewahren nur vollständige FEN-Felder", () => {
  assert.equal(
    sanitizePgnComment("  [%clk 0:10:00] A useful <b>central</b> plan.  "),
    "A useful central plan.",
  );
  assert.deepEqual(commentTopics("A tactical fork in the center."), ["tactics", "center"]);
  assert.equal(
    neutralizePgnKnowledgeText("According to Max Mustermann: Improve the worst piece.", {
      attributions: ["Max Mustermann"],
    }),
    "Improve the worst piece.",
  );
  assert.equal(knowledgeCategoryForRecord({ ply: 8 }, { phase: "o" }), "opening");
  assert.equal(knowledgeCategoryForRecord({ ply: 42 }, { phase: "o" }), "middlegame");
  assert.equal(knowledgeCategoryForRecord({ ply: 42 }, { phase: "e" }), "endgame");
  assert.equal(knowledgeCategoryForRecord({}, null), "other");
  assert.equal(
    normalizedPositionKey("8/8/8/8/8/8/8/8 w - - 4 17"),
    "8/8/8/8/8/8/8/8 w - -",
  );
});

test("PGN-Helfer entfernen historische Namensverweise aus dem Lerntext", () => {
  assert.equal(
    neutralizePgnKnowledgeText("Just like in Dvoretsky-Schmidt, White does not waste time defending the pawn."),
    "White does not waste time defending the pawn.",
  );
  assert.equal(
    neutralizePgnKnowledgeText("Here Yusupov had a stronger continuation than in the game."),
    "Here the player had a stronger continuation than in the game.",
  );
  assert.equal(
    neutralizePgnKnowledgeText("Juan Corzo y Principe - Jose Raul Capablanca, Havana 1913 (1) Why is the line-clearing idea useful?"),
    "Why is the line-clearing idea useful?",
  );
  assert.equal(
    neutralizePgnKnowledgeText("The position has mutual chances, J.Hellsten-L.Karlsson, Gothenburg Rapid-1996."),
    "The position has mutual chances.",
  );
});
