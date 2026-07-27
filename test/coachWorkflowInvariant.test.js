import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const appSource = readFileSync(new URL("../app.js", import.meta.url), "utf8");

test("Zugvorschläge bleiben technisch und lösen keine automatischen Coach-Antworten aus", () => {
  assert.doesNotMatch(appSource, /requestSuggestionCoachReasons/);
  assert.doesNotMatch(appSource, /suggestion-coach-reason/);
  assert.match(appSource, /Zugfolge-Vorschau/);
  assert.match(appSource, /selectImpactArrowMoves/);
  assert.match(appSource, /Rechentiefe \$\{data\.depth\}/);
  assert.match(appSource, /Bewertung \$\{this\.formatScore/);
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
  assert.match(appSource, /this\.chatMessages = \[\];/);
  assert.doesNotMatch(appSource, /accuracyFeedbackRowEl\?\.appendChild\(this\.playFeedbackEl\)/);
});

test("Analyseperspektive trennt eigene Zugoptionen von der Bewertung des letzten eigenen Zuges", () => {
  assert.match(appSource, /setAnalysisPerspective/);
  assert.match(appSource, /this\.game\.turn\(\) === this\.getAnalysisPerspective\(\)/);
  assert.match(appSource, /this\.buildPositionCoachEngineContext\(\)/);
  assert.match(appSource, /this\.buildMoveCoachEngineContext\(this\.getLastPerspectiveMoveReview\(\)\)/);
  assert.match(appSource, /engineContext: this\.buildAnalysisCoachEngineContext\(\)/);
});

test("Analysechat enthält nur ausdrücklich gestartete Nutzer-Coach-Dialoge", () => {
  const sendStart = appSource.indexOf("  async sendChatMessage(text)");
  const sendEnd = appSource.indexOf("  setChatBusy(", sendStart);
  const sendSource = appSource.slice(sendStart, sendEnd);
  assert.match(sendSource, /appendChatMessage\('user', text\)/);
  assert.match(sendSource, /appendChatMessage\('assistant', reply\.trim\(\)\)/);
  assert.doesNotMatch(appSource, /scheduleSuggestionCoachReasons/);
  assert.doesNotMatch(appSource, /scheduleAnalysisMoveCoachFeedback/);
  assert.doesNotMatch(appSource, /updateAnalysisCoachFocus/);
  assert.doesNotMatch(appSource, /analysisCoachLines/);
});

test("Zugliste und Pfeiltastennavigation bleiben in der reduzierten Analyse erhalten", () => {
  const pageSource = readFileSync(new URL("../app/page.js", import.meta.url), "utf8");
  assert.match(pageSource, /id="move-list"/);
  assert.match(pageSource, /← → navigieren/);
  assert.match(appSource, /new MoveListView/);
  assert.match(appSource, /attachKeyboard/);
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
