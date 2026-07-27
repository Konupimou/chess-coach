import test from "node:test";
import assert from "node:assert/strict";
import { ChessApp } from "../app.js";

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function pathFromMoves(moves, finalFen = "shared-final-fen") {
  const path = [{ fen: "root-fen", move: null }];
  moves.forEach((uci, index) => {
    path.push({
      fen: index === moves.length - 1 ? finalFen : `position-${uci}`,
      move: {
        from: uci.slice(0, 2),
        to: uci.slice(2, 4),
        promotion: uci.slice(4) || undefined,
      },
    });
  });
  return path;
}

function chatApp(initialPath) {
  const app = Object.create(ChessApp.prototype);
  let currentPath = initialPath;
  app.chatBusy = false;
  app.chatMessages = [];
  app.chatRequestController = null;
  app.coachGameGeneration = 7;
  app.activeGameId = "game-1";
  app.getCurrentPath = () => currentPath;
  app.setCurrentPathForTest = (path) => {
    currentPath = path;
  };
  app.game = {
    fen: () => currentPath.at(-1)?.fen || "",
    history: () => currentPath.slice(1).map((node) => (
      `${node.move.from}${node.move.to}${node.move.promotion || ""}`
    )),
  };
  app.appendChatMessage = (role, content) => {
    app.chatMessages.push({
      role,
      content,
      gameGeneration: app.coachGameGeneration,
    });
  };
  app.setChatBusy = (state) => {
    app.chatBusy = Boolean(state);
  };
  app.buildAnalysisCoachEngineContext = () => ({ kind: "position" });
  app.buildOpeningCoachContext = () => ({ matched: false });
  app.getCoachLearnerProfile = () => ({ level: "beginner" });
  return app;
}

async function settleChatRequest({
  mutate = () => {},
  outcome = "reply",
} = {}) {
  const originalPath = pathFromMoves(["e2e4", "e7e5"]);
  const app = chatApp(originalPath);
  const request = deferred();
  globalThis.fetch = () => request.promise;
  const pending = app.sendChatMessage("Was ist hier der Plan?");

  mutate(app, originalPath);
  if (outcome === "error") {
    request.reject(new Error("Netzfehler"));
  } else {
    request.resolve({
      ok: true,
      async json() {
        return { reply: "Aktuelle Antwort" };
      },
    });
  }
  await pending;
  return app.chatMessages;
}

test("Chat-Antworten und Fehler gehören zur exakten angefragten Brettidentität", async (t) => {
  const originalFetch = globalThis.fetch;
  const originalConsoleError = console.error;
  t.after(() => {
    globalThis.fetch = originalFetch;
    console.error = originalConsoleError;
  });
  console.error = () => {};

  for (const outcome of ["reply", "error"]) {
    const currentMessages = await settleChatRequest({ outcome });
    assert.deepEqual(
      currentMessages.map((message) => message.role),
      ["user", "assistant"],
      `aktueller ${outcome === "reply" ? "Erfolg" : "Fehler"}`,
    );

    const changedGeneration = await settleChatRequest({
      outcome,
      mutate(app) {
        app.coachGameGeneration += 1;
      },
    });
    assert.deepEqual(
      changedGeneration.map((message) => message.role),
      ["user"],
      `veraltete Generation bei ${outcome}`,
    );

    const changedFen = await settleChatRequest({
      outcome,
      mutate(app) {
        app.setCurrentPathForTest(
          pathFromMoves(["e2e4", "e7e5"], "different-final-fen"),
        );
      },
    });
    assert.deepEqual(
      changedFen.map((message) => message.role),
      ["user"],
      `veraltete FEN bei ${outcome}`,
    );

    const changedPath = await settleChatRequest({
      outcome,
      mutate(app) {
        app.setCurrentPathForTest(
          pathFromMoves(["d2d4", "d7d5"], "shared-final-fen"),
        );
      },
    });
    assert.deepEqual(
      changedPath.map((message) => message.role),
      ["user"],
      `anderer Variantenpfad mit gleicher FEN bei ${outcome}`,
    );
  }
});

function reviewCoachElement() {
  const ownerDocument = {
    createElement() {
      return { textContent: "" };
    },
    createTextNode(text) {
      return { textContent: text };
    },
  };
  return {
    ownerDocument,
    renderedText: "",
    replaceChildren() {
      this.renderedText = "";
    },
    appendChild(node) {
      this.renderedText += node?.textContent || "";
    },
  };
}

