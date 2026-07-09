import { useEffect, useState } from "react";
import type { MapDetail } from "@sengoku-jidai/shared";
import { fetchMap } from "../../client/api.js";
import { resolveTerrainUrl, terrainImage } from "./terrainImages.js";

/** Pure/injectable resolution: committed asset wins; otherwise fetch the detail and apply the
 *  ready-gate. Any fetch error resolves to null (board falls back to flat fills). */
export async function fetchTerrainUrl(
  mapId: string,
  committed: string | null,
  fetchDetail: (id: string) => Promise<MapDetail>
): Promise<string | null> {
  if (committed) {
    return committed;
  }
  try {
    const detail = await fetchDetail(mapId);
    return resolveTerrainUrl({ committed: null, terrain: detail.terrain, mapId });
  } catch {
    return null;
  }
}

/** Terrain background URL for a map id. Built-ins resolve synchronously from the committed
 *  asset; custom maps fetch their detail once and light up when generation is `ready`. */
export function useTerrainUrl(mapId: string): string | null {
  const committed = terrainImage(mapId);
  const [url, setUrl] = useState<string | null>(committed);

  useEffect(() => {
    let cancelled = false;
    setUrl(committed);
    if (committed) {
      return;
    }
    if (!mapId) {
      setUrl(null);
      return;
    }
    fetchTerrainUrl(mapId, null, fetchMap).then((resolved) => {
      if (!cancelled) {
        setUrl(resolved);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [mapId, committed]);

  return url;
}
