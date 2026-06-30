# SVG Asset Library + Procedural Hex Renderer — Design

- **Date:** 2026-06-29
- **Status:** Approved (design); pending implementation plan
- **Scope:** Sub-project **2 of 6** of the **Custom Map Editor** initiative. A new framework-agnostic `packages/board-render` that turns sub-project 1's `{ definition, layout }` into board SVG. **No live `MapBoard`/Rivers changes, no `decorate()` edits, no editor UI, no server work** — those are later sub-projects.

## 0. Where this fits (the larger initiative)

The initiative builds a web-based **custom map editor**: lay out a flat-top hex grid, group hexes into game tiles, attribute features, and play the result as a real game — reusing `board.svg`'s visual building blocks composed into new layouts. The six sub-projects, in order:

1. hex data model + geometry + adjacency — **DONE** (PR #53; `compileHexMap(source) → { definition, layout }`).
2. **SVG asset library + procedural renderer** ← *this spec*.
3. migrate Rivers onto the hex renderer (re-author Rivers as a `HexMapSource`; swap `MapBoard` from the bespoke `board.svg` injection to this renderer).
4. server map library.
5. editor UI.
6. terrain for custom maps.

Sub-project 1's compiler already emits a runtime `MapDefinition` plus a separate `MapLayout` (per-tile axial hex coords, `size`/`origin`, pixel `bounds`). This sub-project consumes exactly those two outputs and produces SVG. It introduces **no engine/rules changes** and touches no existing package — it is purely additive.

## 1. Goals

After this sub-project:

1. A pure function `buildScene({ definition, layout })` produces a `BoardScene` — a fully-resolved, DOM-free description of the board's geometry (fused tile outlines, feature/unit anchors, port piers, order-slot anchors, per-hex grid edges, viewBox bounds).
2. An **asset library** (`assets.ts`) holds the reusable glyph defs (army disc, ship, HQ base, value star, harbor/pier) extracted from `board.svg`, each normalized to a known local origin and size.
3. `assembleBoardSvg(scene, assets)` produces an **SVG markup string** shaped to be a drop-in replacement for today's injected `rawMapSvg`, so sub-project 3's existing `decorate()` can drive it with only minimal, documented changes.
4. The renderer is proven on sub-project 1's **fixture map**: pure unit tests, an SVG snapshot, and a real PNG render eyeballed via local headless Chromium.

### Non-goals (explicitly out of scope for #2)

- Any change to `packages/web` (`MapBoard.tsx`, `decorate()`, `tileFill.ts`, etc.). The contract this renderer emits is **documented** here as the hand-off; wiring it in is sub-project 3.
- Re-authoring Rivers as a `HexMapSource` (sub-project 3).
- Editor UI (sub-project 5) — though the optional per-hex grid layer is emitted now so #5 can simply toggle it.
- Server storage / thumbnails (sub-project 4) — though the string output is deliberately SSR-friendly for it.
- Dynamic state rendering (units in play, supply tints, selection, highlights). Those are `decorate()`'s job and stay there. This renderer emits the **static board substrate** only — the equivalent of `board.svg`.

## 2. Package layout

A new workspace package `packages/board-render`, framework-agnostic, depending only on `@sengoku-jidai/engine` types (`MapDefinition`, `MapArea`, `MapLayout`, `Axial`, `SeatId`). It produces strings, never touches the DOM, and is unit-testable in node.

```
packages/board-render/
  package.json          # name: @sengoku-jidai/board-render; type: module; vitest
  tsconfig.json
  src/
    outline.ts          # fuse a connected hex set -> perimeter ring (pure geometry)
    scene.ts            # buildScene({definition, layout}) -> BoardScene (pure data)
    assets.ts           # asset library: glyph defs extracted from board.svg + placement
    assemble.ts         # assembleBoardSvg(scene, assets) -> SVG markup string
    svg.ts              # tiny string helpers (el(), attrs escaping) — no DOM
    index.ts            # public surface: buildScene, assembleBoardSvg, ASSETS, types
    outline.test.ts
    scene.test.ts
    assemble.test.ts
```

It is added to the pnpm workspace and the root `tsconfig`/build/test wiring exactly like the existing `packages/terrain`. No other package depends on it yet (sub-project 3 adds the web dependency).

## 3. Hex outline fusion (`outline.ts`)

A tile is a connected set of flat-top hexes; visually it is **one fused silhouette** (the union outline, no internal hex edges), matching today's Rivers look and the single `#tileN` element `decorate()` drives.

Algorithm (pure, deterministic):

1. For each member hex, generate its **6 corner points** in pixel space from `axialToPixel(hex, layout)` + the flat-top corner offsets (`size` from the layout). Corner coordinates are **quantized** to a small epsilon grid so corners shared between adjacent hexes compare exactly equal (floating-point seam guard).
2. Build the set of the tile's **boundary edges**: each hex contributes its 6 edges (corner pairs); an edge shared by two member hexes is internal and dropped. The remaining edges form the perimeter.
3. **Trace** the boundary edges into one or more closed rings by walking edge-to-edge from shared endpoints. A simply-connected tile yields one ring; the format/validator guarantees connectivity but a tile could still enclose a hole — emit each ring (outer + any holes) so the path is correct via even-odd fill.
4. Emit each ring as an ordered point array; the assembler renders it as an SVG `path` `d` (`M…L…Z`, one subpath per ring).

`outline.ts` also exposes the per-hex edge set (for the optional grid layer) and a `centroid` (area-weighted average of member-hex centres) used as the default feature/unit anchor.

Unit-tested cases: single hex (regular hexagon), straight multi-hex run, an L/concave shape, two tiles touching only at a **corner** (must NOT fuse — they are separate tiles anyway, but the shared-corner quantization must not merge their rings), and a ring-with-hole tile.

## 4. The scene model (`scene.ts`)

`buildScene({ definition, layout }): BoardScene` is pure and deterministic (tiles in `definition` order, no `Math.random`/`Date`).

```ts
interface BoardScene {
  viewBox: { x: number; y: number; width: number; height: number }; // from layout.bounds + margin
  tiles: SceneTile[];
  hexGrid: HexEdge[];        // every member hex's edges, for the optional grid layer
}

interface SceneTile {
  id: string;                // === MapArea.id (e.g. "tile9")
  kind: "land" | "sea";
  rings: Point[][];          // fused silhouette (outer + any holes)
  centroid: Point;
  authoredFill: string;      // kind default (land/sea palette) — decorate may override
  features: {
    hq?: SeatId;
    valueStars: 0 | 1 | 2;
    harbor: boolean;
  };
  /** Anchors where the assembler places feature glyphs (centroid-relative offsets resolved). */
  glyphAnchors: { hq?: Point; stars?: Point; harbor?: Point };
  /** Invisible order-slot anchors, keyed by the id slotIdForSpace() expects. */
  slots: Record<string, Point>; // e.g. { "move-tile9": {…} } / sail-/bombard-/shell-
  ports: PortPier[];         // pier segments from this harbor to each linked sea tile
}
```

Slot-anchor derivation mirrors the engine's action-space rules so the ids line up with `slotIdForSpace()`:

- every **land** tile → `move-<id>`,
- every **sea** tile → `sail-<id>` and `bombard-<id>`,
- every **shellable** land tile → `shell-<id>`.

Multiple slots on one tile are fanned around the centroid so their occupancy dots don't overlap. Port piers are drawn as short line segments from the harbor centroid toward the linked sea tile's centroid (decorative; piers are not movement edges, exactly as in sub-project 1).

## 5. The asset library (`assets.ts`)

The reusable glyphs are **extracted from `board.svg`**, where they already exist as defs referenced by `<use>` (e.g. the HQ base is `#path9-5-0-3-6`, the flag is `#g55`; army/ship/star/harbor defs likewise). Extraction:

1. Locate each glyph's def geometry in `board.svg`'s `<defs>` and copy it into `assets.ts` as a markup constant.
2. **Normalize** each to a known local origin (0,0 at the glyph's intended anchor) and a documented nominal size, removing inkscape cruft, so the assembler can place it with a single `translate`/`scale` at any tile anchor.
3. Re-id with **semantic ids** (`unit-army-red`, `unit-ship-black`, `glyph-hq`, `glyph-star`, `glyph-harbor`). Sub-project 3 updates its `ARMY_DEF`/`SHIP_DEF` constant maps to the new ids (it already edits those files), so we are not bound to the legacy `path77`-style ids.

`assets.ts` exports an `ASSETS` record: `{ defs: string /* the <defs> innerSVG */, place(glyph, at, opts?) => string /* a <use> */ }`. The defs block also includes the `stripe-red`/`stripe-black`/`stripe-source` patterns that `decorate()` injects today, so the assembled board already carries them (sub-project 3 can drop the runtime `STRIPE_PATTERNS` injection).

The glyph set in scope: army disc (per seat), ship (per seat), HQ base (per seat), value star, harbor marker. Pier segments are plain lines drawn by the assembler (no glyph needed).

## 6. The assembler & the emitted SVG contract (`assemble.ts`)

`assembleBoardSvg(scene, assets): string` returns a complete `<svg>` document string. **This is the sub-project 3 hand-off contract** — it is shaped so the existing `decorate()` works with only minimal, documented changes. The emitted structure:

```
<svg viewBox=… xmlns…>
  <defs> … asset glyph defs + stripe patterns … </defs>
  <g id="tile-sea">  <path id="<seaTileId>"  class="tile" d=… style="fill:<authoredFill>"/> … </g>
  <g id="tile-land"> <path id="<landTileId>" class="tile" d=… style="fill:<authoredFill>"/> … </g>
  <g class="hex-grid" style="display:none"> … per-hex edge lines … </g>
  <g id="features"> … <use> of HQ/star/harbor glyphs at glyphAnchors, pier <line>s … </g>
  <g id="order-slots"> … invisible <circle r=0>/<g> anchors id="move-tileN" etc. … </g>
</svg>
```

Why this shape (each point is a `decorate()` coupling today, verified against `MapBoard.tsx`):

- **Tiles are queried by `#${area.id}`** and split into `#tile-land`/`#tile-sea` parents (the supply-tint layer is appended per parent). We emit both groups with per-tile `id=<areaId>` shapes.
- **`captureAuthoredFills`/`prepareSvg`** today expect tiles as `<use>` of shared geometry defs whose styles get neutralized. Procedural tiles are unique `<path>`s with their own `d`, so there is no shared def to neutralize. We give each tile an inline `authoredFill` and a `data-authored-fill`/`class="tile"` hook directly. **Documented SP3 change:** `prepareSvg` simplifies to "read `data-authored-fill` off each `.tile`" — no `<use>`/def-neutralization needed. (Listed in §8 hand-off.)
- **Token defs** referenced by `makeToken(defId)` — SP3 points `ARMY_DEF`/`SHIP_DEF` at the new semantic ids.
- **Order-slot anchors** are queried by `slotIdForSpace()` → `#move-tileN` etc.; we emit invisible anchors at those ids so occupancy dots position unchanged.
- **Stripe patterns** are present in `<defs>` already.

`svg.ts` provides minimal string builders with correct attribute escaping; no templating dependency.

## 7. Verification strategy

Local headless Chromium now works on this box (userland lib install; see the `no-local-browser-verification` memory), so visual verification is possible here for the first time.

- **`outline.test.ts`** — fusion correctness on the cases in §3; ring orientation/closure; corner-quantization seam guard; determinism.
- **`scene.test.ts`** — slot-id derivation matches `slotIdForSpace()` expectations for land/sea/shellable; centroid/anchor sanity; viewBox encloses all rings; pier endpoints; tile order stable.
- **`assemble.test.ts`** — the output parses as valid XML; contains `#tile-land`/`#tile-sea` with a `<path id=…>` per area; one glyph `<use>` per HQ/star/harbor; an `#move-/sail-/…` anchor per derived slot; an SVG-string **snapshot** of the fixture for regression.
- **PNG eyeball** — render the fixture's `assembleBoardSvg` output to PNG via `~/.local/bin/svgshot.mjs` and view it; check fused silhouettes, glyph placement, and grid layer (forced visible) look right.
- **Dev preview** — a tiny standalone HTML/route (under `packages/board-render` or a scratch harness) that renders the fixture, so the change is inspectable without the full app. (No `packages/web` wiring.)

The standard gate (`pnpm typecheck`/`test`/`build`/`lint`/`prettier`) must pass; CI's existing suites are unaffected since no existing package changes.

## 8. Sub-project 3 hand-off (documented, not implemented here)

For SP3 to swap Rivers onto this renderer, it will:

1. Re-author Rivers as a `HexMapSource` (carrying its `startingDeployment`, every harbor keeping ≥1 port — see the `custom-map-editor-initiative` carry-forward note).
2. Replace `MapBoard`'s `import rawMapSvg from …board.svg?raw` with `assembleBoardSvg(buildScene(compileHexMap(riversSource)))`.
3. Simplify `prepareSvg` to read `data-authored-fill` off `.tile` paths (no `<use>`/def neutralization); point `ARMY_DEF`/`SHIP_DEF` at the new semantic def ids; drop the runtime `STRIPE_PATTERNS` injection (now in `<defs>`).
4. Keep `decorate()`'s overlay/supply/selection logic otherwise unchanged.

This spec fixes the emitted contract (§6) so that hand-off is mechanical.

## 9. Risks & mitigations

- **Floating-point seams between hexes** — shared corners not comparing equal would leave hairline gaps or fail edge-cancellation. Mitigation: quantize corner coords to an epsilon grid before edge dedup; a seam test covers it. (Echoes the terrain "seal anti-aliased seams" fix, PR #45.)
- **Contract drift from `decorate()`** — the emitted ids/groups must match what `MapBoard.tsx` queries. Mitigation: §6 is derived line-by-line from the current `MapBoard.tsx`; `assemble.test.ts` asserts every required hook is present.
- **Visual drift from Rivers** — re-authored glyphs could look wrong. Mitigation: glyphs are **extracted**, not redrawn; PNG eyeball on the fixture.
- **Scope creep into SP3** — easy to "just wire it into the app." Mitigation: hard non-goal (§1); no `packages/web` files touched.

## 10. Done criteria

- `packages/board-render` exists in the workspace with `outline.ts`, `scene.ts`, `assets.ts`, `assemble.ts`, `svg.ts`, `index.ts` and their tests.
- `buildScene` and `assembleBoardSvg` produce a valid, contract-conformant board SVG for the sub-project 1 fixture map.
- All new unit tests + the SVG snapshot pass; a PNG render of the fixture has been eyeballed.
- No existing package is modified; the full gate is green.
- The §6 contract and §8 hand-off are documented for sub-project 3.
