import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { createInterface } from "node:readline";
import { Chess, SQUARES } from "chess.js";
import {
  buildLocalMoveExplanation,
  buildTrustedExplanationEvidence,
  moveExplanationToMarkdown,
  phaseFromPositionEvidence,
  verifyMoveExplanation,
} from "../coachExplanation.js";
import {
  findUnsupportedBoardClaims,
  findUnsupportedEvaluationTokens,
  findUnsupportedMoveTokens,
} from "../coachEngineContext.js";
import { validateCoachLanguage } from "../coachLanguageQuality.js";
import { classifyCentipawnLoss } from "../gameReview.js";
import { learnerProfileForCoach } from "../learnerProfile.js";
import { buildPositionEvidence } from "../positionEvidence.js";
import { parseInfo } from "./analyze-coach-annotations.mjs";

export const COACH_STRESS_SCHEMA_VERSION = 2;
export const COACH_STRESS_RATINGS = Object.freeze([800, 1000, 1400, 1800]);
export const COACH_STRESS_PHASES = Object.freeze([
  "opening",
  "middlegame",
  "endgame",
]);

const PIECE_VALUES = Object.freeze({ p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 });
const HOME_MINOR_SQUARES = new Set([
  "b1", "c1", "f1", "g1", "b8", "c8", "f8", "g8",
]);
const DEFAULT_SEED = "0x5eed1234";
const DEFAULT_JSON_PATH = "reports/coach-random-stockfish-stress.json";
const DEFAULT_MARKDOWN_PATH = "reports/coach-random-stockfish-stress.md";

function option(argv, name, fallback = "") {
  const prefix = `--${name}=`;
  return argv.find((value) => value.startsWith(prefix))?.slice(prefix.length) || fallback;
}

function integerOption(argv, name, fallback, minimum, maximum) {
  const parsed = Number.parseInt(option(argv, name), 10);
  if (!Number.isInteger(parsed)) return fallback;
  return Math.max(minimum, Math.min(maximum, parsed));
}

function percentage(passed, total) {
  return total > 0 ? Number(((passed / total) * 100).toFixed(2)) : 0;
}

function sha256(value) {
  return createHash("sha256").update(String(value)).digest("hex");
}

function numericSeed(value) {
  const text = String(value || DEFAULT_SEED).trim();
  const parsed = /^0x[\da-f]+$/iu.test(text)
    ? Number.parseInt(text.slice(2), 16)
    : /^\d+$/u.test(text)
      ? Number.parseInt(text, 10)
      : Number.parseInt(sha256(text).slice(0, 8), 16);
  const normalized = parsed >>> 0;
  return normalized || 0x6d2b79f5;
}

function seededRandom(seed) {
  let state = numericSeed(seed);
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return (state >>> 0) / 0x100000000;
  };
}

function shuffle(values, random) {
  const result = [...values];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const other = Math.floor(random() * (index + 1));
    [result[index], result[other]] = [result[other], result[index]];
  }
  return result;
}

function moveUci(move) {
  return `${move.from}${move.to}${move.promotion || ""}`.toLowerCase();
}

function positionPhase(game) {
  let totalPoints = 0;
  let totalQueens = 0;
  for (const square of SQUARES) {
    const piece = game.get(square);
    if (!piece) continue;
    totalPoints += PIECE_VALUES[piece.type] || 0;
    totalQueens += Number(piece.type === "q");
  }
  const fullmove = Number.parseInt(game.fen().split(/\s+/)[5], 10) || 1;
  if (totalQueens === 0 && totalPoints <= 42) return "endgame";
  return fullmove <= 12 ? "opening" : "middlegame";
}

function chooseRandomMove(moves, random) {
  const weighted = moves.map((move) => ({
    move,
    weight: (
      1
      + (move.captured ? 10 : 0)
      + (move.san.includes("+") ? 4 : 0)
      + (move.san.includes("#") ? 60 : 0)
      + (move.promotion ? 20 : 0)
    ),
  }));
  let choice = random() * weighted.reduce((sum, entry) => sum + entry.weight, 0);
  for (const entry of weighted) {
    choice -= entry.weight;
    if (choice <= 0) return entry.move;
  }
  return weighted.at(-1).move;
}

