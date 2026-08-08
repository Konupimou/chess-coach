import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
  COACH_BENCHMARK_RESULT_VERSION,
  benchmarkContextForCase,
  benchmarkFingerprint,
  benchmarkQuestion,
  compareBenchmarkRuns,
  runBenchmarkCase,
  summarizeBenchmarkResults,
  validateBenchmarkDataset,
} from "../coachBenchmark.js";
import { createOpenAiBenchmarkJudge } from "../coachBenchmarkJudge.js";

const DEFAULT_DATASETS = Object.freeze({
  v1: "data/benchmarks/coach-benchmark-v1.json",
  v2: "data/benchmarks/coach-benchmark-v2.json",
});
const DEFAULT_REPORT_DIR = "reports/benchmarks";
const DEFAULT_LATEST = Object.freeze({
  v1: "reports/coach-benchmark-latest.json",
  v2: "reports/coach-benchmark-v2-latest.json",
});
const CATEGORY_ALIASES = Object.freeze({
  TACTICS: "TACTICAL",
  TACTIC: "TACTICAL",
  POSITION: "POSITIONAL",
  PAWNS: "PAWN_STRUCTURE",
  PAWN: "PAWN_STRUCTURE",
  KING: "KING_SAFETY",
  DEVELOPMENT: "DEVELOPMENT",
  ENDGAMES: "ENDGAME",
});

function option(argv, name, fallback = "") {
  const prefix = `--${name}=`;
  return argv.find((value) => value.startsWith(prefix))?.slice(prefix.length) || fallback;
}

function integerOption(argv, name, fallback, minimum, maximum) {
  const parsed = Number.parseInt(option(argv, name), 10);
  return Number.isInteger(parsed) ? Math.max(minimum, Math.min(maximum, parsed)) : fallback;
}

async function readJson(path, fallback = null) {
  try {
    return JSON.parse(await readFile(resolve(path), "utf8"));
  } catch {
    return fallback;
  }
}

function formatDelta(value) {
  if (!Number.isFinite(value)) return "–";
  return `${value >= 0 ? "+" : ""}${value.toFixed(2)}`;
}

function markdownCell(value) {
  return String(value ?? "").replace(/\|/gu, "\\|").replace(/\s+/gu, " ").trim();
}

