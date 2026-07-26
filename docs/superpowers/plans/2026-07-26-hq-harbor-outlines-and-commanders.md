# HQ / harbor tile outlines + commanders-per-round — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Render HQ and harbor tile markers as strokes of each tile's real (fused) outline instead of a fixed hexagon at the centroid, and make the per-round commander count an editable per-map setting surfaced as pips in the HUD.

**Architecture:** Tasks 1–2 are rendering-only changes in `board-render` (the marker becomes a stroke of `tile.rings`). Task 3 threads a new optional `commandersPerRound` field from the map source through `compileHexMap` onto `MapDefinition`, where `createInitialState` reads it. Task 4 exposes per-seat commander counts on `PlayerGameView`. Tasks 5–6 add the editor input and the HUD pips.

**Tech Stack:** TypeScript, pnpm workspaces, vitest, React (web), SVG string assembly (board-render), zod (shared schemas).

## Global Constraints

- **Dist-consumption trap:** `board-render` and `web` import the *built* `@sengoku-jidai/engine` (and `/client`). After changing `engine` or `shared`, run `corepack pnpm build:libs` before running dependent package tests.
- **Schema drift guard:** `HexMapSource` (`packages/engine/src/maps/hex/source.ts`) and `hexMapSourceSchema` (`packages/shared/src/schemas.ts`) must stay structurally identical — change both together (compile-time guard in `packages/server/src/maps/library.ts:15`).
- **Seat colors (verbatim):** HQ strokes `red = #e02d2d`, `black = #000000`. Solid tile fills / pips `red = #c0392b`, `black = #2f343c`.
- **Native art scale:** `NATIVE_HEX_SIZE = 114`; world stroke width = native width × `s` where `s = hexSize / NATIVE_HEX_SIZE` (Rivers/editor use size 114, so `s = 1`).
- **Commanders-per-round range:** integer 1–8, default 5 (falls back to `riversRuleset.commandersPerPlayer`).
- **Snapshot updates:** eyeball the vitest diff before running with `-u`.
- **No tile ids in UI** (existing project rule) — nothing in this plan surfaces raw tile ids.
- **Gate:** `corepack pnpm test` (builds libs then runs all package tests), `corepack pnpm typecheck`, `corepack pnpm lint`, `corepack pnpm format`.

---

### Task 1: Polygon offset helper (board-render)

A pure helper that offsets each ring of a fused tile outline outward by a fixed world distance. Task 2 uses it to draw the harbor's dashed line hugging just outside the solid outline.

**Files:**
- Modify: `packages/board-render/src/outline.ts` (append `offsetRingsOutward`)
- Test: `packages/board-render/test/offset.test.ts` (create)

**Interfaces:**
- Produces: `export function offsetRingsOutward(rings: Pixel[][], distance: number): Pixel[][]` — each ring's edges shifted outward (away from that ring's own centroid) by `distance` and re-intersected at the corners. `Pixel` is `{ x: number; y: number }` (from `@sengoku-jidai/engine`, already imported in `outline.ts`).

- [ ] **Step 1: Write the failing test**

Create `packages/board-render/test/offset.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { offsetRingsOutward } from "../src/outline.js";

describe("offsetRingsOutward", () => {
  it("expands a CCW square outward by the given distance", () => {
    // Axis-aligned 10×10 square centred at (5,5).
    const square = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
      { x: 0, y: 10 }
    ];
    const [out] = offsetRingsOutward([square], 1);
    // Each corner moves diagonally outward by 1 along both axes.
    expect(out!.map((p) => ({ x: Math.round(p.x), y: Math.round(p.y) }))).toEqual([
      { x: -1, y: -1 },
      { x: 11, y: -1 },
      { x: 11, y: 11 },
      { x: -1, y: 11 }
    ]);
  });

  it("leaves every offset vertex farther from the centroid than its original", () => {
    const hexish = [
      { x: 10, y: 0 },
      { x: 5, y: 8 },
      { x: -5, y: 8 },
      { x: -10, y: 0 },
      { x: -5, y: -8 },
      { x: 5, y: -8 }
    ];
    const [out] = offsetRingsOutward([hexish], 2);
    const d2 = (p: { x: number; y: number }) => p.x * p.x + p.y * p.y; // centroid ≈ (0,0)
    out!.forEach((p, i) => expect(d2(p)).toBeGreaterThan(d2(hexish[i]!)));
  });

  it("returns degenerate rings (<3 points) unchanged in value", () => {
    const line = [
      { x: 0, y: 0 },
      { x: 1, y: 1 }
    ];
    expect(offsetRingsOutward([line], 5)).toEqual([line]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `corepack pnpm --filter @sengoku-jidai/board-render exec vitest run test/offset.test.ts`
Expected: FAIL — `offsetRingsOutward is not a function` / not exported.

- [ ] **Step 3: Write minimal implementation**

Append to `packages/board-render/src/outline.ts` (file already imports `type ... Pixel` on line 2):

```ts
/** Offset each ring of a fused tile outline outward (away from that ring's own centroid)
 *  by `distance` world units. Edges are shifted along their outward normal and re-intersected
 *  at the corners. Used to draw a parallel line hugging a tile edge (the harbor dash). Rings
 *  with fewer than 3 points are returned unchanged. Concave corners at a small `distance`
 *  behave well; this is not a general-purpose robust polygon offset. */
