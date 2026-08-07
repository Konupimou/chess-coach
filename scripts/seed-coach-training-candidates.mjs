import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import {
  buildMoveExplanationContext,
  validateMoveExplanationTrainingTarget,
} from "../api/chat.js";
import { buildPositionEvidence } from "../positionEvidence.js";
import { COACH_EVALUATION_CASES } from "../test/fixtures/coachEvaluationCases.js";

function option(argv, name, fallback = "") {
  const prefix = `--${name}=`;
  return argv.find((value) => value.startsWith(prefix))?.slice(prefix.length) || fallback;
}

function ratingsOption(argv) {
  const ratings = option(argv, "ratings", "800")
    .split(",")
    .map((value) => Number.parseInt(value, 10))
    .filter((value) => [800, 1000, 1400, 1800].includes(value));
  return [...new Set(ratings)];
}

function engineContextForCase(coachCase) {
  const bestValue = coachCase.candidateLines[0]?.evaluation?.value;
  const playedValue = coachCase.playedLine?.evaluation?.value;
  const lossCp = Number.isFinite(bestValue) && Number.isFinite(playedValue)
    ? Math.max(0, bestValue - playedValue)
    : 0;
  const positionEvidence = buildPositionEvidence({
    fenBefore: coachCase.fen,
    playedUci: coachCase.playedMove,
    candidateLines: coachCase.candidateLines,
    playedLine: coachCase.playedLine,
    lossCp,
    quality: coachCase.expectedQuality,
    engineDepth: 18,
    onlyMoveEvidence: coachCase.legalMoveCount === 1
      ? { type: "only_legal_move", legalMoveCount: 1 }
      : null,
    pvLimit: 20,
  });
  const lines = (positionEvidence.candidateLines || []).map((line) => ({
    rank: line.rank,
    depth: 18,
    evaluation: line.evaluation,
    bestMove: { uci: line.pvUci[0], san: line.pvSan[0] },
    pv: { uci: line.pvUci, san: line.pvSan },
  }));
  const best = lines[0] || null;
  return {
    source: "stockfish",
    kind: "move_review",
    fen: coachCase.fen,
    depth: 18,
    lines,
    bestMove: best?.bestMove || null,
    primaryVariation: best?.pv || { uci: [], san: [] },
    playedLine: {
      evaluation: coachCase.playedLine.evaluation,
      uci: coachCase.playedLine.pvUci,
      san: coachCase.playedLine.pvSan,
    },
    moveReview: {
      playedMove: { uci: coachCase.playedMove, san: coachCase.playedSan },
      bestMove: best?.bestMove || null,
      evaluationBefore: best?.evaluation || coachCase.candidateLines[0]?.evaluation || null,
      evaluationAfter: coachCase.playedLine.evaluation,
      evaluationDeltaCp: -lossCp,
      quality: coachCase.expectedQuality,
      lossCp,
      pv: best?.pv || { uci: [], san: [] },
      onlyMove: positionEvidence.moveComparison?.onlyMove === true,
      onlyMoveEvidence: positionEvidence.moveComparison?.onlyMoveEvidence || null,
    },
  };
}

export function seedCoachTrainingCandidates({
  ratings = [800],
  cases = COACH_EVALUATION_CASES,
  onSkip = null,
} = {}) {
  const records = [];
  for (const coachCase of cases) {
    const engineContext = engineContextForCase(coachCase);
    const caseRecords = [];
    let failure = null;
    for (const rating of ratings) {
      const payload = {
        engineContext,
        openingContext: null,
        learnerProfile: { rating },
      };
      let context;
      try {
        context = buildMoveExplanationContext(payload);
      } catch (error) {
        failure = error;
        break;
      }
      if (!context?.localExplanation) {
        failure = new Error(`Kein verifizierter Entwurf bei ${rating} Elo.`);
        break;
      }
      const trainingTarget = validateMoveExplanationTrainingTarget(
        context.localExplanation,
        payload,
      );
      if (!trainingTarget.valid) {
        failure = new Error(
          `Kein didaktisch vollständiger Entwurf bei ${rating} Elo: ${trainingTarget.errors.join(" ")}`,
        );
        break;
      }
      caseRecords.push({
        version: 2,
        id: `eval:${coachCase.id}:r${rating}`,
        groupKey: `eval:${coachCase.id}`,
        lifecycle: "generated",
        approval: null,
        payload,
        target: trainingTarget.value,
        curation: {
          source: "curated_eval_case",
          revision: 2,
          category: coachCase.category,
          groups: coachCase.groups,
          instructions: "Textfelder didaktisch überarbeiten, sachlich prüfen und erst danach human_approved setzen.",
        },
      });
    }
    if (failure) {
      onSkip?.({ caseId: coachCase.id, reason: failure.message });
      continue;
    }
    records.push(...caseRecords);
  }
  return records;
}

async function main() {
  const argv = process.argv.slice(2);
  const outputPath = resolve(option(
    argv,
    "output",
    ".cache/coach-training/candidates.jsonl",
  ));
  const skipped = [];
  const records = seedCoachTrainingCandidates({
    ratings: ratingsOption(argv),
    onSkip: (item) => skipped.push(item),
  });
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(
    outputPath,
    `${records.map((record) => JSON.stringify(record)).join("\n")}\n`,
    "utf8",
  );
  console.log(JSON.stringify({
    outputPath,
    candidates: records.length,
    skippedCases: skipped.length,
    skipped,
  }, null, 2));
}

if (process.argv[1] && import.meta.url === new URL(process.argv[1], "file:").href) {
  main().catch((error) => {
    console.error(error?.stack || error);
    process.exitCode = 1;
  });
}
