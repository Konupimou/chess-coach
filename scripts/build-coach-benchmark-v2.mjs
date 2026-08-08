import { createHash } from "node:crypto";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
  BENCHMARK_QUESTIONS,
  COACH_BENCHMARK_SCHEMA_VERSION,
  legalLineFromFen,
  validateBenchmarkDataset,
} from "../coachBenchmark.js";
import { parseAnnotatedPgn } from "../pgnPipeline.js";
import { StockfishBatch } from "./analyze-coach-annotations.mjs";
import { splitPgnGames } from "./generate-pgn-benchmark-candidates.mjs";

const DEFAULT_OUTPUT = "data/benchmarks/coach-benchmark-v2.json";
const DEFAULT_CACHE = ".cache/coach-benchmark/stockfish-v2.json";
const MULTI_PURPOSE = "database/used/The Art of Multi-Purpose Moves.pgn";
const ATTACKING_INTUITION = "database/used/Building Attacking Intuition in Chess - WGM Thalia Cervantes.pgn";

const group = (id, ...concepts) => ({ id, concepts });

// Die Quellen sind nur Reproduktionsanker. Kommentare und erwartete Konzepte
// werden nie an den getesteten Coach übergeben.
export const V2_CURATED_SPECS = Object.freeze([
  {
    id: "multi-queen-three-jobs", file: MULTI_PURPOSE, game: 5, ply: 49,
    categories: ["MULTI_FACTOR", "PROPHYLAXIS", "PIECE_ACTIVITY", "QUIET_MOVE"],
    concepts: ["prophylaxis", "restriction", "coordination", "piece_activity"],
    groups: [group("prevention", "prophylaxis", "restriction"), group("coordination", "coordination"), group("activity", "piece_activity")],
  },
  {
    id: "multi-bishop-retreat", file: MULTI_PURPOSE, game: 6, ply: 49,
    categories: ["MULTI_FACTOR", "PROPHYLAXIS", "PIECE_ACTIVITY", "QUIET_MOVE"],
    concepts: ["prophylaxis", "restriction", "piece_activity", "initiative"],
    groups: [group("counterplay_restriction", "prophylaxis", "restriction"), group("piece_improvement", "piece_activity"), group("initiative", "initiative")],
  },
  {
    id: "quiet-weak-square-prophylaxis", file: MULTI_PURPOSE, game: 7, ply: 33,
    categories: ["MULTI_FACTOR", "PROPHYLAXIS", "POSITIONAL", "QUIET_MOVE"],
    concepts: ["prophylaxis", "weak_square", "restriction"],
    groups: [group("opponents_plan", "prophylaxis"), group("weak_square", "weak_square"), group("restriction", "restriction")],
  },
  {
    id: "active-prophylaxis-queen-retreat", file: MULTI_PURPOSE, game: 8, ply: 46,
    categories: ["MULTI_FACTOR", "PROPHYLAXIS", "PIECE_ACTIVITY", "QUIET_MOVE"],
    concepts: ["prophylaxis", "piece_activity", "restriction"],
    groups: [group("prevention", "prophylaxis", "restriction"), group("activity", "piece_activity")],
  },
  {
    id: "quiet-king-step", file: MULTI_PURPOSE, game: 26, ply: 49,
    categories: ["PROPHYLAXIS", "KING_SAFETY", "QUIET_MOVE"],
    concepts: ["prophylaxis", "king_safety"],
    groups: [group("prevention", "prophylaxis"), group("king_safety", "king_safety")],
  },
  {
    id: "aggressive-prophylaxis-qh8", file: MULTI_PURPOSE, game: 38, ply: 36,
    categories: ["MULTI_FACTOR", "PROPHYLAXIS", "INITIATIVE", "QUIET_MOVE"],
    concepts: ["prophylaxis", "initiative", "piece_activity"],
    groups: [group("prevention", "prophylaxis"), group("initiative", "initiative"), group("activation", "piece_activity")],
  },
  {
    id: "quiet-kings-indian-rook", file: MULTI_PURPOSE, game: 23, ply: 30,
    categories: ["MULTI_FACTOR", "PROPHYLAXIS", "PIECE_ACTIVITY", "QUIET_MOVE"],
    concepts: ["prophylaxis", "piece_activity", "restriction"],
    groups: [group("defense", "prophylaxis"), group("rook_activity", "piece_activity", "rook_activity"), group("restriction", "restriction")],
  },
  {
    id: "multi-rook-defense-and-pressure", file: MULTI_PURPOSE, game: 13, ply: 37,
    categories: ["MULTI_FACTOR", "PROPHYLAXIS", "PIECE_ACTIVITY", "QUIET_MOVE"],
    concepts: ["prophylaxis", "piece_activity", "coordination"],
    groups: [group("defense", "prophylaxis"), group("activity", "piece_activity"), group("coordination", "coordination")],
  },
  {
    id: "initiative-forcing-knight", file: MULTI_PURPOSE, game: 10, ply: 52,
    categories: ["MULTI_FACTOR", "INITIATIVE", "KING_SAFETY", "TACTICAL"],
    concepts: ["initiative", "mating_attack", "prophylaxis"],
    groups: [group("initiative", "initiative"), group("king_attack", "mating_attack", "unsafe_king"), group("prevention", "prophylaxis")],
  },
  {
    id: "compensation-development-tempi", file: MULTI_PURPOSE, game: 25, ply: 3,
    categories: ["MULTI_FACTOR", "COMPENSATION", "INITIATIVE", "DEVELOPMENT"],
    concepts: ["compensation", "initiative", "development_advantage", "piece_activity"],
    groups: [group("compensation", "compensation"), group("initiative", "initiative"), group("development", "development_advantage", "piece_activity")],
  },
  {
    id: "compensation-center-and-attack", file: MULTI_PURPOSE, game: 56, ply: 31,
    categories: ["MULTI_FACTOR", "COMPENSATION", "INITIATIVE", "PIECE_ACTIVITY"],
    concepts: ["compensation", "initiative", "piece_activity", "center_control"],
    groups: [group("compensation", "compensation"), group("initiative", "initiative"), group("activity", "piece_activity", "center_control")],
  },
  {
    id: "compensation-hindrance-pawn", file: MULTI_PURPOSE, game: 48, ply: 23,
    categories: ["MULTI_FACTOR", "COMPENSATION", "INITIATIVE", "DEVELOPMENT"],
    concepts: ["compensation", "initiative", "development_advantage", "restriction"],
    groups: [group("compensation", "compensation"), group("initiative", "initiative"), group("development_gap", "development_advantage", "restriction")],
  },
  {
    id: "compensation-queen-sacrifice", file: ATTACKING_INTUITION, game: 3, ply: 23,
    categories: ["MULTI_FACTOR", "COMPENSATION", "INITIATIVE", "MATERIAL"],
    concepts: ["compensation", "initiative", "development_advantage", "space_advantage"],
    groups: [group("material_compensation", "compensation"), group("initiative", "initiative"), group("positional_assets", "development_advantage", "space_advantage", "piece_activity")],
  },
  {
    id: "initiative-restricting-sacrifice", file: ATTACKING_INTUITION, game: 39, ply: 31,
    categories: ["MULTI_FACTOR", "COMPENSATION", "INITIATIVE", "POSITIONAL"],
    concepts: ["compensation", "initiative", "restriction", "pawn_break"],
    groups: [group("compensation", "compensation"), group("initiative", "initiative"), group("restriction", "restriction", "pawn_break")],
  },
  {
    id: "restriction-pawn-activates-pieces", file: MULTI_PURPOSE, game: 45, ply: 49,
    categories: ["MULTI_FACTOR", "POSITIONAL", "PIECE_ACTIVITY", "QUIET_MOVE"],
    concepts: ["restriction", "piece_activity", "pawn_break"],
    groups: [group("restriction", "restriction"), group("activity", "piece_activity"), group("pawn_play", "pawn_break")],
  },
  {
    id: "restriction-c5-bishop", file: MULTI_PURPOSE, game: 46, ply: 35,
    categories: ["MULTI_FACTOR", "POSITIONAL", "PIECE_ACTIVITY", "QUIET_MOVE"],
    concepts: ["restriction", "piece_activity", "pawn_break"],
    groups: [group("restriction", "restriction"), group("activity", "piece_activity"), group("pawn_play", "pawn_break")],
  },
  {
    id: "prophylaxis-permanent-bind", file: MULTI_PURPOSE, game: 59, ply: 47,
    categories: ["MULTI_FACTOR", "PROPHYLAXIS", "POSITIONAL", "QUIET_MOVE"],
    concepts: ["prophylaxis", "restriction", "piece_activity"],
    groups: [group("prevention", "prophylaxis"), group("restriction", "restriction"), group("activity", "piece_activity")],
  },
  {
    id: "endgame-reti-pawn-race", file: MULTI_PURPOSE, game: 41, ply: 1,
    categories: ["MULTI_FACTOR", "COMPLEX_ENDGAME", "ENDGAME", "QUIET_MOVE"],
    concepts: ["pawn_race", "king_activity_endgame", "prophylaxis"],
    groups: [group("pawn_race", "pawn_race"), group("king_activity", "king_activity_endgame"), group("dual_purpose", "prophylaxis")],
  },
  {
    id: "endgame-rook-drawing-geometry", file: MULTI_PURPOSE, game: 43, ply: 1,
    categories: ["MULTI_FACTOR", "COMPLEX_ENDGAME", "ENDGAME", "QUIET_MOVE"],
    concepts: ["king_activity_endgame", "prophylaxis", "rook_activity"],
    groups: [group("king_activity", "king_activity_endgame"), group("prevention", "prophylaxis"), group("rook_geometry", "rook_activity")],
  },
  {
    id: "endgame-bodycheck", file: MULTI_PURPOSE, game: 44, ply: 3,
    categories: ["MULTI_FACTOR", "COMPLEX_ENDGAME", "ENDGAME", "QUIET_MOVE"],
    concepts: ["opposition", "king_activity_endgame", "prophylaxis"],
    groups: [group("opposition", "opposition"), group("king_activity", "king_activity_endgame"), group("prevention", "prophylaxis")],
  },
  {
    id: "endgame-rook-two-functions", file: MULTI_PURPOSE, game: 54, ply: 1,
    categories: ["MULTI_FACTOR", "COMPLEX_ENDGAME", "ENDGAME", "PIECE_ACTIVITY"],
    concepts: ["rook_activity", "passed_pawn", "prophylaxis"],
    groups: [group("rook_activity", "rook_activity", "piece_activity"), group("passed_pawn", "passed_pawn"), group("prevention", "prophylaxis")],
  },
  {
    id: "endgame-pawn-race-dual-king", file: MULTI_PURPOSE, game: 73, ply: 3,
    categories: ["MULTI_FACTOR", "COMPLEX_ENDGAME", "ENDGAME", "QUIET_MOVE"],
    concepts: ["pawn_race", "king_activity_endgame", "prophylaxis"],
    groups: [group("pawn_race", "pawn_race"), group("king_activity", "king_activity_endgame"), group("prevention", "prophylaxis")],
  },
  {
    id: "no-single-motif-queen-realignment", file: MULTI_PURPOSE, game: 20, ply: 36,
    categories: ["MULTI_FACTOR", "POSITIONAL", "QUIET_MOVE", "UNCERTAIN"],
    concepts: ["piece_activity", "coordination", "prophylaxis"],
    groups: [group("activity", "piece_activity"), group("coordination", "coordination"), group("prevention", "prophylaxis")],
  },
  {
    id: "no-single-motif-restraining-center", file: MULTI_PURPOSE, game: 17, ply: 38,
    categories: ["MULTI_FACTOR", "POSITIONAL", "QUIET_MOVE", "UNCERTAIN"],
    concepts: ["restriction", "piece_activity", "coordination"],
    groups: [group("restriction", "restriction"), group("activity", "piece_activity"), group("coordination", "coordination")],
  },
  {
    id: "initiative-quiet-pawn", file: MULTI_PURPOSE, game: 75, ply: 73,
    categories: ["MULTI_FACTOR", "INITIATIVE", "KING_SAFETY", "QUIET_MOVE"],
    concepts: ["initiative", "king_safety", "restriction"],
    groups: [group("initiative", "initiative"), group("king_safety", "king_safety"), group("restriction", "restriction")],
  },
]);

