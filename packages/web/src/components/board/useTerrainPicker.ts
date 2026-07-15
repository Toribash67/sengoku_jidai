import { useEffect, useMemo, useState } from "react";
import type { MapDetail, TerrainInfo } from "@sengoku-jidai/shared";
import { fetchMap } from "../../client/api.js";
import { loadTerrainChoice, saveTerrainChoice } from "../../state/localGame.js";
import {
  buildTerrainOptions,
  builtinTerrains,
  FLAT_TERRAIN_KEY,
  resolveTerrainOption,
  terrainImage,
  type TerrainOption
} from "./terrainImages.js";

export interface TerrainPicker {
  options: TerrainOption[];
  selectedKey: string;
  terrainUrl: string | null;
  select: (key: string) => void;
}

/** Fetch a map's terrains once; any error (including a built-in 404) yields []. */
export async function fetchTerrains(
  mapId: string,
  fetchDetail: (id: string) => Promise<MapDetail>
): Promise<TerrainInfo[]> {
  try {
    return (await fetchDetail(mapId)).terrains;
  } catch {
    return [];
  }
}

/** Play-view terrain picker state: builds the option list (committed "Original" + ready
 *  terrains), resolves the persisted per-map choice (stale keys fall back to Flat), and
 *  persists on select. Terrain is purely client-side, so this is a per-viewer preference. */
export function useTerrainPicker(mapId: string): TerrainPicker {
  const committed = terrainImage(mapId);
  const builtins = useMemo(() => builtinTerrains(mapId), [mapId]);
  const [terrains, setTerrains] = useState<TerrainInfo[]>([]);
  const [selectedKey, setSelectedKey] = useState<string>(
    () => loadTerrainChoice(mapId) ?? FLAT_TERRAIN_KEY
  );

  useEffect(() => {
    let cancelled = false;
    setTerrains([]);
    setSelectedKey(loadTerrainChoice(mapId) ?? FLAT_TERRAIN_KEY);
    if (!mapId) {
      return;
    }
    fetchTerrains(mapId, fetchMap).then((result) => {
      if (!cancelled) {
        setTerrains(result);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [mapId]);

  const options = useMemo(
    () => buildTerrainOptions({ mapId, committed, builtins, terrains }),
    [mapId, committed, builtins, terrains]
  );
  const resolved = resolveTerrainOption(options, selectedKey);

  return {
    options,
    selectedKey: resolved.key,
    terrainUrl: resolved.url,
    select: (key: string) => {
      setSelectedKey(key);
      saveTerrainChoice(mapId, key);
    }
  };
}
