import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const appSource = fs.readFileSync(new URL("../app.js", import.meta.url), "utf8");
const styleSource = fs.readFileSync(new URL("../style.css", import.meta.url), "utf8");

test("Brett markiert Schach, Matt und Patt farblich", () => {
  assert.match(appSource, /updateBoardStatusHighlights\(\)/);
  assert.match(appSource, /board-status-check-square/);
  assert.match(appSource, /board-status-checkmate-square/);
  assert.match(appSource, /board-status-stalemate-square/);
  assert.match(styleSource, /#board \.board-status-check-square/);
  assert.match(styleSource, /#board \.board-status-checkmate-square/);
  assert.match(styleSource, /#board \.board-status-stalemate-square/);
});
