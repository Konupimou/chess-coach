import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const appSource = readFileSync(new URL("../app.js", import.meta.url), "utf8");

test("Partien werden ausschließlich über den bestätigten Speicherdialog geschrieben", () => {
  const explicitCalls = [...appSource.matchAll(/this\.saveCurrentGame\(\)/g)];
  assert.equal(explicitCalls.length, 1);

  const callIndex = explicitCalls[0].index;
  const surroundingCode = appSource.slice(Math.max(0, callIndex - 180), callIndex + 40);
  assert.match(surroundingCode, /form\.addEventListener\('submit'/);
  assert.doesNotMatch(appSource, /handleMove[\s\S]{0,1800}this\.saveCurrentGame\(\)/);
  assert.doesNotMatch(appSource, /destroy\(\)[\s\S]{0,500}this\.saveCurrentGame\(\)/);
});

test("Accountwechsel und frühe Partiedaten respektieren den manuellen Entwurf", () => {
  const identityStart = appSource.indexOf("async initializeAccountIdentity()");
  const identityEnd = appSource.indexOf("updateAccountButton()", identityStart);
  const identityCode = appSource.slice(identityStart, identityEnd);
  assert.doesNotMatch(identityCode, /saveAccountState\(/);
  assert.match(appSource, /hasUnsavedGameChanges\(\)[\s\S]{0,180}this\.gameSaveDraftDirty/);
  assert.match(appSource, /this\.gameSaveDraftDirty = true/);
});

test("Lichess-Partien werden nur über den ausdrücklichen Import-Button gespeichert", () => {
  const importCall = appSource.indexOf(
    'this.lichessImportButton.addEventListener("click", () => this.importSelectedLichessGames())',
  );
  assert.ok(importCall >= 0);
  const importMethod = appSource.slice(
    appSource.indexOf("  importSelectedLichessGames()"),
    appSource.indexOf("  async initializeAccountIdentity()", importCall),
  );
  assert.match(importMethod, /saveAccountState\(/);
  assert.doesNotMatch(
    appSource.slice(
      appSource.indexOf("  loadLichessGames()"),
      appSource.indexOf("  renderLichessImportResults"),
    ),
    /saveAccountState\(/,
  );
});
