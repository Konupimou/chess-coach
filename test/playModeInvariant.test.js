import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const appSource = readFileSync(new URL("../app.js", import.meta.url), "utf8");

function methodSource(name, nextName) {
  const start = appSource.indexOf(`  ${name}(`);
  const end = appSource.indexOf(`  ${nextName}(`, start + 1);
  assert.ok(start >= 0, `${name} fehlt`);
  assert.ok(end > start, `${nextName} fehlt nach ${name}`);
  return appSource.slice(start, end);
}

test("Enginezüge prüfen Modus, Generation, FEN und Such-ID", () => {
  const source = methodSource("handleEngineBestMove", "recordLatestPlayFeedback");
  assert.match(source, /this\.appMode !== "play"/);
  assert.match(source, /context\.generation !== this\.playSession\.generation/);
  assert.match(source, /result\.fen !== this\.game\.fen\(\)/);
  assert.match(source, /result\.searchId !== this\.playSession\.expectedSearchId/);
  assert.doesNotMatch(source, /saveCurrentGame|saveAccountState/);
});

test("Spielmodus verbirgt Vorschläge und Pfeile und sperrt falsche Figuren", () => {
  const dragSource = methodSource("handleDragStart", "applyMove");
  const arrowsSource = methodSource("renderMoveArrows", "startSuggestionPreview");
  assert.match(dragSource, /this\.playSession\.phase !== "player-turn"/);
  assert.match(dragSource, /boardPiece\.color !== this\.playSession\.playerColor/);
  assert.match(arrowsSource, /this\.appMode === "play"/);
  assert.match(appSource, /this\.suggestionsEl\.hidden = isPlay/);
  assert.match(appSource, /this\.evalBar\.container\.hidden = isPlay/);
});

test("Enginepartien befüllen nur den Entwurf und gespeicherte Partien öffnen in Analyse", () => {
  const startSource = methodSource("startEngineGame", "finishPlayAndAnalyze");
  const openSource = methodSource("openSavedGame", "deleteSavedGame");
  assert.match(startSource, /opponent: engineOpponentLabel\(normalizedLevel\)/);
  assert.match(startSource, /opponentType: "engine"/);
  assert.match(startSource, /engineLevel: normalizedLevel/);
  assert.match(startSource, /timeFormat: "training"/);
  assert.match(startSource, /this\.gameSaveDraftDirty = true/);
  assert.doesNotMatch(startSource, /saveCurrentGame|saveAccountState/);
  assert.match(openSource, /this\.appMode = "analysis"/);
  assert.match(openSource, /this\.cancelPlaySession\(\)/);
});

test("Das Brett unterstützt Fokus, Pfeiltasten und Enter als alternativen Zugweg", () => {
  const keyboardSource = methodSource("handleBoardKeyDown", "handleDragStart");
  assert.match(appSource, /boardEl\.tabIndex = 0/);
  assert.match(appSource, /this\.skipLink\?\.addEventListener\("click"/);
  assert.match(keyboardSource, /"ArrowLeft"/);
  assert.match(keyboardSource, /"Enter"/);
  assert.match(keyboardSource, /this\.handleMove\(source, square\)/);
});

test("Spielmodus zeigt nur eigene Genauigkeit und aktualisiert den Streak nach Feedback", () => {
  const accuracySource = methodSource("updateAccuracyDisplay", "openEngineSettings");
  const feedbackSource = methodSource("recordLatestPlayFeedback", "renderSuggestions");
  assert.match(accuracySource, /ownOnly/);
  assert.match(accuracySource, /this\.whiteAccuracySideEl\.hidden/);
  assert.match(accuracySource, /this\.blackAccuracySideEl\.hidden/);
  assert.match(feedbackSource, /nextStrongMoveStreak/);
  assert.match(feedbackSource, /celebratePlayedPiece/);
  assert.match(appSource, /play-streak-track/);
  assert.match(appSource, /this\.boardRow\?\.appendChild\(this\.playStreakEl\)/);
});

test("Analyse übergibt farbige Kurzerklärungen an die Zugliste", () => {
  const renderSource = methodSource("buildMoveAnnotations", "renderMoveList");
  assert.match(renderSource, /explainMoveQuality/);
  assert.match(renderSource, /MOVE_QUALITY/);
  assert.match(appSource, /showExplanations: this\.appMode === "analysis"/);
  assert.match(appSource, /Zug für Zug/);
});

test("Zuglisten-Hover zeigt nur eine temporäre Brettvorschau", () => {
  const startSource = methodSource("startMoveListPreview", "stopMoveListPreview");
  const stopSource = methodSource("stopMoveListPreview", "formatScore");
  assert.match(appSource, /onPreview: \(fen, element\)/);
  assert.match(startSource, /this\.board\?\.position\?\.\(fen, false\)/);
  assert.doesNotMatch(startSource, /this\.game\.load|this\.currentNode\s*=/);
  assert.match(stopSource, /this\.game\.fen\(\)/);
});

test("positive Spielzüge animieren die gesetzte Figur", () => {
  const source = methodSource("celebratePlayedPiece", "renderSuggestions");
  assert.match(source, /"best", "excellent", "good"/);
  assert.match(source, /\.square-\$\{square\}/);
  assert.match(source, /piece-success-pop/);
  assert.match(source, /move-success-square/);
});
