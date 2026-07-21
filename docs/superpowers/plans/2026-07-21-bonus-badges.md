# Bonus-Specific Tile Badges Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the cosmetic sun/moon/star bonus-slot markers with bonus-specific lettered badges, drawn at runtime from `view.bonuses`, repositioned to the tile's right corner and enlarged, plus a name + effect line in the area panel.

**Architecture:** `board-render` bakes one *generic* bonus-slot badge per slot (serves the editor / static previews, which have no game), tagged `class="bonus-marker" data-area="<id>"`. In a live game the web's `MapBoard.decorate()` retargets each marker's `<use href>` to the specific badge via `bonusTypeGlyph(bonus)`. Bonus name + effect wording lives in a pure web helper `bonusLabel`.

**Tech Stack:** TypeScript, Vitest (unit), Playwright (browser smoke), React (web), string-based SVG assembly (board-render, DOM-free).

## Global Constraints

- Bonuses are per-game (`state.bonuses` → `view.bonuses`, `Record<areaId, BonusType>`); the per-map baked SVG cannot encode them — specificity is a runtime (`decorate()`) concern.
- `BonusType` = `"barracks" | "warRoom" | "pirateHaven" | "shipyard" | "hiddenBase" | "armoury"` (Rivers uses all but `armoury`). Exported from `@sengoku-jidai/engine/client`.
- **Cross-package dist trap:** the web consumes `@sengoku-jidai/board-render` and `@sengoku-jidai/engine` from their built `dist/`. After changing either, run `corepack pnpm build:libs` before web typecheck / unit tests / e2e.
- Never surface raw tile ids in UI text (bonus *names* are fine; ids are not).
- The retarget pass must be idempotent — `decorate()` re-runs on every prop change and the 3s poll.
- Gate before PR: `corepack pnpm typecheck`, `corepack pnpm test`, `corepack pnpm lint`, `corepack pnpm exec prettier --check .`, plus the Playwright browser smoke.
- `board-render` is DOM-free: it emits SVG strings via `el(tag, attrs, children?)` from `src/svg.js`. Symbols are authored in a 40-unit viewport (`viewBox="-20 -20 40 40"`, content centred at 0,0).

## File Structure

- `packages/board-render/src/assets.ts` — add 6 lettered-badge + 1 generic `<symbol>`; extend `GlyphId`; add `bonusTypeGlyph`; extend `ASSETS.place` with an attrs arg; remove sun/moon/star + `bonusGlyph(index)`.
- `packages/board-render/src/scene.ts` — add `rightmostHex`; move the bonus anchor to the E vertex; emit the generic marker id.
- `packages/board-render/src/assemble.ts` — place the generic marker at the new size, tagged `class="bonus-marker" data-area="<id>"`.
- `packages/board-render/test/{assets,scene,assemble}.test.ts` — cover the mapping, anchor, and baked tag.
- `packages/web/src/components/board/bonusLabel.ts` (+ `.test.ts`) — pure name/effect helper.
- `packages/web/src/components/board/AreaDetails.tsx` — render name + effect.
- `packages/web/src/components/board/MapBoard.tsx` — new `bonuses` prop; retarget pass in `decorate()`.
- `packages/web/src/App.tsx` — pass `view.bonuses` to `<MapBoard>`.
- `tests/e2e/hotseat.spec.ts` — assert a baked marker is retargeted to a specific badge.

---

### Task 1: board-render badge symbols + `bonusTypeGlyph`

**Files:**
- Modify: `packages/board-render/src/assets.ts`
- Test: `packages/board-render/test/assets.test.ts`

**Interfaces:**
- Consumes: `symbol(id, viewBox, w, h, inner)`, `el`, existing `ASSETS`, `GlyphId`, `type BonusType` from `@sengoku-jidai/engine`.
- Produces: `bonusTypeGlyph(bonus: BonusType): GlyphId`; new `GlyphId` members `glyph-bonus-barracks|warroom|pirate|shipyard|hidden|armoury|generic`; `ASSETS.place(glyph, at, scale?, attrs?)` with `attrs: Record<string,string>` merged onto the `<use>`.

- [ ] **Step 1: Write the failing test** — append to `packages/board-render/test/assets.test.ts`:

