import pgnIndex from "./data/pgn/coach-pgn-index.json" with { type: "json" };
import { Chess } from "chess.js";
import {
  comparePositionSimilarity,
  positionSimilarityLabel,
  positionSimilarityProfile,
} from "./positionSimilarity.js";
import { conceptSearchTokens } from "./positionConcepts.js";
import { validateCoachLanguage } from "./coachLanguageQuality.js";
import { isExactPgnMoveFact } from "./pgnVerifiedFacts.js";

const SUPPORTED_RATINGS = Object.freeze([800, 1000, 1400, 1800]);
const QUESTION_TOPIC_PATTERNS = Object.freeze({
  tactics: /\b(?:taktik|tactical|kombination|doppelangriff|gabel|fessel|spieß|zwischenzug|opfer|drohung|gefahr|überseh|häng|schach|matt)\w*/iu,
  calculation: /\b(?:berechn|rechnung|kandidatenzug|variante|forcieren|calculate|calculation|variation)\w*/iu,
  development: /\b(?:entwickl|entwicklung|figur(?:en)?\s+(?:raus|heraus)|develop|development)\w*/iu,
  center: /\b(?:zentrum|zentral|center|centre)\w*/iu,
  king_safety: /\b(?:könig|königssicherheit|rochade|castle|castling|king safety)\w*/iu,
  pawn_structure: /\b(?:bauer|bauern|bauernstruktur|freibauer|isoliert|pawn|pawn structure)\w*/iu,
  strategy: /\b(?:plan|strategie|strategisch|verbesser|schwäche|vorposten|strategy|strategic|weakness|outpost)\w*/iu,
  endgame: /\b(?:endspiel|opposition|turmendspiel|bauernendspiel|endgame|ending)\w*/iu,
  opening: /\b(?:eröffnung|theorie|repertoire|opening|theory)\w*/iu,
});
const SAFE_SIMILAR_TOPICS = new Set([
  "development",
  "center",
  "king_safety",
  "pawn_structure",
  "strategy",
  "endgame",
  "opening",
]);
const MIN_SIMILARITY_SCORE = 55;
const MAX_CACHE_ENTRIES = 100;
const knowledgeCacheByIndex = new WeakMap();
const statsCacheByIndex = new WeakMap();
const TRUSTED_PGN_STATUSES = new Set([
  "automatically_verified",
  "engine_confirmed",
  "compatible",
  "human_approved",
]);

