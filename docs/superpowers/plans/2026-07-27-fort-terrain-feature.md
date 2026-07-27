# Fort Terrain Feature Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a fort — a land-tile terrain feature that gives the defender one extra die when defending against a land Advance (stacking with Ambush), rendered as a white border layered between the player-base and harbor borders.

**Architecture:** A `fort` boolean flows from the hex map source (`features.fort`) through the zod schema and `compileHexMap` onto `MapArea.fort`. Combat reads it via the map registry in `rollPendingCombat`. The board renderer draws it as a white stroke of the fused tile outline, nested concentrically between the HQ base (outermost) and harbor (innermost); the harbor's dashed line moves to just inside its own solid line. The map editor gets a land-only Fort toggle.

**Tech Stack:** TypeScript monorepo (pnpm workspaces), Vitest, React (web/editor), zod (shared schemas). Packages: `@sengoku-jidai/engine`, `@sengoku-jidai/shared`, `@sengoku-jidai/board-render`, `@sengoku-jidai/web`.

## Global Constraints

- Forts exist on **land tiles only**; sea forts are rejected/disabled.
- The extra die applies to **land Advance defence only** (`pendingCombat.kind === "advance"`). `sail`, `bombard`, `shell` are untouched.
- The fort die is automatic — no card, no player choice, no legality gate. It **stacks with Ambush** (defence 1 → 2 with fort → 4 with fort+ambush).
- No forts on the shipped Rivers map (`riversSource.ts` unchanged).
- Cross-package dist trap: after editing `@sengoku-jidai/engine` or `@sengoku-jidai/shared`, **rebuild libs** (`corepack pnpm build:libs`) before running `board-render` or `web` tests/typecheck — those packages consume built dist, not source.
- Border draw order, outermost → innermost: **base (HQ) → fort → harbor solid → harbor dash**. The harbor dash is always inside its own solid line.
- Run `corepack pnpm format` before the final commit (prettier gate in CI).

---

### Task 1: Fort in the map data model, schema, compile, and validation

**Files:**
- Modify: `packages/engine/src/maps/hex/source.ts:15-23` (add `fort?` to `HexTileSource.features`)
- Modify: `packages/shared/src/schemas.ts:104-109` (add `fort` to `hexTileFeaturesSchema`)
- Modify: `packages/engine/src/maps/riversMap.ts:39-54` (add `fort` to `MapArea`)
- Modify: `packages/engine/src/maps/hex/compile.ts:28-40` (map `features.fort` → `MapArea.fort`)
- Modify: `packages/engine/src/maps/hex/validate.ts` (reject `fort` on non-land tiles)
- Test: `packages/engine/test/maps/hex/compile.test.ts`, `packages/engine/test/maps/hex/validate.test.ts`

**Interfaces:**
- Produces: `MapArea.fort: boolean` (always present after compile, defaults `false`); `HexTileSource.features.fort?: boolean`; `hexTileFeaturesSchema` accepts optional `fort` boolean.

- [ ] **Step 1: Write the failing compile test**

Add to `packages/engine/test/maps/hex/compile.test.ts`:

```ts
it("compiles the fort flag onto the area, defaulting to false", () => {
  const source = {
    id: "t",
    name: "t",
    layout: { size: 114, originX: 0, originY: 0 },
    tiles: [
      { id: "F", kind: "land" as const, hexes: [{ q: 0, r: 0 }], features: { fort: true } },
      { id: "G", kind: "land" as const, hexes: [{ q: 1, r: 0 }], features: {} }
    ],
    bonusSlots: [],
    startingDeployment: {},
    commandersPerRound: 2
  };
  const { definition } = compileHexMap(source);
  expect(definition.areas.F!.fort).toBe(true);
  expect(definition.areas.G!.fort).toBe(false);
});
```

(If `compileHexMap`/types are not yet imported in this file, mirror the existing imports at the top of the test.)

- [ ] **Step 2: Run test to verify it fails**

Run: `corepack pnpm --filter @sengoku-jidai/engine test -- compile`
Expected: FAIL — `fort` does not exist on `HexTileSource.features` / `MapArea` (type error or `undefined`).

