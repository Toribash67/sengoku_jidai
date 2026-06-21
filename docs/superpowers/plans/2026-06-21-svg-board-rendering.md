# SVG Board Rendering Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the placeholder card-grid board with the canonical `cloned_map.svg`, rendered inline, with owner/supply tinting, click-to-select highlight, unit counts, and action-space occupancy markers — read-only (no order composition beyond the existing Pass).

**Architecture:** A new `MapBoard` React component injects the repo-root `cloned_map.svg` as raw markup, runs a one-time DOM prep (neutralize the shared tile geometry defs so per-tile fill/stroke works, inject stripe `<pattern>`s), then decorates each `tile1…tile22` element on every state change (fill via a pure `tileFill` helper, selection stroke, click handler) and rebuilds a top-level overlay `<g>` with unit-count `<text>` and occupancy `<circle>`s positioned via `getBBox()` + `getCTM()`. No engine/server/shared changes — it consumes the existing `PlayerGameView`.

**Tech Stack:** React 19, TypeScript, Vite 6 (`?raw` import), Vitest (pure-helper unit tests), Playwright (e2e smoke). Spec: `docs/superpowers/specs/2026-06-21-svg-board-rendering-design.md`.

**Key SVG facts (verified against `cloned_map.svg`):**
- Tiles are `<use id="tileN">` elements referencing five shared geometry defs: `path9`, `path9-2`, `path9-2-2`, `path9-5`, `path9-5-0`. Those defs live inside `<g id="layer1" style="display:none">` — **layer1 must NOT be removed.**
- The defs carry inline `fill`/`stroke`, which by SVG cascade win over a `fill` set on the `<use>`. Prep sets the defs' `fill`/`stroke`/`stroke-width` to `inherit` so each tile `<use>`'s own inline style drives its appearance.
- There is an empty `<defs id="defs1"/>` for injecting stripe patterns.
- On-map order slots are `<g id="order-move|order-sail|order-bombard|order-shell">` containing per-tile slots ided `move-tileN`, `sail-tileN`, `bombard-tileN`, `shell-tileN`. Engine action type `advance` maps to SVG prefix `move`.
- Engine action-space ids: `advance-tileN`, `sail-tileN`, `bombard-tileN`, `shell-tileN` (linked); `reinforce-a/b`, `embark-a/b`, `plan-a/b` (support, no board slot).

---

## File structure

- Create `packages/web/src/components/board/tileFill.ts` — pure fill-decision helper + colour constants.
- Create `packages/web/src/components/board/slotMapping.ts` — pure action-space-id → SVG slot-id helper.
- Create `packages/web/src/components/board/MapBoard.tsx` — the inline-SVG board component.
- Create `packages/web/test/board/tileFill.test.ts` — unit tests for `tileFill`.
- Create `packages/web/test/board/slotMapping.test.ts` — unit tests for `slotIdForSpace`.
- Modify `packages/web/tsconfig.json` — add `test/**/*.ts` to `include`.
- Modify `packages/web/vite.config.ts` — allow serving the repo-root SVG.
- Modify `packages/web/src/App.tsx` — swap `<Board>` for `<MapBoard>`, pass `actionSpaces`.
- Modify `packages/web/src/styles/app.css` — add map styles, remove dead card-grid styles.
- Delete `packages/web/src/components/board/Board.tsx`.
- Modify `tests/e2e/hotseat.spec.ts` — assert inline map renders + click-selects a tile.

---

## Task 1: Pure `tileFill` helper

**Files:**
- Create: `packages/web/src/components/board/tileFill.ts`
- Test: `packages/web/test/board/tileFill.test.ts`
- Modify: `packages/web/tsconfig.json`

- [ ] **Step 1: Add `test/**` to the web tsconfig include**

Modify `packages/web/tsconfig.json` — change the `include` line to:

```json
  "include": ["src/**/*.ts", "src/**/*.tsx", "test/**/*.ts", "vite.config.ts"]
```

- [ ] **Step 2: Write the failing test**

