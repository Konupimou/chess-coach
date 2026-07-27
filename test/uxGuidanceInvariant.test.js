import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const pageSource = readFileSync(new URL("../app/page.js", import.meta.url), "utf8");
const appSource = readFileSync(new URL("../app.js", import.meta.url), "utf8");
const styleSource = readFileSync(new URL("../style.css", import.meta.url), "utf8");
const evalBarSource = readFileSync(new URL("../evalBar.js", import.meta.url), "utf8");

test("Einstieg bleibt auf den direkten Wechsel zwischen Spielen und Analyse reduziert", () => {
  assert.doesNotMatch(pageSource, /id="start-guide"/);
  assert.doesNotMatch(pageSource, /Was möchtest du heute verbessern\?/);
  assert.match(pageSource, /id="play-mode-button"/);
  assert.match(pageSource, /id="analysis-mode-button"/);
  assert.match(appSource, /setAppMode\("play"\)/);
  assert.match(appSource, /setAppMode\("analysis"\)/);
});

test("Schachcomputer steht über dem standardmäßig geöffneten Coach", () => {
  assert.match(appSource, /document\.createElement\('details'\)/);
  assert.match(appSource, /panel\.open = true/);
  assert.ok(
    appSource.indexOf("analysisColumn.appendChild(this.suggestionsEl)")
      < appSource.indexOf("analysisColumn.appendChild(chatWrapper)"),
  );
  assert.match(appSource, /Fragen zum Brett/);
  assert.match(appSource, /analysis-perspective-button/);
  assert.doesNotMatch(appSource, /analysis-coach-focus/);
  assert.match(appSource, /suggestion-reason/);
  assert.match(appSource, /Partie vollständig analysieren/);
});

test("Coach nutzt den Platz neben dem Brett und scrollt Nachrichten intern", () => {
  assert.match(appSource, /--analysis-height/);
  assert.match(styleSource, /#coach-chat\[open\][\s\S]*flex-direction: column/);
  assert.match(styleSource, /#coach-chat \.chat-body[\s\S]*overflow-y: auto/);
  assert.match(styleSource, /#coach-chat \.chat-body[\s\S]*min-height: 0/);
});

test("Bewertungsbalken trennt klares Schwarz von hellem Weiß", () => {
  assert.match(evalBarSource, /this\.bar\.style\.background = '#05070b'/);
  assert.match(evalBarSource, /this\.overlay\.style\.background = '#f5f7fa'/);
  assert.doesNotMatch(evalBarSource, /linear-gradient\(#fff,#000\)/);
});

test("Eröffnungsdaten bleiben für Speicherung und Coach erhalten, aber ohne eigene Karte", () => {
  assert.doesNotMatch(appSource, /createOpeningCard/);
  assert.doesNotMatch(appSource, /opening-card/);
  assert.match(appSource, /loadOpeningBook/);
  assert.match(appSource, /refreshOpeningRecognition/);
  assert.match(appSource, /buildOpeningCoachContext/);
  assert.match(appSource, /this\.gameSaveDraft\.opening = this\.openingRecognition\.displayName/);
  assert.doesNotMatch(styleSource, /\.opening-card/);
});

test("Mobile Hierarchie nutzt große Ziele und einspaltige Coach-Bereiche", () => {
  assert.match(styleSource, /@media \(max-width: 768px\)/);
  assert.match(styleSource, /\.mode-context > button[\s\S]*min-height: 44px/);
  assert.match(styleSource, /\.learning-summary-grid[\s\S]*grid-template-columns: 1fr/);
  assert.match(styleSource, /\.coach-form[\s\S]*grid-template-columns: 1fr/);
});
