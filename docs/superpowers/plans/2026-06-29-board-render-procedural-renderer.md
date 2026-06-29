# Board-Render Procedural Renderer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a new framework-agnostic `packages/board-render` that turns sub-project 1's `compileHexMap` output (`{ definition, layout }`) into a static board SVG markup string (fused hex-tile silhouettes + extracted asset glyphs), shaped to be a drop-in replacement for the hand-authored `board.svg`.

**Architecture:** Pure geometry → pure scene data → SVG string. `outline.ts` fuses a connected hex set into perimeter rings; `scene.ts` turns `CompiledMap` into a DOM-free `BoardScene`; `assets.ts` holds glyph defs extracted from `board.svg`; `assemble.ts` serializes a `BoardScene` to an `<svg>` string whose ids/groups match what the existing web `decorate()` queries. No DOM, no framework, no changes to any existing package.

**Tech Stack:** TypeScript (ESM, NodeNext), Vitest. Depends only on `@sengoku-jidai/engine` types/functions. Verification uses local headless Chromium (`~/.local/bin/svgshot.mjs`, launched with `LD_LIBRARY_PATH=$HOME/.local/chromium-deps/lib`).

## Global Constraints

- Package name: `@sengoku-jidai/board-render`; `"private": true`; `"type": "module"`; ESM NodeNext (mirror `packages/terrain`).
- Depends on `@sengoku-jidai/engine` (`workspace:*`) **only**. No DOM, no React, no other runtime deps.
- **No existing package may be modified.** This sub-project is purely additive (`packages/web`, `packages/engine`, Rivers, `decorate()` are all untouched — that is sub-project 3).
- Pure & deterministic: **no `Math.random`, no `Date`**. Tiles emitted in `definition.areas` insertion order.
- Flat-top hexes; `size` = centre-to-corner; the six corners are at angles `60·i` degrees (`i = 0..5`). Reuse the engine's `axialToPixel`; never re-derive the layout formula.
- Glyph defs use **semantic ids** (`unit-army-red`, `unit-ship-black`, `glyph-hq-red`, `glyph-star`, `glyph-harbor`).
- Tile fill palette (duplicated from web `tileFill.ts` with a comment — board-render cannot import web): land `#d5d3c4`, sea `#8cb2f2`.
- Order-slot id prefixes (must match web `slotIdForSpace`): land→`move-<id>`, sea→`sail-<id>` + `bombard-<id>`, shellable land→`shell-<id>`.
- Emitted SVG contract is fixed by the spec §6; `assemble.test.ts` asserts every required hook.
- After each task: the package's own `pnpm --filter @sengoku-jidai/board-render test` and `... typecheck` are green. Engine must be built first (`corepack pnpm --filter @sengoku-jidai/engine build`) because board-render imports engine's `dist`.

**Spec:** `docs/superpowers/specs/2026-06-29-board-render-procedural-renderer-design.md`

---

### Task 1: Package scaffold + SVG string helpers

**Files:**
- Create: `packages/board-render/package.json`
- Create: `packages/board-render/tsconfig.json`
- Create: `packages/board-render/src/index.ts`
- Create: `packages/board-render/src/svg.ts`
- Test: `packages/board-render/test/svg.test.ts`

**Interfaces:**
- Produces: `escapeAttr(v: string): string`; `el(tag: string, attrs: Record<string, string | number | undefined>, children?: string): string` — a tiny no-DOM element serializer. `undefined` attrs are skipped; with no `children` the element self-closes.

- [ ] **Step 1: Create `package.json`**

```json
{
  "name": "@sengoku-jidai/board-render",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "test": "vitest run --passWithNoTests",
    "typecheck": "tsc -p tsconfig.json --noEmit"
  },
  "dependencies": {
    "@sengoku-jidai/engine": "workspace:*"
  },
  "devDependencies": {
    "@types/node": "^22.10.5",
    "typescript": "^5.7.2",
    "vitest": "^2.1.8"
  }
}
```

- [ ] **Step 2: Create `tsconfig.json`** (mirror `packages/terrain/tsconfig.json`)

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "noEmit": true,
    "types": ["node", "vitest/globals"]
  },
  "include": ["src/**/*.ts", "test/**/*.ts"]
}
```

- [ ] **Step 3: Install the workspace + build engine**

Run: `corepack pnpm install && corepack pnpm --filter @sengoku-jidai/engine build`
Expected: install succeeds; `packages/engine/dist/index.js` exists (board-render resolves engine from `dist`).

- [ ] **Step 4: Write the failing test** — `packages/board-render/test/svg.test.ts`

```ts
import { describe, it, expect } from "vitest";
import { el, escapeAttr } from "../src/svg.js";

describe("escapeAttr", () => {
  it("escapes the XML-significant characters", () => {
    expect(escapeAttr(`a&b<c>d"e`)).toBe("a&amp;b&lt;c&gt;d&quot;e");
  });
});

describe("el", () => {
  it("self-closes when there are no children", () => {
    expect(el("circle", { cx: 1, cy: 2, r: 3 })).toBe(`<circle cx="1" cy="2" r="3"/>`);
  });
  it("wraps children and skips undefined attrs", () => {
    expect(el("g", { id: "x", transform: undefined }, "<rect/>")).toBe(`<g id="x"><rect/></g>`);
  });
});
```

- [ ] **Step 5: Run test to verify it fails**

Run: `corepack pnpm --filter @sengoku-jidai/board-render test`
Expected: FAIL — `Cannot find module '../src/svg.js'`.

- [ ] **Step 6: Implement `src/svg.ts`**

```ts
/** Minimal, DOM-free SVG element serializer. board-render emits strings, never touches a DOM. */

const ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;"
};

export function escapeAttr(v: string): string {
  return v.replace(/[&<>"]/g, (c) => ESCAPES[c] ?? c);
}

export function el(
  tag: string,
  attrs: Record<string, string | number | undefined>,
  children?: string
): string {
  const parts: string[] = [];
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined) {
      continue;
    }
    parts.push(`${k}="${escapeAttr(String(v))}"`);
  }
  const open = parts.length > 0 ? `${tag} ${parts.join(" ")}` : tag;
  return children === undefined ? `<${open}/>` : `<${open}>${children}</${tag}>`;
}
```

- [ ] **Step 7: Create the public surface stub `src/index.ts`**

```ts
export * from "./svg.js";
```

- [ ] **Step 8: Run test + typecheck to verify they pass**

Run: `corepack pnpm --filter @sengoku-jidai/board-render test && corepack pnpm --filter @sengoku-jidai/board-render typecheck`
Expected: PASS (3 tests) and typecheck clean.

- [ ] **Step 9: Commit**

```bash
git add packages/board-render pnpm-lock.yaml
git commit -m "feat(board-render): scaffold package + SVG string helpers

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 2: Hex outline fusion (`outline.ts`)

**Files:**
- Create: `packages/board-render/src/outline.ts`
- Test: `packages/board-render/test/outline.test.ts`

**Interfaces:**
- Consumes: from `@sengoku-jidai/engine` — `axialToPixel(a, layout)`, types `Axial`, `Pixel`, `HexLayout`.
- Produces:
  - `hexCorners(center: Pixel, size: number): Pixel[]` — 6 flat-top corners.
  - `interface Edge { a: Pixel; b: Pixel }`.
  - `hexEdges(hexes: Axial[], layout: HexLayout): Edge[]` — every member-hex edge, deduped (for the grid layer).
  - `fuseTile(hexes: Axial[], layout: HexLayout): Pixel[][]` — perimeter rings of the union silhouette (one ring per closed loop; outer + any holes).

- [ ] **Step 1: Write the failing test** — `packages/board-render/test/outline.test.ts`

```ts
import { describe, it, expect } from "vitest";
import type { Axial, HexLayout } from "@sengoku-jidai/engine";
import { fuseTile, hexCorners, hexEdges } from "../src/outline.js";

const LAYOUT: HexLayout = { size: 114, originX: 0, originY: 0 };

describe("hexCorners", () => {
  it("returns 6 corners at radius=size from the centre", () => {
    const corners = hexCorners({ x: 0, y: 0 }, 10);
    expect(corners).toHaveLength(6);
    for (const c of corners) {
      expect(Math.hypot(c.x, c.y)).toBeCloseTo(10, 6);
    }
  });
});

describe("fuseTile", () => {
  it("a single hex fuses to one 6-point ring", () => {
    const rings = fuseTile([{ q: 0, r: 0 }], LAYOUT);
    expect(rings).toHaveLength(1);
    expect(rings[0]).toHaveLength(6);
  });

  it("two edge-adjacent hexes fuse to one ring with no internal edge", () => {
    // B from the fixture: (1,0) and (1,-1) share an edge.
    const hexes: Axial[] = [
      { q: 1, r: 0 },
      { q: 1, r: -1 }
    ];
    const rings = fuseTile(hexes, LAYOUT);
    expect(rings).toHaveLength(1);
    // 6 + 6 corners, minus the 2 shared corners = 10 perimeter vertices.
    expect(rings[0]).toHaveLength(10);
  });
});

describe("hexEdges", () => {
  it("dedupes the shared edge between two adjacent hexes (11 unique, not 12)", () => {
    const hexes: Axial[] = [
      { q: 1, r: 0 },
      { q: 1, r: -1 }
    ];
    expect(hexEdges(hexes, LAYOUT)).toHaveLength(11);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `corepack pnpm --filter @sengoku-jidai/board-render test outline`
Expected: FAIL — `Cannot find module '../src/outline.js'`.

- [ ] **Step 3: Implement `src/outline.ts`**

```ts
import { axialToPixel } from "@sengoku-jidai/engine";
import type { Axial, HexLayout, Pixel } from "@sengoku-jidai/engine";

export interface Edge {
  a: Pixel;
  b: Pixel;
}

/** Quantize a point to a 0.01-unit grid so corners shared between hexes compare exactly
 *  equal (floating-point seam guard). */
const QUANT = 100;
function pkey(p: Pixel): string {
  return `${Math.round(p.x * QUANT)},${Math.round(p.y * QUANT)}`;
}
function edgeKey(a: Pixel, b: Pixel): string {
  const ka = pkey(a);
  const kb = pkey(b);
  return ka < kb ? `${ka}|${kb}` : `${kb}|${ka}`;
}

/** Flat-top hex corners (angles 60·i degrees), radius = size, centred on `center`. */
export function hexCorners(center: Pixel, size: number): Pixel[] {
  const pts: Pixel[] = [];
  for (let i = 0; i < 6; i += 1) {
    const angle = (Math.PI / 180) * 60 * i;
    pts.push({ x: center.x + size * Math.cos(angle), y: center.y + size * Math.sin(angle) });
  }
  return pts;
}

function tileEdges(hexes: Axial[], layout: HexLayout): Map<string, { edge: Edge; n: number }> {
  const counts = new Map<string, { edge: Edge; n: number }>();
  for (const h of hexes) {
    const corners = hexCorners(axialToPixel(h, layout), layout.size);
    for (let i = 0; i < 6; i += 1) {
      const a = corners[i]!;
      const b = corners[(i + 1) % 6]!;
      const k = edgeKey(a, b);
      const cur = counts.get(k);
      if (cur) {
        cur.n += 1;
      } else {
        counts.set(k, { edge: { a, b }, n: 1 });
      }
    }
  }
  return counts;
}

