import type { MapDefinition, SeatId } from "@sengoku-jidai/engine";

export interface TileValueWeights {
  star: number;
  bonusSlot: number;
  proximity: number;
}

const distanceCache = new Map<string, Map<string, number>>();

/** BFS hop-count from `seat`'s HQ over general adjacency. Cached per (mapId, seat). */
export function hqDistances(map: MapDefinition, seat: SeatId): Map<string, number> {
  const key = `${map.id}:${seat}`;
  const cached = distanceCache.get(key);
  if (cached) return cached;

  const dist = new Map<string, number>();
  const hq = Object.values(map.areas).find((a) => a.hq === seat);
  if (hq) {
    dist.set(hq.id, 0);
    const queue: string[] = [hq.id];
    while (queue.length > 0) {
      const cur = queue.shift()!;
      const d = dist.get(cur)!;
      for (const n of map.areas[cur]!.adjacent) {
        if (!dist.has(n)) {
          dist.set(n, d + 1);
          queue.push(n);
        }
      }
    }
  }
  distanceCache.set(key, dist);
  return dist;
}

/** Geometry-only importance of `areaId` to `seat`: star value, a bonus-slot bump, and
 *  proximity to the ENEMY HQ (so offense — and, via the eval's differential, defense —
 *  concentrate where they matter). */
export function tileBaseValue(
  map: MapDefinition,
  seat: SeatId,
  areaId: string,
  w: TileValueWeights
): number {
  const area = map.areas[areaId]!;
  const enemy: SeatId = seat === "red" ? "black" : "red";
  const enemyDist = hqDistances(map, enemy).get(areaId);
  // Nearer the enemy HQ => higher proximity. 1/(dist+1) in [0,1], 0 if unreachable.
  const proximity = enemyDist === undefined ? 0 : 1 / (enemyDist + 1);
  const bonusSlot = map.bonusSlots.includes(areaId) ? 1 : 0;
  return w.star * area.valueStars + w.bonusSlot * bonusSlot + w.proximity * proximity;
}
