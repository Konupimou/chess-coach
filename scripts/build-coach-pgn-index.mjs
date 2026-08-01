import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createInterface } from "node:readline";
import {
  annotationRecords,
  parseAnnotatedPgn,
} from "../pgnPipeline.js";
import {
  compactPositionSimilarityProfile,
  positionSimilarityProfile,
} from "../positionSimilarity.js";
import { conceptSearchTokens } from "../positionConcepts.js";

const INDEX_VERSION = 5;
const SOURCE_CACHE_VERSION = 3;
const DEFAULT_SOURCE_LIMIT = 500;
const DEFAULT_POSITION_LIMIT = 3;
const DEFAULT_TOTAL_LIMIT = 25_000;
const MAX_COMMENT_LENGTH = 360;
export const PGN_KNOWLEDGE_CATEGORIES = Object.freeze([
  "opening",
  "middlegame",
  "endgame",
  "other",
]);
const CATEGORY_ORDER = new Map(PGN_KNOWLEDGE_CATEGORIES.map((category, index) => [category, index]));

const TOPIC_PATTERNS = Object.freeze({
  tactics: /\b(?:tactic|taktik|combination|kombination|fork|gabel|pin|fessel|skewer|spieß|zwischenzug|sacrifice|opfer|matt|checkmate|deflection|ablenkung|overload|überlast)\w*/iu,
  calculation: /\b(?:calculat|berechn|candidate move|kandidatenzug|variation|variante|forcing|forcieren)\w*/iu,
  development: /\b(?:develop|entwicklung|entwickl|minor piece|leichtfigur|tempo)\w*/iu,
  center: /\b(?:center|centre|zentrum|central)\w*/iu,
  king_safety: /\b(?:king safety|königssicherheit|castle|castling|rochade|king attack|königsangriff)\w*/iu,
  pawn_structure: /\b(?:pawn structure|bauernstruktur|isolated pawn|isolierter bauer|backward pawn|rückständiger bauer|passed pawn|freibauer|weak pawn|schwacher bauer|hanging pawn|hängende bauern|minority attack|minderheitsangriff)\w*/iu,
  strategy: /\b(?:strategy|strategie|plan|prophyl|weakness|schwäche|outpost|vorposten|improv|verbesser|space|raum)\w*/iu,
  endgame: /\b(?:endgame|endspiel|opposition|rook ending|turmendspiel|pawn ending|bauernendspiel)\w*/iu,
  opening: /\b(?:opening|eröffnung|repertoire|theory|theorie|novelty|neuerung)\w*/iu,
});

