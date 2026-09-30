import { describe, expect, it } from "vitest";
import {
  DIVIDER_TRACK,
  MAX_AUTO_PANEL_WIDTH,
  MIN_MAP_WIDTH,
  MIN_PANEL_WIDTH,
  autoPanelFit
} from "./panelFit.js";

describe("autoPanelFit", () => {
  it("sizes the map so the board column exactly fills the available height", () => {
    // 700px available, 100px chrome → 600px of map; square map → 600px wide.
    const width = autoPanelFit({
      availableHeight: 700,
      layoutWidth: 1000 + DIVIDER_TRACK,
      chromeHeight: 100,
      mapAspect: 1
    });
    expect(width).toEqual({ panelWidth: 400, mapWidth: 600 });
  });

  it("never squeezes the panel below its minimum (the board is capped instead)", () => {
    const width = autoPanelFit({
      availableHeight: 2000,
      layoutWidth: 1000,
      chromeHeight: 100,
      mapAspect: 0.5
    });
    expect(width.panelWidth).toBe(MIN_PANEL_WIDTH);
  });

  it("caps the panel on short, wide screens and reports the narrower map width", () => {
    const width = autoPanelFit({
      availableHeight: 400,
      layoutWidth: 2400,
      chromeHeight: 100,
      mapAspect: 0.5
    });
    expect(width.panelWidth).toBe(MAX_AUTO_PANEL_WIDTH);
    expect(width.mapWidth).toBe(600);
  });

  it("keeps the map at least its minimum width", () => {
    const width = autoPanelFit({
      availableHeight: 200,
      layoutWidth: 800,
      chromeHeight: 100,
      mapAspect: 1
    });
    expect(width).toEqual({
      panelWidth: 800 - DIVIDER_TRACK - MIN_MAP_WIDTH,
      mapWidth: MIN_MAP_WIDTH
    });
  });

  it("falls back to the default width when the map aspect is unknown", () => {
    const width = autoPanelFit({
      availableHeight: 700,
      layoutWidth: 1200,
      chromeHeight: 100,
      mapAspect: 0
    });
    expect(width.panelWidth).toBe(340);
  });
});