export function offsetRingsOutward(rings: Pixel[][], distance: number): Pixel[][] {
  return rings.map((ring) => offsetRing(ring, distance));
}

function offsetRing(ring: Pixel[], d: number): Pixel[] {
  const n = ring.length;
  if (n < 3) return ring;
  let cx = 0;
  let cy = 0;
  for (const p of ring) {
    cx += p.x;
    cy += p.y;
  }
  cx /= n;
  cy /= n;
  // Each edge shifted outward along its normal, kept as an anchor point + direction vector.
  const lines = ring.map((a, i) => {
    const b = ring[(i + 1) % n]!;
    let nx = -(b.y - a.y);
    let ny = b.x - a.x;
    const len = Math.hypot(nx, ny) || 1;
    nx /= len;
    ny /= len;
    const mx = (a.x + b.x) / 2;
    const my = (a.y + b.y) / 2;
    const away = (mx + nx - cx) ** 2 + (my + ny - cy) ** 2 > (mx - cx) ** 2 + (my - cy) ** 2;
    const sign = away ? 1 : -1;
    return { px: a.x + nx * d * sign, py: a.y + ny * d * sign, dx: b.x - a.x, dy: b.y - a.y };
  });
  const out: Pixel[] = [];
  for (let i = 0; i < n; i++) {
    const l1 = lines[(i - 1 + n) % n]!;
    const l2 = lines[i]!;
    const den = l1.dx * l2.dy - l1.dy * l2.dx;
    if (Math.abs(den) < 1e-9) {
      out.push({ x: l2.px, y: l2.py });
      continue;
    }
    const t = ((l2.px - l1.px) * l2.dy - (l2.py - l1.py) * l2.dx) / den;
    out.push({ x: l1.px + l1.dx * t, y: l1.py + l1.dy * t });
  }
  return out;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `corepack pnpm --filter @sengoku-jidai/board-render exec vitest run test/offset.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/board-render/src/outline.ts packages/board-render/test/offset.test.ts
git commit -m "feat(board-render): polygon offset helper for tile-outline markers"
```

---

### Task 2: HQ + harbor markers as tile outlines (board-render)

Replace the centered hexagon/concentric-hex glyphs with strokes of the tile's real fused outline: HQ = one bold seat-colored solid stroke; harbor = a thin solid stroke plus a thick dashed stroke offset just outside it. Piers are untouched.

**Files:**
- Modify: `packages/board-render/src/assemble.ts` (imports + `featureGlyphs`)
- Modify: `packages/board-render/src/assets.ts` (remove `hqBaseArt`, `harborArt`, `HQ_ART_CENTER`, `HARBOR_ART_CENTER`)
- Test: `packages/board-render/test/assemble.test.ts` (update marker assertions + add multi-hex proof)
- Snapshot: `packages/board-render/test/__snapshots__/assemble.test.ts.snap` (regenerate)

**Interfaces:**
- Consumes: `offsetRingsOutward` (Task 1); `ringPath(rings)` (already private in `assemble.ts:24`); `tile.rings: Pixel[][]`, `tile.features` (from `SceneTile`).
- Produces (marker markup contract used by tests): a `<path class="hq-outline" ...>`, a `<path class="harbor-outline" ...>`, and a `<path class="harbor-outline-dash" ...>`. The old `class="hq-base"` and `class="harbor"` markup no longer appears.

- [ ] **Step 1: Update the failing tests**

In `packages/board-render/test/assemble.test.ts`, replace the existing `it("places HQ / star / harbor markers ...")` block (lines ~29–36) with:

```ts
  it("traces HQ + harbor markers as outlines of the tile shape", () => {
    expect(svg).toContain(`class="hq-outline"`); // tiles A (red) + E (black)
    expect(svg).toContain(`class="harbor-outline"`); // tile D solid outline
    expect(svg).toContain(`class="harbor-outline-dash"`); // tile D dashed hug
    expect(svg).toContain(`class="star"`); // tiles B, C (native star badges)
    expect(svg).toContain(`fill:#ce3485`); // the pink star fill from board.svg
    // The old centered-glyph markers are gone.
    expect(svg).not.toContain(`class="hq-base"`);
    expect(svg).not.toContain(`class="harbor"`);
  });

  it("draws feature outlines that trace an arbitrary (multi-hex) tile shape", () => {
    // An 8-vertex ring proves the marker follows tile.rings, not a fixed 6-vertex hexagon.
    const octagon = [
      { x: -20, y: -10 },
      { x: 0, y: -20 },
      { x: 20, y: -10 },
      { x: 20, y: 10 },
      { x: 0, y: 20 },
      { x: -20, y: 10 },
      { x: -20, y: 0 },
      { x: -20, y: -5 }
    ];
    const tile = {
      id: "HQ",
      kind: "land" as const,
      rings: [octagon],
      centroid: { x: 0, y: 0 },
      authoredFill: "#d5d3c4",
      features: { hq: "red" as const, valueStars: 0 as const, harbor: false },
      glyphAnchors: {},
      slots: {},
      ports: []
    };
    const scene = {
      viewBox: { x: -50, y: -50, width: 100, height: 100 },
      tiles: [tile],
      hexGrid: [],
      hexSize: 114
    };
    const out = assembleBoardSvg(scene);
    const d = /<path d="([^"]+)" class="hq-outline"/.exec(out)?.[1] ?? "";
    const vertexCount = (d.match(/[ML]/g) ?? []).length;
    expect(vertexCount).toBe(octagon.length); // 8, not 6 — it traces the real shape
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `corepack pnpm --filter @sengoku-jidai/board-render exec vitest run test/assemble.test.ts`
Expected: FAIL — `class="hq-outline"` / `class="harbor-outline"` not found (markers still use old classes).

