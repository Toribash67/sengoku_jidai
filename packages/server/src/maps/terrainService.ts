import { compileHexMap } from "@sengoku-jidai/engine";
import type { HexMapSource } from "@sengoku-jidai/engine";
import { assembleBoardSvg, buildScene } from "@sengoku-jidai/board-render";
import type { TerrainInfo } from "@sengoku-jidai/shared";
import {
  createFalClient,
  generateTerrainWebp,
  loadStyleProfile,
  type EditDeps
} from "@sengoku-jidai/terrain";
import type { MapLibrary } from "./library.js";
import type { TerrainStore } from "./terrainStore.js";

/** Next auto name: "Terrain N" where N is one past the highest existing "Terrain <n>" (names are
 *  renameable and not unique, so we key off the number, not the count). */
export function autoName(existing: Pick<TerrainInfo, "name">[]): string {
  const max = existing.reduce((m, t) => {
    const match = /^Terrain (\d+)$/.exec(t.name);
    return match ? Math.max(m, Number(match[1])) : m;
  }, 0);
  return `Terrain ${max + 1}`;
}

interface TerrainServiceArgs {
  library: MapLibrary;
  store: TerrainStore;
  falKey: string | undefined;
  deps?: EditDeps;
}

export class TerrainService {
  private readonly library: MapLibrary;
  private readonly store: TerrainStore;
  private readonly falKey: string | undefined;
  private readonly deps: EditDeps | undefined;
  private readonly inflight = new Set<string>();

  constructor(args: TerrainServiceArgs) {
    this.library = args.library;
    this.store = args.store;
    this.falKey = args.falKey;
    this.deps = args.deps;
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

  /** Create a new terrain for the map and generate it. Returns the new terrain id. The route
   *  enforces availability, existence, built-in, in-flight, and cap guards first. */
  generate(mapId: string, styleId: string): string {
    const id = this.store.create(mapId, autoName(this.store.list(mapId)), styleId);
    void this.run(mapId, id, styleId);
    return id;
  }

  /** Shared worker: compile → board SVG → terrain webp (style profile) → store by id. In-flight
   *  guard is keyed by map id so a map generates one terrain at a time. Re-flags the row pending
   *  first so a regenerated terrain shows progress (a fresh row is already pending — harmless). */
  private async run(mapId: string, terrainId: string, styleId: string): Promise<void> {
    const detail = this.library.get(mapId);
    if (!detail || detail.builtin) {
      return;
    }
    this.inflight.add(mapId);
    this.store.markPendingById(terrainId);
    try {
      const compiled = compileHexMap(detail.source as HexMapSource);
      const scene = buildScene(compiled);
      const svgMarkup = assembleBoardSvg(scene);
      const deps = await this.resolveDeps();
      // gpt-image has no seed and varies naturally between runs, so regenerate-for-variety
      // still produces a different look without any reroll here.
      const webp = await generateTerrainWebp(deps, {
        svgMarkup,
        map: compiled.definition,
        profile: loadStyleProfile(styleId),
        scene
      });
      this.store.markReadyById(terrainId, webp);
    } catch (err) {
      this.store.markFailedById(terrainId, err instanceof Error ? err.message : String(err));
    } finally {
      this.inflight.delete(mapId);
    }
  }
}