export function generateRandomPositionSample({
  games = 40,
  positionsPerPhase = 10,
  maxPlies = 180,
  seed = DEFAULT_SEED,
  everyPly = false,
} = {}) {
  const random = seededRandom(seed);
  const pools = Object.fromEntries(COACH_STRESS_PHASES.map((phase) => [phase, []]));
  const gamesReachingPhase = Object.fromEntries(
    COACH_STRESS_PHASES.map((phase) => [phase, 0]),
  );
  const endings = { checkmate: 0, draw: 0, plyLimit: 0 };
  const everyPlySamples = [];
  let generatedPlies = 0;

  for (let gameIndex = 0; gameIndex < games; gameIndex += 1) {
    const game = new Chess();
    const reservoir = {};
    const phasePositionCounts = {};
    const reached = new Set();

    for (let ply = 0; ply < maxPlies; ply += 1) {
      const legalMoves = game.moves({ verbose: true });
      const halfmoveClock = Number.parseInt(game.fen().split(/\s+/)[4], 10) || 0;
      if (legalMoves.length === 0 || halfmoveClock >= 100) break;
      const phase = positionPhase(game);
      const move = chooseRandomMove(legalMoves, random);
      reached.add(phase);
      phasePositionCounts[phase] = (phasePositionCounts[phase] || 0) + 1;
      const sample = {
        phase,
        fen: game.fen(),
        playedUci: moveUci(move),
      };
      if (everyPly) {
        everyPlySamples.push(sample);
      } else if (
        !reservoir[phase]
        || random() < 1 / phasePositionCounts[phase]
      ) {
        reservoir[phase] = sample;
      }
      game.move(move);
      generatedPlies += 1;
    }

    reached.forEach((phase) => {
      gamesReachingPhase[phase] += 1;
    });
    COACH_STRESS_PHASES.forEach((phase) => {
      if (reservoir[phase]) pools[phase].push(reservoir[phase]);
    });
    const finalMoves = game.moves({ verbose: true });
    const finalHalfmoveClock = Number.parseInt(game.fen().split(/\s+/)[4], 10) || 0;
    if (finalMoves.length === 0 && game.inCheck()) endings.checkmate += 1;
    else if (finalMoves.length === 0 || finalHalfmoveClock >= 100) endings.draw += 1;
    else endings.plyLimit += 1;
  }

  const selected = everyPly ? everyPlySamples : [];
  const coverage = [];
  for (const phase of COACH_STRESS_PHASES) {
    if (everyPly) {
      const phaseSamples = everyPlySamples.filter((sample) => sample.phase === phase);
      coverage.push({
        phase,
        gamesReachingPhase: gamesReachingPhase[phase],
        availableUniquePositions: new Set(
          phaseSamples.map((sample) => `${sample.fen}|${sample.playedUci}`),
        ).size,
        requestedPositions: phaseSamples.length,
        selectedPositions: phaseSamples.length,
      });
      continue;
    }
    const unique = new Map(
      shuffle(pools[phase], random)
        .map((sample) => [`${sample.fen}|${sample.playedUci}`, sample]),
    );
    const phaseSelection = [...unique.values()].slice(0, positionsPerPhase);
    selected.push(...phaseSelection);
    coverage.push({
      phase,
      gamesReachingPhase: gamesReachingPhase[phase],
      availableUniquePositions: unique.size,
      requestedPositions: positionsPerPhase,
      selectedPositions: phaseSelection.length,
    });
  }

  return {
    selected,
    summary: {
      gamesGenerated: games,
      generatedPlies,
      gamesReachingPhase,
      endings,
      coverage,
      everyPly: Boolean(everyPly),
      selectionHash: sha256(selected
        .map((sample) => `${sample.phase}|${sample.fen}|${sample.playedUci}`)
        .join("\n")),
    },
  };
}

class LocalStockfish {
  constructor({ multiPv = 2, hashMb = 32 } = {}) {
    const cliPath = resolve("node_modules/stockfish/scripts/cli.js");
    this.child = spawn(process.execPath, [cliPath], { stdio: ["pipe", "pipe", "pipe"] });
    this.lines = createInterface({ input: this.child.stdout, crlfDelay: Infinity });
    this.waiters = [];
    this.engineName = "Stockfish";
    this.lines.on("line", (line) => this.handleLine(line.trim()));
    this.child.stderr.on("data", (chunk) => {
      const message = String(chunk || "").trim();
      if (message) process.stderr.write(`[Stockfish] ${message}\n`);
    });
    this.child.on("error", (error) => {
      this.rejectWaiters(error);
    });
    this.send("uci");
    this.ready = this.waitFor("uciok").then((output) => {
      this.engineName = output
        .find((line) => line.startsWith("id name "))
        ?.slice("id name ".length) || "Stockfish";
      this.send("setoption name Threads value 1");
      this.send(`setoption name Hash value ${hashMb}`);
      this.send(`setoption name MultiPV value ${multiPv}`);
      this.send("isready");
      return this.waitFor("readyok");
    });
  }

  send(command) {
    this.child.stdin.write(`${command}\n`);
  }

  handleLine(line) {
    for (const waiter of [...this.waiters]) {
      waiter.lines.push(line);
      if (!line.startsWith(waiter.terminal)) continue;
      this.waiters.splice(this.waiters.indexOf(waiter), 1);
      clearTimeout(waiter.timer);
      waiter.resolve(waiter.lines);
    }
  }

  rejectWaiters(error) {
    for (const waiter of this.waiters.splice(0)) {
      clearTimeout(waiter.timer);
      waiter.reject(error);
    }
  }

  waitFor(terminal, timeoutMs = 60_000) {
    return new Promise((resolvePromise, rejectPromise) => {
      const waiter = {
        terminal,
        lines: [],
        resolve: resolvePromise,
        reject: rejectPromise,
        timer: null,
      };
      waiter.timer = setTimeout(() => {
        const index = this.waiters.indexOf(waiter);
        if (index >= 0) this.waiters.splice(index, 1);
        rejectPromise(new Error(`Stockfish timeout: ${terminal}`));
      }, timeoutMs);
      this.waiters.push(waiter);
    });
  }

  async search(fen, { depth, searchMove = "" } = {}) {
    await this.ready;
    this.send(`position fen ${fen}`);
    const completed = this.waitFor("bestmove ");
    this.send(`go depth ${depth}${searchMove ? ` searchmoves ${searchMove}` : ""}`);
    const output = await completed;
    const finalLines = new Map();
    for (const line of output) {
      const info = parseInfo(line);
      if (!info) continue;
      const previous = finalLines.get(info.rank);
      if (!previous || info.depth >= previous.depth) finalLines.set(info.rank, info);
    }
    return [...finalLines.values()].sort((left, right) => left.rank - right.rank);
  }

  close() {
    if (!this.child.killed) this.send("quit");
    this.lines.close();
  }
}

function evaluationCp(evaluation) {
  if (evaluation?.unit === "cp") return evaluation.value;
  const mate = Number(evaluation?.value) || 0;
  return (Math.sign(mate) || 1) * (100_000 - Math.min(999, Math.abs(mate)) * 100);
}

function verifiedMoves(positionEvidence) {
  return (positionEvidence?.verifiedLines || []).flatMap((line) => line.moves || []);
}

