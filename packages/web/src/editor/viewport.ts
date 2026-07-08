/** Pure view-rect math for the editor canvas (SVG viewBox pan/zoom). */

export interface ViewRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface RectSize {
  width: number;
  height: number;
}

/** Client-pixel point relative to the SVG element's top-left corner. */
export interface ViewportPoint {
  x: number;
  y: number;
}

export const INITIAL_VIEW: ViewRect = { x: -900, y: -700, width: 2600, height: 2000 };
export const MIN_VIEW_WIDTH = 500;
export const MAX_VIEW_WIDTH = 14000;
export const ZOOM_STEP = 1.4;

function clampFactor(view: ViewRect, factor: number): number {
  const width = Math.min(Math.max(view.width * factor, MIN_VIEW_WIDTH), MAX_VIEW_WIDTH);
  return width / view.width;
}

export function toBoard(view: ViewRect, rect: RectSize, point: ViewportPoint): ViewportPoint {
  return {
    x: view.x + (point.x / rect.width) * view.width,
    y: view.y + (point.y / rect.height) * view.height
  };
}

/** Scale by `factor` (>1 zooms out) keeping the board point under `focus` fixed. */
export function zoomView(
  view: ViewRect,
  rect: RectSize,
  factor: number,
  focus: ViewportPoint
): ViewRect {
  const scale = clampFactor(view, factor);
  const board = toBoard(view, rect, focus);
  return {
    x: board.x - (board.x - view.x) * scale,
    y: board.y - (board.y - view.y) * scale,
    width: view.width * scale,
    height: view.height * scale
  };
}

/** Scale by `factor` around the view center (the dock's zoom buttons). */
export function zoomViewCentered(view: ViewRect, factor: number): ViewRect {
  const scale = clampFactor(view, factor);
  const width = view.width * scale;
  const height = view.height * scale;
  return {
    x: view.x + (view.width - width) / 2,
    y: view.y + (view.height - height) / 2,
    width,
    height
  };
}

/** One incremental two-finger update: scale from the spread change (around the
 *  moving centroid) plus the centroid drag. Equal spreads degrade to a pure pan. */
export function pinchView(
  view: ViewRect,
  rect: RectSize,
  prev: [ViewportPoint, ViewportPoint],
  curr: [ViewportPoint, ViewportPoint]
): ViewRect {
  const prevDist = Math.hypot(prev[0].x - prev[1].x, prev[0].y - prev[1].y);
  const currDist = Math.hypot(curr[0].x - curr[1].x, curr[0].y - curr[1].y);
  const prevMid = { x: (prev[0].x + prev[1].x) / 2, y: (prev[0].y + prev[1].y) / 2 };
  const currMid = { x: (curr[0].x + curr[1].x) / 2, y: (curr[0].y + curr[1].y) / 2 };
  const scale = clampFactor(view, currDist > 0 ? prevDist / currDist : 1);
  const anchor = toBoard(view, rect, prevMid);
  const width = view.width * scale;
  const height = view.height * scale;
  return {
    x: anchor.x - (currMid.x / rect.width) * width,
    y: anchor.y - (currMid.y / rect.height) * height,
    width,
    height
  };
}
