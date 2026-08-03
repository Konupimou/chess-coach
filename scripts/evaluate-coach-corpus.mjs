import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { Chess } from "chess.js";
import {
  buildLocalMoveExplanation,
  buildTrustedExplanationEvidence,
  moveExplanationToMarkdown,
  verifyMoveExplanation,
} from "../coachExplanation.js";
import { findUnsupportedMoveTokens } from "../coachEngineContext.js";
import { validateCoachLanguage } from "../coachLanguageQuality.js";
import { learnerProfileForCoach } from "../learnerProfile.js";
import { isCoachReadyPgnEntry } from "../pgnKnowledge.js";
import { buildPositionEvidence } from "../positionEvidence.js";

export const CORPUS_EVALUATION_SCHEMA_VERSION = 1;
export const CORPUS_EVALUATION_RATINGS = Object.freeze([800, 1000, 1400, 1800]);
export const CORPUS_EVALUATION_PHASES = Object.freeze([
  "opening",
  "middlegame",
  "endgame",
]);

const UCI_PATTERN = /^[a-h][1-8][a-h][1-8][qrbn]?$/;
const HASHED_GAME_ID_PATTERN = /^[a-f0-9]{16,64}$/;
const MAX_FAILURE_EXAMPLES = 36;

function percentage(passed, total) {
  return total > 0 ? Number(((passed / total) * 100).toFixed(2)) : 0;
}

function sha256(value) {
  return createHash("sha256").update(String(value)).digest("hex");
}

function canonicalFen(positionKey, phase = "middlegame") {
  const fields = String(positionKey || "").trim().split(/\s+/);
  if (fields.length < 4) return "";
  const fullmove = phase === "opening" ? 8 : phase === "endgame" ? 40 : 24;
  return `${fields.slice(0, 4).join(" ")} 0 ${fullmove}`;
}

function uci(move) {
  return `${move.from}${move.to}${move.promotion || ""}`.toLowerCase();
}

function compactRecord(positionKey, value) {
  if (Array.isArray(value)) {
    const anonymized = typeof value[1] === "string";
    const provenance = Array.isArray(value[5]) ? value[5] : [];
    const structured = Array.isArray(value[6]) ? value[6] : [];
    return {
      positionKey,
      raw: value,
      id: String(value[0] || ""),
      comment: anonymized ? String(value[1] || "") : String(value[2] || ""),
      topics: anonymized && Array.isArray(value[2]) ? value[2] : [],
      rating: Number(anonymized ? value[3] : value[4]),
      phase: anonymized ? String(value[4] || "other") : "other",
      gameId: String(provenance[0] || ""),
      ply: Number(provenance[1] || 0),
      moveNumber: Number(provenance[2] || 0),
      color: String(provenance[3] || ""),
      san: String(provenance[4] || ""),
      uci: String(provenance[5] || "").toLowerCase(),
      mainline: provenance[6] !== false,
      annotation: {
        type: structured[0] || "unknown",
        claims: (structured[1] || []).map((claim) => ({
          field: claim[0],
          confidence: (claim[1] || 0) / 100,
          verificationStatus: claim[2],
        })),
        alternatives: (structured[2] || []).map((alternative) => ({
          san: alternative[0],
          uci: alternative[1],
          verificationStatus: alternative[2],
          confidence: (alternative[3] || 0) / 100,
        })),
      },
      exposedIdentityFields: [],
    };
  }
  if (!value || typeof value !== "object") return null;
  const exposedIdentityFields = [
    "author",
    "title",
    "event",
    "source",
    "sourceName",
    "file",
    "fileName",
    "white",
    "black",
  ].filter((field) => Object.hasOwn(value, field));
  return {
    positionKey,
    raw: value,
    id: String(value.id || ""),
    comment: String(value.comment || ""),
    topics: Array.isArray(value.topics) ? value.topics : [],
    rating: Number(value.audienceRating || value.rating),
    phase: String(value.category || value.phase || "other"),
    gameId: String(value.gameId || value.provenance?.gameId || ""),
    ply: Number(value.ply || value.provenance?.ply || 0),
    moveNumber: Number(value.moveNumber || value.provenance?.moveNumber || 0),
    color: String(value.color || value.provenance?.color || ""),
    san: String(value.move || value.san || value.provenance?.move || ""),
    uci: String(value.uci || value.provenance?.uci || "").toLowerCase(),
    mainline: value.mainline !== false,
    annotation: value.annotation || { type: "unknown", claims: [], alternatives: [] },
    exposedIdentityFields,
  };
}

function allRecordsFromPgnIndex(index) {
  const records = [];
  for (const [positionKey, entries] of Object.entries(index?.positions || {})) {
    if (!Array.isArray(entries)) continue;
    for (const entry of entries) {
      const record = compactRecord(positionKey, entry);
      if (record && CORPUS_EVALUATION_RATINGS.includes(record.rating)
        && CORPUS_EVALUATION_PHASES.includes(record.phase)) {
        records.push(record);
      }
    }
  }
  return records;
}