Create `packages/web/test/board/tileFill.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  SEAT_SOLID,
  TILE_LAND_FILL,
  TILE_SEA_FILL,
  tileFill
} from "../../src/components/board/tileFill.js";

describe("tileFill", () => {
  it("uses the solid seat colour when controlled and supplied", () => {
    expect(tileFill({ kind: "land", owner: "red", suppliedBy: "red" })).toBe(SEAT_SOLID.red);
    expect(tileFill({ kind: "sea", owner: "black", suppliedBy: "black" })).toBe(SEAT_SOLID.black);
  });

  it("uses the stripe pattern when controlled but out of supply", () => {
    expect(tileFill({ kind: "land", owner: "black", suppliedBy: null })).toBe("url(#stripe-black)");
  });

  it("uses the owner's stripe even if supplied by the enemy", () => {
    expect(tileFill({ kind: "land", owner: "red", suppliedBy: "black" })).toBe("url(#stripe-red)");
  });

  it("uses the kind default colour when unowned", () => {
    expect(tileFill({ kind: "land", owner: null, suppliedBy: null })).toBe(TILE_LAND_FILL);
    expect(tileFill({ kind: "sea", owner: null, suppliedBy: null })).toBe(TILE_SEA_FILL);
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `corepack pnpm --filter @sengoku-jidai/web test`
Expected: FAIL — cannot resolve `../../src/components/board/tileFill.js`.

- [ ] **Step 4: Write the implementation**

Create `packages/web/src/components/board/tileFill.ts`:

```ts
import type { PlayerAreaView, SeatId } from "@sengoku-jidai/engine";

/** Default tile colours for unowned areas, matching the original artwork palette. */
export const TILE_LAND_FILL = "#d5d3c4";
export const TILE_SEA_FILL = "#8cb2f2";

/** Solid fill for an area both controlled and in supply by the seat. */
export const SEAT_SOLID: Record<SeatId, string> = {
  red: "#c0392b",
  black: "#2f343c"
};

type TileFillInput = Pick<PlayerAreaView, "kind" | "owner" | "suppliedBy">;

/**
 * Fill string for a tile given its control and supply:
 * - controlled + supplied  -> solid seat colour
 * - controlled, not supplied -> striped seat pattern (`url(#stripe-<seat>)`)
 * - unowned -> kind default (land/sea)
 */
