import { compileHexMap } from "@sengoku-jidai/engine";
import type { HexMapSource } from "@sengoku-jidai/engine";
import { assembleBoardSvg, buildScene } from "@sengoku-jidai/board-render";
import type { TerrainInfo } from "@sengoku-jidai/shared";
import {
  createFalClient,
  generateTerrainWebp,
  inpaintFortsOnWebp,
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

  /** Render TWO base-only candidates (gpt-image varies naturally) and land the row in choosing.
   *  Inflight guard keyed by map id so a map generates one terrain at a time. */
  private async run(mapId: string, terrainId: string, styleId: string): Promise<void> {
    const detail = this.library.get(mapId);
    if (!detail || detail.builtin) {
      return;
    }
    this.inflight.add(mapId);
    this.store.markPendingById(terrainId); // clears any stale candidates from a prior attempt
    try {
      const compiled = compileHexMap(detail.source as HexMapSource);
      const svgMarkup = assembleBoardSvg(buildScene(compiled));
      const deps = await this.resolveDeps();
      const profile = loadStyleProfile(styleId);
      // Base-only: no `scene` → the fort pass is skipped for candidates.
      const [a, b] = await Promise.all([
        generateTerrainWebp(deps, { svgMarkup, map: compiled.definition, profile }),
        generateTerrainWebp(deps, { svgMarkup, map: compiled.definition, profile })
      ]);
      this.store.addCandidate(terrainId, 0, a);
      this.store.addCandidate(terrainId, 1, b);
      this.store.markChoosing(terrainId);
    } catch (err) {
      this.store.markFailedById(terrainId, err instanceof Error ? err.message : String(err));
    } finally {
      this.inflight.delete(mapId);
    }
  }

  /** Keep candidate `index`: inpaint forts onto that base and commit it as the ready terrain. */
  choose(mapId: string, terrainId: string, index: number): void {
    void this.finalize(mapId, terrainId, index);
  }

  private async finalize(mapId: string, terrainId: string, index: number): Promise<void> {
    const detail = this.library.get(mapId);
    if (!detail || detail.builtin) {
      return;
    }
    const base = this.store.candidateWebp(terrainId, index);
    if (!base) {
      return; // nothing to finalise
    }
    const styleId = this.store.styleIdOf(terrainId) ?? "antique";
    this.inflight.add(mapId);
    this.store.markFinalizing(terrainId); // pending, candidates preserved
    try {
      const compiled = compileHexMap(detail.source as HexMapSource);
      const scene = buildScene(compiled);
      const deps = await this.resolveDeps();
      const webp = await inpaintFortsOnWebp(deps, {
        webp: base,
        profile: loadStyleProfile(styleId),
        scene
      });
      this.store.markReadyById(terrainId, webp); // clears candidates
    } catch {
      this.store.markChoosing(terrainId); // revert; candidates intact so the pick can be retried
    } finally {
      this.inflight.delete(mapId);
    }
  }
}
