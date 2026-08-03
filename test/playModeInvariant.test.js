import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const appSource = readFileSync(new URL("../app.js", import.meta.url), "utf8");
const moveListSource = readFileSync(
  new URL("../MoveListView.js", import.meta.url),
  "utf8",
);

function methodSource(name, nextName) {
  const start = appSource.indexOf(`  ${name}(`);
  const end = appSource.indexOf(`  ${nextName}(`, start + 1);
  assert.ok(start >= 0, `${name} fehlt`);
  assert.ok(end > start, `${nextName} fehlt nach ${name}`);
  return appSource.slice(start, end);
}

function methodSourceUntilAsync(name, nextName) {
  const start = appSource.indexOf(`  ${name}(`);
  const end = appSource.indexOf(`  async ${nextName}(`, start + 1);
  assert.ok(start >= 0, `${name} fehlt`);
  assert.ok(end > start, `${nextName} fehlt nach ${name}`);
  return appSource.slice(start, end);
}

function asyncMethodSource(name, nextName) {
  const start = appSource.indexOf(`  async ${name}(`);
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
  assert.match(appSource, /this\.suggestionsEl\.hidden = !isAnalysis/);
  assert.match(appSource, /this\.evalBar\.container\.hidden = !isAnalysis/);
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

test("Spielmodus aktualisiert Feedback und Präzisions-Streak ohne Genauigkeitsfeld", () => {
  const accuracySource = methodSource("updateAccuracyDisplay", "openEngineSettings");
  const feedbackSource = methodSource("recordLatestPlayFeedback", "renderSuggestions");
  assert.match(accuracySource, /ownOnly/);
  assert.doesNotMatch(appSource, /accuracy-chip/);
  assert.doesNotMatch(appSource, /whiteAccuracySideEl/);
  assert.doesNotMatch(appSource, /blackAccuracySideEl/);
  assert.match(feedbackSource, /nextStrongMoveStreak/);
  assert.match(feedbackSource, /celebratePlayedPiece/);
  assert.match(appSource, /play-streak-track/);
  assert.match(appSource, /this\.boardRow\?\.appendChild\(this\.playStreakEl\)/);
});

test("Live-Feedback behandelt Buchfortsetzungen ohne Engine-Bestzug", () => {
  const feedbackSource = methodSource("recordLatestPlayFeedback", "renderSuggestions");
  const renderSource = methodSource("renderPlayPanel", "setAppMode");
  const openingBranchStart = renderSource.indexOf("if (latest.openingBook === true)");
  const openingBranchEnd = renderSource.indexOf("} else {", openingBranchStart);
  const openingBranch = renderSource.slice(openingBranchStart, openingBranchEnd);

  assert.match(feedbackSource, /openingReviewForPath\(path, this\.openingBook/);
  assert.match(feedbackSource, /describeOpeningLiveMove\(openingReview, feedback\)/);
  assert.match(feedbackSource, /bestUci: openingReview \? ""/);
  assert.match(feedbackSource, /bestSan: openingReview \? ""/);
  assert.match(feedbackSource, /if \(!openingReview\) \{\s*this\.requestAutomaticPlayCoachFeedback/);
  assert.ok(openingBranchStart >= 0 && openingBranchEnd > openingBranchStart);
  assert.match(openingBranch, /Spielbare Eröffnungswahl/);
  assert.doesNotMatch(openingBranch, /Bester Zug|bestSan|moveQualityPresentation/);
});

test("Analyse übergibt farbige Kurzerklärungen an die Zugliste", () => {
  const renderSource = methodSource("buildMoveAnnotations", "renderMoveList");
  assert.match(renderSource, /explainMoveQuality/);
  assert.match(renderSource, /MOVE_QUALITY/);
  assert.match(appSource, /showExplanations = this\.appMode !== "play" && this\.analysisAssistantsEnabled/);
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

test("Klicknavigation animiert genau ein legales Ziel und beendet alte Vorschauen", () => {
  const jumpSource = methodSource("jumpToFen", "getMainlineNodes");
  assert.match(appSource, /moveSpeed: this\.reduceBoardMotion \? 0 : 130/);
  assert.match(appSource, /dragThrottleRate:\s*8/);
  assert.match(appSource, /deferBoardSync: fromDrag/);
  assert.match(appSource, /this\.pendingDragBoardSync = true/);
  assert.match(appSource, /this\.pendingMoveUiRefresh = true/);
  assert.match(appSource, /flushAppliedMoveUiRefresh/);
  assert.match(appSource, /updateLastMoveHighlights/);
  assert.match(appSource, /board-legal-target/);
  assert.match(appSource, /onMoveEnd: \(\) => this\.handleBoardMoveEnd\(\)/);
  assert.match(appSource, /onJump: \(fen, node\) => this\.jumpToFen\(fen, node\)/);
  assert.match(jumpSource, /this\.stopAllBoardPreviews\(\)/);
  assert.match(jumpSource, /root !== this\.moveTree/);
  assert.match(jumpSource, /this\.animateBoardPosition\(node\.fen, \{ fromFen: sourceFen \}\)/);
  assert.doesNotMatch(jumpSource, /this\.board\.position\(node\.fen\)/);
});

test("Coach-Zugtokens werden erneut gegen vollständig legale Evidenz geprüft", () => {
  const resolveSource = methodSource("resolvedExplanationMoves", "moveTokenAliases");
  const buttonSource = methodSource(
    "createMovePreviewButton",
    "renderInteractiveExplanationText",
  );
  const previewSource = methodSource("startExplanationPreview", "renderComputerExplanation");
  assert.match(resolveSource, /line\.complete !== true/);
  assert.match(resolveSource, /move\?\.legal !== true/);
  assert.match(resolveSource, /move\.uci !== uci\[index\]/);
  assert.match(buttonSource, /previewIsPinned/);
  assert.match(buttonSource, /aria-pressed/);
  assert.match(buttonSource, /pointerInside/);
  assert.match(buttonSource, /focused/);
  assert.match(buttonSource, /stopUnlessActive/);
  assert.match(previewSource, /buildPvFrames\(fenBefore, uci, 8\)/);
  assert.match(previewSource, /frames\.length !== uci\.length/);
});

test("Vorschauarten überlagern sich nicht und Escape übernimmt vertagte Updates", () => {
  const suggestionSource = methodSource("startSuggestionPreview", "stopSuggestionPreview");
  const moveListSource = methodSource("startMoveListPreview", "stopMoveListPreview");
  const stopAllSource = methodSource("stopAllBoardPreviews", "formatScore");
  assert.match(suggestionSource, /this\.stopAllBoardPreviews/);
  assert.match(moveListSource, /this\.stopAllBoardPreviews/);
  assert.match(stopAllSource, /hadDeferredSuggestionRender/);
  assert.match(stopAllSource, /this\.renderSuggestions\(\)/);
  assert.match(appSource, /event\.key === "Escape"[\s\S]*this\.stopAllBoardPreviews\(\)/);
});

test("Coach-Vorschauen verbinden Maus und Fokus und verwerfen überholte Requests", () => {
  const bindingSource = methodSource(
    "bindCoachPlanPreview",
    "renderOpeningMilestone",
  );
  const latestSource = methodSource(
    "scheduleLatestMoveExplanation",
    "buildAnalysisCoachEngineContext",
  );
  const scheduleSource = methodSourceUntilAsync(
    "scheduleSuggestionCoachReasons",
    "requestSuggestionCoachReasons",
  );
  const requestSource = asyncMethodSource(
    "requestSuggestionCoachReasons",
    "renderMoveArrows",
  );

  assert.match(bindingSource, /let pointerInside = false/);
  assert.match(bindingSource, /let focused = false/);
  assert.match(bindingSource, /row\.getAttribute\("aria-pressed"\)/);
  assert.match(bindingSource, /this\.stopSuggestionPreview\(row\)/);
  assert.match(moveListSource, /state = \{ pointer: false, focus: false \}/);
  assert.match(moveListSource, /!state\.pointer && !state\.focus/);
  assert.match(latestSource, /bundle\.key/);
  assert.match(scheduleSource, /this\.suggestionCoachController\?\.abort\(\)/);
  assert.match(scheduleSource, /this\.suggestionCoachKey = key/);
  assert.match(scheduleSource, /this\.suggestionCoachExplanation = null/);
  assert.ok(
    scheduleSource.indexOf("this.suggestionCoachKey = key")
      < scheduleSource.indexOf("window.setTimeout"),
  );
  assert.match(requestSource, /key !== this\.suggestionCoachKey/);
});

test("positive Spielzüge animieren die gesetzte Figur", () => {
  const source = methodSource("celebratePlayedPiece", "renderSuggestions");
  assert.match(source, /"best", "excellent", "good"/);
  assert.match(source, /\.square-\$\{square\}/);
  assert.match(source, /piece-success-pop/);
  assert.match(source, /move-success-square/);
});

test("Zugreviews müssen zum exakten Variantenpfad statt nur zur Halbzugzahl passen", () => {
  const source = methodSource("verifiedReviewAtPath", "getLatestVerifiedMoveReview");
  assert.match(source, /verified\.playedUci !== expectedUci/);
  assert.match(source, /verified\.fenBefore !== parent\.fen/);
  assert.match(source, /resultingFrame\.fen !== node\.fen/);
  assert.match(source, /verified\.fenAfter && verified\.fenAfter !== node\.fen/);
});