```ts
import { ASSETS, armyGlyph, hqGlyph, shipGlyph, bonusTypeGlyph } from "../src/assets.js";
import type { BonusType } from "@sengoku-jidai/engine";

describe("bonusTypeGlyph", () => {
  const ALL: BonusType[] = [
    "barracks",
    "warRoom",
    "pirateHaven",
    "shipyard",
    "hiddenBase",
    "armoury"
  ];

  it("maps every bonus type to a distinct badge symbol that exists in defs", () => {
    const ids = ALL.map(bonusTypeGlyph);
    expect(new Set(ids).size).toBe(ALL.length);
    for (const id of ids) {
      expect(ASSETS.defs).toContain(`id="${id}"`);
    }
  });

  it("bakes a generic marker symbol for game-less contexts", () => {
    expect(ASSETS.defs).toContain(`id="glyph-bonus-generic"`);
  });
});
```

(Replace the existing top `import { ASSETS, armyGlyph, hqGlyph, shipGlyph } from "../src/assets.js";` line with the combined import above, or add `bonusTypeGlyph` to it.)

- [ ] **Step 2: Run test to verify it fails**

Run: `corepack pnpm --filter @sengoku-jidai/board-render test -- assets`
Expected: FAIL — `bonusTypeGlyph` is not exported.

- [ ] **Step 3: Implement in `packages/board-render/src/assets.ts`**

Add `BonusType` to the engine import at the top:

```ts
import type { Pixel, SeatId, BonusType } from "@sengoku-jidai/engine";
```

In the `GlyphId` union, **remove**:

```ts
  | "glyph-bonus-sun"
  | "glyph-bonus-moon"
  | "glyph-bonus-star";
```

and replace with:

```ts
  | "glyph-bonus-barracks"
  | "glyph-bonus-warroom"
  | "glyph-bonus-pirate"
  | "glyph-bonus-shipyard"
  | "glyph-bonus-hidden"
  | "glyph-bonus-armoury"
  | "glyph-bonus-generic";
```

Delete the old `BONUS_SUN`, `BONUS_MOON`, `BONUS_STAR` const definitions and the
`BONUS_GLYPHS` array + `bonusGlyph(index)` function. Add, near the other glyph defs:

```ts
// Placeholder bonus badge: a washi disc with a single sumi letter. Final per-bonus art
// replaces the inner content later; the id↔bonus mapping (bonusTypeGlyph) stays fixed.
function letterBadge(id: string, letter: string): string {
  return symbol(
    id,
    "-20 -20 40 40",
    40,
    40,
    `<circle r="17" fill="#f4ecd8" stroke="#20242b" stroke-width="2.5"/>` +
      `<text x="0" y="1" text-anchor="middle" dominant-baseline="central" ` +
      `font-family="Georgia, 'Times New Roman', serif" font-size="22" font-weight="700" ` +
      `fill="#20242b">${letter}</text>`
  );
}

const BONUS_BARRACKS = letterBadge("glyph-bonus-barracks", "B");
const BONUS_WARROOM = letterBadge("glyph-bonus-warroom", "W");
const BONUS_PIRATE = letterBadge("glyph-bonus-pirate", "P");
const BONUS_SHIPYARD = letterBadge("glyph-bonus-shipyard", "S");
const BONUS_HIDDEN = letterBadge("glyph-bonus-hidden", "H");
const BONUS_ARMOURY = letterBadge("glyph-bonus-armoury", "A");

// Generic "a bonus sits here" marker for contexts with no assigned bonus (map editor,
// static previews): the same washi disc with a small filled sumi dot.
const BONUS_GENERIC = symbol(
  "glyph-bonus-generic",
  "-20 -20 40 40",
  40,
  40,
  `<circle r="17" fill="#f4ecd8" stroke="#20242b" stroke-width="2.5"/>` +
    `<circle r="6" fill="#20242b"/>`
);
```

In the `SYMBOLS` array, replace the three `BONUS_SUN, BONUS_MOON, BONUS_STAR` entries with:

```ts
  BONUS_BARRACKS,
  BONUS_WARROOM,
  BONUS_PIRATE,
  BONUS_SHIPYARD,
  BONUS_HIDDEN,
  BONUS_ARMOURY,
  BONUS_GENERIC
```

Extend `ASSETS.place` to accept extra attributes:

```ts
  place(glyph: GlyphId, at: Pixel, scale = 1, attrs: Record<string, string> = {}): string {
    const transform = `translate(${at.x} ${at.y}) scale(${scale}) translate(-20 -20)`;
    return el("use", { href: `#${glyph}`, "xlink:href": `#${glyph}`, transform, ...attrs });
  }
```

Add the mapping near `hqGlyph`:

```ts
const BONUS_TYPE_GLYPHS: Record<BonusType, GlyphId> = {
  barracks: "glyph-bonus-barracks",
  warRoom: "glyph-bonus-warroom",
  pirateHaven: "glyph-bonus-pirate",
  shipyard: "glyph-bonus-shipyard",
  hiddenBase: "glyph-bonus-hidden",
  armoury: "glyph-bonus-armoury"
};

/** The badge glyph for a specific assigned bonus. */
export function bonusTypeGlyph(bonus: BonusType): GlyphId {
  return BONUS_TYPE_GLYPHS[bonus];
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `corepack pnpm --filter @sengoku-jidai/board-render test -- assets`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/board-render/src/assets.ts packages/board-render/test/assets.test.ts
git commit -m "feat(board-render): bonus-specific lettered badge glyphs + bonusTypeGlyph"
```

---

### Task 2: Reposition + enlarge the badge; bake it tagged

**Files:**
- Modify: `packages/board-render/src/scene.ts`
- Modify: `packages/board-render/src/assemble.ts`
- Test: `packages/board-render/test/scene.test.ts`, `packages/board-render/test/assemble.test.ts`

**Interfaces:**
- Consumes: `bonusTypeGlyph`, `ASSETS.place(..., attrs)`, `GlyphId` (Task 1); `axialToPixel`, `HexLayout`, `Axial`, `Pixel`, `layout.size`.
- Produces: `SceneTile.bonusGlyph === "glyph-bonus-generic"` for slots; `SceneTile.glyphAnchors.bonus` at the E vertex; assembled `<use class="bonus-marker" data-area="<id>" href="#glyph-bonus-generic">`.

- [ ] **Step 1: Update the failing scene test** — replace the existing `it("places a bonus glyph on each bonus-slot tile, by slot order", …)` block (around lines 114–120) in `packages/board-render/test/scene.test.ts` with:

```ts
  it("marks each bonus-slot tile with the generic badge at its right corner", () => {
    const b = byId("B");
    expect(b.bonusGlyph).toBe("glyph-bonus-generic");
    expect(b.glyphAnchors.bonus).toBeDefined();
    // Anchored to the right of the tile centroid — the E-vertex corner.
    expect(b.glyphAnchors.bonus!.x).toBeGreaterThan(b.centroid.x);
    expect(byId("A").bonusGlyph).toBeUndefined();
  });
```

- [ ] **Step 2: Run to verify it fails**

Run: `corepack pnpm --filter @sengoku-jidai/board-render test -- scene`
Expected: FAIL — `bonusGlyph` is still `"glyph-bonus-sun"`.

- [ ] **Step 3: Implement in `packages/board-render/src/scene.ts`**

Change the assets import (drop `bonusGlyph`, keep the rest):

```ts
import { NATIVE_HEX_SIZE, ORDER_TOKEN_RADIUS, type GlyphId } from "./assets.js";
```

Add a helper next to `bottommostHex`:

```ts
/** Rightmost hex centre of a tile; topmost on ties (for the E-corner bonus badge). */
function rightmostHex(hexes: Axial[], layout: HexLayout): Pixel {
  return hexes
    .map((h) => axialToPixel(h, layout))
    .reduce((a, b) => (b.x > a.x + 0.01 || (Math.abs(b.x - a.x) <= 0.01 && b.y < a.y) ? b : a));
}
```

In `buildScene`, replace the `bonus:` anchor and `bonusGlyph:` lines:

```ts
        bonus:
          bonusSlot !== undefined
            ? (() => {
                const hex = rightmostHex(hexes, layout);
                return { x: hex.x + 0.72 * layout.size, y: hex.y };
              })()
            : undefined
      },
      bonusGlyph: bonusSlot !== undefined ? ("glyph-bonus-generic" as GlyphId) : undefined,
