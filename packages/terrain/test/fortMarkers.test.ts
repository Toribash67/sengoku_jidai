import { compileHexMap } from "@sengoku-jidai/engine";
import { buildScene } from "@sengoku-jidai/board-render";
import { describe, expect, it } from "vitest";
import { fortMarkers } from "../src/fortMarkers.js";

const SOURCE = {
  id: "m",
  name: "Fort Marker Test",
  layout: { size: 100, originX: 0, originY: 0 },
  tiles: [
    { id: "t1", kind: "land", hexes: [{ q: 0, r: 0 }], features: { fort: true } },
    { id: "t2", kind: "land", hexes: [{ q: 1, r: 0 }], features: {} },
    { id: "t3", kind: "sea", hexes: [{ q: 2, r: 0 }], features: {} }
  ],
  startingDeployment: {},
  bonusSlots: [],
  nextTileNumber: 4
};

describe("fortMarkers", () => {
  it("returns one marker per fort tile, scaled into output pixels", () => {
    const scene = buildScene(compileHexMap(SOURCE as never));
    const outputWidth = scene.viewBox.width * 2; // scale = 2
    const markers = fortMarkers(scene, outputWidth, 0.5);

    expect(markers).toHaveLength(1);
    const marker = markers[0]!;
    const fortTile = scene.tiles.find((t) => t.features.fort)!;
    expect(marker.x).toBeCloseTo((fortTile.centroid.x - scene.viewBox.x) * 2, 5);
    expect(marker.y).toBeCloseTo((fortTile.centroid.y - scene.viewBox.y) * 2, 5);
    expect(marker.radius).toBeCloseTo(scene.hexSize * 0.5 * 2, 5);
  });

  it("returns an empty array when no tile has a fort", () => {
    const noFort = { ...SOURCE, tiles: SOURCE.tiles.map((t) => ({ ...t, features: {} })) };
    const scene = buildScene(compileHexMap(noFort as never));
    expect(fortMarkers(scene, 1024, 0.5)).toEqual([]);
  });
});
