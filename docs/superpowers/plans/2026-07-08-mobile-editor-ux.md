# Mobile Map Editor UX Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the hex map editor usable on phones: bottom-docked toolbar with explicit buttons for every action, a Multi toggle replacing shift-click, two-finger pan/pinch zoom, and a responsive inspector bottom sheet.

**Architecture:** Extract the view-rect math from `EditorCanvas` into a pure module (`viewport.ts`) so pinch/zoom is unit-testable; lift the `view` state to `EditorScreen` so the dock's zoom buttons can drive it; generalize the canvas's single-pointer gesture handling to a pointer map (one finger = tool, two fingers = pan/pinch). Layout changes are CSS-only where possible.

**Tech Stack:** React 18 function components + useReducer (existing pattern), plain CSS in `packages/web/src/styles/app.css`, vitest for unit tests, Playwright for e2e. **No new dependencies.**

**Spec:** `docs/superpowers/specs/2026-07-08-mobile-editor-design.md` (approved).

## Global Constraints

- No new npm dependencies (gesture handling is hand-rolled).
- Accessible names must stay exactly: "Select tool", "Paint land", "Paint sea", "Erase", "Undo", "Redo", "Save map", "Merge tiles", "Map name", "HQ owner", "Deployment seat", "Troops", "New game on this map" — the existing e2e suite selects by them. New controls: "Multi-select", "Zoom in", "Zoom out", "Expand inspector"/"Collapse inspector".
- Stable DOM hooks must stay: `[data-testid=editor-canvas]`, `.editor-grid [data-axial="q,r"]`, `[data-tile-id]`.
- Touch targets ≥ 44×44px for dock/header/sheet controls on mobile.
- Zoom clamping: view width stays within [500, 14000] (existing MIN/MAX).
- Zoom button step: 1.4× per press, centered on the viewport.
- **Never run e2e against port 18081 — it is the LIVE prod container.** Use the port-sed recipe in Task 7.
- Branch: `mobile-editor-ux` (already created; the spec commit is on it).
- Run all commands from the repo root `/mnt/ssd_pool/martin/repos/sengoku_jidai`.
- Unit tests for the web package: `corepack pnpm build:libs && corepack pnpm --filter @sengoku-jidai/web test` (dist-consumption trap: engine/shared must be rebuilt before filtered tests).

---

### Task 1: Pure viewport math module

Extract view-rect math into `packages/web/src/editor/viewport.ts` and refactor `EditorCanvas` to use it. **No behavior change** — wheel zoom and drag-pan must work exactly as before.

**Files:**
- Create: `packages/web/src/editor/viewport.ts`
- Create: `packages/web/test/editor/viewport.test.ts`
- Modify: `packages/web/src/components/editor/EditorCanvas.tsx`