- [ ] **Step 3: Implement the outline rendering**

In `packages/board-render/src/assemble.ts`:

(a) Update the imports (lines 1–14). Remove `harborArt` and `hqBaseArt` from the `./assets.js` import, and add an `offsetRingsOutward` import from `./outline.js`:

```ts
import {
  ASSETS,
  NATIVE_HEX_SIZE,
  PIER_ART_LENGTH,
  pierArt,
  star1Art,
  star2Art,
  type OrderKind
} from "./assets.js";
import type { BoardScene, SceneTile } from "./scene.js";
import type { Pixel } from "@sengoku-jidai/engine";
import { offsetRingsOutward } from "./outline.js";
import { el } from "./svg.js";
```

(b) Add these constants just after `BONUS_BADGE_FRACTION` (~line 22):

```ts
// Feature-outline stroke widths, in native (board.svg) units — scaled by hexSize/NATIVE_HEX_SIZE
// at draw time. HQ mirrors board.svg path9-5-0-3 (width 8); harbor mirrors g46 (solid 5 outer +
// dashed 8.09 inner). The dash rides ~0.72× its own width outside the solid line, hugging it.
const HQ_STROKE_W = 8;
const HARBOR_SOLID_W = 5;
const HARBOR_DASH_W = 8.09188;
const HARBOR_DASH_ARRAY = [4.04592, 1.61836];
const HARBOR_DASH_OFFSET = HARBOR_DASH_W * 0.72;
```

(c) Replace the two feature branches inside `featureGlyphs` (the `if (tile.features.hq)` and `if (tile.features.harbor)` blocks, lines ~79–86) with:

```ts
  const s = hexSize / NATIVE_HEX_SIZE;
  // HQ + harbour markers are strokes of the tile's real fused outline (tile.rings) so they fit
  // single- and multi-hex tiles alike. Drawn in the non-interactive #features group.
  if (tile.features.hq) {
    const stroke = tile.features.hq === "red" ? "#e02d2d" : "#000000";
    out.push(
      el("path", {
        d: ringPath(tile.rings),
        class: "hq-outline",
        style: `fill:none;stroke:${stroke};stroke-width:${(HQ_STROKE_W * s).toFixed(2)};stroke-linejoin:round`
      })
    );
  }
  if (tile.features.harbor) {
    const dashRings = offsetRingsOutward(tile.rings, HARBOR_DASH_OFFSET * s);
    const dashArray = HARBOR_DASH_ARRAY.map((v) => (v * s).toFixed(3)).join(",");
    out.push(
      el("path", {
        d: ringPath(tile.rings),
        class: "harbor-outline",
        style: `fill:none;stroke:#000000;stroke-width:${(HARBOR_SOLID_W * s).toFixed(2)};stroke-linejoin:round`
      }),
      el("path", {
        d: ringPath(dashRings),
        class: "harbor-outline-dash",
        style: `fill:none;stroke:#000000;stroke-width:${(HARBOR_DASH_W * s).toFixed(2)};stroke-linejoin:round;stroke-dasharray:${dashArray}`
      })
    );
  }
