import type { MapDefinition } from "./riversMap.js";
import { riversMap } from "./riversMap.js";

/**
 * Registry of available maps, keyed by map id.
 *
 * Adding a map is additive: define its `MapDefinition` in its own module and
 * register it here. The base game ships a second, more complex map (richer tile
 * types and rules); when it lands it will register alongside "Rivers", and its
 * rules differences are carried by the ruleset (see `RulesConfig`), not hard-coded
 * into the engine's command resolution.
 */
const maps: Record<string, MapDefinition> = {
  [riversMap.id]: riversMap
};

export function getMap(id: string): MapDefinition {
  const map = maps[id];
  if (!map) {
    throw new Error(`Unknown map id: ${id}`);
  }
  return map;
}

export function listMaps(): MapDefinition[] {
  return Object.values(maps);
}