```

(The `as GlyphId` is only needed if TS infers a plain string; drop it if the field type already narrows.)

- [ ] **Step 4: Run scene test to verify it passes**

Run: `corepack pnpm --filter @sengoku-jidai/board-render test -- scene`
Expected: PASS.

- [ ] **Step 5: Update the assemble test** — add to `packages/board-render/test/assemble.test.ts` inside the `describe`:

```ts
  it("bakes a generic bonus marker on each slot tile, tagged for runtime retargeting", () => {
    expect(svg).toContain(`class="bonus-marker" data-area="B"`);
    expect(svg).toContain(`href="#glyph-bonus-generic"`);
  });
```

- [ ] **Step 6: Run to verify it fails**

Run: `corepack pnpm --filter @sengoku-jidai/board-render test -- assemble`
Expected: FAIL — the marker is untagged (still an untagged sun `<use>`).

- [ ] **Step 7: Implement in `packages/board-render/src/assemble.ts`**

Add a sizing constant near the top of the file (after the imports):

```ts
/** Bonus badge diameter as a fraction of hex size (2× the old apparent size, hex-relative). */
const BONUS_BADGE_FRACTION = 0.72;
```

Replace the bonus block in `featureGlyphs`:

```ts
  if (tile.bonusGlyph && tile.glyphAnchors.bonus) {
    const badgeScale = (hexSize * BONUS_BADGE_FRACTION) / 40;
    out.push(
      ASSETS.place(tile.bonusGlyph, tile.glyphAnchors.bonus, badgeScale, {
        class: "bonus-marker",
        "data-area": tile.id
      })
    );
  }
```

- [ ] **Step 8: Run to verify it passes + full package suite**

Run: `corepack pnpm --filter @sengoku-jidai/board-render test`
Expected: PASS (all board-render tests, including snapshot tests — if a snapshot for the assembled SVG exists and legitimately changed, update it with `-- -u` and eyeball the diff: it should only touch bonus `<use>` elements).

- [ ] **Step 9: Commit**

```bash
git add packages/board-render/src/scene.ts packages/board-render/src/assemble.ts \
        packages/board-render/test/scene.test.ts packages/board-render/test/assemble.test.ts
git commit -m "feat(board-render): seat the bonus badge in the right corner, enlarge, tag for retargeting"
```

---

### Task 3: Area panel — bonus name + effect

**Files:**
- Create: `packages/web/src/components/board/bonusLabel.ts`
- Create: `packages/web/src/components/board/bonusLabel.test.ts`
- Modify: `packages/web/src/components/board/AreaDetails.tsx:44`

**Interfaces:**
- Consumes: `type BonusType` from `@sengoku-jidai/engine/client`.
- Produces: `bonusLabel(bonus: BonusType): { name: string; effect: string }`.

- [ ] **Step 1: Rebuild libs so the web sees any engine changes**

Run: `corepack pnpm build:libs`
Expected: builds engine, shared, board-render, terrain with no errors.

- [ ] **Step 2: Write the failing test** — `packages/web/src/components/board/bonusLabel.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { BonusType } from "@sengoku-jidai/engine/client";
import { bonusLabel } from "./bonusLabel.js";

const ALL: BonusType[] = [
  "barracks",
  "warRoom",
  "pirateHaven",
  "shipyard",
  "hiddenBase",
  "armoury"
];

describe("bonusLabel", () => {
  it("returns a non-empty name and effect for every bonus type", () => {
    for (const b of ALL) {
      const label = bonusLabel(b);
      expect(label.name.length).toBeGreaterThan(0);
      expect(label.effect.length).toBeGreaterThan(0);
    }
  });

  it("names shipyard with its sail effect", () => {
    expect(bonusLabel("shipyard")).toEqual({
      name: "Shipyard",
      effect: "+1 ship when you Sail"
    });
  });
});
```

- [ ] **Step 3: Run to verify it fails**

Run: `corepack pnpm --filter @sengoku-jidai/web test -- bonusLabel`
Expected: FAIL — module not found.

- [ ] **Step 4: Implement `packages/web/src/components/board/bonusLabel.ts`**

```ts
import type { BonusType } from "@sengoku-jidai/engine/client";

export interface BonusLabel {
  name: string;
  effect: string;
}

/** Human-readable name + short effect for each bonus, for the area detail panel. Effects are
 *  the rules as implemented in engine/src/actions.ts. */
