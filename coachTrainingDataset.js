import { createHash } from "node:crypto";
import {
  MOVE_EXPLANATION_INSTRUCTIONS,
  validateMoveExplanationTrainingTarget,
} from "./api/chat.js";

export const COACH_TRAINING_DATASET_VERSION = 1;
export const COACH_TRAINING_SPLITS = Object.freeze([
  "train",
  "validation",
  "test",
]);

const ID_PATTERN = /^[a-z0-9][a-z0-9._:-]{2,159}$/i;

function text(value, maximum = 160) {
  return typeof value === "string"
    ? value.trim().replace(/\s+/g, " ").slice(0, maximum)
    : "";
}

function sha256(value) {
  return createHash("sha256").update(String(value)).digest("hex");
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.keys(value)
    .sort()
    .map((key) => [key, stableValue(value[key])]));
}

function stableJson(value) {
  return JSON.stringify(stableValue(value));
}

function validReviewDate(value) {
  return typeof value === "string"
    && Number.isFinite(Date.parse(value))
    && /T/.test(value);
}

function trainingPayload(value) {
  return {
    engineContext: value?.engineContext || null,
    openingContext: value?.openingContext || null,
    learnerProfile: value?.learnerProfile || null,
  };
}

export function validateApprovedCoachTrainingRecord(record) {
  const errors = [];
  const id = text(record?.id);
  const groupKey = text(record?.groupKey);
  const reviewer = text(record?.approval?.reviewer, 120);
  const reviewedAt = record?.approval?.reviewedAt;

  if (!ID_PATTERN.test(id)) errors.push("id fehlt oder hat ein ungültiges Format.");
  if (!ID_PATTERN.test(groupKey)) {
    errors.push("groupKey fehlt oder hat ein ungültiges Format.");
  }
  if (record?.lifecycle !== "human_approved") {
    errors.push("lifecycle muss human_approved sein.");
  }
  if (!reviewer) errors.push("approval.reviewer fehlt.");
  if (!validReviewDate(reviewedAt)) {
    errors.push("approval.reviewedAt muss ein ISO-Zeitstempel sein.");
  }
  if (!record?.target || typeof record.target !== "object") {
    errors.push("target fehlt.");
  }

  const payload = trainingPayload(record?.payload);
  const targetValidation = errors.length === 0
    ? validateMoveExplanationTrainingTarget(record.target, payload)
    : null;
  if (targetValidation && !targetValidation.valid) {
    errors.push(...targetValidation.errors.map((error) => `target: ${error}`));
  }

  return {
    valid: errors.length === 0,
    errors,
    value: errors.length === 0
      ? {
        version: COACH_TRAINING_DATASET_VERSION,
        id,
        groupKey,
        payload,
        prompt: targetValidation.prompt,
        target: targetValidation.value,
        phase: targetValidation.context.phase,
        learnerRating: targetValidation.context.learnerProfile.rating,
        reviewedAt,
      }
      : null,
  };
}

export function buildCoachTrainingExample(record) {
  const checked = validateApprovedCoachTrainingRecord(record);
  if (!checked.valid) return checked;
  const value = checked.value;
  const assistant = stableJson(value.target);
  const messages = [
    { role: "system", content: MOVE_EXPLANATION_INSTRUCTIONS },
    { role: "user", content: value.prompt },
    { role: "assistant", content: assistant },
  ];
  return {
    valid: true,
    errors: [],
    value: {
      ...value,
      messages,
      fingerprint: sha256(stableJson(messages)),
    },
  };
}

function splitCounts(groupCount, validationRatio, testRatio) {
  const validation = Math.max(1, Math.round(groupCount * validationRatio));
  const test = Math.max(1, Math.round(groupCount * testRatio));
  if (validation + test >= groupCount) {
    return { validation: 1, test: 1 };
  }
  return { validation, test };
}

