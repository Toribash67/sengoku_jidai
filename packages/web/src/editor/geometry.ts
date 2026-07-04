import type { Axial, HexLayout, HexTileSource, Pixel } from "@sengoku-jidai/engine/client";
import { axialKey, axialToPixel, NEIGHBOR_DIRS } from "@sengoku-jidai/engine/client";

/** Flat-top hex corner k, at angle 60k° from the center (SVG y-down). */
export function hexCorner(center: Pixel, size: number, corner: number): Pixel {
  const angle = (Math.PI / 3) * corner;
  // Normalize inputs to prevent -0 propagation
  const cx = center.x || 0;
  const cy = center.y || 0;
  const x = cx + size * Math.cos(angle);
  const y = cy + size * Math.sin(angle);
  // Check for tiny values that should be 0
  const result = {
    x: Math.abs(x) < 1e-10 ? 0 : x || 0,
    y: Math.abs(y) < 1e-10 ? 0 : y || 0
  };
  return result;
}

export function hexPoints(center: Pixel, size: number): string {
  return Array.from({ length: 6 }, (_, i) => hexCorner(center, size, i))
    .map((p) => `${p.x.toFixed(2)},${p.y.toFixed(2)}`)
    .join(" ");
}

/** Corner pair [a, b] of the edge shared with NEIGHBOR_DIRS[i] (same index order). */
export const EDGE_CORNERS: readonly (readonly [number, number])[] = [
  [0, 1],
  [5, 0],
  [4, 5],
  [3, 4],
  [2, 3],
  [1, 2]
];

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Axial coords whose hexes could intersect the rect (one hex of margin). */
export function axialsInRect(rect: Rect, layout: HexLayout): Axial[] {
  const result: Axial[] = [];
  const columnWidth = layout.size * 1.5;
  const rowHeight = layout.size * Math.sqrt(3);
  const qMin = Math.floor((rect.x - layout.originX) / columnWidth) - 1;
  const qMax = Math.ceil((rect.x + rect.width - layout.originX) / columnWidth) + 1;
  for (let q = qMin; q <= qMax; q++) {
    const rMin = Math.floor((rect.y - layout.originY) / rowHeight - q / 2) - 1;
    const rMax = Math.ceil((rect.y + rect.height - layout.originY) / rowHeight - q / 2) + 1;
    for (let r = rMin; r <= rMax; r++) {
      result.push({ q, r });
    }
  }
  return result;
}

export function tileCentroid(hexes: Axial[], layout: HexLayout): Pixel {
  const centers = hexes.map((h) => axialToPixel(h, layout));
  return {
    x: centers.reduce((sum, p) => sum + p.x, 0) / centers.length,
    y: centers.reduce((sum, p) => sum + p.y, 0) / centers.length
  };
}

export interface Segment {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

/** Edges where a hex's neighbor belongs to a different tile (or none). Deduped. */
export function tileBoundarySegments(tiles: HexTileSource[], layout: HexLayout): Segment[] {
  const owner = new Map<string, string>();
  for (const tile of tiles) {
    for (const hex of tile.hexes) {
      owner.set(axialKey(hex), tile.id);
    }
  }
  const segments: Segment[] = [];
  const seen = new Set<string>();
  for (const tile of tiles) {
    for (const hex of tile.hexes) {
      const center = axialToPixel(hex, layout);
      NEIGHBOR_DIRS.forEach((dir, i) => {
        const neighborOwner = owner.get(axialKey({ q: hex.q + dir.q, r: hex.r + dir.r }));
        if (neighborOwner === tile.id) {
          return;
        }
        const [a, b] = EDGE_CORNERS[i]!;
        const p1 = hexCorner(center, layout.size, a);
        const p2 = hexCorner(center, layout.size, b);
        const key = [p1, p2]
          .map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`)
          .sort()
          .join("|");
        if (seen.has(key)) {
          return;
        }
        seen.add(key);
        segments.push({ x1: p1.x, y1: p1.y, x2: p2.x, y2: p2.y });
      });
    }
  }
  return segments;
}
