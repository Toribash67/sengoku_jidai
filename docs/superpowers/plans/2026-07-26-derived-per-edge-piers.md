# Derived, Per-Edge Harbor Piers Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make harbor piers derived from hex adjacency (a harbor land tile automatically ports to every neighbouring sea tile) and render one pier per sea-facing hex edge instead of one per sea tile.

**Architecture:** Three layers change. (1) Engine: `compileHexMap` derives `MapArea.ports` for harbor tiles from the adjacency it already computes; the authored `ports` field is removed from the source type, wire schema, validation, and both built-in/fixture maps. Gameplay (`legality.ts`) is untouched because `MapArea.ports` keeps its shape. (2) board-render: piers are computed per hex edge — for each harbor hex, each of its 6 edges that faces a sea hex emits a pier at the edge midpoint pointing outward; a sea area touching a harbor hex on multiple edges therefore gets multiple piers. (3) web editor: the manual port-placement UI, reducer actions, and canvas overlay are removed.

**Tech Stack:** TypeScript monorepo (pnpm workspaces), Vitest, Zod (wire schema), React (editor). Hex geometry helpers live in `@sengoku-jidai/engine` (`axialKey`, `neighbors`, `axialToPixel`, `NEIGHBOR_DIRS`).

## Global Constraints

- Package manager is `corepack pnpm`. Cross-package tests consume built `dist/`, so rebuild libs before running a consuming package's tests: `corepack pnpm build:libs` (builds engine, shared, board-render, terrain in order).
- Engine's own tests import from `src/` directly (relative paths) — they do not need a rebuild, but the shared schema and board-render/web consumers do.
- Never surface raw tile ids in player-facing UI (existing project rule); this change removes an editor affordance and adds none.
- Do not change `MapArea.ports`'s type or meaning — `legality.ts` and the compiled `riversMap.snapshot.json` depend on it. Verified fact: every Rivers harbor's adjacency-derived sea set exactly equals its currently-authored `ports`, so the compiled snapshot and all gameplay are unchanged.
- Verified fact: every Rivers harbor and the fixture harbor "D" are single-hex and each borders any given sea tile on at most one edge, so the **rendered** Rivers board SVG and the `assemble.test.ts` snapshot are byte-identical after this change. The new per-edge behaviour is exercised only by a new synthetic test.

---

### Task 1: Engine + shared — derive ports from adjacency, remove the authored field

**Files:**
- Modify: `packages/engine/src/maps/hex/compile.ts` (area build, ~line 35)
- Modify: `packages/engine/src/maps/hex/source.ts:24-25` (remove `ports` field)
- Modify: `packages/engine/src/maps/hex/validate.ts:56-72` (remove ports validation)
- Modify: `packages/engine/src/maps/hex/fixtures.ts:37-39` (remove authored `ports`)
- Modify: `packages/engine/src/maps/riversSource.ts` (remove 5 authored `ports` arrays)
- Modify: `packages/shared/src/schemas.ts:116` (remove `ports` from `hexTileSourceSchema`)
- Test: `packages/engine/test/maps/hex/compile.test.ts:17` (already asserts derived `["C"]`)
- Test: `packages/engine/test/maps/hex/validate.test.ts:58-72` (delete two port tests)

**Interfaces:**
- Produces: `MapArea.ports: string[]` — for a harbor tile, the sorted unique set of edge-adjacent sea tile ids; `[]` for non-harbor tiles. Unchanged type; now derived rather than copied.
- Produces: `HexTileSource` no longer has a `ports` field. `HexMapSource` wire schema matches it (drift guard in `packages/server/src/maps/library.ts:15` stays satisfied because both sides drop `ports` together).

- [ ] **Step 1: Make the derivation test fail — remove the authored port from the fixture**

In `packages/engine/src/maps/hex/fixtures.ts`, change tile D (lines 34-40) from:

```ts
    {
      id: "D",
      kind: "land",
      hexes: [{ q: -1, r: 1 }],
      features: { harbor: true },
      ports: ["C"]
    },
```

to:

```ts
    {
      id: "D",
      kind: "land",
      hexes: [{ q: -1, r: 1 }],
      features: { harbor: true }
    },
```

Also update the fixture header comment (line 8) from `D  land, harbor -> port C  hexes (-1,1)` to `D  land, harbor (borders sea C) hexes (-1,1)`.

- [ ] **Step 2: Run the compile test to verify it now fails**