const LABELS: Record<BonusType, BonusLabel> = {
  barracks: { name: "Barracks", effect: "+2 troops when you Reinforce" },
  warRoom: { name: "War Room", effect: "+1 card when you Plan" },
  pirateHaven: { name: "Pirate Haven", effect: "+1 die when you Bombard" },
  shipyard: { name: "Shipyard", effect: "+1 ship when you Sail" },
  hiddenBase: { name: "Hidden Base", effect: "+1 troop when you Advance" },
  armoury: { name: "Armoury", effect: "Siege only" }
};

export function bonusLabel(bonus: BonusType): BonusLabel {
  return LABELS[bonus];
}
```

- [ ] **Step 5: Run to verify it passes**

Run: `corepack pnpm --filter @sengoku-jidai/web test -- bonusLabel`
Expected: PASS.

- [ ] **Step 6: Wire into `AreaDetails.tsx`**

Add the import after the existing type import:

```tsx
import { bonusLabel } from "./bonusLabel.js";
```

Replace the bonus `<li>` (line 44):

```tsx
        {bonus ? (
          <li>
            Bonus: {bonusLabel(bonus).name} — {bonusLabel(bonus).effect}
          </li>
        ) : null}
```

- [ ] **Step 7: Verify web typecheck + tests pass**

Run: `corepack pnpm --filter @sengoku-jidai/web test && corepack pnpm --filter @sengoku-jidai/web typecheck`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add packages/web/src/components/board/bonusLabel.ts \
        packages/web/src/components/board/bonusLabel.test.ts \
        packages/web/src/components/board/AreaDetails.tsx
git commit -m "feat(web): show bonus name + effect in the area detail panel"
```

---

### Task 4: Runtime badge retargeting on the board

**Files:**
- Modify: `packages/web/src/components/board/MapBoard.tsx`
- Modify: `packages/web/src/App.tsx:901` (the `<MapBoard>` mount)
- Test: `tests/e2e/hotseat.spec.ts`

**Interfaces:**
- Consumes: `bonusTypeGlyph` from `@sengoku-jidai/board-render`; `type BonusType` from `@sengoku-jidai/engine/client`; `view.bonuses`.
- Produces: on-board `.bonus-marker` `<use>` elements whose `href`/`xlink:href` point at the assigned bonus badge in a live game.

- [ ] **Step 1: Add the prop + import in `MapBoard.tsx`**

Extend the engine import:

```ts
import type { PlayerAreaView, SeatId, BonusType } from "@sengoku-jidai/engine/client";
```

Add to the board-render import:

```ts
import { terrainImageAttrs, bonusTypeGlyph } from "@sengoku-jidai/board-render";
```

Add to `MapBoardProps` (after `terrainUrl`):

```ts
  /** The game's per-slot bonus assignment (`view.bonuses`); retargets each baked generic
   *  bonus marker to its specific badge. Absent (editor/preview) leaves markers generic. */
  bonuses?: Record<string, BonusType>;
```

Add the same field to `interface DecorateInput` (after `hasTerrain?`):

```ts
  bonuses?: Record<string, BonusType>;
```

- [ ] **Step 2: Retarget inside `decorate()`** — add `bonuses` to the destructured params, and add this block at the end of `decorate` (after the selection-outline block):

```ts
  // Bonus badges are baked generic; in a live game we know the assignment, so retarget each
  // marker's <use> to the specific badge. Idempotent — safe under re-decoration + the 3s poll.
  if (bonuses) {
    for (const marker of svg.querySelectorAll<SVGUseElement>(".bonus-marker")) {
      const areaId = marker.dataset.area;
      const bonus = areaId ? bonuses[areaId] : undefined;
      if (!bonus) {
        continue;
      }
      const href = `#${bonusTypeGlyph(bonus)}`;
      marker.setAttribute("href", href);
      marker.setAttributeNS(XLINK_NS, "xlink:href", href);
    }
  }
```

- [ ] **Step 3: Thread the prop through the component** — in the `MapBoard({...})` destructure add `bonuses`; in the decorate-effect's `decorate(svg, { … })` object add `bonuses`; add `bonuses` to that effect's dependency array.

- [ ] **Step 4: Pass it from `App.tsx`** — add to the `<MapBoard>` mount (after `terrainUrl={terrain.terrainUrl}`):

```tsx
            bonuses={game.view.bonuses}