function movesForClaim(claim, field, positionEvidence) {
  const referenced = [];
  for (const reference of claim?.moveRefs || []) {
    const line = positionEvidence.verifiedLines?.find(
      (candidate) => candidate.evidenceId === reference.lineEvidenceId,
    );
    if (!line) continue;
    const start = Number.parseInt(reference.startPly, 10) || 0;
    const length = reference.uci?.length || 1;
    referenced.push(...line.moves.slice(start, start + length));
  }
  if (referenced.length > 0) return referenced;
  if (field === "moveIdea") return [positionEvidence.playedMove];
  if (field === "alternative") {
    const alternativeUci = positionEvidence.moveComparison?.alternative?.move?.uci;
    return verifiedMoves(positionEvidence)
      .filter((move) => move.uci === alternativeUci)
      .slice(0, 1);
  }
  if (["opponentReply", "concreteConsequence"].includes(field)) {
    const playedLine = positionEvidence.verifiedLines?.find(
      (line) => line.moves?.[0]?.uci === positionEvidence.playedMove?.uci,
    );
    return playedLine?.moves?.slice(1, 2) || [];
  }
  return [];
}

function directSemanticIssues(explanation, text, positionEvidence) {
  const issues = [];
  const fields = [
    "verdict",
    "moveIdea",
    "opponentReply",
    "concreteConsequence",
    "alternative",
    "comparison",
    "takeaway",
  ];
  for (const field of fields) {
    const claim = explanation?.[field];
    if (!claim) continue;
    const moves = movesForClaim(claim, field, positionEvidence);
    const development = claim.text.match(
      /entwickel(?:st|t) (?:du )?(?:den |einen )?(Springer|Läufer)/iu,
    );
    if (development) {
      const expectedPiece = development[1].toLocaleLowerCase("de-DE") === "springer"
        ? "n"
        : "b";
      if (!moves.some((move) => (
        move.piece === expectedPiece && HOME_MINOR_SQUARES.has(move.from)
      ))) {
        issues.push(`${field}: falsche Entwicklung`);
      }
    }
    if (/\brochiert\b/iu.test(claim.text) && !moves.some((move) => move.castle)) {
      issues.push(`${field}: unbelegte Rochade`);
    }
    if (/\bmatt\b/iu.test(claim.text) && !moves.some((move) => move.givesCheckmate)) {
      issues.push(`${field}: unbelegtes Matt`);
    }
    if (
      /\bgibt (?:sofort )?Schach\b|\bmit Schach\b/iu.test(claim.text)
      && !moves.some((move) => move.givesCheck)
    ) {
      issues.push(`${field}: unbelegtes Schach`);
    }
    if (
      /\b(?:nimmt|schlägt)(?:\s+\S+){0,6}\s+auf\s+[a-h][1-8]/iu.test(claim.text)
      && !moves.some((move) => move.capture)
    ) {
      issues.push(`${field}: unbelegter Schlagzug`);
    }
  }

  const comparison = positionEvidence.moveComparison;
  const playedLine = positionEvidence.verifiedLines?.find(
    (line) => line.moves?.[0]?.uci === positionEvidence.playedMove?.uci,
  );
  const reply = playedLine?.moves?.[1];
  const recapture = playedLine?.moves?.[2];
  if (
    /\bverlierst du Material\b/iu.test(text)
    && !(comparison?.played?.materialBalanceDelta < 0)
  ) {
    issues.push("unbelegter Materialverlust");
  }
  for (const match of text.matchAll(/\bstellst .{0,40} auf ([a-h][1-8]) ein\b/giu)) {
    const square = match[1];
    if (
      !reply?.capture
      || reply.capture.square !== square
      || !(comparison?.played?.materialBalanceDelta < 0)
      || (recapture?.capture && recapture.to === reply.to)
    ) {
      issues.push("unbelegter Einsteller");
    }
  }
  if (
    /\b(?:einzige(?:r|n)? Zug|erzwungen)\b/iu.test(text)
    && comparison?.onlyMove !== true
  ) {
    issues.push("unbelegter Nur-Zug");
  }
  return [...new Set(issues)];
}

function explanationCompletenessIssues(text, positionEvidence) {
  const move = positionEvidence?.playedMove;
  const normalized = String(text || "");
  const issues = [];
  if (move?.capture && !/\b(?:schlägt|nimmt|tauscht|gewinnt|erobert)\b/iu.test(normalized)) {
    issues.push("schlagzug_nicht_erklaert");
  }
  if (move?.givesCheckmate) {
    if (!/\b(?:matt|schachmatt)\b/iu.test(normalized)) {
      issues.push("matt_nicht_erklaert");
    }
  } else if (move?.givesCheck && !/\bschach\b/iu.test(normalized)) {
    issues.push("schach_nicht_erklaert");
  }
  return issues;
}

function isConcretePositiveExplanation(text, positionEvidence, quality) {
  if (!["brilliant", "best", "excellent"].includes(quality)) return false;
  const move = positionEvidence?.playedMove;
  const normalized = String(text || "");
  if (move?.givesCheckmate) return /\b(?:matt|schachmatt)\b/iu.test(normalized);
  if (move?.givesCheck) return /\bschach\b/iu.test(normalized);
  if (move?.capture) {
    return /\b(?:schlägt|nimmt|tauscht|gewinnt|erobert)\b/iu.test(normalized)
      && new RegExp(`\\b${move.to}\\b`, "iu").test(normalized);
  }
  return /\b(?:entwickelst|rochiert|Zentrum|verhindert|schützt|kontrolliert)\b/iu.test(normalized)
    && (/\b[a-h][1-8]\b/u.test(normalized) || /\b(?:rochiert|Zentrum)\b/iu.test(normalized));
}

function emptyGroup() {
  return {
    evaluated: 0,
    passed: 0,
    failed: 0,
    languageFailures: 0,
    semanticFailures: 0,
    completenessFailures: 0,
    verificationFailures: 0,
    unsupportedMoveFailures: 0,
    unsupportedBoardClaimFailures: 0,
    unsupportedEvaluationFailures: 0,
    maximumSentences: 0,
  };
}