Run: `corepack pnpm --filter @sengoku-jidai/engine exec vitest run test/maps/hex/compile.test.ts -t "emits one area per tile"`
Expected: FAIL at `expect(definition.areas.D!.ports).toEqual(["C"])` — actual is `[]` (ports no longer authored, derivation not yet implemented).

- [ ] **Step 3: Implement port derivation in `compile.ts`**

In `packages/engine/src/maps/hex/compile.ts`, inside `compileHexMap`, after `const adjacency = deriveAdjacency(source);` (line 24) add a kind lookup, then change the `ports` line in the area build.

Add after line 24:

```ts
  const kindById = new Map(source.tiles.map((t) => [t.id, t.kind] as const));
```

Change line 35 from:

```ts
      ports: [...(t.ports ?? [])].sort()
```

to:

```ts
      // Piers are derived, not authored: a harbor ports to every edge-adjacent sea tile.
      ports: t.features.harbor
        ? [...(adjacency.get(t.id) ?? [])].filter((id) => kindById.get(id) === "sea").sort()
        : []
```

- [ ] **Step 4: Run the compile test to verify it passes**

Run: `corepack pnpm --filter @sengoku-jidai/engine exec vitest run test/maps/hex/compile.test.ts`
Expected: PASS (all cases, including `areas.D.ports === ["C"]` derived and the `[...a.adjacent, ...a.ports]` dangling-ref sweep).

- [ ] **Step 5: Remove the `ports` field from the source type**

In `packages/engine/src/maps/hex/source.ts`, delete lines 24-25:

```ts
  /** Sea tile ids reachable from this harbor via a pier. Not movement edges. */
  ports?: string[];
```

(The `harbor?: boolean` feature stays; its comment `/** Can build/launch ships (a port endpoint). */` is still accurate.)

- [ ] **Step 6: Remove the `ports` field from the wire schema**

In `packages/shared/src/schemas.ts`, change `hexTileSourceSchema` (lines 111-117) by deleting the `ports` line so it reads:

```ts
export const hexTileSourceSchema = z.object({
  id: z.string().min(1),
  kind: z.enum(["land", "sea"]),
  hexes: z.array(axialSchema).min(1),
  features: hexTileFeaturesSchema
});
```

- [ ] **Step 7: Remove the ports validation block**

In `packages/engine/src/maps/hex/validate.ts`, delete the entire ports loop (lines 56-72):

```ts
  for (const t of tiles) {
    if (!t.ports || t.ports.length === 0) {
      continue;
    }
    if (!t.features.harbor) {
      throw new Error(`tile ${t.id} has ports but is not a harbor`);
    }
    for (const id of t.ports) {
      const target = tiles.find((x) => x.id === id);
      if (!target) {
        throw new Error(`tile ${t.id} port references unknown tile ${id}`);
      }
      if (target.kind !== "sea") {
        throw new Error(`tile ${t.id} port ${id} is not sea`);
      }
    }
  }
```

- [ ] **Step 8: Delete the now-obsolete validation tests**

In `packages/engine/test/maps/hex/validate.test.ts`, delete both tests (lines 58-72):

```ts
  it("rejects a port pointing at a non-sea tile", () => {
    const m = clone();
    const harbor = m.tiles.find((t) => t.features.harbor)!;
    const land = m.tiles.find((t) => t.kind === "land")!;
    harbor.ports = [land.id];
    expect(() => validateHexMap(m)).toThrow(/not sea/);
  });

  it("rejects ports on a non-harbor tile", () => {
    const m = clone();
    const plainLand = m.tiles.find((t) => t.kind === "land" && !t.features.harbor)!;
    const sea = m.tiles.find((t) => t.kind === "sea")!;
    plainLand.ports = [sea.id];
    expect(() => validateHexMap(m)).toThrow(/not a harbor/);
  });
```

- [ ] **Step 9: Remove authored ports from the Rivers built-in map**

In `packages/engine/src/maps/riversSource.ts`, delete the `ports:` line from each of the five harbor tiles. Tile6 (lines 42-48) becomes:

```ts
    {
      id: "tile6",
      kind: "land",
      hexes: [{ q: 3, r: 4 }],
      features: { valueStars: 1, harbor: true }
    },
```

Tile8 (50-56):

```ts
    {
      id: "tile8",
      kind: "land",
      hexes: [{ q: 1, r: 5 }],
      features: { valueStars: 1, harbor: true }
    },
```

