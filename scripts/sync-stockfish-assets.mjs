import { copyFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const source = path.join(
  projectRoot,
  "node_modules",
  "stockfish",
  "src",
  "nn-5af11540bbfe.nnue",
);
const destinationDirectory = path.join(projectRoot, "public", "libs", "stockfish");
const destination = path.join(destinationDirectory, "nn-5af11540bbfe.nnue");

await mkdir(destinationDirectory, { recursive: true });
await copyFile(source, destination);
console.log("Stockfish-NNUE-Netzwerk synchronisiert.");
