import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const appSource = readFileSync(new URL("../app.js", import.meta.url), "utf8");

test("Vorschläge erhalten Coach-Gründe und eine grafische Vorschau", () => {
  assert.match(appSource, /requestSuggestionCoachReasons/);
  assert.match(appSource, /groundedSuggestionReason/);
  assert.match(appSource, /fallbackReasons/);
  assert.doesNotMatch(appSource, /Warum dieser Zug\?/);
  assert.match(appSource, /Coach-Vorschau/);
  assert.match(appSource, /selectImpactArrowMoves/);
  assert.match(appSource, /const engineContext = this\.buildPositionCoachEngineContext\(\)/);
  assert.match(appSource, /requestGroundedMoveExplanation/);
  assert.match(appSource, /computer-move-token/);
  assert.match(appSource, /startExplanationPreview/);
});

test("automatische Zugerklärungen bleiben im Schachcomputer und der Chat beginnt mit dem Nutzer", () => {
  const scheduleStart = appSource.indexOf("  scheduleLatestMoveExplanation()");
  const scheduleEnd = appSource.indexOf("  buildAnalysisCoachEngineContext()", scheduleStart);
  const scheduleSource = appSource.slice(scheduleStart, scheduleEnd);
  assert.ok(scheduleStart >= 0 && scheduleEnd > scheduleStart);
  assert.match(scheduleSource, /this\.latestComputerExplanation =/);
  assert.match(scheduleSource, /this\.renderSuggestions\(\)/);
  assert.match(scheduleSource, /positionFenBefore/);
  assert.match(scheduleSource, /positionFenAfter/);
  assert.match(scheduleSource, /pathSignature/);
  assert.doesNotMatch(scheduleSource, /appendChatMessage|chatMessages\.push/);
  assert.doesNotMatch(appSource, /upsertMoveExplanationMessage/);

  const sendStart = appSource.indexOf("  async sendChatMessage(text)");
  const sendEnd = appSource.indexOf("  setChatBusy(", sendStart);
  const sendSource = appSource.slice(sendStart, sendEnd);
  assert.match(sendSource, /this\.appendChatMessage\('user', text\)/);
});

test("der Browser übernimmt keine alten Coach-Texte und cached nur geprüfte Serverquellen", () => {
  const loadStart = appSource.indexOf("  loadMoveExplanationCache()");
  const loadEnd = appSource.indexOf("  saveMoveExplanationCache()", loadStart);
  const loadSource = appSource.slice(loadStart, loadEnd);
  const saveStart = loadEnd;
  const saveEnd = appSource.indexOf("  rememberMoveExplanation(", saveStart);
  const saveSource = appSource.slice(saveStart, saveEnd);
  const requestStart = appSource.indexOf("  async requestGroundedMoveExplanation({");
  const requestEnd = appSource.indexOf("  createChatPanel(", requestStart);
  const requestSource = appSource.slice(requestStart, requestEnd);

  assert.ok(loadStart >= 0 && loadEnd > loadStart);
  assert.ok(saveEnd > saveStart);
  assert.ok(requestStart >= 0 && requestEnd > requestStart);
  assert.match(appSource, /chess-coach\.move-explanations\.v3/);
  assert.match(loadSource, /moveExplanationCache\.clear\(\)/);
  assert.match(loadSource, /removeItem/);
  assert.doesNotMatch(loadSource, /getItem/);
  assert.doesNotMatch(saveSource, /setItem/);
  assert.match(
    requestSource,
    /payload\.source === "ai"\s*\|\|\s*payload\.source === "cache"/,
  );
  assert.doesNotMatch(requestSource, /payload\.source === "local"/);
});

test("Live-Coach bewertet rechts oben, erlaubt Nachfragen und hält automatische Antworten aus dem Chat", () => {
  assert.match(appSource, /liveCoach\.appendChild\(this\.playFeedbackEl\)/);
  assert.match(appSource, /handlePlayCoachReply/);
  assert.match(appSource, /Nenne keinen Zug für die jetzt entstandene Stellung/);
  const feedbackStart = appSource.indexOf("  recordLatestPlayFeedback()");
  const feedbackEnd = appSource.indexOf("  handlePlayCoachReply()", feedbackStart);
  assert.match(
    appSource.slice(feedbackStart, feedbackEnd),
    /requestAutomaticPlayCoachFeedback/,
  );
  assert.match(appSource, /buildMoveCoachEngineContext/);
  assert.match(appSource, /if \(automatic && Number\.isInteger\(ply\)\)/);
  assert.match(appSource, /item\.coachText = reply/);
  assert.match(appSource, /coachPlan:?\s*buildCoachVisualPlan|const coachPlan = buildCoachVisualPlan/);
  assert.match(appSource, /this\.bindCoachPlanPreview\(this\.playFeedbackEl/);
  assert.match(appSource, /moveQualityPresentation/);
  assert.match(appSource, /this\.chatMessages = \[\];/);
  assert.doesNotMatch(appSource, /accuracyFeedbackRowEl\?\.appendChild\(this\.playFeedbackEl\)/);
});

test("Analyseperspektive trennt eigene Zugoptionen von der Bewertung des letzten eigenen Zuges", () => {
  assert.match(appSource, /setAnalysisPerspective/);
  assert.match(appSource, /this\.game\.turn\(\) === this\.getAnalysisPerspective\(\)/);
  assert.match(appSource, /this\.buildPositionCoachEngineContext\(\)/);
  assert.match(appSource, /this\.buildMoveCoachEngineContext\(this\.getLastPerspectiveMoveReview\(\)\)/);
  assert.doesNotMatch(appSource, /Das sind deine \$\{optionCount\} besten Möglichkeiten/);
  assert.match(appSource, /engineContext: this\.buildAnalysisCoachEngineContext\(\)/);
  assert.match(appSource, /renderLastPerspectiveMoveAssessment/);
  assert.match(appSource, /this\.game\.turn\(\) !== this\.getAnalysisPerspective\(\)/);
  assert.match(appSource, /Rückblick auf deinen letzten Zug/);
  assert.match(appSource, /describeMoveAssessment/);
});

test("Geführte Review navigiert durch Schlüsselmomente und markiert das Brett", () => {
  assert.match(appSource, /startReviewJourney/);
  assert.match(appSource, /navigateReviewJourney/);
  assert.match(appSource, /analysis-key-piece/);
  assert.match(appSource, /analysis-danger-square/);
});

test("Account bietet Gesamtanalyse und Lichess-Massenimport als ausdrückliche Aktionen", () => {
  assert.match(appSource, /analyzeAllSavedGames/);
  assert.match(appSource, /Alle \$\{pendingAnalysisGames\.length\} parallel analysieren/);
  assert.match(appSource, /analyzeSavedRecordInBackground/);
  assert.match(appSource, /Promise\.all/);
  assert.match(appSource, /Alle neuen importieren/);
  assert.match(appSource, /importAllLichessGames/);
});

test("Gesamtanalyse verändert weder Brett noch geöffnete Partie", () => {
  const start = appSource.indexOf("  async analyzeAllSavedGames()");
  const end = appSource.indexOf("  makeSavedGameTitle(", start);
  const batchSource = appSource.slice(start, end);
  assert.ok(start >= 0 && end > start);
  assert.doesNotMatch(batchSource, /openSavedGame\(/);
  assert.doesNotMatch(batchSource, /startFullGameReview\(/);
  assert.doesNotMatch(batchSource, /board\.position/);
});