Tile9 (57-63):

```ts
    {
      id: "tile9",
      kind: "land",
      hexes: [{ q: 4, r: 2 }],
      features: { hq: "red", harbor: true }
    },
```

Tile13 (67-73):

```ts
    {
      id: "tile13",
      kind: "land",
      hexes: [{ q: 0, r: 4 }],
      features: { hq: "black", harbor: true }
    },
```

Tile16 (84-90):

```ts
    {
      id: "tile16",
      kind: "land",
      hexes: [{ q: 2, r: 2 }],
      features: { valueStars: 2, harbor: true }
    },
```

- [ ] **Step 10: Build the libs and run the full engine + shared test suites**

Run: `corepack pnpm build:libs && corepack pnpm --filter @sengoku-jidai/engine --filter @sengoku-jidai/shared run test`
Expected: PASS. In particular `test/maps/riversMap.test.ts` (compiled snapshot `riversMap.snapshot.json`) passes **unchanged** — the derived ports equal the previously-authored ports for every Rivers harbor.

- [ ] **Step 11: Typecheck engine, shared, and the server drift guard**

Run: `corepack pnpm --filter @sengoku-jidai/engine --filter @sengoku-jidai/shared --filter @sengoku-jidai/server run typecheck`
Expected: PASS. The server's `_wireMatchesEngine` drift guard still compiles because both the schema and `HexTileSource` dropped `ports` together.

- [ ] **Step 12: Commit**

```bash
git add packages/engine packages/shared
git commit -m "feat(engine): derive harbor ports from hex adjacency, drop authored ports"
```

---

### Task 2: board-render — one pier per sea-facing hex edge

**Files:**
- Modify: `packages/board-render/src/scene.ts` (imports line 1; `SceneTile.ports` type line 28; `buildScene` first-pass comment line 125; second pass lines 174-182)
- Modify: `packages/board-render/src/assemble.ts` (`placePier` lines 56-79; pier loop lines 104-106)
- Test: `packages/board-render/test/scene.test.ts` (existing pier test line 99; add a multi-pier test)
- Snapshot: `packages/board-render/test/__snapshots__/assemble.test.ts.snap` (expected unchanged)

**Interfaces:**
- Consumes: `MapArea.harbor: boolean`, `MapArea.kind`, and `compiled.layout.tiles[id].hexes` from Task 1's compiled map. `axialKey`, `neighbors`, `axialToPixel` from `@sengoku-jidai/engine`.
- Produces: `SceneTile.ports: { to: string; edge: Pixel; dir: Pixel }[]` — one entry per sea-facing hex edge of a harbor tile. `edge` is the edge midpoint; `dir` is the outward unit vector (land→sea). `placePier(edge, dir, hexSize)` renders one stub.

- [ ] **Step 1: Add a failing multi-pier test**

In `packages/board-render/test/scene.test.ts`, replace the existing pier test (lines 99-103):

```ts
  it("emits a pier from harbor D to its port sea tile C", () => {
    const ports = byId("D").ports;
    expect(ports).toHaveLength(1);
    expect(ports[0]!.to).toBe("C");
  });
```

with:

```ts
  it("emits a pier from harbor D to its port sea tile C", () => {
    const ports = byId("D").ports;
    expect(ports).toHaveLength(1);
    expect(ports[0]!.to).toBe("C");
  });

  it("emits one pier per sea-facing hex edge — several to the same sea area", () => {
    // Harbour H is a single hex whose neighbours (1,0) and (1,-1) both belong to one sea
    // tile S, so H gets two piers, both pointing at S from two different edges.
    const size = 114;
    const compiled = {
      layout: {
        size,
        origin: { x: 0, y: 0 },
        tiles: {
          H: { hexes: [{ q: 0, r: 0 }] },
          S: {
            hexes: [
              { q: 1, r: 0 },
              { q: 1, r: -1 }
            ]
          }
        }
      },
      definition: {
        areas: {
          H: { id: "H", kind: "land", hq: null, valueStars: 0, harbor: true, ports: ["S"] },
          S: { id: "S", kind: "sea", hq: null, valueStars: 0, harbor: false, ports: [] }
        },
        bonusSlots: []
      }
    } as unknown as CompiledMap;
    const tile = buildScene(compiled).tiles.find((t) => t.id === "H")!;
    expect(tile.ports).toHaveLength(2);
    expect(tile.ports.every((p) => p.to === "S")).toBe(true);
    // Two distinct edges: their midpoints sit on opposite sides of the harbour hex in y.
    const ys = tile.ports.map((p) => p.edge.y).sort((a, b) => a - b);
    expect(ys[0]!).toBeLessThan(0);
    expect(ys[1]!).toBeGreaterThan(0);
  });
```

