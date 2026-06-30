# Rivers → procedural hex renderer migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Re-express the Rivers map as a `HexMapSource`, compile it to the runtime `MapDefinition`, and render it through the SP2 `board-render` pipeline — retiring the bespoke `board.svg` injection.

**Architecture:** A new static `riversSource` (hex layout extracted from `board.svg` geometry, multi-hex tiles solved against the adjacency oracle) compiles via `compileHexMap` to a definition that deep-equals today's hand-authored `riversMap`. `board-render` gains the three bonus glyphs it was missing. The web swaps its `board.svg?raw` injection for `assembleBoardSvg(buildScene(compileHexMap(riversSource)))` and rewrites the imperative `prepareSvg`/`decorate` layer to match the procedural SVG contract.

**Tech Stack:** TypeScript, pnpm workspaces, Vitest (engine/web unit), Playwright (e2e), React (web), framework-agnostic `board-render`.

## Global Constraints

- Exact-fidelity: `compileHexMap(riversSource).definition` MUST deep-equal the current `riversMap` (areas, kinds, adjacency, ports, value stars, HQs, bonus slots). The existing `packages/engine/test/maps/riversMap.test.ts` stays green and unchanged.
- `startingDeployment` ported verbatim from `RIVERS_STARTING_UNITS` in `packages/engine/src/game.ts` (identical values → `game.test.ts` determinism anchor unchanged).
- Tile ids stay `tile1`..`tile22` (web `slotIdForSpace` requires `rest.startsWith("tile")`).
- Glyph/component geometry is reused verbatim from `assets/maps/rivers/board.svg`; only placement is computed.
- `assets/maps/rivers/board.svg` is NOT deleted (kept as extraction provenance); only the live web import is removed.
- One PR on branch `sp3-rivers-hex-migration` (already created). Full local gate before push: `pnpm typecheck && pnpm test && pnpm build && pnpm lint`, plus `pnpm exec prettier --check` on changed paths. Watch CI to green. Ask before merge; squash + delete branch.
- Commit messages end with the `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>` trailer.

**Verified hex layout** (adjacency confirmed an exact match to `riversMap.ts`, no overlaps; normalized axial, `size=114`, origin `(0,0)`):

| tile | kind | hexes (q,r) | features | ports |
|------|------|-------------|----------|-------|
| tile1 | land | (0,2),(0,3) | — | — |
| tile2 | land | (1,1) | star1 | — |
| tile3 | sea | (2,1) | star1 | — |
| tile4 | land | (3,0) | star1 | — |
| tile5 | land | (4,0),(4,1) | — | — |
| tile6 | land | (1,2) | star1, harbor | tile3,tile7 |
| tile7 | sea | (2,2) | star1 | — |
| tile8 | land | (3,1) | star1, harbor | tile3,tile7 |
| tile9 | land | (0,4) | hq red, harbor | tile14,tile15 |
| tile10 | land | (1,3) | shellable | — |
| tile11 | sea | (2,3) | star1 | — |
| tile12 | land | (3,2) | shellable | — |
| tile13 | land | (4,2) | hq black, harbor | tile17,tile18 |
| tile14 | sea | (0,5),(0,6) | — | — |
| tile15 | sea | (1,4) | star1 | — |
| tile16 | land | (2,4) | star2, harbor | tile11,tile15,tile17 |
| tile17 | sea | (3,3) | star1 | — |
| tile18 | sea | (4,3),(4,4) | — | — |
| tile19 | land | (1,5) | shellable | — |
| tile20 | land | (2,5) | star2 | — |
| tile21 | land | (3,4) | shellable | — |
| tile22 | sea | (1,6),(2,6),(3,5) | — | — |

`bonusSlots: ["tile2","tile4","tile20"]` (slot order → sun, moon, star icons).
`startingDeployment`: red `tile1:troop2, tile9:troop3, tile10:troop2, tile14:ship3, tile19:troop3`; black `tile5:troop2, tile13:troop3, tile12:troop2, tile18:ship3, tile21:troop3`.