```

- [ ] **Step 5: Rebuild libs + typecheck the web**

Run: `corepack pnpm build:libs && corepack pnpm --filter @sengoku-jidai/web typecheck`
Expected: PASS (board-render must be rebuilt so the web sees the new `bonusTypeGlyph` export).

- [ ] **Step 6: Add the e2e assertion** — in `tests/e2e/hotseat.spec.ts`, after the board + Round 1 assertions (near line 9), add:

```ts
  // Bonus badges are baked generic then retargeted at runtime to the assigned bonus (#8 follow-up).
  await expect(page.locator(".bonus-marker").first()).toHaveAttribute(
    "href",
    /glyph-bonus-(barracks|warroom|pirate|shipyard|hidden)/
  );
```

- [ ] **Step 7: Commit**

```bash
git add packages/web/src/components/board/MapBoard.tsx packages/web/src/App.tsx tests/e2e/hotseat.spec.ts
git commit -m "feat(web): retarget bonus badges to the assigned bonus at runtime"
```

---

### Task 5: Visual verification + full gate

**Files:** none (throwaway harness + gate only).

- [ ] **Step 1: Visual-verify size + right-corner placement** — write a throwaway vitest in `packages/board-render/test/` that emits `assembleBoardSvg(buildScene(compileHexMap(riversSource)))` (import `riversSource` from `@sengoku-jidai/engine`) into an HTML file, render it to PNG with the Chromium harness, and Read the PNG:

```
LD_LIBRARY_PATH=$HOME/.local/chromium-deps/lib node ~/.local/bin/svgshot.mjs x.html x.png
```

Confirm: the three Rivers slots (`tile2`, `tile4`, `tile20`) show a legible disc in the tile's **right corner**, larger than before, not colliding with the SE value-star or the NW/NE order tokens. Tune `BONUS_BADGE_FRACTION` (assemble.ts) or the `0.72` anchor factor (scene.ts) if needed, then re-run Task 2's tests. **Delete the throwaway test afterward.**

- [ ] **Step 2: Full gate**

Run:
```
corepack pnpm build:libs
corepack pnpm typecheck
corepack pnpm test
corepack pnpm lint
corepack pnpm exec prettier --check .
```
Expected: all PASS. (e2e runs in CI — do not run Playwright locally; the config's port 18081 is the live prod container.)

- [ ] **Step 3: Push + open PR on a fresh branch**

```bash
git push -u origin feat/bonus-badges
gh pr create --title "feat(web): bonus-specific tile badges" --body "…"
```

Watch CI (7 checks incl. Browser Smoke), then stop for Martin's eyeball + merge (ask-before-merge).

---

## Self-Review

**Spec coverage:**
- Runtime rendering from `view.bonuses` → Task 4. ✓
- Bake generic + retarget → Tasks 2 (bake tagged) + 4 (retarget). ✓
- Lettered badges per BonusType + `bonusTypeGlyph` → Task 1. ✓
- Reposition (right corner) + enlarge → Task 2. ✓
- Area panel name + effect via `bonusLabel` → Task 3. ✓
- Tests: unit (`bonusTypeGlyph`, `bonusLabel`, scene, assemble), visual harness, e2e → Tasks 1–5. ✓
- Remove sun/moon/star + `bonusGlyph(index)` → Task 1. ✓

**Placeholder scan:** none — every step has concrete code/commands. The PR body `"…"` in Task 5 is filled at PR time (a UI action, not code).

**Type consistency:** `bonusTypeGlyph(bonus: BonusType): GlyphId`, `ASSETS.place(glyph, at, scale?, attrs?)`, `SceneTile.bonusGlyph: GlyphId`, `bonusLabel(bonus: BonusType): { name; effect }`, `MapBoardProps.bonuses?: Record<string, BonusType>` — used identically across tasks. Glyph ids (`glyph-bonus-warroom`, `-pirate`, `-hidden`, `-generic`) are consistent between the defs (Task 1), the mapping (Task 1), the scene literal (Task 2), and the e2e regex (Task 4).

## Notes / branch

Start from a fresh branch off `main` (`feat/bonus-badges`) — the current session's `feat/web-tile-hover` (PR #99) is a separate change awaiting merge. The committed spec + this plan live on `feat/web-tile-hover`; cherry-pick or re-commit them onto the new branch, or branch after #99 merges.
