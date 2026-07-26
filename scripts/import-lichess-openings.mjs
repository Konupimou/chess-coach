import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { Chess } from "chess.js";
import { normalizeFenToEpd } from "../openingRecognition.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SOURCE_DIR = path.join(ROOT, "data", "openings", "source");
const OUTPUT_DIR = path.join(ROOT, "public", "data", "openings");
const OUTPUT_FILE = path.join(OUTPUT_DIR, "openings.runtime.json");
const REPORT_FILE = path.join(OUTPUT_DIR, "import-report.json");
const FILES = ["a.tsv", "b.tsv", "c.tsv", "d.tsv", "e.tsv"];
const UCI_PATTERN = /^[a-h][1-8][a-h][1-8][qrbn]?$/;
const manifest = JSON.parse(
  await readFile(path.join(SOURCE_DIR, "manifest.json"), "utf8"),
);
const SOURCE_COMMIT = manifest.commit;
const SOURCE_DATE = manifest.date;

function splitTsvLine(line) {
  const first = line.indexOf("\t");
  const second = line.indexOf("\t", first + 1);
  if (first < 0 || second < 0) return null;
  return [line.slice(0, first), line.slice(first + 1, second), line.slice(second + 1)];
}

function parsePgn(pgn) {
  const game = new Chess();
  game.loadPgn(pgn);
  const moves = game.history({ verbose: true });
  const uci = moves.map((move) => `${move.from}${move.to}${move.promotion || ""}`.toLowerCase());
  if (uci.length === 0 || uci.some((move) => !UCI_PATTERN.test(move))) {
    throw new Error("Die PGN-Zugfolge ergibt keine gültige UCI-Folge.");
  }
  return { uci, epd: normalizeFenToEpd(game.fen()) };
}

const entries = [];
const positions = {};
const sequences = {};
const sequencePrefixes = new Set();
const rejected = [];
const duplicates = [];
const seen = new Set();
const perFile = {};

for (const filename of FILES) {
  const source = await readFile(path.join(SOURCE_DIR, filename), "utf8");
  const checksum = createHash("sha256").update(source).digest("hex");
  if (checksum !== manifest.files?.[filename]) {
    throw new Error(`${filename}: Prüfsumme passt nicht zum gepinnten Quellenstand.`);
  }
  const lines = source.replace(/\r/g, "").split("\n").filter(Boolean);
  if (lines.shift() !== "eco\tname\tpgn") {
    throw new Error(`${filename}: unerwartete TSV-Kopfzeile.`);
  }
  let accepted = 0;
  for (let index = 0; index < lines.length; index += 1) {
    const row = splitTsvLine(lines[index]);
    if (!row) {
      rejected.push({ file: filename, line: index + 2, reason: "Ungültige TSV-Zeile" });
      continue;
    }
    const [eco, name, pgn] = row.map((value) => value.trim());
    try {
      if (!/^[A-E]\d{2}$/.test(eco)) throw new Error("Ungültiger ECO-Code.");
      if (!name || !pgn) throw new Error("Name oder PGN fehlt.");
      const { uci, epd } = parsePgn(pgn);
      const sequence = uci.join(" ");
      const key = `${eco}\t${name}\t${sequence}\t${epd}`;
      if (seen.has(key)) {
        duplicates.push({ file: filename, line: index + 2, eco, name });
        continue;
      }
      seen.add(key);
      const id = entries.length;
      entries.push([eco, name, sequence]);
      (positions[epd] ||= []).push(id);
      (sequences[sequence] ||= []).push(id);
      for (let ply = 1; ply <= uci.length; ply += 1) {
        sequencePrefixes.add(uci.slice(0, ply).join(" "));
      }
      accepted += 1;
    } catch (error) {
      rejected.push({
        file: filename,
        line: index + 2,
        eco,
        name,
        reason: error?.message || "Ungültiger Datensatz",
      });
    }
  }
  perFile[filename] = accepted;
}

const runtime = {
  version: 1,
  source: {
    id: "lichess-chess-openings",
    repository: "https://github.com/lichess-org/chess-openings",
    commit: SOURCE_COMMIT,
    date: SOURCE_DATE,
    license: "CC0-1.0",
  },
  entries,
  positions,
  sequences,
  sequencePrefixes: [...sequencePrefixes].sort(),
};

await mkdir(OUTPUT_DIR, { recursive: true });
await writeFile(OUTPUT_FILE, `${JSON.stringify(runtime)}\n`);
const report = {
  generatedForSourceDate: SOURCE_DATE,
  sourceCommit: SOURCE_COMMIT,
  sourceDate: SOURCE_DATE,
  sourceRows: Object.values(perFile).reduce((sum, value) => sum + value, 0)
    + rejected.length + duplicates.length,
  imported: entries.length,
  rejected: rejected.length,
  duplicates: duplicates.length,
  uniquePositions: Object.keys(positions).length,
  uniqueSequences: Object.keys(sequences).length,
  sequencePrefixes: sequencePrefixes.size,
  perFile,
  rejectedRows: rejected,
  duplicateRows: duplicates,
};
await writeFile(REPORT_FILE, `${JSON.stringify(report, null, 2)}\n`);

console.log(`Lichess Chess Openings ${SOURCE_COMMIT}`);
console.log(`${entries.length} Einträge importiert, ${rejected.length} verworfen, ${duplicates.length} Duplikate.`);
console.log(`${Object.keys(positions).length} Positionsschlüssel und ${sequencePrefixes.size} Zugfolgen-Präfixe erzeugt.`);
console.log(`Runtime: ${path.relative(ROOT, OUTPUT_FILE)}`);
console.log(`Bericht: ${path.relative(ROOT, REPORT_FILE)}`);
