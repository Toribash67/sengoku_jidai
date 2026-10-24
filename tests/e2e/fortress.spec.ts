import { expect, test } from "@playwright/test";

/** Upload a copy of the Rivers board authored for the Fortress ruleset; returns its name. */
async function uploadFortressMap(request: import("@playwright/test").APIRequestContext) {
  // The web server can come up before the API it proxies to, so wait for the API to answer.
  await expect
    .poll(async () => (await request.get("/api/maps/rivers")).status(), { timeout: 30_000 })
    .toBe(200);
  const { source } = await (await request.get("/api/maps/rivers")).json();
  const name = `E2E Fortress ${Date.now()}`;
  const created = await request.post("/api/maps", {
    data: { ...source, id: "e2e-fortress", name, ruleset: "fortress" }
  });
  expect(created.status()).toBe(201);
  return name;
}

test("a Fortress map offers Siege and reinforces with catapults", async ({ page, request }) => {
  const mapName = await uploadFortressMap(request);

  await page.goto("/");
  await page.getByLabel("Your name").fill("Oda");
  await page.getByLabel("Map").selectOption({ label: `${mapName} (22 tiles · Fortress rules)` });
  await page.getByRole("button", { name: "Create game" }).click();
  await expect(page.getByTestId("board")).toBeVisible();

  const actor = await page.locator(".app-shell").getAttribute("data-active-seat");
  const actorSeat = page.locator(`button[data-seat="${actor}"]`);
  if (await actorSeat.isEnabled()) {
    await actorSeat.click();
  }

  // The palette carries the Siege verb (greyed until a catapult stands next to an enemy).
  await expect(page.locator('button[data-order-verb="siege"]')).toBeVisible();

  // Reinforce two troops onto one tile, one of them a catapult.
  await page
    .getByRole("button", { name: /^Reinforce/ })
    .first()
    .click();
  const target = page.locator("[data-source='true']").first();
  await expect(target).toBeVisible();
  await target.click();
  await target.click();
  const catapults = page.locator(".action-bar-stepper", { hasText: "Of which catapults" });
  await catapults.getByRole("button", { name: "More" }).click();
  await expect(page.getByText(/incl\. 1 catapult/).first()).toBeVisible();
  await page.screenshot({ path: test.info().outputPath("fortress-reinforce.png") });
  await page.getByRole("button", { name: /^Confirm Reinforce/ }).click();

  // The log reports the catapult among the placed troops.
  await expect(page.getByText(/placed 2 troops \(incl\. 1 catapult\)/)).toBeVisible();
  await page.screenshot({ path: test.info().outputPath("fortress-board.png") });
});
