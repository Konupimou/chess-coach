import { readFile } from "node:fs/promises";
import { performance } from "node:perf_hooks";
import { resolve } from "node:path";
import { Chess } from "chess.js";
import {
  normalizedPgnPositionKey,
  pgnKnowledgeForPosition,
} from "../pgnKnowledge.js";
import { TRANSFER_CONCEPT_CATALOGUE } from "../positionConcepts.js";

function numericOption(argv, name, fallback) {
  const raw = argv.find((value) => value.startsWith(`--${name}=`))?.split("=")[1];
  const parsed = Number.parseInt(raw || "", 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function percentile(sorted, fraction) {
  if (sorted.length === 0) return 0;
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * fraction))];
}

export async function evaluateConceptTransfer({
  indexPath = "data/pgn/coach-pgn-index.json",
  sampleSize = 80,
} = {}) {
  const index = JSON.parse(await readFile(resolve(indexPath), "utf8"));
  const conceptCoverage = Object.fromEntries(TRANSFER_CONCEPT_CATALOGUE.map((id) => [
    id,
    index.searchBuckets?.[`concept:${id}`]?.length || 0,
  ]));
  const durations = [];
  let unknownPositions = 0;
  let results = 0;
  let explicitTransfers = 0;
  const stride = Math.max(1, Math.floor((index.positionKeys?.length || 1) / (sampleSize * 2)));
  for (let positionIndex = 0;
    positionIndex < (index.positionKeys?.length || 0) && unknownPositions < sampleSize;
    positionIndex += stride) {
    const positionKey = index.positionKeys[positionIndex];
    let game;
    try {
      game = new Chess(`${positionKey} 0 1`);
    } catch {
      continue;
    }
    const move = game.moves({ verbose: true }).find((candidate) => {
      const copy = new Chess(game.fen());
      copy.move(candidate);
      return !index.positions[normalizedPgnPositionKey(copy.fen())];
    });
    if (!move) continue;
    game.move(move);
    unknownPositions += 1;
    const started = performance.now();
    const matches = pgnKnowledgeForPosition({
      fen: game.fen(),
      question: "Was ist hier der Plan?",
      limit: 3,
      index,
    });
    durations.push(performance.now() - started);
    if (matches.length > 0) results += 1;
    if (matches.some((entry) => entry.match?.conceptTransfer?.length > 0)) explicitTransfers += 1;
  }
  durations.sort((left, right) => left - right);
  return {
    indexVersion: index.version,
    indexedPositions: index.stats?.positions || 0,
    catalogueGroups: TRANSFER_CONCEPT_CATALOGUE.length,
    corpusDetectedGroups: Object.values(conceptCoverage).filter((count) => count > 0).length,
    conceptCoverage,
    benchmark: {
      method: "deterministic legal one-move mutations absent from the exact-position index",
      unknownPositions,
      positionsWithResult: results,
      positionsWithExplicitTransfer: explicitTransfers,
      transferCoverage: unknownPositions ? explicitTransfers / unknownPositions : 0,
      p50Ms: Number(percentile(durations, 0.5).toFixed(2)),
      p95Ms: Number(percentile(durations, 0.95).toFixed(2)),
      maxMs: Number(Math.max(0, ...durations).toFixed(2)),
      targetP95Ms: 300,
    },
    baseline: {
      version: 3,
      explicitConceptTransfer: false,
      candidateLookup: "linear profile scan",
    },
  };
}

async function main() {
  const argv = process.argv.slice(2);
  const result = await evaluateConceptTransfer({
    indexPath: argv.find((value) => value.startsWith("--index="))?.slice(8)
      || "data/pgn/coach-pgn-index.json",
    sampleSize: numericOption(argv, "samples", 80),
  });
  console.log(JSON.stringify(result, null, 2));
  if (result.benchmark.p95Ms >= result.benchmark.targetP95Ms) process.exitCode = 1;
}

if (import.meta.url === new URL(process.argv[1], "file:").href) {
  main().catch((error) => {
    console.error(error?.stack || error);
    process.exitCode = 1;
  });
}