```

Leave the existing `star`, `bonusGlyph`, and pier (`for (const port of tile.ports)`) branches unchanged. The stale comment on lines ~79–80 referring to "the artist's tile-sized hex outlines" is replaced by the new comment above.

(d) In `packages/board-render/src/assets.ts`, delete the now-unused native-art definitions:
- `HQ_ART_CENTER` (lines ~377–380)
- `HARBOR_ART_CENTER` (line ~381)
- `hqBaseArt` function (lines ~387–398)
- `harborArt` function (lines ~400–416)

Keep everything else — the 40-unit icon `<symbol>`s `HQ_BLACK`/`HQ_RED`/`HARBOR`, `hqGlyph`, and the `HQ_*_D` / `HARBOR_*_D` path-data constants (still referenced by those symbols) stay. Do not touch `pierArt` / `PIER_ART_CENTER` / `PIER_ART_LENGTH`.

- [ ] **Step 4: Rebuild board-render deps are unaffected; run the tests**

Run: `corepack pnpm --filter @sengoku-jidai/board-render exec vitest run test/assemble.test.ts test/assets.test.ts`
Expected: the two updated/added tests PASS; `assets.test.ts` still PASS (icon library untouched). The `matches the committed snapshot` test FAILS (markup changed) — expected, fixed next.

- [ ] **Step 5: Review and update the snapshot**

Run: `corepack pnpm --filter @sengoku-jidai/board-render exec vitest run test/assemble.test.ts`
Read the snapshot diff: confirm the HQ/harbor markup changed from `<g transform=... class="hq-base">`/`class="harbor"` to `<path ... class="hq-outline">` and the two `harbor-outline` paths, and that piers/stars/bonus/order-slots are unchanged. Then:

Run: `corepack pnpm --filter @sengoku-jidai/board-render exec vitest run -u`
Expected: all board-render tests PASS; `__snapshots__/assemble.test.ts.snap` updated.

- [ ] **Step 6: Typecheck the package (catches dead imports)**

Run: `corepack pnpm --filter @sengoku-jidai/board-render run build`
Expected: no errors (confirms `hqBaseArt`/`harborArt` have no remaining references and the new imports resolve).

- [ ] **Step 7: Commit**

```bash
git add packages/board-render/src/assemble.ts packages/board-render/src/assets.ts \
  packages/board-render/test/assemble.test.ts \
  packages/board-render/test/__snapshots__/assemble.test.ts.snap
git commit -m "feat(board-render): render HQ/harbor markers as tile outlines"
```

---

### Task 3: Per-map commanders-per-round setting (engine + shared)

Add an optional `commandersPerRound` field to the map source, carry it through compilation onto `MapDefinition`, and have `createInitialState` use it (falling back to the ruleset default). Mirror the field in the wire schema.

**Files:**
- Modify: `packages/engine/src/maps/hex/source.ts` (`HexMapSource`)
- Modify: `packages/engine/src/maps/riversMap.ts` (`MapDefinition`)
- Modify: `packages/engine/src/maps/hex/compile.ts` (`compileHexMap`)
- Modify: `packages/engine/src/game.ts` (`createInitialState`)
- Modify: `packages/shared/src/schemas.ts` (`hexMapSourceSchema`)
- Test: `packages/engine/test/commandersPerRound.test.ts` (create)

**Interfaces:**
- Produces: `HexMapSource.commandersPerRound?: number`; `MapDefinition.commandersPerRound?: number`; `createInitialState` sets each player's `commanders.total = map.commandersPerRound ?? rules.commandersPerPlayer`.

- [ ] **Step 1: Write the failing test**

Create `packages/engine/test/commandersPerRound.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { compileHexMap } from "../src/maps/hex/compile.js";
import { FIXTURE_HEX_MAP } from "../src/maps/hex/fixtures.js";
import { registerMap } from "../src/maps/registry.js";
import { createInitialState } from "../src/game.js";
import { riversMapId } from "../src/maps/riversMap.js";