/** Every member-hex edge, deduped (shared edges collapse to one). For the grid layer. */
export function hexEdges(hexes: Axial[], layout: HexLayout): Edge[] {
  return [...tileEdges(hexes, layout).values()].map((e) => e.edge);
}

/** Trace boundary edges into closed rings by walking vertex-to-vertex. */
function traceRings(edges: Edge[]): Pixel[][] {
  const points = new Map<string, Pixel>();
  const adj = new Map<string, Set<string>>();
  const link = (p: Pixel, q: Pixel): void => {
    const kp = pkey(p);
    const kq = pkey(q);
    points.set(kp, p);
    points.set(kq, q);
    (adj.get(kp) ?? adj.set(kp, new Set()).get(kp)!).add(kq);
    (adj.get(kq) ?? adj.set(kq, new Set()).get(kq)!).add(kp);
  };
  for (const e of edges) {
    link(e.a, e.b);
  }

  const used = new Set<string>();
  const usedKey = (a: string, b: string): string => (a < b ? `${a}|${b}` : `${b}|${a}`);
  const rings: Pixel[][] = [];

  for (const startKey of adj.keys()) {
    for (const firstNext of adj.get(startKey)!) {
      if (used.has(usedKey(startKey, firstNext))) {
        continue;
      }
      const ring: Pixel[] = [points.get(startKey)!];
      let prev = startKey;
      let cur = firstNext;
      used.add(usedKey(prev, cur));
      while (cur !== startKey) {
        ring.push(points.get(cur)!);
        let moved = false;
        for (const nb of adj.get(cur)!) {
          if (nb === prev || used.has(usedKey(cur, nb))) {
            continue;
          }
          used.add(usedKey(cur, nb));
          prev = cur;
          cur = nb;
          moved = true;
          break;
        }
        if (!moved) {
          break; // open chain — should not happen for a valid connected tile
        }
      }
      rings.push(ring);
    }
  }
  return rings;
}

/** Fuse a connected hex set into its perimeter ring(s): boundary edges are those owned
 *  by exactly one member hex; internal (shared) edges are dropped. */