---

### Task 1: Author `riversSource` and lock topology equivalence (engine)

**Files:**
- Create: `packages/engine/src/maps/riversSource.ts`
- Create: `packages/engine/test/maps/riversMap.snapshot.json` (frozen oracle, generated)
- Create: `packages/engine/test/maps/riversSource.test.ts`
- Modify: `packages/engine/src/maps/riversMap.ts` (replace hand-authored `areaList` with compiled source)
- Modify: `packages/engine/src/index.ts` (export the new source)

**Interfaces:**
- Consumes: `HexMapSource`, `HexTileSource` from `./hex/source.js`; `compileHexMap`, `CompiledMap` from `./hex/compile.js`; `MapArea`, `MapDefinition` from `./riversMap.js`.
- Produces: `export const riversSource: HexMapSource`; `riversMap: MapDefinition` (now `= compileHexMap(riversSource).definition`).

- [ ] **Step 1: Freeze the current topology as a snapshot oracle**

Run this BEFORE editing `riversMap.ts`, so it captures the hand-authored graph:

```bash
cd /mnt/ssd_pool/martin/repos/sengoku_jidai
node --input-type=module -e '
import { riversMap } from "./packages/engine/dist/maps/riversMap.js";
import { writeFileSync } from "node:fs";
// Normalize the same way compileHexMap emits: sorted adjacent/ports.
const areas = Object.fromEntries(
  Object.entries(riversMap.areas).map(([id, a]) => [id, {
    ...a, adjacent: [...a.adjacent].sort(), ports: [...a.ports].sort()
  }])
);
writeFileSync("packages/engine/test/maps/riversMap.snapshot.json",
  JSON.stringify(areas, null, 2) + "\n");
'
```

If `dist/` is stale, run `pnpm --filter @sengoku-jidai/engine build` first. Verify the file has 22 entries:

```bash
node -e 'console.log(Object.keys(require("./packages/engine/test/maps/riversMap.snapshot.json")).length)'
```
Expected: `22`

- [ ] **Step 2: Create `riversSource.ts`**

