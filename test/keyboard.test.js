import test from "node:test";
import assert from "node:assert/strict";
import { attachKeyboard } from "../keyboard.js";

function installFakeWindow() {
  let handler;
  globalThis.window = {
    addEventListener(type, next) {
      if (type === "keydown") handler = next;
    },
    removeEventListener(type, next) {
      if (type === "keydown" && handler === next) handler = undefined;
    },
  };
  return {
    dispatch(event) {
      handler?.(event);
    },
    hasHandler() {
      return Boolean(handler);
    },
  };
}

function event(key, target = { tagName: "DIV", isContentEditable: false }) {
  return {
    key,
    target,
    altKey: false,
    ctrlKey: false,
    metaKey: false,
    prevented: false,
    preventDefault() {
      this.prevented = true;
    },
  };
}

test("Pfeiltasten navigieren und detach entfernt den Handler", () => {
  const fakeWindow = installFakeWindow();
  const calls = [];
  const detach = attachKeyboard({
    onLeft: () => calls.push("left"),
    onRight: () => calls.push("right"),
    onUp: () => calls.push("up"),
    onDown: () => calls.push("down"),
  });

  for (const key of ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"]) {
    const current = event(key);
    fakeWindow.dispatch(current);
    assert.equal(current.prevented, true);
  }
  assert.deepEqual(calls, ["left", "right", "up", "down"]);

  detach();
  assert.equal(fakeWindow.hasHandler(), false);
  delete globalThis.window;
});

test("Eingabefelder und Modifier behalten ihre Pfeiltasten", () => {
  const fakeWindow = installFakeWindow();
  let calls = 0;
  const detach = attachKeyboard({ onLeft: () => { calls += 1; } });

  for (const target of [
    { tagName: "INPUT", isContentEditable: false },
    { tagName: "TEXTAREA", isContentEditable: false },
    { tagName: "SELECT", isContentEditable: false },
    { tagName: "DIV", isContentEditable: true },
  ]) {
    const current = event("ArrowLeft", target);
    fakeWindow.dispatch(current);
    assert.equal(current.prevented, false);
  }

  const modified = event("ArrowLeft");
  modified.metaKey = true;
  fakeWindow.dispatch(modified);
  assert.equal(calls, 0);

  detach();
  delete globalThis.window;
});

test("offene Dialoge sperren die Navigation im Hintergrund", () => {
  const fakeWindow = installFakeWindow();
  globalThis.document = {
    querySelector(selector) {
      return selector === "dialog[open]" ? {} : null;
    },
  };
  let calls = 0;
  const detach = attachKeyboard({ onLeft: () => { calls += 1; } });
  const current = event("ArrowLeft");
  fakeWindow.dispatch(current);
  assert.equal(current.prevented, false);
  assert.equal(calls, 0);
  detach();
  delete globalThis.document;
  delete globalThis.window;
});
