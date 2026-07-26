import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const pageSource = readFileSync(new URL("../app/page.js", import.meta.url), "utf8");
const appSource = readFileSync(new URL("../app.js", import.meta.url), "utf8");
const styleSource = readFileSync(new URL("../style.css", import.meta.url), "utf8");

test("Einstieg führt semantisch zu Spielen, Partieanalyse und Stellungsanalyse", () => {
  assert.match(pageSource, /Was möchtest du heute verbessern\?/);
  assert.match(pageSource, /id="start-play-button"/);
  assert.match(pageSource, /id="start-game-analysis-button"/);
  assert.match(pageSource, /id="start-position-button"/);
  assert.match(appSource, /selectStartPath\("play"\)/);
  assert.match(appSource, /selectStartPath\("game-analysis"\)/);
  assert.match(appSource, /selectStartPath\("position"\)/);
});

test("Coach steht in der Analyse vor technischen Zugideen", () => {
  assert.match(appSource, /analysisColumn\.insertBefore\(chatWrapper, this\.suggestionsEl\)/);
  assert.match(appSource, /Aktuelle Einschätzung/);
  assert.match(appSource, /Deine Sicht/);
  assert.match(appSource, /analysis-perspective-button/);
  assert.match(appSource, /Ausführlicher erklären/);
  assert.doesNotMatch(appSource, /Lernprinzip/);
  assert.match(appSource, /review-technical-details/);
  assert.match(appSource, /Technische Auswertung anzeigen/);
});

test("Mobile Hierarchie nutzt große Ziele und einspaltige Coach-Bereiche", () => {
  assert.match(styleSource, /@media \(max-width: 768px\)/);
  assert.match(styleSource, /\.mode-context > button[\s\S]*min-height: 44px/);
  assert.match(styleSource, /\.learning-summary-grid[\s\S]*grid-template-columns: 1fr/);
  assert.match(styleSource, /\.coach-form[\s\S]*grid-template-columns: 1fr/);
});
