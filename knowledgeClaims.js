import knowledgeDocument from "./data/knowledge/claims.json" with { type: "json" };

export const LEARNER_LEVELS = Object.freeze([
  "beginner",
  "intermediate",
  "advanced",
]);

export const KNOWLEDGE_PHASES = Object.freeze([
  "opening",
  "middlegame",
  "endgame",
]);

const REVIEWED = "reviewed";
const ID_PATTERN = /^[a-z][a-z0-9_.-]*$/;
const FEATURE_PATTERN = /^[a-z][a-z0-9_]*\.[a-z0-9_.-]+$/;
const VALID_REVIEW_STATUSES = new Set([REVIEWED, "draft", "rejected"]);
const PHASE_ALIASES = new Map([
  ["opening", "opening"],
  ["eröffnung", "opening"],
  ["eroeffnung", "opening"],
  ["middlegame", "middlegame"],
  ["middle-game", "middlegame"],
  ["mittelspiel", "middlegame"],
  ["endgame", "endgame"],
  ["end-game", "endgame"],
  ["endspiel", "endgame"],
]);

function isObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.values(value).forEach(deepFreeze);
  return Object.freeze(value);
}

function asString(value) {
  return typeof value === "string" ? value.trim() : "";
}

function validateStringArray(errors, value, path, pattern = null) {
  if (!Array.isArray(value) || value.length === 0) {
    errors.push(`${path} muss ein nicht-leeres Array sein.`);
    return;
  }
  const seen = new Set();
  value.forEach((entry, index) => {
    const text = asString(entry);
    if (!text) {
      errors.push(`${path}[${index}] muss eine nicht-leere Zeichenfolge sein.`);
    } else if (pattern && !pattern.test(text)) {
      errors.push(`${path}[${index}] hat ein ungültiges Format: ${text}`);
    } else if (seen.has(text)) {
      errors.push(`${path} enthält den doppelten Wert ${text}.`);
    }
    seen.add(text);
  });
}

/**
 * Validiert Schema, Provenienz und Freigabestatus, ohne Daten stillschweigend
 * zu reparieren. Konkrete Schachrichtigkeit bleibt Aufgabe der fachlichen
 * Review sowie der Engine-/Legalitätsschicht.
 */
