import { expect, test } from "@playwright/test";

test("creates a hotseat game, renders the SVG board, and selects a tile", async ({ page }) => {
  await page.goto("/");

  await page.getByRole("button", { name: "New hotseat game" }).click();
  await expect(page.getByTestId("board")).toBeVisible();
  await expect(page.getByText("Round 1", { exact: true })).toBeVisible();

  // The canonical map is inlined: the red HQ tile exists and is clickable.
  await expect(page.locator("#tile9")).toBeVisible();
  await page.locator("#tile9").click();
  await expect(page.getByRole("heading", { name: "tile9" })).toBeVisible();

  await page.reload();
  await expect(page.getByTestId("board")).toBeVisible();
  await expect(page.locator("#tile9")).toBeVisible();
  await expect(page.getByText("Round 1", { exact: true })).toBeVisible();
});
