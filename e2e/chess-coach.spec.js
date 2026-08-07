import { expect, test } from "@playwright/test";

async function dragPiece(page, from, to) {
  const piece = page.locator(`.square-${from} .piece-417db`);
  const target = page.locator(`.square-${to}`);
  const fromBox = await piece.boundingBox();
  const toBox = await target.boundingBox();

  expect(fromBox, `Figur auf ${from} fehlt`).not.toBeNull();
  expect(toBox, `Zielfeld ${to} fehlt`).not.toBeNull();

  await page.mouse.move(
    fromBox.x + fromBox.width / 2,
    fromBox.y + fromBox.height / 2,
  );
  await page.mouse.down();
  await page.mouse.move(
    toBox.x + toBox.width / 2,
    toBox.y + toBox.height / 2,
    { steps: 12 },
  );
  await page.mouse.up();
}

async function clickMove(page, from, to) {
  await page.locator(`.square-${from}`).click();
  await page.locator(`.square-${to}`).click();
}

test("lädt Brett, Coach und Stockfish ohne Mehrkern-Timeout", async ({ page }) => {
  const consoleMessages = [];
  const pageErrors = [];
  page.on("console", (message) => consoleMessages.push(message.text()));
  page.on("pageerror", (error) => pageErrors.push(error.message));

  const response = await page.goto("/");
  expect(response?.status()).toBe(200);
  expect(response?.headers()["cross-origin-opener-policy"]).toBe("same-origin");

  await expect(page.locator("#board")).toBeVisible();
  await expect(page.locator("#board .square-55d63")).toHaveCount(64);
  await expect(page.locator("#board .piece-417db")).toHaveCount(32);
  await expect(page.locator("#analysis-panel")).toHaveAttribute("aria-valuenow", /-?\d+(\.\d+)?/);

  await expect.poll(() => consoleMessages.some((line) => (
    line.includes("Using Stockfish 18 Lite (single-thread)")
  ))).toBe(true);
  expect(consoleMessages.some((line) => line.includes("multi-thread):"))).toBe(false);
  expect(consoleMessages.some((line) => line.includes("Handshake timeout"))).toBe(false);
  expect(pageErrors).toEqual([]);

  const health = await page.request.get("/api/health");
  expect(health.status()).toBe(200);
  await expect(health.json()).resolves.toMatchObject({
    ok: true,
    coachConfigured: true,
  });
});

test("spielt e2-e4 und aktualisiert Zugliste sowie Coach-Erklärung", async ({ page }) => {
  await page.route("**/api/stage-four", (route) => route.fulfill({
    status: 503,
    contentType: "application/json",
    body: JSON.stringify({ error: "E2E test uses the local safe explanation" }),
  }));

  await page.goto("/");
  await expect(page.locator("#analysis-panel")).toHaveAttribute("aria-valuenow", /-?\d+(\.\d+)?/);

  await dragPiece(page, "e2", "e4");

  await expect(page.locator("#move-list .move-san")).toContainText(["e4"]);
  await expect(page.locator(".square-e2 .piece-417db")).toHaveCount(0);
  await expect(page.locator(".square-e4 .piece-417db")).toHaveCount(1);
  await expect(page.locator("#stage-four-facts .pattern-group")).toHaveCount(2);
  await expect(page.locator("#stage-four-coach")).toBeVisible();
  await expect(page.locator("#stage-four-coach-text")).not.toHaveText("");
  await expect(page.locator("#stage-four-feedback")).toBeVisible();
});

test("Schäfermatt wird per Klick bedient und zeitlich korrekt erklärt", async ({ page }) => {
  test.setTimeout(120_000);
  await page.route("**/api/stage-four", (route) => route.fulfill({
    status: 503,
    contentType: "application/json",
    body: JSON.stringify({ error: "E2E test uses the local safe explanation" }),
  }));
  await page.goto("/");
  await expect(page.locator("#analysis-panel")).toHaveAttribute("aria-valuenow", /-?\d+(\.\d+)?/);

  for (const [from, to] of [
    ["e2", "e4"], ["e7", "e5"], ["d1", "h5"], ["b8", "c6"],
    ["f1", "c4"], ["g8", "f6"],
  ]) {
    await clickMove(page, from, to);
    await expect(page.locator(".stage-four-pending")).toBeHidden({ timeout: 20_000 });
  }

  await expect(page.locator("#move-list .move-san")).toContainText(["e4", "e5", "Qh5", "Nc6", "Bc4", "Nf6"]);
  await expect(page.locator("#stage-four-coach-text")).toContainText(/Weiß.*Qxf7#.*mattsetzen|Matt in einem.*Qxf7#/i, { timeout: 30000 });
  await expect(page.locator("#stage-four-coach-text")).not.toContainText("Das ist Matt! Aus und vorbei");

  await clickMove(page, "h5", "f7");
  await expect(page.locator("#stage-four-coach-text")).toContainText(/Matt|Schachmatt/, { timeout: 30000 });
  await expect(page.locator("#stage-four-facts")).not.toContainText("Qxf7# ist ein bekannter Eröffnungszug");
  const feedbackDialog = page.locator("#game-feedback-dialog");
  if (await feedbackDialog.isVisible()) {
    await page.getByRole("button", { name: "Partieanalyse schließen" }).click();
  }

  await page.getByRole("button", { name: "Zug Qh5 ansehen" }).click();
  await expect(page.locator("#return-current-position")).toBeVisible();
  await page.locator("#return-current-position").click();
  await expect(page.locator(".square-f7 .piece-417db")).toHaveCount(1);
});

test("navigiert gespielte Züge mit den Pfeiltasten vor und zurück", async ({ page }) => {
  await page.route("**/api/stage-four", (route) => route.fulfill({
    status: 503,
    contentType: "application/json",
    body: JSON.stringify({ error: "E2E test uses the local safe explanation" }),
  }));

  await page.goto("/");
  await expect(page.locator("#analysis-panel")).toHaveAttribute("aria-valuenow", /-?\d+(\.\d+)?/);
  await dragPiece(page, "e2", "e4");
  await dragPiece(page, "e7", "e5");
  await expect(page.locator("#move-list .move-san")).toContainText(["e4", "e5"]);

  await page.keyboard.press("ArrowLeft");
  await expect(page.locator(".square-e7 .piece-417db")).toHaveCount(1);
  await expect(page.locator(".square-e5 .piece-417db")).toHaveCount(0);

  await page.keyboard.press("ArrowRight");
  await expect(page.locator(".square-e7 .piece-417db")).toHaveCount(0);
  await expect(page.locator(".square-e5 .piece-417db")).toHaveCount(1);
});

test("bleibt auf einem schmalen Bildschirm ohne horizontales Überlaufen bedienbar", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");

  await expect(page.locator("#board")).toBeVisible();
  await expect(page.locator("#stage-four-explanation")).toBeVisible();
  await expect(page.locator(".move-list-section")).toBeVisible();

  const layout = await page.evaluate(() => ({
    viewportWidth: window.innerWidth,
    documentWidth: document.documentElement.scrollWidth,
    boardWidth: document.getElementById("board")?.getBoundingClientRect().width || 0,
  }));
  expect(layout.documentWidth).toBeLessThanOrEqual(layout.viewportWidth + 1);
  expect(layout.boardWidth).toBeGreaterThan(280);
  expect(layout.boardWidth).toBeLessThanOrEqual(layout.viewportWidth);
});