export function fuseTile(hexes: Axial[], layout: HexLayout): Pixel[][] {
  const boundary: Edge[] = [];
  for (const { edge, n } of tileEdges(hexes, layout).values()) {
    if (n === 1) {
      boundary.push(edge);
    }
  }
  return traceRings(boundary);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `corepack pnpm --filter @sengoku-jidai/board-render test outline`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/board-render/src/outline.ts packages/board-render/test/outline.test.ts
git commit -m "feat(board-render): hex outline fusion (union silhouette rings)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 3: Scene model (`scene.ts`)

**Files:**
- Create: `packages/board-render/src/scene.ts`
- Test: `packages/board-render/test/scene.test.ts`

**Interfaces:**
- Consumes: `@sengoku-jidai/engine` — `compileHexMap`, `FIXTURE_HEX_MAP`, types `CompiledMap`, `MapLayout`, `MapArea`, `SeatId`, `Axial`, `Pixel`, `HexLayout`; and `fuseTile`/`hexEdges`/`Edge` from `./outline.js`.
- Produces: `buildScene(compiled: CompiledMap): BoardScene` and the `BoardScene`/`SceneTile` types below.

```ts
export interface BoardScene {
  viewBox: { x: number; y: number; width: number; height: number };
  tiles: SceneTile[];
  hexGrid: Edge[];
}
export interface SceneTile {
  id: string;
  kind: "land" | "sea";
  rings: Pixel[][];
  centroid: Pixel;
  authoredFill: string;
  features: { hq?: SeatId; valueStars: 0 | 1 | 2; harbor: boolean };
  glyphAnchors: { hq?: Pixel; stars?: Pixel; harbor?: Pixel };
  slots: Record<string, Pixel>;
  ports: { to: string; from: Pixel; toPoint: Pixel }[];
}
```

- [ ] **Step 1: Write the failing test** — `packages/board-render/test/scene.test.ts`

```ts
import { describe, it, expect } from "vitest";
import { compileHexMap, FIXTURE_HEX_MAP } from "@sengoku-jidai/engine";
import { buildScene } from "../src/scene.js";

const scene = buildScene(compileHexMap(FIXTURE_HEX_MAP));
const byId = (id: string) => scene.tiles.find((t) => t.id === id)!;

describe("buildScene", () => {
  it("emits one tile per area, in definition order", () => {
    expect(scene.tiles.map((t) => t.id)).toEqual(["A", "B", "C", "D", "E"]);
  });

  it("assigns land/sea authored fills", () => {
    expect(byId("A").authoredFill).toBe("#d5d3c4");
    expect(byId("C").authoredFill).toBe("#8cb2f2");
  });

  it("carries features through to the scene tile", () => {
    expect(byId("A").features.hq).toBe("red");
    expect(byId("B").features.valueStars).toBe(1);
    expect(byId("D").features.harbor).toBe(true);
  });

  it("derives order-slot ids matching the web slotIdForSpace contract", () => {
    expect(Object.keys(byId("A").slots).sort()).toEqual(["move-A"]); // land
    expect(Object.keys(byId("C").slots).sort()).toEqual(["bombard-C", "sail-C"]); // sea
    expect(Object.keys(byId("B").slots).sort()).toEqual(["move-B", "shell-B"]); // shellable land
  });

  it("emits a pier from harbor D to its port sea tile C", () => {
    const ports = byId("D").ports;
    expect(ports).toHaveLength(1);
    expect(ports[0]!.to).toBe("C");
  });

  it("produces a viewBox enclosing every ring point", () => {
    const allX = scene.tiles.flatMap((t) => t.rings.flat().map((p) => p.x));
    const allY = scene.tiles.flatMap((t) => t.rings.flat().map((p) => p.y));
    expect(scene.viewBox.x).toBeLessThanOrEqual(Math.min(...allX));
    expect(scene.viewBox.y).toBeLessThanOrEqual(Math.min(...allY));
    expect(scene.viewBox.x + scene.viewBox.width).toBeGreaterThanOrEqual(Math.max(...allX));
    expect(scene.viewBox.y + scene.viewBox.height).toBeGreaterThanOrEqual(Math.max(...allY));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `corepack pnpm --filter @sengoku-jidai/board-render test scene`
Expected: FAIL — `Cannot find module '../src/scene.js'`.

- [ ] **Step 3: Implement `src/scene.ts`**

```ts
import { axialToPixel } from "@sengoku-jidai/engine";
import type {
  Axial,
  CompiledMap,
  HexLayout,
  MapArea,
  Pixel,
  SeatId
} from "@sengoku-jidai/engine";
import { fuseTile, hexEdges, type Edge } from "./outline.js";

// Duplicated from web tileFill.ts (board-render cannot import the web package).
const TILE_LAND_FILL = "#d5d3c4";
const TILE_SEA_FILL = "#8cb2f2";

export interface BoardScene {
  viewBox: { x: number; y: number; width: number; height: number };
  tiles: SceneTile[];
  hexGrid: Edge[];
}

export interface SceneTile {
  id: string;
  kind: "land" | "sea";
  rings: Pixel[][];
  centroid: Pixel;
  authoredFill: string;
  features: { hq?: SeatId; valueStars: 0 | 1 | 2; harbor: boolean };
  glyphAnchors: { hq?: Pixel; stars?: Pixel; harbor?: Pixel };
  slots: Record<string, Pixel>;
  ports: { to: string; from: Pixel; toPoint: Pixel }[];
}

const MARGIN = 40;

function hexLayout(compiled: CompiledMap): HexLayout {
  return {
    size: compiled.layout.size,
    originX: compiled.layout.origin.x,
    originY: compiled.layout.origin.y
  };
}

function centroidOf(hexes: Axial[], layout: HexLayout): Pixel {
  let x = 0;
  let y = 0;
  for (const h of hexes) {
    const p = axialToPixel(h, layout);
    x += p.x;
    y += p.y;
  }
  return { x: x / hexes.length, y: y / hexes.length };
}

/** Order-slot ids for a tile, matching web slotIdForSpace: land→move, sea→sail+bombard,
 *  shellable land→shell. Fanned around the centroid so occupancy dots do not overlap. */
function slotsFor(area: MapArea, centroid: Pixel, size: number): Record<string, Pixel> {
  const ids: string[] = [];
  if (area.kind === "land") {
    ids.push(`move-${area.id}`);
    if (area.shellable) {
      ids.push(`shell-${area.id}`);
    }
  } else {
    ids.push(`sail-${area.id}`, `bombard-${area.id}`);
  }
  const slots: Record<string, Pixel> = {};
  const radius = ids.length > 1 ? size * 0.5 : 0;
  ids.forEach((id, i) => {
    const angle = (Math.PI / 180) * (90 + (360 / ids.length) * i);
    slots[id] = { x: centroid.x + radius * Math.cos(angle), y: centroid.y + radius * Math.sin(angle) };
  });
  return slots;
}

export function buildScene(compiled: CompiledMap): BoardScene {
  const layout = hexLayout(compiled);
  const centroids = new Map<string, Pixel>();
  const tiles: SceneTile[] = [];
  const hexGrid: Edge[] = [];

  // First pass: geometry + centroids (needed before ports can reference sea centroids).
  for (const area of Object.values(compiled.definition.areas)) {
    const hexes = compiled.layout.tiles[area.id]!.hexes;
    const centroid = centroidOf(hexes, layout);
    centroids.set(area.id, centroid);
    hexGrid.push(...hexEdges(hexes, layout));
    tiles.push({
      id: area.id,
      kind: area.kind,
      rings: fuseTile(hexes, layout),
      centroid,
      authoredFill: area.kind === "sea" ? TILE_SEA_FILL : TILE_LAND_FILL,
      features: { hq: area.hq ?? undefined, valueStars: area.valueStars, harbor: area.harbor },
      glyphAnchors: {
        hq: area.hq ? centroid : undefined,
        stars: area.valueStars > 0 ? { x: centroid.x, y: centroid.y - layout.size * 0.4 } : undefined,
        harbor: area.harbor ? { x: centroid.x, y: centroid.y + layout.size * 0.4 } : undefined
      },
      slots: slotsFor(area, centroid, layout.size),
      ports: []
    });
  }

  // Second pass: ports (need both endpoints' centroids).
  for (const tile of tiles) {
    const area = compiled.definition.areas[tile.id]!;
    tile.ports = area.ports.map((seaId) => ({
      to: seaId,
      from: centroids.get(tile.id)!,
      toPoint: centroids.get(seaId)!
    }));
  }

  // viewBox from the union of all ring points + margin.
  const xs = tiles.flatMap((t) => t.rings.flat().map((p) => p.x));
  const ys = tiles.flatMap((t) => t.rings.flat().map((p) => p.y));
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  const maxX = Math.max(...xs);
  const maxY = Math.max(...ys);
  return {
    viewBox: {
      x: minX - MARGIN,
      y: minY - MARGIN,
      width: maxX - minX + 2 * MARGIN,
      height: maxY - minY + 2 * MARGIN
    },
    tiles,
    hexGrid
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `corepack pnpm --filter @sengoku-jidai/board-render test scene`
Expected: PASS (6 tests).

- [ ] **Step 5: Export from `index.ts` + commit**

Add to `src/index.ts`:

```ts
export * from "./outline.js";
export * from "./scene.js";
```

```bash
git add packages/board-render/src/scene.ts packages/board-render/src/index.ts packages/board-render/test/scene.test.ts
git commit -m "feat(board-render): buildScene — CompiledMap to DOM-free BoardScene

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 4: Asset library (`assets.ts`)

**Files:**
- Create: `packages/board-render/src/assets.ts`
- Test: `packages/board-render/test/assets.test.ts`
- Read-only reference: `assets/maps/rivers/board.svg` (extract glyph geometry from here)

**Interfaces:**
- Consumes: `el` from `./svg.js`; `Pixel`, `SeatId` from engine.
- Produces:
  - `type GlyphId = "unit-army-red" | "unit-army-black" | "unit-ship-red" | "unit-ship-black" | "glyph-hq-red" | "glyph-hq-black" | "glyph-star" | "glyph-harbor"`.
  - `ASSETS.defs: string` — the `<defs>` inner markup (all glyph symbols + the stripe patterns).
  - `ASSETS.place(glyph: GlyphId, at: Pixel, scale?: number): string` — a `<use href="#<glyph>">` translated to `at` (and scaled).
  - Helper `armyGlyph(seat)`, `shipGlyph(seat)`, `hqGlyph(seat)` returning the matching `GlyphId`.

**Extraction note:** the glyph geometry already lives in `board.svg` as defs referenced by `<use>`. Locate each, then copy its path geometry into a `<symbol id="<semantic-id>" viewBox=…>` normalized so (0,0) is the glyph's placement anchor. Use these greps to find the source defs:

```bash
# HQ base def (referenced by basered/baseblack <use>):
grep -n 'basered-tile9\|baseblack-tile13' assets/maps/rivers/board.svg   # -> xlink:href targets
# army disc + ship defs (already known ids):
grep -n 'id="path77"\|id="path77-5"\|id="path1-7-5-4-2"\|id="path1-7-5-4"' assets/maps/rivers/board.svg
# star + harbor defs (find the <use> then its href):
grep -n 'stars1-tile2\|harbor-tile6' assets/maps/rivers/board.svg
```

Copy each referenced def's child geometry verbatim into the corresponding `<symbol>`; wrap as a symbol so `<use>` placement + scale is uniform. Keep colours: army/ship per-seat fills (red `#c0392b`, black `#2f343c` per web `tileFill.ts`); HQ/star/harbor keep their authored colours.

- [ ] **Step 1: Write the failing test** — `packages/board-render/test/assets.test.ts`

```ts
import { describe, it, expect } from "vitest";
import { ASSETS, armyGlyph, hqGlyph, shipGlyph } from "../src/assets.js";

describe("ASSETS.defs", () => {
  it("declares a symbol for every glyph id + the stripe patterns", () => {
    for (const id of [
      "unit-army-red",
      "unit-army-black",
      "unit-ship-red",
      "unit-ship-black",
      "glyph-hq-red",
      "glyph-hq-black",
      "glyph-star",
      "glyph-harbor"
    ]) {
      expect(ASSETS.defs).toContain(`id="${id}"`);
    }
    expect(ASSETS.defs).toContain(`id="stripe-red"`);
    expect(ASSETS.defs).toContain(`id="stripe-black"`);
    expect(ASSETS.defs).toContain(`id="stripe-source"`);
  });
});

describe("ASSETS.place", () => {
  it("emits a translated <use> of the requested glyph", () => {
    const out = ASSETS.place("glyph-star", { x: 10, y: 20 });
    expect(out).toContain(`href="#glyph-star"`);
    expect(out).toContain(`translate(10 20)`);
  });
});

describe("glyph selectors", () => {
  it("map seat -> glyph id", () => {
    expect(armyGlyph("red")).toBe("unit-army-red");
    expect(shipGlyph("black")).toBe("unit-ship-black");
    expect(hqGlyph("red")).toBe("glyph-hq-red");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `corepack pnpm --filter @sengoku-jidai/board-render test assets`
Expected: FAIL — `Cannot find module '../src/assets.js'`.

- [ ] **Step 3: Implement `src/assets.ts`**

Structure (fill each `<symbol>`'s inner geometry from the board.svg defs located in the extraction note; the path `d=…` strings below are placeholders to replace with the copied-verbatim geometry):

```ts
import type { Pixel, SeatId } from "@sengoku-jidai/engine";
import { el } from "./svg.js";

export type GlyphId =
  | "unit-army-red"
  | "unit-army-black"
  | "unit-ship-red"
  | "unit-ship-black"
  | "glyph-hq-red"
  | "glyph-hq-black"
  | "glyph-star"
  | "glyph-harbor";

const SEAT_FILL: Record<SeatId, string> = { red: "#c0392b", black: "#2f343c" };

// Each symbol's inner markup is copied verbatim from assets/maps/rivers/board.svg's defs
// (see extraction note in the plan), normalized so (0,0) is the placement anchor.
function symbol(id: string, viewBox: string, inner: string): string {
  return el("symbol", { id, viewBox, overflow: "visible" }, inner);
}

const STRIPE_PATTERNS = `
<pattern id="stripe-red" patternUnits="userSpaceOnUse" width="26" height="26" patternTransform="rotate(45)"><rect width="26" height="26" fill="#d5d3c4"/><rect width="13" height="26" fill="#c0392b"/></pattern>
<pattern id="stripe-black" patternUnits="userSpaceOnUse" width="26" height="26" patternTransform="rotate(45)"><rect width="26" height="26" fill="#d5d3c4"/><rect width="13" height="26" fill="#2f343c"/></pattern>
<pattern id="stripe-source" patternUnits="userSpaceOnUse" width="22" height="22" patternTransform="rotate(45)"><rect width="11" height="22" fill="#2f9e44"/></pattern>`;

const SYMBOLS = [
  symbol("unit-army-red", "-20 -20 40 40", `<circle r="16" fill="${SEAT_FILL.red}" stroke="#000" stroke-width="2"/>`),
  symbol("unit-army-black", "-20 -20 40 40", `<circle r="16" fill="${SEAT_FILL.black}" stroke="#000" stroke-width="2"/>`),
  symbol("unit-ship-red", "-24 -16 48 32", `<!-- ship geometry from board.svg path1-7-5-4-2, filled ${SEAT_FILL.red} -->`),
  symbol("unit-ship-black", "-24 -16 48 32", `<!-- ship geometry from board.svg path1-7-5-4, filled ${SEAT_FILL.black} -->`),
  symbol("glyph-hq-red", "-30 -30 60 60", `<!-- HQ base geometry from board.svg (basered href target) -->`),
  symbol("glyph-hq-black", "-30 -30 60 60", `<!-- HQ base geometry from board.svg (baseblack href target) -->`),
  symbol("glyph-star", "-16 -16 32 32", `<!-- star geometry from board.svg (stars1 href target) -->`),
  symbol("glyph-harbor", "-16 -16 32 32", `<!-- harbor geometry from board.svg (harbor href target) -->`)
].join("\n");

export const ASSETS = {
  defs: `${SYMBOLS}\n${STRIPE_PATTERNS}`,
  place(glyph: GlyphId, at: Pixel, scale = 1): string {
    const transform =
      scale === 1 ? `translate(${at.x} ${at.y})` : `translate(${at.x} ${at.y}) scale(${scale})`;
    return el("use", { href: `#${glyph}`, "xlink:href": `#${glyph}`, transform });
  }
};

export function armyGlyph(seat: SeatId): GlyphId {
  return seat === "red" ? "unit-army-red" : "unit-army-black";
}
export function shipGlyph(seat: SeatId): GlyphId {
  return seat === "red" ? "unit-ship-red" : "unit-ship-black";
}
export function hqGlyph(seat: SeatId): GlyphId {
  return seat === "red" ? "glyph-hq-red" : "glyph-hq-black";
}
```

- [ ] **Step 4: Replace the placeholder geometry with the extracted board.svg defs**

Run the greps in the extraction note, open `assets/maps/rivers/board.svg`, and paste each glyph's verbatim child geometry into its `<symbol>` (replacing the `<!-- … -->` placeholders), translating the def's own transform so the glyph centres on (0,0). The army disc may stay as the simple `<circle>` already written if its board.svg counterpart is a plain disc; verify against the art. **No `<!-- … -->` placeholder may remain.**

- [ ] **Step 5: Run test to verify it passes**

Run: `corepack pnpm --filter @sengoku-jidai/board-render test assets`
Expected: PASS (3 tests). Then `grep -rn '<!--' packages/board-render/src/assets.ts` returns nothing.

- [ ] **Step 6: Export from `index.ts` + commit**

Add `export * from "./assets.js";` to `src/index.ts`.

```bash
git add packages/board-render/src/assets.ts packages/board-render/src/index.ts packages/board-render/test/assets.test.ts
git commit -m "feat(board-render): asset library — glyph defs extracted from board.svg

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 5: Assembler + emitted contract (`assemble.ts`)

**Files:**
- Create: `packages/board-render/src/assemble.ts`
- Test: `packages/board-render/test/assemble.test.ts`

**Interfaces:**
- Consumes: `BoardScene`/`SceneTile` from `./scene.js`; `ASSETS`, `hqGlyph` from `./assets.js`; `el` from `./svg.js`.
- Produces: `assembleBoardSvg(scene: BoardScene): string` — a complete `<svg>` document per spec §6.

- [ ] **Step 1: Write the failing test** — `packages/board-render/test/assemble.test.ts`

```ts
import { describe, it, expect } from "vitest";
import { compileHexMap, FIXTURE_HEX_MAP } from "@sengoku-jidai/engine";
import { buildScene } from "../src/scene.js";
import { assembleBoardSvg } from "../src/assemble.js";

const svg = assembleBoardSvg(buildScene(compileHexMap(FIXTURE_HEX_MAP)));

describe("assembleBoardSvg", () => {
  it("is a single well-formed <svg> with a viewBox", () => {
    expect(svg.startsWith("<svg")).toBe(true);
    expect(svg.trimEnd().endsWith("</svg>")).toBe(true);
    expect(svg).toContain("viewBox=");
  });

  it("splits tiles into #tile-sea and #tile-land groups with a path per area", () => {
    expect(svg).toContain(`id="tile-sea"`);
    expect(svg).toContain(`id="tile-land"`);
    // land tiles A,B,D,E and sea tile C each get an id'd path
    for (const id of ["A", "B", "C", "D", "E"]) {
      expect(svg).toMatch(new RegExp(`<path[^>]*id="${id}"`));
    }
  });

  it("includes the asset defs + stripe patterns", () => {
    expect(svg).toContain(`id="glyph-hq-red"`);
    expect(svg).toContain(`id="stripe-red"`);
  });

  it("places HQ / star / harbor glyphs for the featured tiles", () => {
    expect(svg).toContain(`href="#glyph-hq-red"`); // tile A
    expect(svg).toContain(`href="#glyph-hq-black"`); // tile E
    expect(svg).toContain(`href="#glyph-star"`); // tiles B, C
    expect(svg).toContain(`href="#glyph-harbor"`); // tile D
  });

  it("emits invisible order-slot anchors at the slotIdForSpace ids", () => {
    for (const id of ["move-A", "move-B", "shell-B", "sail-C", "bombard-C", "move-D", "move-E"]) {
      expect(svg).toContain(`id="${id}"`);
    }
  });

  it("emits the hidden hex-grid layer", () => {
    expect(svg).toMatch(/class="hex-grid"[^>]*display:none/);
  });

  it("matches the committed snapshot", () => {
    expect(svg).toMatchSnapshot();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `corepack pnpm --filter @sengoku-jidai/board-render test assemble`
Expected: FAIL — `Cannot find module '../src/assemble.js'`.

- [ ] **Step 3: Implement `src/assemble.ts`**

```ts
import { ASSETS, hqGlyph } from "./assets.js";
import type { BoardScene, SceneTile } from "./scene.js";
import type { Pixel } from "@sengoku-jidai/engine";
import { el } from "./svg.js";

const SVG_NS = "http://www.w3.org/2000/svg";
const XLINK_NS = "http://www.w3.org/1999/xlink";

function ringPath(rings: Pixel[][]): string {
  return rings
    .map((ring) => {
      const [first, ...rest] = ring;
      const move = `M${first!.x.toFixed(2)},${first!.y.toFixed(2)}`;
      const lines = rest.map((p) => `L${p.x.toFixed(2)},${p.y.toFixed(2)}`).join("");
      return `${move}${lines}Z`;
    })
    .join(" ");
}

function tilePath(tile: SceneTile): string {
  return el("path", {
    id: tile.id,
    class: "tile",
    d: ringPath(tile.rings),
    "data-authored-fill": tile.authoredFill,
    style: `fill:${tile.authoredFill}`
  });
}

function featureGlyphs(tile: SceneTile): string {
  const out: string[] = [];
  if (tile.features.hq && tile.glyphAnchors.hq) {
    out.push(ASSETS.place(hqGlyph(tile.features.hq), tile.glyphAnchors.hq));
  }
  if (tile.features.valueStars > 0 && tile.glyphAnchors.stars) {
    out.push(ASSETS.place("glyph-star", tile.glyphAnchors.stars));
  }
  if (tile.features.harbor && tile.glyphAnchors.harbor) {
    out.push(ASSETS.place("glyph-harbor", tile.glyphAnchors.harbor));
  }
  for (const port of tile.ports) {
    out.push(
      el("line", {
        x1: port.from.x.toFixed(2),
        y1: port.from.y.toFixed(2),
        x2: port.toPoint.x.toFixed(2),
        y2: port.toPoint.y.toFixed(2),
        class: "pier",
        stroke: "#5a4632",
        "stroke-width": 4,
        "stroke-dasharray": "8 6"
      })
    );
  }
  return out.join("");
}

function slotAnchors(tile: SceneTile): string {
  return Object.entries(tile.slots)
    .map(([id, at]) =>
      el("circle", { id, cx: at.x.toFixed(2), cy: at.y.toFixed(2), r: 0, class: "order-slot" })
    )
    .join("");
}

export function assembleBoardSvg(scene: BoardScene): string {
  const { x, y, width, height } = scene.viewBox;
  const sea = scene.tiles.filter((t) => t.kind === "sea");
  const land = scene.tiles.filter((t) => t.kind === "land");

  const defs = el("defs", {}, ASSETS.defs);
  const seaGroup = el("g", { id: "tile-sea" }, sea.map(tilePath).join(""));
  const landGroup = el("g", { id: "tile-land" }, land.map(tilePath).join(""));
  const grid = el(
    "g",
    { class: "hex-grid", style: "display:none" },
    scene.hexGrid
      .map((e) =>
        el("line", {
          x1: e.a.x.toFixed(2),
          y1: e.a.y.toFixed(2),
          x2: e.b.x.toFixed(2),
          y2: e.b.y.toFixed(2),
          stroke: "#0003",
          "stroke-width": 1
        })
      )
      .join("")
  );
  const features = el("g", { id: "features" }, scene.tiles.map(featureGlyphs).join(""));
  const slots = el("g", { id: "order-slots" }, scene.tiles.map(slotAnchors).join(""));

  return el(
    "svg",
    {
      xmlns: SVG_NS,
      "xmlns:xlink": XLINK_NS,
      viewBox: `${x.toFixed(2)} ${y.toFixed(2)} ${width.toFixed(2)} ${height.toFixed(2)}`
    },
    `${defs}${seaGroup}${landGroup}${grid}${features}${slots}`
  );
}
```

- [ ] **Step 4: Run test, generate + eyeball the snapshot**

Run: `corepack pnpm --filter @sengoku-jidai/board-render test assemble`
Expected: PASS (7 tests); a snapshot file is written under `packages/board-render/test/__snapshots__/`. Open it and sanity-check it is one `<svg>` with the expected groups.

- [ ] **Step 5: Export from `index.ts` + commit**

Add `export * from "./assemble.js";` to `src/index.ts`.

```bash
git add packages/board-render/src/assemble.ts packages/board-render/src/index.ts packages/board-render/test/assemble.test.ts packages/board-render/test/__snapshots__
git commit -m "feat(board-render): assembleBoardSvg — scene to decorate-compatible SVG string

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 6: Visual verification + dev preview

**Files:**
- Create: `packages/board-render/scripts/preview.ts`
- Create: `packages/board-render/PREVIEW.md` (how to regenerate + view)

**Interfaces:**
- Consumes: `compileHexMap`, `FIXTURE_HEX_MAP` from engine; `buildScene`, `assembleBoardSvg` from `../src/index.js`.

- [ ] **Step 1: Write the preview generator** — `packages/board-render/scripts/preview.ts`

```ts
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { compileHexMap, FIXTURE_HEX_MAP } from "@sengoku-jidai/engine";
import { assembleBoardSvg, buildScene } from "../src/index.js";

const here = dirname(fileURLToPath(import.meta.url));
const svg = assembleBoardSvg(buildScene(compileHexMap(FIXTURE_HEX_MAP)));
// Force the hex-grid layer visible in the preview so the fusion is inspectable.
const preview = svg.replace('class="hex-grid" style="display:none"', 'class="hex-grid"');
const out = resolve(here, "preview.svg");
writeFileSync(out, preview);
console.log("wrote", out);
```

- [ ] **Step 2: Add the `preview` script to `package.json`**

Add to `packages/board-render/package.json` scripts:

```json
"preview": "tsx scripts/preview.ts"
```

…and add `"tsx": "^4.19.2"` to its `devDependencies`. Run `corepack pnpm install`.

- [ ] **Step 3: Generate the preview SVG**

Run: `corepack pnpm --filter @sengoku-jidai/engine build && corepack pnpm --filter @sengoku-jidai/board-render preview`
Expected: `packages/board-render/scripts/preview.svg` is written.

- [ ] **Step 4: Render it to PNG via local headless Chromium and view it**

Run:
```bash
cd packages/board-render
LD_LIBRARY_PATH=$HOME/.local/chromium-deps/lib node ~/.local/bin/svgshot.mjs scripts/preview.svg scripts/preview.png 900 700
```
Then **Read `packages/board-render/scripts/preview.png`** and confirm: five fused tiles (A–E) with no internal seams, the per-hex grid overlaid, HQ glyphs on A (red) and E (black), stars on B and C, a harbor glyph on D, and a dashed pier from D to C. If anything looks wrong, fix the responsible module (outline/scene/assets/assemble) and re-run.

- [ ] **Step 5: Write `PREVIEW.md`**

```markdown
# board-render preview

Regenerate the fixture board and view it locally:

    corepack pnpm --filter @sengoku-jidai/engine build
    corepack pnpm --filter @sengoku-jidai/board-render preview
    cd packages/board-render
    LD_LIBRARY_PATH=$HOME/.local/chromium-deps/lib \
      node ~/.local/bin/svgshot.mjs scripts/preview.svg scripts/preview.png 900 700

`preview.svg`/`preview.png` are throwaway artifacts (gitignored). The hex-grid layer is
forced visible in the preview; the real assembled board hides it (editor toggles it on).
```

- [ ] **Step 6: Gitignore the throwaway artifacts**

Create `packages/board-render/.gitignore`:

```
scripts/preview.svg
scripts/preview.png
```

- [ ] **Step 7: Full gate + commit**

Run the full repo gate:
```bash
corepack pnpm typecheck && corepack pnpm test && corepack pnpm build && corepack pnpm lint && corepack pnpm exec prettier --check .
```
Expected: all green (fix prettier on the new files if it complains).

```bash
git add packages/board-render/scripts/preview.ts packages/board-render/PREVIEW.md packages/board-render/.gitignore packages/board-render/package.json pnpm-lock.yaml
git commit -m "feat(board-render): fixture preview generator + local PNG verification

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Self-Review

**Spec coverage:**
- §2 package layout → Task 1 (scaffold), files created across Tasks 1–6. ✓
- §3 outline fusion → Task 2 (`fuseTile`, quantization seam guard, ring tracing). ✓
- §4 scene model → Task 3 (`buildScene`, slots, ports, viewBox, glyph anchors, hexGrid). ✓
- §5 asset library (extract from board.svg, semantic ids, stripe patterns) → Task 4. ✓
- §6 assembler + emitted contract (`#tile-sea`/`#tile-land`, per-area paths, defs, slot anchors, hidden grid, `data-authored-fill`) → Task 5 + its contract assertions. ✓
- §7 verification (unit tests, snapshot, PNG eyeball, dev preview) → Tasks 2–6. ✓
- §8 hand-off documented in the spec; no SP3 work performed here (non-goal honored — no existing package modified). ✓
- §1 non-goals (no web/Rivers/decorate/editor/server/dynamic-state changes) → respected; only `packages/board-render` is created. ✓

**Placeholder scan:** Task 4 Step 3 ships intentional `<!-- … -->` markers that **Step 4 mandates replacing** (with a `grep` gate in Step 5 that fails if any remain). No other placeholders; all code steps show complete code.

**Type consistency:** `BoardScene`/`SceneTile`/`Edge`/`Pixel` names and shapes are defined in Tasks 2–3 and consumed unchanged in Tasks 3/5; `GlyphId`/`ASSETS.place`/`hqGlyph` defined in Task 4 and consumed in Task 5; `assembleBoardSvg(scene)` / `buildScene(compiled)` signatures match across tasks and the engine `CompiledMap` shape (`{ definition, layout }`, `layout.origin.{x,y}`, `layout.tiles[id].hexes`, `definition.areas` record). ✓