function option(argv, name, fallback = "") {
  const prefix = `--${name}=`;
  return argv.find((value) => value.startsWith(prefix))?.slice(prefix.length) || fallback;
}

function integerOption(argv, name, fallback, minimum, maximum) {
  const parsed = Number.parseInt(option(argv, name), 10);
  return Number.isInteger(parsed) ? Math.max(minimum, Math.min(maximum, parsed)) : fallback;
}

function hash(value) {
  return createHash("sha256").update(String(value || "")).digest("hex");
}

function evaluationCp(value) {
  if (value?.unit === "cp") return Number(value.value) || 0;
  const mate = Number(value?.value) || 0;
  return (Math.sign(mate) || 1) * (100_000 - Math.min(999, Math.abs(mate)) * 100);
}

function qualityFor(lossCp, bestIsPlayed) {
  if (bestIsPlayed) return "best";
  if (lossCp >= 300) return "blunder";
  if (lossCp >= 140) return "mistake";
  if (lossCp >= 50) return "inaccuracy";
  return "good";
}

async function readCache(path) {
  try {
    return JSON.parse(await readFile(resolve(path), "utf8"));
  } catch {
    return {};
  }
}

async function persist(path, value) {
  const target = resolve(path);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function selectedMove(spec, sourceCache) {
  if (!sourceCache.has(spec.file)) {
    const raw = await readFile(resolve(spec.file), "utf8");
    sourceCache.set(spec.file, splitPgnGames(raw));
  }
  const rawGame = sourceCache.get(spec.file)[spec.game - 1];
  if (!rawGame) throw new Error(`PGN-Partie fehlt: ${spec.file} #${spec.game}`);
  const parsed = parseAnnotatedPgn(rawGame, {
    source: hash(spec.file).slice(0, 16),
    gameOrdinal: spec.game,
  });
  const move = parsed.moves?.find((entry) => (
    entry.mainline && entry.variationDepth === 0 && entry.ply === spec.ply
  ));
  if (!move?.uci || !move?.fenBefore) throw new Error(`Zug fehlt: ${spec.id}`);
  return { parsed, move };
}

function engineLine(line, rank, depth) {
  return {
    rank,
    depth: line.depth || depth,
    evaluation: line.evaluation,
    pvUci: line.pvUci,
  };
}

export async function buildCoachBenchmarkV2({
  output = DEFAULT_OUTPUT,
  cachePath = DEFAULT_CACHE,
  depth = 14,
  multiPv = 4,
  onProgress = null,
} = {}) {
  const cache = await readCache(cachePath);
  const sourceCache = new Map();
  let engine = null;
  const cases = [];
  try {
    for (const [index, spec] of V2_CURATED_SPECS.entries()) {
      const { parsed, move } = await selectedMove(spec, sourceCache);
      const cacheKey = hash(`${move.fenBefore}|${move.uci}|${depth}|${multiPv}`);
      let lines = cache[cacheKey];
      if (!Array.isArray(lines)) {
        engine ||= new StockfishBatch({ multiPv });
        const top = await engine.search(move.fenBefore, { depth });
        const played = top.some((line) => line.uci === move.uci)
          ? null
          : (await engine.search(move.fenBefore, { depth, searchMove: move.uci }))[0] || null;
        lines = [...top, ...(played ? [played] : [])];
        cache[cacheKey] = lines;
        await persist(cachePath, cache);
      }
      const top = lines.slice(0, multiPv);
      const best = top[0];
      const played = lines.find((line) => line.uci === move.uci);
      if (!best || !played) throw new Error(`Engine-Linie fehlt: ${spec.id}`);
      const lossCp = Math.max(0, Math.round(
        evaluationCp(best.evaluation) - evaluationCp(played.evaluation),
      ));
      const bestIsPlayed = best.uci === move.uci;
      const after = legalLineFromFen(move.fenBefore, [move.uci]);
      const caseLines = top.map((line, lineIndex) => engineLine(line, lineIndex + 1, depth));
      if (!top.some((line) => line.uci === move.uci)) {
        caseLines.push(engineLine(played, caseLines.length + 1, depth));
      }
      const playedRank = caseLines.find(
        (line) => line.pvUci?.[0] === move.uci,
      )?.rank || caseLines.length + 1;
      cases.push({
        id: `v2-${spec.id}`,
        fenBefore: move.fenBefore,
        fenAfter: move.fenAfter || after.fenAfter,
        playedMove: { uci: move.uci, san: move.san },
        engine: {
          provider: "stockfish_18_curated_pgn",
          depth,
          bestMove: best.uci,
          lossCp,
          quality: qualityFor(lossCp, bestIsPlayed),
          lines: caseLines,
          playedLine: engineLine(played, playedRank, depth),
        },
        expected: {
          categories: spec.categories,
          possibleConcepts: spec.concepts,
          requiredConceptGroups: spec.groups,
          requiredFacts: [],
          needsReview: false,
          expectNoPrimaryReason: false,
          reasonMode: "multi_factor",
          groundTruth: "curated_annotated_master_position",
        },
        source: {
          type: "curated_pgn",
          sourceId: hash(spec.file).slice(0, 16),
          gameId: parsed.gameId,
          gameOrdinal: spec.game,
          ply: spec.ply,
        },
        difficulty: "advanced",
        questionIds: bestIsPlayed
          ? ["why_best", "most_important", "why_evaluation"]
          : lossCp <= 40
            ? ["was_bad", "compare", "most_important"]
            : ["why_bad", "compare", "overlooked", "lesson"],
        metadata: {
          generated: false,
          rating: 2000,
          benchmarkFocus: spec.categories,
          engineCacheKey: cacheKey,
        },
      });
      onProgress?.({ completed: index + 1, total: V2_CURATED_SPECS.length, id: spec.id, lossCp });
    }
  } finally {
    engine?.close();
  }
  const dataset = {
    schemaVersion: COACH_BENCHMARK_SCHEMA_VERSION,
    datasetId: "coach-benchmark-v2-hard",
    description: "Schwierige, getrennte Suite für Multi-Factor-Diagnosen, ruhige Engine-Züge, Prophylaxe, Kompensation, Initiative und komplexe Endspiele.",
    contaminationPolicy: "Erwartungen, Konzeptgruppen und Quellenmetadaten sind ausschließlich für den Runner bestimmt und werden nie in Coach-Prompts eingefügt.",
    questions: BENCHMARK_QUESTIONS,
    cases,
  };
  const validation = validateBenchmarkDataset(dataset);
  if (!validation.valid) throw new Error(`Benchmark-v2 ist ungültig:\n${validation.errors.join("\n")}`);
  await persist(output, dataset);
  return { dataset, output: resolve(output), cachePath: resolve(cachePath) };
}

async function main() {
  const argv = process.argv.slice(2);
  const result = await buildCoachBenchmarkV2({
    output: option(argv, "output", DEFAULT_OUTPUT),
    cachePath: option(argv, "cache", DEFAULT_CACHE),
    depth: integerOption(argv, "depth", 14, 8, 30),
    multiPv: integerOption(argv, "multipv", 4, 2, 5),
    onProgress: ({ completed, total, id, lossCp }) => {
      process.stdout.write(`[Benchmark v2] ${completed}/${total} · ${id} · Verlust ${lossCp} cp\n`);
    },
  });
  process.stdout.write(`Benchmark v2 gespeichert: ${result.output}\n`);
  process.stdout.write(`Fälle: ${result.dataset.cases.length}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((error) => {
    console.error(error?.stack || error);
    process.exitCode = 1;
  });
}
