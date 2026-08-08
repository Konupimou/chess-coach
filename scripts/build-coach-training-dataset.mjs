import { mkdir, readFile, writeFile } from "node:fs/promises";
import { extname, join, resolve } from "node:path";
import {
  COACH_TRAINING_RATINGS,
  buildCoachTrainingDataset,
  heldOutEvaluationRecord,
  supervisedJsonlRecord,
} from "../coachTrainingDataset.js";

function option(argv, name, fallback = "") {
  const prefix = `--${name}=`;
  return argv.find((value) => value.startsWith(prefix))?.slice(prefix.length) || fallback;
}

function ratingsOption(argv) {
  const ratings = option(argv, "ratings", COACH_TRAINING_RATINGS.join(","))
    .split(",")
    .map((value) => Number.parseInt(value.trim(), 10))
    .filter((value) => COACH_TRAINING_RATINGS.includes(value));
  return ratings.length > 0
    ? [...new Set(ratings)]
    : [...COACH_TRAINING_RATINGS];
}

function parseJsonLines(source, inputPath) {
  const records = [];
  String(source || "").split(/\r?\n/u).forEach((line, index) => {
    if (!line.trim()) return;
    try {
      records.push(JSON.parse(line));
    } catch (error) {
      throw new Error(`${inputPath}:${index + 1}: ungültiges JSON (${error.message}).`);
    }
  });
  return records;
}

async function readRecords(inputPath) {
  const source = await readFile(inputPath, "utf8");
  if (extname(inputPath).toLowerCase() === ".jsonl") {
    return parseJsonLines(source, inputPath);
  }
  const value = JSON.parse(source);
  if (Array.isArray(value)) return value;
  if (Array.isArray(value?.records)) return value.records;
  throw new Error("Die Eingabedatei muss ein JSON-Array, records-Array oder JSONL enthalten.");
}

function jsonl(records) {
  return records.map((record) => JSON.stringify(record)).join("\n") + "\n";
}

export async function buildTrainingDatasetFiles({
  inputPath,
  outputDir,
  seed = "coach-training-v1",
  checkOnly = false,
  ratings = COACH_TRAINING_RATINGS,
} = {}) {
  const sourcePath = resolve(inputPath);
  const records = await readRecords(sourcePath);
  const selectedRatings = new Set(ratings);
  const selectedRecords = records.filter((record) => (
    selectedRatings.has(Number(record?.payload?.learnerProfile?.rating))
    && (Number.parseInt(record?.version, 10) || 1) >= 2
  ));
  if (selectedRecords.length === 0) {
    throw new Error(`Keine freigegebenen Beispiele für die gewählten Spielstärken (${ratings.join(", ")} Elo) gefunden.`);
  }
  const dataset = buildCoachTrainingDataset(selectedRecords, { seed });
  if (!dataset.valid) {
    throw new Error(`Trainingsdaten sind ungültig:\n- ${dataset.errors.join("\n- ")}`);
  }

  if (!checkOnly) {
    const targetDir = resolve(outputDir);
    await mkdir(targetDir, { recursive: true });
    await Promise.all([
      writeFile(
        join(targetDir, "train.jsonl"),
        jsonl(dataset.splits.train.map(supervisedJsonlRecord)),
        "utf8",
      ),
      writeFile(
        join(targetDir, "validation.jsonl"),
        jsonl(dataset.splits.validation.map(supervisedJsonlRecord)),
        "utf8",
      ),
      writeFile(
        join(targetDir, "test.jsonl"),
        jsonl(dataset.splits.test.map(heldOutEvaluationRecord)),
        "utf8",
      ),
      writeFile(
        join(targetDir, "manifest.json"),
        `${JSON.stringify(dataset.manifest, null, 2)}\n`,
        "utf8",
      ),
    ]);
  }

  return {
    inputPath: sourcePath,
    outputDir: checkOnly ? null : resolve(outputDir),
    checkOnly,
    ratings,
    datasetHash: dataset.manifest.datasetHash,
    counts: dataset.manifest.counts,
    groupCounts: dataset.manifest.groupCounts,
  };
}

async function main() {
  const argv = process.argv.slice(2);
  const inputPath = option(argv, "input", "data/training/coach-approved.jsonl");
  const outputDir = option(argv, "output", ".cache/coach-training");
  const result = await buildTrainingDatasetFiles({
    inputPath,
    outputDir,
    seed: option(argv, "seed", "coach-training-v1"),
    checkOnly: argv.includes("--check"),
    ratings: ratingsOption(argv),
  });
  console.log(JSON.stringify(result, null, 2));
}

if (process.argv[1] && import.meta.url === new URL(process.argv[1], "file:").href) {
  main().catch((error) => {
    console.error(error?.stack || error);
    process.exitCode = 1;
  });
}