export function benchmarkReportMarkdown(run) {
  const summary = run.summary;
  const comparison = run.comparison;
  const sections = [
    "# Chess Coach Benchmark",
    "",
    `Run: \`${run.runId}\` · Datensatz: \`${run.datasetId}\` · Coach: \`${run.config.coachMode}\` · Judge: \`${run.config.judge ? "LLM" : "aus"}\``,
    "",
    "## Ergebnis",
    "",
    `- Antworten: ${summary.overall.cases}`,
    `- Gesamt: **${summary.overall.overallScore.toFixed(2)}**${comparison ? ` (${formatDelta(comparison.overallDelta)})` : ""}`,
    `- Schachgenauigkeit: ${summary.overall.chessAccuracy.toFixed(2)}${comparison ? ` (${formatDelta(comparison.metricDeltas.chessAccuracy)})` : ""}`,
    `- Hauptgrund erkannt: ${summary.overall.mainReasonPercent === null ? "nicht bewertet" : `${summary.overall.mainReasonPercent.toFixed(2)} %`}${comparison ? ` (${formatDelta(comparison.metricDeltas.mainReasonPercent)})` : ""}`,
    `- Halluzinationsrate: ${summary.overall.hallucinationRate.toFixed(2)} %${comparison ? ` (${formatDelta(comparison.metricDeltas.hallucinationRate)})` : ""}`,
    `- Schwere Fehler: ${summary.overall.majorErrorRate.toFixed(2)} %`,
    `- Diagnose-Faktorabdeckung: ${summary.overall.diagnosisFactorCoverage === null ? "–" : `${summary.overall.diagnosisFactorCoverage.toFixed(2)} %`}`,
    `- Erklärungs-Faktorabdeckung: ${summary.overall.answerFactorCoverage === null ? "–" : `${summary.overall.answerFactorCoverage.toFixed(2)} %`}`,
    `- Fehlerfälle: ${summary.failedCases}`,
    "",
    "## Kategorien",
    "",
    "| Kategorie | Fälle | Score | Änderung | Halluzination | Hauptgrund | Diagnose-Faktoren | Erklärungs-Faktoren |",
    "| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
    ...Object.entries(summary.byCategory).map(([category, row]) => (
      `| ${category} | ${row.cases} | ${row.overallScore.toFixed(2)} | ${comparison && Number.isFinite(comparison.categoryDeltas[category]) ? formatDelta(comparison.categoryDeltas[category]) : "–"} | ${row.hallucinationRate.toFixed(2)} % | ${row.mainReasonPercent === null ? "–" : `${row.mainReasonPercent.toFixed(2)} %`} | ${row.diagnosisFactorCoverage === null ? "–" : `${row.diagnosisFactorCoverage.toFixed(2)} %`} | ${row.answerFactorCoverage === null ? "–" : `${row.answerFactorCoverage.toFixed(2)} %`} |`
    )),
    "",
    "## Kalibrierung der Diagnose",
    "",
    `- Bewertete Diagnosen: ${summary.calibration.evaluated}`,
    `- Brier-Score: ${summary.calibration.brierScore ?? "–"} (kleiner ist besser)`,
    `- Expected Calibration Error: ${summary.calibration.expectedCalibrationError ?? "–"} (kleiner ist besser)`,
    `- Selbstsicher falsch: ${summary.calibration.confidentlyWrong}`,
    "",
    "## Wichtigste Fehler",
    "",
  ];
  if (summary.topFailures.length === 0) sections.push("Keine Fehlerfälle.", "");
  summary.topFailures.forEach((failure, index) => {
    sections.push(
      `### ${index + 1}. ${failure.caseId} · ${failure.questionId} · ${failure.score.toFixed(2)}`,
      "",
      `- Erwartet: ${failure.expected.join(", ") || "nur objektive Prüfung"}`,
      `- Diagnose: ${failure.diagnosis || "kein sicherer Hauptgrund"}`,
      `- Problem: ${failure.issues.join(", ") || "niedrige Relevanz-/Spezifitätswertung"}`,
      "",
      `> ${markdownCell(failure.answer)}`,
      "",
    );
  });
  if (comparison) {
    sections.push(
      "## Regressionen",
      "",
      ...(comparison.regressions.length > 0
        ? comparison.regressions.map((entry) => `- ${entry.caseId} · ${entry.questionId}: ${entry.before.toFixed(2)} → ${entry.after.toFixed(2)} (${formatDelta(entry.delta)})`)
        : ["Keine Regression von mindestens 5 Punkten."]),
      "",
      "## Verbesserungen",
      "",
      ...(comparison.improvements.length > 0
        ? comparison.improvements.map((entry) => `- ${entry.caseId} · ${entry.questionId}: ${entry.before.toFixed(2)} → ${entry.after.toFixed(2)} (${formatDelta(entry.delta)})`)
        : ["Keine Verbesserung von mindestens 5 Punkten."]),
      "",
    );
  }
  sections.push(
    "## Methodik",
    "",
    "- Engine-Linien, FEN und Züge werden deterministisch geprüft. Der Benchmark startet standardmäßig keine neue Stockfish-Analyse.",
    "- Erwartete Konzepte werden dem Coach nie übergeben.",
    "- Automatisch erzeugte PGN-Fälle mit `needsReview` zählen noch nicht zur Hauptgrundquote.",
    "- Ein illegaler Kontext, Engine-Widerspruch oder eine konkrete Halluzination deckelt den Gesamtscore auf 35 Punkte.",
    "- Der optionale LLM-Judge bestimmt höchstens 20 % des Scores; objektive Schachfehler behalten den harten Deckel.",
    "",
  );
  return sections.join("\n");
}

export function selectBenchmarkWork(dataset, {
  full = false,
  category = "",
  failureIds = null,
  limit = Infinity,
} = {}) {
  const requestedCategory = category.trim().toLocaleUpperCase("en-US");
  const normalizedCategory = CATEGORY_ALIASES[requestedCategory] || requestedCategory;
  const cases = dataset.cases
    .filter((benchmarkCase) => !normalizedCategory || benchmarkCase.expected.categories.includes(normalizedCategory))
    .filter((benchmarkCase) => !failureIds || failureIds.has(benchmarkCase.id))
    .slice(0, limit);
  return cases.flatMap((benchmarkCase) => {
    const questionIds = full ? benchmarkCase.questionIds : benchmarkCase.questionIds.slice(0, 1);
    return questionIds.flatMap((questionId) => {
      const question = benchmarkQuestion(dataset, questionId);
      return question ? [{ benchmarkCase, question }] : [];
    });
  });
}

