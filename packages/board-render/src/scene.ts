import { axialKey, axialToPixel, neighbors } from "@sengoku-jidai/engine";
import type { Axial, CompiledMap, HexLayout, MapArea, Pixel, SeatId } from "@sengoku-jidai/engine";
import { fuseTile, hexEdges, type Edge } from "./outline.js";
import { NATIVE_HEX_SIZE, ORDER_TOKEN_RADIUS, type GlyphId } from "./assets.js";

// Duplicated from web tileFill.ts (board-render cannot import the web package).
const TILE_LAND_FILL = "#d5d3c4";
const TILE_SEA_FILL = "#8cb2f2";

export interface BoardScene {
  viewBox: { x: number; y: number; width: number; height: number };
  tiles: SceneTile[];
  hexGrid: Edge[];
  /** Flat-top hex radius (layout size), used to draw tile-sized markers (HQ base, harbor). */
  hexSize: number;
}

export interface SceneTile {
  id: string;
  kind: "land" | "sea";
  rings: Pixel[][];
  centroid: Pixel;
  authoredFill: string;
  features: { hq?: SeatId; valueStars: 0 | 1 | 2; harbor: boolean; fort: boolean };
  glyphAnchors: { hq?: Pixel; stars?: Pixel; harbor?: Pixel; bonus?: Pixel };
  bonusGlyph?: GlyphId;
  slots: Record<string, Pixel>;
  /** One entry per sea-facing hex edge of a harbour tile: `edge` is the edge midpoint,
   *  `dir` the outward (land→sea) unit vector. Several may share `to` when a sea area
   *  touches this tile across multiple edges. */
  ports: { to: string; edge: Pixel; dir: Pixel }[];
}

const MARGIN = 40;

function hexLayout(compiled: CompiledMap): HexLayout {
  return {
    size: compiled.layout.size,
    originX: compiled.layout.origin.x,
    originY: compiled.layout.origin.y
  };
}

function centroidOf(hexes: Axial[], layout: HexLayout): Pixel {
  let x = 0;
  let y = 0;
  for (const h of hexes) {
    const p = axialToPixel(h, layout);
    x += p.x;
    y += p.y;
  }
  return { x: x / hexes.length, y: y / hexes.length };
}

function dist2(a: Pixel, b: Pixel): number {
  return (a.x - b.x) ** 2 + (a.y - b.y) ** 2;
}

/** The hex to nest order tokens against. For a single-hex tile this is that hex (unchanged). For
 *  a fused multi-hex tile it is the hex nearest the tile's top-centre — (centroid.x, topmost-row
 *  y) — so tokens sit over the tile body instead of hanging off the extreme topmost hex's outer
 *  vertex, which on large/irregular tiles pushed them to the top edge or over a neighbour. */
function topAnchorHex(hexes: Axial[], layout: HexLayout, centroid: Pixel): Pixel {
  const pts = hexes.map((h) => axialToPixel(h, layout));
  const minY = Math.min(...pts.map((p) => p.y));
  const target = { x: centroid.x, y: minY };
  return pts.reduce((a, b) => (dist2(b, target) < dist2(a, target) ? b : a));
}

/** Bottommost hex centre of a tile; rightmost on ties (dual of topmostHex, for SE features). */
function bottommostHex(hexes: Axial[], layout: HexLayout): Pixel {
  return hexes
    .map((h) => axialToPixel(h, layout))
    .reduce((a, b) => (b.y > a.y + 0.01 || (Math.abs(b.y - a.y) <= 0.01 && b.x > a.x) ? b : a));
}

/** Rightmost hex centre of a tile; topmost on ties (for the E-corner bonus badge). */
function rightmostHex(hexes: Axial[], layout: HexLayout): Pixel {
  return hexes
    .map((h) => axialToPixel(h, layout))
    .reduce((a, b) => (b.x > a.x + 0.01 || (Math.abs(b.x - a.x) <= 0.01 && b.y < a.y) ? b : a));
}

/** Order-slot ids for a tile, matching web slotIdForSpace: land→move, sea→sail+bombard,
 *  shellable land→shell. As on board.svg, each token nests corner-on-corner into a vertex
 *  of the tile's topmost hex: the token centre sits at (R - tokenR) along the centre→vertex
 *  axis, so the token's outer corner lands exactly on the region's corner. The primary
 *  action (move/sail) takes the NW vertex (120°), the secondary (shell/bombard) the NE
 *  (60°). Value-star badges live in the SE corner, so tokens never collide with them.
 *  The occupancy dot anchors to the token centre. */
function slotsFor(
  area: MapArea,
  hexes: Axial[],
  layout: HexLayout,
  centroid: Pixel
): Record<string, Pixel> {
  const ids: string[] = [];
  if (area.kind === "land") {
    ids.push(`move-${area.id}`);
    if (area.shellable) {
      ids.push(`shell-${area.id}`);
    }
  } else {
    ids.push(`sail-${area.id}`, `bombard-${area.id}`);
  }
  const anchor = topAnchorHex(hexes, layout, centroid);
  const nest = layout.size - ORDER_TOKEN_RADIUS * (layout.size / NATIVE_HEX_SIZE);
  const slots: Record<string, Pixel> = {};
  ids.forEach((id, i) => {
    // NW vertex direction (-0.5, -√3/2) for the primary token, NE (+0.5, -√3/2) secondary.
    slots[id] = {
      x: anchor.x + (i === 0 ? -0.5 : 0.5) * nest,
      y: anchor.y - (Math.sqrt(3) / 2) * nest
    };
  });
  return slots;
}

