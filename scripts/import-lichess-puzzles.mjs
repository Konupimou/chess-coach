import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  LICHESS_PUZZLE_SOURCE_URL,
  LICHESS_PUZZLE_THEMES,
  importLichessPuzzles,
} from "../lichessPuzzleImport.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_OUTPUT = path.join(ROOT, "data", "knowledge", "lichess-puzzles.json");

function usage() {
  return [
    "Lichess-CC0-Puzzles für den Coach importieren",
    "",
    "Aufruf:",
    "  node scripts/import-lichess-puzzles.mjs <datei.csv|datei.csv.zst|https-url> [Optionen]",
    "",
    "Optionen:",
    "  --output <datei>                 Ziel (Standard: data/knowledge/lichess-puzzles.json)",
    "  --min-rating <zahl>              Standard: 600",
    "  --max-rating <zahl>              Standard: 1100",
    "  --max-rating-deviation <zahl>    Standard: 100",
    "  --min-popularity <zahl>          Standard: 60",
    "  --per-theme-quota <zahl>         Standard: 100",
    `  --themes <liste>                 ${LICHESS_PUZZLE_THEMES.join(",")}`,
    "  --theme-quota <thema=zahl>       Abweichendes Limit; mehrfach möglich",
    "  --help",
    "",
    `Offizielle Quelle: ${LICHESS_PUZZLE_SOURCE_URL}`,
  ].join("\n");
}

function nextValue(args, index, option) {
  const value = args[index + 1];
  if (!value || value.startsWith("--")) throw new Error(`${option} braucht einen Wert.`);
  return value;
}

export function parsePuzzleImportArguments(args) {
  if (args.includes("--help")) return { help: true };
  const options = { perThemeQuota: undefined };
  let source = "";
  let output = DEFAULT_OUTPUT;
  const themeQuotas = {};

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (!argument.startsWith("--")) {
      if (source) throw new Error("Es ist nur eine Puzzle-Quelle erlaubt.");
      source = argument;
      continue;
    }
    const value = nextValue(args, index, argument);
    index += 1;
    if (argument === "--output") output = path.resolve(value);
    else if (argument === "--min-rating") options.minRating = value;
    else if (argument === "--max-rating") options.maxRating = value;
    else if (argument === "--max-rating-deviation") options.maxRatingDeviation = value;
    else if (argument === "--min-popularity") options.minPopularity = value;
    else if (argument === "--per-theme-quota") options.perThemeQuota = value;
    else if (argument === "--themes") options.themes = value.split(",").map((item) => item.trim()).filter(Boolean);
    else if (argument === "--theme-quota") {
      const separator = value.indexOf("=");
      if (separator < 1) throw new Error("--theme-quota erwartet thema=zahl.");
      themeQuotas[value.slice(0, separator)] = value.slice(separator + 1);
    } else throw new Error(`Unbekannte Option: ${argument}`);
  }

  if (!source) throw new Error("Eine lokale CSV/CSV.ZST oder HTTPS-Quelle fehlt.");
  if (Object.keys(themeQuotas).length > 0) {
    const themes = options.themes ?? LICHESS_PUZZLE_THEMES;
    const missingThemes = themes.filter((theme) => !(theme in themeQuotas));
    if (missingThemes.length > 0 && options.perThemeQuota == null) {
      throw new Error(
        `Explizite Quoten fehlen für: ${missingThemes.join(", ")}. `
        + "Setze alle Themen oder zusätzlich --per-theme-quota.",
      );
    }
    const fallback = options.perThemeQuota;
    options.perThemeQuota = Object.fromEntries(themes.map((theme) => [
      theme,
      themeQuotas[theme] ?? fallback,
    ]));
  }
  return { source, output, options };
}

async function main() {
  const parsed = parsePuzzleImportArguments(process.argv.slice(2));
  if (parsed.help) {
    console.log(usage());
    return;
  }
  const result = await importLichessPuzzles({ source: parsed.source, ...parsed.options });
  await mkdir(path.dirname(parsed.output), { recursive: true });
  await writeFile(parsed.output, `${JSON.stringify(result)}\n`, "utf8");
  console.log(`${result.counts.accepted} anonymisierte Lichess-Puzzles importiert.`);
  console.log(`Gelesene Zeilen: ${result.counts.rowsRead}`);
  console.log(`Ziel: ${path.relative(ROOT, parsed.output) || parsed.output}`);
}

if (path.resolve(process.argv[1] || "") === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error?.message || error);
    process.exitCode = 1;
  });
}