- [ ] **Step 2: Run the scene test to verify the new test fails**

Run: `corepack pnpm --filter @sengoku-jidai/board-render exec vitest run test/scene.test.ts -t "one pier per sea-facing"`
Expected: FAIL — `tile.ports[0]` currently has shape `{ to, from, toPoint }` (no `edge`), and the count/`to` assertions do not hold under the centroid-based single-pier logic.

- [ ] **Step 3: Change the `SceneTile.ports` type**

In `packages/board-render/src/scene.ts`, change line 28 from:

```ts
  ports: { to: string; from: Pixel; toPoint: Pixel }[];
```

to:

```ts
  /** One entry per sea-facing hex edge of a harbour tile: `edge` is the edge midpoint,
   *  `dir` the outward (land→sea) unit vector. Several may share `to` when a sea area
   *  touches this tile across multiple edges. */
  ports: { to: string; edge: Pixel; dir: Pixel }[];
```

- [ ] **Step 4: Import the hex helpers**

In `packages/board-render/src/scene.ts`, change line 1 from:

```ts
import { axialToPixel } from "@sengoku-jidai/engine";
```

to:

```ts
import { axialKey, axialToPixel, neighbors } from "@sengoku-jidai/engine";
```

- [ ] **Step 5: Build a hex→owner map and derive per-edge piers**

In `packages/board-render/src/scene.ts`, in `buildScene`, update the first-pass comment on line 125 from:

```ts
  // First pass: geometry + centroids (needed before ports can reference sea centroids).
```

to:

```ts
  // First pass: geometry + centroids.
```

Then replace the entire second pass (lines 174-182):

```ts
  // Second pass: ports (need both endpoints' centroids).
  for (const tile of tiles) {
    const area = compiled.definition.areas[tile.id]!;
    tile.ports = area.ports.map((seaId) => ({
      to: seaId,
      from: centroids.get(tile.id)!,
      toPoint: centroids.get(seaId)!
    }));
  }
```

with:

```ts
  // Second pass: piers — one per hex edge of a harbour tile that faces a sea tile. A sea
  // area touching the same harbour hex across two edges therefore gets two piers.
  const hexOwner = new Map<string, { id: string; kind: "land" | "sea" }>();
  for (const area of Object.values(compiled.definition.areas)) {
    for (const h of compiled.layout.tiles[area.id]!.hexes) {
      hexOwner.set(axialKey(h), { id: area.id, kind: area.kind });
    }
  }
  for (const tile of tiles) {
    const area = compiled.definition.areas[tile.id]!;
    if (!area.harbor) {
      continue;
    }
    const ports: { to: string; edge: Pixel; dir: Pixel }[] = [];
    for (const h of compiled.layout.tiles[tile.id]!.hexes) {
      const from = axialToPixel(h, layout);
      for (const n of neighbors(h)) {
        const owner = hexOwner.get(axialKey(n));
        if (!owner || owner.kind !== "sea") {
          continue;
        }
        const to = axialToPixel(n, layout);
        const dx = to.x - from.x;
        const dy = to.y - from.y;
        const len = Math.hypot(dx, dy) || 1;
        ports.push({
          to: owner.id,
          edge: { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 },
          dir: { x: dx / len, y: dy / len }
        });
      }
    }
    tile.ports = ports;
  }
```

(The `centroids` map is still used by the first pass; leave it. Non-harbor tiles keep the `ports: []` set in the first pass at line 170.)

- [ ] **Step 6: Run the scene test to verify it passes**

Run: `corepack pnpm --filter @sengoku-jidai/board-render exec vitest run test/scene.test.ts`
Expected: PASS — both the single-edge D→C test and the new two-edge H→S test.

- [ ] **Step 7: Update `placePier` to seat on an edge**

In `packages/board-render/src/assemble.ts`, replace `placePier` (lines 56-79):