export function validateKnowledgeDocument(document) {
  const errors = [];
  if (!isObject(document)) {
    return { valid: false, errors: ["Das Wissensdokument muss ein Objekt sein."] };
  }
  if (document.contentPolicy?.mode !== "paraphrase-only") {
    errors.push("contentPolicy.mode muss paraphrase-only sein.");
  }

  const sources = Array.isArray(document.sources) ? document.sources : [];
  if (sources.length === 0) errors.push("sources muss mindestens eine Quelle enthalten.");
  const sourceIds = new Set();
  const sourceById = new Map();
  sources.forEach((source, index) => {
    const path = `sources[${index}]`;
    if (!isObject(source)) {
      errors.push(`${path} muss ein Objekt sein.`);
      return;
    }
    const id = asString(source.id);
    if (!ID_PATTERN.test(id)) errors.push(`${path}.id ist ungültig.`);
    if (sourceIds.has(id)) errors.push(`${path}.id ist doppelt: ${id}`);
    sourceIds.add(id);
    sourceById.set(id, source);
    ["title", "author", "kind", "rights", "usePolicy"].forEach((field) => {
      if (!asString(source[field])) errors.push(`${path}.${field} fehlt.`);
    });
    if (!Number.isInteger(source.publicationYear)
      || source.publicationYear < 1400
      || source.publicationYear > 2100) {
      errors.push(`${path}.publicationYear ist ungültig.`);
    }
    if (!VALID_REVIEW_STATUSES.has(source.reviewStatus)) {
      errors.push(`${path}.reviewStatus ist ungültig.`);
    }
  });

  const claims = Array.isArray(document.claims) ? document.claims : [];
  if (claims.length === 0) errors.push("claims muss mindestens einen Claim enthalten.");
  const claimIds = new Set();
  claims.forEach((claim, index) => {
    const path = `claims[${index}]`;
    if (!isObject(claim)) {
      errors.push(`${path} muss ein Objekt sein.`);
      return;
    }
    const id = asString(claim.id);
    if (!ID_PATTERN.test(id)) errors.push(`${path}.id ist ungültig.`);
    if (claimIds.has(id)) errors.push(`${path}.id ist doppelt: ${id}`);
    claimIds.add(id);

    validateStringArray(errors, claim.conceptIds, `${path}.conceptIds`, FEATURE_PATTERN);
    if (asString(claim.paraphrase).length < 40) {
      errors.push(`${path}.paraphrase ist zu kurz.`);
    }
    if (asString(claim.rationale).length < 30) {
      errors.push(`${path}.rationale ist zu kurz.`);
    }

    validateStringArray(errors, claim.requiredFeatures, `${path}.requiredFeatures`, FEATURE_PATTERN);
    if (!Array.isArray(claim.excludedFeatures)) {
      errors.push(`${path}.excludedFeatures muss ein Array sein.`);
    } else {
      const excluded = new Set();
      claim.excludedFeatures.forEach((feature, featureIndex) => {
        if (!FEATURE_PATTERN.test(asString(feature))) {
          errors.push(`${path}.excludedFeatures[${featureIndex}] ist ungültig.`);
        }
        excluded.add(feature);
      });
      (claim.requiredFeatures || []).forEach((feature) => {
        if (excluded.has(feature)) {
          errors.push(`${path} verlangt und verbietet zugleich ${feature}.`);
        }
      });
    }

    validateStringArray(errors, claim.phases, `${path}.phases`);
    (claim.phases || []).forEach((phase) => {
      if (!KNOWLEDGE_PHASES.includes(phase)) {
        errors.push(`${path}.phases enthält eine unbekannte Phase: ${phase}`);
      }
    });
    validateStringArray(errors, claim.learnerLevels, `${path}.learnerLevels`);
    (claim.learnerLevels || []).forEach((level) => {
      if (!LEARNER_LEVELS.includes(level)) {
        errors.push(`${path}.learnerLevels enthält ein unbekanntes Niveau: ${level}`);
      }
    });

    if (!Array.isArray(claim.sources) || claim.sources.length === 0) {
      errors.push(`${path}.sources muss mindestens einen Quellenbeleg enthalten.`);
    } else {
      claim.sources.forEach((reference, sourceIndex) => {
        const sourcePath = `${path}.sources[${sourceIndex}]`;
        if (!isObject(reference)) {
          errors.push(`${sourcePath} muss ein Objekt sein.`);
          return;
        }
        const sourceId = asString(reference.sourceId);
        if (!sourceById.has(sourceId)) {
          errors.push(`${sourcePath}.sourceId verweist auf eine unbekannte Quelle: ${sourceId}`);
        }
        ["locator", "usage"].forEach((field) => {
          if (!asString(reference[field])) errors.push(`${sourcePath}.${field} fehlt.`);
        });
        if (!VALID_REVIEW_STATUSES.has(reference.reviewStatus)) {
          errors.push(`${sourcePath}.reviewStatus ist ungültig.`);
        }
      });
    }

    if (!VALID_REVIEW_STATUSES.has(claim.reviewStatus)) {
      errors.push(`${path}.reviewStatus ist ungültig.`);
    }
    if (!Number.isFinite(claim.confidence)
      || claim.confidence < 0
      || claim.confidence > 1) {
      errors.push(`${path}.confidence muss zwischen 0 und 1 liegen.`);
    }
  });

  return { valid: errors.length === 0, errors };
}

const documentValidation = validateKnowledgeDocument(knowledgeDocument);
if (!documentValidation.valid) {
  throw new Error(
    `Ungültige Schachwissensdaten:\n${documentValidation.errors.join("\n")}`,
  );
}

const rawSources = knowledgeDocument.sources.map((source) => ({ ...source }));
const sourceById = new Map(rawSources.map((source) => [source.id, source]));

export const KNOWLEDGE_SOURCES = deepFreeze(rawSources);

export const KNOWLEDGE_CLAIMS = deepFreeze(
  knowledgeDocument.claims.map((claim) => ({
    ...claim,
    conceptIds: [...claim.conceptIds],
    requiredFeatures: [...claim.requiredFeatures],
    excludedFeatures: [...claim.excludedFeatures],
    phases: [...claim.phases],
    learnerLevels: [...claim.learnerLevels],
    sources: claim.sources.map((reference) => ({
      ...sourceById.get(reference.sourceId),
      sourceId: reference.sourceId,
      locator: reference.locator,
      usage: reference.usage,
      referenceReviewStatus: reference.reviewStatus,
    })),
  })),
);

export const KNOWLEDGE_FEATURE_IDS = Object.freeze(
  [...new Set(
    KNOWLEDGE_CLAIMS.flatMap((claim) => [
      ...claim.requiredFeatures,
      ...claim.excludedFeatures,
    ]),
  )].sort(),
);

export function normalizeLearnerLevel(value) {
  const candidate = isObject(value)
    ? value.learnerLevel ?? value.level ?? value.rating ?? value.elo
    : value;
  if (Number.isFinite(candidate)) {
    if (candidate < 1200) return "beginner";
    if (candidate < 1800) return "intermediate";
    return "advanced";
  }
  const text = asString(candidate).toLowerCase();
  if (LEARNER_LEVELS.includes(text)) return text;
  if (["anfänger", "anfaenger", "einsteiger"].includes(text)) return "beginner";
  if (["fortgeschritten", "mittel", "club"].includes(text)) return "intermediate";
  if (["experte", "expert", "stark"].includes(text)) return "advanced";
  return "intermediate";
}

