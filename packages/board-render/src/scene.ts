import { axialToPixel } from "@sengoku-jidai/engine";
import type { Axial, CompiledMap, HexLayout, MapArea, Pixel, SeatId } from "@sengoku-jidai/engine";
import { fuseTile, hexEdges, type Edge } from "./outline.js";
import { bonusGlyph, type GlyphId } from "./assets.js";

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
  features: { hq?: SeatId; valueStars: 0 | 1 | 2; harbor: boolean };
  glyphAnchors: { hq?: Pixel; stars?: Pixel; harbor?: Pixel; bonus?: Pixel };
  bonusGlyph?: GlyphId;
  slots: Record<string, Pixel>;
  ports: { to: string; from: Pixel; toPoint: Pixel }[];
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

/** Order-slot ids for a tile, matching web slotIdForSpace: land→move, sea→sail+bombard,
 *  shellable land→shell. Fanned around the centroid so occupancy dots do not overlap. */
function slotsFor(area: MapArea, centroid: Pixel, size: number): Record<string, Pixel> {
  const ids: string[] = [];
  if (area.kind === "land") {
    ids.push(`move-${area.id}`);
    if (area.shellable) {
      ids.push(`shell-${area.id}`);
    }
  } else {
    ids.push(`sail-${area.id}`, `bombard-${area.id}`);
  }
  const slots: Record<string, Pixel> = {};
  const radius = ids.length > 1 ? size * 0.5 : 0;
  ids.forEach((id, i) => {
    const angle = (Math.PI / 180) * (90 + (360 / ids.length) * i);
    slots[id] = {
      x: centroid.x + radius * Math.cos(angle),
      y: centroid.y + radius * Math.sin(angle)
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

  // First pass: geometry + centroids (needed before ports can reference sea centroids).
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
      features: { hq: area.hq ?? undefined, valueStars: area.valueStars, harbor: area.harbor },
      glyphAnchors: {
        hq: area.hq ? centroid : undefined,
        stars:
          area.valueStars > 0 ? { x: centroid.x, y: centroid.y - layout.size * 0.4 } : undefined,
        harbor: area.harbor ? { x: centroid.x, y: centroid.y + layout.size * 0.4 } : undefined,
        bonus:
          bonusSlot !== undefined
            ? { x: centroid.x - layout.size * 0.45, y: centroid.y + layout.size * 0.25 }
            : undefined
      },
      bonusGlyph: bonusSlot !== undefined ? bonusGlyph(bonusSlot) : undefined,
      slots: slotsFor(area, centroid, layout.size),
      ports: []
    });
  }

  // Second pass: ports (need both endpoints' centroids).
  for (const tile of tiles) {
    const area = compiled.definition.areas[tile.id]!;
    tile.ports = area.ports.map((seaId) => ({
      to: seaId,
      from: centroids.get(tile.id)!,
      toPoint: centroids.get(seaId)!
    }));
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
