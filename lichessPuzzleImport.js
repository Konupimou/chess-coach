import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { Readable, Transform } from "node:stream";
import { createInterface } from "node:readline";
import { Chess } from "chess.js";
import { Decompress } from "fzstd";

export const LICHESS_PUZZLE_SOURCE_URL =
  "https://database.lichess.org/lichess_db_puzzle.csv.zst";

export const LICHESS_PUZZLE_REMOTE_PATHS = Object.freeze([
  "/lichess_db_puzzle.csv.zst",
]);

export const LICHESS_PUZZLE_THEMES = Object.freeze([
  "pawnEndgame",
  "rookEndgame",
  "bishopEndgame",
  "knightEndgame",
  "deflection",
  "capturingDefender",
  "backRankMate",
  "defensiveMove",
  "equality",
  "sacrifice",
]);

export const DEFAULT_LICHESS_PUZZLE_FILTERS = Object.freeze({
  minRating: 600,
  maxRating: 1100,
  maxRatingDeviation: 100,
  minPopularity: 60,
  perThemeQuota: 100,
});

const UCI_MOVE_PATTERN = /^[a-h][1-8][a-h][1-8][qrbn]?$/;
const CSV_COLUMNS = Object.freeze([
  "PuzzleId",
  "FEN",
  "Moves",
  "Rating",
  "RatingDeviation",
  "Popularity",
  "NbPlays",
  "Themes",
  "GameUrl",
  "OpeningTags",
]);
/** Decode every concatenated frame, including Lichess' skippable metadata. */
export function createZstdDecompressStream() {
  let decoder = null;
  return new Transform({
    construct(callback) {
      decoder = new Decompress((chunk) => {
        if (chunk.length > 0) this.push(Buffer.from(chunk));
      });
      callback();
    },
    transform(chunk, _encoding, callback) {
      try {
        decoder.push(chunk, false);
        callback();
      } catch (error) {
        callback(error);
      }
    },
    flush(callback) {
      try {
        decoder.push(new Uint8Array(0), true);
        callback();
      } catch (error) {
        callback(error);
      }
    },
  });
}

function finiteInteger(value, name) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) throw new Error(`${name} muss eine ganze Zahl sein.`);
  return parsed;
}

function boundedInteger(value, name, { min = 0 } = {}) {
  const parsed = finiteInteger(value, name);
  if (parsed < min) throw new Error(`${name} muss mindestens ${min} sein.`);
  return parsed;
}

/** Parse one RFC 4180-style CSV row without retaining source attribution fields. */
export function splitCsvRow(line) {
  const values = [];
  let current = "";
  let quoted = false;

  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    if (quoted) {
      if (character === '"' && line[index + 1] === '"') {
        current += '"';
        index += 1;
      } else if (character === '"') {
        quoted = false;
      } else {
        current += character;
      }
    } else if (character === ",") {
      values.push(current);
      current = "";
    } else if (character === '"') {
      quoted = true;
    } else {
      current += character;
    }
  }

  if (quoted) throw new Error("Nicht abgeschlossene CSV-Anführungszeichen.");
  values.push(current);
  return values;
}

export function isLichessPuzzleHeader(line) {
  try {
    const columns = splitCsvRow(line.replace(/^\uFEFF/, ""));
    return columns[0] === CSV_COLUMNS[0] && columns[1] === CSV_COLUMNS[1];
  } catch {
    return false;
  }
}

/**
 * Read only the fields needed for selection and validation. PuzzleId, GameUrl,
 * OpeningTags and game/player metadata are deliberately discarded here.
 */
export function parseLichessPuzzleRow(line) {
  const columns = splitCsvRow(line.replace(/\r$/, ""));
  if (columns.length < 9) throw new Error("Die Lichess-Zeile hat zu wenige Spalten.");

  const fen = String(columns[1] || "").trim();
  const moves = String(columns[2] || "").trim().split(/\s+/).filter(Boolean);
  const rating = finiteInteger(columns[3], "Rating");
  const ratingDeviation = boundedInteger(columns[4], "RatingDeviation");
  const popularity = finiteInteger(columns[5], "Popularity");
  const themes = [...new Set(
    String(columns[7] || "").trim().split(/\s+/).filter(Boolean),
  )].sort();

  if (!fen) throw new Error("FEN fehlt.");
  if (moves.length < 2 || moves.some((move) => !UCI_MOVE_PATTERN.test(move))) {
    throw new Error("Die Aufgabe braucht einen Startzug und mindestens einen gültigen Lösungszug.");
  }

  return { fen, moves, rating, ratingDeviation, popularity, themes };
}

function normalizeThemes(themes) {
  const requested = themes == null ? [...LICHESS_PUZZLE_THEMES] : [...new Set(themes)];
  if (requested.length === 0) throw new Error("Mindestens ein Thema ist erforderlich.");
  for (const theme of requested) {
    if (!LICHESS_PUZZLE_THEMES.includes(theme)) {
      throw new Error(`Nicht erlaubtes Lichess-Thema: ${theme}`);
    }
  }
  return LICHESS_PUZZLE_THEMES.filter((theme) => requested.includes(theme));
}

