import { createHash } from "node:crypto";
import { readFile, readdir, stat, writeFile, mkdir } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
  BENCHMARK_QUESTIONS,
  COACH_BENCHMARK_SCHEMA_VERSION,
  benchmarkContextForCase,
  validateBenchmarkDataset,
} from "../coachBenchmark.js";
import { parseAnnotatedPgn } from "../pgnPipeline.js";
import { StockfishBatch } from "./analyze-coach-annotations.mjs";

const DEFAULT_OUTPUT = "data/benchmarks/pgn-candidates.json";
const DEFAULT_CACHE = ".cache/coach-benchmark/stockfish-pgn.json";

function option(argv, name, fallback = "") {
  const prefix = `--${name}=`;
  return argv.find((value) => value.startsWith(prefix))?.slice(prefix.length) || fallback;
}

function integerOption(argv, name, fallback, minimum, maximum) {
  const parsed = Number.parseInt(option(argv, name), 10);
  return Number.isInteger(parsed) ? Math.max(minimum, Math.min(maximum, parsed)) : fallback;
}

function sha256(value) {
  return createHash("sha256").update(String(value || "")).digest("hex");
}

export function splitPgnGames(raw) {
  const normalized = String(raw || "").replace(/^\uFEFF/u, "").trim();
  if (!normalized) return [];
  return normalized
    .split(/\r?\n(?=\s*\[Event\s+")/u)
    .map((game) => game.trim())
    .filter(Boolean);
}

function annotatedPriority(move) {
  const comment = move?.annotation?.originalComment || "";
  const nags = move?.annotation?.nags || [];
  const claims = move?.annotation?.claims || [];
  const tactical = /(?:blunder|mistake|error|incorrect|bad|loses?|wins?|mate|fork|pin|skewer|sacrifice|tactic|patzer|fehler|matt|gabel|fessel|spieß|opfer|no es bueno|correcto|excelente|brillante)/iu.test(comment);
  const quiet = /(?:quiet|positional|prophyl|development|space|outpost|weak pawn|strong move|ruhig|entwicklung|raum|vorposten|schwacher bauer)/iu.test(comment);
  return (nags.some((nag) => [2, 3, 4, 5, 6].includes(nag)) ? 80 : 0)
    + Math.min(50, claims.length * 10)
    + (tactical ? 45 : 0)
    + (quiet ? 30 : 0)
    + (comment ? 10 : 0)
    + (move?.san?.includes("#") ? 60 : move?.san?.includes("+") ? 20 : 0);
}

export function pgnCandidateMoves(parsedGame, { maximum = 40 } = {}) {
  return (parsedGame?.moves || [])
    .filter((move) => move.mainline && move.variationDepth === 0 && move.uci && move.fenBefore && move.fenAfter)
    .map((move) => ({ move, priority: annotatedPriority(move) }))
    .filter((entry) => entry.priority > 0)
    .sort((left, right) => right.priority - left.priority || left.move.ply - right.move.ply)
    .slice(0, maximum)
    .map((entry) => entry.move);
}

function evaluationCp(value) {
  if (value?.unit === "cp") return Number(value.value) || 0;
  if (value?.unit === "mate") {
    const mate = Number(value.value) || 0;
    return (Math.sign(mate) || 1) * (100_000 - Math.min(999, Math.abs(mate)) * 100);
  }
  return 0;
}

function categoriesFor(concept, lossCp, quality) {
  const categories = [];
  if (lossCp >= 300 || quality === "blunder") categories.push("BLUNDER");
  if (["mating_attack", "checkmate", "back_rank_mate"].includes(concept)) categories.push("MATING_ATTACK", "KING_SAFETY");
  else if (["unsafe_king", "king_safety", "forcing_check"].includes(concept)) categories.push("KING_SAFETY");
  else if (["material_loss", "material_change", "hanging_piece", "loose_piece", "unfavorable_exchange"].includes(concept)) categories.push("MATERIAL");
  else if (["isolated_pawn", "backward_pawn", "passed_pawn", "pawn_break", "doubled_pawns"].includes(concept)) categories.push("PAWN_STRUCTURE");
  else if (["development_advantage"].includes(concept)) categories.push("DEVELOPMENT");
  else if (["piece_activity", "rook_on_open_file", "bad_bishop", "passive_piece"].includes(concept)) categories.push("PIECE_ACTIVITY");
  else if (["fork", "pin", "skewer", "discovered_attack", "zwischenzug", "double_attack"].includes(concept)) categories.push("TACTICAL");
  else if (concept) categories.push("POSITIONAL");
  if (lossCp >= 80 && !categories.includes("BLUNDER")) categories.push("MISSED_OPPORTUNITY");
  if (categories.length === 0) categories.push("UNCERTAIN");
  if (categories.length >= 3) categories.push("MULTI_FACTOR");
  return [...new Set(categories)];
}

function qualityFor(lossCp, bestIsPlayed) {
  if (bestIsPlayed) return "best";
  if (lossCp >= 300) return "blunder";
  if (lossCp >= 140) return "mistake";
  if (lossCp >= 50) return "inaccuracy";
  return "good";
}

function engineLines(lines, depth) {
  return lines.map((line, index) => ({
    rank: index + 1,
    depth: line.depth || depth,
    evaluation: line.evaluation,
    pvUci: line.pvUci,
  }));
}

export function benchmarkCaseFromPgnAnalysis({ parsedGame, move, lines, depth, sourceName }) {
  const best = lines[0];
  const played = lines.find((line) => line.uci === move.uci);
  if (!best || !played) return null;
  const lossCp = Math.max(0, evaluationCp(best.evaluation) - evaluationCp(played.evaluation));
  const quality = qualityFor(lossCp, best.uci === move.uci);
  const base = {
    id: `pgn-${parsedGame.gameId}-${String(move.ply).padStart(3, "0")}`,
    fenBefore: move.fenBefore,
    fenAfter: move.fenAfter,
    playedMove: { uci: move.uci, san: move.san },
    engine: {
      provider: "stockfish",
      depth,
      bestMove: best.uci,
      lossCp,
      quality,
      lines: engineLines(lines, depth),
      playedLine: {
        depth: played.depth || depth,
        evaluation: played.evaluation,
        pvUci: played.pvUci,
      },
    },
    expected: {
      categories: ["UNCERTAIN"],
      possibleConcepts: [],
      requiredFacts: [],
      needsReview: true,
      groundTruth: "engine_and_deterministic_candidate",
    },
    source: {
      type: "pgn",
      gameId: parsedGame.gameId,
      ply: move.ply,
      sourceId: sha256(sourceName).slice(0, 16),
    },
    difficulty: lossCp >= 300 ? "beginner" : lossCp >= 100 ? "intermediate" : "advanced",
    questionIds: best.uci === move.uci
      ? ["why_best", "most_important"]
      : ["why_bad", "overlooked", "compare", "lesson"],
    metadata: {
      generated: true,
      rating: 1400,
      engineCacheKey: sha256(`${move.fenBefore}|${move.uci}|${depth}`),
    },
  };
  let context = null;
  try {
    context = benchmarkContextForCase(base, { rating: 1400 });
  } catch {
    context = null;
  }
  const concept = context?.diagnosis?.primaryReason?.concept || null;
  base.expected.categories = categoriesFor(concept, lossCp, quality);
  base.expected.possibleConcepts = concept ? [concept] : [];
  base.metadata.diagnosisConfidenceAtGeneration = context?.diagnosis?.confidence?.value || 0;
  return base;
}

async function inputFiles(inputPath) {
  const target = resolve(inputPath);
  const info = await stat(target);
  if (info.isFile()) return [target];
  return (await readdir(target, { withFileTypes: true }))
    .filter((entry) => entry.isFile() && /\.pgn$/iu.test(entry.name))
    .map((entry) => join(target, entry.name))
    .sort((left, right) => left.localeCompare(right, "en"));
}

async function readCache(path) {
  try {
    return JSON.parse(await readFile(resolve(path), "utf8"));
  } catch {
    return {};
  }
}

async function persistJson(path, value) {
  const target = resolve(path);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

export async function generatePgnBenchmarkCandidates({
  input,
  output = DEFAULT_OUTPUT,
  cachePath = DEFAULT_CACHE,
  limit = 5,
  depth = 10,
  multiPv = 3,
  maxGames = 40,
  minSwing = 60,
  onProgress = null,
} = {}) {
  const files = await inputFiles(input);
  const cache = await readCache(cachePath);
  const engine = new StockfishBatch({ multiPv });
  const cases = [];
  let gamesSeen = 0;
  let positionsAnalyzed = 0;
  try {
    outer: for (const file of files) {
      const games = splitPgnGames(await readFile(file, "utf8"));
      for (const raw of games) {
        if (gamesSeen >= maxGames || cases.length >= limit) break outer;
        gamesSeen += 1;
        const parsed = parseAnnotatedPgn(raw, { source: sha256(basename(file)).slice(0, 16), gameOrdinal: gamesSeen });
        if (!parsed.valid) continue;
        for (const move of pgnCandidateMoves(parsed, { maximum: 8 })) {
          if (cases.length >= limit) break outer;
          const key = sha256(`${move.fenBefore}|${move.uci}|${depth}|${multiPv}`);
          let lines = cache[key];
          if (!Array.isArray(lines)) {
            const top = await engine.search(move.fenBefore, { depth });
            const played = top.some((line) => line.uci === move.uci)
              ? null
              : (await engine.search(move.fenBefore, { depth, searchMove: move.uci }))[0] || null;
            lines = [...top, ...(played ? [{ ...played, rank: top.length + 1 }] : [])];
            cache[key] = lines;
            positionsAnalyzed += 1;
            await persistJson(cachePath, cache);
          }
          const benchmarkCase = benchmarkCaseFromPgnAnalysis({
            parsedGame: parsed,
            move,
            lines,
            depth,
            sourceName: basename(file),
          });
          if (!benchmarkCase) continue;
          const interesting = benchmarkCase.engine.lossCp >= minSwing
            || benchmarkCase.engine.quality === "best" && benchmarkCase.metadata.diagnosisConfidenceAtGeneration >= 0.7;
          if (!interesting) continue;
          cases.push(benchmarkCase);
          onProgress?.({ cases: cases.length, limit, gamesSeen, positionsAnalyzed });
        }
      }
    }
  } finally {
    engine.close();
  }
  const dataset = {
    schemaVersion: COACH_BENCHMARK_SCHEMA_VERSION,
    datasetId: `pgn-candidates-${sha256(cases.map((item) => item.id).join("|")).slice(0, 12)}`,
    description: "Automatisch erzeugte PGN-Benchmarkkandidaten; vor Konzeptwertung manuell prüfen.",
    contaminationPolicy: "Erwartungen werden ausschließlich vom Runner gelesen und nie an den Coach übergeben.",
    questions: BENCHMARK_QUESTIONS,
    cases,
  };
  const validation = cases.length > 0 ? validateBenchmarkDataset(dataset) : { valid: true, errors: [] };
  if (!validation.valid) throw new Error(`Erzeugter Datensatz ist ungültig:\n${validation.errors.join("\n")}`);
  await persistJson(output, dataset);
  return { dataset, gamesSeen, positionsAnalyzed, output: resolve(output), cachePath: resolve(cachePath) };
}

function usage() {
  return [
    "Usage: node scripts/generate-pgn-benchmark-candidates.mjs --input=PATH [options]",
    "",
    "  --output=PATH       Zieldatei (Default: data/benchmarks/pgn-candidates.json)",
    "  --limit=N           gewünschte Kandidaten (Default: 5)",
    "  --depth=N           Stockfish-Tiefe (Default: 10)",
    "  --multipv=N         Anzahl Kandidatenlinien (Default: 3)",
    "  --max-games=N       maximal gelesene Partien (Default: 40)",
    "  --min-swing=N       Mindestverlust in cp (Default: 60)",
    "  --cache=PATH        wiederverwendbarer Engine-Cache",
  ].join("\n");
}

async function main() {
  const argv = process.argv.slice(2);
  if (argv.includes("--help") || !option(argv, "input")) {
    process.stdout.write(`${usage()}\n`);
    if (!argv.includes("--help")) process.exitCode = 1;
    return;
  }
  const result = await generatePgnBenchmarkCandidates({
    input: option(argv, "input"),
    output: option(argv, "output", DEFAULT_OUTPUT),
    cachePath: option(argv, "cache", DEFAULT_CACHE),
    limit: integerOption(argv, "limit", 5, 1, 100),
    depth: integerOption(argv, "depth", 10, 4, 30),
    multiPv: integerOption(argv, "multipv", 3, 2, 5),
    maxGames: integerOption(argv, "max-games", 40, 1, 10_000),
    minSwing: integerOption(argv, "min-swing", 60, 0, 5_000),
    onProgress: ({ cases, limit, gamesSeen }) => {
      process.stdout.write(`[PGN benchmark] ${cases}/${limit} Kandidaten · ${gamesSeen} Partien gelesen\n`);
    },
  });
  process.stdout.write(`Gespeichert: ${result.output}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((error) => {
    console.error(error?.stack || error);
    process.exitCode = 1;
  });
}
