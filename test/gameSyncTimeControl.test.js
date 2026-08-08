import test from "node:test";
import assert from "node:assert/strict";
import { classifyTimeControl, parseTimeControl } from "../gameSync/timeControl.js";

test("canonical time controls classify bullet, blitz, rapid, and classical", () => {
  assert.equal(classifyTimeControl({ initialSeconds: 60 }).category, "bullet");
  assert.equal(classifyTimeControl({ initialSeconds: 180 }).category, "blitz");
  assert.equal(classifyTimeControl({ initialSeconds: 600 }).category, "rapid");
  assert.equal(classifyTimeControl({ initialSeconds: 1_800 }).category, "classical");
});

test("increments and unusual provider values remain auditable", () => {
  const custom = classifyTimeControl({ raw: "180+10", providerCategory: "custom" });
  assert.equal(custom.category, "rapid");
  assert.equal(custom.initialSeconds, 180);
  assert.equal(custom.incrementSeconds, 10);
  assert.equal(custom.providerCategory, "custom");
  assert.equal(custom.raw, "180+10");
  assert.equal(classifyTimeControl({ providerCategory: "ultraBullet" }).category, "bullet");
  assert.equal(classifyTimeControl({ raw: "not-a-clock" }).category, "unknown");
});

test("correspondence clocks are parsed independently from live clocks", () => {
  assert.deepEqual(parseTimeControl("1/259200"), {
    initialSeconds: null,
    incrementSeconds: null,
    correspondenceDaysPerTurn: 3,
  });
  assert.equal(classifyTimeControl({ raw: "1/259200" }).category, "correspondence");
  const explicit = classifyTimeControl({
    ...parseTimeControl("1/259200"),
    raw: "1/259200",
    providerCategory: "daily",
  });
  assert.equal(explicit.initialSeconds, null);
  assert.equal(explicit.incrementSeconds, null);
});