export function splitCoachTrainingExamples(examples, {
  seed = "coach-training-v1",
  validationRatio = 0.1,
  testRatio = 0.1,
} = {}) {
  const groups = new Map();
  examples.forEach((example) => {
    if (!groups.has(example.groupKey)) groups.set(example.groupKey, []);
    groups.get(example.groupKey).push(example);
  });
  if (groups.size < 3) {
    throw new Error("Für Train, Validation und Test werden mindestens drei groupKey-Gruppen benötigt.");
  }

  const orderedGroups = [...groups.entries()]
    .map(([groupKey, items]) => ({
      groupKey,
      items: [...items].sort((left, right) => left.id.localeCompare(right.id, "en")),
      score: sha256(`${seed}|${groupKey}`),
    }))
    .sort((left, right) => (
      left.score.localeCompare(right.score, "en")
      || left.groupKey.localeCompare(right.groupKey, "en")
    ));
  const counts = splitCounts(groups.size, validationRatio, testRatio);
  const validationGroups = new Set(
    orderedGroups.slice(0, counts.validation).map((group) => group.groupKey),
  );
  const testGroups = new Set(
    orderedGroups
      .slice(counts.validation, counts.validation + counts.test)
      .map((group) => group.groupKey),
  );
  const splits = { train: [], validation: [], test: [] };
  orderedGroups.forEach((group) => {
    const split = validationGroups.has(group.groupKey)
      ? "validation"
      : testGroups.has(group.groupKey)
        ? "test"
        : "train";
    splits[split].push(...group.items);
  });
  return splits;
}

export function buildCoachTrainingDataset(records, options = {}) {
  if (!Array.isArray(records)) throw new TypeError("records muss ein Array sein.");
  const errors = [];
  const examples = [];
  const ids = new Set();
  const fingerprints = new Map();

  records.forEach((record, index) => {
    const checked = buildCoachTrainingExample(record);
    const label = text(record?.id) || `Zeile ${index + 1}`;
    if (!checked.valid) {
      errors.push(...checked.errors.map((error) => `${label}: ${error}`));
      return;
    }
    const example = checked.value;
    if (ids.has(example.id)) {
      errors.push(`${example.id}: doppelte id.`);
      return;
    }
    ids.add(example.id);
    const duplicate = fingerprints.get(example.fingerprint);
    if (duplicate) {
      errors.push(`${example.id}: inhaltlich identisch mit ${duplicate}.`);
      return;
    }
    fingerprints.set(example.fingerprint, example.id);
    examples.push(example);
  });

  if (errors.length > 0) {
    return { valid: false, errors, examples: [], splits: null, manifest: null };
  }
  const splits = splitCoachTrainingExamples(examples, options);
  const seed = text(options.seed) || "coach-training-v1";
  const manifestEntries = COACH_TRAINING_SPLITS.flatMap((split) => (
    splits[split].map((example) => ({
      id: example.id,
      groupKey: example.groupKey,
      split,
      fingerprint: example.fingerprint,
      phase: example.phase,
      learnerRating: example.learnerRating,
    }))
  ));
  const manifest = {
    version: COACH_TRAINING_DATASET_VERSION,
    purpose: "stockfish_grounded_coach_sft",
    seed,
    createdAt: new Date().toISOString(),
    counts: Object.fromEntries(COACH_TRAINING_SPLITS.map((split) => [
      split,
      splits[split].length,
    ])),
    groupCounts: Object.fromEntries(COACH_TRAINING_SPLITS.map((split) => [
      split,
      new Set(splits[split].map((example) => example.groupKey)).size,
    ])),
    datasetHash: sha256(stableJson(manifestEntries)),
    entries: manifestEntries,
  };
  return { valid: true, errors: [], examples, splits, manifest };
}

export function supervisedJsonlRecord(example) {
  return { messages: example.messages };
}

export function heldOutEvaluationRecord(example) {
  return {
    version: COACH_TRAINING_DATASET_VERSION,
    id: example.id,
    groupKey: example.groupKey,
    payload: example.payload,
    prompt: example.prompt,
    target: example.target,
    phase: example.phase,
    learnerRating: example.learnerRating,
    fingerprint: example.fingerprint,
  };
}