function finalizeGroup(group) {
  return {
    ...group,
    passPercent: percentage(group.passed, group.evaluated),
  };
}

function failureExample({
  category,
  issues,
  sample,
  rating = null,
  quality = "",
  lossCp = null,
  san = "",
  text = "",
}) {
  return {
    caseId: sha256(`${sample.phase}|${sample.fen}|${sample.playedUci}|${rating}`).slice(0, 16),
    category,
    issues: [...new Set(issues)],
    phase: sample.phase,
    rating,
    quality,
    lossCp,
    move: san || sample.playedUci,
    fen: sample.fen,
    text: String(text || "").slice(0, 1_200),
  };
}

function recordIssues(counts, issues) {
  issues.forEach((issue) => {
    counts[issue] = (counts[issue] || 0) + 1;
  });
}

async function analyzeSample(sample, engine, depth) {
  const game = new Chess(sample.fen);
  const legalMoves = game.moves({ verbose: true });
  const topLines = await engine.search(sample.fen, { depth });
  if (topLines.length === 0) throw new Error("Stockfish lieferte keine Hauptvariante.");
  let playedLine = topLines.find((line) => line.uci === sample.playedUci) || null;
  if (!playedLine) {
    playedLine = (await engine.search(sample.fen, {
      depth,
      searchMove: sample.playedUci,
    }))[0] || null;
  }
  if (!playedLine) throw new Error("Stockfish lieferte keine Linie für den gespielten Zug.");

  const candidates = [];
  const usedMoves = new Set();
  for (const line of [...topLines, playedLine]) {
    if (usedMoves.has(line.uci)) continue;
    usedMoves.add(line.uci);
    candidates.push({ ...line, rank: candidates.length + 1 });
  }
  const best = candidates[0];
  const played = candidates.find((line) => line.uci === sample.playedUci);
  const lossCp = Math.max(0, evaluationCp(best.evaluation) - evaluationCp(played.evaluation));
  const quality = best.uci === sample.playedUci
    ? "best"
    : classifyCentipawnLoss(lossCp);
  let positionEvidence = buildPositionEvidence({
    fenBefore: sample.fen,
    playedUci: sample.playedUci,
    candidateLines: candidates,
    playedLine: played,
    lossCp,
    quality,
    engineDepth: depth,
    onlyMoveEvidence: legalMoves.length === 1
      ? { type: "only_legal_move", legalMoveCount: 1 }
      : null,
    pvLimit: 8,
  });
  if (positionEvidence?.valid && !positionEvidence.moveComparison) {
    positionEvidence = buildPositionEvidence({
      fenBefore: sample.fen,
      playedUci: sample.playedUci,
      candidateLines: candidates,
      playedLine: {
        evaluation: played.evaluation,
        pvUci: [sample.playedUci],
      },
      lossCp,
      quality,
      engineDepth: depth,
      onlyMoveEvidence: legalMoves.length === 1
        ? { type: "only_legal_move", legalMoveCount: 1 }
        : null,
      pvLimit: 8,
    });
  }
  if (
    !positionEvidence?.valid
    || !(positionEvidence.verifiedLines || []).every(
      (line) => line.legal === true && line.complete === true,
    )
  ) {
    return {
      valid: false,
      issues: positionEvidence?.errors || ["positionEvidence ist ungültig."],
      lossCp,
      quality,
      positionEvidence,
    };
  }

  const lines = positionEvidence.candidateLines.map((line) => ({
    rank: line.rank,
    depth,
    evaluation: line.evaluation,
    bestMove: { uci: line.pvUci[0], san: line.pvSan[0] },
    pv: { uci: line.pvUci, san: line.pvSan },
  }));
  const verifiedPlayed = positionEvidence.verifiedLines.find(
    (line) => line.moves?.[0]?.uci === sample.playedUci,
  );
  const verifiedPlayedMoves = verifiedPlayed?.moves?.length > 0
    ? verifiedPlayed.moves
    : [positionEvidence.playedMove];
  const bestLine = lines[0];
  const engineContext = {
    source: "stockfish",
    kind: "move_review",
    fen: sample.fen,
    depth,
    lines,
    bestMove: bestLine.bestMove,
    primaryVariation: bestLine.pv,
    playedLine: {
      evaluation: played.evaluation,
      uci: verifiedPlayedMoves.map((move) => move.uci),
      san: verifiedPlayedMoves.map((move) => move.san),
    },
    moveReview: {
      playedMove: {
        uci: sample.playedUci,
        san: positionEvidence.playedMove.san,
      },
      bestMove: bestLine.bestMove,
      quality,
      lossCp,
      pv: bestLine.pv,
      onlyMove: positionEvidence.moveComparison.onlyMove,
      onlyMoveEvidence: positionEvidence.moveComparison.onlyMoveEvidence,
    },
  };
  return {
    valid: true,
    legalMoveCount: legalMoves.length,
    lossCp,
    quality,
    positionEvidence,
    engineContext,
  };
}

