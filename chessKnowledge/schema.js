import { KNOWLEDGE_SCHEMA_VERSION } from "./taxonomy.js";

const ID_PATTERN = /^[a-z0-9]+(?:[.-][a-z0-9]+)*$/;
const PHASES = new Set(["opening", "middlegame", "endgame", "all"]);
const DIFFICULTIES = new Set(["beginner", "intermediate", "advanced"]);
const REQUIRED_LOCALIZED_LISTS = [
  "recognitionCues",
  "recommendations",
  "exceptions",
  "commonMistakes",
  "practicalQuestions",
];
const TAXONOMY_FIELDS = new Set(["id", "name", "group", "order"]);
const CONCEPT_FIELDS = new Set([
  "id",
  "version",
  "name",
  "categories",
  "difficulty",
  "aliases",
  "definition",
  "explanation",
  "recognitionCues",
  "recommendations",
  "exceptions",
  "commonMistakes",
  "practicalQuestions",
  "training",
  "relatedConcepts",
  "retrieval",
  "source",
]);

function nonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function localizedString(value) {
  return value && nonEmptyString(value.de);
}

function localizedList(value, minimum = 1) {
  return value
    && Array.isArray(value.de)
    && value.de.length >= minimum
    && value.de.every(nonEmptyString);
}

export function validateTaxonomy(taxonomy) {
  const errors = [];
  if (!Array.isArray(taxonomy) || taxonomy.length === 0) {
    return { valid: false, errors: ["Taxonomie muss eine nicht leere Liste sein."] };
  }

  const ids = new Set();
  const orders = new Set();
  for (const [index, category] of taxonomy.entries()) {
    const label = `Kategorie ${index + 1}`;
    if (!category || typeof category !== "object") {
      errors.push(`${label}: ungültiger Eintrag.`);
      continue;
    }
    const unknownFields = Object.keys(category).filter((field) => !TAXONOMY_FIELDS.has(field));
    if (unknownFields.length > 0) errors.push(`${label}: unbekannte Felder ${unknownFields.join(", ")}.`);
    if (!ID_PATTERN.test(category.id || "")) errors.push(`${label}: ungültige ID.`);
    if (ids.has(category.id)) errors.push(`${label}: doppelte Kategorie-ID ${category.id}.`);
    ids.add(category.id);
    if (!nonEmptyString(category.name?.de) || !nonEmptyString(category.name?.en)) {
      errors.push(`${label}: deutsche und englische Bezeichnung sind erforderlich.`);
    }
    if (!nonEmptyString(category.group)) errors.push(`${label}: Gruppe fehlt.`);
    if (!Number.isInteger(category.order) || category.order < 1) {
      errors.push(`${label}: Sortierung fehlt.`);
    } else {
      if (orders.has(category.order)) errors.push(`${label}: doppelte Sortierung ${category.order}.`);
      orders.add(category.order);
      if (category.order !== index + 1) errors.push(`${label}: Sortierung muss fortlaufend sein.`);
    }
  }
  return { valid: errors.length === 0, errors };
}

export function validateKnowledgeBase({ taxonomy, concepts } = {}) {
  const taxonomyResult = validateTaxonomy(taxonomy);
  const errors = [...taxonomyResult.errors];
  if (!Array.isArray(concepts) || concepts.length === 0) {
    errors.push("Wissensbasis muss eine nicht leere Konzeptliste enthalten.");
    return { valid: false, errors };
  }

  const safeTaxonomy = Array.isArray(taxonomy) ? taxonomy : [];
  const categoryIds = new Set(safeTaxonomy.map((category) => category?.id).filter(Boolean));
  const conceptIds = new Set();
  for (const concept of concepts) {
    if (!ID_PATTERN.test(concept?.id || "")) errors.push(`Konzept: ungültige ID ${concept?.id || "<leer>"}.`);
    if (conceptIds.has(concept?.id)) errors.push(`doppelte Konzept-ID ${concept.id}.`);
    conceptIds.add(concept?.id);
  }

  for (const [index, concept] of concepts.entries()) {
    const label = concept?.id || `Konzept ${index + 1}`;
    if (!concept || typeof concept !== "object") {
      errors.push(`${label}: ungültiger Eintrag.`);
      continue;
    }
    const unknownFields = Object.keys(concept).filter((field) => !CONCEPT_FIELDS.has(field));
    if (unknownFields.length > 0) errors.push(`${label}: unbekannte Felder ${unknownFields.join(", ")}.`);
    if (concept?.version !== KNOWLEDGE_SCHEMA_VERSION) {
      errors.push(`${label}: falsche Schemaversion.`);
    }
    if (!nonEmptyString(concept?.name?.de) || !nonEmptyString(concept?.name?.en)) {
      errors.push(`${label}: deutsche und englische Bezeichnung fehlen.`);
    }
    if (!Array.isArray(concept?.categories) || concept.categories.length === 0) {
      errors.push(`${label}: mindestens eine Kategorie ist erforderlich.`);
    } else {
      for (const category of concept.categories) {
        if (!categoryIds.has(category)) errors.push(`${label}: unbekannte Kategorie ${category}.`);
      }
    }
    if (!Array.isArray(concept?.difficulty) || concept.difficulty.length === 0
      || concept.difficulty.some((level) => !DIFFICULTIES.has(level))) {
      errors.push(`${label}: ungültige Schwierigkeitsstufe.`);
    }
    if (!localizedString(concept?.definition)) errors.push(`${label}: Definition fehlt.`);
    if (!localizedString(concept?.explanation)) errors.push(`${label}: Erklärung fehlt.`);
    if (!localizedString(concept?.training)) errors.push(`${label}: Training fehlt.`);
    for (const field of REQUIRED_LOCALIZED_LISTS) {
      const minimum = ["recognitionCues", "recommendations", "practicalQuestions"].includes(field) ? 2 : 1;
      if (!localizedList(concept?.[field], minimum)) errors.push(`${label}: ${field} ist unvollständig.`);
    }
    if (!Array.isArray(concept?.relatedConcepts)) {
      errors.push(`${label}: relatedConcepts muss eine Liste sein.`);
    } else {
      for (const relatedId of concept.relatedConcepts) {
        if (!conceptIds.has(relatedId)) errors.push(`${label}: unbekanntes verwandtes Konzept ${relatedId}.`);
        if (relatedId === concept.id) errors.push(`${label}: Selbstreferenz ist nicht erlaubt.`);
      }
    }
    if (!Array.isArray(concept?.retrieval?.signals) || concept.retrieval.signals.some((signal) => !ID_PATTERN.test(signal))) {
      errors.push(`${label}: ungültige Retrieval-Signale.`);
    }
    if (!localizedList(concept?.retrieval?.keywords, 2)) errors.push(`${label}: Retrieval-Schlüsselwörter fehlen.`);
    if (!Array.isArray(concept?.retrieval?.phases)
      || concept.retrieval.phases.length === 0
      || concept.retrieval.phases.some((phase) => !PHASES.has(phase))) {
      errors.push(`${label}: ungültige Partiephase.`);
    }
    if (concept?.source?.type !== "curated" || !nonEmptyString(concept?.source?.note)) {
      errors.push(`${label}: Quellenstatus fehlt.`);
    }
  }

  return { valid: errors.length === 0, errors };
}
