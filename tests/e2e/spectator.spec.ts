import { expect, test } from "@playwright/test";

test("a spectator link shows the live game read-only, and the host sees the watcher count", async ({
  page,
  browser
}) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/");
  await page.getByLabel("Your name").fill("Oda");
  await page.getByRole("button", { name: "Create game" }).click();
  await expect(page.getByTestId("board")).toBeVisible();

  // The opponent joins from their own browser context via the invite link, and says hello.
  const inviteLink = await page.getByLabel("Invite link").inputValue();
  const guestContext = await browser.newContext();
  const guest = await guestContext.newPage();
  await guest.goto(inviteLink);
  await guest.getByLabel("Your name").fill("Takeda");
  await guest.getByRole("button", { name: "Join game" }).click();
  await expect(guest.getByTestId("board")).toBeVisible();
  await guest.getByLabel("Chat message").fill("Hello watchers");
  await guest.getByRole("button", { name: "Send" }).click();
  await expect(guest.getByRole("region", { name: "Game log" }).locator(".log-chat")).toContainText(
    "Hello watchers"
  );

  // A friend opens the host's spectator link in a third context.
  const spectatorLink = page.getByLabel("Spectator link");
  await expect(spectatorLink).toBeVisible();
  const watchUrl = await spectatorLink.inputValue();
  expect(watchUrl).toContain("/watch#");
  const watcherContext = await browser.newContext();
  const watcher = await watcherContext.newPage();
  await watcher.goto(watchUrl);

  await expect(watcher.getByTestId("board")).toBeVisible();
  await expect(watcher.getByText("Spectating", { exact: true })).toBeVisible();
  await expect(watcher.getByLabel("Chat message")).toHaveCount(0);
  await expect(
    watcher
      .getByRole("region", { name: "Game log" })
      .locator(".log-chat")
      .filter({ hasText: "Hello watchers" })
  ).toBeVisible({ timeout: 15_000 });
  await expect(watcher.getByRole("button", { name: "Pass" })).toHaveCount(0);
  await expect(watcher.getByRole("button", { name: "Clear local game" })).toHaveCount(0);

  // The host's players panel counts the watcher on its next spectator poll.
  await expect(page.getByLabel("Spectators")).toHaveText("👁 1 watching", { timeout: 20_000 });

  await watcherContext.close();
  await guestContext.close();
});