```typescript
import type { HexMapSource } from "./hex/source.js";

/**
 * Rivers authored as a hex map. The hex layout was reconstructed from the
 * flat-top hex grid in assets/maps/rivers/board.svg (size 114): single-hex
 * tiles read directly from the board, multi-hex tiles (1,5,14,18,22) placed so
 * the edge-derived adjacency exactly reproduces the hand-authored graph. The
 * equivalence is locked by riversSource.test.ts against riversMap.snapshot.json.
 */
export const riversSource: HexMapSource = {
  id: "rivers",
  name: "Rivers",
  layout: { size: 114, originX: 0, originY: 0 },
  tiles: [
    { id: "tile1", kind: "land", hexes: [{ q: 0, r: 2 }, { q: 0, r: 3 }], features: {} },
    { id: "tile2", kind: "land", hexes: [{ q: 1, r: 1 }], features: { valueStars: 1 } },
    { id: "tile3", kind: "sea", hexes: [{ q: 2, r: 1 }], features: { valueStars: 1 } },
    { id: "tile4", kind: "land", hexes: [{ q: 3, r: 0 }], features: { valueStars: 1 } },
    { id: "tile5", kind: "land", hexes: [{ q: 4, r: 0 }, { q: 4, r: 1 }], features: {} },
    {
      id: "tile6", kind: "land", hexes: [{ q: 1, r: 2 }],
      features: { valueStars: 1, harbor: true }, ports: ["tile3", "tile7"]
    },
    { id: "tile7", kind: "sea", hexes: [{ q: 2, r: 2 }], features: { valueStars: 1 } },
    {
      id: "tile8", kind: "land", hexes: [{ q: 3, r: 1 }],
      features: { valueStars: 1, harbor: true }, ports: ["tile3", "tile7"]
    },
    {
      id: "tile9", kind: "land", hexes: [{ q: 0, r: 4 }],
      features: { hq: "red", harbor: true }, ports: ["tile14", "tile15"]
    },
    { id: "tile10", kind: "land", hexes: [{ q: 1, r: 3 }], features: { shellable: true } },
    { id: "tile11", kind: "sea", hexes: [{ q: 2, r: 3 }], features: { valueStars: 1 } },
    { id: "tile12", kind: "land", hexes: [{ q: 3, r: 2 }], features: { shellable: true } },
    {
      id: "tile13", kind: "land", hexes: [{ q: 4, r: 2 }],
      features: { hq: "black", harbor: true }, ports: ["tile17", "tile18"]
    },
    { id: "tile14", kind: "sea", hexes: [{ q: 0, r: 5 }, { q: 0, r: 6 }], features: {} },
    { id: "tile15", kind: "sea", hexes: [{ q: 1, r: 4 }], features: { valueStars: 1 } },
    {
      id: "tile16", kind: "land", hexes: [{ q: 2, r: 4 }],
      features: { valueStars: 2, harbor: true }, ports: ["tile11", "tile15", "tile17"]
    },
    { id: "tile17", kind: "sea", hexes: [{ q: 3, r: 3 }], features: { valueStars: 1 } },
    { id: "tile18", kind: "sea", hexes: [{ q: 4, r: 3 }, { q: 4, r: 4 }], features: {} },
    { id: "tile19", kind: "land", hexes: [{ q: 1, r: 5 }], features: { shellable: true } },
    { id: "tile20", kind: "land", hexes: [{ q: 2, r: 5 }], features: { valueStars: 2 } },
    { id: "tile21", kind: "land", hexes: [{ q: 3, r: 4 }], features: { shellable: true } },
    {
      id: "tile22", kind: "sea",
      hexes: [{ q: 1, r: 6 }, { q: 2, r: 6 }, { q: 3, r: 5 }], features: {}
    }
  ],
  startingDeployment: {
    tile1: { seat: "red", troop: 2 },
    tile9: { seat: "red", troop: 3 },
    tile10: { seat: "red", troop: 2 },
    tile14: { seat: "red", ship: 3 },
    tile19: { seat: "red", troop: 3 },
    tile5: { seat: "black", troop: 2 },
    tile13: { seat: "black", troop: 3 },
    tile12: { seat: "black", troop: 2 },
    tile18: { seat: "black", ship: 3 },
    tile21: { seat: "black", troop: 3 }
  },
  bonusSlots: ["tile2", "tile4", "tile20"]
};
```

- [ ] **Step 3: Write the equivalence + validity test**

Create `packages/engine/test/maps/riversSource.test.ts`:

```typescript
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { riversSource } from "../../src/maps/riversSource.js";
import { compileHexMap } from "../../src/maps/hex/compile.js";
import { validateHexMap } from "../../src/maps/hex/validate.js";

// Read the frozen oracle via fs so the test does not depend on JSON-import config.
const snapshot = JSON.parse(
  readFileSync(fileURLToPath(new URL("./riversMap.snapshot.json", import.meta.url)), "utf8")
);

describe("riversSource compiles to the canonical Rivers topology", () => {
  it("passes hex-map validation", () => {
    expect(() => validateHexMap(riversSource)).not.toThrow();
  });

  it("compiles to areas deep-equal to the frozen snapshot", () => {
    const { definition } = compileHexMap(riversSource);
    expect(definition.areas).toEqual(snapshot);
  });

  it("preserves id, name, bonus slots, and starting deployment", () => {
    const { definition } = compileHexMap(riversSource);
    expect(definition.id).toBe("rivers");
    expect(definition.name).toBe("Rivers");
    expect(definition.bonusSlots).toEqual(["tile2", "tile4", "tile20"]);
    expect(definition.startingDeployment?.tile14).toEqual({ seat: "red", ship: 3 });
    expect(definition.startingDeployment?.tile18).toEqual({ seat: "black", ship: 3 });
  });
});
```