function reviewApp(journey, request) {
  const app = Object.create(ChessApp.prototype);
  app.reviewJourney = journey;
  app.reviewJourneyCoachController = null;
  app.reviewJourneyCoachEl = reviewCoachElement();
  app.coachConfigured = true;
  app.buildMoveCoachEngineContext = () => ({ kind: "move_review" });
  app.buildOpeningCoachContext = () => ({ matched: false });
  app.buildLocalMoveExplanationBundle = () => ({ key: "review-key" });
  app.requestGroundedMoveExplanation = () => request.promise;
  return app;
}

function reviewResult(text = "Belegte Coach-Antwort") {
  return {
    explanation: {
      headline: "",
      summary: [{ text }],
      deepDive: [],
    },
  };
}

test("Review-Coach schreibt ein spätes Ergebnis nur in dieselbe Journey und denselben Moment", async () => {
  const originalMoment = { ply: 4, playedUci: "g1f3", fenBefore: "fen-a" };

  {
    const request = deferred();
    const originalJourney = {
      path: [],
      moments: [originalMoment],
      index: 0,
      coachTexts: new Map(),
    };
    const app = reviewApp(originalJourney, request);
    const pending = app.requestReviewJourneyCoach(originalMoment, "fen-a");
    const replacementJourney = {
      path: [],
      moments: [{ ply: 4, playedUci: "d2d4", fenBefore: "fen-b" }],
      index: 0,
      coachTexts: new Map(),
    };
    app.reviewJourney = replacementJourney;
    request.resolve(reviewResult());
    await pending;

    assert.equal(originalJourney.coachTexts.size, 0);
    assert.equal(replacementJourney.coachTexts.size, 0);
  }

  {
    const request = deferred();
    const journey = {
      path: [],
      moments: [originalMoment],
      index: 0,
      coachTexts: new Map(),
    };
    const app = reviewApp(journey, request);
    const pending = app.requestReviewJourneyCoach(originalMoment, "fen-a");
    journey.moments[0] = {
      ply: 4,
      playedUci: "d2d4",
      fenBefore: "fen-b",
    };
    request.resolve(reviewResult());
    await pending;

    assert.equal(app.reviewJourneyCoachEl.renderedText, "");

    const replacementRequest = deferred();
    let replacementRequests = 0;
    app.requestGroundedMoveExplanation = () => {
      replacementRequests += 1;
      return replacementRequest.promise;
    };
    const replacementMoment = journey.moments[0];
    const replacementPending = app.requestReviewJourneyCoach(
      replacementMoment,
      "fen-b",
    );
    assert.equal(replacementRequests, 1);
    replacementRequest.resolve(reviewResult("Antwort für den neuen Moment"));
    await replacementPending;
    assert.equal(
      app.reviewJourneyCoachEl.renderedText,
      "Antwort für den neuen Moment",
    );
  }

  {
    const request = deferred();
    const journey = {
      path: [],
      moments: [originalMoment],
      index: 0,
      coachTexts: new Map(),
    };
    const app = reviewApp(journey, request);
    const pending = app.requestReviewJourneyCoach(originalMoment, "fen-a");
    request.resolve(reviewResult("Aktueller Moment"));
    await pending;

    assert.equal(journey.coachTexts.size, 1);
    assert.equal(app.reviewJourneyCoachEl.renderedText, "Aktueller Moment");
  }
});

test("die Partiekarte zeigt die aktuelle sichere Eröffnung vor einer älteren Präsentation", () => {
  const app = Object.create(ChessApp.prototype);
  app.appMode = "analysis";
  app.playSession = null;
  app.openingManualOverride = false;
  app.openingLifecycle = null;
  app.openingRecordLifecycle = {
    current: {
      matched: true,
      displayName: "Aktuelle sichere Eröffnung",
    },
    presentation: { fullDisplay: "Frühere eingefrorene Eröffnung" },
  };
  app.gameSaveDraft = {
    opening: "Alter automatischer Wert",
    result: "*",
  };
  app.accountState = { profile: { name: "Paul" } };
  app.whitePlayerInput = null;
  app.blackPlayerInput = null;
  app.playedAtDisplayEl = null;
  app.resultDisplayEl = null;
  app.detectedOpeningEl = { textContent: "", title: "" };
  app.openingBookError = "";
  app.getGameResult = () => "*";

  app.updateBoardContext();

  assert.equal(
    app.detectedOpeningEl.textContent,
    "Aktuelle sichere Eröffnung",
  );
  assert.equal(
    app.detectedOpeningEl.title,
    "Aktuelle sichere Eröffnung",
  );
});
