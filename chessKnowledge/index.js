import { CORE_CHESS_CONCEPTS as conceptData } from "./concepts.js";
import { deepFreeze } from "./freeze.js";
import {
  KNOWLEDGE_SCHEMA_VERSION,
  KNOWLEDGE_TAXONOMY as taxonomyData,
} from "./taxonomy.js";
import { validateKnowledgeBase, validateTaxonomy } from "./schema.js";

export const KNOWLEDGE_TAXONOMY = deepFreeze(taxonomyData);
export const CORE_CHESS_CONCEPTS = deepFreeze(conceptData);

const validation = validateKnowledgeBase({
  taxonomy: KNOWLEDGE_TAXONOMY,
  concepts: CORE_CHESS_CONCEPTS,
});
if (!validation.valid) {
  throw new Error(`Ungültige Schachwissensbasis:\n${validation.errors.join("\n")}`);
}

const conceptsById = new Map(CORE_CHESS_CONCEPTS.map((concept) => [concept.id, concept]));
const EMPTY_RESULTS = Object.freeze([]);

function normalizedText(value) {
  return String(value || "")
    .toLocaleLowerCase("de-DE")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9äöüß.-]+/g, " ")
    .trim();
}

export function getConceptById(id) {
  return conceptsById.get(id) || null;
}

export function listConceptsByCategory(categoryId) {
  if (!KNOWLEDGE_TAXONOMY.some((category) => category.id === categoryId)) return EMPTY_RESULTS;
  return Object.freeze(CORE_CHESS_CONCEPTS.filter((concept) => concept.categories.includes(categoryId)));
}

export function retrieveConcepts({ query = "", signals = [], phases = [], limit = 4 } = {}) {
  const safeLimit = Number.isInteger(limit) ? Math.max(1, Math.min(6, limit)) : 4;
  const queryText = normalizedText(query);
  const signalSet = new Set(
    Array.isArray(signals) ? signals.filter((signal) => typeof signal === "string") : [],
  );
  const phaseSet = new Set(
    Array.isArray(phases) ? phases.filter((phase) => typeof phase === "string") : [],
  );
  if (!queryText && signalSet.size === 0) return EMPTY_RESULTS;

  return deepFreeze(CORE_CHESS_CONCEPTS
    .map((concept) => {
      const matchedSignals = concept.retrieval.signals.filter((signal) => signalSet.has(signal));
      const matchedKeywords = concept.retrieval.keywords.de.filter((keyword) => {
        const normalizedKeyword = normalizedText(keyword);
        return normalizedKeyword && queryText.includes(normalizedKeyword);
      });
      const nameMatches = [concept.name.de, concept.name.en, ...concept.aliases.de]
        .map(normalizedText)
        .filter(Boolean)
        .filter((name) => queryText.includes(name));
      const phaseMatch = phaseSet.size === 0
        || concept.retrieval.phases.includes("all")
        || concept.retrieval.phases.some((phase) => phaseSet.has(phase));
      const score = matchedSignals.length * 10
        + nameMatches.length * 6
        + matchedKeywords.length * 4
        + (matchedSignals.length > 0 || matchedKeywords.length > 0 || nameMatches.length > 0 ? 1 : 0);
      return {
        concept,
        score,
        phaseMatch,
        matchedSignals,
        matchedKeywords,
      };
    })
    .filter((result) => result.score > 0 && result.phaseMatch)
    .map(({ phaseMatch: _phaseMatch, ...result }) => result)
    .sort((left, right) => right.score - left.score || left.concept.id.localeCompare(right.concept.id))
    .slice(0, safeLimit));
}

export {
  KNOWLEDGE_SCHEMA_VERSION,
  validateKnowledgeBase,
  validateTaxonomy,
};