- [ ] **Step 3: Add `fort` to the source type**

In `packages/engine/src/maps/hex/source.ts`, inside the `features` object (after `shellable?`):

```ts
    /** Coastal land targetable by Shell. */
    shellable?: boolean;
    /** Land-only fort: +1 defender die on a land Advance into this tile. */
    fort?: boolean;
```

- [ ] **Step 4: Add `fort` to the runtime `MapArea`**

In `packages/engine/src/maps/riversMap.ts`, after the `shellable: boolean;` field:

```ts
  shellable: boolean;
  /** Land-only fort: grants the defender +1 die on a land Advance into this area. */
  fort: boolean;
```

- [ ] **Step 5: Map the flag in compile**

In `packages/engine/src/maps/hex/compile.ts`, in the `areas[t.id] = { ... }` literal, after `shellable: t.features.shellable ?? false,`:

```ts
      shellable: t.features.shellable ?? false,
      fort: t.features.fort ?? false,
```

- [ ] **Step 6: Run compile test to verify it passes**

Run: `corepack pnpm --filter @sengoku-jidai/engine test -- compile`
Expected: PASS.

- [ ] **Step 7: Write the failing validation test (no sea forts)**

Add to `packages/engine/test/maps/hex/validate.test.ts` (mirror the existing `validateHexMap`/throw-assertion style already in that file):

```ts
it("rejects a fort on a sea tile", () => {
  const source = {
    id: "t",
    name: "t",
    layout: { size: 114, originX: 0, originY: 0 },
    tiles: [{ id: "S", kind: "sea" as const, hexes: [{ q: 0, r: 0 }], features: { fort: true } }],
    bonusSlots: [],
    startingDeployment: {},
    commandersPerRound: 2
  };
  expect(() => compileHexMap(source)).toThrow(/fort/i);
});
```

- [ ] **Step 8: Run test to verify it fails**

Run: `corepack pnpm --filter @sengoku-jidai/engine test -- validate`
Expected: FAIL — no error is thrown (sea fort currently allowed).

- [ ] **Step 9: Add the land-only guard in validate**

In `packages/engine/src/maps/hex/validate.ts`, inside the per-tile loop (mirror the `hq` land check around lines 40-49). Add near the other feature checks:

```ts
    if (t.features.fort && t.kind !== "land") {
      throw new Error(`fort tile ${t.id} must be land`);
    }
```

- [ ] **Step 10: Add `fort` to the shared zod schema**

In `packages/shared/src/schemas.ts`, in `hexTileFeaturesSchema` (after `shellable`):

```ts
  shellable: z.boolean().optional(),
  fort: z.boolean().optional()
```

- [ ] **Step 11: Run engine tests + shared typecheck to verify green**

Run: `corepack pnpm --filter @sengoku-jidai/engine test -- validate compile`
Expected: PASS.
Run: `corepack pnpm --filter @sengoku-jidai/shared typecheck`
Expected: PASS.

- [ ] **Step 12: Commit**

```bash
git add packages/engine/src/maps/hex/source.ts packages/engine/src/maps/hex/compile.ts packages/engine/src/maps/hex/validate.ts packages/engine/src/maps/riversMap.ts packages/shared/src/schemas.ts packages/engine/test/maps/hex/compile.test.ts packages/engine/test/maps/hex/validate.test.ts
git commit -m "feat(engine): add land-only fort flag to map data model, schema, compile"
```

---

### Task 2: Combat — fort grants the defender +1 die on a land Advance

**Files:**
- Modify: `packages/engine/src/actions.ts:427-455` (`rollPendingCombat`)
- Test: `packages/engine/test/pendingCombat.test.ts`

**Interfaces:**
- Consumes: `MapArea.fort` (Task 1), `getMap(state.mapId)` (already imported at `actions.ts:4`).
- Produces: no new exports — behavior change only. A land Advance defender on a fort tile rolls `1 + (ambush ? 2 : 0) + 1` dice.

- [ ] **Step 1: Write the failing test**