export function tileFill({ kind, owner, suppliedBy }: TileFillInput): string {
  if (owner === null) {
    return kind === "sea" ? TILE_SEA_FILL : TILE_LAND_FILL;
  }
  if (suppliedBy === owner) {
    return SEAT_SOLID[owner];
  }
  return `url(#stripe-${owner})`;
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `corepack pnpm --filter @sengoku-jidai/web test`
Expected: PASS (4 tests).

- [ ] **Step 6: Commit**

```bash
git add packages/web/src/components/board/tileFill.ts packages/web/test/board/tileFill.test.ts packages/web/tsconfig.json
git commit -m "feat(web): add pure tileFill helper for owner/supply tinting"
```

---

## Task 2: Pure `slotIdForSpace` helper

**Files:**
- Create: `packages/web/src/components/board/slotMapping.ts`
- Test: `packages/web/test/board/slotMapping.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/web/test/board/slotMapping.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { slotIdForSpace } from "../../src/components/board/slotMapping.js";

describe("slotIdForSpace", () => {
  it("maps an advance space to the SVG move slot", () => {
    expect(slotIdForSpace("advance-tile9")).toBe("move-tile9");
  });

  it("keeps the sail/bombard/shell prefixes", () => {
    expect(slotIdForSpace("sail-tile22")).toBe("sail-tile22");
    expect(slotIdForSpace("bombard-tile22")).toBe("bombard-tile22");
    expect(slotIdForSpace("shell-tile13")).toBe("shell-tile13");
  });

  it("returns null for support spaces with no board slot", () => {
    expect(slotIdForSpace("reinforce-a")).toBeNull();
    expect(slotIdForSpace("embark-b")).toBeNull();
    expect(slotIdForSpace("plan-a")).toBeNull();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `corepack pnpm --filter @sengoku-jidai/web test`
Expected: FAIL — cannot resolve `slotMapping.js`.

- [ ] **Step 3: Write the implementation**

Create `packages/web/src/components/board/slotMapping.ts`:

```ts
import type { ActionType } from "@sengoku-jidai/engine";

/** SVG order-slot prefix per on-map action type (engine "advance" = SVG "move"). */
const SLOT_PREFIX: Partial<Record<ActionType, string>> = {
  advance: "move",
  sail: "sail",
  bombard: "bombard",
  shell: "shell"
};

/**
 * Maps an engine action-space id (e.g. "advance-tile9") to its SVG order-slot
 * element id (e.g. "move-tile9"). Returns null for support spaces
 * (reinforce/embark/plan) and anything not linked to a tile.
 */
export function slotIdForSpace(spaceId: string): string | null {
  const dash = spaceId.indexOf("-");
  if (dash === -1) {
    return null;
  }
  const prefix = SLOT_PREFIX[spaceId.slice(0, dash) as ActionType];
  const rest = spaceId.slice(dash + 1);
  if (!prefix || !rest.startsWith("tile")) {
    return null;
  }
  return `${prefix}-${rest}`;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `corepack pnpm --filter @sengoku-jidai/web test`
Expected: PASS (tileFill + slotMapping suites green).

- [ ] **Step 5: Commit**

```bash
git add packages/web/src/components/board/slotMapping.ts packages/web/test/board/slotMapping.test.ts
git commit -m "feat(web): add action-space to SVG slot id mapping helper"
```

---

## Task 3: Vite plumbing + `MapBoard` skeleton (inline SVG renders)

This task gets the raw SVG on screen via `MapBoard`, swaps it into `App`, and deletes the old `Board`. Tints/overlays come in Tasks 4–5.

**Files:**
- Modify: `packages/web/vite.config.ts`
- Create: `packages/web/src/components/board/MapBoard.tsx`
- Modify: `packages/web/src/App.tsx`
- Delete: `packages/web/src/components/board/Board.tsx`

- [ ] **Step 1: Allow Vite to serve the repo-root SVG**

Modify `packages/web/vite.config.ts` to import `searchForWorkspaceRoot` and add `server.fs.allow`. Full file:

```ts
import react from "@vitejs/plugin-react";
import { defineConfig, searchForWorkspaceRoot } from "vite";

const webPort = Number(process.env.WEB_PORT ?? 18081);
const apiPort = Number(process.env.API_PORT ?? 3000);

export default defineConfig({
  plugins: [react()],
  server: {
    port: webPort,
    strictPort: true,
    fs: {
      allow: [searchForWorkspaceRoot(process.cwd())]
    },
    proxy: {
      "/api": `http://127.0.0.1:${apiPort}`,
      "/healthz": `http://127.0.0.1:${apiPort}`
    }
  }
});
```

- [ ] **Step 2: Create the `MapBoard` skeleton**

Create `packages/web/src/components/board/MapBoard.tsx`. (This file grows in Tasks 4–5; this step only injects the SVG and renders the shell.)

```tsx
import type { PlayerAreaView, SeatId } from "@sengoku-jidai/engine";
import { useEffect, useRef } from "react";
import rawMapSvg from "../../../../../cloned_map.svg?raw";

export interface MapBoardProps {
  areas: PlayerAreaView[];
  activeSeat: SeatId;
  selectedAreaId: string | null;
  actionSpaces: Record<string, SeatId | null>;
  onSelectArea: (areaId: string) => void;
}

export function MapBoard({ activeSeat }: MapBoardProps) {
  const hostRef = useRef<HTMLDivElement>(null);

  // Inject the raw SVG once on mount.
  useEffect(() => {
    const host = hostRef.current;
    if (!host) {
      return;
    }
    host.innerHTML = rawMapSvg;
  }, []);

  return (
    <section className="board" data-testid="board" aria-label="Sengoku Jidai battlefield">
      <div className="map-host" ref={hostRef} />
      <p className="board-status">Active seat: {activeSeat}</p>
    </section>
  );
}
```

- [ ] **Step 3: Swap `App` to use `MapBoard`**

In `packages/web/src/App.tsx`:

Change the import on line 3 from:

```tsx
import { Board } from "./components/board/Board.js";
```
to:
```tsx
import { MapBoard } from "./components/board/MapBoard.js";
```

Replace the `<Board ... />` element (currently lines 154-159) with:

```tsx
        <MapBoard
          areas={game.view.areas}
          activeSeat={game.view.activeSeat}
          selectedAreaId={selectedAreaId}
          actionSpaces={game.view.actionSpaces}
          onSelectArea={setSelectedAreaId}
        />
