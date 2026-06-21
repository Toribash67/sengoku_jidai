import { expect, test } from "@playwright/test";

test("issues a movement order from the board and resolves it", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "New hotseat game" }).click();
  await expect(page.getByTestId("board")).toBeVisible();

  // Switch the view to whichever seat has initiative this game.
  const actText = await page.locator(".top-stats span", { hasText: "to act" }).textContent();
  const actor = actText?.trim().split(" ")[0];
  expect(actor === "red" || actor === "black").toBe(true);
  await page.getByRole("button", { name: actor!, exact: true }).click();

  // A legal movement target glows; select the first one.
  const target = page.locator("[data-legal-target='true']").first();
  await expect(target).toBeVisible();
  await target.click();

  // Start the linked Advance/Sail order from the detail panel.
  await page.getByRole("button", { name: /into / }).click();

  // A legal source glows; click it to stage one unit, then confirm.
  const source = page.locator("[data-source='true']").first();
  await expect(source).toBeVisible();
  await source.click();
  await page.getByRole("button", { name: /^Confirm/ }).click();

  // The order resolved: a unit-move event is logged.
  await expect(page.getByText(/unitsMoved/)).toBeVisible();
});
