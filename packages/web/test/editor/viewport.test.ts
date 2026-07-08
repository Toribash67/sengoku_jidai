import { describe, expect, it } from "vitest";
import {
  MAX_VIEW_WIDTH,
  MIN_VIEW_WIDTH,
  pinchView,
  toBoard,
  zoomView,
  zoomViewCentered,
  type ViewRect
} from "../../src/editor/viewport.js";

const rect = { width: 1000, height: 800 };
const view: ViewRect = { x: 0, y: 0, width: 2000, height: 1600 };

describe("toBoard", () => {
  it("maps element pixels to board coordinates", () => {
    expect(toBoard(view, rect, { x: 250, y: 200 })).toEqual({ x: 500, y: 400 });
    expect(toBoard({ ...view, x: -100, y: 50 }, rect, { x: 0, y: 0 })).toEqual({ x: -100, y: 50 });
  });
});

describe("zoomView", () => {
  it("keeps the board point under the focus fixed", () => {
    const focus = { x: 250, y: 200 };
    const before = toBoard(view, rect, focus);
    const zoomed = zoomView(view, rect, 0.5, focus);
    expect(zoomed.width).toBe(1000);
    expect(zoomed.height).toBe(800);
    const after = toBoard(zoomed, rect, focus);
    expect(after.x).toBeCloseTo(before.x);
    expect(after.y).toBeCloseTo(before.y);
  });

  it("clamps width to [MIN_VIEW_WIDTH, MAX_VIEW_WIDTH] and keeps the aspect ratio", () => {
    const out = zoomView(view, rect, 100, { x: 500, y: 400 });
    expect(out.width).toBe(MAX_VIEW_WIDTH);
    expect(out.height / out.width).toBeCloseTo(view.height / view.width);
    const inn = zoomView(view, rect, 0.01, { x: 500, y: 400 });
    expect(inn.width).toBe(MIN_VIEW_WIDTH);
  });
});

describe("zoomViewCentered", () => {
  it("scales around the view center", () => {
    const out = zoomViewCentered(view, 2);
    expect(out).toEqual({ x: -1000, y: -800, width: 4000, height: 3200 });
    expect(out.x + out.width / 2).toBe(view.x + view.width / 2);
    expect(out.y + out.height / 2).toBe(view.y + view.height / 2);
  });

  it("clamps like zoomView", () => {
    expect(zoomViewCentered(view, 100).width).toBe(MAX_VIEW_WIDTH);
    expect(zoomViewCentered(view, 0.01).width).toBe(MIN_VIEW_WIDTH);
  });
});

describe("pinchView", () => {
  it("pure two-finger drag pans without zooming", () => {
    const prev: [{ x: number; y: number }, { x: number; y: number }] = [
      { x: 100, y: 100 },
      { x: 300, y: 100 }
    ];
    const curr: [{ x: number; y: number }, { x: number; y: number }] = [
      { x: 150, y: 150 },
      { x: 350, y: 150 }
    ];
    const out = pinchView(view, rect, prev, curr);
    expect(out.width).toBe(view.width);
    // Fingers moved +50px right/down; the view rect shifts opposite so content follows.
    expect(out.x).toBeCloseTo(-100);
    expect(out.y).toBeCloseTo(-100);
  });

  it("spreading fingers zooms in around the (stationary) centroid", () => {
    const prev: [{ x: number; y: number }, { x: number; y: number }] = [
      { x: 400, y: 400 },
      { x: 600, y: 400 }
    ];
    const curr: [{ x: number; y: number }, { x: number; y: number }] = [
      { x: 300, y: 400 },
      { x: 700, y: 400 }
    ];
    const mid = { x: 500, y: 400 };
    const anchor = toBoard(view, rect, mid);
    const out = pinchView(view, rect, prev, curr);
    expect(out.width).toBe(1000); // distance doubled → width halved
    const after = toBoard(out, rect, mid);
    expect(after.x).toBeCloseTo(anchor.x);
    expect(after.y).toBeCloseTo(anchor.y);
  });

  it("guards against a zero current distance", () => {
    const prev: [{ x: number; y: number }, { x: number; y: number }] = [
      { x: 100, y: 100 },
      { x: 300, y: 100 }
    ];
    const curr: [{ x: number; y: number }, { x: number; y: number }] = [
      { x: 200, y: 100 },
      { x: 200, y: 100 }
    ];
    const out = pinchView(view, rect, prev, curr);
    expect(out.width).toBe(view.width);
    expect(Number.isFinite(out.x)).toBe(true);
  });
});