export async function stressTestCoachGames({
  games = 40,
  positionsPerPhase = 10,
  depth = 4,
  maxPlies = 180,
  seed = DEFAULT_SEED,
  maxFailureExamples = 12,
  maxPositiveExamples = 12,
  ratings = COACH_STRESS_RATINGS,
  everyPly = false,
  workers = 1,
  onProgress = null,
} = {}) {
  const startedAt = Date.now();
  const selectedRatings = [...new Set((Array.isArray(ratings) ? ratings : [ratings])
    .map((rating) => Number.parseInt(rating, 10))
    .filter((rating) => COACH_STRESS_RATINGS.includes(rating)))];
  if (selectedRatings.length === 0) selectedRatings.push(800);
  const generation = generateRandomPositionSample({
    games,
    positionsPerPhase,
    maxPlies,
    seed,
    everyPly,
  });
  const totals = {
    selectedPositions: generation.selected.length,
    analyzedPositions: 0,
    outputs: 0,
    passedOutputs: 0,
    failedOutputs: 0,
    evidenceFailures: 0,
    nullExplanations: 0,
    verificationFailures: 0,
    languageFailures: 0,
    semanticFailures: 0,
    completenessFailures: 0,
    unsupportedMoveFailures: 0,
    unsupportedBoardClaimFailures: 0,
    unsupportedEvaluationFailures: 0,
    phaseMismatches: 0,
  };
  const byRating = Object.fromEntries(
    selectedRatings.map((rating) => [rating, emptyGroup()]),
  );
  const byPhase = Object.fromEntries(
    COACH_STRESS_PHASES.map((phase) => [phase, emptyGroup()]),
  );
  const byQuality = {};
  const languageIssueCounts = {};
  const semanticIssueCounts = {};
  const completenessIssueCounts = {};
  const failureExamples = [];
  const positiveExamples = [];
  const workerCount = Math.max(1, Math.min(8, Number.parseInt(workers, 10) || 1));
  const engines = Array.from({ length: workerCount }, () => new LocalStockfish());
  let nextIndex = 0;
  let completedPositions = 0;

  const addFailureExample = (example) => {
    if (failureExamples.length < maxFailureExamples) failureExamples.push(example);
  };

  const markCompleted = () => {
    completedPositions += 1;
    onProgress?.({
      completed: completedPositions,
      total: generation.selected.length,
      failedOutputs: totals.failedOutputs,
    });
  };

  const runWorker = async (engine) => {
    while (true) {
      const index = nextIndex;
      nextIndex += 1;
      if (index >= generation.selected.length) return;
      const sample = generation.selected[index];
      let analyzed;
      try {
        analyzed = await analyzeSample(sample, engine, depth);
      } catch (error) {
        analyzed = { valid: false, issues: [error?.message || String(error)] };
      }
      totals.analyzedPositions += 1;
      if (!analyzed.valid) {
        totals.evidenceFailures += 1;
        addFailureExample(failureExample({
          category: "evidence",
          issues: analyzed.issues,
          sample,
          quality: analyzed.quality,
          lossCp: analyzed.lossCp,
        }));
        markCompleted();
        continue;
      }

      const { positionEvidence, engineContext, lossCp, quality } = analyzed;
      const actualPhase = phaseFromPositionEvidence(positionEvidence);
      if (actualPhase !== sample.phase) totals.phaseMismatches += 1;
      byQuality[quality] = (byQuality[quality] || 0) + 1;

      for (const rating of selectedRatings) {
        totals.outputs += 1;
        byRating[rating].evaluated += 1;
        byPhase[sample.phase].evaluated += 1;
        let outputFailed = false;
        let outputText = "";
        const learnerProfile = learnerProfileForCoach({ rating });
        const explanation = buildLocalMoveExplanation({
          positionEvidence,
          engineContext,
          learnerProfile,
        });
        if (!explanation) {
          totals.nullExplanations += 1;
          outputFailed = true;
          addFailureExample(failureExample({
            category: "null_explanation",
            issues: ["Der lokale Coach lieferte keine Erklärung."],
            sample,
            rating,
            quality,
            lossCp,
          }));
        } else {
          const text = moveExplanationToMarkdown(explanation, { deep: true });
          outputText = text;
          const checked = verifyMoveExplanation(explanation, {
            positionEvidence: buildTrustedExplanationEvidence({
              positionEvidence,
              engineContext,
            }),
            engineContext,
          });
          if (!checked.valid) {
            totals.verificationFailures += 1;
            byRating[rating].verificationFailures += 1;
            byPhase[sample.phase].verificationFailures += 1;
            outputFailed = true;
            addFailureExample(failureExample({
              category: "verification",
              issues: checked.errors,
              sample,
              rating,
              quality,
              lossCp,
              san: positionEvidence.playedMove.san,
              text,
            }));
          }

          const comparison = positionEvidence.moveComparison;
          const allMoves = verifiedMoves(positionEvidence);
          const language = validateCoachLanguage(text, {
            rating,
            phase: actualPhase,
            practicallyEquivalent: (
              comparison.explanationType === "equivalent"
              || comparison.alternative?.relation === "equivalent"
            ),
            multipleGoodOpeningMoves: actualPhase === "opening" && !comparison.onlyMove,
            evidence: {
              onlyMove: comparison.onlyMove,
              mate: allMoves.some((move) => move.givesCheckmate),
              materialLoss: Boolean(
                comparison.played.materialBalanceDelta < 0
                || comparison.played.opponentBestReply?.capture
              ),
              significantLoss: lossCp >= 140,
              severeLoss: lossCp >= 300,
            },
            strict: true,
          });
          const languageIssues = [...language.errors, ...language.warnings]
            .map((issue) => issue.id);
          byRating[rating].maximumSentences = Math.max(
            byRating[rating].maximumSentences,
            language.analysis.metrics.sentences,
          );
          byPhase[sample.phase].maximumSentences = Math.max(
            byPhase[sample.phase].maximumSentences,
            language.analysis.metrics.sentences,
          );
          if (!language.valid) {
            totals.languageFailures += 1;
            byRating[rating].languageFailures += 1;
            byPhase[sample.phase].languageFailures += 1;
            recordIssues(languageIssueCounts, languageIssues);
            outputFailed = true;
            addFailureExample(failureExample({
              category: "language",
              issues: languageIssues,
              sample,
              rating,
              quality,
              lossCp,
              san: positionEvidence.playedMove.san,
              text,
            }));
          }

          const semanticIssues = directSemanticIssues(
            explanation,
            text,
            positionEvidence,
          );
          if (semanticIssues.length > 0) {
            totals.semanticFailures += 1;
            byRating[rating].semanticFailures += 1;
            byPhase[sample.phase].semanticFailures += 1;
            recordIssues(semanticIssueCounts, semanticIssues);
            outputFailed = true;
            addFailureExample(failureExample({
              category: "semantics",
              issues: semanticIssues,
              sample,
              rating,
              quality,
              lossCp,
              san: positionEvidence.playedMove.san,
              text,
            }));
          }

          const completenessIssues = explanationCompletenessIssues(
            text,
            positionEvidence,
          );
          if (completenessIssues.length > 0) {
            totals.completenessFailures += 1;
            byRating[rating].completenessFailures += 1;
            byPhase[sample.phase].completenessFailures += 1;
            recordIssues(completenessIssueCounts, completenessIssues);
            outputFailed = true;
            addFailureExample(failureExample({
              category: "completeness",
              issues: completenessIssues,
              sample,
              rating,
              quality,
              lossCp,
              san: positionEvidence.playedMove.san,
              text,
            }));
          }

          const unsupportedMoves = findUnsupportedMoveTokens(text, engineContext);
          if (unsupportedMoves.length > 0) {
            totals.unsupportedMoveFailures += 1;
            byRating[rating].unsupportedMoveFailures += 1;
            byPhase[sample.phase].unsupportedMoveFailures += 1;
            outputFailed = true;
            addFailureExample(failureExample({
              category: "unsupported_moves",
              issues: unsupportedMoves,
              sample,
              rating,
              quality,
              lossCp,
              san: positionEvidence.playedMove.san,
              text,
            }));
          }

          const unsupportedBoardClaims = findUnsupportedBoardClaims(
            text,
            engineContext,
          );
          if (unsupportedBoardClaims.length > 0) {
            totals.unsupportedBoardClaimFailures += 1;
            byRating[rating].unsupportedBoardClaimFailures += 1;
            byPhase[sample.phase].unsupportedBoardClaimFailures += 1;
            outputFailed = true;
            addFailureExample(failureExample({
              category: "unsupported_board_claims",
              issues: unsupportedBoardClaims,
              sample,
              rating,
              quality,
              lossCp,
              san: positionEvidence.playedMove.san,
              text,
            }));
          }

          const unsupportedEvaluations = findUnsupportedEvaluationTokens(
            text,
            engineContext,
          );
          if (unsupportedEvaluations.length > 0) {
            totals.unsupportedEvaluationFailures += 1;
            byRating[rating].unsupportedEvaluationFailures += 1;
            byPhase[sample.phase].unsupportedEvaluationFailures += 1;
            outputFailed = true;
            addFailureExample(failureExample({
              category: "unsupported_evaluations",
              issues: unsupportedEvaluations,
              sample,
              rating,
              quality,
              lossCp,
              san: positionEvidence.playedMove.san,
              text,
            }));
          }
        }

        if (outputFailed) {
          totals.failedOutputs += 1;
          byRating[rating].failed += 1;
          byPhase[sample.phase].failed += 1;
        } else {
          totals.passedOutputs += 1;
          byRating[rating].passed += 1;
          byPhase[sample.phase].passed += 1;
          if (
            positiveExamples.length < maxPositiveExamples
            && isConcretePositiveExplanation(outputText, positionEvidence, quality)
          ) {
            positiveExamples.push(failureExample({
              category: "positive",
              issues: ["Alle automatischen Qualitätsprüfungen bestanden."],
              sample,
              rating,
              quality,
              lossCp,
              san: positionEvidence.playedMove.san,
              text: outputText,
            }));
          }
        }
      }

      markCompleted();
    }
  };

  try {
    await Promise.all(engines.map((engine) => runWorker(engine)));
  } finally {
    engines.forEach((engine) => engine.close());
  }

  const coverageReady = generation.summary.coverage.every(
    (row) => row.selectedPositions === row.requestedPositions,
  );
  const safetyReady = (
    totals.evidenceFailures === 0
    && totals.nullExplanations === 0
    && totals.verificationFailures === 0
    && totals.semanticFailures === 0
    && totals.completenessFailures === 0
    && totals.unsupportedMoveFailures === 0
    && totals.unsupportedBoardClaimFailures === 0
    && totals.unsupportedEvaluationFailures === 0
    && totals.phaseMismatches === 0
  );
  const languageReady = totals.languageFailures === 0;
  const releaseReady = coverageReady && safetyReady && languageReady;

  return {
    schemaVersion: COACH_STRESS_SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    method: "deterministic_random_legal_games_with_local_stockfish",
    config: {
      games,
      positionsPerPhase,
      maxPlies,
      depth,
      seed: String(seed),
      ratings: [...COACH_STRESS_RATINGS],
      selectedRatings,
      everyPly: Boolean(everyPly),
      workers: workerCount,
      phases: [...COACH_STRESS_PHASES],
      paidAiCalls: 0,
      strictLanguageRules: true,
      maximumFailureExamples: maxFailureExamples,
      maximumPositiveExamples: maxPositiveExamples,
    },
    engine: {
      name: engines[0]?.engineName || "Stockfish",
      threads: 1,
      hashMb: 32,
      multiPv: 2,
      limit: { type: "depth", value: depth },
    },
    generation: generation.summary,
    totals: {
      ...totals,
      passPercent: percentage(totals.passedOutputs, totals.outputs),
    },
    byRating: Object.fromEntries(
      Object.entries(byRating).map(([rating, group]) => [rating, finalizeGroup(group)]),
    ),
    byPhase: Object.fromEntries(
      Object.entries(byPhase).map(([phase, group]) => [phase, finalizeGroup(group)]),
    ),
    byQuality,
    issueCounts: {
      language: languageIssueCounts,
      semantics: semanticIssueCounts,
      completeness: completenessIssueCounts,
    },
    gates: {
      coverageReady,
      safetyReady,
      languageReady,
      releaseReady,
      note: "Ein Zufallstest erhöht die messbare Sicherheit, beweist aber nicht jede denkbare Schachstellung.",
    },
    privacy: {
      rawGamesPersisted: false,
      playerIdentitiesPersisted: false,
      selectedPositionsPersisted: false,
      aggregateResultsOnly: true,
      failureExamplesMayContainFen: true,
    },
    failureExamples,
    positiveExamples,
    durationSeconds: Number(((Date.now() - startedAt) / 1000).toFixed(2)),
  };
}

