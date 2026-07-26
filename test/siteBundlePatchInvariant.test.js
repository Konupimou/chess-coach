import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const patchSource = readFileSync(
  new URL("../scripts/patch-opennext-worker.mjs", import.meta.url),
  "utf8",
);

test("Produktionsbundle erhält eine explizite CommonJS-Brücke", () => {
  assert.match(patchSource, /createRequire as __createNodeRequire/);
  assert.match(patchSource, /const require = __createNodeRequire\(import\.meta\.url\)/);
});
