import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Chess } from "chess.js";
import {
  createOpeningBook,
  normalizeFenToEpd,
} from "../openingRecognition.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const runtimePath = path.join(ROOT, "public", "data", "openings", "openings.runtime.json");
const runtime = JSON.parse(await readFile(runtimePath, "utf8"));
const book = createOpeningBook(runtime);
const errors = [];
const uciPattern = /^[a-h][1-8][a-h][1-8][qrbn]?$/;

book.entries.forEach((entry, id) => {
  const [eco, name, sequence] = entry;
  if (!/^[A-E]\d{2}$/.test(eco)) errors.push(`${id}: ECO ${eco}`);
  if (!name) errors.push(`${id}: Name fehlt`);
  const game = new Chess();
  for (const uci of sequence.split(" ").filter(Boolean)) {
    if (!uciPattern.test(uci)) {
      errors.push(`${id}: UCI ${uci}`);
      break;
    }
    try {
      game.move({
        from: uci.slice(0, 2),
        to: uci.slice(2, 4),
        promotion: uci[4] || undefined,
      });
    } catch {
      errors.push(`${id}: illegale UCI-Folge`);
      break;
    }
  }
  const epd = normalizeFenToEpd(game.fen());
  if (!book.positions[epd]?.includes(id)) errors.push(`${id}: Positionsindex fehlt`);
  if (!book.sequences[sequence]?.includes(id)) errors.push(`${id}: Sequenzindex fehlt`);
});

if (errors.length > 0) {
  console.error(errors.slice(0, 30).join("\n"));
  throw new Error(`${errors.length} Fehler in den Eröffnungsdaten.`);
}

console.log(`${book.entries.length} Eröffnungseinträge geprüft.`);
console.log(`${Object.keys(book.positions).length} Positionen und ${book.sequencePrefixes.size} Zugfolgen-Präfixe sind konsistent.`);
