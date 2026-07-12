import { describe, expect, it } from "vitest";
import { planGptImageAspect } from "../src/gptImageAspect.js";

describe("planGptImageAspect", () => {
  it("picks 1024x1024 for a near-square board (least padding) and letterboxes it", () => {
    const p = planGptImageAspect(1024, 1102); // aspect 0.929 (the real Small Testmap control)
    expect(p.imageSize).toBe("1024x1024");
    expect(p.targetW).toBe(1024);
    expect(p.targetH).toBe(1024);
    // board is taller than square → content is scaled to fit height, padded on width
    expect(p.contentH).toBe(1024);
    expect(p.contentW).toBe(952);
    expect(p.padLeft + p.contentW + p.padRight).toBe(1024);
    expect(p.padTop + p.contentH + p.padBottom).toBe(1024);
  });

  it("picks the exact landscape size with no padding for a 3:2 board", () => {
    const p = planGptImageAspect(1536, 1024);
    expect(p.imageSize).toBe("1536x1024");
    expect(p.padLeft).toBe(0);
    expect(p.padTop).toBe(0);
  });

  it("picks the portrait size for a tall board", () => {
    const p = planGptImageAspect(1024, 1536);
    expect(p.imageSize).toBe("1024x1536");
  });
});