function markdownTableRows(grouped) {
  return Object.entries(grouped).map(([name, row]) => (
    `| ${name} | ${row.evaluated} | ${row.passed} | ${row.failed} | ${row.passPercent.toFixed(2)} % | ${row.maximumSentences} |`
  ));
}

export function coachStressReportMarkdown(result) {
  const status = result.gates.releaseReady
    ? "Freigabeschwellen bestanden"
    : "Freigabeschwellen nicht bestanden";
  const issueLines = [
    ...Object.entries(result.issueCounts.language)
      .map(([issue, count]) => `- Sprache \`${issue}\`: ${count}`),
    ...Object.entries(result.issueCounts.semantics)
      .map(([issue, count]) => `- Brett-Semantik \`${issue}\`: ${count}`),
    ...Object.entries(result.issueCounts.completeness || {})
      .map(([issue, count]) => `- Erklärvollständigkeit \`${issue}\`: ${count}`),
  ];
  const failureLines = result.failureExamples.length === 0
    ? ["Keine Fehlerbeispiele vorhanden."]
    : result.failureExamples.flatMap((example) => [
      `### ${example.category}: ${example.caseId}`,
      "",
      `- Phase/Elo: ${example.phase} / ${example.rating ?? "–"}`,
      `- Zug: ${example.move}; Qualität: ${example.quality || "–"}; Verlust: ${example.lossCp ?? "–"} cp`,
      `- Fehler: ${example.issues.join(", ")}`,
      `- FEN: \`${example.fen}\``,
      "",
      example.text ? `> ${example.text.replace(/\n+/g, " ")}` : "",
      "",
    ]);
  const positiveLines = (result.positiveExamples || []).length === 0
    ? ["Keine besonders guten Beispiele in dieser Stichprobe gefunden."]
    : result.positiveExamples.flatMap((example) => [
      `### ${example.move} · ${example.phase} · ${example.rating} Elo`,
      "",
      `- Qualität: ${example.quality}; Verlust: ${example.lossCp ?? "–"} cp`,
      `- FEN: \`${example.fen}\``,
      "",
      example.text ? `> ${example.text.replace(/\n+/g, " ")}` : "",
      "",
    ]);
  const ratings = result.config?.selectedRatings || result.config?.ratings || [];
  const selectionDescription = result.config?.everyPly
    ? "jeden erzeugten Halbzug"
    : "je Partie höchstens eine Stellung pro Phase";
  return [
    "# Randomisierter Stockfish-Stresstest des Coaches",
    "",
    `**Status: ${status}.**`,
    "",
    `Der Test erzeugt deterministisch legale Zufallspartien, prüft ${selectionDescription} und bewertet die sichtbaren Coach-Texte für ${ratings.join(", ")} Elo. Stockfish läuft ausschließlich lokal; es entstehen keine API-Kosten.`,
    "",
    "## Ergebnis",
    "",
    `- Erzeugte Partien: ${result.generation.gamesGenerated}`,
    `- Erzeugte Halbzüge: ${result.generation.generatedPlies.toLocaleString("de-DE")}`,
    `- Analysierte Stellungen: ${result.totals.analyzedPositions}`,
    `- Coach-Ausgaben: ${result.totals.outputs}`,
    `- Bestanden: ${result.totals.passedOutputs}/${result.totals.outputs} (${result.totals.passPercent.toFixed(2)} %)`,
    `- Auswahl-Hash: \`${result.generation.selectionHash}\``,
    `- Engine: ${result.engine.name}, Tiefe ${result.engine.limit.value}, MultiPV ${result.engine.multiPv}`,
    `- Laufzeit: ${result.durationSeconds.toFixed(2)} Sekunden`,
    "",
    "| Prüfung | Fehler |",
    "| --- | ---: |",
    `| Brettbelege | ${result.totals.evidenceFailures} |`,
    `| Fehlende Erklärungen | ${result.totals.nullExplanations} |`,
    `| Struktur/Evidenz-Verifikation | ${result.totals.verificationFailures} |`,
    `| Sprachregeln | ${result.totals.languageFailures} |`,
    `| Direkte Brett-Semantik | ${result.totals.semanticFailures} |`,
    `| Fehlende Kerninformation | ${result.totals.completenessFailures || 0} |`,
    `| Unbelegte Zugnotation | ${result.totals.unsupportedMoveFailures} |`,
    `| Unbelegte Brettbehauptung | ${result.totals.unsupportedBoardClaimFailures} |`,
    `| Unbelegte Bewertungszahl | ${result.totals.unsupportedEvaluationFailures} |`,
    `| Phasenabweichungen | ${result.totals.phaseMismatches} |`,
    "",
    "## Nach Elo",
    "",
    "| Elo | Fälle | Bestanden | Fehler | Quote | Max. Sätze |",
    "| ---: | ---: | ---: | ---: | ---: | ---: |",
    ...markdownTableRows(result.byRating),
    "",
    "## Nach Phase",
    "",
    "| Phase | Fälle | Bestanden | Fehler | Quote | Max. Sätze |",
    "| --- | ---: | ---: | ---: | ---: | ---: |",
    ...markdownTableRows(result.byPhase),
    "",
    "## Abdeckung",
    "",
    "| Phase | Partien erreicht | Verfügbare Stellungen | Angefordert | Getestet |",
    "| --- | ---: | ---: | ---: | ---: |",
    ...result.generation.coverage.map((row) => (
      `| ${row.phase} | ${row.gamesReachingPhase} | ${row.availableUniquePositions} | ${row.requestedPositions} | ${row.selectedPositions} |`
    )),
    "",
    "## Fehlerarten",
    "",
    ...(issueLines.length > 0 ? issueLines : ["Keine Fehlerarten gefunden."]),
    "",
    "## Fehlerbeispiele",
    "",
    ...failureLines,
    "",
    "## Besonders gute Erklärungen",
    "",
    ...positiveLines,
    "",
    "## Datenschutz",
    "",
    "Der Report speichert keine Rohpartien, Spielernamen oder Partiekennungen. Nur Summen und im Fehlerfall maximal wenige FEN-basierte Reproduktionsbeispiele werden ausgegeben.",
    "",
    `> ${result.gates.note}`,
    "",
  ].join("\n");
}

