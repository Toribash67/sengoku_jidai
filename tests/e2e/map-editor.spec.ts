import { expect, test } from "@playwright/test";

test("author a custom map, save it, and play a move on it", async ({ page }) => {
  await page.goto("/maps/new");

  // Paint three land hexes in a row (the paint-land tool is active by default).
  await page.locator('.editor-grid [data-axial="0,0"]').click();
  await page.locator('.editor-grid [data-axial="1,0"]').click();
  await page.locator('.editor-grid [data-axial="2,0"]').click();

  // Red HQ + troops on t1.
  await page.getByRole("button", { name: "Select tool" }).click();
  await page.locator('[data-tile-id="t1"]').click();
  await page.getByLabel("HQ owner").selectOption("red");
  await page.getByLabel("Deployment seat").selectOption("red");
  await page.getByLabel("Troops").fill("3");

  // Black HQ + troops on t3.
  await page.locator('[data-tile-id="t3"]').click();
  await page.getByLabel("HQ owner").selectOption("black");
  await page.getByLabel("Deployment seat").selectOption("black");
  await page.getByLabel("Troops").fill("3");

  await expect(page.getByText("Map is valid")).toBeVisible();

  await page.getByLabel("Map name").fill("E2E Custom Map");
  await page.getByRole("button", { name: "Save map" }).click();
  await page.getByRole("button", { name: "New game on this map" }).click();

  // The create screen preselects the new map.
  await expect(page.getByLabel("Map").locator("option:checked")).toHaveText(/E2E Custom Map/);
  await page.getByLabel("Your name").fill("Oda");
  await page.getByRole("button", { name: "Create game" }).click();

  // The custom board renders with the generated tile ids.
  await expect(page.getByTestId("board")).toBeVisible();
  await expect(page.locator("#t1")).toBeVisible();
  await expect(page.getByText("Round 1", { exact: true })).toBeVisible();

  // Drive one move, same order-first flow as movement.spec.ts.
  const actor = await page.locator(".app-shell").getAttribute("data-active-seat");
  expect(actor === "red" || actor === "black").toBe(true);
  const actorSeat = page.locator(`button[data-seat="${actor}"]`);
  if (await actorSeat.isEnabled()) {
    await actorSeat.click();
  }
  const advance = page.locator('button[data-order-verb="advance"]');
  await expect(advance).toBeVisible();
  await advance.click();
  const target = page.locator("[data-legal-target='true']").first();
  await expect(target).toBeVisible();
  await target.click();
  const source = page.locator("[data-source='true']").first();
  await expect(source).toBeVisible();
  await source.click();
  await page.getByRole("button", { name: /^Confirm/ }).click();
  await expect(page.getByText(/moved/)).toBeVisible();
});