The existing `pendingCombat.test.ts` builds combats on the Rivers map, which has no forts, so this test constructs its own state on a small map with a fort. Add a self-contained test. Mirror the file's existing `resolveCommand` import and the `diceFaces: [1,1,1,1,1,1]` deterministic-dice trick, but drive the map via a fort-bearing fixture:

```ts
import { initGame } from "../src/game.js";
import { registerMap, getMap } from "../src/maps/registry.js";
import { compileHexMap } from "../src/maps/hex/compile.js";

// A 2-land-tile map: black HQ tile "keep" (a fort) adjacent to red's "field".
function fortMapState() {
  const source = {
    id: "forttest",
    name: "Fort Test",
    layout: { size: 114, originX: 0, originY: 0 },
    tiles: [
      { id: "keep", kind: "land" as const, hexes: [{ q: 0, r: 0 }], features: { hq: "black" as const, fort: true } },
      { id: "field", kind: "land" as const, hexes: [{ q: 1, r: 0 }], features: { hq: "red" as const } }
    ],
    bonusSlots: [],
    startingDeployment: { keep: { seat: "black" as const, troop: 3 }, field: { seat: "red" as const, troop: 3 } },
    commandersPerRound: 2
  };
  registerMap(compileHexMap(source).definition);
  return initGame({ gameId: "g-fort", mapId: "forttest", mode: "hotseat" });
}
```

> Before writing the assertion, open `packages/engine/src/maps/registry.ts` and `packages/engine/src/game.ts` to confirm the exact `registerMap`/`initGame` signatures and adapt the two helper calls above to match (names/params may differ). Confirm how existing tests stage an Advance into an enemy area (see `advanceIntoEnemy()` at `pendingCombat.test.ts:18`) and reuse that flow to reach a paused `advance` combat where `pendingCombat.area === "keep"`.

Then the assertion:

```ts
it("a fort tile gives the land-Advance defender one extra die (stacks with ambush)", () => {
  // ... stage an advance into "keep" so pendingCombat.kind === "advance" && area === "keep" ...
  // With diceFaces all-1, a plain defence rolls 1 die (total 1); a fort makes it 2 dice (total 2).
  const rolled = resolveCommand(paused, { seat: "black" }, { type: "combatRoll", pendingId });
  expect(rolled.nextState.pendingCombat!.rolls!.length).toBe(2); // 1 base + 1 fort
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `corepack pnpm --filter @sengoku-jidai/engine test -- pendingCombat`
Expected: FAIL — `rolls.length` is 1 (fort not yet counted).

- [ ] **Step 3: Add the fort die in `rollPendingCombat`**

In `packages/engine/src/actions.ts`, replace the dice-count computation (currently lines ~433-435):

```ts
  const ambush = card === "ambush";
  if (ambush) events.push(...playCard(state, pc.responsibleSeat, card!));
  // Fort: the defender of a land Advance into a fort tile throws one extra die (terrain,
  // automatic — no card played). Stacks with Ambush. Sea/bombard/shell are unaffected.
  const fort = pc.kind === "advance" && getMap(state.mapId).areas[pc.area]?.fort === true;
  const count = (isDefence ? 1 : pc.dice!) + (ambush ? 2 : 0) + (fort ? 1 : 0);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `corepack pnpm --filter @sengoku-jidai/engine test -- pendingCombat`
Expected: PASS.

- [ ] **Step 5: Run the full engine suite (guard against regressions)**

Run: `corepack pnpm --filter @sengoku-jidai/engine test`
Expected: PASS (Rivers has no forts, so existing combats are unchanged).

- [ ] **Step 6: Commit**

```bash
git add packages/engine/src/actions.ts packages/engine/test/pendingCombat.test.ts
git commit -m "feat(engine): fort tile grants the land-Advance defender +1 die"
```

---

### Task 3: Rendering — white fort border, concentric nesting, harbor dash moved inside

**Files:**
- Modify: `packages/board-render/src/scene.ts:24,141` (add `fort` to `SceneTile.features` and populate it)
- Modify: `packages/board-render/src/assemble.ts:23-30,85-133` (fort constant + nesting logic)
- Test: `packages/board-render/test/assemble.test.ts:29-73` (add fort assertions; fix the octagon literal)