```

- [ ] **Step 4: Delete the old board**

```bash
git rm packages/web/src/components/board/Board.tsx
```

- [ ] **Step 5: Typecheck**

Run: `corepack pnpm --filter @sengoku-jidai/engine --filter @sengoku-jidai/shared --sort run build && corepack pnpm --filter @sengoku-jidai/web typecheck`
Expected: PASS (no type errors; `?raw` import typed via `vite/client`).

- [ ] **Step 6: Verify the map renders in the dev app**

Run: `corepack pnpm dev` (in a background shell), open `http://127.0.0.1:18081`, click "New hotseat game".
Expected: the hex map from `cloned_map.svg` appears in the board area (no tints yet). Stop the dev server afterward.

- [ ] **Step 7: Commit**

```bash
git add packages/web/vite.config.ts packages/web/src/components/board/MapBoard.tsx packages/web/src/App.tsx
git commit -m "feat(web): render cloned_map.svg inline via MapBoard"
```

---

## Task 4: Tinting, selection highlight, and click-to-select

Add the one-time SVG prep and the per-tile decoration.

**Files:**
- Modify: `packages/web/src/components/board/MapBoard.tsx`
- Modify: `packages/web/src/styles/app.css`

- [ ] **Step 1: Rewrite `MapBoard.tsx` with prep + tile decoration**

Replace the whole file with:

```tsx
import type { PlayerAreaView, SeatId } from "@sengoku-jidai/engine";
import { useEffect, useRef } from "react";
import rawMapSvg from "../../../../../cloned_map.svg?raw";
import { tileFill } from "./tileFill.js";

export interface MapBoardProps {
  areas: PlayerAreaView[];
  activeSeat: SeatId;
  selectedAreaId: string | null;
  actionSpaces: Record<string, SeatId | null>;
  onSelectArea: (areaId: string) => void;
}

const SVG_NS = "http://www.w3.org/2000/svg";

/** Shared tile geometry defs whose inline fill/stroke must be neutralized so each
 *  tile <use> can drive its own appearance. */
const TILE_GEOMETRY_DEFS = ["path9", "path9-2", "path9-2-2", "path9-5", "path9-5-0"];

const STRIPE_PATTERNS = `
<pattern id="stripe-red" patternUnits="userSpaceOnUse" width="26" height="26" patternTransform="rotate(45)">
  <rect width="26" height="26" fill="#d5d3c4"/>
  <rect width="13" height="26" fill="#c0392b"/>
</pattern>
<pattern id="stripe-black" patternUnits="userSpaceOnUse" width="26" height="26" patternTransform="rotate(45)">
  <rect width="26" height="26" fill="#d5d3c4"/>
  <rect width="13" height="26" fill="#2f343c"/>
</pattern>`;

/** One-time prep on the injected SVG: neutralize tile-def styling and inject stripe patterns. */
function prepareSvg(svg: SVGSVGElement): void {
  for (const id of TILE_GEOMETRY_DEFS) {
    const def = svg.querySelector<SVGElement>(`#${CSS.escape(id)}`);
    if (def) {
      def.style.fill = "inherit";
      def.style.stroke = "inherit";
      def.style.strokeWidth = "inherit";
    }
  }
  const defs = svg.querySelector("defs");
  if (defs && !defs.querySelector("#stripe-red")) {
    const parsed = new DOMParser().parseFromString(
      `<svg xmlns="${SVG_NS}">${STRIPE_PATTERNS}</svg>`,
      "image/svg+xml"
    );
    for (const node of Array.from(parsed.documentElement.childNodes)) {
      defs.appendChild(svg.ownerDocument.importNode(node, true));
    }
  }
}

interface DecorateInput {
  areas: PlayerAreaView[];
  selectedAreaId: string | null;
  onSelectArea: (areaId: string) => void;
}

/** Apply per-tile fill, selection stroke, and click handler. */
function decorate(svg: SVGSVGElement, { areas, selectedAreaId, onSelectArea }: DecorateInput): void {
  for (const area of areas) {
    const tile = svg.querySelector<SVGGraphicsElement>(`#${CSS.escape(area.id)}`);
    if (!tile) {
      throw new Error(`cloned_map.svg has no element for area "${area.id}"`);
    }
    tile.style.fill = tileFill(area);
    const selected = area.id === selectedAreaId;
    tile.style.stroke = selected ? "#f0b429" : "#000000";
    tile.style.strokeWidth = selected ? "8" : "5";
    tile.style.cursor = "pointer";
    tile.onclick = () => onSelectArea(area.id);
  }
}