```ts
/** Place a pier stub on the edge between a harbour tile and one of its sea neighbours,
 *  rotated to point from land into the water. `from` is the tile centroid, `to` the sea's. */
function placePier(from: Pixel, to: Pixel, hexSize: number): string {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const len = Math.hypot(dx, dy) || 1;
  const ux = dx / len;
  const uy = dy / len;
  const s = hexSize / NATIVE_HEX_SIZE;
  // Start the pier at the tile edge (one apothem out) and let it extend into the water, rather
  // than straddling the edge — so shift the stub's centre out by half its (scaled) length.
  const apothem = (hexSize * Math.sqrt(3)) / 2 + (PIER_ART_LENGTH * s) / 2;
  const mx = from.x + ux * apothem;
  const my = from.y + uy * apothem;
  // The art is drawn vertical (90°); rotate so its long axis aligns with the land→sea direction.
  const angle = (Math.atan2(dy, dx) * 180) / Math.PI - 90;
  return el(
    "g",
    {
      transform: `translate(${mx.toFixed(2)} ${my.toFixed(2)}) rotate(${angle.toFixed(2)}) scale(${s})`
    },
    pierArt()
  );
}
```

with:

```ts
/** Place a pier stub on one sea-facing hex edge of a harbour tile. `edge` is the edge
 *  midpoint, `dir` the outward (land→sea) unit vector; the stub starts at the edge and
 *  extends into the water. */
function placePier(edge: Pixel, dir: Pixel, hexSize: number): string {
  const s = hexSize / NATIVE_HEX_SIZE;
  // Shift the origin-centred art out by half its (scaled) length so it starts at the edge
  // and extends into the water rather than straddling the edge.
  const half = (PIER_ART_LENGTH * s) / 2;
  const mx = edge.x + dir.x * half;
  const my = edge.y + dir.y * half;
  // The art is drawn vertical (90°); rotate so its long axis aligns with the outward dir.
  const angle = (Math.atan2(dir.y, dir.x) * 180) / Math.PI - 90;
  return el(
    "g",
    {
      transform: `translate(${mx.toFixed(2)} ${my.toFixed(2)}) rotate(${angle.toFixed(2)}) scale(${s})`
    },
    pierArt()
  );
}
```

- [ ] **Step 8: Update the pier emit loop**

In `packages/board-render/src/assemble.ts`, change the loop (lines 104-106) from:

```ts
  for (const port of tile.ports) {
    out.push(placePier(port.from, port.toPoint, hexSize));
  }
```

to:

```ts
  for (const port of tile.ports) {
    out.push(placePier(port.edge, port.dir, hexSize));
  }
```

- [ ] **Step 9: Rebuild the engine dep and run the full board-render suite**

Run: `corepack pnpm build:libs && corepack pnpm --filter @sengoku-jidai/board-render run test`
Expected: PASS, including `test/assemble.test.ts` whose snapshot is **unchanged** — the fixture harbor D is a single hex bordering C on one edge, for which the edge-midpoint placement is numerically identical to the old centroid+apothem placement.

If (and only if) the assemble snapshot fails: inspect the diff — it must be confined to the `class="pier"` `<g>` element and nothing else. If the diff is a legitimate pier geometry change, regenerate with `corepack pnpm --filter @sengoku-jidai/board-render exec vitest run -u` and note it in the commit; if anything other than piers changed, stop and investigate.

- [ ] **Step 10: Typecheck board-render**

Run: `corepack pnpm --filter @sengoku-jidai/board-render run typecheck`
Expected: PASS.

- [ ] **Step 11: Commit**

```bash
git add packages/board-render
git commit -m "feat(board-render): render harbor piers per sea-facing hex edge"
```

---

### Task 3: web editor — remove the manual port UI

**Files:**
- Modify: `packages/web/src/editor/reducer.ts` (state field, actions, `dropTiles`, `mergeSelection`, `setFeature`, `normalize`, `selectTile`, `setTool`, delete `addPort`/`removePort`)
- Modify: `packages/web/src/components/editor/InspectorPanel.tsx:185-208` (remove Ports block)
- Modify: `packages/web/src/components/editor/EditorCanvas.tsx:192,232-244` (remove `primary` decl + ports overlay)
- Modify: `packages/web/src/styles/app.css` (remove `.editor-ports` / `.editor-port-row` / `.editor-ports-list` rules)
- Test: `packages/web/test/editor/reducer-attrs.test.ts` (rewrite one test, delete two)
- Test: `packages/web/test/editor/reducer-merge.test.ts:59-79` (delete one test)

