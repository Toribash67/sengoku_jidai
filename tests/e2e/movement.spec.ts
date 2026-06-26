import { expect, test } from "@playwright/test";

test("issues a movement order from the board and resolves it", async ({ page }) => {
  await page.goto("/");
  await page.getByLabel("Your name").fill("Oda");
  await page.getByRole("button", { name: "Create game" }).click();
  await expect(page.getByTestId("board")).toBeVisible();

  // Switch the view to whichever seat has initiative this game.
  const actor = await page.locator(".app-shell").getAttribute("data-active-seat");
  expect(actor === "red" || actor === "black").toBe(true);
  const actorSeat = page.locator(`button[data-seat="${actor}"]`);
  if (await actorSeat.isEnabled()) {
    await actorSeat.click();
  }

  // Idle board is calm: no candidate tiles glow until a verb is armed.
  await expect(page.locator("[data-legal-target='true']")).toHaveCount(0);

  // Order-first: click a movement verb in the palette (whichever of Advance/Sail is usable).
  const advance = page.locator('button[data-order-verb="advance"]');
  const sail = page.locator('button[data-order-verb="sail"]');
  const moveVerb = (await advance.isEnabled()) ? advance : sail;
  await moveVerb.click();

  // Candidate destinations now glow; pick the first one.
  const target = page.locator("[data-legal-target='true']").first();
  await expect(target).toBeVisible();
  await target.click();

  // A legal source glows; click it to stage one unit, then confirm.
  const source = page.locator("[data-source='true']").first();
  await expect(source).toBeVisible();
  await source.click();
  await page.getByRole("button", { name: /^Confirm/ }).click();

  // The order resolved: a unit-move event is logged.
  await expect(page.getByText(/moved/)).toBeVisible();
});
