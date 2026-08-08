import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { coachTrainingReviewEntry } from "../../../coachTrainingReview.js";
import { validateApprovedCoachTrainingRecord } from "../../../coachTrainingDataset.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const candidatesPath = path.join(
  process.cwd(),
  ".cache",
  "coach-training",
  "candidates.jsonl",
);
const decisionsPath = path.join(
  process.cwd(),
  ".cache",
  "coach-training",
  "review-decisions.json",
);
const approvedPath = path.join(
  process.cwd(),
  "data",
  "training",
  "coach-approved.jsonl",
);

let writeQueue = Promise.resolve();

function enabled() {
  return process.env.NODE_ENV !== "production"
    || process.env.COACH_TRAINING_REVIEW_ENABLED === "1";
}

function parseJsonl(source, label) {
  return String(source || "").split(/\r?\n/u).flatMap((line, index) => {
    if (!line.trim()) return [];
    try {
      return [JSON.parse(line)];
    } catch (error) {
      throw new Error(`${label}:${index + 1}: ${error.message}`);
    }
  });
}

async function readJsonl(filePath) {
  try {
    return parseJsonl(await readFile(filePath, "utf8"), filePath);
  } catch (error) {
    if (error?.code === "ENOENT") return [];
    throw error;
  }
}

async function readDecisions() {
  try {
    const value = JSON.parse(await readFile(decisionsPath, "utf8"));
    return Array.isArray(value?.reviews) ? value.reviews : [];
  } catch (error) {
    if (error?.code === "ENOENT") return [];
    throw error;
  }
}

async function atomicWrite(filePath, content) {
  await mkdir(path.dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.${process.pid}.tmp`;
  await writeFile(temporaryPath, content, "utf8");
  await rename(temporaryPath, filePath);
}

function summary(candidates, reviews) {
  const counts = { pending: candidates.length, approved: 0, rejected: 0 };
  const candidateIds = new Set(candidates.map((candidate) => candidate.id));
  reviews.forEach((review) => {
    if (!candidateIds.has(review.id) || !["approved", "rejected"].includes(review.decision)) {
      return;
    }
    counts[review.decision] += 1;
    counts.pending -= 1;
  });
  return { total: candidates.length, ...counts };
}

async function loadState() {
  const [allCandidates, decisions, approved] = await Promise.all([
    readJsonl(candidatesPath),
    readDecisions(),
    readJsonl(approvedPath),
  ]);
  const candidates = allCandidates;
  const candidateMap = new Map(candidates.map((candidate) => [candidate.id, candidate]));
  const reviewMap = new Map(decisions.map((review) => {
    const candidate = candidateMap.get(review.id);
    const candidateVersion = Number.parseInt(candidate?.version, 10) || 1;
    const reviewedVersion = Number.parseInt(review?.candidateVersion, 10) || 1;
    if (candidate && candidateVersion !== reviewedVersion) {
      return [review.id, {
        ...review,
        decision: "needs_revision",
        textEdits: {},
        previousTextEdits: review.textEdits || {},
        notes: review.notes || "Der Erklärungsentwurf wurde verbessert und muss neu geprüft werden.",
      }];
    }
    return [review.id, review];
  }));
  approved.forEach((record) => {
    let stillValid = false;
    try {
      stillValid = validateApprovedCoachTrainingRecord(record).valid;
    } catch {
      stillValid = false;
    }
    if (!stillValid) {
      const previous = reviewMap.get(record.id) || {};
      reviewMap.set(record.id, {
        ...previous,
        id: record.id,
        decision: "needs_revision",
        textEdits: {},
        previousTextEdits: previous.textEdits || {},
        notes: previous.notes || "Diese Freigabe braucht eine konkrete Begründung.",
      });
      return;
    }
    if (reviewMap.has(record.id)) return;
    reviewMap.set(record.id, {
      id: record.id,
      decision: "approved",
      reviewer: record.approval?.reviewer || "",
      reviewedAt: record.approval?.reviewedAt || "",
      notes: "",
      textEdits: {},
    });
  });
  const reviews = [...reviewMap.values()];
  return {
    candidates: candidates.map((candidate) => ({
      ...candidate,
      review: reviewMap.get(candidate.id) || null,
    })),
    reviews,
    summary: summary(candidates, reviews),
  };
}

function serializedWrite(task) {
  const result = writeQueue.then(task, task);
  writeQueue = result.catch(() => {});
  return result;
}

export async function GET() {
  if (!enabled()) {
    return Response.json({ error: "Training-Review ist in Produktion deaktiviert." }, { status: 404 });
  }
  try {
    const state = await loadState();
    if (state.candidates.length === 0) {
      return Response.json({
        error: "Keine Kandidaten gefunden. Bitte zuerst npm run coach:training:seed ausführen.",
      }, { status: 404 });
    }
    return Response.json(state);
  } catch (error) {
    return Response.json({ error: error?.message || "Review-Daten konnten nicht geladen werden." }, { status: 500 });
  }
}

export async function POST(request) {
  if (!enabled()) {
    return Response.json({ error: "Training-Review ist in Produktion deaktiviert." }, { status: 404 });
  }
  const body = await request.json().catch(() => null);
  if (!body?.id) {
    return Response.json({ error: "Kandidaten-ID fehlt." }, { status: 400 });
  }

  try {
    return await serializedWrite(async () => {
      const candidates = await readJsonl(candidatesPath);
      const candidate = candidates.find((item) => item.id === body.id);
      if (!candidate) {
        return Response.json({ error: "Kandidat wurde nicht gefunden." }, { status: 404 });
      }
      const checked = coachTrainingReviewEntry(candidate, {
        decision: body.decision,
        reviewer: body.reviewer,
        notes: body.notes,
        textEdits: body.textEdits,
      });
      if (!checked.valid) {
        return Response.json({ error: "Freigabe wurde vom Guard abgelehnt.", errors: checked.errors }, { status: 422 });
      }

      const [decisions, approved] = await Promise.all([
        readDecisions(),
        readJsonl(approvedPath),
      ]);
      const nextDecisions = decisions.filter((item) => item.id !== candidate.id);
      nextDecisions.push(checked.value);
      const nextApproved = approved.filter((item) => item.id !== candidate.id);
      if (checked.approvedRecord) nextApproved.push(checked.approvedRecord);

      await Promise.all([
        atomicWrite(decisionsPath, `${JSON.stringify({
          version: 1,
          updatedAt: new Date().toISOString(),
          reviews: nextDecisions,
        }, null, 2)}\n`),
        atomicWrite(
          approvedPath,
          nextApproved.length > 0
            ? `${nextApproved.map((record) => JSON.stringify(record)).join("\n")}\n`
            : "",
        ),
      ]);

      const state = await loadState();
      return Response.json({
        ok: true,
        review: checked.value,
        summary: state.summary,
      });
    });
  } catch (error) {
    return Response.json({ error: error?.message || "Review konnte nicht gespeichert werden." }, { status: 500 });
  }
}