**Interfaces:**
- Consumes: `HexTileSource` without `ports` (Task 1). `EditorDoc.tiles` are `HexTileSource[]`, so removing the source field automatically removes it from editor docs.
- Produces: `EditorState` without `portArming`; `EditorAction` without `armPort`/`removePort`. No new public surface.

- [ ] **Step 1: Rewrite the port-dependent reducer test**

In `packages/web/test/editor/reducer-attrs.test.ts`, replace the test "keeps features normalized: false/0 disappear, harbor off drops ports" (the whole `it(...)` block) with a version that drops all port steps:

```ts
  it("keeps features normalized: false/0 disappear", () => {
    let state = board();
    state = editorReducer(state, { type: "setFeature", tileId: "t1", patch: { harbor: true } });
    state = editorReducer(state, {
      type: "setFeature",
      tileId: "t1",
      patch: { valueStars: 2, shellable: true }
    });
    state = editorReducer(state, {
      type: "setFeature",
      tileId: "t1",
      patch: { valueStars: 0, shellable: false, harbor: false }
    });
    const t1 = state.doc.tiles.find((t) => t.id === "t1")!;
    expect(t1.features).toEqual({});
  });
```

Then delete the two following tests entirely: "armed port click on a non-sea tile just disarms" and "removePort deletes the key when the list empties".

- [ ] **Step 2: Delete the port-remap merge test**

In `packages/web/test/editor/reducer-merge.test.ts`, delete the test "remaps inbound ports from an absorbed sea tile" (lines 59-79, the whole `it(...)` block).

- [ ] **Step 3: Run the trimmed editor reducer tests to confirm a green baseline**

Run: `corepack pnpm --filter @sengoku-jidai/web exec vitest run test/editor/reducer-attrs.test.ts test/editor/reducer-merge.test.ts`
Expected: PASS. The reducer still has the port code at this point, but the trimmed tests no longer exercise it. (This is a removal/refactor, not feature TDD — the reducer edits in the next steps must keep these tests green.)

- [ ] **Step 4: Remove `portArming` from `EditorState` and the port actions**

In `packages/web/src/editor/reducer.ts`:

Delete the `portArming` field (lines 12-13):

```ts
  /** True while "Add port" waits for a sea-tile click (applies to selection[0]). */
  portArming: boolean;
```

Delete these two action variants from `EditorAction` (lines 38 and 40):

```ts
  | { type: "armPort"; arming: boolean }
```

```ts
  | { type: "removePort"; harborId: string; seaId: string }
```

Remove `portArming: false,` from `initialEditorState` (line 55).

- [ ] **Step 5: Simplify `dropTiles` (no port scrubbing)**

In `packages/web/src/editor/reducer.ts`, replace `dropTiles` (lines 97-120):

```ts
/** Drop tiles and scrub every reference to them (ports, deployment, bonus slots). */
function dropTiles(doc: EditorDoc, ids: string[]): EditorDoc {
  const removed = new Set(ids);
  const tiles = doc.tiles
    .filter((t) => !removed.has(t.id))
    .map((t) => {
      if (!t.ports || !t.ports.some((p) => removed.has(p))) {
        return t;
      }
      const ports = t.ports.filter((p) => !removed.has(p));
      const next: HexTileSource = { ...t };
      if (ports.length > 0) {
        next.ports = ports;
      } else {
        delete next.ports;
      }
      return next;
    });
  const startingDeployment = Object.fromEntries(
    Object.entries(doc.startingDeployment).filter(([id]) => !removed.has(id))
  );
  const bonusSlots = doc.bonusSlots.filter((id) => !removed.has(id));
  return { ...doc, tiles, startingDeployment, bonusSlots };
}
```

with:

```ts
/** Drop tiles and scrub every reference to them (deployment, bonus slots). */
function dropTiles(doc: EditorDoc, ids: string[]): EditorDoc {
  const removed = new Set(ids);
  const tiles = doc.tiles.filter((t) => !removed.has(t.id));
  const startingDeployment = Object.fromEntries(
    Object.entries(doc.startingDeployment).filter(([id]) => !removed.has(id))
  );
  const bonusSlots = doc.bonusSlots.filter((id) => !removed.has(id));
  return { ...doc, tiles, startingDeployment, bonusSlots };
}
```

- [ ] **Step 6: Update the `removeHex` doc comment**

