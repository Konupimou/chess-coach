import test from "node:test";
import assert from "node:assert/strict";
import { ChessApp } from "../app.js";
import { createAccountState } from "../gameStorage.js";

function memoryStorage() {
  const values = new Map();
  return {
    getItem(key) {
      return values.get(key) || null;
    },
    setItem(key, value) {
      values.set(key, value);
    },
  };
}

const rapidGame = {
  id: "Focused123",
  rated: true,
  variant: "standard",
  speed: "rapid",
  perf: "rapid",
  createdAt: Date.UTC(2026, 6, 20, 18, 30),
  status: "resign",
  winner: "white",
  moves: "e4 e5 Nf3 Nc6 Bb5 a6",
  players: {
    white: { user: { id: "paul", name: "Paul" }, rating: 1720 },
    black: { user: { id: "opponent", name: "Opponent" }, rating: 1690 },
  },
  opening: { eco: "C60", name: "Ruy Lopez" },
  clock: { initial: 600, increment: 5 },
};

test("eine einzeln ausgewählte Lichess-Partie wird nach dem Import direkt analysiert", () => {
  const app = Object.create(ChessApp.prototype);
  app.lichessImportBusy = false;
  app.lichessConnection = { user: { username: "Paul" } };
  app.lichessFetchedGames = [rapidGame];
  app.lichessImportResultsEl = {
    querySelectorAll: () => [{ value: rapidGame.id }],
  };
  app.browserStorage = memoryStorage();
  app.accountStorageKey = "focused-test";
  app.accountState = createAccountState({ name: "Paul" });
  app.updateAccountButton = () => {};
  app.showToast = () => {};
  app.lichessImportDialog = { close: () => {} };
  let openedRecord = null;
  let analysisStarts = 0;
  app.openSavedGame = (record) => {
    openedRecord = record;
    return true;
  };
  app.startFullGameReview = () => {
    analysisStarts += 1;
  };
  const originalAnimationFrame = globalThis.requestAnimationFrame;
  globalThis.requestAnimationFrame = (callback) => callback();

  try {
    app.importSelectedLichessGames();
  } finally {
    globalThis.requestAnimationFrame = originalAnimationFrame;
  }

  assert.equal(openedRecord?.id, "lichess:Focused123");
  assert.equal(analysisStarts, 1);
  assert.equal(app.lichessReturnToAccount, false);
});

test("abgebrochenes Öffnen behauptet nicht, dass die Analyse gestartet wurde", () => {
  const app = Object.create(ChessApp.prototype);
  app.lichessImportBusy = false;
  app.lichessConnection = { user: { username: "Paul" } };
  app.lichessFetchedGames = [rapidGame];
  app.lichessImportResultsEl = {
    querySelectorAll: () => [{ value: rapidGame.id }],
  };
  app.browserStorage = memoryStorage();
  app.accountStorageKey = "focused-cancelled-test";
  app.accountState = createAccountState({ name: "Paul" });
  app.updateAccountButton = () => {};
  app.lichessReturnToAccount = true;
  let toast = "";
  let analysisStarts = 0;
  let closed = false;
  app.showToast = (message) => {
    toast = message;
  };
  app.lichessImportDialog = {
    close: () => {
      closed = true;
    },
  };
  app.openSavedGame = () => false;
  app.startFullGameReview = () => {
    analysisStarts += 1;
  };

  app.importSelectedLichessGames();

  assert.equal(analysisStarts, 0);
  assert.equal(closed, true);
  assert.equal(app.lichessReturnToAccount, true);
  assert.match(toast, /Profil/);
  assert.doesNotMatch(toast, /Analyse startet/);
});