export function recordsFromPgnIndex(index) {
  return allRecordsFromPgnIndex(index).filter((record) => (
    UCI_PATTERN.test(record.uci)
    // PGN-Nullzüge werden im Wissensindex als a8a8 abgelegt. Sie tragen
    // Stellungskommentare, sind aber bewusst keine zu erklärenden Züge.
    && record.uci.slice(0, 2) !== record.uci.slice(2, 4)
  ));
}

export function auditPgnSourceCorpus(index) {
  const records = allRecordsFromPgnIndex(index);
  const issueCounts = {};
  const byRating = Object.fromEntries(CORPUS_EVALUATION_RATINGS.map((rating) => [
    rating,
    { entries: 0, coachReady: 0, visibleLanguagePassed: 0 },
  ]));
  let coachReady = 0;
  let visibleLanguagePassed = 0;
  let coachReadyLanguagePassed = 0;
  let verifiedFacts = 0;
  let commentInsights = 0;
  let consensusInsights = 0;
  for (const record of records) {
    const ready = isCoachReadyPgnEntry(record);
    const language = validateCoachLanguage(record.comment, {
      rating: record.rating,
      phase: record.phase,
      strict: true,
    });
    coachReady += Number(ready);
    visibleLanguagePassed += Number(language.valid);
    coachReadyLanguagePassed += Number(ready && language.valid);
    verifiedFacts += Number(record.annotation?.type === "deterministic_move_fact");
    commentInsights += Number(record.annotation?.type === "comment_derived_concept");
    consensusInsights += Number(
      record.annotation?.type === "comment_derived_concept"
      && record.annotation?.claims?.some((claim) => claim.verificationStatus === "consensus_verified"),
    );
    byRating[record.rating].entries += 1;
    byRating[record.rating].coachReady += Number(ready);
    byRating[record.rating].visibleLanguagePassed += Number(language.valid);
    for (const issue of [...language.errors, ...language.warnings]) {
      issueCounts[issue.id] = (issueCounts[issue.id] || 0) + 1;
    }
  }
  Object.values(byRating).forEach((row) => {
    row.coachReadyPercent = percentage(row.coachReady, row.entries);
    row.visibleLanguagePercent = percentage(row.visibleLanguagePassed, row.entries);
  });
  return {
    entries: records.length,
    coachReady,
    coachReadyPercent: percentage(coachReady, records.length),
    visibleLanguagePassed,
    visibleLanguagePercent: percentage(visibleLanguagePassed, records.length),
    coachReadyLanguagePassed,
    coachReadyLanguagePercent: percentage(coachReadyLanguagePassed, coachReady),
    verifiedFacts,
    commentInsights,
    consensusInsights,
    rawCommentsAreDirectCoachOutput: false,
    byRating,
    issueCounts: Object.fromEntries(
      Object.entries(issueCounts).sort((left, right) => right[1] - left[1]),
    ),
  };
}

function cellKey(rating, phase) {
  return `${rating}:${phase}`;
}

export function selectStratifiedCorpus(index, {
  samplesPerCell = 200,
  seed = "coach-corpus-v1",
} = {}) {
  const maximum = Math.max(1, Math.min(2_000, Number.parseInt(samplesPerCell, 10) || 200));
  const grouped = new Map();
  for (const record of recordsFromPgnIndex(index)) {
    const key = cellKey(record.rating, record.phase);
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push(record);
  }

  const selected = [];
  const cells = [];
  for (const rating of CORPUS_EVALUATION_RATINGS) {
    for (const phase of CORPUS_EVALUATION_PHASES) {
      const key = cellKey(rating, phase);
      const available = grouped.get(key) || [];
      const ranked = available
        .map((record) => ({
          record,
          score: sha256(`${seed}|${key}|${record.positionKey}|${record.id}`),
        }))
        .sort((left, right) => (
          left.score.localeCompare(right.score, "en")
          || left.record.id.localeCompare(right.record.id, "en")
        ));
      const seenPositions = new Set();
      const sample = [];
      for (const candidate of ranked) {
        if (seenPositions.has(candidate.record.positionKey)) continue;
        seenPositions.add(candidate.record.positionKey);
        sample.push(candidate.record);
        if (sample.length >= maximum) break;
      }
      selected.push(...sample);
      cells.push({
        rating,
        phase,
        availableRecords: available.length,
        availablePositions: new Set(available.map((record) => record.positionKey)).size,
        requested: maximum,
        selected: sample.length,
      });
    }
  }
  return {
    seed,
    samplesPerCell: maximum,
    selected,
    cells,
    selectionHash: sha256(selected
      .map((record) => `${record.rating}|${record.phase}|${record.positionKey}|${record.id}`)
      .join("\n")),
  };
}

function cleanMarkdown(text) {
  return String(text || "")
    .replace(/\*\*/g, "")
    .replace(/^\s*(?:Alternative|Stärkste Antwort|Konkrete Folge|Der Unterschied|Merksatz):\s*/gimu, "")
    .replace(/\s+/g, " ")
    .trim();
}

