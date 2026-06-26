import { expect, test } from "@playwright/test";

test("creates a hotseat game, renders the SVG board, and selects a tile", async ({ page }) => {
  await page.goto("/");

  await page.getByLabel("Your name").fill("Oda");
  await page.getByRole("button", { name: "Create game" }).click();
  await expect(page.getByTestId("board")).toBeVisible();
  await expect(page.getByText("Round 1", { exact: true })).toBeVisible();

  // The canonical map is inlined: the red HQ tile exists and is clickable.
  await expect(page.locator("#tile9")).toBeVisible();
  await page.locator("#tile9").click();

  // Tiles are referred to by a descriptive name, never the raw id; the panel shows traits.
  await expect(page.getByRole("heading", { name: "Red HQ" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Traits" })).toBeVisible();

  await page.reload();
  await expect(page.getByTestId("board")).toBeVisible();
  await expect(page.locator("#tile9")).toBeVisible();
  await expect(page.getByText("Round 1", { exact: true })).toBeVisible();
});
