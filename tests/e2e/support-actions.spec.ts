import { expect, test } from "@playwright/test";

/** Switch the view to whichever seat currently has initiative, and return its name. */
async function switchToActiveSeat(page: import("@playwright/test").Page): Promise<string> {
  const actText = await page.locator(".top-stats span", { hasText: "to act" }).textContent();
  const actor = actText?.trim().split(" ")[0];
  expect(actor === "red" || actor === "black").toBe(true);
  await page.getByRole("button", { name: actor!, exact: true }).click();
  return actor!;
}

test("reinforces from the action bar and resolves it", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "New hotseat game" }).click();
  await expect(page.getByTestId("board")).toBeVisible();
  await switchToActiveSeat(page);

  // Open the Reinforce placement composer from the bottom action bar.
  await page
    .getByRole("button", { name: /^Reinforce/ })
    .first()
    .click();

  // Supplied targets glow on the map; click one to stage a troop, then confirm.
  const target = page.locator("[data-source='true']").first();
  await expect(target).toBeVisible();
  await target.click();
  await page.getByRole("button", { name: /^Confirm Reinforce/ }).click();

  // The order resolved: a unit-placement event is logged.
  await expect(page.getByText(/placed/)).toBeVisible();
});

test("plans from the action bar and resolves it", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "New hotseat game" }).click();
  await expect(page.getByTestId("board")).toBeVisible();
  await switchToActiveSeat(page);

  // Open and confirm a Plan (deploys a commander; the initiative space also seizes it).
  await page.getByRole("button", { name: /^Plan/ }).first().click();
  await page.getByRole("button", { name: "Confirm Plan" }).click();

  // The initiative Plan space emits both commanderDeployed and initiativeSeized.
  await expect(page.getByText(/commanderDeployed|initiativeSeized/).first()).toBeVisible();
});