function words(text) {
  return cleanMarkdown(text).match(/[\p{L}\p{N}]+(?:[-’'][\p{L}\p{N}]+)*/gu) || [];
}

function sentences(text) {
  return String(text || "")
    .replace(/\*\*/g, "")
    .split(/(?:[.!?]+(?:[”"']+)?\s+|\n{2,})/u)
    .map((sentence) => sentence.replace(/^\s*[^:]{0,24}:\s*/u, "").trim())
    .filter(Boolean);
}

function approximateSyllables(word) {
  const normalized = String(word || "")
    .toLocaleLowerCase("de-DE")
    .replace(/[^a-zäöüß]/gu, "");
  if (!normalized) return 0;
  return Math.max(1, normalized.match(/[aeiouyäöü]+/gu)?.length || 1);
}

export function assessCoachReadability(text, {
  rating = 1000,
  phase = "middlegame",
  legalMoveCount = 2,
  onlyMove = false,
  practicallyEquivalent = false,
  evidence = {},
} = {}) {
  const textSentences = sentences(text);
  const sentenceWordCounts = textSentences.map((sentence) => words(sentence).length);
  const textWords = words(text);
  const language = validateCoachLanguage(text, {
    rating,
    phase,
    practicallyEquivalent,
    multipleGoodOpeningMoves: phase === "opening" && legalMoveCount > 1 && !onlyMove,
    evidence: { ...evidence, onlyMove },
    strict: true,
  });
  const languageIssues = [...language.errors, ...language.warnings];
  const issueCodes = languageIssues.map((issue) => issue.id);
  const details = languageIssues.map((issue) => issue.message);

  const syllableCount = textWords.reduce(
    (sum, word) => sum + approximateSyllables(word),
    0,
  );
  const averageSentenceWords = textSentences.length > 0
    ? textWords.length / textSentences.length
    : 0;
  const averageSyllables = textWords.length > 0 ? syllableCount / textWords.length : 0;
  const germanReadingEase = textWords.length > 0 && textSentences.length > 0
    ? 180 - averageSentenceWords - (58.5 * averageSyllables)
    : 0;
  return {
    pass: language.valid,
    issueCodes: [...new Set(issueCodes)],
    details,
    wordCount: textWords.length,
    sentenceCount: textSentences.length,
    averageWordsPerSentence: Number(averageSentenceWords.toFixed(2)),
    maximumWordsInSentence: Math.max(0, ...sentenceWordCounts),
    germanReadingEase: Number(germanReadingEase.toFixed(2)),
    sharedLanguageMetrics: language.analysis.metrics,
  };
}

function semanticErrors(explanation, move, gameAfterMove) {
  const text = String(explanation?.moveIdea?.text || "");
  const errors = [];
  const captureLanguage = /(?:nimmt|schlägt)(?:\s+\S+){0,5}\s+auf\s+[a-h][1-8]/iu;
  if (captureLanguage.test(text) && !move.captured) {
    errors.push("Die Zugidee behauptet einen Schlagzug, obwohl nichts geschlagen wird.");
  }
  if (/rochiert/iu.test(text) && !["k", "q"].some((flag) => move.flags.includes(flag))) {
    errors.push("Die Zugidee behauptet eine Rochade bei einem anderen Zug.");
  }
  if (/(?:gibt|setzt).*\bSchach\b/iu.test(text) && !gameAfterMove.isCheck()) {
    errors.push("Die Zugidee behauptet Schach, obwohl der König nicht im Schach steht.");
  }
  if (/\bmatt\b/iu.test(text) && !gameAfterMove.isCheckmate()) {
    errors.push("Die Zugidee behauptet Matt, obwohl die Stellung nicht matt ist.");
  }
  if (/entwickelt\s+den\s+(?:Springer|Läufer)/iu.test(text)) {
    const starts = new Set(["b1", "c1", "f1", "g1", "b8", "c8", "f8", "g8"]);
    if (!["n", "b"].includes(move.piece) || !starts.has(move.from)) {
      errors.push("Die Zugidee nennt Entwicklung, obwohl die Figur nicht vom Grundfeld kommt.");
    }
  }
  return errors;
}

function explanationEvidenceSources(explanation) {
  const ids = Object.values(explanation || {})
    .flatMap((claim) => Array.isArray(claim?.evidenceIds) ? claim.evidenceIds : []);
  const sources = new Set();
  for (const id of ids) {
    if (String(id).startsWith("engine.")) sources.add("stockfish_context");
    else if (String(id).startsWith("pgn.")) sources.add("pgn_database");
    else sources.add("board_and_legal_lines");
  }
  return [...sources].sort();
}

function buildOfflineExplanation(record) {
  const fen = canonicalFen(record.positionKey, record.phase);
  const game = new Chess(fen);
  const legalMoves = game.moves({ verbose: true });
  const subjectMove = legalMoves.find((move) => uci(move) === record.uci);
  if (!subjectMove) {
    return { error: "Der gespeicherte UCI-Zug ist in der gespeicherten Stellung illegal.", fen };
  }
  const alternativeMove = legalMoves
    .filter((move) => uci(move) !== record.uci)
    .sort((left, right) => uci(left).localeCompare(uci(right), "en"))[0] || null;
  const candidates = [subjectMove, alternativeMove].filter(Boolean).map((move, index) => ({
    rank: index + 1,
    evaluation: { unit: "cp", value: 0, perspective: "player" },
    pvUci: [uci(move)],
    pvSan: [move.san],
  }));
  const playedLine = candidates[0];
  const onlyMoveEvidence = legalMoves.length === 1
    ? { type: "only_legal_move", legalMoveCount: 1 }
    : null;
  const positionEvidence = buildPositionEvidence({
    fenBefore: fen,
    playedUci: record.uci,
    candidateLines: candidates,
    playedLine,
    lossCp: 0,
    quality: "best",
    engineDepth: 0,
    onlyMoveEvidence,
    pvLimit: 2,
  });
  const lines = (positionEvidence.candidateLines || []).map((line) => ({
    rank: line.rank,
    depth: 0,
    evaluation: line.evaluation,
    bestMove: { uci: line.pvUci[0], san: line.pvSan[0] },
    pv: { uci: line.pvUci, san: line.pvSan },
  }));
  const best = lines[0] || null;
  const engineContext = {
    source: "stockfish",
    kind: "move_review",
    fen,
    depth: 0,
    lines,
    bestMove: best?.bestMove || null,
    primaryVariation: best?.pv || { uci: [], san: [] },
    playedLine: {
      evaluation: playedLine.evaluation,
      uci: playedLine.pvUci,
      san: playedLine.pvSan,
    },
    moveReview: {
      playedMove: { uci: record.uci, san: subjectMove.san },
      bestMove: best?.bestMove || null,
      quality: "best",
      lossCp: 0,
      pv: best?.pv || { uci: [], san: [] },
      onlyMove: legalMoves.length === 1,
      onlyMoveEvidence,
    },
  };
  const learnerProfile = learnerProfileForCoach({ rating: record.rating });
  const explanation = buildLocalMoveExplanation({
    positionEvidence,
    engineContext,
    learnerProfile,
  });
  return {
    fen,
    game,
    gameAfterMove: (() => {
      const after = new Chess(fen);
      after.move({
        from: record.uci.slice(0, 2),
        to: record.uci.slice(2, 4),
        promotion: record.uci[4],
      });
      return after;
    })(),
    subjectMove,
    legalMoveCount: legalMoves.length,
    positionEvidence,
    engineContext,
    explanation,
    text: moveExplanationToMarkdown(explanation, { deep: true }),
  };
}

export function evaluateCorpusRecord(record, index) {
  const legalityErrors = [];
  const evidenceErrors = [];
  const provenanceErrors = [];
  let built;
  try {
    built = buildOfflineExplanation(record);
  } catch (error) {
    legalityErrors.push(error?.message || String(error));
    built = { fen: canonicalFen(record.positionKey, record.phase) };
  }
  if (built.error) legalityErrors.push(built.error);
  if (built.positionEvidence?.valid !== true) {
    evidenceErrors.push("positionEvidence ist nicht gültig.");
  }
  if (
    built.positionEvidence
    && !(built.positionEvidence.verifiedLines || []).every(
      (line) => line.legal === true && line.complete === true,
    )
  ) {
    evidenceErrors.push("Mindestens eine belegte Zuglinie ist nicht vollständig legal.");
  }
  if (!built.explanation) {
    evidenceErrors.push("Der lokale Coach erzeugt keine überprüfbare Erklärung.");
  }
  if (built.explanation) {
    const checked = verifyMoveExplanation(built.explanation, {
      positionEvidence: buildTrustedExplanationEvidence({
        positionEvidence: built.positionEvidence,
        engineContext: built.engineContext,
      }),
      engineContext: built.engineContext,
    });
    if (!checked.valid) evidenceErrors.push(...checked.errors);
    const unsupported = findUnsupportedMoveTokens(built.text, built.engineContext);
    if (unsupported.length > 0) {
      evidenceErrors.push(`Unbelegte Zugtokens: ${unsupported.join(", ")}`);
    }
  }

  const exactReadyEntries = (index?.positions?.[record.positionKey] || [])
    .map((entry) => compactRecord(record.positionKey, entry))
    .filter(Boolean)
    .filter(isCoachReadyPgnEntry);
  if (!HASHED_GAME_ID_PATTERN.test(record.gameId)) {
    provenanceErrors.push("Die Partiekennung ist nicht als anonymer Hash gespeichert.");
  }
  if (record.exposedIdentityFields.length > 0) {
    provenanceErrors.push(`Offene Identitätsfelder: ${record.exposedIdentityFields.join(", ")}`);
  }
  if (!record.comment.trim()) provenanceErrors.push("Der Wissenseintrag enthält keinen Text.");

  const semantics = built.explanation
    ? semanticErrors(built.explanation, built.subjectMove, built.gameAfterMove)
    : ["Keine Erklärung für semantische Prüfung vorhanden."];
  const readability = assessCoachReadability(built.text || "", {
    rating: record.rating,
    phase: record.phase,
    legalMoveCount: built.legalMoveCount || 0,
    onlyMove: built.legalMoveCount === 1,
    practicallyEquivalent: true,
    evidence: {
      mate: built.gameAfterMove?.isCheckmate() === true,
      materialLoss: false,
      significantLoss: false,
      severeLoss: false,
    },
  });
  return {
    id: record.id,
    positionKey: record.positionKey,
    gameId: record.gameId,
    rating: record.rating,
    phase: record.phase,
    uci: record.uci,
    san: built.subjectMove?.san || record.san,
    text: built.text || "",
    legality: { pass: legalityErrors.length === 0, errors: legalityErrors },
    evidence: { pass: evidenceErrors.length === 0, errors: evidenceErrors },
    semantics: { pass: semantics.length === 0, errors: semantics },
    provenance: {
      pass: provenanceErrors.length === 0,
      errors: provenanceErrors,
      exactDatabaseMatch: exactReadyEntries.length > 0,
    },
    readability,
    evidenceSources: explanationEvidenceSources(built.explanation),
  };
}

function emptyAggregate() {
  return {
    evaluated: 0,
    legalityPassed: 0,
    evidencePassed: 0,
    semanticsPassed: 0,
    provenancePassed: 0,
    readabilityPassed: 0,
    exactDatabaseMatches: 0,
    openingPluralismPassed: 0,
    openingPluralismEvaluated: 0,
    readingEaseTotal: 0,
  };
}

function addToAggregate(aggregate, result) {
  aggregate.evaluated += 1;
  aggregate.legalityPassed += Number(result.legality.pass);
  aggregate.evidencePassed += Number(result.evidence.pass);
  aggregate.semanticsPassed += Number(result.semantics.pass);
  aggregate.provenancePassed += Number(result.provenance.pass);
  aggregate.readabilityPassed += Number(result.readability.pass);
  aggregate.exactDatabaseMatches += Number(result.provenance.exactDatabaseMatch);
  aggregate.readingEaseTotal += result.readability.germanReadingEase;
  if (result.phase === "opening") {
    aggregate.openingPluralismEvaluated += 1;
    aggregate.openingPluralismPassed += Number(
      !result.readability.issueCodes.includes("opening-ranking"),
    );
  }
}

function finalizeAggregate(aggregate) {
  const total = aggregate.evaluated;
  return {
    ...aggregate,
    legalityPercent: percentage(aggregate.legalityPassed, total),
    evidencePercent: percentage(aggregate.evidencePassed, total),
    semanticsPercent: percentage(aggregate.semanticsPassed, total),
    provenancePercent: percentage(aggregate.provenancePassed, total),
    readabilityPercent: percentage(aggregate.readabilityPassed, total),
    exactDatabaseMatchPercent: percentage(aggregate.exactDatabaseMatches, total),
    openingPluralismPercent: percentage(
      aggregate.openingPluralismPassed,
      aggregate.openingPluralismEvaluated,
    ),
    averageGermanReadingEase: total > 0
      ? Number((aggregate.readingEaseTotal / total).toFixed(2))
      : 0,
  };
}

function summarizeResults(results, key) {
  const grouped = new Map();
  for (const result of results) {
    const value = String(result[key]);
    if (!grouped.has(value)) grouped.set(value, emptyAggregate());
    addToAggregate(grouped.get(value), result);
  }
  return Object.fromEntries(
    [...grouped.entries()].map(([value, aggregate]) => [value, finalizeAggregate(aggregate)]),
  );
}

export async function evaluateCoachCorpus({
  indexPath = "data/pgn/coach-pgn-index.json",
  samplesPerCell = 200,
  seed = "coach-corpus-v1",
} = {}) {
  const index = JSON.parse(await readFile(resolve(indexPath), "utf8"));
  const sourceCorpus = auditPgnSourceCorpus(index);
  const sampling = selectStratifiedCorpus(index, { samplesPerCell, seed });
  const results = sampling.selected.map((record) => evaluateCorpusRecord(record, index));
  const overallAccumulator = emptyAggregate();
  results.forEach((result) => addToAggregate(overallAccumulator, result));
  const overall = finalizeAggregate(overallAccumulator);
  const issueCounts = {};
  const failureExamples = [];
  const safetyFailureExamples = [];
  for (const result of results) {
    const safetyIssues = [
      ...result.legality.errors.map((detail) => ({ code: "legality", detail })),
      ...result.evidence.errors.map((detail) => ({ code: "evidence", detail })),
      ...result.semantics.errors.map((detail) => ({ code: "semantics", detail })),
      ...result.provenance.errors.map((detail) => ({ code: "provenance", detail })),
    ];
    const issues = [
      ...safetyIssues,
      ...result.readability.issueCodes.map((code) => ({ code, detail: code })),
    ];
    for (const issue of issues) issueCounts[issue.code] = (issueCounts[issue.code] || 0) + 1;
    if (safetyIssues.length > 0 && safetyFailureExamples.length < MAX_FAILURE_EXAMPLES) {
      safetyFailureExamples.push({
        id: result.id,
        rating: result.rating,
        phase: result.phase,
        positionKey: result.positionKey,
        uci: result.uci,
        issues: safetyIssues,
        text: result.text.slice(0, 600),
      });
    }
    if (issues.length > 0 && failureExamples.length < MAX_FAILURE_EXAMPLES) {
      failureExamples.push({
        id: result.id,
        rating: result.rating,
        phase: result.phase,
        uci: result.uci,
        issues: [...new Set(issues.map((issue) => issue.code))],
        text: result.text.slice(0, 600),
      });
    }
  }

  const uniqueGames = new Set(results.map((result) => result.gameId).filter(Boolean)).size;
  const beginnerResults = results.filter((result) => result.rating <= 1000);
  const beginnerReadable = beginnerResults.filter((result) => result.readability.pass).length;
  const safetyReady = (
    overall.legalityPercent === 100
    && overall.evidencePercent === 100
    && overall.semanticsPercent === 100
    && overall.provenancePercent === 100
  );
  const languageReady = (
    percentage(beginnerReadable, beginnerResults.length) >= 98
    && overall.openingPluralismPercent === 100
  );
  const coverageReady = results.length >= 1_000 && uniqueGames >= 100;
  const offlineReplayReady = safetyReady && languageReady && coverageReady;
  return {
    schemaVersion: CORPUS_EVALUATION_SCHEMA_VERSION,
    method: "deterministic_stratified_offline_position_replay",
    config: {
      indexPath,
      seed,
      samplesPerCell: sampling.samplesPerCell,
      ratings: [...CORPUS_EVALUATION_RATINGS],
      phases: [...CORPUS_EVALUATION_PHASES],
      paidAiCalls: 0,
      engineEvaluationUsed: false,
      note: "Neutral bewertete legale Linien prüfen die Erklärungspipeline; Zugqualität wird in diesem Massentest nicht neu bewertet.",
    },
    corpus: {
      indexVersion: index.version || 0,
      indexedPositions: index.stats?.positions || 0,
      indexedComments: index.stats?.commentsIndexed || 0,
      indexedVerifiedFacts: index.stats?.verifiedFactEntries || 0,
      indexedCommentInsights: index.stats?.commentInsightsIndexed || 0,
      indexedConsensusInsights: index.stats?.commentInsightsConsensusVerified || 0,
      indexedSources: index.sourceCount || index.stats?.uniqueFiles || 0,
      sampledPositions: results.length,
      representedAnonymousGames: uniqueGames,
      selectionHash: sampling.selectionHash,
    },
    sourceCorpus,
    coverage: sampling.cells,
    overall,
    byRating: summarizeResults(results, "rating"),
    byPhase: summarizeResults(results, "phase"),
    issueCounts: Object.fromEntries(
      Object.entries(issueCounts).sort((left, right) => right[1] - left[1]),
    ),
    gates: {
      safetyReady,
      languageReady,
      coverageReady,
      offlineReplayReady,
      pgnKnowledgeReady: sourceCorpus.coachReady > 0,
      // Rückwärtskompatibler Name für bestehende CI-Aufrufe. Dies ist nur die
      // Offline-Wiedergabeschranke, keine vollständige Produktfreigabe.
      releaseReady: offlineReplayReady,
      beginnerReadabilityPercent: percentage(beginnerReadable, beginnerResults.length),
      warning: "Dieser Lauf prüft neutrale legale Wiedergaben. Echte Zugbewertungen und Online-KI brauchen eigene Prüfungen; quarantänisierte PGN-Rohtexte sind kein Teil des Laufzeitwissens.",
    },
    safetyFailureExamples,
    failureExamples,
  };
}

function markdownCell(value) {
  return String(value ?? "").replace(/\|/g, "\\|").replace(/\n/g, " ");
}

export function coachCorpusReportMarkdown(result) {
  const status = result.gates.releaseReady
    ? "Offline-Wiedergabeschwellen bestanden"
    : "Offline-Wiedergabeschwellen nicht bestanden";
  const sections = [
    "# Offline-Massentest des Schachcoachs",
    "",
    `**Status: ${status}.**`,
    "",
    "Dieser Bericht prüft die lokale Coach-Pipeline reproduzierbar und ohne bezahlte KI-Anfragen. Er ist ein Schema-, Legalitäts- und Sprachtest mit neutralen Bewertungen – kein Ersatz für echte Stockfish-Zugreviews oder Online-KI-Tests.",
    "",
    "## Ergebnis",
    "",
    `- Getestete Stellungen: ${result.corpus.sampledPositions.toLocaleString("de-DE")}`,
    `- Repräsentierte anonymisierte Partien: ${result.corpus.representedAnonymousGames.toLocaleString("de-DE")}`,
    `- Auswahl-Hash: \`${result.corpus.selectionHash}\``,
    `- Harte Sicherheitsprüfung: ${result.gates.safetyReady ? "bestanden" : "nicht bestanden"}`,
    `- Sprache für 800–1000 Elo: ${result.gates.beginnerReadabilityPercent.toFixed(2)} % ohne Regelverstoß`,
    `- Eröffnungen ohne unbelegten Alleinanspruch: ${result.overall.openingPluralismPercent.toFixed(2)} %`,
    `- PGN-Laufzeitwissen: ${result.gates.pgnKnowledgeReady ? "geprüfte Brettfakten und anonymisierte Kommentar-Erkenntnisse verfügbar" : "noch kein geprüftes Wissen verfügbar"}`,
    "",
    "| Prüfung | Bestanden |",
    "| --- | ---: |",
    `| Zuglegalität | ${result.overall.legalityPercent.toFixed(2)} % |`,
    `| Evidenz und Zugreferenzen | ${result.overall.evidencePercent.toFixed(2)} % |`,
    `| Direkte Brett-Semantik | ${result.overall.semanticsPercent.toFixed(2)} % |`,
    `| Anonyme Herkunft und Datenprovenienz | ${result.overall.provenancePercent.toFixed(2)} % |`,
    `| Exakter, für den Coach freigegebener Wissenseintrag | ${result.overall.exactDatabaseMatchPercent.toFixed(2)} % |`,
    `| Sprachregeln | ${result.overall.readabilityPercent.toFixed(2)} % |`,
    "",
    "## Abdeckung",
    "",
    "| Elo | Phase | Verfügbar | Getestet |",
    "| ---: | --- | ---: | ---: |",
    ...result.coverage.map((cell) => (
      `| ${cell.rating} | ${cell.phase} | ${cell.availablePositions} | ${cell.selected} |`
    )),
    "",
    "## Qualität des geprüften PGN-Wissens",
    "",
    `- Geprüfte Wissenseinträge: ${result.sourceCorpus.entries.toLocaleString("de-DE")}`,
    `- Davon reproduzierbare Brettfakten: ${result.sourceCorpus.verifiedFacts.toLocaleString("de-DE")}`,
    `- Davon anonymisierte Kommentar-Erkenntnisse: ${result.sourceCorpus.commentInsights.toLocaleString("de-DE")}`,
    `- Strategische Erkenntnisse mit Quellenkonsens: ${result.sourceCorpus.consensusInsights.toLocaleString("de-DE")}`,
    `- Für den Coach freigegeben: ${result.sourceCorpus.coachReady.toLocaleString("de-DE")} (${result.sourceCorpus.coachReadyPercent.toFixed(2)} %)`,
    `- Als kurze deutsche Vorlage geeignet: ${result.sourceCorpus.visibleLanguagePassed.toLocaleString("de-DE")} (${result.sourceCorpus.visibleLanguagePercent.toFixed(2)} %)`,
    "- Ursprüngliche PGN-Kommentare sind nicht im Laufzeitindex enthalten. Sie dienen nur als Signal für neu formulierte Erkenntnisse. Taktische Motive müssen am Brett reproduzierbar sein; strategische Hinweise brauchen außerdem mindestens zwei unabhängige Quellen.",
    "",
    "| Elo | Wissenseinträge | Freigegeben | Sprachgeeignet |",
    "| ---: | ---: | ---: | ---: |",
    ...Object.entries(result.sourceCorpus.byRating).map(([rating, row]) => (
      `| ${rating} | ${row.entries} | ${row.coachReady} (${row.coachReadyPercent.toFixed(1)} %) | ${row.visibleLanguagePassed} (${row.visibleLanguagePercent.toFixed(1)} %) |`
    )),
    "",
    "Häufigste Fakten-Probleme:",
    "",
    ...(Object.keys(result.sourceCorpus.issueCounts).length > 0
      ? Object.entries(result.sourceCorpus.issueCounts).slice(0, 10).map(([issue, count]) => (
        `- \`${issue}\`: ${count.toLocaleString("de-DE")}`
      ))
      : ["- Keine Probleme im geprüften PGN-Wissen."]),
    "",
    "## Nach Spielstärke",
    "",
    "| Elo | Fälle | Legal | Belegt | Sinnprüfung | Herkunft | Sprache | Lesewert |",
    "| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
    ...Object.entries(result.byRating).map(([rating, row]) => (
      `| ${rating} | ${row.evaluated} | ${row.legalityPercent.toFixed(1)} % | ${row.evidencePercent.toFixed(1)} % | ${row.semanticsPercent.toFixed(1)} % | ${row.provenancePercent.toFixed(1)} % | ${row.readabilityPercent.toFixed(1)} % | ${row.averageGermanReadingEase.toFixed(1)} |`
    )),
    "",
    "## Nach Partiephase",
    "",
    "| Phase | Fälle | Legal | Belegt | Sinnprüfung | Herkunft | Sprache |",
    "| --- | ---: | ---: | ---: | ---: | ---: | ---: |",
    ...Object.entries(result.byPhase).map(([phase, row]) => (
      `| ${phase} | ${row.evaluated} | ${row.legalityPercent.toFixed(1)} % | ${row.evidencePercent.toFixed(1)} % | ${row.semanticsPercent.toFixed(1)} % | ${row.provenancePercent.toFixed(1)} % | ${row.readabilityPercent.toFixed(1)} % |`
    )),
    "",
    "## Häufigste Auffälligkeiten",
    "",
    ...(Object.keys(result.issueCounts).length > 0
      ? Object.entries(result.issueCounts).slice(0, 15).map(([issue, count]) => (
        `- \`${issue}\`: ${count.toLocaleString("de-DE")}`
      ))
      : ["- Keine Auffälligkeiten im gezogenen Korpus."]),
    "",
    "## Harte Fehlerbeispiele",
    "",
    ...(result.safetyFailureExamples.length > 0
      ? result.safetyFailureExamples.slice(0, 12).flatMap((example) => [
        `### ${example.rating} Elo · ${example.phase} · ${example.uci}`,
        "",
        ...example.issues.map((issue) => `- \`${issue.code}\`: ${markdownCell(issue.detail)}`),
        "",
      ])
      : ["Keine harten Fehler im gezogenen Korpus.", ""]),
    "## Beispiele für Nacharbeit",
    "",
    ...(result.failureExamples.length > 0
      ? result.failureExamples.slice(0, 12).flatMap((example) => [
        `### ${example.rating} Elo · ${example.phase} · ${example.san || example.uci}`,
        "",
        `Regeln: ${example.issues.map((issue) => `\`${issue}\``).join(", ")}`,
        "",
        `> ${markdownCell(example.text)}`,
        "",
      ])
      : ["Keine Fehlerbeispiele vorhanden.", ""]),
    "## Methode und Grenzen",
    "",
    "- Die Auswahl ist nach 800/1000/1400/1800 Elo und Eröffnung/Mittelspiel/Endspiel geschichtet. Innerhalb jeder Gruppe bestimmt ein fester SHA-256-Hash die Fälle; dieselbe Datenbank und derselbe Seed ergeben dieselbe Auswahl.",
    "- Jeder gespeicherte Zug wird mit `chess.js` aus seiner echten FEN-Stellung gespielt. Danach werden alle Zugreferenzen und Evidenz-IDs erneut durch die produktive Verifikation geschickt.",
    "- Für jeden Fall wird gemessen, ob ein freigegebener exakter PGN-Wissenseintrag verfügbar ist. Zuggebundene Fakten gelten nur für die exakte Stellung und den gespeicherten legalen Zug. Kommentar-Erkenntnisse dürfen nur ihr geprüftes Brettkonzept übertragen. Beides beweist ausdrücklich keinen besten Zug.",
    "- Der Massentest verwendet neutrale Bewertungen. Er prüft deshalb Legalität, Erdung, unmittelbare Brettlogik, Herkunft und Sprache – nicht die Stockfish-Qualität des historischen Zuges. Kuratierte Engine-Tests ergänzen diese Prüfung.",
    "- Der deutsche Lesewert ist nur ein Vergleichswert. Die Freigaberegeln verwenden zusätzlich konkrete Satzlängen, unerwünschte Floskeln, abstrakte Wörter und den Verzicht auf einen unbelegten einzigen ‚besten Zug‘ in Eröffnungen.",
    "- Kein endlicher Test kann Eignung für jede denkbare Schachstellung absolut beweisen. Ein bestandener Bericht ist eine belastbare Freigabeschwelle, kein mathematischer Vollständigkeitsbeweis.",
    "",
    "## Reproduktion",
    "",
    "```bash",
    `node scripts/evaluate-coach-corpus.mjs --samples-per-cell=${result.config.samplesPerCell} --seed=${result.config.seed}`,
    "```",
  ];
  return `${sections.join("\n")}\n`;
}

function option(argv, name, fallback = "") {
  const prefix = `--${name}=`;
  return argv.find((value) => value.startsWith(prefix))?.slice(prefix.length) || fallback;
}

async function main() {
  const argv = process.argv.slice(2);
  const samplesPerCell = Number.parseInt(option(argv, "samples-per-cell", "200"), 10);
  const reportPath = resolve(option(
    argv,
    "report",
    "reports/coach-corpus-evaluation.md",
  ));
  const jsonPath = resolve(option(
    argv,
    "json",
    "reports/coach-corpus-evaluation.json",
  ));
  const result = await evaluateCoachCorpus({
    indexPath: option(argv, "index", "data/pgn/coach-pgn-index.json"),
    samplesPerCell,
    seed: option(argv, "seed", "coach-corpus-v1"),
  });
  await mkdir(dirname(reportPath), { recursive: true });
  await mkdir(dirname(jsonPath), { recursive: true });
  await writeFile(reportPath, coachCorpusReportMarkdown(result), "utf8");
  await writeFile(jsonPath, `${JSON.stringify(result, null, 2)}\n`, "utf8");
  console.log(JSON.stringify({
    reportPath,
    jsonPath,
    sampledPositions: result.corpus.sampledPositions,
    representedAnonymousGames: result.corpus.representedAnonymousGames,
    gates: result.gates,
  }, null, 2));
  if (argv.includes("--strict") && !result.gates.releaseReady) process.exitCode = 1;
}

if (import.meta.url === new URL(process.argv[1], "file:").href) {
  main().catch((error) => {
    console.error(error?.stack || error);
    process.exitCode = 1;
  });
}
