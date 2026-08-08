import { expect, test } from "@playwright/test";

async function dragPiece(page, from, to) {
  const piece = page.locator(`.square-${from} .piece-417db`);
  const target = page.locator(`.square-${to}`);
  const fromBox = await piece.boundingBox();
  const toBox = await target.boundingBox();
  expect(fromBox).not.toBeNull();
  expect(toBox).not.toBeNull();
  await page.mouse.move(fromBox.x + fromBox.width / 2, fromBox.y + fromBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(toBox.x + toBox.width / 2, toBox.y + toBox.height / 2, { steps: 10 });
  await page.mouse.up();
}

test("löst eine Trainingsaufgabe direkt auf dem vorhandenen Schachbrett", async ({ page }) => {
  await page.goto("/training");
  await expect(page.locator("#training-board .square-55d63")).toHaveCount(64);
  await expect(page.getByRole("heading", { name: "Finde den besten Zug." })).toBeVisible();

  await dragPiece(page, "f5", "d6");

  await expect(page.getByText(/Richtig · Nd6\+/)).toBeVisible();
  await expect(page.getByText("Gabel", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Nächste Aufgabe" })).toBeVisible();
});

test("zeigt die Lösung nicht unmittelbar nach dem ersten Fehler", async ({ page }) => {
  await page.goto("/training");
  await dragPiece(page, "f5", "h6");
  await expect(page.getByText("Noch nicht.", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Lösung zeigen" })).toHaveCount(0);

  await page.getByRole("button", { name: "Hinweis 1" }).click();
  await page.getByRole("button", { name: "Hinweis 2" }).click();
  await expect(page.getByRole("button", { name: "Lösung zeigen" })).toBeVisible();
});

test("Training bleibt auf einem schmalen Bildschirm ohne horizontales Überlaufen bedienbar", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/training");
  await expect(page.locator("#training-board .square-55d63")).toHaveCount(64);
  await expect(page.locator("#training-board")).toBeVisible();
  const layout = await page.evaluate(() => ({
    viewportWidth: window.innerWidth,
    documentWidth: document.documentElement.scrollWidth,
    boardWidth: document.getElementById("training-board")?.getBoundingClientRect().width || 0,
  }));
  expect(layout.documentWidth).toBeLessThanOrEqual(layout.viewportWidth + 1);
  expect(layout.boardWidth).toBeGreaterThan(300);
  expect(layout.boardWidth).toBeLessThanOrEqual(layout.viewportWidth);
});
