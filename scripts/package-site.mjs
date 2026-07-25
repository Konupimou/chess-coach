import { existsSync, readdirSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";

const MAX_ASSET_BYTES = 25 * 1024 * 1024;
const requiredPaths = [
  ".open-next/worker.js",
  ".open-next/assets",
  ".openai/hosting.json",
  "wrangler.jsonc",
];

for (const path of requiredPaths) {
  if (!existsSync(path)) {
    console.error(`Fehlendes Sites-Artefakt: ${path}`);
    process.exit(1);
  }
}

function validateAssetSizes(directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) {
      validateAssetSizes(path);
    } else if (entry.isFile() && statSync(path).size > MAX_ASSET_BYTES) {
      console.error(`Sites-Asset überschreitet 25 MiB: ${path}`);
      process.exit(1);
    }
  }
}

validateAssetSizes(".open-next/assets");

const output = resolve(process.argv[2] || "chess-coach-sites.tar.gz");
const result = spawnSync(
  "tar",
  [
    "-czf",
    output,
    ".open-next",
    ".openai/hosting.json",
    "wrangler.jsonc",
  ],
  {
    env: { ...process.env, COPYFILE_DISABLE: "1" },
    stdio: "inherit",
  },
);

if (result.error) throw result.error;
if (result.status !== 0) process.exit(result.status ?? 1);

console.log(`Sites-Archiv erstellt: ${output}`);