In `packages/web/src/editor/reducer.ts`, change the comment on lines 122-123 from:

```ts
/** Remove one hex from a tile: delete a 1-hex tile, else split the remainder into
 *  connected components — the largest (ties: discovery order) keeps id/features/ports. */
```

to:

```ts
/** Remove one hex from a tile: delete a 1-hex tile, else split the remainder into
 *  connected components — the largest (ties: discovery order) keeps id/features. */
```

- [ ] **Step 7: Simplify `normalize` (no portArming)**

In `packages/web/src/editor/reducer.ts`, replace `normalize` (lines 170-180):

```ts
/** Keep selection/portArming meaningful after any doc change. */
function normalize(state: EditorState): EditorState {
  const ids = new Set(state.doc.tiles.map((t) => t.id));
  const selection = state.selection.filter((id) => ids.has(id));
  const primary = state.doc.tiles.find((t) => t.id === selection[0]);
  const portArming = state.portArming && primary?.features.harbor === true;
  if (selection.length === state.selection.length && portArming === state.portArming) {
    return state;
  }
  return { ...state, selection, portArming };
}
```

with:

```ts
/** Keep the selection meaningful after any doc change. */
function normalize(state: EditorState): EditorState {
  const ids = new Set(state.doc.tiles.map((t) => t.id));
  const selection = state.selection.filter((id) => ids.has(id));
  if (selection.length === state.selection.length) {
    return state;
  }
  return { ...state, selection };
}
```

- [ ] **Step 8: Remove the port remap in `mergeSelection`**

In `packages/web/src/editor/reducer.ts`, replace the `tiles` build in `mergeSelection` (lines 237-245):

```ts
  const tiles = doc.tiles
    .filter((t) => !absorbed.has(t.id))
    .map((t) => {
      const base = t.id === survivorId ? { ...t, hexes: mergedHexes } : t;
      if (!base.ports || !base.ports.some((p) => absorbed.has(p))) {
        return base;
      }
      return { ...base, ports: dedupe(base.ports.map((p) => (absorbed.has(p) ? survivorId! : p))) };
    });
```

with:

```ts
  const tiles = doc.tiles
    .filter((t) => !absorbed.has(t.id))
    .map((t) => (t.id === survivorId ? { ...t, hexes: mergedHexes } : t));
```

(`dedupe` is still used for `bonusSlots` above, so leave the helper.)

- [ ] **Step 9: Remove the port deletion in `setFeature`**

In `packages/web/src/editor/reducer.ts`, replace the end of `setFeature` (lines 288-292):

```ts
    const next: HexTileSource = { ...t, features };
    if (patch.harbor === false) {
      delete next.ports;
    }
    return next;
```

with:

```ts
    return { ...t, features };
```

- [ ] **Step 10: Delete `addPort` and `removePort`**

In `packages/web/src/editor/reducer.ts`, delete both functions in full (lines 297-324): `addPort` and `removePort`.

- [ ] **Step 11: Remove port handling from `setTool` and `selectTile`, and the two action cases**

In `packages/web/src/editor/reducer.ts`:

Change `setTool` (line 375) from:

```ts
    case "setTool":
      return { ...state, tool: action.tool, portArming: false };
```

to:

```ts
    case "setTool":
      return { ...state, tool: action.tool };
```

Replace the `selectTile` case (lines 382-403) with:

```ts
    case "selectTile": {
      if (action.tileId === null) {
        return { ...state, selection: [] };
      }
      const selection = action.additive
        ? state.selection.includes(action.tileId)
          ? state.selection.filter((id) => id !== action.tileId)
          : [...state.selection, action.tileId]
        : [action.tileId];
      // Bump the epoch on every tap so the mobile sheet re-opens even when the selection is
      // unchanged (re-tapping the already-selected tile).
      return normalize({ ...state, selection, selectEpoch: state.selectEpoch + 1 });
    }
```

Delete the `armPort` case (lines 433-434):

```ts
    case "armPort":
      return { ...state, portArming: action.arming };
```

Delete the `removePort` case (lines 437-438):

```ts
    case "removePort":
      return withDoc(state, removePort(state.doc, action.harborId, action.seaId));
```

- [ ] **Step 12: Remove the Ports block from the inspector**

In `packages/web/src/components/editor/InspectorPanel.tsx`, delete the entire harbor-ports block (lines 185-208):

