import test from "node:test";
import assert from "node:assert/strict";
import {
  buildPrompt,
  extractResponseText,
  normalizeChatPayload,
  requestCoachResponse,
} from "../api/chat.js";

test("Chat-Payload wird begrenzt und normalisiert", () => {
  const result = normalizeChatPayload({
    message: "  Was ist mein Plan?  ",
    evalPawns: 0.42,
    history: ["e4", "e5"],
    suggestions: [{ score: "+0.42", moves: ["Nf3", "Nc6"] }],
    conversation: [{ role: "assistant", content: "Entwickle deine Figuren." }],
  });
  assert.equal(result.value.message, "Was ist mein Plan?");
  assert.equal(result.value.evalPawns, 0.42);
  assert.deepEqual(result.value.history, ["e4", "e5"]);
  assert.equal(normalizeChatPayload({ message: "  " }).error, "Bitte gib eine Frage ein.");
});

test("Prompt trennt vertrauenswürdige Anweisungen von Stellungsdaten", () => {
  const prompt = buildPrompt({
    message: "Warum ist Nf3 gut?",
    fen: "fen",
    evalPawns: 0.2,
    suggestions: [{ score: "+0.20", moves: ["Nf3"] }],
    history: ["e4", "e5"],
    conversation: [],
  });
  assert.match(prompt, /<position_fen>\nfen\n<\/position_fen>/);
  assert.match(prompt, /<white_evaluation_pawns>0\.20/);
  assert.match(prompt, /<user_question>\nWarum ist Nf3 gut\?/);
});

test("Responses API wird ohne Speicherung und mit Safety Identifier aufgerufen", async () => {
  let request;
  const reply = await requestCoachResponse(
    {
      message: "Plan?",
      fen: "",
      evalPawns: null,
      suggestions: [],
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
  assert.equal(request.options.headers.Authorization, "Bearer test-key");
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
