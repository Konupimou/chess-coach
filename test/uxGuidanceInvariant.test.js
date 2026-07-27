import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const pageSource = readFileSync(new URL("../app/page.js", import.meta.url), "utf8");
const appSource = readFileSync(new URL("../app.js", import.meta.url), "utf8");
const styleSource = readFileSync(new URL("../style.css", import.meta.url), "utf8");

test("Bereichsnavigation führt direkt zu Spielen und Analyse", () => {
  assert.match(pageSource, /id="play-mode-button"/);
  assert.match(pageSource, /id="analysis-mode-button"/);
  assert.doesNotMatch(pageSource, /Was möchtest du heute verbessern\?/);
  assert.doesNotMatch(pageSource, /id="start-guide"/);
});

test("Schachcomputer steht in der Analyse vor dem Coach", () => {
  assert.match(appSource, /analysisColumn\.appendChild\(this\.suggestionsEl\)/);
  assert.match(appSource, /analysisColumn\.appendChild\(chatWrapper\)/);
  assert.ok(
    appSource.indexOf("analysisColumn.appendChild(this.suggestionsEl)")
      < appSource.indexOf("analysisColumn.appendChild(chatWrapper)"),
  );
  assert.doesNotMatch(appSource, /Aktuelle Einschätzung/);
  assert.doesNotMatch(appSource, /Deine Sicht/);
  assert.doesNotMatch(appSource, /analysis-perspective-button/);
  assert.doesNotMatch(appSource, /Deine besten Möglichkeiten/);
  assert.match(appSource, /this\.suggestionCount = 1/);
  assert.match(appSource, /syncAnalysisColumnHeight\(\)/);
  assert.match(appSource, /this\.analysisColumn\.style\.height = `\$\{boardStackHeight\}px`/);
  assert.match(styleSource, /@media \(min-width: 1101px\)[\s\S]*\.chat-wrapper[\s\S]*flex: 1 1 0/);
  assert.match(styleSource, /@media \(min-width: 1101px\)[\s\S]*\.coach-card[\s\S]*height: 100%/);
  assert.match(styleSource, /\.coach-card[\s\S]*height: 480px/);
  assert.match(styleSource, /#coach-chat \.chat-body[\s\S]*overflow-y: auto/);
  assert.doesNotMatch(appSource, /Lernprinzip/);
  assert.match(appSource, /review-technical-details/);
  assert.match(appSource, /Technische Auswertung anzeigen/);
});

test("Eröffnungserkennung bleibt lokal, wird aber nicht als eigene Karte angezeigt", () => {
  assert.match(appSource, /loadOpeningBook/);
  assert.match(appSource, /buildOpeningCoachContext/);
  assert.match(appSource, /this\.detectedOpeningEl/);
  assert.match(appSource, /deriveOpeningLifecycle/);
  assert.match(appSource, /gameLibraryModel/);
  assert.match(appSource, /this\.whitePlayerInput/);
  assert.match(appSource, /this\.blackPlayerInput/);
  assert.match(appSource, /board-more-actions/);
  assert.match(appSource, /savedOpening !== savedAutomaticOpening/);
  assert.match(appSource, /this\.openingManualOverride = Boolean/);
  assert.doesNotMatch(appSource, /Weiß am Zug/);
  assert.doesNotMatch(appSource, /accuracy-chip/);
  assert.doesNotMatch(appSource, /createOpeningCard/);
  assert.doesNotMatch(appSource, /Keine benannte Eröffnungsposition erkannt/);
  assert.doesNotMatch(styleSource, /\.opening-card/);
});

test("Mobile Hierarchie nutzt große Ziele und einspaltige Coach-Bereiche", () => {
  assert.match(styleSource, /@media \(max-width: 768px\)/);
  assert.match(styleSource, /\.learning-summary-grid[\s\S]*grid-template-columns: 1fr/);
  assert.match(styleSource, /\.coach-form[\s\S]*grid-template-columns: 1fr/);
});