- [ ] **Step 4: Run the test against the still-hand-authored map**

```bash
pnpm --filter @sengoku-jidai/engine test -- riversSource
```
Expected: PASS. If `compiles to areas deep-equal` FAILS, the diff names the offending tile — fix its `hexes` in `riversSource.ts` and re-run. Do not edit the snapshot.

- [ ] **Step 5: Replace `riversMap` with the compiled source**

In `packages/engine/src/maps/riversMap.ts`, keep the type definitions (`AreaKind`, `MapArea`, `MapDefinition`, `StartingUnits`, `riversMapId`) and remove the `area()` helper + `areaList` array. Replace the `riversMap` export:

```typescript
import { compileHexMap } from "./hex/compile.js";
import { riversSource } from "./riversSource.js";

// ... (keep all interface/type declarations and `export const riversMapId = "rivers";`)

/** Runtime Rivers definition, compiled from the hex source (adjacency auto-derived
 *  from shared hex edges). Topology equivalence is locked by riversSource.test.ts. */
export const riversMap: MapDefinition = compileHexMap(riversSource).definition;
```

Note: `riversSource.ts` imports types from `./hex/source.js`, which imports `StartingUnits` from `./riversMap.js` — this is fine (type-only import cycle, erased at runtime). The value import `compileHexMap` in `riversMap.ts` does not cycle through `riversSource`'s runtime needs.

- [ ] **Step 6: Export the source and rebuild**

Add to `packages/engine/src/index.ts` after the `riversMap` export line:

```typescript
export * from "./maps/riversSource.js";
```

- [ ] **Step 7: Run the full engine suite**

```bash
pnpm --filter @sengoku-jidai/engine build && pnpm --filter @sengoku-jidai/engine test
```
Expected: PASS — including `riversMap.test.ts` (now validating the compiled map) and `game.test.ts` (determinism anchor unchanged, since `startingDeployment` values match the former `RIVERS_STARTING_UNITS` fallback).

- [ ] **Step 8: Commit**

```bash
git add packages/engine/src/maps/riversSource.ts packages/engine/src/maps/riversMap.ts \
  packages/engine/src/index.ts packages/engine/test/maps/riversSource.test.ts \
  packages/engine/test/maps/riversMap.snapshot.json
git commit -m "feat(maps): author Rivers as a hex source compiled to the canonical topology

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 2: Add bonus glyphs to board-render (assets + scene + assemble)

**Files:**
- Modify: `packages/board-render/src/assets.ts` (3 new glyph symbols + `GlyphId` union + `bonusGlyph()` helper)
- Modify: `packages/board-render/src/scene.ts` (bonus on `SceneTile`, anchor, derive from `bonusSlots`)
- Modify: `packages/board-render/src/assemble.ts` (render bonus glyph)
- Test: `packages/board-render/test/scene.test.ts` and the committed snapshot test (locate with `ls packages/board-render/test`)

**Interfaces:**
- Consumes: `compiled.definition.bonusSlots: string[]`, `ASSETS.place`, existing `SceneTile`.
- Produces: `bonusGlyph(index: number): GlyphId`; `SceneTile.glyphAnchors.bonus?: Pixel`; `SceneTile.bonusGlyph?: GlyphId`.

- [ ] **Step 1: Read the three bonus glyph defs from board.svg**

The bonus icons are `<g>` defs referenced by `sunbonus-tile2`→`#g73`, `moonbonus-tile4`→`#g74`, `starbonus-tile20`→`#g75`. Extract each group's inner geometry verbatim:

```bash
cd /mnt/ssd_pool/martin/repos/sengoku_jidai
python3 - <<'EOF'
import re
s=open('assets/maps/rivers/board.svg').read()
for gid in ["g73","g74","g75"]:
    m=re.search(r'<g\b[^>]*\bid="%s"[^>]*>(.*?)</g>'%gid, s, re.S)
    print(f"### {gid}\n{m.group(1).strip()[:1500]}\n")
EOF
```