```tsx
      {primary.features.harbor ? (
        <div className="editor-ports-list">
          <h3>Ports</h3>
          {(primary.ports ?? []).map((seaId) => (
            <div key={seaId} className="editor-port-row">
              <span>{seaId}</span>
              <button
                type="button"
                onClick={() => dispatch({ type: "removePort", harborId: tileId, seaId })}
              >
                Remove
              </button>
            </div>
          ))}
          <button
            type="button"
            aria-pressed={state.portArming}
            onClick={() => dispatch({ type: "armPort", arming: !state.portArming })}
          >
            Add port
          </button>
          {state.portArming ? <p className="muted">Click a sea tile on the map…</p> : null}
        </div>
      ) : null}
```

(The `Harbor` checkbox immediately above it, lines 174-183, stays.)

- [ ] **Step 13: Remove the ports overlay from the editor canvas**

In `packages/web/src/components/editor/EditorCanvas.tsx`, delete the ports overlay (lines 232-244):

```tsx
      {primary?.features.harbor && primary.ports ? (
        <g className="editor-ports">
          {primary.ports.map((seaId) => {
            const sea = doc.tiles.find((t) => t.id === seaId);
            if (!sea) {
              return null;
            }
            const from = tileCentroid(primary.hexes, doc.layout);
            const to = tileCentroid(sea.hexes, doc.layout);
            return <line key={seaId} x1={from.x} y1={from.y} x2={to.x} y2={to.y} />;
          })}
        </g>
      ) : null}
```

Then delete the now-unused `primary` declaration (line 192):

```tsx
  const primary = doc.tiles.find((t) => t.id === selection[0]);
```

(`tileCentroid` is still used by `TileBadge` at line 256 — keep its import.)

- [ ] **Step 14: Remove dead port CSS**

In `packages/web/src/styles/app.css`, remove the now-unused rules: the `.editor-canvas .editor-ports line` block (around line 1504) and the `.editor-port-row` block (around line 1563), plus any `.editor-ports-list` rule if present. Grep first to confirm the exact spans:

Run: `grep -n "editor-ports\|editor-port-row" packages/web/src/styles/app.css`
Then delete each matched rule and its `{ … }` body.

- [ ] **Step 15: Rebuild libs and run the web unit tests**

Run: `corepack pnpm build:libs && corepack pnpm --filter @sengoku-jidai/web run test`
Expected: PASS — reducer, merge, and other editor tests green with no references to `ports`/`portArming`.

- [ ] **Step 16: Typecheck the web package**

Run: `corepack pnpm --filter @sengoku-jidai/web run typecheck`
Expected: PASS — no unused `primary`, no missing `armPort`/`removePort`/`portArming` symbols.

- [ ] **Step 17: Commit**

```bash
git add packages/web
git commit -m "feat(web): remove manual harbor port editor UI (piers now derived)"
```

---

### Task 4: Full gate

**Files:** none (verification only).

- [ ] **Step 1: Run the whole build + test gate**

Run: `corepack pnpm build && corepack pnpm test`
Expected: PASS across all packages.

- [ ] **Step 2: Lint and format check**

Run: `corepack pnpm lint && corepack pnpm exec prettier --check .`
Expected: PASS. If prettier reports files, run `corepack pnpm format` and re-commit.

- [ ] **Step 3: Confirm the Rivers no-diff claim**

Verify `git status` shows no change to `packages/engine/test/maps/riversMap.snapshot.json` and no change to `packages/board-render/test/__snapshots__/assemble.test.ts.snap`. Both must be untouched (this is the "derive & accept, report diff" result: zero gameplay diff, zero Rivers render diff). If either changed, stop and reconcile against the Global Constraints before proceeding.

- [ ] **Step 4: Commit any formatting-only changes**

```bash
git add -A
git commit -m "chore: formatting after pier derivation change"
```

(Skip if nothing changed.)

## Notes for the implementer

- **Rivers diff report (per the design's "derive & accept, report diff" decision):** none. Every Rivers harbor's derived sea set equals its old authored `ports`, so launch/build waters and the compiled snapshot are identical.
- **Where the new behaviour shows:** only on maps with multi-hex harbors, or sea areas that wrap a single harbor hex across two or more edges. Neither exists in Rivers or the fixture, hence the dedicated synthetic test in Task 2.
- **Editor derived-pier preview is intentionally out of scope** (design decision). The editor keeps the ⚓ harbor badge; it no longer draws pier lines.
