import { expect, test } from "@playwright/test";

test("creates a hotseat game, renders the board, and restores after refresh", async ({ page }) => {
  await page.goto("/");

  await page.getByRole("button", { name: "New hotseat game" }).click();
  await expect(page.getByTestId("board")).toBeVisible();
  await expect(page.getByText("Round 1", { exact: true })).toBeVisible();

  await page.reload();
  await expect(page.getByTestId("board")).toBeVisible();
  await expect(page.getByText("Round 1", { exact: true })).toBeVisible();
});
