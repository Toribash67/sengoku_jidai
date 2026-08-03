import type { BoardScene } from "@sengoku-jidai/board-render";

/** A fort marker to overlay on the base terrain, in output-image pixel coordinates. */
export interface FortMarker {
  x: number;
  y: number;
  radius: number;
}

/**
 * Derive one marker per fort tile from the board scene, scaled from viewBox coordinates into
 * the terrain's output pixels. Scale is uniform (the output height preserves the viewBox
 * aspect), so `outputWidth / viewBox.width` maps both axes. `markerRadiusFactor` sizes the
 * marker relative to the flat-top hex radius.
 */
export function fortMarkers(
  scene: BoardScene,
  outputWidth: number,
  markerRadiusFactor: number
): FortMarker[] {
  const scale = outputWidth / scene.viewBox.width;
  const markers: FortMarker[] = [];
  for (const tile of scene.tiles) {
    if (tile.features.fort !== true) continue;
    markers.push({
      x: (tile.centroid.x - scene.viewBox.x) * scale,
      y: (tile.centroid.y - scene.viewBox.y) * scale,
      radius: scene.hexSize * markerRadiusFactor * scale
    });
  }
  return markers;
}
