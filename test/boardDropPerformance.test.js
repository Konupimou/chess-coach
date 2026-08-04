import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const appSource = readFileSync(new URL("../app.js", import.meta.url), "utf8");
const boardSource = readFileSync(
  new URL("../public/libs/chessboard-1.0.0.min.js", import.meta.url),
  "utf8",
);
const styleSource = readFileSync(new URL("../style.css", import.meta.url), "utf8");

test("Figuren werden beim Drop ohne künstliche Verzögerung abgelegt", () => {
  assert.match(appSource, /snapSpeed:\s*0/);
  assert.doesNotMatch(styleSource, /board-piece-land/);
});

test("Das Brett erhält unveränderte Figuren-DOM-Knoten beim Neuzeichnen", () => {
  assert.match(boardSource, /getAttribute\("data-piece"\)\s*===\s*t/);
  assert.match(boardSource, /appendChild\(a\)/);
  assert.match(boardSource, /appendChild\(d\)/);
  assert.doesNotMatch(
    boardSource,
    /r\.find\("\."\s*\+\s*H\.piece\)\.remove\(\),\s*c/,
  );
});

test("Die gefixte Brettdatei umgeht alte Browser-Caches", () => {
  const layoutSource = readFileSync(new URL("../app/layout.js", import.meta.url), "utf8");
  assert.match(layoutSource, /chessboard-1\.0\.0\.min\.js\?v=drop-stable-3/);
});

test("Zugmarkierungen vermeiden großflächige 999px-Inset-Schatten", () => {
  assert.doesNotMatch(styleSource, /board-last-move[\s\S]{0,240}999px/);
});

test("Vorschauwechsel stoppt laufende Brett-Animationen sauber", () => {
  assert.match(appSource, /cancelBoardPreviewAnimation\(previewFen\)/);
  assert.match(appSource, /\.stop\(true, false\)/);
});
