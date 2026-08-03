import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import {
  buildCoachPgnIndex,
  commentTopics,
  compactCoachPgnIndex,
  knowledgeCategoryForRecord,
  neutralizePgnKnowledgeText,
  normalizedPositionKey,
  sanitizePgnComment,
} from "../scripts/build-coach-pgn-index.mjs";

const execFileAsync = promisify(execFile);
const indexerScript = fileURLToPath(new URL("../scripts/build-coach-pgn-index.mjs", import.meta.url));

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
    assert.equal(compact.version, 7);
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
    assert.equal(entries.every((entry) => entry.annotation.scope === "exact_position_move"), true);
    assert.equal(entries.every((entry) => (
      entry.annotation.claims.every((claim) => claim.verificationStatus === "automatically_verified")
    )), true);
    assert.equal(index.stats.verifiedFactEntries, 2);
    assert.equal(index.stats.quarantinedComments, 0);
    assert.equal(compact.processing.runtimeFactsOnly, false);
    assert.equal(compact.processing.derivedCommentInsightsIncluded, true);
    assert.equal(compact.processing.rawCommentProseIncluded, false);
    assert.equal("sources" in compact, false);
    const serialized = JSON.stringify(compact);
    assert.doesNotMatch(serialized, /Beginner Fundamentals|Max Mustermann|Geheime Lektion/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("Kommentarwissen wird anonymisiert, am Brett geprüft und erst mit Quellenkonsens indexiert", async () => {
  const directory = await mkdtemp(join(tmpdir(), "coach-pgn-comment-knowledge-"));
  const lesson = (event) => `[Event "${event}"]
[SetUp "1"]
[FEN "8/8/8/4P3/8/8/4K3/7k w - - 0 1"]
[Result "*"]

1. Kf3 {The passed pawn should be supported before it advances.} Kg1 *
`;
  try {
    await writeFile(join(directory, "lesson-one.pgn"), lesson("One"));
    await writeFile(join(directory, "lesson-two.pgn"), lesson("Two"));
    const index = await buildCoachPgnIndex({
      inputDir: directory,
      sourceLimit: 10,
      positionLimit: 2,
      totalLimit: 20,
    });

    assert.equal(index.stats.commentInsightCandidates, 2);
    assert.equal(index.stats.commentInsightsConsensusVerified, 1);
    assert.equal(index.stats.commentInsightsIndexed, 1);
    const insight = Object.values(index.positions).flat()
      .find((entry) => entry.annotation.type === "comment_derived_concept");
    assert.ok(insight);
    assert.match(insight.comment, /Freibauer/iu);
    assert.doesNotMatch(JSON.stringify(compactCoachPgnIndex(index)), /passed pawn|lesson-one|lesson-two/iu);
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

test("PGN-Anonymisierung entfernt Personen, Spielertitel, Werke und Zitatblöcke allgemein", () => {
  const cases = [
    {
      input: "Bobby Fischer preferred this move. The knight on e5 attacks c6.",
      absent: /Bobby|Fischer/u,
      present: /knight on e5 attacks c6/iu,
    },
    {
      input: "This idea appeared in Lovelace–Turing, London 1952. The move opens the d-file.",
      absent: /Lovelace|Turing|London|1952/u,
      present: /move opens the d-file/iu,
    },
    {
      input: "This opening was one of the main weapons of Garry Kasparov. Black attacks the center.",
      absent: /Garry|Kasparov|main weapons/iu,
      present: /Black attacks the center/iu,
    },
    {
      input: "Brilliant prep by Team Judit Polgar for her match with Boris Spassky in 1993. This move prepares a piece sacrifice.",
      absent: /Judit|Polgar|Boris|Spassky|1993/iu,
      present: /move prepares a piece sacrifice/iu,
    },
    {
      input: "A beautiful forcing solution from the world champion!",
      absent: /world champion/iu,
      present: /beautiful forcing solution/iu,
    },
    {
      input: "I checked the line with an IM. The rook belongs on the open file.",
      absent: /\bIM\b/u,
      present: /rook belongs on the open file/iu,
    },
    {
      input: "Recommended in the book Winning Chess by Ada Lovelace, this move controls e5. The knight attacks c6.",
      absent: /Winning Chess|Ada|Lovelace|book/iu,
      present: /knight attacks c6/iu,
    },
    {
      input: "As Grace Hopper wrote in her notes, 'Eventually I chose h4.' White prevents ...f5.",
      absent: /Grace|Hopper|notes|Eventually/iu,
      present: /White prevents/iu,
    },
    {
      input: "Williams-Withers, The Bristol Chess Club, Book II, 1841 (1-0 en 24)",
      absent: /Williams|Withers|Bristol|Book|1841/iu,
      expected: "",
    },
  ];

  cases.forEach(({ input, absent, present, expected }) => {
    const result = neutralizePgnKnowledgeText(input);
    if (expected !== undefined) assert.equal(result, expected, input);
    assert.doesNotMatch(result, absent, input);
    if (present) assert.match(result, present, input);
  });
  assert.equal(
    neutralizePgnKnowledgeText("@@StartBlockQuote@@R. Fischer@@EndBlockQuote@@"),
    "",
  );
  assert.equal(
    neutralizePgnKnowledgeText("@@StartBlockQuote@@A truncated quotation without a closing marker…"),
    "",
  );
});

test("PGN-Anonymisierung bewahrt Schachnamen statt sie als Personen zu entfernen", () => {
  assert.equal(
    neutralizePgnKnowledgeText("Fischer Random uses a shuffled back rank."),
    "Fischer Random uses a shuffled back rank.",
  );
  assert.equal(
    neutralizePgnKnowledgeText("The King's Indian Defense gives Black kingside play."),
    "The King's Indian Defense gives Black kingside play.",
  );
  assert.equal(
    neutralizePgnKnowledgeText("The Schara-Hennig creates an isolated pawn."),
    "The Schara-Hennig creates an isolated pawn.",
  );
  assert.equal(
    neutralizePgnKnowledgeText("Alekhine's Gun puts both rooks behind the queen.", {
      attributions: ["Alekhine"],
    }),
    "Alekhine's Gun puts both rooks behind the queen.",
  );
  assert.equal(
    neutralizePgnKnowledgeText("The Lucena Position is a winning rook endgame.", {
      attributions: ["Lucena"],
    }),
    "The Lucena Position is a winning rook endgame.",
  );
});

test("neue Intake-PGNs werden vor dem alphabetisch früheren used-Archiv verarbeitet", async () => {
  const directory = await mkdtemp(join(tmpdir(), "coach-pgn-intake-priority-"));
  try {
    const usedDirectory = join(directory, "used");
    await mkdir(usedDirectory);
    await Promise.all([
      writeFile(
        join(directory, "z-new-intake.pgn"),
        `[Event "Neu"]\n[Result "*"]\n\n1. e4 {Fresh intake controls the center.} e5 *\n`,
        "utf8",
      ),
      writeFile(
        join(usedDirectory, "a-old-archive.pgn"),
        `[Event "Alt"]\n[Result "*"]\n\n1. d4 {Archived source controls the center.} d5 *\n`,
        "utf8",
      ),
    ]);

    const index = await buildCoachPgnIndex({
      inputDir: directory,
      additionalInputDirs: [usedDirectory],
      sourceLimit: 10,
      positionLimit: 2,
      totalLimit: 1,
    });
    const comments = Object.values(index.positions).flat().map((entry) => entry.comment);

    assert.deepEqual(comments, ["Nach e4 steht ein Bauer im Zentrum."]);
    assert.match(index.processedSourceFiles[0], /z-new-intake\.pgn$/u);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("PGN-CLI baut aus Eingang und used und archiviert neue Quellen erst nach Erfolg", async () => {
  const directory = await mkdtemp(join(tmpdir(), "coach-pgn-archive-integration-"));
  try {
    const usedDirectory = join(directory, "used");
    const newSource = join(directory, "new-lesson.pgn");
    const oldSource = join(usedDirectory, "old-lesson.pgn");
    const outputPath = join(directory, "output", "index.json");
    await mkdir(usedDirectory);
    await Promise.all([
      writeFile(oldSource, annotatedPgn.replace("Geheime Lektion", "Alte Lektion"), "utf8"),
      writeFile(newSource, `[Event "Neue Lektion"]\n[Result "*"]\n\n1. d4 {Controls the center.} d5 *\n`, "utf8"),
    ]);

    await execFileAsync(process.execPath, [
      indexerScript,
      `--input=${directory}`,
      `--output=${outputPath}`,
      `--cache=${join(directory, "cache")}`,
      "--source-limit=10",
      "--total-limit=20",
    ]);

    const compact = JSON.parse(await readFile(outputPath, "utf8"));
    assert.equal(compact.sourceCount, 2);
    await assert.rejects(access(newSource), { code: "ENOENT" });
    await access(join(usedDirectory, "new-lesson.pgn"));
    await access(oldSource);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("PGN-CLI lässt Quellen im Eingang, wenn der Ergebnisindex nicht geschrieben wird", async () => {
  const directory = await mkdtemp(join(tmpdir(), "coach-pgn-archive-failure-"));
  try {
    const source = join(directory, "lesson.pgn");
    const invalidOutputPath = join(directory, "output-is-a-directory");
    await Promise.all([
      writeFile(source, annotatedPgn, "utf8"),
      mkdir(invalidOutputPath),
    ]);

    await assert.rejects(execFileAsync(process.execPath, [
      indexerScript,
      `--input=${directory}`,
      `--output=${invalidOutputPath}`,
      `--cache=${join(directory, "cache")}`,
      "--source-limit=10",
      "--total-limit=20",
    ]));

    await access(source);
    await assert.rejects(access(join(directory, "used", "lesson.pgn")), { code: "ENOENT" });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