describe("commandersPerRound", () => {
  it("compiles the source field onto the map definition", () => {
    const compiled = compileHexMap({ ...FIXTURE_HEX_MAP, commandersPerRound: 3 });
    expect(compiled.definition.commandersPerRound).toBe(3);
  });

  it("leaves the definition field undefined when the source omits it", () => {
    const compiled = compileHexMap(FIXTURE_HEX_MAP);
    expect(compiled.definition.commandersPerRound).toBeUndefined();
  });

  it("createInitialState seats each player with the map's per-round count", () => {
    registerMap(
      compileHexMap({ ...FIXTURE_HEX_MAP, id: "cpr-fixture", commandersPerRound: 3 }).definition
    );
    const state = createInitialState({ gameId: "g1", seed: "s1", mapId: "cpr-fixture" });
    expect(state.players.red.commanders.total).toBe(3);
    expect(state.players.black.commanders.total).toBe(3);
  });

  it("falls back to the ruleset default (5) for maps without the field", () => {
    const state = createInitialState({ gameId: "g2", seed: "s2", mapId: riversMapId });
    expect(state.players.red.commanders.total).toBe(5);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `corepack pnpm --filter @sengoku-jidai/engine exec vitest run test/commandersPerRound.test.ts`
Expected: FAIL — `commandersPerRound` not accepted on the source type / `undefined` on definition.

- [ ] **Step 3: Add the source field**

In `packages/engine/src/maps/hex/source.ts`, add to `HexMapSource` (after `bonusSlots`, line ~36):

```ts
  /** Commanders each player deploys per round. Overrides the ruleset default (5) when set. */
  commandersPerRound?: number;
```

- [ ] **Step 4: Add the definition field**

In `packages/engine/src/maps/riversMap.ts`, add to `MapDefinition` (after `startingDeployment`, line ~70):

```ts
  /** Commanders each player deploys per round; overrides the ruleset default when set. */
  commandersPerRound?: number;
```

- [ ] **Step 5: Carry the field through compile**

In `packages/engine/src/maps/hex/compile.ts`, extend the `definition` object literal (lines ~43–49):

```ts
  const definition: MapDefinition = {
    id: source.id,
    name: source.name,
    areas,
    bonusSlots: [...source.bonusSlots],
    startingDeployment: { ...source.startingDeployment },
    commandersPerRound: source.commandersPerRound
  };
```

- [ ] **Step 6: Use it in createInitialState**

In `packages/engine/src/game.ts`, just after `const map = getMap(mapId);` (line ~60) add:

```ts
  const commandersPerRound = map.commandersPerRound ?? rules.commandersPerPlayer;
```

Then change the `commanders` line inside `makePlayer` (line ~132) from `total: rules.commandersPerPlayer` to:

```ts
      commanders: { total: commandersPerRound, standby: 0, counterattacks: 0 },
```

- [ ] **Step 7: Mirror the field in the wire schema**

In `packages/shared/src/schemas.ts`, add to `hexMapSourceSchema` (after `bonusSlots`, line ~135):

```ts
  bonusSlots: z.array(z.string().min(1)),
  commandersPerRound: z.number().int().min(1).max(8).optional()
```

- [ ] **Step 8: Run the test + drift guard**

Run: `corepack pnpm --filter @sengoku-jidai/engine exec vitest run test/commandersPerRound.test.ts`
Expected: PASS (4 tests).

Run: `corepack pnpm build:libs`
Expected: engine + shared + board-render + terrain build with no errors (this recompiles the server's drift guard against the updated schema/interface indirectly via the shared build; a full server typecheck happens in the final gate).

- [ ] **Step 9: Commit**

```bash
git add packages/engine/src/maps/hex/source.ts packages/engine/src/maps/riversMap.ts \
  packages/engine/src/maps/hex/compile.ts packages/engine/src/game.ts \
  packages/shared/src/schemas.ts packages/engine/test/commandersPerRound.test.ts
git commit -m "feat(engine): per-map commandersPerRound setting"
```

---

### Task 4: Expose per-seat commander counts on the player view (engine)

Add `commandersRemaining` and `commandersTotal` to `PlayerGameView` so the HUD can render pips. `available()` is already imported in `view.ts`.

**Files:**
- Modify: `packages/engine/src/view.ts` (`PlayerGameView` + `playerView`)
- Test: `packages/engine/test/view.test.ts` (extend if it exists, else create)

**Interfaces:**
- Produces: `PlayerGameView.commandersRemaining: Record<SeatId, number>` (= `available(state, seat)` per seat) and `PlayerGameView.commandersTotal: Record<SeatId, number>` (= `state.players[seat].commanders.total`).

- [ ] **Step 1: Write the failing test**

Create `packages/engine/test/view.test.ts` (if a `view.test.ts` already exists, append the `describe` block instead):

```ts
import { describe, it, expect } from "vitest";
import { createInitialState } from "../src/game.js";
import { playerView } from "../src/view.js";
import { available } from "../src/legality.js";

describe("playerView commander counts", () => {
  it("exposes per-seat remaining and total commanders", () => {
    const state = createInitialState({ gameId: "g", seed: "s" });
    const view = playerView(state, "red");
    expect(view.commandersTotal.red).toBe(state.players.red.commanders.total);
    expect(view.commandersTotal.black).toBe(state.players.black.commanders.total);
    expect(view.commandersRemaining.red).toBe(available(state, "red"));
    expect(view.commandersRemaining.black).toBe(available(state, "black"));
    // At game start nothing is placed, so remaining equals total.
    expect(view.commandersRemaining.red).toBe(view.commandersTotal.red);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `corepack pnpm --filter @sengoku-jidai/engine exec vitest run test/view.test.ts`
Expected: FAIL — `commandersTotal` / `commandersRemaining` do not exist on the view.

- [ ] **Step 3: Add the fields to the interface**

In `packages/engine/src/view.ts`, add to `PlayerGameView` (after `victoryPoints`, line ~169):

```ts
  victoryPoints: Record<SeatId, number>;
  /** Commanders each seat can still deploy this round (from `available`). */
  commandersRemaining: Record<SeatId, number>;
  /** Total commanders each seat deploys per round (pip count). */
  commandersTotal: Record<SeatId, number>;
```

- [ ] **Step 4: Populate them in playerView**

In `packages/engine/src/view.ts`, in the returned object (after the `victoryPoints: { ... }` block, line ~230):

```ts
    victoryPoints: {
      red: victoryPoints(map, board, "red"),
      black: victoryPoints(map, board, "black")
    },
    commandersRemaining: {
      red: available(state, "red"),
      black: available(state, "black")
    },
    commandersTotal: {
      red: state.players.red.commanders.total,
      black: state.players.black.commanders.total
    },
```

- [ ] **Step 5: Run the test**

Run: `corepack pnpm --filter @sengoku-jidai/engine exec vitest run test/view.test.ts`
Expected: PASS.

- [ ] **Step 6: Run the full engine suite (view shape is widely referenced)**

Run: `corepack pnpm --filter @sengoku-jidai/engine test`
Expected: PASS. If any exact-shape view assertion elsewhere fails, add the two new fields to that expectation (additive).

- [ ] **Step 7: Rebuild libs (web consumes the built view type next)**

Run: `corepack pnpm build:libs`
Expected: no errors.

- [ ] **Step 8: Commit**

```bash
git add packages/engine/src/view.ts packages/engine/test/view.test.ts
git commit -m "feat(engine): expose per-seat commander counts on player view"
```

---

### Task 5: Commanders-per-round input in the map editor (web)

Add the field to the editor document, a clamped reducer action, and a number input in the map-level summary panel.

**Files:**
- Modify: `packages/web/src/editor/doc.ts` (`EditorDoc`, `emptyDoc`, `docFromSource`, `docToSource`)
- Modify: `packages/web/src/editor/reducer.ts` (`EditorAction` + case)
- Modify: `packages/web/src/components/editor/InspectorPanel.tsx` (`SummaryBody`)
- Test: `packages/web/test/editor/reducer-commanders.test.ts` (create)
- Test: `packages/web/test/editor/doc.test.ts` (extend round-trip)

**Interfaces:**
- Consumes: `HexMapSource.commandersPerRound` (Task 3).
- Produces: `EditorDoc.commandersPerRound?: number`; action `{ type: "setCommandersPerRound"; value: number }` (clamps to integer 1–8); `docToSource` emits the field only when set.

- [ ] **Step 1: Write the failing reducer test**

Create `packages/web/test/editor/reducer-commanders.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { editorReducer, initialEditorState } from "../../src/editor/reducer.js";
import { emptyDoc, docToSource } from "../../src/editor/doc.js";

const start = () => initialEditorState(emptyDoc());

describe("setCommandersPerRound", () => {
  it("sets an in-range value on the doc", () => {
    const s = editorReducer(start(), { type: "setCommandersPerRound", value: 6 });
    expect(s.doc.commandersPerRound).toBe(6);
  });

  it("clamps to 1..8 and floors to an integer", () => {
    expect(editorReducer(start(), { type: "setCommandersPerRound", value: 0 }).doc.commandersPerRound).toBe(1);
    expect(editorReducer(start(), { type: "setCommandersPerRound", value: 99 }).doc.commandersPerRound).toBe(8);
    expect(editorReducer(start(), { type: "setCommandersPerRound", value: 4.7 }).doc.commandersPerRound).toBe(4);
  });

  it("round-trips through docToSource", () => {
    const s = editorReducer(start(), { type: "setCommandersPerRound", value: 5 });
    expect(docToSource(s.doc).commandersPerRound).toBe(5);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `corepack pnpm --filter @sengoku-jidai/web exec vitest run test/editor/reducer-commanders.test.ts`
Expected: FAIL — action type unknown / field missing.

- [ ] **Step 3: Add the field to the editor document**

In `packages/web/src/editor/doc.ts`:

(a) Add to `EditorDoc` (after `bonusSlots`, line ~18):

```ts
  bonusSlots: string[];
  /** Commanders each player deploys per round; undefined means "use the ruleset default (5)". */
  commandersPerRound?: number;
```

(b) `emptyDoc` needs no change (the field is optional and defaults to undefined).

(c) In `docFromSource`, add to the returned object (after `bonusSlots`, line ~49):

```ts
    bonusSlots: [...source.bonusSlots],
    commandersPerRound: source.commandersPerRound,
```

(d) In `docToSource`, add to the returned object (after `bonusSlots`, line ~61):

```ts
    bonusSlots: doc.bonusSlots,
    commandersPerRound: doc.commandersPerRound
```

- [ ] **Step 4: Add the reducer action + case**

In `packages/web/src/editor/reducer.ts`:

(a) Add to the `EditorAction` union (after `setName`, line ~39):

```ts
  | { type: "setName"; name: string }
  | { type: "setCommandersPerRound"; value: number }
```

(b) Add a case just before `case "setName":` (line ~376):

```ts
    case "setCommandersPerRound": {
      const value = Math.max(1, Math.min(8, Math.floor(action.value)));
      return withDoc(state, { ...state.doc, commandersPerRound: value });
    }
```

- [ ] **Step 5: Add the input to SummaryBody**

In `packages/web/src/components/editor/InspectorPanel.tsx`:

(a) Change the `SummaryBody` call site (line ~59) to pass `dispatch`:

```tsx
          <SummaryBody state={state} dispatch={dispatch} />
```

(b) Replace the `SummaryBody` signature and body (lines ~89–105) with:

```tsx
function SummaryBody({
  state,
  dispatch
}: {
  state: EditorState;
  dispatch: Dispatch<EditorAction>;
}): ReactNode {
  const { doc } = state;
  const hqSeats = doc.tiles.filter((t) => t.features.hq).map((t) => t.features.hq);
  return (
    <>
      <ul className="editor-tally">
        <li>{doc.tiles.length} tiles</li>
        <li>Red HQ: {hqSeats.includes("red") ? "placed" : "missing"}</li>
        <li>Black HQ: {hqSeats.includes("black") ? "placed" : "missing"}</li>
        <li>
          Bonus slots: {doc.bonusSlots.length} of {riversRuleset.bonusSet.length}
        </li>
      </ul>
      <label className="editor-field">
        <span>Commanders per round</span>
        <input
          type="number"
          min={1}
          max={8}
          step={1}
          value={doc.commandersPerRound ?? riversRuleset.commandersPerPlayer}
          onChange={(e) =>
            dispatch({ type: "setCommandersPerRound", value: e.target.valueAsNumber })
          }
        />
      </label>
      <p className="muted">Tap a tile to edit it; use Multi to select several.</p>
    </>
  );
}
```

Note: `riversRuleset` is already imported at the top of the file (line 3); `Dispatch`, `EditorAction`, `EditorState`, `ReactNode` are already imported.

- [ ] **Step 6: Extend the doc round-trip test**

In `packages/web/test/editor/doc.test.ts`, add a new `describe` block. The file already imports `riversSource` from `@sengoku-jidai/engine/client` and `docFromSource, docToSource` from `../../src/editor/doc.js` — reuse those imports (web must import the engine only via `/client`; the eslint rule forbids `@sengoku-jidai/engine`):

```ts
describe("commandersPerRound round-trip", () => {
  it("preserves the field through source→doc→source", () => {
    const source = { ...riversSource, commandersPerRound: 6 };
    const doc = docFromSource(source, { asCopy: false });
    expect(doc.commandersPerRound).toBe(6);
    expect(docToSource(doc).commandersPerRound).toBe(6);
  });

  it("leaves it undefined when the source omits it", () => {
    const doc = docFromSource(riversSource, { asCopy: false });
    expect(doc.commandersPerRound).toBeUndefined();
  });
});
```

- [ ] **Step 7: Run the web editor tests**

Run: `corepack pnpm --filter @sengoku-jidai/web exec vitest run test/editor/reducer-commanders.test.ts test/editor/doc.test.ts`
Expected: PASS.

- [ ] **Step 8: Add minimal styling for the input**

In `packages/web/src/styles/app.css`, add near the editor styles (search for `.editor-tally`):

```css
.editor-field {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin: 8px 0;
  font-size: 0.85rem;
}

.editor-field input {
  width: 4rem;
}
```

- [ ] **Step 9: Commit**

```bash
git add packages/web/src/editor/doc.ts packages/web/src/editor/reducer.ts \
  packages/web/src/components/editor/InspectorPanel.tsx \
  packages/web/test/editor/reducer-commanders.test.ts packages/web/test/editor/doc.test.ts \
  packages/web/src/styles/app.css
git commit -m "feat(web): commanders-per-round setting in the map editor"
```

---

### Task 6: Commanders-remaining pips in the HUD (web)

Render a per-seat pip row in the scoreboard: filled pips = still to place, dim pips = used, with a small "N left" count.

**Files:**
- Create: `packages/web/src/components/CommanderPips.tsx` (pure helper + component)
- Modify: `packages/web/src/App.tsx` (scoreboard blocks + import)
- Modify: `packages/web/src/styles/app.css` (pip styles)
- Test: `packages/web/test/commanderPips.test.ts` (create)

**Note on testing:** the web package has **no** DOM test environment or React Testing Library (every existing web test is a pure-logic `.test.ts`, e.g. the editor reducer/doc tests). Do **not** add `@testing-library/react`/`jsdom`. Instead, extract the pip layout as a pure exported helper (`commanderPipFills`) and unit-test that; the component is a thin wrapper around it.

**Interfaces:**
- Consumes: `PlayerGameView.commandersRemaining`, `PlayerGameView.commandersTotal` (Task 4).
- Produces:
  - `export function commanderPipFills(total: number, remaining: number): boolean[]` — array of length `max(0, total)`; element `i` is `true` (filled = still to place) when `i < remaining`, else `false` (used/dim).
  - `<CommanderPips total={number} remaining={number} />` — renders one `.commander-pip` per helper entry (the `false` ones marked `.is-used`) plus a `.commander-left` label. Color is inherited from the enclosing `.score-red` / `.score-black`.

- [ ] **Step 1: Write the failing test**

Create `packages/web/test/commanderPips.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { commanderPipFills } from "../src/components/CommanderPips.js";

describe("commanderPipFills", () => {
  it("fills the first `remaining` of `total` pips", () => {
    expect(commanderPipFills(5, 3)).toEqual([true, true, true, false, false]);
  });

  it("handles all-remaining and none-remaining", () => {
    expect(commanderPipFills(4, 4)).toEqual([true, true, true, true]);
    expect(commanderPipFills(4, 0)).toEqual([false, false, false, false]);
  });

  it("returns an empty array for a zero total", () => {
    expect(commanderPipFills(0, 0)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `corepack pnpm --filter @sengoku-jidai/web exec vitest run test/commanderPips.test.ts`
Expected: FAIL — module `CommanderPips` / export `commanderPipFills` not found.

- [ ] **Step 3: Create the helper + component**

Create `packages/web/src/components/CommanderPips.tsx`:

```tsx
/** Pip layout for the commander tracker: one entry per commander, `true` for the first
 *  `remaining` (still to place / filled), `false` for the rest (placed or passed / dim). */
export function commanderPipFills(total: number, remaining: number): boolean[] {
  return Array.from({ length: Math.max(0, total) }, (_, i) => i < remaining);
}

/** Per-seat commander tracker for the HUD. Color is inherited from the enclosing seat block. */
export function CommanderPips({ total, remaining }: { total: number; remaining: number }) {
  return (
    <span
      className="commander-pips"
      aria-label={`${remaining} of ${total} commanders left to place`}
    >
      {commanderPipFills(total, remaining).map((filled, i) => (
        <span
          key={i}
          className={`commander-pip${filled ? "" : " is-used"}`}
          aria-hidden="true"
        />
      ))}
      <span className="commander-left">{remaining} left</span>
    </span>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `corepack pnpm --filter @sengoku-jidai/web exec vitest run test/commanderPips.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Render it in the scoreboard**

In `packages/web/src/App.tsx`:

(a) Add the import near the other component imports (top of file):

```tsx
import { CommanderPips } from "./components/CommanderPips.js";
```

(b) In the red seat block, add the pips after the `score-vp` span (line ~867):

```tsx
            <span className="score-vp">{game.view.victoryPoints.red}</span>
            <CommanderPips
              total={game.view.commandersTotal.red}
              remaining={game.view.commandersRemaining.red}
            />
```

(c) In the black seat block, add the pips before the `score-vp` span (line ~875), mirroring the layout:

```tsx
            <CommanderPips
              total={game.view.commandersTotal.black}
              remaining={game.view.commandersRemaining.black}
            />
            <span className="score-vp">{game.view.victoryPoints.black}</span>
```

- [ ] **Step 6: Add the pip styles**

In `packages/web/src/styles/app.css`, after the `.score-marker` rule (line ~177):

```css
.commander-pips {
  display: inline-flex;
  align-items: center;
  gap: 3px;
}

.commander-pip {
  width: 7px;
  height: 7px;
  border-radius: 999px;
  background: currentcolor;
}

.commander-pip.is-used {
  opacity: 0.25;
}

.commander-left {
  margin-left: 4px;
  font-size: 0.7rem;
  color: var(--sumi-soft);
}

.score-red .commander-pips {
  color: #c0392b;
}

.score-black .commander-pips {
  color: #2f343c;
}
```

- [ ] **Step 7: Typecheck the web package**

Run: `corepack pnpm --filter @sengoku-jidai/web run typecheck`
Expected: no errors (confirms the view fields exist on the built engine type and the new component wires up).

- [ ] **Step 8: Commit**

```bash
git add packages/web/src/components/CommanderPips.tsx packages/web/src/App.tsx \
  packages/web/src/styles/app.css packages/web/test/commanderPips.test.ts
git commit -m "feat(web): commanders-remaining pips in the HUD"
```

---

### Final verification (before PR)

- [ ] **Step 1: Format**

Run: `corepack pnpm format`
Then stage any reformatted files and amend/commit if needed.

- [ ] **Step 2: Full gate**

Run: `corepack pnpm test`
Expected: all package suites PASS.

Run: `corepack pnpm typecheck`
Expected: no errors (includes the server drift guard against the updated schema/interface).

Run: `corepack pnpm lint`
Expected: clean.

- [ ] **Step 3: Open the PR**

Push the branch and open a PR summarizing: (1) HQ/harbor markers now trace the real tile outline (fixes multi-hex tiles); (2) per-map commanders-per-round setting in the editor; (3) commanders-remaining pips in the HUD. Ask before merging; squash-merge; watch CI to green.

---

## Self-Review

**Spec coverage:**
- Spec §Solution 1 (HQ outline) → Task 2. ✓
- Spec §Solution 2 (harbor outline, piers unchanged) → Task 1 (offset helper) + Task 2. ✓
- Spec §Solution 3a (per-map setting, schema, compile, wiring, editor) → Task 3 (engine/shared) + Task 5 (editor). ✓
- Spec §Solution 3b (view field + HUD pips) → Task 4 (view) + Task 6 (pips). ✓
- Spec §Testing (1&2 snapshot + multi-hex; 3 compile/view/reducer) → Tasks 1, 2, 3, 4, 5, 6 all TDD. ✓
- Spec "piers unchanged" → no task touches pier code; Task 2 explicitly leaves the ports branch alone. ✓
- Spec "Rivers stays at 5" → Task 3 Step 1 default-fallback test. ✓

**Placeholder scan:** No TBD/TODO; every code step has complete code; commands have expected output.

**Type consistency:** `commandersPerRound?: number` used identically in `HexMapSource`, `MapDefinition`, `EditorDoc`, and `hexMapSourceSchema`. View fields `commandersRemaining`/`commandersTotal` (`Record<SeatId, number>`) defined in Task 4 and consumed by the same names in Task 6. `CommanderPips` prop names (`total`, `remaining`) match between Task 6 Step 3 and the App.tsx call sites. Marker classes `hq-outline`/`harbor-outline`/`harbor-outline-dash` match between Task 2 implementation and its tests. `offsetRingsOutward(rings, distance)` signature matches between Task 1 and its use in Task 2.