export async function runCoachBenchmark({
  dataset,
  full = false,
  category = "",
  failureIds = null,
  limit = Infinity,
  coachMode = "local",
  judge = null,
  apiKey,
  model,
  fetchImpl = globalThis.fetch,
  baseline = null,
  label = "",
  onProgress = null,
} = {}) {
  const validation = validateBenchmarkDataset(dataset);
  if (!validation.valid) throw new Error(`Benchmarkdatensatz ist ungültig:\n${validation.errors.join("\n")}`);
  const work = selectBenchmarkWork(dataset, { full, category, failureIds, limit });
  if (work.length === 0) throw new Error("Keine Benchmarkfälle entsprechen dem Filter.");
  const results = [];
  const contextCache = new Map();
  for (const [index, item] of work.entries()) {
    if (!contextCache.has(item.benchmarkCase.id)) {
      contextCache.set(item.benchmarkCase.id, benchmarkContextForCase(
        item.benchmarkCase,
        { rating: item.benchmarkCase.metadata?.rating || 1400 },
      ));
    }
    const result = await runBenchmarkCase(item.benchmarkCase, item.question, {
      coachMode,
      prebuiltContext: contextCache.get(item.benchmarkCase.id),
      apiKey,
      model,
      fetchImpl,
      judge,
    });
    results.push(result);
    onProgress?.({ completed: index + 1, total: work.length, result });
  }
  const timestamp = new Date().toISOString();
  const run = {
    resultVersion: COACH_BENCHMARK_RESULT_VERSION,
    runId: label || timestamp.replace(/[:.]/gu, "-").replace(/Z$/u, "Z"),
    createdAt: timestamp,
    datasetId: dataset.datasetId,
    datasetFingerprint: benchmarkFingerprint(dataset),
    config: {
      full,
      category: category || null,
      failuresOnly: Boolean(failureIds),
      coachMode,
      judge: Boolean(judge),
      model: model || process.env.OPENAI_MODEL || null,
    },
    results,
    summary: summarizeBenchmarkResults(results),
    comparison: null,
  };
  run.comparison = compareBenchmarkRuns(run, baseline);
  return run;
}

async function persistRun(run, { reportDir = DEFAULT_REPORT_DIR, latestPath = DEFAULT_LATEST } = {}) {
  const directory = resolve(reportDir);
  await mkdir(directory, { recursive: true });
  const jsonPath = resolve(directory, `${run.runId}.json`);
  const markdownPath = resolve(directory, `${run.runId}.md`);
  await writeFile(jsonPath, `${JSON.stringify(run, null, 2)}\n`, "utf8");
  await writeFile(markdownPath, `${benchmarkReportMarkdown(run)}\n`, "utf8");
  await mkdir(dirname(resolve(latestPath)), { recursive: true });
  await writeFile(resolve(latestPath), `${JSON.stringify(run, null, 2)}\n`, "utf8");
  return { jsonPath, markdownPath, latestPath: resolve(latestPath) };
}

function terminalSummary(run) {
  const overall = run.summary.overall;
  const comparison = run.comparison;
  return [
    "",
    "CHESS COACH BENCHMARK",
    "",
    `Antworten: ${overall.cases}`,
    `Gesamt: ${overall.overallScore.toFixed(2)}${comparison ? ` (${formatDelta(comparison.overallDelta)})` : ""}`,
    `Schachgenauigkeit: ${overall.chessAccuracy.toFixed(2)}${comparison ? ` (${formatDelta(comparison.metricDeltas.chessAccuracy)})` : ""}`,
    `Hauptgrund erkannt: ${overall.mainReasonPercent === null ? "–" : `${overall.mainReasonPercent.toFixed(2)} %`}`,
    `Diagnose-Faktorabdeckung: ${overall.diagnosisFactorCoverage === null ? "–" : `${overall.diagnosisFactorCoverage.toFixed(2)} %`}`,
    `Erklärungs-Faktorabdeckung: ${overall.answerFactorCoverage === null ? "–" : `${overall.answerFactorCoverage.toFixed(2)} %`}`,
    `Halluzinationen: ${overall.hallucinationRate.toFixed(2)} %`,
    `Fehlerfälle: ${run.summary.failedCases}`,
    `Regressionen: ${comparison?.regressions?.length || 0}`,
    `Verbesserungen: ${comparison?.improvements?.length || 0}`,
    "",
    "Schlechteste Fälle:",
    ...run.summary.topFailures.slice(0, 5).map((failure, index) => (
      `${index + 1}. ${failure.caseId} · ${failure.questionId} · ${failure.score.toFixed(2)} · ${failure.issues.join(", ") || "Relevanz/Spezifität"}`
    )),
    "",
  ].join("\n");
}

