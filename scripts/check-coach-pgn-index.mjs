import { Chess } from "chess.js";
import index from "../data/pgn/coach-pgn-index.json" with { type: "json" };
import {
  EXACT_PGN_MOVE_FACT_SCOPE,
  primaryDeterministicPgnMoveFact,
} from "../pgnVerifiedFacts.js";

const EXPECTED_VERSION = 6;
const SUPPORTED_CATEGORIES = new Set(["opening", "middlegame", "endgame", "other"]);
const SUPPORTED_RATINGS = new Set([800, 1000, 1400, 1800]);
const SUPPORTED_TOPICS = new Set([
  "tactics",
  "calculation",
  "development",
  "center",
  "king_safety",
  "pawn_structure",
  "strategy",
  "endgame",
  "opening",
]);

function fail(message) {
  throw new Error(`PGN-Index ungültig: ${message}`);
}

function checkPositionKey(positionKey) {
  if (positionKey.trim().split(/\s+/).length !== 4) {
    fail(`Stellungsschlüssel hat nicht vier FEN-Felder: ${positionKey}`);
  }
  try {
    new Chess(`${positionKey} 0 1`);
  } catch {
    fail(`Stellungsschlüssel ist keine legale FEN: ${positionKey}`);
  }
}

export function checkCoachPgnIndex(candidate = index) {
  if (candidate?.version !== EXPECTED_VERSION) {
    fail(`Version ${candidate?.version ?? "fehlt"}, erwartet ${EXPECTED_VERSION}`);
  }
  if ("sourceNames" in candidate) fail("sourceNames darf im anonymisierten Index nicht enthalten sein");
  if (!Number.isInteger(candidate.sourceCount) || candidate.sourceCount < 1) fail("sourceCount fehlt");
  if (!Array.isArray(candidate.categories)
    || candidate.categories.length !== SUPPORTED_CATEGORIES.size
    || candidate.categories.some((category) => !SUPPORTED_CATEGORIES.has(category))) {
    fail("Kategorien fehlen oder sind ungültig");
  }
  if (!candidate.positions || typeof candidate.positions !== "object") {
    fail("positions fehlt");
  }
  if (!candidate.profiles || typeof candidate.profiles !== "object") {
    fail("profiles fehlt");
  }

  let comments = 0;
  const ids = new Set();
  for (const [positionKey, entries] of Object.entries(candidate.positions)) {
    checkPositionKey(positionKey);
    if (!Array.isArray(entries) || entries.length === 0 || entries.length > 3) {
      fail(`Stellung ${positionKey} enthält ${entries?.length ?? "keine"} Einträge`);
    }
    const positionComments = new Set();
    for (const entry of entries) {
      if (!Array.isArray(entry) || entry.length !== 7) {
        fail(`Eintrag in ${positionKey} hat nicht das kompakte v6-Format`);
      }
      const [id, summary, topics, audienceRating, category, provenance, annotation] = entry;
      if (!/^[a-f0-9]{16}$/.test(id) || ids.has(id)) fail(`ungültige oder doppelte ID ${id}`);
      ids.add(id);
      if (typeof summary !== "string" || summary.length < 18 || summary.length > 281) {
        fail(`ungültige Zusammenfassungslänge bei ${id}`);
      }
      if (/\[%[^\]]*\]/.test(summary) || /<[^>]*>/.test(summary)) {
        fail(`nicht bereinigte PGN-Direktive bei ${id}`);
      }
      const normalizedComment = summary.toLocaleLowerCase("de-DE");
      if (positionComments.has(normalizedComment)) fail(`doppelter Kommentar in ${positionKey}`);
      positionComments.add(normalizedComment);
      if (!Array.isArray(topics) || topics.some((topic) => !SUPPORTED_TOPICS.has(topic))) {
        fail(`unbekanntes Thema bei ${id}`);
      }
      if (!SUPPORTED_RATINGS.has(audienceRating)) fail(`ungültige Ziel-Elo bei ${id}`);
      if (!SUPPORTED_CATEGORIES.has(category)) fail(`ungültige Kategorie bei ${id}`);
      if (annotation?.[0] === "deterministic_move_fact") {
        const claims = annotation?.[1];
        const uci = provenance?.[5];
        if (
          annotation?.[3] !== EXACT_PGN_MOVE_FACT_SCOPE
          || !Array.isArray(claims)
          || claims.length !== 1
          || claims[0]?.[2] !== "automatically_verified"
        ) fail(`zuggebundener Brettfakt hat keinen vollständigen Prüfbeleg bei ${id}`);
        const recomputed = primaryDeterministicPgnMoveFact({
          fenBefore: `${positionKey} 0 1`,
          uci,
        });
        if (!recomputed || recomputed.comment !== summary) {
          fail(`zuggebundener Brettfakt ist nicht aus FEN und Zug reproduzierbar bei ${id}`);
        }
      }
      comments += 1;
    }
  }

  const positions = Object.keys(candidate.positions).length;
  for (const positionKey of Object.keys(candidate.positions)) {
    const profile = candidate.profiles[positionKey];
    if (!Array.isArray(profile) || profile.length < 9 || !Array.isArray(profile[8])) {
      fail(`Stellungsprofil fehlt oder ist ungültig: ${positionKey}`);
    }
  }
  if (!Array.isArray(candidate.positionKeys) || candidate.positionKeys.length !== positions) {
    fail("positionKeys fehlt oder passt nicht zur Zahl der Stellungen");
  }
  if (!candidate.searchBuckets || typeof candidate.searchBuckets !== "object") {
    fail("searchBuckets fehlt");
  }
  if (!candidate.categoryBuckets || !candidate.categorySummaries) {
    fail("Kategorie-Buckets oder Zusammenfassungen fehlen");
  }
  for (const category of SUPPORTED_CATEGORIES) {
    const idsForCategory = candidate.categoryBuckets[category];
    const summary = candidate.categorySummaries[category];
    if (!Array.isArray(idsForCategory) || idsForCategory.some((id) => !candidate.positionKeys[id])) {
      fail(`ungültiger Kategorie-Bucket ${category}`);
    }
    if (!summary || !Number.isInteger(summary.positions) || !Number.isInteger(summary.entries)
      || !Array.isArray(summary.concepts) || typeof summary.topics !== "object") {
      fail(`ungültige Kategorie-Zusammenfassung ${category}`);
    }
  }
  for (const [token, positionIds] of Object.entries(candidate.searchBuckets)) {
    if (!/^(?:phase|structure|pawn|material|concept|tactic):/.test(token)) {
      fail(`unbekannter Suchbucket ${token}`);
    }
    if (!Array.isArray(positionIds) || positionIds.some((id) => !candidate.positionKeys[id])) {
      fail(`ungültige Positions-IDs im Suchbucket ${token}`);
    }
  }
  if (candidate.stats?.positions !== positions) {
    fail(`Statistik nennt ${candidate.stats?.positions} statt ${positions} Stellungen`);
  }
  if (candidate.stats?.commentsIndexed !== comments) {
    fail(`Statistik nennt ${candidate.stats?.commentsIndexed} statt ${comments} Kommentare`);
  }
  if (candidate.sourceCount > (candidate.stats?.uniqueFiles || 0)) {
    fail("Quellenkatalog ist größer als die Zahl eindeutiger Dateien");
  }
  return { positions, comments, sources: candidate.sourceCount, categories: candidate.stats?.categoryCounts || {} };
}

if (import.meta.url === new URL(process.argv[1], "file:").href) {
  try {
    const result = checkCoachPgnIndex();
    console.log(`PGN-Index geprüft: ${result.positions} Stellungen, ${result.comments} Wissenseinträge, ${result.sources} importierte Dateien.`);
  } catch (error) {
    console.error(error?.message || error);
    process.exitCode = 1;
  }
}
