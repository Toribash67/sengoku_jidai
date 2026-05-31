import { expect, test } from "@playwright/test";

test("creates a hotseat game, submits a command, and restores after refresh", async ({ page }) => {
  await page.goto("/");

  await page.getByRole("button", { name: "New hotseat game" }).click();
  await expect(page.getByTestId("board")).toBeVisible();

  await page.getByTestId("area-omi").click();
  await expect(page.getByRole("heading", { name: "Omi" })).toBeVisible();

  await page.getByRole("button", { name: "Claim area" }).click();
  await expect(page.getByText("Revision 1")).toBeVisible();
  await expect(page.getByText("red claimed omi")).toBeVisible();

  await page.reload();
  await expect(page.getByTestId("board")).toBeVisible();
  await expect(page.getByText("Revision 1")).toBeVisible();
});
