import { deepFreeze } from "./freeze.js";
import { retrieveConcepts } from "./index.js";
import { detectKnowledgeEvidence } from "./detector.js";

const MAX_COACH_CONCEPTS = 4;

function clampLimit(value) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? Math.max(1, Math.min(MAX_COACH_CONCEPTS, parsed)) : MAX_COACH_CONCEPTS;
}

function compactConcept(result, evidence) {
  const matchedSignals = [...result.matchedSignals];
  const matchingEvidence = evidence
    .filter((entry) => matchedSignals.includes(entry.signal))
    .slice(0, 3);
  const basis = matchingEvidence.some((entry) => entry.source === "board")
    ? "position-evidence"
    : matchingEvidence.length > 0
      ? "review-relevance"
      : "question-only";
  return {
    id: result.concept.id,
    name: result.concept.name,
    definition: result.concept.definition.de,
    explanation: result.concept.explanation.de,
    recommendations: result.concept.recommendations.de,
    exceptions: result.concept.exceptions.de,
    matchedSignals,
    matchedKeywords: [...result.matchedKeywords],
    basis,
    evidence: matchingEvidence,
  };
}

export function buildCoachKnowledgeContext(input = {}, options = {}) {
  const payload = input && typeof input === "object" ? input : {};
  const limit = options && typeof options === "object" ? options.limit : MAX_COACH_CONCEPTS;
  const detection = detectKnowledgeEvidence({ engineContext: payload.engineContext });
  const positionResults = retrieveConcepts({
    query: "",
    signals: detection.signals,
    phases: detection.phases,
    limit: MAX_COACH_CONCEPTS * 2,
  });
  const questionResults = retrieveConcepts({
    query: typeof payload.message === "string" ? payload.message : "",
    signals: [],
    phases: [],
    limit: MAX_COACH_CONCEPTS * 2,
  });
  const merged = new Map();
  for (const result of [...positionResults, ...questionResults]) {
    const previous = merged.get(result.concept.id);
    if (!previous) {
      merged.set(result.concept.id, {
        ...result,
        matchedSignals: [...result.matchedSignals],
        matchedKeywords: [...result.matchedKeywords],
      });
      continue;
    }
    previous.score += result.score;
    previous.matchedSignals = [...new Set([...previous.matchedSignals, ...result.matchedSignals])];
    previous.matchedKeywords = [...new Set([...previous.matchedKeywords, ...result.matchedKeywords])];
  }
  const results = [...merged.values()]
    .sort((left, right) => {
      const leftExplicit = left.matchedKeywords.length > 0 ? 1 : 0;
      const rightExplicit = right.matchedKeywords.length > 0 ? 1 : 0;
      return rightExplicit - leftExplicit || right.score - left.score || left.concept.id.localeCompare(right.concept.id);
    })
    .slice(0, clampLimit(limit));

  return deepFreeze({
    version: 1,
    phase: detection.phase,
    phases: detection.phases,
    side: detection.side,
    concepts: results.map((result) => compactConcept(result, detection.evidence)),
  });
}