**Interfaces:**
- Consumes: nothing new.
- Produces (used by Tasks 3 and 4):
  - `interface ViewRect { x: number; y: number; width: number; height: number }`
  - `interface RectSize { width: number; height: number }`
  - `interface ViewportPoint { x: number; y: number }` (client px relative to the element's top-left)
  - `INITIAL_VIEW: ViewRect`, `MIN_VIEW_WIDTH = 500`, `MAX_VIEW_WIDTH = 14000`, `ZOOM_STEP = 1.4`
  - `toBoard(view, rect, point): ViewportPoint`
  - `zoomView(view, rect, factor, focus): ViewRect` (factor > 1 zooms out; keeps board point under `focus` fixed)
  - `zoomViewCentered(view, factor): ViewRect`
  - `pinchView(view, rect, prev: [ViewportPoint, ViewportPoint], curr: [ViewportPoint, ViewportPoint]): ViewRect`

- [ ] **Step 1: Write the failing test**

Create `packages/web/test/editor/viewport.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  MAX_VIEW_WIDTH,
  MIN_VIEW_WIDTH,
  pinchView,
  toBoard,
  zoomView,
  zoomViewCentered,
  type ViewRect
} from "../../src/editor/viewport.js";

const rect = { width: 1000, height: 800 };
const view: ViewRect = { x: 0, y: 0, width: 2000, height: 1600 };

describe("toBoard", () => {
  it("maps element pixels to board coordinates", () => {
    expect(toBoard(view, rect, { x: 250, y: 200 })).toEqual({ x: 500, y: 400 });
    expect(toBoard({ ...view, x: -100, y: 50 }, rect, { x: 0, y: 0 })).toEqual({ x: -100, y: 50 });
  });
});

describe("zoomView", () => {
  it("keeps the board point under the focus fixed", () => {
    const focus = { x: 250, y: 200 };
    const before = toBoard(view, rect, focus);
    const zoomed = zoomView(view, rect, 0.5, focus);
    expect(zoomed.width).toBe(1000);
    expect(zoomed.height).toBe(800);
    const after = toBoard(zoomed, rect, focus);
    expect(after.x).toBeCloseTo(before.x);
    expect(after.y).toBeCloseTo(before.y);
  });

  it("clamps width to [MIN_VIEW_WIDTH, MAX_VIEW_WIDTH] and keeps the aspect ratio", () => {
    const out = zoomView(view, rect, 100, { x: 500, y: 400 });
    expect(out.width).toBe(MAX_VIEW_WIDTH);
    expect(out.height / out.width).toBeCloseTo(view.height / view.width);
    const inn = zoomView(view, rect, 0.01, { x: 500, y: 400 });
    expect(inn.width).toBe(MIN_VIEW_WIDTH);
  });
});

describe("zoomViewCentered", () => {
  it("scales around the view center", () => {
    const out = zoomViewCentered(view, 2);
    expect(out).toEqual({ x: -1000, y: -800, width: 4000, height: 3200 });
    expect(out.x + out.width / 2).toBe(view.x + view.width / 2);
    expect(out.y + out.height / 2).toBe(view.y + view.height / 2);
  });

  it("clamps like zoomView", () => {
    expect(zoomViewCentered(view, 100).width).toBe(MAX_VIEW_WIDTH);
    expect(zoomViewCentered(view, 0.01).width).toBe(MIN_VIEW_WIDTH);
  });
});

describe("pinchView", () => {
  it("pure two-finger drag pans without zooming", () => {
    const prev: [{ x: number; y: number }, { x: number; y: number }] = [
      { x: 100, y: 100 },
      { x: 300, y: 100 }
    ];
    const curr: [{ x: number; y: number }, { x: number; y: number }] = [
      { x: 150, y: 150 },
      { x: 350, y: 150 }
    ];
    const out = pinchView(view, rect, prev, curr);
    expect(out.width).toBe(view.width);
    // Fingers moved +50px right/down; the view rect shifts opposite so content follows.
    expect(out.x).toBeCloseTo(-100);
    expect(out.y).toBeCloseTo(-100);
  });

  it("spreading fingers zooms in around the (stationary) centroid", () => {
    const prev: [{ x: number; y: number }, { x: number; y: number }] = [
      { x: 400, y: 400 },
      { x: 600, y: 400 }
    ];
    const curr: [{ x: number; y: number }, { x: number; y: number }] = [
      { x: 300, y: 400 },
      { x: 700, y: 400 }
    ];
    const mid = { x: 500, y: 400 };
    const anchor = toBoard(view, rect, mid);
    const out = pinchView(view, rect, prev, curr);
    expect(out.width).toBe(1000); // distance doubled → width halved
    const after = toBoard(out, rect, mid);
    expect(after.x).toBeCloseTo(anchor.x);
    expect(after.y).toBeCloseTo(anchor.y);
  });

  it("guards against a zero current distance", () => {
    const prev: [{ x: number; y: number }, { x: number; y: number }] = [
      { x: 100, y: 100 },
      { x: 300, y: 100 }
    ];
    const curr: [{ x: number; y: number }, { x: number; y: number }] = [
      { x: 200, y: 100 },
      { x: 200, y: 100 }
    ];
    const out = pinchView(view, rect, prev, curr);
    expect(out.width).toBe(view.width);
    expect(Number.isFinite(out.x)).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `corepack pnpm build:libs && corepack pnpm --filter @sengoku-jidai/web exec vitest run test/editor/viewport.test.ts`
Expected: FAIL — cannot resolve `../../src/editor/viewport.js`.

- [ ] **Step 3: Write the implementation**

Create `packages/web/src/editor/viewport.ts`:

```ts
/** Pure view-rect math for the editor canvas (SVG viewBox pan/zoom). */

export interface ViewRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface RectSize {
  width: number;
  height: number;
}

/** Client-pixel point relative to the SVG element's top-left corner. */
export interface ViewportPoint {
  x: number;
  y: number;
}

export const INITIAL_VIEW: ViewRect = { x: -900, y: -700, width: 2600, height: 2000 };
export const MIN_VIEW_WIDTH = 500;
export const MAX_VIEW_WIDTH = 14000;
export const ZOOM_STEP = 1.4;

function clampFactor(view: ViewRect, factor: number): number {
  const width = Math.min(Math.max(view.width * factor, MIN_VIEW_WIDTH), MAX_VIEW_WIDTH);
  return width / view.width;
}

export function toBoard(view: ViewRect, rect: RectSize, point: ViewportPoint): ViewportPoint {
  return {
    x: view.x + (point.x / rect.width) * view.width,
    y: view.y + (point.y / rect.height) * view.height
  };
}

/** Scale by `factor` (>1 zooms out) keeping the board point under `focus` fixed. */
export function zoomView(
  view: ViewRect,
  rect: RectSize,
  factor: number,
  focus: ViewportPoint
): ViewRect {
  const scale = clampFactor(view, factor);
  const board = toBoard(view, rect, focus);
  return {
    x: board.x - (board.x - view.x) * scale,
    y: board.y - (board.y - view.y) * scale,
    width: view.width * scale,
    height: view.height * scale
  };
}

/** Scale by `factor` around the view center (the dock's zoom buttons). */
export function zoomViewCentered(view: ViewRect, factor: number): ViewRect {
  const scale = clampFactor(view, factor);
  const width = view.width * scale;
  const height = view.height * scale;
  return {
    x: view.x + (view.width - width) / 2,
    y: view.y + (view.height - height) / 2,
    width,
    height
  };
}

/** One incremental two-finger update: scale from the spread change (around the
 *  moving centroid) plus the centroid drag. Equal spreads degrade to a pure pan. */
export function pinchView(
  view: ViewRect,
  rect: RectSize,
  prev: [ViewportPoint, ViewportPoint],
  curr: [ViewportPoint, ViewportPoint]
): ViewRect {
  const prevDist = Math.hypot(prev[0].x - prev[1].x, prev[0].y - prev[1].y);
  const currDist = Math.hypot(curr[0].x - curr[1].x, curr[0].y - curr[1].y);
  const prevMid = { x: (prev[0].x + prev[1].x) / 2, y: (prev[0].y + prev[1].y) / 2 };
  const currMid = { x: (curr[0].x + curr[1].x) / 2, y: (curr[0].y + curr[1].y) / 2 };
  const scale = clampFactor(view, currDist > 0 ? prevDist / currDist : 1);
  const anchor = toBoard(view, rect, prevMid);
  const width = view.width * scale;
  const height = view.height * scale;
  return {
    x: anchor.x - (currMid.x / rect.width) * width,
    y: anchor.y - (currMid.y / rect.height) * height,
    width,
    height
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `corepack pnpm --filter @sengoku-jidai/web exec vitest run test/editor/viewport.test.ts`
Expected: PASS (all 8 tests).

- [ ] **Step 5: Refactor EditorCanvas to use the module (no behavior change)**

In `packages/web/src/components/editor/EditorCanvas.tsx`:

Replace the local constants (lines 18–20):

```ts
const INITIAL_VIEW = { x: -900, y: -700, width: 2600, height: 2000 };
const MIN_VIEW_WIDTH = 500;
const MAX_VIEW_WIDTH = 14000;
```

with an import (and delete the now-unused constants):

```ts
import { INITIAL_VIEW, toBoard, zoomView, type ViewportPoint } from "../../editor/viewport.js";
```

Replace the `toBoard` helper function inside the component:

```ts
  function toBoardPoint(client: { clientX: number; clientY: number }): Pixel {
    const rect = svgRef.current!.getBoundingClientRect();
    return toBoard(view, rect, { x: client.clientX - rect.left, y: client.clientY - rect.top });
  }
```

(rename its two call sites — in `paintAt` and `handlePointerUp` — from `toBoard(client)` to `toBoardPoint(client)`).

Replace the body of `handleWheel` inside the `useEffect`:

```ts
    const handleWheel = (event: WheelEvent) => {
      event.preventDefault();
      const rect = svg.getBoundingClientRect();
      const focus: ViewportPoint = { x: event.clientX - rect.left, y: event.clientY - rect.top };
      setView((v) => zoomView(v, rect, Math.exp(event.deltaY * 0.001), focus));
    };
```

- [ ] **Step 6: Run the full web test suite and typecheck**

Run: `corepack pnpm --filter @sengoku-jidai/web test && corepack pnpm --filter @sengoku-jidai/web typecheck`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/web/src/editor/viewport.ts packages/web/test/editor/viewport.test.ts packages/web/src/components/editor/EditorCanvas.tsx
git commit -m "refactor(web): extract editor viewport math into a pure module"
```

---

### Task 2: `multiSelect` reducer state

Add a sticky multi-select mode to the editor reducer; make the canvas treat it like shift.

**Files:**
- Modify: `packages/web/src/editor/reducer.ts`
- Create: `packages/web/test/editor/reducer-multiselect.test.ts`
- Modify: `packages/web/src/components/editor/EditorCanvas.tsx`

**Interfaces:**
- Consumes: existing `selectTile` action's `additive` flag (no reducer logic change there).
- Produces (used by Task 3): `EditorState.multiSelect: boolean`, action `{ type: "setMultiSelect"; enabled: boolean }`.

- [ ] **Step 1: Write the failing test**

Create `packages/web/test/editor/reducer-multiselect.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { emptyDoc } from "../../src/editor/doc.js";
import { editorReducer, initialEditorState } from "../../src/editor/reducer.js";

function twoTiles() {
  return initialEditorState({
    ...emptyDoc(),
    tiles: [
      { id: "t1", kind: "land", hexes: [{ q: 0, r: 0 }], features: {} },
      { id: "t2", kind: "land", hexes: [{ q: 1, r: 0 }], features: {} }
    ],
    nextTileNumber: 3
  });
}

describe("multi-select mode", () => {
  it("starts off and toggles via setMultiSelect", () => {
    let state = twoTiles();
    expect(state.multiSelect).toBe(false);
    state = editorReducer(state, { type: "setMultiSelect", enabled: true });
    expect(state.multiSelect).toBe(true);
    state = editorReducer(state, { type: "setMultiSelect", enabled: false });
    expect(state.multiSelect).toBe(false);
  });

  it("survives tool switches but resets on loadDoc", () => {
    let state = editorReducer(twoTiles(), { type: "setMultiSelect", enabled: true });
    state = editorReducer(state, { type: "setTool", tool: "land" });
    expect(state.multiSelect).toBe(true);
    state = editorReducer(state, { type: "loadDoc", doc: emptyDoc() });
    expect(state.multiSelect).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `corepack pnpm --filter @sengoku-jidai/web exec vitest run test/editor/reducer-multiselect.test.ts`
Expected: FAIL — `state.multiSelect` is `undefined`; TS error on the unknown action type.

- [ ] **Step 3: Implement in the reducer**

In `packages/web/src/editor/reducer.ts`:

Add to `EditorState` (after the `portArming` field):

```ts
  /** Sticky multi-select mode: taps add/remove tiles like shift-click (Select tool only). */
  multiSelect: boolean;
```

Add to the `EditorAction` union (after the `armPort` entry):

```ts
  | { type: "setMultiSelect"; enabled: boolean }
```

In `initialEditorState`, add the field:

```ts
export function initialEditorState(doc: EditorDoc): EditorState {
  return { doc, tool: "land", selection: [], portArming: false, multiSelect: false, past: [], future: [] };
}
```

Add a reducer case (next to `armPort`):

```ts
    case "setMultiSelect":
      return { ...state, multiSelect: action.enabled };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `corepack pnpm --filter @sengoku-jidai/web exec vitest run test/editor/reducer-multiselect.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Use it in the canvas tap-select**

In `packages/web/src/components/editor/EditorCanvas.tsx`, destructure the new field
(`const { doc, tool, selection } = state;` becomes):

```ts
  const { doc, tool, selection, multiSelect } = state;
```

and in `handlePointerUp` change the dispatch to:

```ts
    dispatch({
      type: "selectTile",
      tileId: tile?.id ?? null,
      additive: event.shiftKey || multiSelect
    });
```

- [ ] **Step 6: Run the full web test suite and typecheck**

Run: `corepack pnpm --filter @sengoku-jidai/web test && corepack pnpm --filter @sengoku-jidai/web typecheck`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/web/src/editor/reducer.ts packages/web/test/editor/reducer-multiselect.test.ts packages/web/src/components/editor/EditorCanvas.tsx
git commit -m "feat(web): sticky multi-select mode in the editor reducer"
```

---

### Task 3: Bottom dock

Rewrite `EditorToolbar` as a bottom-docked icon toolbar (tools, Multi, undo/redo, zoom); lift the view state to `EditorScreen` so zoom buttons can drive it.

**Files:**
- Modify: `packages/web/src/components/editor/EditorToolbar.tsx` (full rewrite)
- Modify: `packages/web/src/components/editor/EditorScreen.tsx`
- Modify: `packages/web/src/components/editor/EditorCanvas.tsx`
- Modify: `packages/web/src/styles/app.css`

**Interfaces:**
- Consumes: `EditorState.multiSelect` + `setMultiSelect` (Task 2); `INITIAL_VIEW`, `ZOOM_STEP`, `zoomViewCentered`, `ViewRect` (Task 1).
- Produces (used by Task 4): `EditorCanvas` props become `{ state, dispatch, view: ViewRect, onViewChange: Dispatch<SetStateAction<ViewRect>> }`.
- Accessible names (Global Constraints): tools keep "Select tool"/"Paint land"/"Paint sea"/"Erase" via `aria-label`; new "Multi-select", "Zoom in", "Zoom out".

- [ ] **Step 1: Rewrite EditorToolbar as the dock**

Replace the full contents of `packages/web/src/components/editor/EditorToolbar.tsx`:

```tsx
import type { Dispatch } from "react";
import type { EditorAction, EditorState, Tool } from "../../editor/reducer.js";

const TOOLS: { tool: Tool; label: string; ariaLabel: string; glyph: string }[] = [
  { tool: "select", label: "Select", ariaLabel: "Select tool", glyph: "⌖" },
  { tool: "land", label: "Land", ariaLabel: "Paint land", glyph: "⬢" },
  { tool: "sea", label: "Sea", ariaLabel: "Paint sea", glyph: "⬢" },
  { tool: "erase", label: "Erase", ariaLabel: "Erase", glyph: "⌫" }
];

interface EditorToolbarProps {
  state: EditorState;
  dispatch: Dispatch<EditorAction>;
  onZoomIn: () => void;
  onZoomOut: () => void;
}

export function EditorToolbar({ state, dispatch, onZoomIn, onZoomOut }: EditorToolbarProps) {
  return (
    <div className="editor-dock" role="toolbar" aria-label="Editor tools">
      <div className="dock-group">
        {TOOLS.map(({ tool, label, ariaLabel, glyph }) => (
          <button
            key={tool}
            type="button"
            aria-label={ariaLabel}
            aria-pressed={state.tool === tool}
            className={`dock-button${state.tool === tool ? " is-active" : ""}`}
            onClick={() => dispatch({ type: "setTool", tool })}
          >
            <span className={`dock-glyph is-${tool}`} aria-hidden="true">
              {glyph}
            </span>
            <span className="dock-label">{label}</span>
          </button>
        ))}
        <button
          type="button"
          aria-label="Multi-select"
          aria-pressed={state.multiSelect}
          disabled={state.tool !== "select"}
          className={`dock-button${state.multiSelect ? " is-active" : ""}`}
          onClick={() => dispatch({ type: "setMultiSelect", enabled: !state.multiSelect })}
        >
          <span className="dock-glyph" aria-hidden="true">
            ⧉
          </span>
          <span className="dock-label">Multi</span>
        </button>
      </div>
      <div className="dock-group">
        <button
          type="button"
          aria-label="Undo"
          className="dock-button"
          disabled={state.past.length === 0}
          onClick={() => dispatch({ type: "undo" })}
        >
          <span className="dock-glyph" aria-hidden="true">
            ↶
          </span>
          <span className="dock-label">Undo</span>
        </button>
        <button
          type="button"
          aria-label="Redo"
          className="dock-button"
          disabled={state.future.length === 0}
          onClick={() => dispatch({ type: "redo" })}
        >
          <span className="dock-glyph" aria-hidden="true">
            ↷
          </span>
          <span className="dock-label">Redo</span>
        </button>
      </div>
      <div className="dock-group">
        <button type="button" aria-label="Zoom out" className="dock-button" onClick={onZoomOut}>
          <span className="dock-glyph" aria-hidden="true">
            −
          </span>
          <span className="dock-label">Out</span>
        </button>
        <button type="button" aria-label="Zoom in" className="dock-button" onClick={onZoomIn}>
          <span className="dock-glyph" aria-hidden="true">
            +
          </span>
          <span className="dock-label">In</span>
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Lift view state into EditorScreen**

In `packages/web/src/components/editor/EditorScreen.tsx`:

Add imports:

```ts
import { INITIAL_VIEW, ZOOM_STEP, zoomViewCentered } from "../../editor/viewport.js";
```

Add state next to the other `useState` calls:

```ts
  const [view, setView] = useState(INITIAL_VIEW);
```

Replace the `editor-body` block at the bottom of the component (the dock moves out of
`editor-body` to the bottom of the shell):

```tsx
      <div className="editor-body">
        {previewResult ? (
          previewResult.svg ? (
            <div
              className="editor-preview"
              dangerouslySetInnerHTML={{ __html: previewResult.svg }}
            />
          ) : (
            <p className="error-text editor-preview">Preview unavailable: {previewResult.error}</p>
          )
        ) : (
          <EditorCanvas state={state} dispatch={dispatch} view={view} onViewChange={setView} />
        )}
        <InspectorPanel state={state} dispatch={dispatch} />
      </div>
      <EditorToolbar
        state={state}
        dispatch={dispatch}
        onZoomIn={() => setView((v) => zoomViewCentered(v, 1 / ZOOM_STEP))}
        onZoomOut={() => setView((v) => zoomViewCentered(v, ZOOM_STEP))}
      />
```

- [ ] **Step 3: Make EditorCanvas take view/onViewChange as props**

In `packages/web/src/components/editor/EditorCanvas.tsx`:

Update the imports — drop `useState`, add `SetStateAction`, drop `INITIAL_VIEW`, add `ViewRect`:

```ts
import {
  useEffect,
  useRef,
  type Dispatch,
  type PointerEvent as ReactPointerEvent,
  type SetStateAction
} from "react";
...
import { toBoard, zoomView, type ViewportPoint, type ViewRect } from "../../editor/viewport.js";
```

Update the props interface and signature:

```tsx
interface EditorCanvasProps {
  state: EditorState;
  dispatch: Dispatch<EditorAction>;
  view: ViewRect;
  onViewChange: Dispatch<SetStateAction<ViewRect>>;
}

export function EditorCanvas({ state, dispatch, view, onViewChange }: EditorCanvasProps) {
```

Delete the line `const [view, setView] = useState(INITIAL_VIEW);` and rename every
remaining `setView(` call to `onViewChange(` (one in `handlePointerMove`, one in
`handleWheel`). Add `onViewChange` to the wheel effect's dependency array:
`}, [onViewChange]);`.

- [ ] **Step 4: Replace the toolbar CSS with dock CSS**

In `packages/web/src/styles/app.css`:

Change `.editor-shell` to use dynamic viewport height (mobile browser chrome):

```css
.editor-shell {
  display: flex;
  flex-direction: column;
  height: 100vh;
  height: 100dvh;
}
```

Replace the `.editor-toolbar` and `.editor-toolbar .is-active` rules (lines ~1064–1073) with:

```css
.editor-dock {
  display: flex;
  justify-content: center;
  gap: 14px;
  padding: 6px 12px calc(6px + env(safe-area-inset-bottom));
  border-top: 1px solid var(--hairline);
  background: var(--washi-raised);
  box-shadow: 0 -2px 10px rgba(0, 0, 0, 0.12);
  overflow-x: auto;
  flex-shrink: 0;
}
.dock-group {
  display: flex;
  gap: 6px;
}
.dock-group + .dock-group {
  border-left: 1px solid var(--hairline);
  padding-left: 14px;
}
.dock-button {
  min-width: 44px;
  min-height: 44px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 2px;
  padding: 4px 8px;
}
.dock-button .dock-glyph {
  font-size: 1.3rem;
  line-height: 1;
}
.dock-glyph.is-land {
  color: #dcc98f;
}
.dock-glyph.is-sea {
  color: #9fc3d8;
}
.dock-button.is-active {
  outline: 2px solid #4a6fa5;
}
.dock-label {
  font-size: 0.7rem;
}
@media (max-width: 900px) {
  .dock-label {
    display: none;
  }
  .editor-dock {
    gap: 8px;
    justify-content: space-between;
  }
}
```

- [ ] **Step 5: Build, typecheck, unit tests**

Run: `corepack pnpm --filter @sengoku-jidai/web build && corepack pnpm --filter @sengoku-jidai/web typecheck && corepack pnpm --filter @sengoku-jidai/web test`
Expected: PASS.

- [ ] **Step 6: Run the existing desktop editor e2e locally**

Temp-port recipe (18081 is the LIVE prod container — never test against it):

```bash
export SCRATCHPAD=/tmp/claude-3000/-mnt-ssd-pool-martin-repos-sengoku-jidai/364bbd6b-1c22-4871-92fd-fa71e4ea0a1d/scratchpad
sed -i 's/18081/18099/g' playwright.config.ts
sed -i 's/"3000"/"3009"/' playwright.config.ts
```

In `packages/web/vite.config.ts`, temporarily add a cacheDir line inside `defineConfig({`
(dodges the root-owned `node_modules/.vite`):

```ts
export default defineConfig({
  cacheDir: process.env.VITE_CACHE_DIR ?? "node_modules/.vite",
  plugins: [react()],
```

Then:

```bash
LD_LIBRARY_PATH=$HOME/.local/chromium-deps/lib \
VITE_CACHE_DIR=$SCRATCHPAD/vite-cache \
PLAYWRIGHT_HTML_REPORT=$SCRATCHPAD/pw-report \
corepack pnpm exec playwright test tests/e2e/map-editor.spec.ts --output=$SCRATCHPAD/pw-results
```

Expected: PASS — the dock preserves all accessible names. Revert the temporary config
overrides afterwards: `git checkout playwright.config.ts packages/web/vite.config.ts`.

- [ ] **Step 7: Commit**

```bash
git add packages/web/src/components/editor/EditorToolbar.tsx packages/web/src/components/editor/EditorScreen.tsx packages/web/src/components/editor/EditorCanvas.tsx packages/web/src/styles/app.css
git commit -m "feat(web): bottom-docked editor toolbar with multi-select and zoom buttons"
```

---

### Task 4: Two-finger pan and pinch zoom

Generalize `EditorCanvas` pointer handling to a pointer map: one finger = active tool, second finger = pan/pinch until all fingers lift.

**Files:**
- Modify: `packages/web/src/components/editor/EditorCanvas.tsx`

**Interfaces:**
- Consumes: `pinchView`, `ViewportPoint` (Task 1); `onViewChange` prop (Task 3).
- Produces: behavior only — no API change. The pinch math is already unit-tested (Task 1); this task is wiring, verified by the mobile e2e (Task 6).

- [ ] **Step 1: Extend the gesture model**

In `packages/web/src/components/editor/EditorCanvas.tsx`:

Add `pinchView` to the viewport import:

```ts
import { pinchView, toBoard, zoomView, type ViewportPoint, type ViewRect } from "../../editor/viewport.js";
```

Update the `Gesture` interface's mode:

```ts
interface Gesture {
  mode: "paint" | "pan" | "pinch";
  startClientX: number;
  startClientY: number;
  viewX: number;
  viewY: number;
  moved: boolean;
  lastAxial: string | null;
}
```

Add a pointer map ref next to `gestureRef` and a helper:

```ts
  const pointersRef = useRef(new Map<number, ViewportPoint>());

  function relativePoint(event: ReactPointerEvent<SVGSVGElement>): ViewportPoint {
    const rect = svgRef.current!.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  }
```

- [ ] **Step 2: Replace the three pointer handlers**

```tsx
  function handlePointerDown(event: ReactPointerEvent<SVGSVGElement>) {
    // Synthetic pointer events (dispatched by tests) have no active pointer to capture.
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      /* ignore */
    }
    const pointers = pointersRef.current;
    if (pointers.size >= 2) {
      return; // ignore fingers beyond the second
    }
    pointers.set(event.pointerId, relativePoint(event));
    if (pointers.size === 2) {
      // A second finger always means pan/pinch, abandoning any paint stroke
      // (already-painted hexes stay; undo covers mistakes).
      gestureRef.current = {
        mode: "pinch",
        startClientX: event.clientX,
        startClientY: event.clientY,
        viewX: view.x,
        viewY: view.y,
        moved: true,
        lastAxial: null
      };
      return;
    }
    const gesture: Gesture = {
      mode: tool !== "select" && event.button === 0 ? "paint" : "pan",
      startClientX: event.clientX,
      startClientY: event.clientY,
      viewX: view.x,
      viewY: view.y,
      moved: false,
      lastAxial: null
    };
    gestureRef.current = gesture;
    if (gesture.mode === "paint") {
      paintAt(event);
    }
  }

  function handlePointerMove(event: ReactPointerEvent<SVGSVGElement>) {
    const gesture = gestureRef.current;
    const pointers = pointersRef.current;
    if (!gesture || !pointers.has(event.pointerId)) {
      return;
    }
    if (gesture.mode === "pinch") {
      if (pointers.size === 2) {
        const rect = svgRef.current!.getBoundingClientRect();
        const prev = [...pointers.values()] as [ViewportPoint, ViewportPoint];
        pointers.set(event.pointerId, relativePoint(event));
        const curr = [...pointers.values()] as [ViewportPoint, ViewportPoint];
        onViewChange((v) => pinchView(v, rect, prev, curr));
      }
      return;
    }
    pointers.set(event.pointerId, relativePoint(event));
    if (
      Math.abs(event.clientX - gesture.startClientX) +
        Math.abs(event.clientY - gesture.startClientY) >
      3
    ) {
      gesture.moved = true;
    }
    if (gesture.mode === "paint") {
      paintAt(event);
      return;
    }
    const rect = svgRef.current!.getBoundingClientRect();
    const dx = ((event.clientX - gesture.startClientX) / rect.width) * view.width;
    const dy = ((event.clientY - gesture.startClientY) / rect.height) * view.height;
    onViewChange((v) => ({ ...v, x: gesture.viewX - dx, y: gesture.viewY - dy }));
  }

  function handlePointerUp(event: ReactPointerEvent<SVGSVGElement>) {
    const pointers = pointersRef.current;
    pointers.delete(event.pointerId);
    const gesture = gestureRef.current;
    if (gesture?.mode === "pinch") {
      // Stay inert (no painting) with one finger left; the gesture ends when all lift.
      if (pointers.size === 0) {
        gestureRef.current = null;
      }
      return;
    }
    gestureRef.current = null;
    if (!gesture || gesture.mode !== "pan" || gesture.moved || tool !== "select") {
      return;
    }
    const hex = pixelToAxial(toBoardPoint(event), doc.layout);
    const tile = tileAt(doc, hex);
    dispatch({
      type: "selectTile",
      tileId: tile?.id ?? null,
      additive: event.shiftKey || multiSelect
    });
  }
```

Note: `Map.set` on an existing key keeps insertion order, so the `prev`/`curr` spreads in
the pinch branch pair up the same two pointers in the same order.

- [ ] **Step 3: Handle pointercancel**

On the `<svg>` element add:

```tsx
      onPointerCancel={handlePointerUp}
```

- [ ] **Step 4: Build, typecheck, unit tests**

Run: `corepack pnpm --filter @sengoku-jidai/web build && corepack pnpm --filter @sengoku-jidai/web typecheck && corepack pnpm --filter @sengoku-jidai/web test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/web/src/components/editor/EditorCanvas.tsx
git commit -m "feat(web): two-finger pan and pinch zoom on the editor canvas"
```

---

### Task 5: Responsive inspector bottom sheet and header wrap

On <900px the inspector becomes a collapsible bottom sheet; the header wraps to two rows. Desktop keeps the side panel (toggle hidden by CSS — the body is hidden only inside the media query, so wide screens are unaffected by the collapsed state).

**Files:**
- Modify: `packages/web/src/components/editor/InspectorPanel.tsx` (full rewrite)
- Modify: `packages/web/src/styles/app.css`

**Interfaces:**
- Consumes: nothing new.
- Produces: DOM structure `.editor-inspector[.is-collapsed] > .inspector-header + .inspector-body`; button accessible names "Expand inspector"/"Collapse inspector" (used by Task 6's e2e only implicitly — the sheet auto-expands on selection).

- [ ] **Step 1: Rewrite InspectorPanel**

Replace the full contents of `packages/web/src/components/editor/InspectorPanel.tsx`.
The three content branches are unchanged except: their `<h2>` headings move into the
shared sheet header, and the map-summary hint text changes to the new copy.

```tsx
import { useEffect, useState, type Dispatch, type ReactNode } from "react";
import type { HexTileSource, SeatId } from "@sengoku-jidai/engine/client";
import { riversRuleset } from "@sengoku-jidai/engine/client";
import { canMergeSelection, type EditorAction, type EditorState } from "../../editor/reducer.js";

export function InspectorPanel({
  state,
  dispatch
}: {
  state: EditorState;
  dispatch: Dispatch<EditorAction>;
}) {
  const { doc, selection } = state;
  const primary = doc.tiles.find((t) => t.id === selection[0]);
  // On phones the panel is a bottom sheet, collapsed by default; selecting opens it.
  // On desktop the toggle and the collapsed state are inert (CSS ignores them).
  const [collapsed, setCollapsed] = useState(true);
  const selectionKey = selection.join(",");
  useEffect(() => {
    if (selectionKey !== "") {
      setCollapsed(false);
    }
  }, [selectionKey]);

  const title =
    selection.length > 1
      ? `${selection.length} tiles selected`
      : primary
        ? `${primary.kind === "land" ? "Land tile" : "Sea tile"} · ${primary.hexes.length} ${
            primary.hexes.length === 1 ? "hex" : "hexes"
          }`
        : `Map · ${doc.tiles.length} ${doc.tiles.length === 1 ? "tile" : "tiles"}`;

  return (
    <aside className={`editor-inspector${collapsed ? " is-collapsed" : ""}`}>
      <div className="inspector-header" onClick={() => setCollapsed((c) => !c)}>
        <h2>{title}</h2>
        <button
          type="button"
          className="inspector-toggle"
          aria-expanded={!collapsed}
          aria-label={collapsed ? "Expand inspector" : "Collapse inspector"}
          onClick={(event) => {
            event.stopPropagation();
            setCollapsed((c) => !c);
          }}
        >
          {collapsed ? "▲" : "▼"}
        </button>
      </div>
      <div className="inspector-body">
        {selection.length > 1 ? (
          <MultiBody state={state} dispatch={dispatch} />
        ) : primary ? (
          <TileBody primary={primary} state={state} dispatch={dispatch} />
        ) : (
          <SummaryBody state={state} />
        )}
      </div>
    </aside>
  );
}

function MultiBody({
  state,
  dispatch
}: {
  state: EditorState;
  dispatch: Dispatch<EditorAction>;
}): ReactNode {
  const { doc, selection } = state;
  return (
    <>
      <button
        type="button"
        className="primary-action"
        disabled={!canMergeSelection(doc, selection)}
        onClick={() => dispatch({ type: "mergeSelection" })}
      >
        Merge tiles
      </button>
      <p className="muted">Merging requires the same kind and touching edges.</p>
    </>
  );
}

function SummaryBody({ state }: { state: EditorState }): ReactNode {
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
      <p className="muted">Tap a tile to edit it; use Multi to select several.</p>
    </>
  );
}

function TileBody({
  primary,
  state,
  dispatch
}: {
  primary: HexTileSource;
  state: EditorState;
  dispatch: Dispatch<EditorAction>;
}): ReactNode {
  const { doc } = state;
  const tileId = primary.id;
  const deployment = doc.startingDeployment[tileId];
  const isLand = primary.kind === "land";

  return (
    <>
      {isLand ? (
        <>
          <label className="field">
            <span>HQ owner</span>
            <select
              value={primary.features.hq ?? "none"}
              onChange={(event) =>
                dispatch({
                  type: "setFeature",
                  tileId,
                  patch: {
                    hq: event.target.value === "none" ? null : (event.target.value as SeatId)
                  }
                })
              }
            >
              <option value="none">None</option>
              <option value="red">Red</option>
              <option value="black">Black</option>
            </select>
          </label>
          <label className="field">
            <span>Value stars</span>
            <select
              value={primary.features.valueStars ?? 0}
              onChange={(event) =>
                dispatch({
                  type: "setFeature",
                  tileId,
                  patch: { valueStars: Number(event.target.value) as 0 | 1 | 2 }
                })
              }
            >
              <option value={0}>None</option>
              <option value={1}>★</option>
              <option value={2}>★★</option>
            </select>
          </label>
          <label className="check">
            <input
              type="checkbox"
              checked={primary.features.shellable === true}
              onChange={(event) =>
                dispatch({ type: "setFeature", tileId, patch: { shellable: event.target.checked } })
              }
            />
            <span>Shellable</span>
          </label>
        </>
      ) : null}

      <label className="check">
        <input
          type="checkbox"
          checked={primary.features.harbor === true}
          onChange={(event) =>
            dispatch({ type: "setFeature", tileId, patch: { harbor: event.target.checked } })
          }
        />
        <span>Harbor</span>
      </label>

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

      <label className="check">
        <input
          type="checkbox"
          checked={doc.bonusSlots.includes(tileId)}
          onChange={() => dispatch({ type: "toggleBonusSlot", tileId })}
        />
        <span>Bonus slot</span>
      </label>

      <h3>Starting deployment</h3>
      <label className="field">
        <span>Deployment seat</span>
        <select
          value={deployment?.seat ?? "none"}
          onChange={(event) => {
            const value = event.target.value;
            if (value === "none") {
              dispatch({ type: "setDeployment", tileId, units: null });
            } else {
              const seat = value as SeatId;
              dispatch({
                type: "setDeployment",
                tileId,
                units: deployment
                  ? { ...deployment, seat }
                  : { seat, ...(isLand ? { troop: 1 } : { ship: 1 }) }
              });
            }
          }}
        >
          <option value="none">None</option>
          <option value="red">Red</option>
          <option value="black">Black</option>
        </select>
      </label>
      {deployment ? (
        <>
          {isLand ? (
            <label className="field">
              <span>Troops</span>
              <input
                type="number"
                min={0}
                max={20}
                value={deployment.troop ?? 0}
                onChange={(event) =>
                  dispatch({
                    type: "setDeployment",
                    tileId,
                    units: { ...deployment, troop: Math.max(0, Number(event.target.value) || 0) }
                  })
                }
              />
            </label>
          ) : (
            <label className="field">
              <span>Ships</span>
              <input
                type="number"
                min={0}
                max={20}
                value={deployment.ship ?? 0}
                onChange={(event) =>
                  dispatch({
                    type: "setDeployment",
                    tileId,
                    units: { ...deployment, ship: Math.max(0, Number(event.target.value) || 0) }
                  })
                }
              />
            </label>
          )}
        </>
      ) : null}

      {primary.hexes.length > 1 ? (
        <button
          type="button"
          className="secondary-action"
          onClick={() => dispatch({ type: "unmergeTile", tileId })}
        >
          Unmerge tile
        </button>
      ) : null}
    </>
  );
}
```

- [ ] **Step 2: Add the sheet and header CSS**

In `packages/web/src/styles/app.css`:

Make the header wrappable — replace the `.editor-header` rule with:

```css
.editor-header {
  display: flex;
  flex-wrap: wrap;
  align-items: end;
  gap: 12px;
  row-gap: 8px;
  padding: 10px 14px;
  border-bottom: 1px solid var(--hairline);
}
```

After the `.editor-inspector` rule, add:

```css
.inspector-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}
.inspector-header h2 {
  margin: 0;
  font-size: 1rem;
}
.inspector-toggle {
  display: none;
}
.inspector-body {
  display: flex;
  flex-direction: column;
  gap: 10px;
  min-height: 0;
  overflow-y: auto;
}
```

At the end of the editor section, add the mobile media query:

```css
@media (max-width: 900px) {
  .editor-name {
    flex: 1 1 auto;
    min-width: 0;
  }
  .editor-status {
    margin-left: 0;
  }
  .editor-header button {
    min-height: 44px;
  }

  .editor-body {
    position: relative;
  }
  .editor-inspector {
    position: absolute;
    left: 0;
    right: 0;
    bottom: 0;
    width: auto;
    max-height: 50%;
    border-left: 0;
    border-top: 1px solid var(--hairline);
    background: var(--washi-raised);
    box-shadow: 0 -2px 10px rgba(0, 0, 0, 0.12);
    z-index: 5;
  }
  .editor-inspector.is-collapsed .inspector-body {
    display: none;
  }
  .inspector-toggle {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-width: 44px;
    min-height: 44px;
  }
}
```

- [ ] **Step 3: Build, typecheck, unit tests**

Run: `corepack pnpm --filter @sengoku-jidai/web build && corepack pnpm --filter @sengoku-jidai/web typecheck && corepack pnpm --filter @sengoku-jidai/web test`
Expected: PASS.

- [ ] **Step 4: Run the desktop editor e2e locally**

Temp-port recipe (18081 is the LIVE prod container — never test against it):

```bash
export SCRATCHPAD=/tmp/claude-3000/-mnt-ssd-pool-martin-repos-sengoku-jidai/364bbd6b-1c22-4871-92fd-fa71e4ea0a1d/scratchpad
sed -i 's/18081/18099/g' playwright.config.ts
sed -i 's/"3000"/"3009"/' playwright.config.ts
```

In `packages/web/vite.config.ts`, temporarily add a cacheDir line inside `defineConfig({`
(dodges the root-owned `node_modules/.vite`):

```ts
export default defineConfig({
  cacheDir: process.env.VITE_CACHE_DIR ?? "node_modules/.vite",
  plugins: [react()],
```

Then:

```bash
LD_LIBRARY_PATH=$HOME/.local/chromium-deps/lib \
VITE_CACHE_DIR=$SCRATCHPAD/vite-cache \
PLAYWRIGHT_HTML_REPORT=$SCRATCHPAD/pw-report \
corepack pnpm exec playwright test tests/e2e/map-editor.spec.ts --output=$SCRATCHPAD/pw-results
```

Expected: PASS — desktop viewport (1280×720) keeps the side panel with the body always
visible, so `getByLabel("HQ owner")` etc. still resolve. Revert the temporary config
overrides afterwards: `git checkout playwright.config.ts packages/web/vite.config.ts`.

- [ ] **Step 5: Commit**

```bash
git add packages/web/src/components/editor/InspectorPanel.tsx packages/web/src/styles/app.css
git commit -m "feat(web): responsive editor inspector sheet and wrapping header"
```

---

### Task 6: Mobile e2e spec

A phone-sized, touch-driven end-to-end pass: paint by tap, Multi-select + merge, zoom buttons, two-finger pan and pinch (synthetic pointer events — Playwright's touchscreen is single-touch only), save.

**Files:**
- Create: `tests/e2e/map-editor-mobile.spec.ts`

**Interfaces:**
- Consumes: dock accessible names (Task 3), Multi behavior (Task 2), pinch handling (Task 4), auto-expanding sheet (Task 5).

- [ ] **Step 1: Write the spec**

Create `tests/e2e/map-editor-mobile.spec.ts`:

```ts
import { devices, expect, test } from "@playwright/test";

test.use({ ...devices["Pixel 5"] }); // 393×851, isMobile, hasTouch

/** Two synthetic touch pointers on the canvas: down → move → up. Playwright's
 *  touchscreen API is single-touch, so multi-touch is dispatched manually. */
async function twoFingerGesture(
  canvas: import("@playwright/test").Locator,
  from: [[number, number], [number, number]],
  to: [[number, number], [number, number]]
): Promise<string> {
  return canvas.evaluate(
    (svg, { from, to }) => {
      const rect = svg.getBoundingClientRect();
      const fire = (type: string, pointerId: number, [x, y]: [number, number]) => {
        svg.dispatchEvent(
          new PointerEvent(type, {
            pointerId,
            pointerType: "touch",
            isPrimary: pointerId === 1,
            clientX: rect.left + x,
            clientY: rect.top + y,
            bubbles: true,
            cancelable: true,
            buttons: 1
          })
        );
      };
      fire("pointerdown", 1, from[0]);
      fire("pointerdown", 2, from[1]);
      fire("pointermove", 1, to[0]);
      fire("pointermove", 2, to[1]);
      fire("pointerup", 1, to[0]);
      fire("pointerup", 2, to[1]);
      return svg.getAttribute("viewBox")!;
    },
    { from, to }
  );
}

function viewBoxParts(viewBox: string): number[] {
  return viewBox.split(" ").map(Number);
}

test("author, merge, pan/zoom, and save a map by touch", async ({ page }) => {
  await page.goto("/maps/new");

  // Paint three land hexes by tapping (paint-land is the default tool).
  await page.locator('.editor-grid [data-axial="0,0"]').tap();
  await page.locator('.editor-grid [data-axial="1,0"]').tap();
  await page.locator('.editor-grid [data-axial="2,0"]').tap();

  // Multi-select t1+t2 with the Multi toggle (no shift-click) and merge them.
  await page.getByRole("button", { name: "Select tool" }).tap();
  await page.getByRole("button", { name: "Multi-select" }).tap();
  await page.locator('[data-tile-id="t1"]').tap();
  await page.locator('[data-tile-id="t2"]').tap();
  await page.getByRole("button", { name: "Merge tiles" }).tap();
  await expect(page.locator('[data-tile-id="t1"]')).toHaveCount(2); // both hexes now t1

  // Multi off; configure the merged tile via the auto-expanded inspector sheet.
  await page.getByRole("button", { name: "Multi-select" }).tap();
  await page.locator('[data-tile-id="t1"]').first().tap();
  await page.getByLabel("HQ owner").selectOption("red");
  await page.getByLabel("Deployment seat").selectOption("red");
  await page.getByLabel("Troops").fill("3");

  await page.locator('[data-tile-id="t3"]').tap();
  await page.getByLabel("HQ owner").selectOption("black");
  await page.getByLabel("Deployment seat").selectOption("black");
  await page.getByLabel("Troops").fill("3");

  await expect(page.getByText("Map is valid")).toBeVisible();

  // Zoom-in button shrinks the viewBox width.
  const canvas = page.getByTestId("editor-canvas");
  const initial = viewBoxParts((await canvas.getAttribute("viewBox"))!);
  await page.getByRole("button", { name: "Zoom in" }).tap();
  const zoomed = viewBoxParts((await canvas.getAttribute("viewBox"))!);
  expect(zoomed[2]!).toBeLessThan(initial[2]!);

  // Two-finger drag pans without changing the zoom.
  const panned = viewBoxParts(
    await twoFingerGesture(
      canvas,
      [
        [100, 200],
        [220, 200]
      ],
      [
        [140, 260],
        [260, 260]
      ]
    )
  );
  expect(panned[2]!).toBeCloseTo(zoomed[2]!);
  expect(panned[0]!).not.toBeCloseTo(zoomed[0]!);

  // Pinching outward zooms in further.
  const pinched = viewBoxParts(
    await twoFingerGesture(
      canvas,
      [
        [150, 300],
        [250, 300]
      ],
      [
        [100, 300],
        [300, 300]
      ]
    )
  );
  expect(pinched[2]!).toBeLessThan(panned[2]!);

  // Save works from the phone layout.
  await page.getByLabel("Map name").fill("Touch Map");
  await page.getByRole("button", { name: "Save map" }).tap();
  await expect(page.getByRole("button", { name: "New game on this map" })).toBeVisible();
});
```

- [ ] **Step 2: Run it locally**

Temp-port recipe (18081 is the LIVE prod container — never test against it):

```bash
export SCRATCHPAD=/tmp/claude-3000/-mnt-ssd-pool-martin-repos-sengoku-jidai/364bbd6b-1c22-4871-92fd-fa71e4ea0a1d/scratchpad
sed -i 's/18081/18099/g' playwright.config.ts
sed -i 's/"3000"/"3009"/' playwright.config.ts
```

In `packages/web/vite.config.ts`, temporarily add a cacheDir line inside `defineConfig({`
(dodges the root-owned `node_modules/.vite`):

```ts
export default defineConfig({
  cacheDir: process.env.VITE_CACHE_DIR ?? "node_modules/.vite",
  plugins: [react()],
```

Then:

```bash
LD_LIBRARY_PATH=$HOME/.local/chromium-deps/lib \
VITE_CACHE_DIR=$SCRATCHPAD/vite-cache \
PLAYWRIGHT_HTML_REPORT=$SCRATCHPAD/pw-report \
corepack pnpm exec playwright test tests/e2e/map-editor-mobile.spec.ts --output=$SCRATCHPAD/pw-results
```

Expected: PASS. If the merge-button tap fails because the sheet did not expand, that is a
real Task 5 bug (auto-expand on selection), not a test problem — fix it there. Revert the
temporary config overrides afterwards:
`git checkout playwright.config.ts packages/web/vite.config.ts`.

- [ ] **Step 3: Commit**

```bash
git add tests/e2e/map-editor-mobile.spec.ts
git commit -m "test(e2e): phone-sized touch flow for the map editor"
```

---

### Task 7: Full gate

Everything green from the repo root, honestly testing the working tree.

- [ ] **Step 1: Root build, typecheck, tests, lint**

```bash
corepack pnpm build
corepack pnpm typecheck
corepack pnpm test
corepack pnpm lint
```

Expected: all PASS.

- [ ] **Step 2: Full local e2e (temp-port recipe — 18081 is the LIVE prod container)**

```bash
export SCRATCHPAD=/tmp/claude-3000/-mnt-ssd-pool-martin-repos-sengoku-jidai/364bbd6b-1c22-4871-92fd-fa71e4ea0a1d/scratchpad
sed -i 's/18081/18099/g' playwright.config.ts
sed -i 's/"3000"/"3009"/' playwright.config.ts
```

In `packages/web/vite.config.ts`, temporarily add a cacheDir line inside `defineConfig({`
(dodges the root-owned `node_modules/.vite`):

```ts
export default defineConfig({
  cacheDir: process.env.VITE_CACHE_DIR ?? "node_modules/.vite",
  plugins: [react()],
```

Then run all specs:

```bash
LD_LIBRARY_PATH=$HOME/.local/chromium-deps/lib \
VITE_CACHE_DIR=$SCRATCHPAD/vite-cache \
PLAYWRIGHT_HTML_REPORT=$SCRATCHPAD/pw-report \
corepack pnpm exec playwright test --output=$SCRATCHPAD/pw-results
```

Expected: all 5 spec files PASS (~10s).

- [ ] **Step 3: Revert the temporary config overrides**

```bash
git checkout playwright.config.ts packages/web/vite.config.ts
git status --short   # only committed work remains
```

- [ ] **Step 4: Verify the branch is clean and complete**

```bash
git log --oneline main..mobile-editor-ux
```

Expected: the spec commit plus one commit per task (1–6).

Done — hand off to superpowers:finishing-a-development-branch (PR + CI watch per the
usual workflow; ask before merging).