function usage() {
  return [
    "Usage: node scripts/run-coach-benchmark.mjs [options]",
    "",
    "  --quick               ein realistischer Fragetyp je Fall (Standard)",
    "  --full                alle vorgesehenen Fragetypen je Fall",
    "  --category=TACTICAL   nur eine Kategorie",
    "  --failures            nur Fehlerfälle des letzten Laufs",
    "  --limit=N             Zahl der Stellungen begrenzen",
    "  --ai                  echten KI-Coach statt lokalem Fallback testen",
    "  --judge               optionalen separaten LLM-Judge aktivieren",
    "  --baseline=PATH       Vergleichslauf; sonst automatisch letzter Lauf",
    "  --dataset=PATH        Benchmarkdatensatz",
    "  --suite=v1|v2         getrennte Standardsuite (Default: v1)",
    "  --label=NAME          stabiler Name für Ergebnisdateien",
    "  --strict              Exitcode 1 bei schweren Fehlern oder Regressionen",
    "  --no-save             Ergebnis nicht persistieren",
  ].join("\n");
}

async function main() {
  const argv = process.argv.slice(2);
  if (argv.includes("--help")) {
    process.stdout.write(`${usage()}\n`);
    return;
  }
  const suite = option(argv, "suite", "v1").toLocaleLowerCase("en-US");
  if (!Object.hasOwn(DEFAULT_DATASETS, suite)) throw new Error(`Unbekannte Benchmark-Suite: ${suite}`);
  const datasetPath = option(argv, "dataset", DEFAULT_DATASETS[suite]);
  const dataset = await readJson(datasetPath);
  if (!dataset) throw new Error(`Benchmarkdatensatz nicht gefunden: ${datasetPath}`);
  const latestPath = option(argv, "latest", DEFAULT_LATEST[suite]);
  const explicitBaseline = option(argv, "baseline", "");
  const label = option(argv, "label", "");
  let baseline = argv.includes("--no-baseline")
    ? null
    : await readJson(explicitBaseline || latestPath);
  if (baseline?.datasetId && baseline.datasetId !== dataset.datasetId) {
    if (explicitBaseline) {
      throw new Error(`Baseline-Datensatz ${baseline.datasetId} passt nicht zu ${dataset.datasetId}.`);
    }
    baseline = null;
  }
  if (label && baseline?.runId === label) baseline = null;
  let failureIds = null;
  if (argv.includes("--failures")) {
    const ids = baseline?.summary?.failureCaseIds
      || baseline?.summary?.topFailures?.map((failure) => failure.caseId);
    if (!ids?.length) throw new Error("Der vorherige Benchmarklauf enthält keine Fehlerfälle.");
    failureIds = new Set(ids);
  }
  const judge = argv.includes("--judge") ? createOpenAiBenchmarkJudge() : null;
  const run = await runCoachBenchmark({
    dataset,
    full: argv.includes("--full"),
    category: option(argv, "category", ""),
    failureIds,
    limit: integerOption(argv, "limit", dataset.cases.length, 1, 10_000),
    coachMode: argv.includes("--ai") ? "ai" : "local",
    judge,
    apiKey: process.env.OPENAI_API_KEY,
    model: option(argv, "model", process.env.OPENAI_MODEL || "") || undefined,
    baseline,
    label,
    onProgress: ({ completed, total, result }) => {
      process.stdout.write(`[Benchmark] ${completed}/${total} · ${result.caseId} · ${result.score.toFixed(2)}\n`);
    },
  });
  process.stdout.write(terminalSummary(run));
  if (!argv.includes("--no-save")) {
    const paths = await persistRun(run, {
      reportDir: option(argv, "report-dir", DEFAULT_REPORT_DIR),
      latestPath,
    });
    process.stdout.write(`JSON: ${paths.jsonPath}\nMarkdown: ${paths.markdownPath}\n`);
  }
  if (argv.includes("--strict") && (
    run.summary.overall.majorErrorRate > 0
    || (run.comparison?.regressions?.length || 0) > 0
  )) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((error) => {
    console.error(error?.stack || error);
    process.exitCode = 1;
  });
}
