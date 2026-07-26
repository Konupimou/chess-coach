import test from "node:test";
import assert from "node:assert/strict";
import {
  buildPrompt,
  extractResponseText,
  normalizeChatPayload,
  requestCoachResponse,
} from "../api/chat.js";

const engineContext = {
  source: "stockfish",
  kind: "position",
  fen: "start",
  depth: 18,
  evaluation: { unit: "cp", value: 42 },
  bestMove: { uci: "g1f3", san: "Nf3" },
  primaryVariation: {
    uci: ["g1f3", "b8c6", "f1b5"],
    san: ["Nf3", "Nc6", "Bb5"],
  },
  lines: [{
    rank: 1,
    depth: 18,
    evaluation: { unit: "cp", value: 42 },
    bestMove: { uci: "g1f3", san: "Nf3" },
    pv: {
      uci: ["g1f3", "b8c6", "f1b5"],
      san: ["Nf3", "Nc6", "Bb5"],
    },
  }],
};

test("Chat-Payload wird begrenzt und normalisiert", () => {
  const result = normalizeChatPayload({
    message: "  Was ist mein Plan?  ",
    engineContext,
    history: ["e4", "e5"],
    conversation: [{ role: "assistant", content: "Entwickle deine Figuren." }],
    gameReview: {
      overallAccuracy: 88.4,
      analyzedMoves: 20,
      totalMoves: 20,
      criticalMoments: [{ move: "12. Qh5", lossCp: 180 }],
    },
  });
  assert.equal(result.value.message, "Was ist mein Plan?");
  assert.equal(result.value.engineContext.source, "stockfish");
  assert.equal(result.value.engineContext.bestMove.uci, "g1f3");
  assert.deepEqual(result.value.history, ["e4", "e5"]);
  assert.deepEqual(result.value.engineContext.primaryVariation.san, ["Nf3", "Nc6", "Bb5"]);
  assert.equal(result.value.gameReview.overallAccuracy, 88.4);
  assert.equal(normalizeChatPayload({ message: "  " }).error, "Bitte gib eine Frage ein.");
});

test("Prompt trennt vertrauenswürdige Anweisungen von Stellungsdaten", () => {
  const prompt = buildPrompt({
    message: "Warum ist Nf3 gut?",
    engineContext,
    history: ["e4", "e5"],
    conversation: [],
    gameReview: { overallAccuracy: 91.2, criticalMoments: [] },
  });
  assert.match(prompt, /<stockfish_analysis>/);
  assert.match(prompt, /"bestMove":\{"uci":"g1f3","san":"Nf3"\}/);
  assert.match(prompt, /<user_question>\nWarum ist Nf3 gut\?/);
  assert.match(prompt, /<game_review_statistics>/);
});

test("Responses API wird ohne Speicherung und mit Safety Identifier aufgerufen", async () => {
  let request;
  const reply = await requestCoachResponse(
    {
      message: "Plan?",
      engineContext,
      history: [],
      conversation: [],
    },
    {
      apiKey: "test-key",
      model: "test-model",
      safetyIdentifier: "safe-user",
      fetchImpl: async (url, options) => {
        request = { url, options, body: JSON.parse(options.body) };
        return {
          ok: true,
          async json() {
            return { output_text: "Aktiviere deine Figuren." };
          },
        };
      },
    },
  );

  assert.equal(reply, "Aktiviere deine Figuren.");
  assert.equal(request.url, "https://api.openai.com/v1/responses");
  assert.equal(request.body.model, "test-model");
  assert.equal(request.body.store, false);
  assert.equal(request.body.safety_identifier, "safe-user");
  assert.match(request.body.instructions, /kein Schachspieler/);
  assert.match(request.body.instructions, /Stockfish ist die einzige Quelle/);
  assert.match(request.body.instructions, /Erfinde keine Alternative/);
  assert.equal(request.body.text.verbosity, "low");
  assert.equal(request.options.headers.Authorization, "Bearer test-key");
});

test("Coach rät ohne vollständige Engine-PV nicht und verwirft erfundene Züge", async () => {
  let calls = 0;
  const missing = await requestCoachResponse(
    {
      message: "Was soll ich spielen?",
      engineContext: null,
      history: [],
      conversation: [],
    },
    {
      apiKey: "test-key",
      fetchImpl: async () => {
        calls += 1;
        throw new Error("darf nicht aufgerufen werden");
      },
    },
  );
  assert.match(missing, /keine vollständige Stockfish-Analyse/);
  assert.equal(calls, 0);

  const rejected = await requestCoachResponse(
    {
      message: "Erkläre die PV.",
      engineContext,
      history: [],
      conversation: [],
    },
    {
      apiKey: "test-key",
      fetchImpl: async () => ({
        ok: true,
        async json() {
          return { output_text: "Ich würde stattdessen d4 spielen." };
        },
      }),
    },
  );
  assert.match(rejected, /verworfen/);
});

test("Text kann aus Responses-Output-Items gelesen werden", () => {
  assert.equal(
    extractResponseText({
      output: [{
        content: [{ type: "output_text", text: "Erster Absatz." }],
      }],
    }),
    "Erster Absatz.",
  );
});
