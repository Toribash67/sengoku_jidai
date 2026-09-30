import { expect, test } from "@playwright/test";

test("online opponents chat through the game log, and the board fits without page scroll", async ({
  page,
  browser
}) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/");
  await page.getByLabel("Your name").fill("Oda");
  await page.getByRole("button", { name: "Create game" }).click();
  await expect(page.getByTestId("board")).toBeVisible();

  // Before anyone joins (the open seat is also how hotseat play works) there is no chat input.
  await expect(page.getByLabel("Chat message")).toHaveCount(0);

  // The divider auto-fits so the page itself does not scroll vertically.
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollHeight - window.innerHeight))
    .toBeLessThanOrEqual(1);

  // The opponent joins from their own browser context via the invite link.
  const inviteLink = await page.getByLabel("Invite link").inputValue();
  const guestContext = await browser.newContext();
  const guest = await guestContext.newPage();
  await guest.goto(inviteLink);
  await guest.getByLabel("Your name").fill("Takeda");
  await guest.getByRole("button", { name: "Join game" }).click();
  await expect(guest.getByTestId("board")).toBeVisible();

  // Guest says hello; the host's chat appears once the poll notices the claim.
  await guest.getByLabel("Chat message").fill("Good luck, Oda");
  await guest.getByRole("button", { name: "Send" }).click();
  const guestLog = guest.getByRole("region", { name: "Game log" });
  await expect(guestLog.locator(".log-chat")).toContainText("Good luck, Oda");

  const hostLog = page.getByRole("region", { name: "Game log" });
  await expect(hostLog.locator(".log-chat").filter({ hasText: "Good luck, Oda" })).toBeVisible({
    timeout: 15_000
  });
  await expect(hostLog.locator(".log-chat .log-name").first()).toHaveText("Takeda");

  await page.getByLabel("Chat message").fill("And to you");
  await page.getByLabel("Chat message").press("Enter");
  await expect(guestLog.locator(".log-chat").filter({ hasText: "And to you" })).toBeVisible({
    timeout: 15_000
  });

  await guestContext.close();
});
