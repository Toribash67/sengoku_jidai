import { devices, expect, test } from "@playwright/test";

test.use({ ...devices["Pixel 5"] }); // 393×851, isMobile, hasTouch

/** Two synthetic touch pointers on the canvas: down → move → up. Playwright's
 *  touchscreen API is single-touch, so multi-touch is dispatched manually. */
async function twoFingerGesture(
  canvas: import("@playwright/test").Locator,
  from: [[number, number], [number, number]],
  to: [[number, number], [number, number]]
): Promise<string> {
  return canvas.evaluate(
    (svg, { from, to }) => {
      const rect = svg.getBoundingClientRect();
      const fire = (type: string, pointerId: number, [x, y]: [number, number]) => {
        svg.dispatchEvent(
          new PointerEvent(type, {
            pointerId,
            pointerType: "touch",
            isPrimary: pointerId === 1,
            clientX: rect.left + x,
            clientY: rect.top + y,
            bubbles: true,
            cancelable: true,
            buttons: 1
          })
        );
      };
      fire("pointerdown", 1, from[0]);
      fire("pointerdown", 2, from[1]);
      fire("pointermove", 1, to[0]);
      fire("pointermove", 2, to[1]);
      fire("pointerup", 1, to[0]);
      fire("pointerup", 2, to[1]);
      // Pointer-driven state updates flush asynchronously (React 18's default
      // batching for continuous events), so wait a couple of frames before
      // reading the viewBox back or this observes the pre-gesture value.
      return new Promise<string>((resolve) => {
        requestAnimationFrame(() =>
          requestAnimationFrame(() => resolve(svg.getAttribute("viewBox")!))
        );
      });
    },
    { from, to }
  );
}

function viewBoxParts(viewBox: string): number[] {
  return viewBox.split(" ").map(Number);
}

test("author, merge, pan/zoom, and save a map by touch", async ({ page }) => {
  await page.goto("/maps/new");

  // Paint three land hexes by tapping (paint-land is the default tool).
  await page.locator('.editor-grid [data-axial="0,0"]').tap();
  await page.locator('.editor-grid [data-axial="1,0"]').tap();
  await page.locator('.editor-grid [data-axial="2,0"]').tap();

  // Multi-select is gated to the Select tool: disabled while a paint tool is active.
  await expect(page.getByRole("button", { name: "Multi-select" })).toBeDisabled();

  // Multi-select t1+t2 with the Multi toggle (no shift-click) and merge them.
  await page.getByRole("button", { name: "Select tool" }).tap();
  await page.getByRole("button", { name: "Multi-select" }).tap();
  await page.locator('[data-tile-id="t1"]').tap();
  await page.locator('[data-tile-id="t2"]').tap();
  await page.getByRole("button", { name: "Merge tiles" }).tap();
  await expect(page.locator('[data-tile-id="t1"]')).toHaveCount(2); // both hexes now t1

  // Multi off; configure the merged tile via the auto-expanded inspector sheet.
  await page.getByRole("button", { name: "Multi-select" }).tap();
  await page.locator('[data-tile-id="t1"]').first().tap();
  await page.getByLabel("HQ owner").selectOption("red");
  await page.getByLabel("Deployment seat").selectOption("red");
  await page.getByLabel("Troops").fill("3");

  await page.locator('[data-tile-id="t3"]').tap();
  await page.getByLabel("HQ owner").selectOption("black");
  await page.getByLabel("Deployment seat").selectOption("black");
  await page.getByLabel("Troops").fill("3");

  await expect(page.getByText("Map is valid")).toBeVisible();

  // Zoom-in button shrinks the viewBox width.
  const canvas = page.getByTestId("editor-canvas");
  const initial = viewBoxParts((await canvas.getAttribute("viewBox"))!);
  await page.getByRole("button", { name: "Zoom in" }).tap();
  const zoomed = viewBoxParts((await canvas.getAttribute("viewBox"))!);
  expect(zoomed[2]!).toBeLessThan(initial[2]!);

  // Two-finger drag pans without changing the zoom.
  const panned = viewBoxParts(
    await twoFingerGesture(
      canvas,
      [
        [100, 200],
        [220, 200]
      ],
      [
        [140, 260],
        [260, 260]
      ]
    )
  );
  expect(panned[2]!).toBeCloseTo(zoomed[2]!);
  expect(panned[0]!).not.toBeCloseTo(zoomed[0]!);

  // Pinching outward zooms in further.
  const pinched = viewBoxParts(
    await twoFingerGesture(
      canvas,
      [
        [150, 300],
        [250, 300]
      ],
      [
        [100, 300],
        [300, 300]
      ]
    )
  );
  expect(pinched[2]!).toBeLessThan(panned[2]!);

  // Save works from the phone layout.
  await page.getByLabel("Map name").fill("Touch Map");
  await page.getByRole("button", { name: "Save map" }).tap();
  await expect(page.getByRole("button", { name: "New game on this map" })).toBeVisible();
});