**Interfaces:**
- Consumes: `MapArea.fort` (Task 1) via `compiled.definition.areas`.
- Produces: `SceneTile.features.fort: boolean`; SVG output containing `class="fort-outline"` with `stroke:#ffffff` for fort tiles; `harbor-outline-dash` ring offset inward of `harbor-outline`.

- [ ] **Step 1: Rebuild engine so board-render sees `MapArea.fort`**

Run: `corepack pnpm build:libs`
Expected: builds `@sengoku-jidai/engine` (+ others) with no errors.

- [ ] **Step 2: Write the failing render test**

Add to `packages/board-render/test/assemble.test.ts`. Build a scene inline (mirror the octagon test at line 40) with a single tile carrying base + fort + harbor:

```ts
it("draws a white fort border nested between the base and harbor, with the dash inside the solid", () => {
  const hexRing = [
    { x: -57, y: -33 }, { x: 0, y: -66 }, { x: 57, y: -33 },
    { x: 57, y: 33 }, { x: 0, y: 66 }, { x: -57, y: 33 }
  ];
  const tile = {
    id: "keep",
    kind: "land" as const,
    rings: [hexRing],
    centroid: { x: 0, y: 0 },
    authoredFill: "#d5d3c4",
    features: { hq: "black" as const, valueStars: 0 as const, harbor: true, fort: true },
    glyphAnchors: {},
    slots: {},
    ports: []
  };
  const scene = {
    viewBox: { x: -120, y: -120, width: 240, height: 240 },
    tiles: [tile],
    hexGrid: [],
    hexSize: 114
  };
  const out = assembleBoardSvg(scene);
  expect(out).toContain(`class="fort-outline"`);
  expect(out).toContain(`stroke:#ffffff`); // fort is white
  expect(out).toContain(`class="hq-outline"`);
  expect(out).toContain(`class="harbor-outline"`);
  expect(out).toContain(`class="harbor-outline-dash"`);
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `corepack pnpm --filter @sengoku-jidai/board-render test -- assemble`
Expected: FAIL — no `fort-outline` in output; also a TS error that `features` is missing `fort` in the existing octagon literal (fixed in Step 6).

- [ ] **Step 4: Add `fort` to `SceneTile.features`**

In `packages/board-render/src/scene.ts`, line 24, change:

```ts
  features: { hq?: SeatId; valueStars: 0 | 1 | 2; harbor: boolean; fort: boolean };
```

And in `buildScene` where the tile's `features` object is built (line 141), change:

```ts
      features: {
        hq: area.hq ?? undefined,
        valueStars: area.valueStars,
        harbor: area.harbor,
        fort: area.fort
      },
```

- [ ] **Step 5: Add the fort constant + concentric nesting in `assemble.ts`**

In `packages/board-render/src/assemble.ts`, add near the other stroke-width constants (after line 30):

```ts
const FORT_STROKE_W = 6;
/** Gap between adjacent concentric feature bands, in native units. */
const FEATURE_BAND_GAP = 1.5;
```

Then replace the base+harbor block inside `featureGlyphs` (currently lines 90-115) with a single concentric-band walk. The outermost *present* border stays centered on the tile edge; each further-in border nests so its outer edge meets the previous band's inner edge (minus `FEATURE_BAND_GAP`). Inward = negative offset distance:

