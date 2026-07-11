# In-editor Terrain Preview Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Overlay a saved custom map's generated terrain webp onto the editor's Preview board, updating live when generation finishes.

**Architecture:** A pure string helper splices an `<image>` into the assembled board-render SVG (mirroring the play view's `applyTerrain`). `TerrainButton` reports its polled terrain status upward; `EditorScreen` holds that status, resolves the terrain URL with the existing `resolveTerrainUrl`, and wraps the Preview markup through the helper. No server, engine, or terrain-package changes.

**Tech Stack:** TypeScript, React 18, Vite, Vitest (pure-logic tests only — web has no jsdom/testing-library), board-render, pnpm workspaces.

## Global Constraints

- No new npm dependencies.
- Web tests are **pure-logic only** — no jsdom, no @testing-library. React components are verified by typecheck + lint + the existing e2e, not unit tests.
- Package manager is `corepack pnpm`. Rebuild libs before filtered web tests (`corepack pnpm build:libs`).
- E2e only via the temp-port recipe — **never port 18081 (live prod)**.
- Existing editor e2e (`tests/e2e/map-editor.spec.ts` + `map-editor-mobile.spec.ts`) must stay green with stable DOM hooks preserved.
- Terrain image geometry must match the play view exactly: cover the viewBox with `preserveAspectRatio="none"`.
- Preview-only placement (spec §1, user-approved). Do **not** touch the live editing canvas.

---

### Task 1: Relocate `terrainImageAttrs` to the terrain-URL module

Share the viewBox→image geometry between the play view and the new preview helper by moving `terrainImageAttrs` from the `MapBoard` component into `terrainImages.ts` (its natural home, alongside `resolveTerrainUrl`). Pure refactor — no behavior change.

**Files:**
- Modify: `packages/web/src/components/board/MapBoard.tsx` (remove the local `terrainImageAttrs` definition at lines 40-53; import it instead)
- Modify: `packages/web/src/components/board/terrainImages.ts` (add `terrainImageAttrs`)
- Modify: `packages/web/test/board/terrainLayer.test.ts:2` (update import path)

**Interfaces:**
- Produces: `terrainImageAttrs(viewBox: { x: number; y: number; width: number; height: number }): { x: number; y: number; width: number; height: number; preserveAspectRatio: "none" }` exported from `terrainImages.ts`.

- [ ] **Step 1: Move the function into `terrainImages.ts`**

Append to `packages/web/src/components/board/terrainImages.ts`:

```ts
/** SVG `<image>` geometry for a terrain background: fill the whole viewBox and stretch to it
 *  (`preserveAspectRatio="none"`) so terrain aligns with the board regardless of aspect. */
export function terrainImageAttrs(viewBox: { x: number; y: number; width: number; height: number }) {
  return {
    x: viewBox.x,
    y: viewBox.y,
    width: viewBox.width,
    height: viewBox.height,
    preserveAspectRatio: "none" as const
  };
}
```

- [ ] **Step 2: Delete the local copy in `MapBoard.tsx` and import it**

Remove lines 40-53 (the `export function terrainImageAttrs(...) { ... }` block). Add `terrainImageAttrs` to the existing import from `./terrainImages.js`. Find the current import line:

```ts
import { resolveTerrainUrl, terrainImage } from "./terrainImages.js";
```

If MapBoard doesn't already import from `terrainImages.js`, add:

```ts
import { terrainImageAttrs } from "./terrainImages.js";
```

Otherwise extend the existing import to include `terrainImageAttrs`. The call site at (old) line 321 `terrainImageAttrs(svg.viewBox.baseVal)` stays unchanged.

- [ ] **Step 3: Update the existing test's import**

In `packages/web/test/board/terrainLayer.test.ts`, change line 2 from:

```ts
import { terrainImageAttrs } from "../../src/components/board/MapBoard.js";
```

to:

```ts
import { terrainImageAttrs } from "../../src/components/board/terrainImages.js";
```

- [ ] **Step 4: Run the web tests — expect PASS (relocation is behavior-preserving)**

Run: `corepack pnpm build:libs && corepack pnpm --filter @sengoku-jidai/web test`
Expected: all pass, including `terrainLayer.test.ts` and `terrainImages.test.ts`.

- [ ] **Step 5: Typecheck the web package**

Run: `corepack pnpm --filter @sengoku-jidai/web typecheck`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add packages/web/src/components/board/MapBoard.tsx packages/web/src/components/board/terrainImages.ts packages/web/test/board/terrainLayer.test.ts
git commit -m "refactor(web): move terrainImageAttrs into terrainImages for reuse"
```

---

### Task 2: Pure `injectTerrainBackground` helper

A pure, string-only function that splices a terrain `<image>` into an assembled board SVG as the first child (bottom layer). This is the testable core of the feature.

**Files:**
- Create: `packages/web/src/components/editor/terrainPreview.ts`
- Test: `packages/web/test/editor/terrainPreview.test.ts`

**Interfaces:**
- Consumes: `terrainImageAttrs` from `../board/terrainImages.js` (Task 1).
- Produces:
  - `parseViewBox(svgMarkup: string): { x: number; y: number; width: number; height: number } | null`
  - `injectTerrainBackground(svgMarkup: string, terrainUrl: string | null): string`

- [ ] **Step 1: Write the failing test**

Create `packages/web/test/editor/terrainPreview.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  injectTerrainBackground,
  parseViewBox
} from "../../src/components/editor/terrainPreview.js";

const SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="-10.00 -20.00 1133.86 1288.16"><defs></defs><g id="tile-sea"></g></svg>';

describe("parseViewBox", () => {
  it("reads the four viewBox numbers", () => {
    expect(parseViewBox(SVG)).toEqual({ x: -10, y: -20, width: 1133.86, height: 1288.16 });
  });

  it("returns null when there is no viewBox", () => {
    expect(parseViewBox("<svg></svg>")).toBeNull();
  });

  it("returns null for a malformed viewBox", () => {
    expect(parseViewBox('<svg viewBox="1 2 3"></svg>')).toBeNull();
  });
});

describe("injectTerrainBackground", () => {
  it("returns markup unchanged when the url is null", () => {
    expect(injectTerrainBackground(SVG, null)).toBe(SVG);
  });

  it("returns markup unchanged when the viewBox is missing", () => {
    const noVb = "<svg></svg>";
    expect(injectTerrainBackground(noVb, "/api/maps/x/terrain.webp")).toBe(noVb);
  });

  it("splices an image sized to the viewBox as the first child", () => {
    const out = injectTerrainBackground(SVG, "/api/maps/x/terrain.webp?v=1");
    // image comes right after the opening <svg ...> tag, before <defs>
    expect(out).toMatch(/<svg[^>]*>\s*<image /);
    expect(out.indexOf("<image ")).toBeLessThan(out.indexOf("<defs>"));
    expect(out).toContain('id="map-terrain"');
    expect(out).toContain('x="-10"');
    expect(out).toContain('width="1133.86"');
    expect(out).toContain('height="1288.16"');
    expect(out).toContain('preserveAspectRatio="none"');
    expect(out).toContain('pointer-events="none"');
    expect(out).toContain('href="/api/maps/x/terrain.webp?v=1"');
    expect(out).toContain('xlink:href="/api/maps/x/terrain.webp?v=1"');
  });

  it("does not inject twice if an image is already present", () => {
    const once = injectTerrainBackground(SVG, "/api/maps/x/terrain.webp");
    const twice = injectTerrainBackground(once, "/api/maps/x/terrain.webp");
    expect(twice).toBe(once);
  });
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `corepack pnpm --filter @sengoku-jidai/web test terrainPreview`
Expected: FAIL — cannot resolve `../../src/components/editor/terrainPreview.js`.

- [ ] **Step 3: Write the implementation**

Create `packages/web/src/components/editor/terrainPreview.ts`:

```ts
import { terrainImageAttrs } from "../board/terrainImages.js";

/** Id of the injected background image — matches the play view's terrain layer id. */
const PREVIEW_TERRAIN_ID = "map-terrain";

/** Parse the four `viewBox="x y w h"` numbers from an assembled SVG string, or null if the
 *  attribute is absent or malformed. */
export function parseViewBox(
  svgMarkup: string
): { x: number; y: number; width: number; height: number } | null {
  const match = svgMarkup.match(/viewBox="([^"]+)"/);
  if (!match) {
    return null;
  }
  const parts = match[1].trim().split(/\s+/).map(Number);
  if (parts.length !== 4 || parts.some((n) => !Number.isFinite(n))) {
    return null;
  }
  const [x, y, width, height] = parts;
  return { x, y, width, height };
}

/** Return `svgMarkup` with a terrain `<image>` spliced in as the SVG's first child, so it paints
 *  beneath every tile — mirroring the play view's `applyTerrain`. No-op when the url is empty,
 *  the viewBox can't be parsed, or a terrain image is already present. */
export function injectTerrainBackground(svgMarkup: string, terrainUrl: string | null): string {
  if (!terrainUrl) {
    return svgMarkup;
  }
  if (svgMarkup.includes(`id="${PREVIEW_TERRAIN_ID}"`)) {
    return svgMarkup;
  }
  const viewBox = parseViewBox(svgMarkup);
  if (!viewBox) {
    return svgMarkup;
  }
  const openTagEnd = svgMarkup.indexOf(">");
  if (openTagEnd === -1) {
    return svgMarkup;
  }
  const a = terrainImageAttrs(viewBox);
  const image =
    `<image id="${PREVIEW_TERRAIN_ID}" x="${a.x}" y="${a.y}" width="${a.width}" height="${a.height}"` +
    ` preserveAspectRatio="${a.preserveAspectRatio}" pointer-events="none"` +
    ` href="${terrainUrl}" xlink:href="${terrainUrl}" />`;
  return svgMarkup.slice(0, openTagEnd + 1) + image + svgMarkup.slice(openTagEnd + 1);
}
```

- [ ] **Step 4: Run the tests — expect PASS**

Run: `corepack pnpm --filter @sengoku-jidai/web test terrainPreview`
Expected: all pass.

- [ ] **Step 5: Typecheck**

Run: `corepack pnpm --filter @sengoku-jidai/web typecheck`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add packages/web/src/components/editor/terrainPreview.ts packages/web/test/editor/terrainPreview.test.ts
git commit -m "feat(web): pure injectTerrainBackground helper for editor preview"
```

---

### Task 3: `TerrainButton` reports status upward

Add an optional callback so the parent learns the polled/seeded terrain status without duplicating the poll loop. Behavior of the button itself is unchanged.

**Files:**
- Modify: `packages/web/src/components/editor/TerrainButton.tsx`

**Interfaces:**
- Produces: `TerrainButton` accepts a new optional prop
  `onStatusChange?: (terrain: TerrainStatus) => void` (`TerrainStatus` from `@sengoku-jidai/shared`, already imported in the file).

- [ ] **Step 1: Add the prop to the component signature**

Change:

```tsx
export function TerrainButton({ mapId }: { mapId: string }) {
```

to:

```tsx
export function TerrainButton({
  mapId,
  onStatusChange
}: {
  mapId: string;
  onStatusChange?: (terrain: TerrainStatus) => void;
}) {
```

- [ ] **Step 2: Report status at the three points where the real status is known**

The raw `TerrainStatus` is known in `poll` (from `fetchMap`) and in the seed effect. Report it alongside the existing `setState`.

In `poll`, after `const next = uiFromStatus(terrain);` and `setState(next);`, add:

```tsx
    onStatusChange?.(terrain);
```

In the seed effect, after `const seeded = uiFromStatus(terrain);` and `setState(seeded);`, add:

```tsx
      onStatusChange?.(terrain);
```

In `handleClick`, the optimistic pending happens before the POST. After `setState("pending");` add:

```tsx
    onStatusChange?.("pending");
```

(The subsequent `poll(run)` will report the true status as it resolves. The 409-in-catch path already funnels into `poll`, which reports; a non-poll `failed` from `uiFromError` is a UI-only state with no server `TerrainStatus`, so it is intentionally not reported — the preview simply stays on its last known URL.)

- [ ] **Step 3: Typecheck**

Run: `corepack pnpm --filter @sengoku-jidai/web typecheck`
Expected: no errors (the prop is optional, so existing usage without it still compiles).

- [ ] **Step 4: Lint (the effect's exhaustive-deps disable must remain valid)**

Run: `corepack pnpm lint`
Expected: no new errors. `onStatusChange` is called inside the effect; keep the existing `// eslint-disable-next-line react-hooks/exhaustive-deps` — the effect must still key only on `[mapId]` (a changing `onStatusChange` identity must not re-seed/re-poll). If lint flags the new call, leave the disable comment in place; do not add `onStatusChange` to the dep array.

- [ ] **Step 5: Commit**

```bash
git add packages/web/src/components/editor/TerrainButton.tsx
git commit -m "feat(web): TerrainButton reports terrain status via onStatusChange"
```

---

### Task 4: Wire terrain into the editor Preview

`EditorScreen` tracks the reported status, resolves the terrain URL (with a regenerate cache-bust), and wraps the Preview markup through `injectTerrainBackground`.

**Files:**
- Modify: `packages/web/src/components/editor/EditorScreen.tsx`

**Interfaces:**
- Consumes: `injectTerrainBackground` (Task 2), `TerrainButton onStatusChange` (Task 3), `resolveTerrainUrl` + `terrainImage` from `../board/terrainImages.js`, `TerrainStatus` from `@sengoku-jidai/shared`.

- [ ] **Step 1: Add imports**

At the top of `EditorScreen.tsx`, add:

```tsx
import type { TerrainStatus } from "@sengoku-jidai/shared";
import { resolveTerrainUrl, terrainImage } from "../board/terrainImages.js";
import { injectTerrainBackground } from "./terrainPreview.js";
```

- [ ] **Step 2: Add status + cache-bust state**

Below the existing `const [view, setView] = useState(INITIAL_VIEW);` line, add:

```tsx
  const [terrainStatus, setTerrainStatus] = useState<TerrainStatus>("none");
  // Bumped whenever generation transitions to "ready" so a regenerated webp (same URL) is
  // re-fetched instead of served stale from cache.
  const [terrainVersion, setTerrainVersion] = useState(0);
```

- [ ] **Step 3: Reset status when the routed map changes**

In the load `useEffect` (the one keyed on `[mapId]`), at the very top of the effect body — right after `let cancelled = false;` — add:

```tsx
    setTerrainStatus("none");
    setTerrainVersion(0);
```

This clears stale terrain when navigating between maps. (A newly saved map — id null→saved without a route change — starts at `"none"` already, and its freshly-mounted `TerrainButton` seeds the real status.)

- [ ] **Step 4: Add the status handler**

Add a handler near the other functions (e.g. above `handleSave`):

```tsx
  function handleTerrainStatus(terrain: TerrainStatus) {
    setTerrainStatus(terrain);
    if (terrain === "ready") {
      setTerrainVersion((v) => v + 1);
    }
  }
```

- [ ] **Step 5: Compute the preview terrain URL**

Add, near the `previewResult` memo:

```tsx
  const terrainPreviewUrl = useMemo(() => {
    const id = state.doc.id ?? "";
    const committed = terrainImage(id);
    const base = resolveTerrainUrl({ committed, terrain: terrainStatus, mapId: id });
    // Cache-bust only the server-generated URL (committed built-in assets are immutable).
    return base && !committed ? `${base}?v=${terrainVersion}` : base;
  }, [state.doc.id, terrainStatus, terrainVersion]);
```

- [ ] **Step 6: Pass the handler to `TerrainButton`**

Change:

```tsx
      {state.doc.id && state.doc.id !== "rivers" ? <TerrainButton mapId={state.doc.id} /> : null}
```

to:

```tsx
      {state.doc.id && state.doc.id !== "rivers" ? (
        <TerrainButton mapId={state.doc.id} onStatusChange={handleTerrainStatus} />
      ) : null}
```

- [ ] **Step 7: Inject terrain into the rendered preview SVG**

Change the preview render branch:

```tsx
            <div
              className="editor-preview"
              dangerouslySetInnerHTML={{ __html: previewResult.svg }}
            />
```

to:

```tsx
            <div
              className="editor-preview"
              dangerouslySetInnerHTML={{
                __html: injectTerrainBackground(previewResult.svg, terrainPreviewUrl)
              }}
            />
```

- [ ] **Step 8: Typecheck**

Run: `corepack pnpm --filter @sengoku-jidai/web typecheck`
Expected: no errors.

- [ ] **Step 9: Full web tests + lint**

Run: `corepack pnpm build:libs && corepack pnpm --filter @sengoku-jidai/web test && corepack pnpm lint`
Expected: all pass; no lint errors.

- [ ] **Step 10: Commit**

```bash
git add packages/web/src/components/editor/EditorScreen.tsx
git commit -m "feat(web): overlay generated terrain on the editor preview board"
```

---

### Task 5: Verify the full gate and editor e2e

Confirm nothing regressed end-to-end. No code changes — this is the completion gate.

**Files:** none.

- [ ] **Step 1: Run the full gate**

Run: `corepack pnpm build:libs && corepack pnpm test && corepack pnpm typecheck && corepack pnpm lint`
Expected: all green.

- [ ] **Step 2: Run the editor e2e (desktop + mobile) via the temp-port recipe**

Use the temp-port e2e recipe (never port 18081). Run:
`corepack pnpm test:e2e tests/e2e/map-editor.spec.ts tests/e2e/map-editor-mobile.spec.ts`
Expected: green. In CI/local there is no `FAL_KEY`, so `terrainPreviewUrl` resolves to null and the Preview shows flat fills exactly as before — the specs' existing assertions are unaffected and their stable DOM hooks are preserved.

- [ ] **Step 3: Confirm no stray changes**

Run: `git status`
Expected: clean working tree; all work committed across Tasks 1-4.

---

## Self-Review

**Spec coverage:**
- §1 Preview-only placement → Tasks 2 & 4 (inject into `.editor-preview` only; canvas untouched). ✓
- §A `injectTerrainBackground` → Task 2. ✓
- §B relocate `terrainImageAttrs` → Task 1. ✓
- §C `onStatusChange` + `EditorScreen` status/URL wiring → Tasks 3 & 4. ✓
- Regenerate cache-bust → Task 4 (Steps 2, 4, 5). ✓
- Edit-after-generate staleness (accepted, no banner) → intentionally not built. ✓
- Testing (pure unit for helper; e2e stays green; no FAL_KEY path) → Tasks 2 & 5. ✓

**Placeholder scan:** No TBD/TODO; every code step shows full code; every command shows expected output. ✓

**Type consistency:** `terrainImageAttrs(viewBox)` signature identical across Tasks 1-2; `onStatusChange?: (terrain: TerrainStatus) => void` identical in Tasks 3-4; `injectTerrainBackground(svgMarkup, terrainUrl)` and `resolveTerrainUrl({ committed, terrain, mapId })` used with matching shapes throughout. ✓