export function isCoachReadyPgnEntry(entry) {
  const comment = typeof entry?.comment === "string" ? entry.comment.trim() : "";
  if (comment.length < 18 || comment.length > 360) return false;
  if (
    /https?:|www\.|@{2}|\[\/?variation|startbracket|endbracket|�/iu.test(comment)
    || /\b(?:course|kurs|book|buch|video|chapter|kapitel|source|quelle|annotator)\b/iu.test(comment)
    || /\b(?:according to|laut|as in|see also|siehe auch)\b/iu.test(comment)
    || /\bplayer(?:\s+player){1,}\b/iu.test(comment)
    || /^\s*(?:and|but|because|und|aber|weil)\b/iu.test(comment)
  ) return false;
  const claims = Array.isArray(entry?.annotation?.claims)
    ? entry.annotation.claims
    : [];
  const alternatives = Array.isArray(entry?.annotation?.alternatives)
    ? entry.annotation.alternatives
    : [];
  const statuses = [...claims, ...alternatives]
    .map((item) => String(item?.verificationStatus || "").trim())
    .filter(Boolean);
  if (
    statuses.length === 0
    || !statuses.every((status) => TRUSTED_PGN_STATUSES.has(status))
  ) return false;
  return validateCoachLanguage(comment, {
    rating: entry?.audienceRating || entry?.rating || 1000,
    phase: entry?.category || entry?.phase || "",
    strict: true,
  }).valid;
}

export function normalizedPgnPositionKey(fen) {
  if (typeof fen !== "string") return "";
  const fields = fen.trim().split(/\s+/);
  return fields.length >= 4 ? fields.slice(0, 4).join(" ") : "";
}

function normalizedRating(value) {
  const parsed = Number.parseInt(value, 10);
  return SUPPORTED_RATINGS.includes(parsed) ? parsed : 1000;
}

export function pgnQuestionTopics(question) {
  const text = String(question || "");
  return Object.entries(QUESTION_TOPIC_PATTERNS)
    .filter(([, pattern]) => pattern.test(text))
    .map(([topic]) => topic);
}

function expandedEntry(entry, index) {
  if (!Array.isArray(entry)) return entry;
  const anonymized = typeof entry[1] === "string";
  const provenance = Array.isArray(entry[5]) ? entry[5] : [];
  const structured = Array.isArray(entry[6]) ? entry[6] : [];
  if (anonymized) {
    return {
      id: entry[0],
      comment: entry[1],
      topics: entry[2],
      audienceRating: entry[3],
      category: entry[4] || "other",
      gameId: provenance[0] || "",
      ply: provenance[1] || 0,
      moveNumber: provenance[2] || 0,
      color: provenance[3] || "",
      move: provenance[4] || "",
      uci: provenance[5] || "",
      mainline: provenance[6] !== false,
      annotation: {
        type: structured[0] || "unknown",
        scope: structured[3] || "",
        claims: (structured[1] || []).map((claim) => ({
          field: claim[0], value: "", confidence: (claim[1] || 0) / 100,
          verificationStatus: claim[2], excerpt: "",
        })),
        alternatives: (structured[2] || []).map((alternative) => ({
          san: alternative[0], uci: alternative[1], lineSan: [],
          lineUci: [], verificationStatus: alternative[2],
          confidence: (alternative[3] || 0) / 100,
        })),
      },
    };
  }
  return {
    id: entry[0],
    comment: entry[2],
    topics: entry[3],
    audienceRating: entry[4],
    category: "other",
    gameId: provenance[0] || "",
    ply: provenance[1] || 0,
    moveNumber: provenance[2] || 0,
    color: provenance[3] || "",
    move: provenance[4] || "",
    uci: provenance[5] || "",
    mainline: provenance[7] !== false,
    annotation: {
      type: structured[0] || "unknown",
      scope: structured[3] || "",
      claims: (structured[1] || []).map((claim) => ({
        field: claim[0], value: "", confidence: (claim[1] || 0) / 100,
        verificationStatus: claim[2], excerpt: "",
      })),
      alternatives: (structured[2] || []).map((alternative) => ({
        san: alternative[0], uci: alternative[1], lineSan: [],
        lineUci: [], verificationStatus: alternative[2],
        confidence: (alternative[3] || 0) / 100,
      })),
    },
  };
}

function compactEntry(entry, match = { type: "exact", score: 100, shared: [] }) {
  const exact = match.type === "exact";
  const sharedFeatures = Array.isArray(match.shared)
    ? [...match.shared].sort((left, right) => (
      Number(String(right).startsWith("concept:"))
      - Number(String(left).startsWith("concept:"))
    ))
    : [];
  return {
    id: `pgn.${entry.id}`,
    comment: entry.comment,
    topics: Array.isArray(entry.topics) ? entry.topics.slice(0, 4) : [],
    audienceRating: entry.audienceRating || 1000,
    category: entry.category || "other",
    provenance: {
      gameId: entry.gameId || "",
      moveNumber: entry.moveNumber || 0,
      color: entry.color || "",
      move: entry.move || "",
      uci: entry.uci || "",
      mainline: entry.mainline !== false,
    },
    annotation: entry.annotation || { type: "unknown", claims: [], alternatives: [] },
    match: {
      type: match.type,
      label: positionSimilarityLabel(match.type),
      score: Math.round(match.score || 0),
      sharedFeatures: sharedFeatures.slice(0, 6),
      differences: match.conceptTransfer?.differences?.slice(0, 5) || [],
      conceptTransfer: match.conceptTransfer?.transferableConcepts
        ?.filter((concept) => !concept.blocked)
        .slice(0, 3) || [],
      tacticalMismatch: match.conceptTransfer?.tacticalMismatch === true,
    },
    usage: exact
      ? isExactPgnMoveFact(entry)
        ? "Nur als sicheren Brettfakt zum gespeicherten legalen Zug verwenden. Der Zug ist dadurch nicht automatisch gut oder der beste."
        : "Als menschlichen Erklärungshinweis aus exakt derselben Stellung paraphrasieren; nicht als Beleg für den besten Zug oder eine konkrete Variante verwenden."
      : "Nur den ausdrücklich ausgewiesenen übertragbaren Plan paraphrasieren. Gemeinsamkeiten und Unterschiede konkret nennen; keine historischen Züge, Felder, Taktiken oder Bewertungen übernehmen.",
  };
}

function computePgnKnowledgeForPosition({
  fen,
  rating = 1000,
  question = "",
  openingFamily = "",
  limit = 3,
  allowedExactMoveUcis = [],
  index = pgnIndex,
} = {}) {
  const key = normalizedPgnPositionKey(fen);
  if (!key || !index?.positions) return [];
  const targetRating = normalizedRating(rating);
  const requestedTopics = new Set(pgnQuestionTopics(question));
  const topicMatches = (entry) => (entry.topics || [])
    .filter((topic) => requestedTopics.has(topic)).length;
  const maximum = Math.max(0, Math.min(5, Number.parseInt(limit, 10) || 0));
  const allowedExactMoves = new Set(
    (Array.isArray(allowedExactMoveUcis) ? allowedExactMoveUcis : [])
      .map((uci) => String(uci || "").toLowerCase())
      .filter((uci) => /^[a-h][1-8][a-h][1-8][qrbn]?$/u.test(uci)),
  );
  const exact = (Array.isArray(index.positions[key]) ? index.positions[key] : [])
    .map((entry) => expandedEntry(entry, index))
    .filter(isCoachReadyPgnEntry)
    .filter((entry) => !isExactPgnMoveFact(entry) || allowedExactMoves.has(entry.uci))
    .sort((left, right) => (
      topicMatches(right) - topicMatches(left)
      || Math.abs((left.audienceRating || 1000) - targetRating)
      - Math.abs((right.audienceRating || 1000) - targetRating)
      || (right.topics?.length || 0) - (left.topics?.length || 0)
      || String(left.id).localeCompare(String(right.id), "en")
    ))
    .slice(0, maximum)
    .map((entry) => compactEntry(entry));
  if (exact.length >= maximum || !index?.profiles) return exact;
  if (requestedTopics.has("tactics") || requestedTopics.has("calculation")) return exact;

  const queryProfile = positionSimilarityProfile(key, { openingFamily });
  if (!queryProfile) return exact;
  const seenComments = new Set(exact.map((entry) => entry.comment.toLocaleLowerCase("de-DE")));
  const similar = [];
  const candidateKeys = (() => {
    if (!index.searchBuckets || !Array.isArray(index.positionKeys)) {
      return Object.keys(index.profiles);
    }
    const ids = new Set();
    for (const token of conceptSearchTokens(queryProfile.concepts)) {
      for (const id of index.searchBuckets[token] || []) ids.add(id);
    }
    return [...ids].slice(0, 4_000).map((id) => index.positionKeys[id]).filter(Boolean);
  })();
  for (const candidateKey of candidateKeys) {
    const candidateProfile = index.profiles[candidateKey];
    if (candidateKey === key || !Array.isArray(index.positions[candidateKey])) continue;
    const match = comparePositionSimilarity(queryProfile, candidateProfile);
    if (!match || match.score < MIN_SIMILARITY_SCORE) continue;
    if (match.conceptTransfer?.tacticalMismatch) continue;
    for (const storedEntry of index.positions[candidateKey]) {
      const entry = expandedEntry(storedEntry, index);
      if (!isCoachReadyPgnEntry(entry)) continue;
      if (isExactPgnMoveFact(entry)) continue;
      const topics = Array.isArray(entry.topics) ? entry.topics : [];
      const hasTransferableConcept = match.conceptTransfer?.transferableConcepts
        ?.some((concept) => !concept.blocked && concept.transferablePlan?.length > 0);
      const isExplicitlyTactical = topics.some((topic) => ["tactics", "calculation"].includes(topic));
      if (
        !topics.some((topic) => SAFE_SIMILAR_TOPICS.has(topic))
        && (!hasTransferableConcept || isExplicitlyTactical)
      ) continue;
      const normalizedComment = entry.comment.toLocaleLowerCase("de-DE");
      if (seenComments.has(normalizedComment)) continue;
      const topicScore = topicMatches(entry) * 18;
      const ratingPenalty = Math.abs((entry.audienceRating || 1000) - targetRating) / 100;
      similar.push({
        entry,
        match,
        rankScore: match.score + topicScore - ratingPenalty,
      });
    }
  }
  similar.sort((left, right) => (
    right.rankScore - left.rankScore
    || right.match.score - left.match.score
    || String(left.entry.id).localeCompare(String(right.entry.id), "en")
  ));
  for (const candidate of similar) {
    if (exact.length >= maximum) break;
    const normalizedComment = candidate.entry.comment.toLocaleLowerCase("de-DE");
    if (seenComments.has(normalizedComment)) continue;
    seenComments.add(normalizedComment);
    exact.push(compactEntry(candidate.entry, {
      type: candidate.match.matchType,
      score: candidate.match.score,
      shared: candidate.match.shared,
      conceptTransfer: candidate.match.conceptTransfer,
    }));
  }
  return exact;
}

function fenAfterUci(fen, uci) {
  if (typeof fen !== "string" || typeof uci !== "string") return "";
  try {
    const game = new Chess(fen);
    const move = game.move({
      from: uci.slice(0, 2),
      to: uci.slice(2, 4),
      promotion: uci.length > 4 ? uci.slice(4, 5) : undefined,
    });
    return move ? game.fen() : "";
  } catch {
    return "";
  }
}

export function pgnKnowledgeForEngineContext({
  engineContext,
  rating = 1000,
  question = "",
  openingFamily = "",
  limit = 5,
  index = pgnIndex,
} = {}) {
  const fenBefore = engineContext?.fen || "";
  if (!fenBefore) return [];
  const reviewedUci = engineContext?.moveReview?.playedMove?.uci || "";
  const lineMoves = (engineContext?.lines || [])
    .map((line) => line?.bestMove?.uci || line?.pv?.uci?.[0] || "")
    .filter(Boolean)
    .slice(0, 3);
  const positions = [
    { role: "before", fen: fenBefore, allowedExactMoveUcis: [reviewedUci, ...lineMoves] },
    ...(reviewedUci ? [{
      role: "after_played",
      fen: fenAfterUci(fenBefore, reviewedUci),
      allowedExactMoveUcis: [],
    }] : []),
    ...lineMoves.map((uci, rank) => ({
      role: `after_alternative_${rank + 1}`,
      fen: fenAfterUci(fenBefore, uci),
      allowedExactMoveUcis: [],
    })),
  ].filter((entry) => entry.fen);
  const results = [];
  const seen = new Set();
  for (const position of positions) {
    const matches = pgnKnowledgeForPosition({
      fen: position.fen,
      rating,
      question,
      openingFamily,
      limit: Math.min(2, limit),
      allowedExactMoveUcis: position.allowedExactMoveUcis,
      index,
    });
    for (const match of matches) {
      const key = `${match.id}|${position.role}`;
      if (seen.has(key)) continue;
      seen.add(key);
      results.push({ ...match, positionRole: position.role });
      if (results.length >= limit) return results;
    }
  }
  return results;
}

export function pgnKnowledgeForPosition(options = {}) {
  const index = options.index || pgnIndex;
  if (!index || typeof index !== "object") {
    return computePgnKnowledgeForPosition({ ...options, index });
  }
  let cache = knowledgeCacheByIndex.get(index);
  if (!cache) {
    cache = new Map();
    knowledgeCacheByIndex.set(index, cache);
  }
  const cacheKey = JSON.stringify([
    normalizedPgnPositionKey(options.fen),
    normalizedRating(options.rating),
    String(options.question || "").trim().toLocaleLowerCase("de-DE"),
    String(options.openingFamily || "").trim().toLocaleLowerCase("de-DE"),
    Math.max(0, Math.min(5, Number.parseInt(options.limit, 10) || 0)),
    (Array.isArray(options.allowedExactMoveUcis) ? options.allowedExactMoveUcis : [])
      .map((uci) => String(uci || "").toLowerCase())
      .sort(),
  ]);
  if (cache.has(cacheKey)) return cache.get(cacheKey);

  const result = computePgnKnowledgeForPosition({ ...options, index });
  cache.set(cacheKey, result);
  if (cache.size > MAX_CACHE_ENTRIES) {
    cache.delete(cache.keys().next().value);
  }
  return result;
}

export function pgnKnowledgeIndexStats(index = pgnIndex) {
  if (index && typeof index === "object" && statsCacheByIndex.has(index)) {
    return statsCacheByIndex.get(index);
  }
  let coachReady = 0;
  for (const entries of Object.values(index?.positions || {})) {
    if (!Array.isArray(entries)) continue;
    entries.forEach((entry) => {
      if (isCoachReadyPgnEntry(expandedEntry(entry, index))) coachReady += 1;
    });
  }
  const result = {
    version: index?.version || 0,
    positions: index?.stats?.positions || 0,
    comments: index?.stats?.commentsIndexed || 0,
    coachReady,
    sources: index?.sourceCount || index?.stats?.uniqueFiles || 0,
    categoryCounts: index?.stats?.categoryCounts || {},
  };
  if (index && typeof index === "object") statsCacheByIndex.set(index, result);
  return result;
}