async function writeReport(path, content) {
  const target = resolve(path);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, content, "utf8");
  return target;
}

function usage() {
  return [
    "Usage: node scripts/stress-test-coach-games.mjs [options]",
    "",
    "Options:",
    "  --games=N                 erzeugte Zufallspartien (Default: 40)",
    "  --positions-per-phase=N   getestete Stellungen je Phase (Default: 10)",
    "  --depth=N                 lokale Stockfish-Tiefe (Default: 4)",
    "  --max-plies=N             maximales Partielimit (Default: 180)",
    `  --seed=VALUE              deterministischer Seed (Default: ${DEFAULT_SEED})`,
    "  --max-failures=N          maximale Fehlerbeispiele (Default: 12)",
    "  --positive-examples=N     maximale besonders gute Beispiele (Default: 12)",
    "  --ratings=800,1000        geprüfte Coach-Stufen (Default: alle)",
    "  --every-ply               jeden erzeugten Halbzug statt Phasenstichprobe prüfen",
    "  --workers=N                parallele lokale Stockfish-Prozesse (Default: 1)",
    "  --checkpoint=PATH          fortlaufender Fortschrittsstand als JSON",
    `  --json=PATH               JSON-Report (Default: ${DEFAULT_JSON_PATH})`,
    `  --markdown=PATH           Markdown-Report (Default: ${DEFAULT_MARKDOWN_PATH})`,
    "  --strict                  Exitcode 1, wenn eine Freigabeschwelle scheitert",
  ].join("\n");
}

