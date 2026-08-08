import { spawn } from "node:child_process";
import { appendFile, mkdir, readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { verifyAnnotationRecord } from "../annotationVerification.js";

function option(argv, name, fallback = "") {
  const prefix = `--${name}=`;
  return argv.find((value) => value.startsWith(prefix))?.slice(prefix.length) || fallback;
}

function numericOption(argv, name, fallback, minimum, maximum) {
  const parsed = Number.parseInt(option(argv, name), 10);
  return Number.isInteger(parsed) ? Math.max(minimum, Math.min(maximum, parsed)) : fallback;
}

export function parseInfo(line) {
  if (!line.startsWith("info ") || !line.includes(" pv ")) return null;
  const depth = Number.parseInt(line.match(/\bdepth (\d+)/)?.[1] || "0", 10);
  const rank = Number.parseInt(line.match(/\bmultipv (\d+)/)?.[1] || "1", 10);
  const score = line.match(/\bscore (cp|mate) (-?\d+)/);
  const pv = line.split(" pv ")[1]?.trim().split(/\s+/).filter(Boolean) || [];
  if (!score || pv.length === 0) return null;
  return {
    depth,
    rank,
    uci: pv[0],
    evaluation: { unit: score[1], value: Number.parseInt(score[2], 10), perspective: "player" },
    pvUci: pv.slice(0, 20),
  };
}

export class StockfishBatch {
  constructor({ multiPv = 3 } = {}) {
    const cli = resolve(dirname(fileURLToPath(import.meta.url)), "../node_modules/stockfish/scripts/cli.js");
    this.child = spawn(process.execPath, [cli], { stdio: ["pipe", "pipe", "pipe"] });
    this.lines = createInterface({ input: this.child.stdout, crlfDelay: Infinity });
    this.waiters = [];
    this.lines.on("line", (line) => this.handleLine(line.trim()));
    this.child.stderr.on("data", (chunk) => {
      const message = String(chunk || "").trim();
      if (message) console.error(`[Stockfish] ${message}`);
    });
    this.ready = this.waitFor("uciok").then(() => {
      this.send("setoption name Threads value 1");
      this.send("setoption name Hash value 64");
      this.send(`setoption name MultiPV value ${multiPv}`);
      this.send("isready");
      return this.waitFor("readyok");
    });
    this.send("uci");
  }

  send(command) {
    this.child.stdin.write(`${command}\n`);
  }

  handleLine(line) {
    for (const waiter of [...this.waiters]) {
      waiter.lines.push(line);
      if (!line.startsWith(waiter.terminal)) continue;
      this.waiters.splice(this.waiters.indexOf(waiter), 1);
      waiter.resolve(waiter.lines);
    }
  }

  waitFor(terminal) {
    return new Promise((resolve, reject) => {
      const waiter = { terminal, lines: [], resolve, reject };
      this.waiters.push(waiter);
      const timer = setTimeout(() => {
        const index = this.waiters.indexOf(waiter);
        if (index >= 0) this.waiters.splice(index, 1);
        reject(new Error(`Stockfish timeout: ${terminal}`));
      }, 120_000);
      const originalResolve = waiter.resolve;
      waiter.resolve = (value) => {
        clearTimeout(timer);
        originalResolve(value);
      };
    });
  }

  async search(fen, { depth, searchMove = "" } = {}) {
    await this.ready;
    this.send(`position fen ${fen}`);
    const wait = this.waitFor("bestmove ");
    this.send(`go depth ${depth}${searchMove ? ` searchmoves ${searchMove}` : ""}`);
    const lines = await wait;
    const final = new Map();
    for (const line of lines) {
      const info = parseInfo(line);
      if (!info) continue;
      const previous = final.get(info.rank);
      if (!previous || info.depth >= previous.depth) final.set(info.rank, info);
    }
    return [...final.values()].sort((a, b) => a.rank - b.rank);
  }

  close() {
    this.send("quit");
    this.lines.close();
  }
}

async function completedIds(outputPath) {
  try {
    return new Set((await readFile(outputPath, "utf8"))
      .split(/\r?\n/)
      .filter(Boolean)
      .flatMap((line) => {
        try {
          return [JSON.parse(line)?.recordId].filter(Boolean);
        } catch {
          return [];
        }
      }));
  } catch {
    return new Set();
  }
}

export async function analyzeTrainingExport({
  inputPath,
  outputPath,
  depth = 12,
  multiPv = 3,
  limit = 100,
  onProgress = null,
} = {}) {
  const input = JSON.parse(await readFile(resolve(inputPath), "utf8"));
  if (input?.purpose !== "validated_training_candidate_export" || !Array.isArray(input.records)) {
    throw new Error("Der Trainingskandidaten-Export ist ungültig.");
  }
  const target = resolve(outputPath);
  await mkdir(dirname(target), { recursive: true });
  const done = await completedIds(target);
  const records = input.records
    .filter((record) => !done.has(record.id))
    .filter((record) => record.annotation?.originalComment || record.annotation?.alternatives?.length)
    .sort((left, right) => {
      const priority = (record) => (
        (record.annotation?.alternatives?.length || 0) * 100
        + (record.annotation?.claims?.filter((claim) => ["moveAssessment", "danger", "recommendedAlternative"]
          .includes(claim.field)).length || 0) * 10
        + (record.nags?.length || 0)
      );
      return priority(right) - priority(left) || String(left.id).localeCompare(String(right.id), "en");
    })
    .slice(0, limit);
  const engine = new StockfishBatch({ multiPv });
  let processed = 0;
  try {
    for (const record of records) {
      const lines = await engine.search(record.fenBefore, { depth });
      const played = lines.some((line) => line.uci === record.uci)
        ? null
        : (await engine.search(record.fenBefore, { depth, searchMove: record.uci }))[0] || null;
      const analysis = {
        fen: record.fenBefore,
        engineVersion: "Stockfish 18",
        limit: { type: "depth", value: depth, multiPv },
        depth,
        lines: [...lines, ...(played ? [{ ...played, rank: lines.length + 1 }] : [])],
      };
      const verification = verifyAnnotationRecord(record, analysis);
      await appendFile(target, `${JSON.stringify({ recordId: record.id, analysis, verification })}\n`, "utf8");
      processed += 1;
      onProgress?.({ processed, total: records.length, recordId: record.id });
    }
  } finally {
    engine.close();
  }
  return { processed, skipped: done.size, remaining: Math.max(0, input.records.length - done.size - processed) };
}

async function main() {
  const argv = process.argv.slice(2);
  const result = await analyzeTrainingExport({
    inputPath: option(argv, "input", "data/pgn/coach-pgn-training.json"),
    outputPath: option(argv, "output", "data/pgn/coach-pgn-verification.jsonl"),
    depth: numericOption(argv, "depth", 12, 4, 30),
    multiPv: numericOption(argv, "multipv", 3, 2, 5),
    limit: numericOption(argv, "limit", 100, 1, 100_000),
    onProgress: ({ processed, total }) => {
      if (processed % 10 === 0 || processed === total) console.log(`[PGN analysis] ${processed}/${total}`);
    },
  });
  console.log(JSON.stringify(result, null, 2));
}

if (import.meta.url === new URL(process.argv[1], "file:").href) {
  main().catch((error) => {
    console.error(error?.stack || error);
    process.exitCode = 1;
  });
}