function normalizeThemeQuotas(themes, value) {
  if (value == null || typeof value === "number" || typeof value === "string") {
    const quota = boundedInteger(
      value ?? DEFAULT_LICHESS_PUZZLE_FILTERS.perThemeQuota,
      "perThemeQuota",
      { min: 1 },
    );
    return Object.fromEntries(themes.map((theme) => [theme, quota]));
  }
  if (typeof value !== "object" || Array.isArray(value)) {
    throw new Error("perThemeQuota muss eine Zahl oder eine Themen-Zuordnung sein.");
  }
  return Object.fromEntries(themes.map((theme) => [
    theme,
    boundedInteger(
      value[theme] ?? DEFAULT_LICHESS_PUZZLE_FILTERS.perThemeQuota,
      `perThemeQuota.${theme}`,
      { min: 1 },
    ),
  ]));
}

export function normalizeLichessPuzzleFilters(options = {}) {
  const themes = normalizeThemes(options.themes);
  const minRating = boundedInteger(
    options.minRating ?? DEFAULT_LICHESS_PUZZLE_FILTERS.minRating,
    "minRating",
  );
  const maxRating = boundedInteger(
    options.maxRating ?? DEFAULT_LICHESS_PUZZLE_FILTERS.maxRating,
    "maxRating",
  );
  if (minRating > maxRating) throw new Error("minRating darf nicht über maxRating liegen.");

  return {
    minRating,
    maxRating,
    maxRatingDeviation: boundedInteger(
      options.maxRatingDeviation ?? DEFAULT_LICHESS_PUZZLE_FILTERS.maxRatingDeviation,
      "maxRatingDeviation",
    ),
    minPopularity: finiteInteger(
      options.minPopularity ?? DEFAULT_LICHESS_PUZZLE_FILTERS.minPopularity,
      "minPopularity",
    ),
    themes,
    perThemeQuota: normalizeThemeQuotas(
      themes,
      options.perThemeQuota ?? DEFAULT_LICHESS_PUZZLE_FILTERS.perThemeQuota,
    ),
  };
}

export function puzzleFilterRejection(row, filters) {
  if (row.rating < filters.minRating || row.rating > filters.maxRating) return "rating";
  if (row.ratingDeviation > filters.maxRatingDeviation) return "ratingDeviation";
  if (row.popularity < filters.minPopularity) return "popularity";
  if (!row.themes.some((theme) => filters.themes.includes(theme))) return "theme";
  return "";
}

function playUciMove(game, uci) {
  const move = {
    from: uci.slice(0, 2),
    to: uci.slice(2, 4),
  };
  if (uci.length === 5) move.promotion = uci[4];
  try {
    return game.move(move);
  } catch {
    return null;
  }
}

/** Convert a source position into the position actually shown to the solver. */
export function prepareLichessPuzzle(row) {
  const game = new Chess();
  try {
    game.load(row.fen);
  } catch {
    throw new Error("Ungültige Quell-FEN.");
  }

  if (!playUciMove(game, row.moves[0])) {
    throw new Error("Der vorbereitende Lichess-Zug ist in der Quell-FEN nicht legal.");
  }
  const trainingFen = game.fen();
  const solution = row.moves.slice(1);
  for (const uci of solution) {
    if (!playUciMove(game, uci)) {
      throw new Error(`Illegaler Lösungszug: ${uci}`);
    }
  }

  const id = createHash("sha256")
    .update(`${trainingFen}\n${solution.join(" ")}`)
    .digest("hex")
    .slice(0, 16);
  return { id, trainingFen, solution };
}

function chooseTheme(themes, counts, quotas, order) {
  const available = themes.filter((theme) => (
    theme in quotas && counts[theme] < quotas[theme]
  ));
  available.sort((left, right) => {
    const leftFill = counts[left] / quotas[left];
    const rightFill = counts[right] / quotas[right];
    return leftFill - rightFill || order.indexOf(left) - order.indexOf(right);
  });
  return available[0] || "";
}

function allQuotasMet(counts, quotas) {
  return Object.keys(quotas).every((theme) => counts[theme] >= quotas[theme]);
}

function sortedObject(input) {
  return Object.fromEntries(Object.entries(input).sort(([left], [right]) => left.localeCompare(right)));
}