function numberOption(argv, name, fallback) {
  const prefix = `--${name}=`;
  const raw = argv.find((value) => value.startsWith(prefix))?.slice(prefix.length);
  const parsed = Number.parseInt(raw || "", 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function stringOption(argv, name, fallback = "") {
  const prefix = `--${name}=`;
  return argv.find((value) => value.startsWith(prefix))?.slice(prefix.length) || fallback;
}

export function normalizedPositionKey(fen) {
  if (typeof fen !== "string") return "";
  const fields = fen.trim().split(/\s+/);
  return fields.length >= 4 ? fields.slice(0, 4).join(" ") : "";
}

export function sanitizePgnComment(value) {
  const cleaned = String(value || "")
    .replace(/\[%[^\]]*\]/g, " ")
    .replace(/<[^>]*>/g, " ")
    .replace(/\{+|\}+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (cleaned.length <= MAX_COMMENT_LENGTH) return cleaned;
  const shortened = cleaned.slice(0, MAX_COMMENT_LENGTH + 1);
  const boundary = shortened.lastIndexOf(" ");
  return `${shortened.slice(0, boundary > 220 ? boundary : MAX_COMMENT_LENGTH).trim()}…`;
}

function escapedRegExp(value) {
  return String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function neutralizePgnKnowledgeText(value, { attributions = [] } = {}) {
  let text = sanitizePgnComment(value)
    .replace(/^\s*\[(?:#|[-+=!?]{1,3})\]\s*/u, "")
    .replace(/^\s*[^.!?]{2,80}\s[-–—]\s[^.!?]{2,80},\s*[^.!?]{0,50}\b\d{4}\s*(?:\(\d+\))?\s*/u, "")
    .replace(/^\s*[\p{Lu}][\p{L}.'’,-]+(?:\s+[\p{Lu}][\p{L}.'’,-]+){0,4}\s+[-–—]\s+[\p{Lu}][\p{L}.'’,-]+(?:\s+[\p{Lu}][\p{L}.'’,-]+){0,4}(?:,\s*[^.!?]{0,50})?(?:\s*\(\d+\))?\s*/u, "")
    .replace(/https?:\/\/\S+|\b\S+@\S+\.\S+\b/giu, " ")
    .replace(/\((?:see|vgl\.?|source|quelle|chapter|kapitel|page|seite|by)\b[^)]*\)/giu, " ")
    .replace(/^\s*(?:according to|laut|nach ansicht von)\b[^,:;.]{1,100}[,:]\s*/iu, "")
    .replace(/^\s*(?:i think|i believe|in my opinion|meiner meinung nach)\b[:,]?\s*/iu, "");
  for (const attribution of [...new Set(attributions.map((item) => String(item || "").trim()))]
    .sort((left, right) => right.length - left.length)) {
    if (attribution.length < 4) continue;
    text = text.replace(new RegExp(escapedRegExp(attribution), "giu"), " ");
  }
  return text
    .replace(/,\s*[\p{L}.'’]{2,40}(?:\s+[\p{L}.'’]{2,40}){0,3}\s*[-–—]\s*[\p{L}.'’]{2,40}(?:\s+[\p{L}.'’]{2,40}){0,3}\s*,[^\n]{0,100}\b(?:18|19|20)\d{2}\.?\s*$/u, ".")
    .replace(/^\s*(?:just like|as in|similar to)\s+[^,;.!?]{1,100}[,;]\s*/iu, "")
    .replace(/,?\s*(?:just like|as in|similar to)\s+[^,;.!?]{1,100}(?=[,;.!?]|$)/giu, "")
    .replace(/\b(?:recalling\s+)?(?:the\s+)?(?:previous|earlier)\s+[\p{Lu}][\p{L}'’.-]+\s+game\b/giu, "the previous example")
    .replace(/\b(?:belongs|is attributed)\s+to\s+[\p{Lu}][\p{L}'’.-]+\b/giu, "is a useful principle")
    .replace(/\b(how|why)\s+did\s+[\p{Lu}][\p{L}'’.-]+\b/giu, "$1 did the player")
    .replace(/\bhere\s+[\p{Lu}][\p{L}'’.-]+\b/giu, "Here the player")
    .replace(/\b[\p{Lu}][\p{L}'’.-]{3,}(?:'s|’s)\b/gu, "the player's")
    .replace(/\b[\p{Lu}][\p{L}'’.-]{3,}\s+(?=(?:would|wouldn't|could|couldn't|had|has|kept|played|took|takes|said|believed|reckoned)\b)/gu, "the player ")
    .replace(/^\s*(?:GM|IM|FM|WGM|WIM|WFM)\s+[\p{L}'’-]+(?:\s+[\p{L}'’-]+)?\s*:\s*/iu, "")
    .replace(/^\s*[\p{Lu}][\p{L}'’-]+(?:\s+[\p{Lu}][\p{L}'’-]+){0,2}\s*:\s*/u, "")
    .replace(/\s+(?:'s|’s)\b/giu, "")
    .replace(/^\s*(?:recalling|as in)\s+(?:the\s+)?(?:previous|earlier)\s+game,?\s*/iu, "")
    .replace(/\s+/g, " ")
    .replace(/\s+([,.;:!?])/g, "$1")
    .trim();
}

function expandedAttributions(records, sourceName) {
  const values = new Set([sourceName, sourceName.replace(/[_-]+/g, " ")]);
  const addPerson = (person) => {
    const cleaned = String(person || "").replace(/\([^)]*\)/g, " ").replace(/\s+/g, " ").trim();
    if (!cleaned || /^(?:nn|unknown|anonymous|white|black)$/iu.test(cleaned)) return;
    values.add(cleaned);
    const surname = cleaned.includes(",")
      ? cleaned.split(",")[0].trim()
      : cleaned.split(/\s+/).at(-1);
    if (surname?.length >= 4) values.add(surname);
  };
  for (const record of records) {
    [record?.metadata?.white, record?.metadata?.black, record?.metadata?.annotator]
      .forEach(addPerson);
    [record?.metadata?.event, record?.metadata?.source]
      .filter((value) => String(value || "").trim().length >= 6)
      .forEach((value) => values.add(String(value).trim()));
  }
  return [...values];
}

export function summarizePgnKnowledge(record, comment, { attributions = [] } = {}) {
  const neutral = neutralizePgnKnowledgeText(comment, {
    attributions: [
      ...attributions,
      record?.metadata?.event,
      record?.metadata?.site,
      record?.metadata?.white,
      record?.metadata?.black,
      record?.metadata?.annotator,
      record?.metadata?.source,
    ],
  });
  if (!neutral) return "";
  const sentences = neutral.split(/(?<=[.!?])\s+/u).filter(Boolean);
  const summary = (sentences.length > 1 ? sentences.slice(0, 2).join(" ") : neutral).trim();
  if (summary.length <= 280) return summary;
  const shortened = summary.slice(0, 281);
  const boundary = Math.max(shortened.lastIndexOf(". "), shortened.lastIndexOf("; "), shortened.lastIndexOf(" "));
  return `${shortened.slice(0, boundary > 180 ? boundary : 280).trim()}…`;
}

export function knowledgeCategoryForRecord(record, profile) {
  if (!profile) return "other";
  if (profile.phase === "e") return "endgame";
  if (profile.phase === "m") return "middlegame";
  const ply = Number.parseInt(record?.ply, 10);
  if (profile.phase === "o" && (!Number.isInteger(ply) || ply <= 30)) return "opening";
  if (profile.phase === "o") return "middlegame";
  return "other";
}

function neutralMetadata(metadata = {}) {
  return {
    result: metadata.result || "*",
    whiteElo: metadata.whiteElo ?? null,
    blackElo: metadata.blackElo ?? null,
    eco: metadata.eco || "",
    opening: metadata.opening || "",
    timeControl: metadata.timeControl || "",
    setUp: metadata.setUp === true,
    startFen: metadata.startFen || "",
  };
}

function neutralTrainingRecord(record, sourceId, sourceAttributions = []) {
  const attributions = [
    ...sourceAttributions,
    record?.metadata?.event,
    record?.metadata?.site,
    record?.metadata?.white,
    record?.metadata?.black,
    record?.metadata?.annotator,
    record?.metadata?.source,
  ];
  const originalComment = summarizePgnKnowledge(record, record?.annotation?.originalComment || "", { attributions });
  return {
    ...record,
    source: sourceId,
    metadata: neutralMetadata(record?.metadata),
    annotation: {
      ...record.annotation,
      originalComment,
      claims: (record.annotation?.claims || []).map((claim) => ({
        ...claim,
        value: neutralizePgnKnowledgeText(claim.value, { attributions }),
        excerpt: neutralizePgnKnowledgeText(claim.excerpt, { attributions }),
      })),
    },
  };
}

export function commentTopics(comment) {
  return Object.entries(TOPIC_PATTERNS)
    .filter(([, pattern]) => pattern.test(comment))
    .map(([topic]) => topic);
}

export function audienceRatingForSource(sourceName) {
  const source = String(sourceName || "").toLowerCase();
  if (/beginner|fundamental|basic|simplified|introduction|preventing blunders/.test(source)) return 800;
  if (/dvoretsky|advanced|grandmaster|candidate_moves|ambitious|encyclopedia/.test(source)) return 1800;
  if (/strategy|middlegame|reassess|yusupov|woodpecker|pattern recognition/.test(source)) return 1400;
  return 1000;
}

async function sha256File(filePath) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(filePath)) hash.update(chunk);
  return hash.digest("hex");
}

async function* pgnGames(filePath) {
  const lines = createInterface({
    input: createReadStream(filePath, { encoding: "utf8" }),
    crlfDelay: Infinity,
  });
  let buffer = [];
  let hasEvent = false;
  for await (const rawLine of lines) {
    const line = rawLine.replace(/^\uFEFF/, "");
    const startsGame = /^\s*\[Event\s+"/i.test(line);
    if (startsGame && hasEvent && buffer.length > 0) {
      yield buffer.join("\n").trim();
      buffer = [];
      hasEvent = false;
    }
    if (startsGame) hasEvent = true;
    if (hasEvent || line.trim()) buffer.push(line);
  }
  if (buffer.some((line) => line.trim())) yield buffer.join("\n").trim();
}

function stableEntryId(record) {
  return createHash("sha1")
    .update(`${record.gameId}\n${record.path}\n${record.fenBefore}\n${record.uci}\n${record.annotation.originalComment}`)
    .digest("hex")
    .slice(0, 16);
}

function sourceCachePath(cacheDir, digest, sourceLimit) {
  return cacheDir ? join(cacheDir, `${digest}-v${SOURCE_CACHE_VERSION}-${sourceLimit}.json`) : "";
}

async function readSourceCache(cacheDir, digest, sourceLimit) {
  if (!cacheDir) return null;
  try {
    const value = JSON.parse(await readFile(sourceCachePath(cacheDir, digest, sourceLimit), "utf8"));
    return value?.pipelineVersion === SOURCE_CACHE_VERSION ? value : null;
  } catch {
    return null;
  }
}

async function writeSourceCache(cacheDir, digest, sourceLimit, value) {
  if (!cacheDir) return;
  await mkdir(cacheDir, { recursive: true });
  await writeFile(sourceCachePath(cacheDir, digest, sourceLimit), `${JSON.stringify(value)}\n`, "utf8");
}

async function processSource({ filePath, sourceId, sourceName, sourceLimit, digest }) {
  const rawRecords = [];
  const errors = [];
  const seenGames = new Set();
  let games = 0;
  let gamesWithAnnotations = 0;
  let duplicateGames = 0;
  let variants = 0;
  let nags = 0;
  let claims = 0;
  let invalidGames = 0;
  for await (const rawPgn of pgnGames(filePath)) {
    games += 1;
    const parsed = parseAnnotatedPgn(rawPgn, { source: sourceId, gameOrdinal: games });
    if (seenGames.has(parsed.gameId)) {
      duplicateGames += 1;
      continue;
    }
    seenGames.add(parsed.gameId);
    if (!parsed.valid) invalidGames += 1;
    if (errors.length < 500) {
      errors.push(...parsed.errors.slice(0, 500 - errors.length).map((error) => ({ gameId: parsed.gameId, ...error })));
    }
    variants += parsed.moves.filter((move) => move.variationDepth > 0).length;
    nags += parsed.moves.reduce((sum, move) => sum + move.annotation.nags.length, 0);
    const annotated = annotationRecords(parsed);
    if (annotated.length > 0) gamesWithAnnotations += 1;
    for (const record of annotated) {
      if (rawRecords.length >= sourceLimit) break;
      rawRecords.push(record);
      claims += record.annotation.claims.length;
    }
    if (rawRecords.length >= sourceLimit) break;
  }
  const attributions = expandedAttributions(rawRecords, sourceName);
  const records = rawRecords.map((record) => neutralTrainingRecord(record, sourceId, attributions));
  return {
    pipelineVersion: SOURCE_CACHE_VERSION,
    digest,
    sourceId,
    records,
    errors,
    stats: { games, gamesWithAnnotations, duplicateGames, variants, nags, claims, invalidGames },
  };
}

export async function buildCoachPgnIndex({
  inputDir,
  sourceLimit = DEFAULT_SOURCE_LIMIT,
  positionLimit = DEFAULT_POSITION_LIMIT,
  totalLimit = DEFAULT_TOTAL_LIMIT,
  cacheDir = null,
  onProgress = null,
} = {}) {
  const directory = resolve(inputDir || "database");
  const files = (await readdir(directory, { withFileTypes: true }))
    .filter((entry) => entry.isFile() && /\.(?:pgn|txt)$/i.test(entry.name))
    .map((entry) => join(directory, entry.name))
    .sort((left, right) => left.localeCompare(right, "en"));
  const stats = {
    files: files.length,
    uniqueFiles: 0,
    duplicateFiles: 0,
    duplicateGames: 0,
    gamesSeen: 0,
    gamesWithComments: 0,
    invalidGames: 0,
    parseErrors: 0,
    commentsSeen: 0,
    commentsIndexed: 0,
    variationRecords: 0,
    nags: 0,
    structuredClaims: 0,
    positions: 0,
    categoryCounts: Object.fromEntries(PGN_KNOWLEDGE_CATEGORIES.map((category) => [category, 0])),
    truncatedByTotalLimit: false,
  };
  const duplicateFiles = [];
  const seenHashes = new Map();
  const seenRecords = new Set();
  const positions = new Map();
  const profiles = new Map();
  const sources = [];
  const trainingRecords = [];
  const parseErrors = [];

  for (const [fileIndex, filePath] of files.entries()) {
    const fileName = basename(filePath);
    const digest = await sha256File(filePath);
    const sourceId = `source.${digest.slice(0, 12)}`;
    if (seenHashes.has(digest)) {
      stats.duplicateFiles += 1;
      duplicateFiles.push({ sourceId, duplicateOfSourceId: seenHashes.get(digest) });
      continue;
    }
    seenHashes.set(digest, sourceId);
    stats.uniqueFiles += 1;
    const sourceName = fileName.replace(/\.(?:pgn|txt)$/i, "").replace(/\s+/g, " ").trim();
    const audienceRating = audienceRatingForSource(sourceName);
    const cached = await readSourceCache(cacheDir, digest, sourceLimit);
    const processed = cached || await processSource({ filePath, sourceId, sourceName, sourceLimit, digest });
    if (!cached) await writeSourceCache(cacheDir, digest, sourceLimit, processed);
    const safeRecords = processed.records.map((record) => neutralTrainingRecord(record, sourceId, [
      sourceName,
      sourceName.replace(/[_-]+/g, " "),
    ]));
    const sourceStats = processed.stats;
    stats.gamesSeen += sourceStats.games;
    stats.gamesWithComments += sourceStats.gamesWithAnnotations;
    stats.invalidGames += sourceStats.invalidGames;
    stats.duplicateGames += sourceStats.duplicateGames;
    stats.parseErrors += processed.errors.length;
    parseErrors.push(...processed.errors.slice(0, 20).map((error) => ({ sourceId, ...error })));

    let sourceEntries = 0;
    for (const record of safeRecords) {
      stats.commentsSeen += 1;
      if (stats.commentsIndexed >= totalLimit) break;
      const summary = summarizePgnKnowledge(record, record.annotation.originalComment);
      if (summary.length < 18 && record.annotation.nags.length === 0 && record.annotation.alternatives.length === 0) continue;
      const positionKey = normalizedPositionKey(record.fenBefore);
      if (!positionKey) continue;
      const id = stableEntryId(record);
      if (seenRecords.has(id)) continue;
      const existing = positions.get(positionKey) || [];
      if (existing.length >= positionLimit) continue;
      const fallbackComment = record.annotation.nags.length > 0
        ? `Bewertung des Zugs ${record.san}: ${record.annotation.nags.map((nag) => `$${nag}`).join(" ")}.`
        : record.annotation.alternatives[0]?.san
          ? `Als Alternative zu ${record.san} wird ${record.annotation.alternatives[0].san} angegeben.`
          : `Hinweis zum Zug ${record.san}.`;
      const displayComment = summary.length >= 18 ? summary : fallbackComment;
      const normalizedComment = displayComment.toLocaleLowerCase("de-DE");
      if (existing.some((entry) => entry.comment.toLocaleLowerCase("de-DE") === normalizedComment)) continue;
      const profile = profiles.get(positionKey) || positionSimilarityProfile(positionKey, {
        openingFamily: record.metadata.opening,
      });
      if (profile) profiles.set(positionKey, profile);
      const topics = uniqueTopics([
        ...commentTopics(displayComment),
        ...(record.annotation.type === "tactical" ? ["tactics"] : []),
        ...(record.annotation.type === "strategic" ? ["strategy"] : []),
      ]);
      const category = knowledgeCategoryForRecord(record, profile);
      const entry = {
        id,
        gameId: record.gameId,
        ply: record.ply,
        moveNumber: record.moveNumber,
        color: record.color,
        move: record.san,
        uci: record.uci,
        mainline: record.mainline,
        comment: displayComment,
        topics,
        category,
        audienceRating,
        annotation: {
          type: record.annotation.type,
          claims: record.annotation.claims.slice(0, 8),
          alternatives: record.annotation.alternatives.slice(0, 2),
        },
      };
      existing.push(entry);
      positions.set(positionKey, existing);
      seenRecords.add(id);
      sourceEntries += 1;
      stats.commentsIndexed += 1;
      stats.variationRecords += record.variationDepth > 0 ? 1 : 0;
      stats.nags += record.annotation.nags.length;
      stats.structuredClaims += record.annotation.claims.length;
      stats.categoryCounts[category] += 1;
      trainingRecords.push({
        ...record,
        knowledge: { category, summary: displayComment, topics },
      });
    }
    sources.push({
      sourceId,
      games: sourceStats.games,
      indexedComments: sourceEntries,
      invalidGames: sourceStats.invalidGames,
      parseErrors: processed.errors.length,
      variants: sourceStats.variants,
      nags: sourceStats.nags,
      audienceRating,
      cacheHit: Boolean(cached),
    });
    onProgress?.({
      fileIndex: fileIndex + 1,
      fileCount: files.length,
      category: "knowledge",
      indexedComments: stats.commentsIndexed,
      cacheHit: Boolean(cached),
    });
    if (stats.commentsIndexed >= totalLimit) {
      stats.truncatedByTotalLimit = true;
      break;
    }
  }

  stats.positions = positions.size;
  return {
    version: INDEX_VERSION,
    processing: {
      pipelineVersion: SOURCE_CACHE_VERSION,
      deterministic: true,
      anonymized: true,
      summarized: true,
      categories: PGN_KNOWLEDGE_CATEGORIES,
      engineAnalysisIncluded: false,
      generatedAnswersIncluded: false,
    },
    stats,
    duplicateFiles,
    parseErrors: parseErrors.slice(0, 500),
    sources,
    positions: Object.fromEntries([...positions.entries()].sort(([leftKey, leftEntries], [rightKey, rightEntries]) => (
      (CATEGORY_ORDER.get(leftEntries[0]?.category) ?? 99) - (CATEGORY_ORDER.get(rightEntries[0]?.category) ?? 99)
      || leftKey.localeCompare(rightKey, "en")
    ))),
    profiles: Object.fromEntries([...profiles.entries()].sort(([a], [b]) => a.localeCompare(b, "en"))),
    trainingRecords,
  };
}

function uniqueTopics(values) {
  return [...new Set(values)].sort();
}

function compactClaim(claim) {
  return [claim.field, Math.round(claim.confidence * 100), claim.verificationStatus];
}

function buildSearchBuckets(profiles, positionKeys) {
  const buckets = {};
  const keyIds = new Map(positionKeys.map((key, index) => [key, index]));
  for (const [positionKey, profile] of Object.entries(profiles)) {
    const id = keyIds.get(positionKey);
    if (!Number.isInteger(id)) continue;
    for (const token of conceptSearchTokens(profile?.concepts)) {
      if (!/^(?:pawn|concept|tactic):/.test(token)) continue;
      if (!buckets[token]) buckets[token] = [];
      buckets[token].push(id);
    }
  }
  return Object.fromEntries(Object.entries(buckets).filter(([, ids]) => ids.length > 1));
}

function buildCategoryOrganization(index, positionKeys) {
  const keyIds = new Map(positionKeys.map((key, id) => [key, id]));
  const categoryBuckets = Object.fromEntries(PGN_KNOWLEDGE_CATEGORIES.map((category) => [category, []]));
  const summaries = Object.fromEntries(PGN_KNOWLEDGE_CATEGORIES.map((category) => [category, {
    positions: 0,
    entries: 0,
    topics: {},
    concepts: [],
  }]));
  const concepts = Object.fromEntries(PGN_KNOWLEDGE_CATEGORIES.map((category) => [category, new Map()]));
  for (const [positionKey, entries] of Object.entries(index?.positions || {})) {
    const positionId = keyIds.get(positionKey);
    const categoriesAtPosition = new Set();
    for (const entry of entries) {
      const category = PGN_KNOWLEDGE_CATEGORIES.includes(entry.category) ? entry.category : "other";
      categoriesAtPosition.add(category);
      summaries[category].entries += 1;
      for (const topic of entry.topics || []) {
        summaries[category].topics[topic] = (summaries[category].topics[topic] || 0) + 1;
      }
    }
    const profileConcepts = index?.profiles?.[positionKey]?.concepts?.concepts || [];
    for (const category of categoriesAtPosition) {
      categoryBuckets[category].push(positionId);
      summaries[category].positions += 1;
      for (const concept of profileConcepts) {
        const aggregate = concepts[category].get(concept.id) || {
          positions: new Set(), plans: new Set(), counterplans: new Set(), failures: new Set(),
        };
        aggregate.positions.add(positionId);
        (concept.typicalPlan || []).forEach((item) => aggregate.plans.add(item));
        (concept.counterplan || []).forEach((item) => aggregate.counterplans.add(item));
        (concept.failureConditions || []).forEach((item) => aggregate.failures.add(item));
        concepts[category].set(concept.id, aggregate);
      }
    }
  }
  for (const category of PGN_KNOWLEDGE_CATEGORIES) {
    summaries[category].topics = Object.fromEntries(Object.entries(summaries[category].topics)
      .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0], "en")));
    summaries[category].concepts = [...concepts[category].entries()]
      .sort((left, right) => right[1].positions.size - left[1].positions.size || left[0].localeCompare(right[0], "en"))
      .slice(0, 30)
      .map(([id, value]) => [
        id,
        value.positions.size,
        [...value.plans].slice(0, 4),
        [...value.counterplans].slice(0, 3),
        [...value.failures].slice(0, 3),
      ]);
  }
  return { categoryBuckets, categorySummaries: summaries };
}

export function compactCoachPgnIndex(index) {
  const positions = Object.fromEntries(Object.entries(index?.positions || {}).map(([positionKey, entries]) => [
    positionKey,
    entries.map((entry) => [
      entry.id,
      entry.comment,
      entry.topics,
      entry.audienceRating,
      entry.category,
      [entry.gameId, entry.ply, entry.moveNumber, entry.color, entry.move, entry.uci, entry.mainline],
      [
        entry.annotation?.type || "unknown",
        (entry.annotation?.claims || []).map(compactClaim),
        (entry.annotation?.alternatives || []).map((alternative) => [
          alternative.san,
          alternative.uci,
          alternative.verificationStatus,
          Math.round(alternative.confidence * 100),
        ]),
      ],
    ]),
  ]));
  const profiles = Object.fromEntries(Object.entries(index?.profiles || {}).map(([positionKey, profile]) => [
    positionKey,
    compactPositionSimilarityProfile(profile),
  ]));
  const positionKeys = Object.keys(positions);
  const organization = buildCategoryOrganization(index, positionKeys);
  return {
    version: INDEX_VERSION,
    processing: index?.processing || {},
    stats: index?.stats || {},
    sourceCount: index?.stats?.uniqueFiles || 0,
    categories: PGN_KNOWLEDGE_CATEGORIES,
    ...organization,
    positionKeys,
    positions,
    profiles,
    searchBuckets: buildSearchBuckets(index?.profiles || {}, positionKeys),
  };
}

export function trainingExport(index) {
  return {
    version: 2,
    purpose: "validated_training_candidate_export",
    lifecycle: "generated",
    anonymized: true,
    categorized: true,
    containsGeneratedCoachAnswers: false,
    processing: index?.processing || {},
    stats: index?.stats || {},
    records: index?.trainingRecords || [],
    errors: index?.parseErrors || [],
  };
}

async function main() {
  const argv = process.argv.slice(2);
  const inputDir = resolve(stringOption(argv, "input", "database"));
  const outputPath = resolve(stringOption(argv, "output", "data/pgn/coach-pgn-index.json"));
  const trainingOutput = stringOption(argv, "training-output", "");
  const cacheDir = resolve(stringOption(argv, "cache", ".cache/coach-pgn"));
  const index = await buildCoachPgnIndex({
    inputDir,
    cacheDir,
    sourceLimit: numberOption(argv, "source-limit", DEFAULT_SOURCE_LIMIT),
    positionLimit: numberOption(argv, "position-limit", DEFAULT_POSITION_LIMIT),
    totalLimit: numberOption(argv, "total-limit", DEFAULT_TOTAL_LIMIT),
    onProgress: ({ fileIndex, fileCount, indexedComments, cacheHit }) => {
      if (fileIndex % 5 === 0 || fileIndex === fileCount) {
        console.log(`[PGN index] ${fileIndex}/${fileCount} · ${indexedComments} Wissenseinträge${cacheHit ? " · Cache" : ""}`);
      }
    },
  });
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(compactCoachPgnIndex(index))}\n`, "utf8");
  if (trainingOutput) {
    const trainingPath = resolve(trainingOutput);
    await mkdir(dirname(trainingPath), { recursive: true });
    await writeFile(trainingPath, `${JSON.stringify(trainingExport(index), null, 2)}\n`, "utf8");
  }
  console.log(JSON.stringify({ outputPath, trainingOutput: trainingOutput || null, ...index.stats, duplicates: index.duplicateFiles }, null, 2));
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((error) => {
    console.error("[PGN index]", error?.stack || error);
    process.exitCode = 1;
  });
}
