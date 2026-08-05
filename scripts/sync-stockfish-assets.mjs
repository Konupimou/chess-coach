import { copyFile, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const packageRoot = path.join(projectRoot, "node_modules", "stockfish");
const destinationDirectory = path.join(projectRoot, "public", "libs", "stockfish");
const assetNames = [
  "stockfish-18-lite.js",
  "stockfish-18-lite.wasm",
  "stockfish-18-lite-single.js",
  "stockfish-18-lite-single.wasm",
  "stockfish-18-asm.js",
];

await rm(destinationDirectory, { recursive: true, force: true });
await mkdir(destinationDirectory, { recursive: true });
await Promise.all([
  ...assetNames.map((name) => copyFile(
    path.join(packageRoot, "bin", name),
    path.join(destinationDirectory, name),
  )),
  copyFile(
    path.join(packageRoot, "Copying.txt"),
    path.join(destinationDirectory, "COPYING.txt"),
  ),
]);

// Hostinger's CDN may serve .wasm as text/plain. Avoid relying on
// WebAssembly.instantiateStreaming(), which requires application/wasm.
for (const name of assetNames.filter((entry) => entry.endsWith(".js"))) {
  const target = path.join(destinationDirectory, name);
  const source = await readFile(target, "utf8");
  const patched = source.replace(
    /WebAssembly\.instantiateStreaming\(([^,]+),([^\)]+)\)/g,
    (_, response, imports) => `${response}.arrayBuffer().then(function(t){return WebAssembly.instantiate(t,${imports})})`,
  );
  await writeFile(target, patched);
}
console.log("Stockfish-18-Lite-Assets synchronisiert.");