export function classifyLichessPuzzleSource(source) {
  if (typeof source !== "string" || !source.trim()) {
    throw new Error("Die Puzzle-Quelle muss ein nicht leerer Pfad oder eine URL sein.");
  }
  let url;
  try {
    url = new URL(source);
  } catch {
    if (!/\.csv(?:\.zst)?$/i.test(source)) {
      throw new Error("Lokale Puzzle-Quellen müssen auf .csv oder .csv.zst enden.");
    }
    return { kind: "file", zstd: source.toLowerCase().endsWith(".zst") };
  }
  if (url.protocol !== "https:") {
    throw new Error("Für entfernte Puzzle-Quellen ist ausschließlich HTTPS erlaubt.");
  }
  if (
    url.hostname !== "database.lichess.org"
    || url.username
    || url.password
    || url.search
    || url.hash
    || !LICHESS_PUZZLE_REMOTE_PATHS.includes(url.pathname)
  ) {
    throw new Error(
      "Entfernte Puzzle-Quellen müssen exakt aus der offiziellen Lichess-Puzzle-Datenbank stammen.",
    );
  }
  return { kind: "https", url, zstd: url.pathname.toLowerCase().endsWith(".zst") };
}

async function openPuzzleSource(source) {
  const descriptor = classifyLichessPuzzleSource(source);
  let raw;
  let abort;
  if (descriptor.kind === "https") {
    const controller = new AbortController();
    const response = await fetch(descriptor.url, {
      headers: { "user-agent": "chess-coach-lichess-puzzle-import/1" },
      signal: controller.signal,
    });
    try {
      classifyLichessPuzzleSource(response.url);
    } catch (error) {
      controller.abort();
      throw new Error(`Unsichere Weiterleitung der Puzzle-Quelle: ${error.message}`);
    }
    if (!response.ok || !response.body) {
      throw new Error(`Puzzle-Download fehlgeschlagen: HTTP ${response.status}`);
    }
    raw = Readable.fromWeb(response.body);
    abort = () => controller.abort();
  } else {
    raw = createReadStream(source);
    abort = () => {};
  }

  const input = descriptor.zstd
    ? raw.pipe(createZstdDecompressStream())
    : raw;
  return {
    input,
    close() {
      input.destroy();
      raw.destroy();
      abort();
    },
  };
}

/**
 * Stream a local CSV/CSV.ZST or official HTTPS file. The result contains no
 * upstream IDs, URLs, names, opening tags or source-game attribution.
 */
export async function importLichessPuzzles({ source, ...filterOptions } = {}) {
  if (!source) throw new Error("Eine lokale CSV/CSV.ZST oder HTTPS-Quelle ist erforderlich.");
  const filters = normalizeLichessPuzzleFilters(filterOptions);
  const countsByTheme = Object.fromEntries(filters.themes.map((theme) => [theme, 0]));
  const skipped = {};
  const seen = new Set();
  const entries = [];
  let rowsRead = 0;
  let stoppedAfterQuota = false;
  const opened = await openPuzzleSource(source);
  let sourceError = null;
  opened.input.on("error", (error) => {
    sourceError = error;
  });
  const lines = createInterface({ input: opened.input, crlfDelay: Infinity });

  const skip = (reason) => {
    skipped[reason] = (skipped[reason] || 0) + 1;
  };

  try {
    for await (const originalLine of lines) {
      const line = originalLine.replace(/^\uFEFF/, "").trim();
      if (!line || isLichessPuzzleHeader(line)) continue;
      rowsRead += 1;

      let row;
      try {
        row = parseLichessPuzzleRow(line);
      } catch {
        skip("malformed");
        continue;
      }
      const rejection = puzzleFilterRejection(row, filters);
      if (rejection) {
        skip(rejection);
        continue;
      }
      const theme = chooseTheme(row.themes, countsByTheme, filters.perThemeQuota, filters.themes);
      if (!theme) {
        skip("quota");
        continue;
      }

      let prepared;
      try {
        prepared = prepareLichessPuzzle(row);
      } catch {
        skip("illegal");
        continue;
      }
      if (seen.has(prepared.id)) {
        skip("duplicate");
        continue;
      }
      seen.add(prepared.id);
      countsByTheme[theme] += 1;
      entries.push({
        id: prepared.id,
        theme,
        themes: row.themes.filter((item) => filters.themes.includes(item)),
        rating: row.rating,
        trainingFen: prepared.trainingFen,
        solution: prepared.solution,
      });

      if (allQuotasMet(countsByTheme, filters.perThemeQuota)) {
        stoppedAfterQuota = true;
        break;
      }
    }
    if (sourceError) throw sourceError;
  } finally {
    lines.close();
    opened.close();
  }

  entries.sort((left, right) => (
    filters.themes.indexOf(left.theme) - filters.themes.indexOf(right.theme)
    || left.rating - right.rating
    || left.id.localeCompare(right.id)
  ));

  return {
    schema: "chess-coach.lichess-puzzles.v1",
    license: "CC0-1.0",
    sourceUrl: LICHESS_PUZZLE_SOURCE_URL,
    filters: {
      minRating: filters.minRating,
      maxRating: filters.maxRating,
      maxRatingDeviation: filters.maxRatingDeviation,
      minPopularity: filters.minPopularity,
      themes: filters.themes,
      perThemeQuota: filters.perThemeQuota,
    },
    counts: {
      rowsRead,
      accepted: entries.length,
      byTheme: countsByTheme,
      skipped: sortedObject(skipped),
      stoppedAfterQuota,
    },
    entries,
  };
}
