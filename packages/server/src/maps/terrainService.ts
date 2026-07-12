import { compileHexMap } from "@sengoku-jidai/engine";
import type { HexMapSource } from "@sengoku-jidai/engine";
import { assembleBoardSvg, buildScene } from "@sengoku-jidai/board-render";
import { DEFAULT_TERRAIN_STYLE } from "@sengoku-jidai/shared";
import {
  createFalClient,
  generateTerrainWebp,
  loadStyleProfile,
  type EditDeps,
  type MapProfile
} from "@sengoku-jidai/terrain";
import type { MapLibrary } from "./library.js";
import type { TerrainStore } from "./terrainStore.js";

/** The default terrain profile: the shared default style, resolved by the terrain package
 *  (works from source and the built image without a hand-built relative path). */
function defaultProfile(): MapProfile {
  return loadStyleProfile(DEFAULT_TERRAIN_STYLE);
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
      // gpt-image has no seed and varies naturally between runs, so regenerate-for-variety
      // still produces a different look without any reroll here.
      const webp = await generateTerrainWebp(deps, {
        svgMarkup,
        map: compiled.definition,
        profile: this.profile
      });
      this.store.saveReady(mapId, webp);
    } catch (err) {
      this.store.markFailed(mapId, err instanceof Error ? err.message : String(err));
    } finally {
      this.inflight.delete(mapId);
    }
  }
}
