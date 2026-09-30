import { useCallback, useEffect, useState, type RefObject } from "react";
import { loadManualPanelWidth, saveManualPanelWidth } from "./localGame.js";

export const MIN_PANEL_WIDTH = 260;
export const MAX_AUTO_PANEL_WIDTH = 480;
export const MIN_MAP_WIDTH = 360;
export const DEFAULT_PANEL_WIDTH = 340;
/** Width of the divider plus the two grid gaps around it (see `.game-layout` in app.css). */
export const DIVIDER_TRACK = 10 + 2 * 8;
/** Below this viewport width the layout stacks (app.css media query); no side-by-side fit. */
export const STACKED_MAX_WIDTH = 900;
/** Space kept below the layout (the app shell's bottom padding plus a little slack, since the
 *  action bar under the map changes height as orders are composed). */
export const BOTTOM_GAP = 26;

export interface PanelFitInput {
  /** Height the layout may use: viewport height minus the layout's top and the bottom gap. */
  availableHeight: number;
  layoutWidth: number;
  /** Board-column height that isn't the map (terrain picker, action bar, borders). */
  chromeHeight: number;
  /** Rendered map height / width. */
  mapAspect: number;
}

export interface PanelFit {
  panelWidth: number;
  /** Widest the map may render and still fit the height (never below MIN_MAP_WIDTH). */
  mapWidth: number;
}

/** The side-panel width that lets the map grow as wide as possible without the board column
 *  running past the viewport bottom. The panel is clamped to [MIN, MAX_AUTO]; when a clamp leaves
 *  the map column wider than `mapWidth`, the caller caps and centres the board at `mapWidth`. */
export function autoPanelFit({
  availableHeight,
  layoutWidth,
  chromeHeight,
  mapAspect
}: PanelFitInput): PanelFit {
  const room = layoutWidth - DIVIDER_TRACK;
  const maxPanel = Math.max(MIN_PANEL_WIDTH, Math.min(MAX_AUTO_PANEL_WIDTH, room - MIN_MAP_WIDTH));
  if (!(mapAspect > 0)) {
    return { panelWidth: Math.min(DEFAULT_PANEL_WIDTH, maxPanel), mapWidth: room };
  }
  const fitting = Math.max(0, availableHeight - chromeHeight) / mapAspect;
  const mapWidth = Math.floor(Math.max(MIN_MAP_WIDTH, fitting));
  const panelWidth = Math.round(Math.min(Math.max(room - mapWidth, MIN_PANEL_WIDTH), maxPanel));
  return { panelWidth, mapWidth };
}

interface MeasuredFit {
  panelWidth: number;
  boardMaxWidth: number | null;
  layoutHeight: number | null;
}

/** Side-panel width state: the player's dragged width when set, else an auto-fit width measured
 *  from the rendered map (re-measured when `fitKey` changes, the window resizes, or on reset).
 *  Also reports the height the layout may use (so the side panel can fill it exactly) and, in
 *  auto mode, the board width that keeps the map inside the viewport. */
export function usePanelFit(layoutRef: RefObject<HTMLElement | null>, fitKey: string) {
  const [manualWidth, setManualWidth] = useState<number | null>(() => loadManualPanelWidth());
  const [fit, setFit] = useState<MeasuredFit>({
    panelWidth: DEFAULT_PANEL_WIDTH,
    boardMaxWidth: null,
    layoutHeight: null
  });
  const [measureTick, setMeasureTick] = useState(0);

  useEffect(() => {
    const onResize = () => setMeasureTick((tick) => tick + 1);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  useEffect(() => {
    if (!fitKey) {
      return;
    }
    let frame = 0;
    let attempts = 0;
    const measure = () => {
      if (window.innerWidth <= STACKED_MAX_WIDTH) {
        setFit({ panelWidth: DEFAULT_PANEL_WIDTH, boardMaxWidth: null, layoutHeight: null });
        return;
      }
      const layout = layoutRef.current;
      const column = layout?.querySelector<HTMLElement>(".board-column");
      const board = column?.querySelector<HTMLElement>(".board");
      const svg = board?.querySelector<SVGSVGElement>(".map-host svg");
      if (!layout || !column || !board || !svg || svg.clientWidth === 0) {
        // The board SVG renders a frame or two after the game loads; keep trying briefly.
        if (attempts++ < 60) {
          frame = window.requestAnimationFrame(measure);
        }
        return;
      }
      const rect = layout.getBoundingClientRect();
      const columnRect = column.getBoundingClientRect();
      const boardRect = board.getBoundingClientRect();
      const svgRect = svg.getBoundingClientRect();
      const available = Math.max(0, window.innerHeight - (rect.top + window.scrollY) - BOTTOM_GAP);
      const next = autoPanelFit({
        availableHeight: available,
        layoutWidth: rect.width,
        chromeHeight: columnRect.height - svgRect.height,
        mapAspect: svgRect.height / svgRect.width
      });
      setFit({
        panelWidth: next.panelWidth,
        boardMaxWidth: next.mapWidth + (boardRect.width - svgRect.width),
        layoutHeight: available
      });
    };
    frame = window.requestAnimationFrame(measure);
    return () => window.cancelAnimationFrame(frame);
  }, [layoutRef, fitKey, measureTick]);

  /** A drag: take the width now; it is persisted only when the drag ends (`commit`). */
  const dragTo = useCallback((width: number) => setManualWidth(width), []);
  const commit = useCallback(() => {
    setManualWidth((width) => {
      saveManualPanelWidth(width);
      return width;
    });
  }, []);
  /** Forget the dragged width and re-fit (double-click on the divider). */
  const reset = useCallback(() => {
    saveManualPanelWidth(null);
    setManualWidth(null);
    setMeasureTick((tick) => tick + 1);
  }, []);

  return {
    panelWidth: manualWidth ?? fit.panelWidth,
    // A dragged width is the player's call: let the map fill its column then.
    boardMaxWidth: manualWidth === null ? fit.boardMaxWidth : null,
    layoutHeight: fit.layoutHeight,
    dragTo,
    commit,
    reset
  };
}
