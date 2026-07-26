import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const appSource = readFileSync(new URL("../app.js", import.meta.url), "utf8");

test("Vorschläge erhalten Coach-Gründe und eine grafische Vorschau", () => {
  assert.match(appSource, /requestSuggestionCoachReasons/);
  assert.match(appSource, /Coach-Idee:/);
  assert.match(appSource, /Coach-Vorschau/);
  assert.match(appSource, /selectImpactArrowMoves/);
});

test("Live-Coach bewertet jeden Spielerzug und erlaubt Nachfragen", () => {
  assert.match(appSource, /requestAutomaticPlayCoachFeedback/);
  assert.match(appSource, /handlePlayCoachReply/);
  assert.match(appSource, /Coach-Zug am Brett zeigen/);
  assert.match(appSource, /previewCoachMove/);
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