export function MapBoard({ areas, activeSeat, selectedAreaId, onSelectArea }: MapBoardProps) {
  const hostRef = useRef<HTMLDivElement>(null);

  // Inject + prep once.
  useEffect(() => {
    const host = hostRef.current;
    if (!host) {
      return;
    }
    host.innerHTML = rawMapSvg;
    const svg = host.querySelector("svg");
    if (svg) {
      prepareSvg(svg);
    }
  }, []);

  // Re-decorate whenever state changes.
  useEffect(() => {
    const svg = hostRef.current?.querySelector("svg");
    if (svg) {
      decorate(svg, { areas, selectedAreaId, onSelectArea });
    }
  }, [areas, selectedAreaId, onSelectArea]);

  return (
    <section className="board" data-testid="board" aria-label="Sengoku Jidai battlefield">
      <div className="map-host" ref={hostRef} />
      <p className="board-status">Active seat: {activeSeat}</p>
    </section>
  );
}
```

- [ ] **Step 2: Add map host styling**

In `packages/web/src/styles/app.css`, add (near the `.board` rules):

```css
.map-host {
  width: 100%;
}

.map-host svg {
  display: block;
  width: 100%;
  height: auto;
}
```

- [ ] **Step 3: Typecheck**

Run: `corepack pnpm --filter @sengoku-jidai/web typecheck`
Expected: PASS.

- [ ] **Step 4: Verify tinting + selection in the dev app**

Run: `corepack pnpm dev`, open `http://127.0.0.1:18081`, create a game.
Expected: red HQ (`tile9`) tinted solid red, black HQ (`tile13`) solid dark; HQ-supplied neighbours tinted; clicking a tile highlights it with a gold outline and fills the side-panel details; unowned tiles show the land/sea default. Stop the server afterward.

- [ ] **Step 5: Commit**

```bash
git add packages/web/src/components/board/MapBoard.tsx packages/web/src/styles/app.css
git commit -m "feat(web): tint, highlight, and select map tiles by game state"
```

---

## Task 5: Overlay layer — unit counts + action-space occupancy

**Files:**
- Modify: `packages/web/src/components/board/MapBoard.tsx`
- Modify: `packages/web/src/styles/app.css`

- [ ] **Step 1: Add overlay helpers and wire them into `decorate`**

In `packages/web/src/components/board/MapBoard.tsx`:

Add the import for the slot helper at the top (with the other local imports):

```tsx
import { slotIdForSpace } from "./slotMapping.js";
```

Add a seat colour map for occupancy markers near `TILE_GEOMETRY_DEFS`:

```tsx
const OVERLAY_ID = "map-overlay";
const SEAT_MARK: Record<SeatId, string> = { red: "#7b1f1a", black: "#15181d" };
```

Add these helper functions above `decorate`:

```tsx
interface Point {
  x: number;
  y: number;
}

/** Centre of an element mapped into the root SVG (viewBox) coordinate space. */
function centerInRoot(svg: SVGSVGElement, el: SVGGraphicsElement): Point | null {
  const ctm = el.getCTM();
  if (!ctm) {
    return null;
  }
  const box = el.getBBox();
  const pt = svg.createSVGPoint();
  pt.x = box.x + box.width / 2;
  pt.y = box.y + box.height / 2;
  const mapped = pt.matrixTransform(ctm);
  return { x: mapped.x, y: mapped.y };
}

function makeText(label: string, at: Point): SVGTextElement {
  const text = document.createElementNS(SVG_NS, "text");
  text.setAttribute("x", String(at.x));
  text.setAttribute("y", String(at.y));
  text.setAttribute("class", "tile-units");
  text.textContent = label;
  return text;
}

function makeOccupancy(at: Point, color: string): SVGCircleElement {
  const circle = document.createElementNS(SVG_NS, "circle");
  circle.setAttribute("cx", String(at.x));
  circle.setAttribute("cy", String(at.y));
  circle.setAttribute("r", "16");
  circle.setAttribute("fill", color);
  circle.setAttribute("class", "slot-occupancy");
  return circle;
}

/** Get (creating if needed) the top-level overlay group, emptied for a fresh pass. */
function resetOverlay(svg: SVGSVGElement): SVGGElement {
  let overlay = svg.querySelector<SVGGElement>(`#${OVERLAY_ID}`);
  if (!overlay) {
    overlay = document.createElementNS(SVG_NS, "g");
    overlay.setAttribute("id", OVERLAY_ID);
    overlay.setAttribute("pointer-events", "none");
    svg.appendChild(overlay);
  }
  overlay.replaceChildren();
  return overlay;
}
```

Extend the `DecorateInput` interface to carry occupancy:

```tsx
interface DecorateInput {
  areas: PlayerAreaView[];
  selectedAreaId: string | null;
  actionSpaces: Record<string, SeatId | null>;
  onSelectArea: (areaId: string) => void;
}
```

Replace the `decorate` function body with the version that also draws the overlay:

```tsx
function decorate(
  svg: SVGSVGElement,
  { areas, selectedAreaId, actionSpaces, onSelectArea }: DecorateInput
): void {
  const overlay = resetOverlay(svg);

  for (const area of areas) {
    const tile = svg.querySelector<SVGGraphicsElement>(`#${CSS.escape(area.id)}`);
    if (!tile) {
      throw new Error(`cloned_map.svg has no element for area "${area.id}"`);
    }
    tile.style.fill = tileFill(area);
    const selected = area.id === selectedAreaId;
    tile.style.stroke = selected ? "#f0b429" : "#000000";
    tile.style.strokeWidth = selected ? "8" : "5";
    tile.style.cursor = "pointer";
    tile.onclick = () => onSelectArea(area.id);

    if (area.units.troop + area.units.ship > 0) {
      const center = centerInRoot(svg, tile);
      if (center) {
        overlay.appendChild(makeText(`${area.units.troop}t·${area.units.ship}s`, center));
      }
    }
  }

  for (const [spaceId, occupant] of Object.entries(actionSpaces)) {
    if (!occupant) {
      continue;
    }
    const slotId = slotIdForSpace(spaceId);
    if (!slotId) {
      continue;
    }
    const slot = svg.querySelector<SVGGraphicsElement>(`#${CSS.escape(slotId)}`);
    if (!slot) {
      continue;
    }
    const center = centerInRoot(svg, slot);
    if (center) {
      overlay.appendChild(makeOccupancy(center, SEAT_MARK[occupant]));
    }
  }
}
```

Update the decorate `useEffect` to pass `actionSpaces` and add it to the dependency array:

```tsx
  useEffect(() => {
    const svg = hostRef.current?.querySelector("svg");
    if (svg) {
      decorate(svg, { areas, selectedAreaId, actionSpaces, onSelectArea });
    }
  }, [areas, selectedAreaId, actionSpaces, onSelectArea]);
```

- [ ] **Step 2: Style the overlay text**

In `packages/web/src/styles/app.css`, add:

```css
.tile-units {
  fill: #fffaf0;
  font-size: 22px;
  font-weight: 700;
  text-anchor: middle;
  dominant-baseline: central;
  paint-order: stroke;
  stroke: rgba(0, 0, 0, 0.55);
  stroke-width: 4px;
}

.slot-occupancy {
  stroke: #fffaf0;
  stroke-width: 3px;
}
```

- [ ] **Step 3: Typecheck**

Run: `corepack pnpm --filter @sengoku-jidai/web typecheck`
Expected: PASS.

- [ ] **Step 4: Verify overlays in the dev app**

Run: `corepack pnpm dev`, open `http://127.0.0.1:18081`, create a game, deploy a commander (issue a deploy via the existing UI if available, or simply observe the HQ unit counts).
Expected: HQ tiles show `3t·0s` unit text centred on the tile; once a commander occupies an order slot, a seat-coloured dot appears on that slot. Unit text scales with the map. Stop the server afterward.

- [ ] **Step 5: Commit**

```bash
git add packages/web/src/components/board/MapBoard.tsx packages/web/src/styles/app.css
git commit -m "feat(web): overlay unit counts and action-space occupancy on the map"
```

---

## Task 6: Adapt e2e smoke, remove dead CSS, full verification

