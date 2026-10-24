import { expect, test } from "@playwright/test";

// The editor canvas rarely has its viewBox's 1.3:1 aspect, so the browser letterboxes the
// board; clicks must still paint the hex under the cursor, also far from the canvas centre.
test.use({ viewport: { width: 1600, height: 700 } });

test("paints the hex under the cursor in a wide window", async ({ page }) => {
  await page.goto("/maps/new");
  const canvas = page.getByTestId("editor-canvas");
  await expect(canvas).toBeVisible();
  const box = (await canvas.boundingBox())!;

  // A grid hex fully inside the canvas, as far left (away from the centre) as possible.
  const target = await page.evaluate(
    ({ left, top, right, bottom }) => {
      const cells = [...document.querySelectorAll<SVGPolygonElement>(".editor-grid polygon")]
        .map((el) => ({ axial: el.dataset.axial!, rect: el.getBoundingClientRect() }))
        .filter(
          ({ rect }) =>
            rect.left > left && rect.right < right && rect.top > top && rect.bottom < bottom
        )
        .sort((a, b) => a.rect.left - b.rect.left);
      const { axial, rect } = cells[0]!;
      return { axial, x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    },
    { left: box.x, top: box.y, right: box.x + box.width, bottom: box.y + box.height }
  );
  expect(target.x).toBeLessThan(box.x + box.width / 4);

  await page.mouse.click(target.x, target.y);
  const painted = page.locator(".editor-tiles polygon");
  await expect(painted).toHaveCount(1);
  await expect(painted).toHaveAttribute("data-axial", target.axial);
});