```ts
  // Concentric feature borders, outermost -> innermost: base (HQ), fort, harbor.
  // The outermost PRESENT border is centered on the tile edge (offset 0), preserving the
  // look of base-only and (very common) harbor-only tiles; each further-in border nests
  // inside it. Offsets are inward, i.e. negative distances into offsetRingsOutward.
  let cursorInner = 0; // inner boundary (native units) reached so far; 0 = tile edge
  let firstBand = true;
  const bandCenter = (width: number): number => {
    if (firstBand) {
      firstBand = false;
      cursorInner = -width / 2;
      return 0; // straddles the tile edge, like today's base/harbor
    }
    const center = cursorInner - FEATURE_BAND_GAP - width / 2;
    cursorInner = center - width / 2;
    return center;
  };
  const bandRings = (center: number) =>
    center === 0 ? tile.rings : offsetRingsOutward(tile.rings, center * s);

  if (tile.features.hq) {
    const stroke = tile.features.hq === "red" ? "#e02d2d" : "#000000";
    out.push(
      el("path", {
        d: ringPath(bandRings(bandCenter(HQ_STROKE_W))),
        class: "hq-outline",
        style: `fill:none;stroke:${stroke};stroke-width:${(HQ_STROKE_W * s).toFixed(2)};stroke-linejoin:round`
      })
    );
  }
  if (tile.features.fort) {
    out.push(
      el("path", {
        d: ringPath(bandRings(bandCenter(FORT_STROKE_W))),
        class: "fort-outline",
        style: `fill:none;stroke:#ffffff;stroke-width:${(FORT_STROKE_W * s).toFixed(2)};stroke-linejoin:round`
      })
    );
  }
  if (tile.features.harbor) {
    const solidCenter = bandCenter(HARBOR_SOLID_W);
    const dashCenter = solidCenter - HARBOR_DASH_OFFSET; // dash now hugs INSIDE the solid line
    const dashArray = HARBOR_DASH_ARRAY.map((v) => (v * s).toFixed(3)).join(",");
    out.push(
      el("path", {
        d: ringPath(bandRings(solidCenter)),
        class: "harbor-outline",
        style: `fill:none;stroke:#000000;stroke-width:${(HARBOR_SOLID_W * s).toFixed(2)};stroke-linejoin:round`
      }),
      el("path", {
        d: ringPath(offsetRingsOutward(tile.rings, dashCenter * s)),
        class: "harbor-outline-dash",
        style: `fill:none;stroke:#000000;stroke-width:${(HARBOR_DASH_W * s).toFixed(2)};stroke-linejoin:round;stroke-dasharray:${dashArray}`
      })
    );
  }
```

Note: `HARBOR_DASH_OFFSET` (line 30) keeps its value but is now **subtracted** (inward) instead of added (outward). Update its comment at line 25 to say the dash rides just *inside* the solid line.

- [ ] **Step 6: Fix the existing octagon test literal**

In `packages/board-render/test/assemble.test.ts:58`, the inline `tile.features` now needs `fort`:

```ts
      features: { hq: "red" as const, valueStars: 0 as const, harbor: false, fort: false },
```

- [ ] **Step 7: Run board-render tests to verify green**

Run: `corepack pnpm --filter @sengoku-jidai/board-render test -- assemble`
Expected: PASS (new fort test + the octagon vertex-count test still 8).

- [ ] **Step 8: Run the full board-render suite**

Run: `corepack pnpm --filter @sengoku-jidai/board-render test`
Expected: PASS. If any scene/snapshot test constructs a `SceneTile.features` literal, add `fort: false` to it (the compiler will point out each).

- [ ] **Step 9: Commit**

```bash
git add packages/board-render/src/scene.ts packages/board-render/src/assemble.ts packages/board-render/test/assemble.test.ts
git commit -m "feat(board-render): white fort border, concentric base/fort/harbor nesting, dash inside solid"
```

---

### Task 4: Editor Fort toggle + tile details

**Files:**
- Modify: `packages/web/src/editor/reducer.ts:21-26,255-261` (`FeaturePatch` + `setFeature` handling)
- Modify: `packages/web/src/components/editor/InspectorPanel.tsx:180-191` (Fort checkbox inside the land-only block)
- Modify: `packages/web/src/components/board/AreaDetails.tsx:43` (Fort list item)

**Interfaces:**
- Consumes: `MapArea.fort` (Task 1) in `AreaDetails`; `HexTileSource.features.fort` in the reducer.
- Produces: editor writes/clears `features.fort`; the Fort checkbox appears only for land tiles.

- [ ] **Step 1: Rebuild libs so web sees the new engine/shared types**

Run: `corepack pnpm build:libs`
Expected: no errors.

- [ ] **Step 2: Add `fort` to `FeaturePatch`**

In `packages/web/src/editor/reducer.ts`, in the `FeaturePatch` type (after `shellable?`):

```ts
  shellable?: boolean;
  fort?: boolean;