Follow the SP2 pattern already in `assets.ts`: wrap each in a `symbol(id, viewBox, 40, 40, inner)` whose inner content is translated so the visual centre sits at `(0,0)` in a 40×40 box (compute the group's bbox centre from its coordinates and prepend a `<g transform="translate(-cx -cy) scale(s)">` to fit ~40 units, matching how `STAR`/`HARBOR` were normalized). Name them `glyph-bonus-sun`, `glyph-bonus-moon`, `glyph-bonus-star`.

- [ ] **Step 2: Extend the `GlyphId` union and `SYMBOLS`, add `bonusGlyph()`**

In `assets.ts`, add the three ids to the `GlyphId` union, append the new symbols to the `SYMBOLS` join array, and add:

```typescript
const BONUS_GLYPHS: GlyphId[] = ["glyph-bonus-sun", "glyph-bonus-moon", "glyph-bonus-star"];

/** Cosmetic bonus marker for the Nth bonus slot (cycles for maps with >3 slots).
 *  The real bonus is drawn randomly at setup; the icon is flavour only. */
export function bonusGlyph(index: number): GlyphId {
  return BONUS_GLYPHS[index % BONUS_GLYPHS.length]!;
}
```

- [ ] **Step 3: Write the failing scene test**

Add to `packages/board-render/test/scene.test.ts` (import `buildScene` and a compiled fixture; the file already builds the SP1 `FIXTURE_HEX_MAP` — its `bonusSlots` is `["B"]`):

```typescript
// `scene` is the module-level `buildScene(compileHexMap(FIXTURE_HEX_MAP))`
// already defined at the top of scene.test.ts; FIXTURE_HEX_MAP.bonusSlots === ["B"].
it("places a bonus glyph on each bonus-slot tile, by slot order", () => {
  const b = scene.tiles.find((t) => t.id === "B")!;
  expect(b.bonusGlyph).toBe("glyph-bonus-sun");
  expect(b.glyphAnchors.bonus).toBeDefined();
  const a = scene.tiles.find((t) => t.id === "A")!;
  expect(a.bonusGlyph).toBeUndefined();
});
```

- [ ] **Step 4: Run it to confirm it fails**

```bash
pnpm --filter @sengoku-jidai/board-render test -- scene
```
Expected: FAIL (`bonusGlyph` is undefined on the type / at runtime).

- [ ] **Step 5: Implement bonus in `scene.ts`**

Extend `SceneTile`:

```typescript
export interface SceneTile {
  // ...existing fields...
  glyphAnchors: { hq?: Pixel; stars?: Pixel; harbor?: Pixel; bonus?: Pixel };
  bonusGlyph?: GlyphId;
}
```

Import `bonusGlyph` and `type GlyphId` from `./assets.js`. In `buildScene`, before the first pass, build the slot-index map:

```typescript
const bonusIndex = new Map<string, number>();
compiled.definition.bonusSlots.forEach((id, i) => bonusIndex.set(id, i));
```

In the first-pass tile push, add bonus anchor + glyph (offset to the lower-left so it clears the star anchor above and the harbor anchor below):

```typescript
const bonusSlot = bonusIndex.get(area.id);
// ...inside the pushed object:
glyphAnchors: {
  hq: area.hq ? centroid : undefined,
  stars: area.valueStars > 0 ? { x: centroid.x, y: centroid.y - layout.size * 0.4 } : undefined,
  harbor: area.harbor ? { x: centroid.x, y: centroid.y + layout.size * 0.4 } : undefined,
  bonus: bonusSlot !== undefined ? { x: centroid.x - layout.size * 0.45, y: centroid.y + layout.size * 0.25 } : undefined
},
bonusGlyph: bonusSlot !== undefined ? bonusGlyph(bonusSlot) : undefined,
```

- [ ] **Step 6: Render bonus in `assemble.ts`**

In `featureGlyphs`, after the harbor block:

```typescript
if (tile.bonusGlyph && tile.glyphAnchors.bonus) {
  out.push(ASSETS.place(tile.bonusGlyph, tile.glyphAnchors.bonus));
}
```

- [ ] **Step 7: Run scene test + update the assemble snapshot**

```bash
pnpm --filter @sengoku-jidai/board-render test
```
Expected: scene test PASSES. The committed assemble/SVG snapshot test will FAIL (new bonus `<use>` in output) — inspect the diff to confirm only the expected bonus glyph was added, then update it:

```bash
pnpm --filter @sengoku-jidai/board-render test -- -u
pnpm --filter @sengoku-jidai/board-render test
```
Expected: all PASS.

- [ ] **Step 8: Commit**

```bash
git add packages/board-render/src/assets.ts packages/board-render/src/scene.ts \
  packages/board-render/src/assemble.ts packages/board-render/test
git commit -m "feat(board-render): bonus-slot glyphs (sun/moon/star)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 3: Swap the web board to the procedural renderer

**Files:**
- Modify: `packages/web/src/components/board/MapBoard.tsx`
- Check: `packages/web/test/board/*.test.ts` (no SVG-injection assumptions to update beyond MapBoard)

**Interfaces:**
- Consumes: `riversSource`, `compileHexMap` (engine); `buildScene`, `assembleBoardSvg` (board-render). Confirm `@sengoku-jidai/board-render` is a dependency of `packages/web` — if absent, add it (`"@sengoku-jidai/board-render": "workspace:*"`) and run `corepack pnpm install`, then `corepack pnpm exec prettier --write pnpm-lock.yaml` (see cross-package gotcha: install rewrites the lockfile quote style and breaks `prettier --check`).
- Produces: a `MapBoard` that injects the procedural SVG and decorates it; data hooks (`data-source`, `data-legal-target`) unchanged so e2e still passes.

- [ ] **Step 1: Build the SVG from the compiled source instead of board.svg**

Replace the `board.svg?raw` import and the `host.innerHTML = rawMapSvg` injection. At module top:

```typescript
import { compileHexMap, riversSource } from "@sengoku-jidai/engine";
import { assembleBoardSvg, buildScene } from "@sengoku-jidai/board-render";

const RIVERS_SVG = assembleBoardSvg(buildScene(compileHexMap(riversSource)));
```

Remove `import rawMapSvg from "../../../../../assets/maps/rivers/board.svg?raw";`. In the inject effect, use `host.innerHTML = RIVERS_SVG;`.

- [ ] **Step 2: Rewrite `prepareSvg` for the procedural contract**

Procedural tiles are `<path class="tile" data-authored-fill=… style="fill:…">`, the stripe patterns live in `<defs>`, and there are no shared tile-geometry defs or example units. Replace `prepareSvg` (and delete the now-dead `captureAuthoredFills`, `TILE_GEOMETRY_DEFS`, `EXAMPLE_UNIT_IDS`, and `STRIPE_PATTERNS` constants):

```typescript
/** One-time prep on the assembled SVG. Procedural tiles already carry their authored fill on
 *  `data-authored-fill` and the stripe patterns ship in <defs>, so this only ensures the
 *  attribute is mirrored onto `dataset.authoredFill` (camelCase) for the decorate pass. */
function prepareSvg(svg: SVGSVGElement): void {
  for (const tile of svg.querySelectorAll<SVGPathElement>("path.tile")) {
    const authored = tile.getAttribute("data-authored-fill");
    if (authored) {
      tile.dataset.authoredFill = authored;
    }
  }
}
```

(`data-authored-fill` already maps to `dataset.authoredFill` automatically; the explicit loop is harmless but keep it minimal — if you prefer, `prepareSvg` can be a no-op since `assembleBoardSvg` emits the attribute directly. Verify `tile.dataset.authoredFill` is populated either way.)

- [ ] **Step 3: Point unit/HQ defs at the semantic ids**

The procedural `<defs>` expose `unit-army-red/black`, `unit-ship-red/black`, `glyph-hq-red/black`. Update:

```typescript
const ARMY_DEF: Record<SeatId, string> = { red: "unit-army-red", black: "unit-army-black" };
const SHIP_DEF: Record<SeatId, string> = { red: "unit-ship-red", black: "unit-ship-black" };
```

Tiles are now `<path>` and `decorate` already sets `tile.style.fill/stroke` per element, so the existing fill/stroke logic works unchanged. Confirm `decorate`'s `svg.querySelector(\`#${area.id}\`)` still resolves (tile paths carry `id="tileN"`).

- [ ] **Step 4: Typecheck and run web unit tests**

```bash
pnpm --filter @sengoku-jidai/web typecheck && pnpm --filter @sengoku-jidai/web test
```
Expected: PASS. If `terrainLayer.test.ts` or others reference removed constants, they shouldn't (those are MapBoard-internal); fix any import breakage surfaced.

- [ ] **Step 5: Commit**

```bash
git add packages/web/src/components/board/MapBoard.tsx packages/web/package.json pnpm-lock.yaml
git commit -m "feat(web): render Rivers via the procedural hex board

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 4: Verify end-to-end and fix unit-stack centring

**Files:**
- Possibly modify: `packages/web/src/components/board/MapBoard.tsx` (`renderUnitStack` bbox)

**Interfaces:** none new.

- [ ] **Step 1: Run the e2e suite**

```bash
pnpm build && pnpm exec playwright test
```
Expected: PASS. The specs select by `[data-source]`/`[data-legal-target]`/`[data-seat]` and role/text, not tile geometry, so they should be robust. If a movement spec fails to find a glowing tile, capture the failure (`playwright-report/`) and debug with systematic-debugging before changing selectors.

- [ ] **Step 2: Verify unit-stack centring with `<symbol>` tokens**

`renderUnitStack` measures `getBBox()` on a `<use>` of a `<symbol>` (40×40 viewport). If unit stacks render off-centre or mis-sized (carry-forward #3 from SP2), the `<use>` bbox is reporting the symbol viewport rather than ink bounds. Fix by giving the probe/token explicit `width`/`height` (40) and computing the centre from those, or by adding `width`/`height` attributes in `makeToken`. Re-run a hotseat game (or the e2e movement spec) and confirm tokens sit centred on tiles. If centring is already correct, make no change and note it.

- [ ] **Step 3: Full gate**

```bash
pnpm typecheck && pnpm test && pnpm build && pnpm lint
pnpm exec prettier --check $(git diff --name-only main... | tr '\n' ' ')
```
Expected: all green. Fix any prettier/lint issues on changed files only (do not `prettier --check .` locally — the untracked `.pnpm-store/` warns; see cross-package gotcha).

- [ ] **Step 4: Confirm board.svg is dormant, not deleted**

```bash
grep -rn "board.svg" packages/web/src packages/engine/src || echo "no live import"
ls assets/maps/rivers/board.svg   # still present (provenance)
```
Expected: no live import; file present. Leave the Dockerfile `COPY` as-is this PR (the file still exists, so the COPY does not break the build).

- [ ] **Step 5: Commit any centring fix and push**

```bash
git add -A && git commit -m "fix(web): centre unit stacks on procedural tiles

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
git push -u origin sp3-rivers-hex-migration
```

- [ ] **Step 6: Open the PR and watch CI**

```bash
gh pr create --fill --base main
gh pr checks --watch
```
Fix any CI failures (common: prettier on touched files, e2e text assertions, the determinism anchor, the Docker build context). Then STOP and ask the user before merging (engine/topology change).

---

## Out of scope / follow-ups

- Delete `assets/maps/rivers/board.svg` + its Dockerfile `COPY` (separate cleanup once confident).
- Remove the now-dead `RIVERS_STARTING_UNITS` fallback in `game.ts`.
- Terrain for Rivers/custom maps (SP6); server map library (SP4); editor UI (SP5).
