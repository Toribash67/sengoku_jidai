/** The minimal slice of the board scene harbour placement needs. Declared locally (not imported
 *  from board-render) so terrain/src keeps its engine-only dependency boundary; a real
 *  `BoardScene` is structurally assignable to it. Each harbour tile carries `ports` — its
 *  sea-facing hex-edge midpoints — so the drawing can sit on the coast rather than the centre. */
export interface HarborScene {
  viewBox: { x: number; y: number; width: number };
  hexSize: number;
  tiles: {
    centroid: { x: number; y: number };
    features: { harbor: boolean };
    ports: { edge: { x: number; y: number } }[];
  }[];
}

/** A harbour marker/mask disc to draw on the base terrain, in output-image pixel coordinates. */
export interface HarborMarker {
  x: number;
  y: number;
  radius: number;
}

/**
 * Derive one disc per harbour tile from the board scene, scaled from viewBox coordinates into the
 * terrain's output pixels. Scale is uniform (`outputWidth / viewBox.width` maps both axes). Unlike
 * a fort (drawn at the tile centre), a harbour sits on the shore: the disc centre is blended from
 * the centroid toward the mean of the tile's sea-facing port edges by `coastBias` (0 = centroid,
 * 1 = the coastline), so the fishing village's docks reach the water. A harbour tile with no ports
 * falls back to its centroid. `markerRadiusFactor` sizes the disc relative to the flat-top hex.
 */
export function harborMarkers(
  scene: HarborScene,
  outputWidth: number,
  markerRadiusFactor: number,
  coastBias: number
): HarborMarker[] {
  const scale = outputWidth / scene.viewBox.width;
  const markers: HarborMarker[] = [];
  for (const tile of scene.tiles) {
    if (tile.features.harbor !== true) continue;
    let cx = tile.centroid.x;
    let cy = tile.centroid.y;
    if (tile.ports.length > 0) {
      let ex = 0;
      let ey = 0;
      for (const p of tile.ports) {
        ex += p.edge.x;
        ey += p.edge.y;
      }
      ex /= tile.ports.length;
      ey /= tile.ports.length;
      cx = tile.centroid.x + (ex - tile.centroid.x) * coastBias;
      cy = tile.centroid.y + (ey - tile.centroid.y) * coastBias;
    }
    markers.push({
      x: (cx - scene.viewBox.x) * scale,
      y: (cy - scene.viewBox.y) * scale,
      radius: scene.hexSize * markerRadiusFactor * scale
    });
  }
  return markers;
}
