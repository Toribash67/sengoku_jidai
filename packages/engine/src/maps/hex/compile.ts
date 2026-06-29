import type { MapArea, MapDefinition } from "../riversMap.js";
import { axialKey, axialToPixel, NEIGHBOR_DIRS } from "./coords.js";
import type { Axial } from "./coords.js";
import type { HexMapSource } from "./source.js";
import { validateHexMap } from "./validate.js";

export interface MapLayout {
  size: number;
  origin: { x: number; y: number };
  tiles: Record<string, { hexes: Axial[] }>;
  bounds: { minX: number; minY: number; maxX: number; maxY: number };
}

export interface CompiledMap {
  definition: MapDefinition;
  layout: MapLayout;
}

/** Compile a hex authoring source into the runtime `MapDefinition` (with adjacency
 *  auto-derived from shared hex edges) plus a separate `MapLayout` for the renderer. */
export function compileHexMap(source: HexMapSource): CompiledMap {
  validateHexMap(source);

  const adjacency = deriveAdjacency(source);
  const areas: Record<string, MapArea> = {};
  for (const t of source.tiles) {
    areas[t.id] = {
      id: t.id,
      kind: t.kind,
      hq: t.features.hq ?? null,
      valueStars: t.features.valueStars ?? 0,
      harbor: t.features.harbor ?? false,
      shellable: t.features.shellable ?? false,
      adjacent: [...(adjacency.get(t.id) ?? [])].sort(),
      ports: [...(t.ports ?? [])].sort()
    };
  }

  const definition: MapDefinition = {
    id: source.id,
    name: source.name,
    areas,
    bonusSlots: [...source.bonusSlots]
  };

  return { definition, layout: buildLayout(source) };
}

/** tileId -> set of adjacent tileIds, symmetric by construction. */
function deriveAdjacency(source: HexMapSource): Map<string, Set<string>> {
  const owner = new Map<string, string>(); // axialKey -> tileId
  for (const t of source.tiles) {
    for (const h of t.hexes) {
      owner.set(axialKey(h), t.id);
    }
  }
  const adj = new Map<string, Set<string>>();
  for (const t of source.tiles) {
    adj.set(t.id, new Set());
  }
  for (const t of source.tiles) {
    for (const h of t.hexes) {
      for (const d of NEIGHBOR_DIRS) {
        const ownerId = owner.get(axialKey({ q: h.q + d.q, r: h.r + d.r }));
        if (ownerId && ownerId !== t.id) {
          adj.get(t.id)!.add(ownerId);
          adj.get(ownerId)!.add(t.id);
        }
      }
    }
  }
  return adj;
}

function buildLayout(source: HexMapSource): MapLayout {
  const layout = source.layout;
  const tiles: Record<string, { hexes: Axial[] }> = {};
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const t of source.tiles) {
    tiles[t.id] = { hexes: t.hexes.map((h) => ({ q: h.q, r: h.r })) };
    for (const h of t.hexes) {
      const p = axialToPixel(h, layout);
      minX = Math.min(minX, p.x - layout.size);
      maxX = Math.max(maxX, p.x + layout.size);
      minY = Math.min(minY, p.y - layout.size);
      maxY = Math.max(maxY, p.y + layout.size);
    }
  }
  return {
    size: layout.size,
    origin: { x: layout.originX, y: layout.originY },
    tiles,
    bounds: { minX, minY, maxX, maxY }
  };
}