async function main() {
  const argv = process.argv.slice(2);
  if (argv.includes("--help")) {
    process.stdout.write(`${usage()}\n`);
    return;
  }
  const options = {
    games: integerOption(argv, "games", 40, 3, 10_000),
    positionsPerPhase: integerOption(argv, "positions-per-phase", 10, 1, 1_000),
    depth: integerOption(argv, "depth", 4, 1, 30),
    maxPlies: integerOption(argv, "max-plies", 180, 20, 400),
    seed: option(argv, "seed", DEFAULT_SEED),
    maxFailureExamples: integerOption(argv, "max-failures", 12, 0, 100),
    maxPositiveExamples: integerOption(argv, "positive-examples", 12, 0, 100),
    ratings: option(argv, "ratings", COACH_STRESS_RATINGS.join(","))
      .split(",")
      .map((rating) => Number.parseInt(rating.trim(), 10)),
    everyPly: argv.includes("--every-ply"),
    workers: integerOption(argv, "workers", 1, 1, 8),
  };
  const checkpointPath = option(argv, "checkpoint", "");
  const progressStep = options.everyPly ? 250 : 10;
  let checkpointWrites = Promise.resolve();
  const result = await stressTestCoachGames({
    ...options,
    onProgress: ({ completed, total, failedOutputs }) => {
      if (completed % progressStep === 0 || completed === total) {
        process.stdout.write(
          `[Coach stress] ${completed}/${total} Stellungen · ${failedOutputs} fehlgeschlagene Ausgaben\n`,
        );
        if (checkpointPath) {
          checkpointWrites = checkpointWrites.then(() => writeReport(
            checkpointPath,
            `${JSON.stringify({
              status: completed === total ? "analysis_complete" : "running",
              completed,
              total,
              failedOutputs,
              updatedAt: new Date().toISOString(),
            }, null, 2)}\n`,
          ));
        }
      }
    },
  });
  await checkpointWrites;
  const jsonPath = await writeReport(
    option(argv, "json", DEFAULT_JSON_PATH),
    `${JSON.stringify(result, null, 2)}\n`,
  );
  const markdownPath = await writeReport(
    option(argv, "markdown", DEFAULT_MARKDOWN_PATH),
    coachStressReportMarkdown(result),
  );
  if (checkpointPath) {
    await writeReport(checkpointPath, `${JSON.stringify({
      status: "completed",
      completed: result.totals.analyzedPositions,
      total: result.totals.selectedPositions,
      failedOutputs: result.totals.failedOutputs,
      jsonReport: jsonPath,
      markdownReport: markdownPath,
      updatedAt: new Date().toISOString(),
    }, null, 2)}\n`);
  }
  process.stdout.write(
    `[Coach stress] ${result.totals.passedOutputs}/${result.totals.outputs} bestanden · JSON: ${jsonPath} · Markdown: ${markdownPath}\n`,
  );
  if (argv.includes("--strict") && !result.gates.releaseReady) process.exitCode = 1;
}

if (import.meta.url === new URL(process.argv[1], "file:").href) {
  main().catch((error) => {
    process.stderr.write(`${error?.stack || error}\n`);
    process.exitCode = 1;
  });
}
