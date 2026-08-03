import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const pageSource = readFileSync(new URL("../app/page.js", import.meta.url), "utf8");
const appSource = readFileSync(new URL("../app.js", import.meta.url), "utf8");
const styleSource = readFileSync(new URL("../style.css", import.meta.url), "utf8");
const evalBarSource = readFileSync(new URL("../evalBar.js", import.meta.url), "utf8");

test("Oberfläche konzentriert sich ausschließlich auf die Analyse", () => {
  assert.match(pageSource, /<h1>Analyse<\/h1>/);
  assert.match(pageSource, /className="page analysis-only-page"/);
  assert.doesNotMatch(pageSource, /mode-navigation/);
  assert.doesNotMatch(pageSource, /play-mode-button/);
  assert.doesNotMatch(pageSource, /coach-analysis-mode-button/);
  assert.doesNotMatch(pageSource, />Spielen</);
  assert.doesNotMatch(pageSource, />Coach-Analyse</);
  assert.match(appSource, /this\.appMode = "analysis"/);
  assert.doesNotMatch(appSource, /this\.createPlayPanel\(engineAvailable\)/);
  assert.doesNotMatch(appSource, /this\.createCoachAnalysisPanel\(\)/);
});

test("Analyse bietet nur zwei klar benannte Aufgaben", () => {
  assert.match(appSource, />Nächster Zug<\/button>/);
  assert.match(appSource, />Letzter Zug<\/button>/);
  assert.doesNotMatch(appSource, />Weiterspielen<\/button>/);
  assert.match(appSource, /aria-label="Art der Analyse"/);
});

test("rechte Spalte zeigt vorläufig nur die Zugliste und pausiert Analyse-Assistenten", () => {
  assert.match(pageSource, /id="board-container"[\s\S]*className="move-list-section"/);
  assert.match(appSource, /const ANALYSIS_ASSISTANTS_ENABLED = false/);
  assert.match(appSource, /analysisColumn\.hidden = !this\.analysisAssistantsEnabled/);
  assert.match(appSource, /this\.evalBar\.container\.hidden = !this\.analysisAssistantsEnabled/);
  assert.match(
    appSource,
    /this\.appMode === "analysis" && !this\.analysisAssistantsEnabled[\s\S]*this\.engine\?\.cancelSearch/,
  );
  assert.match(styleSource, /\.analysis-only-page \.analysis-column\[hidden\]/);
  assert.match(styleSource, /\.analysis-only-page \.move-list-section[\s\S]*order:\s*2/);
  assert.match(styleSource, /--analysis-board-size:\s*min\(calc\(100dvh - 160px\)/);
  assert.match(
    styleSource,
    /grid-template-columns:\s*minmax\(0, var\(--analysis-board-size\)\) minmax\(220px, 270px\)/,
  );
  assert.match(styleSource, /\.analysis-only-page \.board-surface[\s\S]*max-width:\s*none/);
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
  assert.doesNotMatch(appSource, /Lernprinzip/);
  assert.match(appSource, /review-technical-details/);
  assert.match(appSource, /Technische Auswertung anzeigen/);
});

test("Brett nutzt den scharfen CC0-SVG-Figurensatz", () => {
  assert.match(appSource, /pieceTheme: "\/libs\/img\/rhosgfx\/\{piece\}\.svg"/);
  for (const piece of ["bB", "bK", "bN", "bP", "bQ", "bR", "wB", "wK", "wN", "wP", "wQ", "wR"]) {
    const svg = readFileSync(
      new URL(`../public/libs/img/rhosgfx/${piece}.svg`, import.meta.url),
      "utf8",
    );
    assert.match(svg, /^<svg\b/);
    assert.doesNotMatch(svg, /<script|foreignObject|(?:xlink:)?href=/i);
  }
  assert.match(styleSource, /#board \.white-1e1d7[\s\S]*#dfe6dc/);
  assert.match(styleSource, /#board \.black-3c85d[\s\S]*#718477/);
});

test("Eröffnungsbuch hält die Engine ruhig und Engine-Updates werden gedrosselt", () => {
  assert.match(appSource, /hasOpeningDatabaseRecommendation/);
  assert.match(appSource, /this\.engine\?\.cancelSearch\?\.\(\)/);
  assert.match(appSource, /this\.evalBar\?\.setOpeningBook\?\.\(\)/);
  assert.match(appSource, /verifiedSuggestionInfo\(info, 10\)/);
  assert.match(appSource, /scheduleSuggestionRender\(delay = 90\)/);
  assert.match(evalBarSource, /setOpeningBook\(\)/);
  assert.match(styleSource, /#analysis-panel\.is-opening-book/);
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
