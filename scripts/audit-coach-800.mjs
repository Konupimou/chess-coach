import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { spawn } from "node:child_process";
import {
  coachStressReportMarkdown,
  stressTestCoachGames,
} from "./stress-test-coach-games.mjs";

const JSON_PATH = resolve("reports/coach-audit-800.json");
const MARKDOWN_PATH = resolve("reports/coach-audit-800.md");
const PROGRESS_PATH = resolve("reports/coach-audit-800-progress.json");

async function writeText(path, content) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, content, "utf8");
}

function reportSection(title, result) {
  const report = coachStressReportMarkdown(result)
    .replace(/^# .*\n+/u, "")
    .replace(/^## /gmu, "### ");
  return [`## ${title}`, "", report].join("\n");
}

export function combinedAuditMarkdown(result) {
  const full = result.fullAudit;
  const deep = result.deepAudit;
  const totalFailures = Number(!full.passed) + deep.totals.failedOutputs;
  return [
    "# Automatischer 800-Elo-Coach-Audit",
    "",
    `**${totalFailures === 0 ? "Keine klaren Fehler gefunden." : `${totalFailures} klare Auffälligkeiten gefunden.`}**`,
    "",
    "Der Audit prüft zuerst jeden erzeugten Halbzug aus 200 reproduzierbaren legalen Partien gegen die vollständige Berichts-, Widerspruchs- und Sprachlogik. Danach werden 225 über Eröffnung, Mittelspiel und Endspiel verteilte Stellungen mit Stockfish gegengeprüft.",
    "",
    `- Partien: ${full.games}`,
    `- Geprüfte Halbzüge: ${full.checkedMoves.toLocaleString("de-DE")}`,
    `- Geprüfte sichtbare Texte: ${full.checkedTexts.toLocaleString("de-DE")}`,
    `- Coach-Stufe: 800 Elo`,
    `- Vollständige Halbzugprüfung: ${full.passed ? "bestanden" : "fehlgeschlagen"}`,
    `- Tiefe Gegenprüfung bestanden: ${deep.totals.passedOutputs.toLocaleString("de-DE")} / ${deep.totals.outputs.toLocaleString("de-DE")}`,
    "",
    "## Teil 1: Jeder Halbzug",
    "",
    full.passed
      ? `${full.checkedReports} Partieberichte mit ${full.checkedMoves.toLocaleString("de-DE")} Zugbewertungen bestanden alle Widerspruchs- und Sprachregeln.`
      : `Die Vollprüfung ist fehlgeschlagen:\n\n\`\`\`text\n${full.output.slice(-8_000)}\n\`\`\``,
    "",
    reportSection("Teil 2: Tiefere Gegenprüfung", deep),
  ].join("\n");
}

function runFullGameReviewAudit() {
  return new Promise((resolveAudit) => {
    const child = spawn(process.execPath, ["--test", "test/gameReviewStress.test.js"], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        COACH_GAME_REVIEW_STRESS_GAMES: "200",
        COACH_GAME_REVIEW_STRESS_PLIES: "60",
        COACH_GAME_REVIEW_STRESS_RATINGS: "800",
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    child.stdout.on("data", (chunk) => { output += String(chunk); });
    child.stderr.on("data", (chunk) => { output += String(chunk); });
    child.on("error", (error) => {
      resolveAudit({
        passed: false,
        games: 200,
        checkedReports: 0,
        checkedMoves: 0,
        checkedTexts: 0,
        output: `${output}\n${error?.stack || error}`,
      });
    });
    child.on("close", (code) => {
      const counts = output.match(/# (\d+) Berichte · (\d+) Zugbewertungen · (\d+) sichtbare Texte/u);
      resolveAudit({
        passed: code === 0,
        games: 200,
        checkedReports: Number.parseInt(counts?.[1], 10) || 0,
        checkedMoves: Number.parseInt(counts?.[2], 10) || 0,
        checkedTexts: Number.parseInt(counts?.[3], 10) || 0,
        output,
      });
    });
  });
}

async function main() {
  let checkpointWrites = Promise.resolve();
  const checkpoint = (stage, completed, total, failedOutputs) => {
    checkpointWrites = checkpointWrites.then(() => writeText(
      PROGRESS_PATH,
      `${JSON.stringify({
        status: "running",
        stage,
        completed,
        total,
        failedOutputs,
        updatedAt: new Date().toISOString(),
      }, null, 2)}\n`,
    ));
  };

  process.stdout.write("[Coach audit 800] Teil 1/2: jeder Halbzug\n");
  checkpoint("all_halfmoves", 0, 200, 0);
  const fullAudit = await runFullGameReviewAudit();
  checkpoint("all_halfmoves", 200, 200, Number(!fullAudit.passed));
  process.stdout.write(`[Coach audit 800] 200/200 Partien · ${fullAudit.checkedMoves} Halbzüge geprüft\n`);
  await checkpointWrites;

  process.stdout.write("[Coach audit 800] Teil 2/2: tiefere Gegenprüfung\n");
  const deepAudit = await stressTestCoachGames({
    games: 200,
    positionsPerPhase: 75,
    ratings: [800],
    depth: 5,
    maxPlies: 180,
    workers: 8,
    maxFailureExamples: 40,
    maxPositiveExamples: 20,
    seed: "coach-audit-800-v1",
    onProgress: ({ completed, total, failedOutputs }) => {
      if (completed % 25 !== 0 && completed !== total) return;
      process.stdout.write(`[Coach audit 800] Tiefe Prüfung ${completed}/${total} · ${failedOutputs} Auffälligkeiten\n`);
      checkpoint("deep_cross_check", completed, total, failedOutputs);
    },
  });
  await checkpointWrites;

  const result = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    coachRating: 800,
    fullAudit,
    deepAudit,
  };
  await writeText(JSON_PATH, `${JSON.stringify(result, null, 2)}\n`);
  await writeText(MARKDOWN_PATH, `${combinedAuditMarkdown(result)}\n`);
  await writeText(PROGRESS_PATH, `${JSON.stringify({
    status: "completed",
    completed: fullAudit.checkedMoves + deepAudit.totals.analyzedPositions,
    total: fullAudit.checkedMoves + deepAudit.totals.selectedPositions,
    failedOutputs: Number(!fullAudit.passed) + deepAudit.totals.failedOutputs,
    markdownReport: MARKDOWN_PATH,
    jsonReport: JSON_PATH,
    updatedAt: new Date().toISOString(),
  }, null, 2)}\n`);
  process.stdout.write(`[Coach audit 800] Fertig · Bericht: ${MARKDOWN_PATH}\n`);
}

if (import.meta.url === new URL(process.argv[1], "file:").href) {
  main().catch((error) => {
    process.stderr.write(`${error?.stack || error}\n`);
    process.exitCode = 1;
  });
}
