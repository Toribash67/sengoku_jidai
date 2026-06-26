import { expect, test } from "@playwright/test";

test("issues a movement order from the board and resolves it", async ({ page }) => {
  await page.goto("/");
  await page.getByLabel("Your name").fill("Oda");
  await page.getByRole("button", { name: "Create game" }).click();
  await expect(page.getByTestId("board")).toBeVisible();

  // Switch the view to whichever seat has initiative this game.
  const actor = await page.locator(".app-shell").getAttribute("data-active-seat");
  expect(actor === "red" || actor === "black").toBe(true);
  // Switch to view as the seat with initiative — unless we already are (its button is
  // disabled when it's the current view).
  const actorSeat = page.locator(`button[data-seat="${actor}"]`);
  if (await actorSeat.isEnabled()) {
    await actorSeat.click();
  }

  // A legal movement target glows; select the first one.
  const target = page.locator("[data-legal-target='true']").first();
  await expect(target).toBeVisible();
  await target.click();

  // The selected tile reveals its order in the bottom action bar; start it.
  await page.getByRole("button", { name: /^(Advance|Sail) here$/ }).click();

  // A legal source glows; click it to stage one unit, then confirm.
  const source = page.locator("[data-source='true']").first();
  await expect(source).toBeVisible();
  await source.click();
  await page.getByRole("button", { name: /^Confirm/ }).click();

  // The order resolved: a unit-move event is logged.
  await expect(page.getByText(/moved/)).toBeVisible();
});
