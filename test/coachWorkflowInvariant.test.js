import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const appSource = readFileSync(new URL("../app.js", import.meta.url), "utf8");
const styleSource = readFileSync(new URL("../style.css", import.meta.url), "utf8");

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
  assert.match(appSource, /const isPrimary = idx === 1/);
  assert.match(appSource, /isExpanded \? completeMoves : collapsedMoves/);
  assert.match(appSource, /plan\?\.tactical \? sanMoves : sanMoves\.slice\(0, 1\)/);
  assert.match(appSource, /onActivate: \(\) => this\.playSuggestionMove\(data, plan\)/);
  assert.match(
    appSource,
    /playSuggestionMove\(data, suppliedPlan = null\)[\s\S]*this\.applyMove\(/,
  );
  assert.match(appSource, /onToggleExpanded/);
  assert.match(appSource, /expandedSuggestionRanks/);
  assert.match(appSource, /verifiedSuggestionInfo\(info, 20\)/);
  assert.match(appSource, /verifiedInfo\.pvComplete/);
  assert.match(appSource, /!this\.suggestionState\.lines\.has\(1\)/);
  assert.match(styleSource, /\.suggestion-line\.is-primary \.suggestion-coach-popover\s*\{[\s\S]*?display:\s*grid/);
  assert.match(appSource, /terminalPositionState\(fen\)/);
  assert.match(appSource, /buildTerminalVisualPlan/);
  assert.match(appSource, /formatPvWithMoveNumbers/);
  assert.match(appSource, /isPrimary,/);
  assert.match(appSource, /renderComputerExplanation\(\{[\s\S]*positionEvidence/);
  assert.match(appSource, /setAnnotations\(plan\.persistentAnnotations\)/);
  assert.match(appSource, /alreadyNumbered/);
  assert.match(appSource, /assistantMessage\.positionEvidence = chatBundle\.positionEvidence/);
  assert.match(appSource, /canPreviewChatMoves/);
});

test("beendete Stellungen stoppen Enginevorschläge und erklären Matt regelbasiert", () => {
  assert.match(appSource, /this\.suggestionState\.terminal\?\.status !== "ongoing"/);
  assert.match(appSource, /kein Fluchtfeld/);
  assert.match(appSource, /state\.terminal\?\.status/);
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
  assert.match(appSource, /chess-coach\.move-explanations\.v5/);
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

test("Coach-Elo ist in Spiel- und Analysemodus wählbar und bleibt vom Gegner getrennt", () => {
  assert.match(appSource, /COACH_RATING_OPTIONS/);
  assert.match(appSource, /id: "play-coach-rating"/);
  assert.match(appSource, /id: "setup-coach-rating"/);
  assert.match(appSource, /id: "analysis-coach-rating"/);
  assert.match(appSource, /coachPreferences: \{ rating \}/);
  assert.match(appSource, /manualPreference: \{ rating: this\.getCoachRating\(\) \}/);
  assert.match(styleSource, /\.coach-rating-control select/);
});

test("die Datenbox zeigt den verfügbaren Lichess-Trainingsbestand auch unbenutzt", () => {
  assert.match(appSource, /label: "Lichess-Training"/);
  assert.match(appSource, /7\.394 Übungen verfügbar/);
  assert.match(appSource, /sources\.training\?\.detail/);
});

test("Livefeedback nutzt die belegte Zugerklärung statt eines freien KI-Prompts", () => {
  const start = appSource.indexOf("  async requestAutomaticPlayCoachFeedback");
  const end = appSource.indexOf("  async drainPlayCoachQueue", start);
  const source = appSource.slice(start, end);
  assert.match(source, /requestGroundedMoveExplanation/);
  assert.match(source, /item\.coachExplanation = result\.explanation/);
  assert.match(source, /moveExplanationToMarkdown/);
  assert.doesNotMatch(source, /coachQueue\.push|Verrate|Bewerte .*Coach-Niveau/);
  assert.match(appSource, /latestAutomaticReply/);
});

test("Ein sichtbarer Coach-Schalter trennt Zugoptionen vom Rückblick unabhängig von der Farbe", () => {
  assert.match(appSource, /setAnalysisPerspective/);
  assert.match(appSource, /data-analysis-coach-mode="continue">Weiterspielen/);
  assert.match(appSource, /data-analysis-coach-mode="review">Zug verstehen/);
  assert.match(appSource, /setAnalysisCoachMode/);
  assert.match(appSource, /this\.getAnalysisCoachMode\(\) === "review"/);
  assert.match(appSource, /this\.buildPositionCoachEngineContext\(\)/);
  assert.match(appSource, /this\.buildMoveCoachEngineContext\(this\.getLatestVerifiedMoveReview\(\)\)/);
  assert.doesNotMatch(appSource, /Das sind deine \$\{optionCount\} besten Möglichkeiten/);
  assert.match(appSource, /engineContext: this\.buildAnalysisCoachEngineContext\(\)/);
  assert.match(appSource, /renderLatestMoveAssessment/);
  assert.match(appSource, /Rückblick auf den letzten Zug/);
  assert.match(appSource, /describeMoveAssessment/);
  assert.match(appSource, /perspective-alternative-button/);
  assert.match(appSource, /Genauso gut geht/);
  assert.match(
    appSource,
    /playReviewedAlternative\(review\)[\s\S]*parentNode\.fen !== verified\.fenBefore[\s\S]*this\.applyMove\(/,
  );
  const assessmentStart = appSource.indexOf("  renderLatestMoveAssessment(");
  const assessmentEnd = appSource.indexOf("  getAnalysisPerspective()", assessmentStart);
  const assessmentSource = appSource.slice(assessmentStart, assessmentEnd);
  assert.ok(
    assessmentSource.indexOf("reason.textContent")
      < assessmentSource.indexOf("perspective-move-alternative"),
  );
});

test("Analysechat enthält nur ausdrücklich gestartete Nutzer-Coach-Dialoge", () => {
  const sendStart = appSource.indexOf("  async sendChatMessage(text)");
  const sendEnd = appSource.indexOf("  setChatBusy(", sendStart);
  const sendSource = appSource.slice(sendStart, sendEnd);
  assert.match(sendSource, /appendChatMessage\('user', text\)/);
  assert.match(sendSource, /appendChatMessage\('assistant', reply\.trim\(\),\s*\{/);
  assert.match(appSource, /scheduleSuggestionCoachReasons/);
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

test("Vollanalyse sammelt zwei Kandidaten und lädt KI-Texte erst beim Öffnen eines Zuges", () => {
  const reviewStart = appSource.indexOf("  async startFullGameReview(");
  const reviewEnd = appSource.indexOf("  attachLocalMoveExplanations(", reviewStart);
  const reviewSource = appSource.slice(reviewStart, reviewEnd);
  const attachStart = reviewEnd;
  const attachEnd = appSource.indexOf("  async requestCoachGameFeedback(", attachStart);
  const attachSource = appSource.slice(attachStart, attachEnd);

  assert.match(reviewSource, /multiPV:\s*2/);
  assert.match(reviewSource, /playerColor: reviewPlayerColor/);
  assert.match(appSource, /analysisEntryFromMultiPv/);
  assert.match(attachSource, /buildLocalMoveExplanationBundle/);
  assert.doesNotMatch(attachSource, /requestGroundedMoveExplanation/);
  assert.match(appSource, /item\.setAttribute\("aria-expanded", "true"\)/);
  assert.match(appSource, /requestReviewJourneyCoach/);
});

test("eine verworfene freie Ganzpartie-Antwort lässt den lokalen Abschluss stehen", () => {
  const start = appSource.indexOf("  async requestCoachGameFeedback(");
  const end = appSource.indexOf("  renderFeedbackReport(", start);
  const source = appSource.slice(start, end);
  assert.ok(start >= 0 && end > start);
  assert.match(source, /ENGINE_CONTEXT_MISSING_REPLY/);
  assert.match(source, /ENGINE_CONTEXT_REJECTED_REPLY/);
  assert.match(source, /return ""/);
});

test("KI-Zugerklärungen sind dauerhaft aktiv und besitzen nur einen lokalen Ausfall-Fallback", () => {
  const requestStart = appSource.indexOf("  async requestGroundedMoveExplanation({");
  const requestEnd = appSource.indexOf("  createChatPanel(", requestStart);
  const requestSource = appSource.slice(requestStart, requestEnd);

  assert.match(appSource, /this\.aiMoveExplanationsEnabled = true/);
  assert.doesNotMatch(appSource, /chess-coach\.ai-move-explanations\.enabled/);
  assert.doesNotMatch(appSource, /Nur lokal/);
  assert.match(appSource, /aria-label", "KI-Erklärungen sind aktiv"/);
  assert.match(appSource, /textContent = "KI aktiv"/);
  assert.match(appSource, /computer-ai-status is-active/);
  assert.match(styleSource, /\.computer-ai-status\s*\{/);
  assert.match(appSource, /coachLocalExplanation/);
  assert.match(
    requestSource,
    /if \(!this\.aiMoveExplanationsEnabled\)[\s\S]*explanation: bundle\.localExplanation[\s\S]*source: "local"/,
  );
  assert.match(
    appSource,
    /if \(!this\.aiMoveExplanationsEnabled\) return;[\s\S]*requestGroundedMoveExplanation/,
  );
});

test("freie Coach-Antworten zeigen KI und PGN-Wissen als Herkunft an", () => {
  assert.match(appSource, /"KI · PGN-Wissen"/);
  assert.match(appSource, /"Lokale Antwort"/);
  assert.match(styleSource, /\.coach-message-source/);
});

test("der Coach zeigt die Datengrundlage jeder Antwort sichtbar an", () => {
  assert.match(appSource, /Verwendete Daten/);
  assert.match(appSource, /renderCoachDataSources/);
  assert.match(appSource, /dataSources: data\?\.dataSources \|\| null/);
  assert.match(appSource, /Gleiche Eröffnung und Bauernstruktur|PGN-Sammlung/);
  assert.match(appSource, /PGN-Fakten freigegeben/);
  assert.match(styleSource, /\.coach-data-sources\s*\{/);
  assert.match(appSource, /this\.coachDataSourcesEl\.hidden = false/);
  assert.match(appSource, /currentRecommendationDataSources/);
  assert.match(appSource, /Datengrundlage: \$\{sources\.contextLabel\}/);
  assert.doesNotMatch(appSource, /nach der nächsten Antwort/);
});

test("bekannte Eröffnungen zeigen Datenbankoptionen ohne besten Engine-Zug", () => {
  assert.match(appSource, /openingContinuationsForPath/);
  assert.match(appSource, /openingReviewForPath/);
  assert.match(appSource, /Mehrere gute Eröffnungswege/);
  assert.match(appSource, /Hier gibt es nicht den einen besten Zug/);
  assert.match(appSource, /ohne Engine-Rangliste/);
  assert.match(appSource, /Spielbare Eröffnungswahl/);
  assert.match(appSource, /Gängige Alternative/);
  assert.match(styleSource, /\.suggestion-line\.is-opening-option/);
  assert.match(styleSource, /\.perspective-move-assessment\.is-opening-book/);

  const openingReviewStart = appSource.indexOf("  renderOpeningMoveAssessment(");
  const openingReviewEnd = appSource.indexOf("  renderLatestMoveAssessment(", openingReviewStart);
  const openingReviewSource = appSource.slice(openingReviewStart, openingReviewEnd);
  assert.match(openingReviewSource, /Lokale Datenbank/);
  assert.doesNotMatch(openingReviewSource, /Bester Zug|beste[rn]? Zug|Engine-Rangliste/);

  const latestAssessmentStart = openingReviewEnd;
  const latestAssessmentEnd = appSource.indexOf("  getAnalysisPerspective()", latestAssessmentStart);
  const latestAssessmentSource = appSource.slice(latestAssessmentStart, latestAssessmentEnd);
  assert.ok(
    latestAssessmentSource.indexOf("renderOpeningMoveAssessment")
      < latestAssessmentSource.indexOf("getLatestVerifiedMoveReview"),
  );
});

test("der letzte Zug zeigt bei Fehlern zuerst die konkrete taktische Begründung", () => {
  assert.match(appSource, /const directErrorClaim = isError/);
  assert.match(appSource, /directErrorClaim\?\.text \|\|/);
  assert.doesNotMatch(appSource, /Das Problem dabei: Der Zug lässt die dringendere Aufgabe/);
});

test("KI-Zugerklärungen sind auf zwei Anfragen begrenzt und bei Kontextwechseln abbrechbar", () => {
  assert.match(appSource, /this\.moveExplanationConcurrency = 2/);
  assert.match(appSource, /acquireMoveExplanationSlot/);
  assert.match(appSource, /releaseMoveExplanationSlot/);
  assert.match(
    appSource,
    /this\.moveExplanationControllers\.forEach\(\(controller\) => controller\.abort\(\)\)/,
  );
  assert.match(appSource, /this\.moveExplanationControllers\.clear\(\)/);
});

test("Computererklärung zeigt semantisch Urteil, Idee und Alternative ungefiltert", () => {
  const start = appSource.indexOf("  renderComputerExplanation({");
  const end = appSource.indexOf("  createSuggestionCoachPopover(", start);
  const source = appSource.slice(start, end);

  assert.match(source, /\["verdict", "assessment"\]/);
  assert.match(source, /\["moveIdea", "move_effect"\]/);
  assert.match(source, /\["alternative", "alternative"\]/);
  assert.match(source, /\["opponentReply", "variation"\]/);
  assert.match(source, /\["comparison", "position_change"\]/);
  assert.match(source, /\["takeaway", "principle"\]/);
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