export function buildScene(compiled: CompiledMap): BoardScene {
  const layout = hexLayout(compiled);
  const centroids = new Map<string, Pixel>();
  const tiles: SceneTile[] = [];
  const hexGrid: Edge[] = [];

  const bonusIndex = new Map<string, number>();
  compiled.definition.bonusSlots.forEach((id, i) => bonusIndex.set(id, i));

  // First pass: geometry + centroids.
  for (const area of Object.values(compiled.definition.areas)) {
    const hexes = compiled.layout.tiles[area.id]!.hexes;
    const centroid = centroidOf(hexes, layout);
    centroids.set(area.id, centroid);
    hexGrid.push(...hexEdges(hexes, layout));
    const bonusSlot = bonusIndex.get(area.id);
    tiles.push({
      id: area.id,
      kind: area.kind,
      rings: fuseTile(hexes, layout),
      centroid,
      authoredFill: area.kind === "sea" ? TILE_SEA_FILL : TILE_LAND_FILL,
      features: {
        hq: area.hq ?? undefined,
        valueStars: area.valueStars,
        harbor: area.harbor,
        fort: area.fort
      },
      glyphAnchors: {
        hq: area.hq ? centroid : undefined,
        // Value-star badge sits in the SE corner (as on board.svg, measured): along the
        // lower-right vertex axis (+0.5, +√3/2) at 0.745× the centre→vertex distance for the
        // 1-star circle, 0.713× for the wider 2-star pill — opposite the order tokens, which
        // own the NW/NE corners. Anchored on the bottommost hex of a fused tile.
        stars:
          area.valueStars > 0
            ? (() => {
                const hex = bottommostHex(hexes, layout);
                const dist = (area.valueStars === 2 ? 0.713 : 0.745) * layout.size;
                return {
                  x: hex.x + 0.5 * dist,
                  y: hex.y + (Math.sqrt(3) / 2) * dist
                };
              })()
            : undefined,
        harbor: area.harbor ? { x: centroid.x, y: centroid.y + layout.size * 0.4 } : undefined,
        bonus:
          bonusSlot !== undefined
            ? (() => {
                // Seat the badge just inside the tile's right (E) corner: the rightmost hex's
                // E vertex, pulled in by 0.72× the centre→vertex distance. (The 0.72 equals
                // assemble.ts's BONUS_BADGE_FRACTION by coincidence — they are independent.)
                const hex = rightmostHex(hexes, layout);
                return { x: hex.x + 0.72 * layout.size, y: hex.y };
              })()
            : undefined
      },
      bonusGlyph: bonusSlot !== undefined ? ("glyph-bonus-generic" as GlyphId) : undefined,
      slots: slotsFor(area, hexes, layout, centroid),
      ports: []
    });
  }

  // Second pass: piers — one per hex edge of a harbour tile that faces a sea tile. A sea
  // area touching the same harbour hex across two edges therefore gets two piers.
  const hexOwner = new Map<string, { id: string; kind: "land" | "sea" }>();
  for (const area of Object.values(compiled.definition.areas)) {
    for (const h of compiled.layout.tiles[area.id]!.hexes) {
      hexOwner.set(axialKey(h), { id: area.id, kind: area.kind });
    }
  }
  for (const tile of tiles) {
    const area = compiled.definition.areas[tile.id]!;
    if (!area.harbor) {
      continue;
    }
    const ports: { to: string; edge: Pixel; dir: Pixel }[] = [];
    for (const h of compiled.layout.tiles[tile.id]!.hexes) {
      const from = axialToPixel(h, layout);
      for (const n of neighbors(h)) {
        const owner = hexOwner.get(axialKey(n));
        if (!owner || owner.kind !== "sea") {
          continue;
        }
        const to = axialToPixel(n, layout);
        const dx = to.x - from.x;
        const dy = to.y - from.y;
        const len = Math.hypot(dx, dy) || 1;
        ports.push({
          to: owner.id,
          edge: { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 },
          dir: { x: dx / len, y: dy / len }
        });
      }
    }
    tile.ports = ports;
  }

  // viewBox from the union of all ring points + margin.
  const xs = tiles.flatMap((t) => t.rings.flat().map((p) => p.x));
  const ys = tiles.flatMap((t) => t.rings.flat().map((p) => p.y));
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  const maxX = Math.max(...xs);
  const maxY = Math.max(...ys);
  return {
    viewBox: {
      x: minX - MARGIN,
      y: minY - MARGIN,
      width: maxX - minX + 2 * MARGIN,
      height: maxY - minY + 2 * MARGIN
    },
    tiles,
    hexGrid,
    hexSize: layout.size
  };
}
