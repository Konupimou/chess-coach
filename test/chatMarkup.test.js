import test from "node:test";
import assert from "node:assert/strict";
import {
  parseChatBoldMarkup,
  renderChatMarkup,
} from "../chatMarkup.js";

test("doppelte Sternchen werden als Fett-Segmente erkannt", () => {
  assert.deepEqual(
    parseChatBoldMarkup("Spiele **e4** und entwickle **zügig**."),
    [
      { text: "Spiele ", strong: false },
      { text: "e4", strong: true },
      { text: " und entwickle ", strong: false },
      { text: "zügig", strong: true },
      { text: ".", strong: false },
    ],
  );
});

test("unvollständige Sternchen bleiben sichtbar", () => {
  assert.deepEqual(
    parseChatBoldMarkup("Das ist **noch offen."),
    [{ text: "Das ist **noch offen.", strong: false }],
  );
});

test("Chat-Markup erzeugt nur sichere Text- und strong-Knoten", () => {
  const documentRef = {
    createElement(tagName) {
      return { nodeType: 1, tagName: tagName.toUpperCase(), textContent: "" };
    },
    createTextNode(textContent) {
      return { nodeType: 3, textContent };
    },
  };
  const container = {
    ownerDocument: documentRef,
    children: [],
    replaceChildren() {
      this.children = [];
    },
    appendChild(child) {
      this.children.push(child);
    },
  };

  renderChatMarkup(container, '<img src=x> **sicher**');

  assert.deepEqual(container.children, [
    { nodeType: 3, textContent: "<img src=x> " },
    { nodeType: 1, tagName: "STRONG", textContent: "sicher" },
  ]);
});