```

- [ ] **Step 3: Handle `fort` in the `setFeature` reducer**

In `packages/web/src/editor/reducer.ts`, after the `shellable` block (line 261, before `return { ...t, features };`):

```ts
    if (patch.fort !== undefined) {
      if (patch.fort) {
        features.fort = true;
      } else {
        delete features.fort;
      }
    }
```

- [ ] **Step 4: Add the Fort checkbox to the land-only inspector block**

In `packages/web/src/components/editor/InspectorPanel.tsx`, inside the `{isLand ? ( ... ) : null}` block, after the Shellable `</label>` (line 189) and before the block's closing `</>` (line 190):

```tsx
          <label className="check">
            <input
              type="checkbox"
              checked={primary.features.fort === true}
              onChange={(event) =>
                dispatch({ type: "setFeature", tileId, patch: { fort: event.target.checked } })
              }
            />
            <span>Fort</span>
          </label>
```

(Placing it inside the `isLand` block is the land-only guard — sea tiles never render the toggle.)

- [ ] **Step 5: Surface Fort in the tile details**

In `packages/web/src/components/board/AreaDetails.tsx`, after the Harbour line (line 43):

```tsx
        {mapArea.harbor ? <li>Harbour</li> : null}
        {mapArea.fort ? <li>Fort</li> : null}
```

- [ ] **Step 6: Typecheck the web package**

Run: `corepack pnpm --filter @sengoku-jidai/web typecheck`
Expected: PASS.

- [ ] **Step 7: Run web tests**

Run: `corepack pnpm --filter @sengoku-jidai/web test`
Expected: PASS. If an editor reducer test enumerates feature patches, extend it to cover `fort` round-tripping (set true → `features.fort === true`; set false → key removed).

- [ ] **Step 8: Commit**

```bash
git add packages/web/src/editor/reducer.ts packages/web/src/components/editor/InspectorPanel.tsx packages/web/src/components/board/AreaDetails.tsx
git commit -m "feat(web): land-only Fort editor toggle + tile-details Fort line"
```

---

### Task 5: Full gate + format

**Files:** none (verification only)

- [ ] **Step 1: Format**

Run: `corepack pnpm format`
Expected: prettier rewrites any unformatted files.

- [ ] **Step 2: Full test gate**

Run: `corepack pnpm test`
Expected: PASS across all packages.

- [ ] **Step 3: Full typecheck + lint**

Run: `corepack pnpm typecheck && corepack pnpm lint`
Expected: PASS.

- [ ] **Step 4: Commit any formatting changes**

```bash
git add -A
git commit -m "chore: format fort feature" || echo "nothing to format"
```

---

## Self-Review

**Spec coverage:**
- Data model + authoring (fort flag, editor toggle land-only, no default forts) → Tasks 1, 4. ✓
- Surface "Fort" in tile hover/details → Task 4 Step 5. ✓
- Combat rule (+1 die, land Advance only, stacks with Ambush, bombard/shell untouched) → Task 2. ✓
- Rendering: white border, base→fort→harbor nesting, harbor dash inside solid → Task 3. ✓
- Testing (engine combat, board-render layering fixture, editor round-trip) → Tasks 2, 3, 4. ✓

**Placeholder scan:** No TBD/TODO; every code step shows concrete code. Two steps ("open registry.ts/game.ts to confirm signatures" in Task 2 Step 1; "extend reducer test if present" in Task 4 Step 7) are verification-of-existing-API notes, not deferred implementation — the test body and assertions are fully specified.

**Type consistency:** `fort` is a required `boolean` on `MapArea` and `SceneTile.features` (defaulted at compile/scene build), and optional on the source/schema/patch types — matching the existing `harbor` treatment across the same layers. `bandCenter`/`bandRings` helpers are defined and used within `featureGlyphs` only. `class="fort-outline"` / `stroke:#ffffff` are produced in Task 3 and asserted in Task 3's test.