**Files:**
- Modify: `tests/e2e/hotseat.spec.ts`
- Modify: `packages/web/src/styles/app.css`

- [ ] **Step 1: Update the Playwright smoke**

Replace `tests/e2e/hotseat.spec.ts` with:

```ts
import { expect, test } from "@playwright/test";

test("creates a hotseat game, renders the SVG board, and selects a tile", async ({ page }) => {
  await page.goto("/");

  await page.getByRole("button", { name: "New hotseat game" }).click();
  await expect(page.getByTestId("board")).toBeVisible();
  await expect(page.getByText("Round 1")).toBeVisible();

  // The canonical map is inlined: the red HQ tile exists and is clickable.
  await expect(page.locator("#tile9")).toBeVisible();
  await page.locator("#tile9").click();
  await expect(page.getByRole("heading", { name: "tile9" })).toBeVisible();

  await page.reload();
  await expect(page.getByTestId("board")).toBeVisible();
  await expect(page.locator("#tile9")).toBeVisible();
  await expect(page.getByText("Round 1")).toBeVisible();
});
```

- [ ] **Step 2: Remove dead card-grid CSS**

In `packages/web/src/styles/app.css`, delete the now-unused rules that belonged to the old `Board.tsx` card grid and an earlier SVG attempt. Remove these selector blocks: `.board-background`, `.board-grid line`, `.area`, `.area:hover, .area:focus`, `.area-selected`, `.area-red`, `.area-black`, `.area-neutral`, `.area-label`, `.area-meta`, `.commander circle`, `.commander text`, `.commander-red circle`, `.commander-black circle`, `.board-hit-proxy`, and any `.area-grid` / `.area-card*` blocks.

Before deleting each, confirm it has no remaining references:

Run: `grep -rn "area-card\|area-grid\|board-grid\|board-background\|board-hit-proxy\|\bcommander\b\|area-label\|area-meta\|area-neutral\|area-red\|area-black\|area-selected" packages/web/src --include=*.tsx`
Expected: no matches (all usages were in the deleted `Board.tsx`). Keep `.board` and `.board-status` (still used by `MapBoard`).

- [ ] **Step 3: Lint + format**

Run: `corepack pnpm lint && corepack pnpm format`
Expected: lint passes; format leaves the tree clean (commit any formatting changes).

- [ ] **Step 4: Full typecheck + unit tests**

Run: `corepack pnpm typecheck && corepack pnpm test`
Expected: all packages typecheck; web unit suites (tileFill, slotMapping) pass; engine/server tests unchanged and green.

- [ ] **Step 5: Run the e2e smoke**

Run: `corepack pnpm test:e2e`
Expected: PASS — board renders, `#tile9` visible and clickable, detail heading shows `tile9`, state persists after reload.

- [ ] **Step 6: Commit**

```bash
git add tests/e2e/hotseat.spec.ts packages/web/src/styles/app.css
git commit -m "test(web): adapt e2e smoke to the SVG board; drop dead board CSS"
```

---

## Self-review notes (for the implementer)

- **Spec coverage:** Task 1 = tinting decision (solid/stripe/default); Task 3 = inline embed + asset import; Task 4 = prep (neutralize defs, stripe patterns) + tint + selection + click; Task 5 = unit counts + occupancy; Task 6 = testing + cleanup. Scope boundaries (no order composition, no engine/server changes) are respected — only `packages/web` and `tests/e2e` are touched.
- **Type consistency:** `tileFill` takes `Pick<PlayerAreaView, "kind"|"owner"|"suppliedBy">`; `MapBoardProps.actionSpaces` is `Record<string, SeatId | null>` matching `PlayerGameView.actionSpaces`; `slotIdForSpace` takes/returns `string`. `SeatId`/`PlayerAreaView`/`ActionType` all come from `@sengoku-jidai/engine`.
- **Verification reality:** the prep/decorate DOM logic relies on `getBBox`/`getCTM`, which jsdom does not implement — so it is verified via Playwright (real Chromium) and manual dev-server checks, not vitest. Only the pure helpers are unit-tested.
- **StrictMode:** the mount effect re-runs in dev; `prepareSvg` guards against duplicate stripe patterns, and re-injecting `innerHTML` is idempotent. `decorate` rebuilds the overlay each pass (`replaceChildren`) and overwrites `tile.onclick` (no listener stacking).