function normalizePhase(value) {
  return PHASE_ALIASES.get(asString(value).toLowerCase()) || null;
}

function normalizeFeatureIds(value) {
  if (!Array.isArray(value) && !(value instanceof Set)) return new Set();
  return new Set(
    [...value]
      .map(asString)
      .filter((feature) => FEATURE_PATTERN.test(feature)),
  );
}

function reviewedSourcesOnly(claim) {
  return Array.isArray(claim.sources)
    && claim.sources.length > 0
    && claim.sources.every((source) => (
      source.reviewStatus === REVIEWED
      && (source.referenceReviewStatus === undefined
        || source.referenceReviewStatus === REVIEWED)
    ));
}

function matchScore(claim, phase, learnerLevel, conceptIds) {
  const conceptMatches = claim.conceptIds.filter((id) => conceptIds.has(id)).length;
  const levelSpecificity = claim.learnerLevels.length === 1
    && claim.learnerLevels[0] === learnerLevel ? 1 : 0;
  return (
    claim.requiredFeatures.length * 100
    + conceptMatches * 25
    + levelSpecificity * 10
    + (claim.phases.length === 1 && claim.phases[0] === phase ? 5 : 0)
    + claim.confidence
  );
}

/**
 * Liefert nur Claims, deren Voraussetzungen vollständig belegt sind.
 * Fehlen Phase oder Feature-Belege, ist das konservative Ergebnis leer.
 */
export function retrieveKnowledgeClaims(
  {
    phase,
    featureIds = [],
    learnerLevel = "intermediate",
    conceptIds = [],
    limit = 3,
    minConfidence = 0.8,
  } = {},
  {
    claims = KNOWLEDGE_CLAIMS,
    requireReviewedSources = true,
  } = {},
) {
  const normalizedPhase = normalizePhase(phase);
  const normalizedLevel = normalizeLearnerLevel(learnerLevel);
  const features = normalizeFeatureIds(featureIds);
  const concepts = normalizeFeatureIds(conceptIds);
  const boundedLimit = Math.max(0, Math.min(8, Math.floor(Number(limit) || 0)));
  const threshold = Number.isFinite(minConfidence)
    ? Math.max(0, Math.min(1, minConfidence))
    : 0.8;

  if (!normalizedPhase || features.size === 0 || boundedLimit === 0) return [];

  return claims
    .filter((claim) => (
      claim?.reviewStatus === REVIEWED
      && Number.isFinite(claim.confidence)
      && claim.confidence >= threshold
      && Array.isArray(claim.phases)
      && claim.phases.includes(normalizedPhase)
      && Array.isArray(claim.learnerLevels)
      && claim.learnerLevels.includes(normalizedLevel)
      && Array.isArray(claim.requiredFeatures)
      && claim.requiredFeatures.length > 0
      && claim.requiredFeatures.every((feature) => features.has(feature))
      && Array.isArray(claim.excludedFeatures)
      && !claim.excludedFeatures.some((feature) => features.has(feature))
      && (!requireReviewedSources || reviewedSourcesOnly(claim))
    ))
    .map((claim) => ({
      claim,
      score: matchScore(claim, normalizedPhase, normalizedLevel, concepts),
      matchedFeatures: claim.requiredFeatures.filter((feature) => features.has(feature)),
    }))
    .sort((left, right) => (
      right.score - left.score
      || right.claim.confidence - left.claim.confidence
      || left.claim.id.localeCompare(right.claim.id, "de")
    ))
    .slice(0, boundedLimit)
    .map(({ claim, matchedFeatures }) => deepFreeze({
      ...claim,
      matchedFeatures: [...matchedFeatures],
    }));
}

/**
 * Reduziert Treffer auf die für einen Coach-Prompt nötigen Felder. Der Prompt
 * erhält Prinzip und Begründung, aber keinen fremden Buchtext.
 */
export function buildCoachKnowledgeContext(query, options) {
  return retrieveKnowledgeClaims(query, options).map((claim) => ({
    id: claim.id,
    conceptIds: claim.conceptIds,
    principle: claim.paraphrase,
    rationale: claim.rationale,
    matchedFeatures: claim.matchedFeatures,
    confidence: claim.confidence,
    reviewStatus: claim.reviewStatus,
    sources: claim.sources.map((source) => ({
      id: source.sourceId,
      title: source.title,
      author: source.author,
      publicationYear: source.publicationYear,
      locator: source.locator,
      usage: source.usage,
      reviewStatus: source.referenceReviewStatus,
    })),
  }));
}
