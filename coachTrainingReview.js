import { validateApprovedCoachTrainingRecord } from "./coachTrainingDataset.js";

export const COACH_TRAINING_EDITABLE_FIELDS = Object.freeze([
  "moveIdea",
  "verdict",
  "opponentReply",
  "concreteConsequence",
  "alternative",
  "comparison",
  "takeaway",
]);

function cleanText(value, maximum = 2_000) {
  return typeof value === "string" ? value.trim().slice(0, maximum) : "";
}

export function coachTrainingTextEdits(candidate, value = {}) {
  return Object.fromEntries(COACH_TRAINING_EDITABLE_FIELDS.flatMap((field) => {
    if (!candidate?.target?.[field] || typeof value?.[field] !== "string") return [];
    return [[field, value[field].trim().slice(0, 2_000)]];
  }));
}

export function applyCoachTrainingTextEdits(candidate, value = {}) {
  const target = structuredClone(candidate?.target || null);
  if (!target || typeof target !== "object") return null;
  const edits = coachTrainingTextEdits(candidate, value);
  Object.entries(edits).forEach(([field, fieldText]) => {
    target[field].text = fieldText;
  });
  return target;
}

export function buildApprovedCoachTrainingRecord(candidate, {
  reviewer,
  reviewedAt = new Date().toISOString(),
  textEdits = {},
} = {}) {
  const record = {
    ...structuredClone(candidate),
    lifecycle: "human_approved",
    approval: {
      reviewer: cleanText(reviewer, 120),
      reviewedAt,
    },
    target: applyCoachTrainingTextEdits(candidate, textEdits),
  };
  const checked = validateApprovedCoachTrainingRecord(record);
  return {
    ...checked,
    record: checked.valid ? record : null,
    textEdits: coachTrainingTextEdits(candidate, textEdits),
  };
}

export function coachTrainingReviewEntry(candidate, {
  decision,
  reviewer,
  notes = "",
  reviewedAt = new Date().toISOString(),
  textEdits = {},
} = {}) {
  const normalizedDecision = ["approved", "rejected"].includes(decision)
    ? decision
    : "";
  if (!candidate?.id) return { valid: false, errors: ["Kandidat fehlt."] };
  if (!normalizedDecision) return { valid: false, errors: ["Entscheidung ist ungültig."] };
  const normalizedReviewer = cleanText(reviewer, 120);
  if (!normalizedReviewer) return { valid: false, errors: ["Reviewer fehlt."] };

  let approval = null;
  let normalizedEdits = coachTrainingTextEdits(candidate, textEdits);
  if (normalizedDecision === "approved") {
    approval = buildApprovedCoachTrainingRecord(candidate, {
      reviewer: normalizedReviewer,
      reviewedAt,
      textEdits: normalizedEdits,
    });
    if (!approval.valid) return { valid: false, errors: approval.errors };
    normalizedEdits = approval.textEdits;
  }

  return {
    valid: true,
    errors: [],
    approvedRecord: approval?.record || null,
    value: {
      id: candidate.id,
      candidateVersion: Number.parseInt(candidate.version, 10) || 1,
      decision: normalizedDecision,
      reviewer: normalizedReviewer,
      reviewedAt,
      notes: cleanText(notes, 1_000),
      textEdits: normalizedEdits,
    },
  };
}
