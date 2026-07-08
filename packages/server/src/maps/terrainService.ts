import { fileURLToPath } from "node:url";
import { compileHexMap } from "@sengoku-jidai/engine";
import type { HexMapSource } from "@sengoku-jidai/engine";
import { assembleBoardSvg, buildScene } from "@sengoku-jidai/board-render";
import {
  createFalClient,
  generateTerrainWebp,
  loadMapProfile,
  type EditDeps,
  type MapProfile
} from "@sengoku-jidai/terrain";
import type { MapLibrary } from "./library.js";
import type { TerrainStore } from "./terrainStore.js";

/** Locate the terrain package's shipped profile via its package entry, so this resolves the
 *  same file whether running from source (tests) or the built server. */
function defaultProfile(): MapProfile {
  const profilePath = fileURLToPath(new URL("../../../terrain/profiles/map.json", import.meta.url));
  return loadMapProfile(profilePath);
}

interface TerrainServiceArgs {
  library: MapLibrary;
  store: TerrainStore;
  falKey: string | undefined;
  deps?: EditDeps;
  profile?: MapProfile;
}

export class TerrainService {
  private readonly library: MapLibrary;
  private readonly store: TerrainStore;
  private readonly falKey: string | undefined;
  private readonly deps: EditDeps | undefined;
  private readonly profile: MapProfile;
  private readonly inflight = new Set<string>();

  constructor(args: TerrainServiceArgs) {
    this.library = args.library;
    this.store = args.store;
    this.falKey = args.falKey;
    this.deps = args.deps;
    this.profile = args.profile ?? defaultProfile();
  }

  available(): boolean {
    return Boolean(this.falKey);
  }

  isGenerating(mapId: string): boolean {
    return this.inflight.has(mapId);
  }

  /** Resolve the deps: injected in tests; built from FAL_KEY + global fetch in production. */
  private async resolveDeps(): Promise<EditDeps> {
    if (this.deps) {
      return this.deps;
    }
    const fal = createFalClient(this.falKey!);
    return { fal, fetch: globalThis.fetch };
  }

  async generate(mapId: string): Promise<void> {
    const detail = this.library.get(mapId);
    if (!detail || detail.builtin) {
      return; // routes reject these before calling; guard anyway, record nothing
    }
    this.inflight.add(mapId);
    try {
      this.store.markPending(mapId);
      const source = detail.source as HexMapSource;
      const compiled = compileHexMap(source);
      const svgMarkup = assembleBoardSvg(buildScene(compiled));
      const deps = await this.resolveDeps();
      // Reroll the seed each run so regenerating the same map yields a different look
      // (spec: "each run varies the fal seed"). A fresh 31-bit seed per generation.
      const profile: MapProfile = {
        ...this.profile,
        edit: { ...this.profile.edit, seed: Math.floor(Math.random() * 0x7fffffff) }
      };
      const webp = await generateTerrainWebp(deps, {
        svgMarkup,
        map: compiled.definition,
        profile
      });
      this.store.saveReady(mapId, webp);
    } catch (err) {
      this.store.markFailed(mapId, err instanceof Error ? err.message : String(err));
    } finally {
      this.inflight.delete(mapId);
    }
  }
}
