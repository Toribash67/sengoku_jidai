# PR-D: Terrain Render Tool + Composite-Helper Relocation — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a local dev tool that composites a map's board with a chosen terrain into a viewable HTML/PNG (the check that would have caught the terrain-hidden bug), and move the pure SVG composite helpers into `board-render` so the tool and the app share one code path.

**Architecture:** Relocate `parseViewBox`, `injectTerrainBackground`, and `terrainImageAttrs` from `packages/web` into `packages/board-render/src/terrainComposite.ts` (their framework-agnostic home; board-render is the lower layer both web and the tool import). Then add `packages/board-render/scripts/terrain-shot.ts`, a `tsx` script that fetches a map's source from the local server, assembles its board SVG, composites a terrain webp via the relocated helper, and writes a self-contained HTML file.

**Tech Stack:** TypeScript, board-render (builds to dist, consumed by web from dist), tsx, Vitest (pure-logic tests; web has no jsdom), Node global `fetch`, the existing `svgshot.mjs` Chromium shim.

## Global Constraints

- No new npm dependencies. Node global `fetch` and `node:fs` only in the script.
- `corepack pnpm` for all commands. `board-render` builds to dist and web consumes it from dist, so run `corepack pnpm build:libs` before web typecheck/tests.
- The relocation is behavior-preserving: `terrainImageAttrs` and the two composite helpers must move verbatim (bodies unchanged), not be duplicated. Web imports them from `@sengoku-jidai/board-render`.
- The render tool is a **local dev aid, never a CI gate** — headless Chromium only runs on Martin's box via the `LD_LIBRARY_PATH=$HOME/.local/chromium-deps/lib` userland-libs shim.
- Stage files individually (never `git add -A`/`.`); never commit `.claude/` or `.superpowers/`.
- Existing editor + play e2e must stay green (a pure move shouldn't touch them, but don't break DOM hooks).

---

### Task 1: Relocate the composite helpers into board-render

Move the three pure helpers into `board-render` and repoint every web consumer at the package. Behavior-preserving; verified by the existing unit tests (relocated) staying green.

**Files:**
- Create: `packages/board-render/src/terrainComposite.ts`
- Modify: `packages/board-render/src/index.ts`
- Create: `packages/board-render/test/terrainComposite.test.ts` (moved from web)
- Modify: `packages/web/src/components/editor/EditorScreen.tsx:19` (import path)
- Modify: `packages/web/src/components/board/MapBoard.tsx:6` (import path)
- Modify: `packages/web/src/components/board/terrainImages.ts` (remove `terrainImageAttrs`)
- Modify: `packages/web/test/board/terrainLayer.test.ts:2` (import path)
- Delete: `packages/web/src/components/editor/terrainPreview.ts`
- Delete: `packages/web/test/editor/terrainPreview.test.ts`

**Interfaces:**
- Produces (from `@sengoku-jidai/board-render`):
  - `terrainImageAttrs(viewBox: { x: number; y: number; width: number; height: number }): { x: number; y: number; width: number; height: number; preserveAspectRatio: "none" }`
  - `parseViewBox(svgMarkup: string): { x: number; y: number; width: number; height: number } | null`
  - `injectTerrainBackground(svgMarkup: string, terrainUrl: string | null): string`

- [ ] **Step 1: Create `terrainComposite.ts` in board-render**

Create `packages/board-render/src/terrainComposite.ts` with all three helpers (note `terrainImageAttrs` is now local, so `injectTerrainBackground` no longer imports it from web):

```ts
/** SVG `<image>` geometry for a terrain background: fill the whole viewBox and stretch to it
 *  (`preserveAspectRatio="none"`) so terrain aligns with the board regardless of aspect. */
export function terrainImageAttrs(viewBox: {
  x: number;
  y: number;
  width: number;
  height: number;
}) {
  return {
    x: viewBox.x,
    y: viewBox.y,
    width: viewBox.width,
    height: viewBox.height,
    preserveAspectRatio: "none" as const
  };
}

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
  const parts = match[1]!.trim().split(/\s+/).map(Number);
  if (parts.length !== 4 || parts.some((n) => !Number.isFinite(n))) {
    return null;
  }
  const [x, y, width, height] = parts as [number, number, number, number];
  return { x, y, width, height };
}

/** Assembled tiles carry an opaque authored fill (`class="tile" … style="fill:…"`). Terrain
 *  paints beneath them, so those fills would hide it. Clear them to a transparent fill + hex
 *  outline so the terrain shows through — the same reveal the play view does in `decorate()`
 *  when a terrain layer is present. Scoped to `class="tile"` so it never touches the feature
 *  glyphs (HQ/harbour/order tokens/star badges), which carry their own inline fill styles.
 *  In `assembleBoardSvg` output a tile path is `<path id=… class="tile" d=… style="fill:…">`,
 *  so `style` always follows `class="tile"` on the same element (no `>` between). */
const TILE_FILL_STYLE = /(class="tile"[^>]*?)style="fill:[^"]*"/g;
const TILE_REVEAL_STYLE = 'style="fill:transparent;stroke:#000000;stroke-width:5"';

/** Return `svgMarkup` prepared to display the given terrain: a terrain `<image>` spliced in as
 *  the SVG's first child (so it paints beneath everything, mirroring the play view's
 *  `applyTerrain`), and the tiles' opaque authored fills cleared so the image shows through.
 *  No-op when the url is empty, the viewBox can't be parsed, or a terrain image is already
 *  present. */
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
  // Clearing tile fills does not touch the opening <svg …> tag (it has no fill style), so the
  // first ">" — where the image is spliced — is at the same index before and after the reveal.
  const revealed = svgMarkup.replace(TILE_FILL_STYLE, (_m, prefix) => prefix + TILE_REVEAL_STYLE);
  const openTagEnd = revealed.indexOf(">");
  if (openTagEnd === -1) {
    return svgMarkup;
  }
  const a = terrainImageAttrs(viewBox);
  const image =
    `<image id="${PREVIEW_TERRAIN_ID}" x="${a.x}" y="${a.y}" width="${a.width}" height="${a.height}"` +
    ` preserveAspectRatio="${a.preserveAspectRatio}" pointer-events="none"` +
    ` href="${terrainUrl}" xlink:href="${terrainUrl}" />`;
  return revealed.slice(0, openTagEnd + 1) + image + revealed.slice(openTagEnd + 1);
}
```

- [ ] **Step 2: Export it from board-render's index**

In `packages/board-render/src/index.ts`, append:

```ts
export * from "./terrainComposite.js";
```

- [ ] **Step 3: Move the unit tests into board-render**

Create `packages/board-render/test/terrainComposite.test.ts` with the full contents of the current `packages/web/test/editor/terrainPreview.test.ts`, changing only the import line at the top to:

```ts
import {
  injectTerrainBackground,
  parseViewBox
} from "../src/terrainComposite.js";
```

(The rest of that file — the `SVG`/`SVG_WITH_TILES` constants and all `describe`/`it` blocks — is copied verbatim.)

- [ ] **Step 4: Delete the web helper and its test**

```bash
git rm packages/web/src/components/editor/terrainPreview.ts packages/web/test/editor/terrainPreview.test.ts
```

- [ ] **Step 5: Repoint web consumers at the package**

In `packages/web/src/components/editor/EditorScreen.tsx`, replace the line:

```ts
import { injectTerrainBackground } from "./terrainPreview.js";
```

with (fold into the existing board-render import on line 5, or add this line):

```ts
import { assembleBoardSvg, buildScene, injectTerrainBackground } from "@sengoku-jidai/board-render";
```

(Remove the now-duplicate `import { assembleBoardSvg, buildScene } from "@sengoku-jidai/board-render";` on line 5 if you merged them.)

In `packages/web/src/components/board/MapBoard.tsx`, change line 6 from:

```ts
import { terrainImageAttrs } from "./terrainImages.js";
```

to:

```ts
import { terrainImageAttrs } from "@sengoku-jidai/board-render";
```

In `packages/web/src/components/board/terrainImages.ts`, delete the `terrainImageAttrs` function (the `export function terrainImageAttrs(viewBox: {…}) {…}` block at line 49). Leave `resolveTerrain`, `terrainImage`, `terrainApiUrl`, and `resolveTerrainUrl` untouched.

In `packages/web/test/board/terrainLayer.test.ts`, change line 2 from:

```ts
import { terrainImageAttrs } from "../../src/components/board/terrainImages.js";
```

to:

```ts
import { terrainImageAttrs } from "@sengoku-jidai/board-render";
```

- [ ] **Step 6: Build libs, then run both test suites — expect all green**

Run: `corepack pnpm build:libs && corepack pnpm --filter @sengoku-jidai/board-render test && corepack pnpm --filter @sengoku-jidai/web test`
Expected: board-render tests include the new `terrainComposite.test.ts` (10 tests) and pass; web tests pass (including `terrainLayer.test.ts`), with no reference to the deleted `terrainPreview` files.

- [ ] **Step 7: Typecheck both packages**

Run: `corepack pnpm --filter @sengoku-jidai/board-render typecheck && corepack pnpm --filter @sengoku-jidai/web typecheck`
Expected: no errors (web resolves the three helpers from the rebuilt board-render dist).

- [ ] **Step 8: Lint**

Run: `corepack pnpm lint`
Expected: no errors.

- [ ] **Step 9: Commit**

```bash
git add packages/board-render/src/terrainComposite.ts packages/board-render/src/index.ts packages/board-render/test/terrainComposite.test.ts packages/web/src/components/editor/EditorScreen.tsx packages/web/src/components/board/MapBoard.tsx packages/web/src/components/board/terrainImages.ts packages/web/test/board/terrainLayer.test.ts
git commit -m "refactor: move terrain composite helpers into board-render"
```

---

### Task 2: The `terrain-shot` render tool

Add the dev script that composites a map's board + a terrain webp into a self-contained HTML file, using the relocated `injectTerrainBackground` so it renders identically to the app.

**Files:**
- Create: `packages/board-render/scripts/terrain-shot.ts`
- Modify: `packages/board-render/package.json` (add a `terrain-shot` script)

**Interfaces:**
- Consumes: `assembleBoardSvg`, `buildScene`, `injectTerrainBackground` from `../src/index.js`; `compileHexMap` from `@sengoku-jidai/engine`.

- [ ] **Step 1: Write the script**

Create `packages/board-render/scripts/terrain-shot.ts`:

```ts
import { readFileSync, writeFileSync } from "node:fs";
import { compileHexMap } from "@sengoku-jidai/engine";
import { assembleBoardSvg, buildScene, injectTerrainBackground } from "../src/index.js";

interface Args {
  map?: string;
  terrainUrl?: string;
  out?: string;
  base: string;
}

function parseArgs(argv: string[]): Args {
  const args: Args = { base: "http://localhost:18081" };
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    if (flag === "--map") args.map = argv[++i];
    else if (flag === "--terrain-url") args.terrainUrl = argv[++i];
    else if (flag === "--out") args.out = argv[++i];
    else if (flag === "--base") args.base = argv[++i];
  }
  return args;
}

/** A terrain webp reference — either an http(s) URL to fetch or a local file path — as a data URI. */
async function loadTerrainDataUri(ref: string): Promise<string> {
  const bytes = /^https?:\/\//.test(ref)
    ? await fetch(ref).then((res) => {
        if (!res.ok) throw new Error(`terrain fetch ${ref} -> ${res.status}`);
        return res.arrayBuffer().then((b) => Buffer.from(b));
      })
    : readFileSync(ref);
  return `data:image/webp;base64,${bytes.toString("base64")}`;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (!args.map || !args.out) {
    console.error(
      "usage: tsx scripts/terrain-shot.ts --map <id> [--terrain-url <url|path>] --out <file.html> [--base <url>]"
    );
    process.exit(1);
  }
  const res = await fetch(`${args.base}/api/maps/${encodeURIComponent(args.map)}`);
  if (!res.ok) {
    console.error(`map fetch ${args.map} -> ${res.status}`);
    process.exit(1);
  }
  const detail = (await res.json()) as { source: Parameters<typeof compileHexMap>[0] };
  const svg = assembleBoardSvg(buildScene(compileHexMap(detail.source)));
  const url = args.terrainUrl ? await loadTerrainDataUri(args.terrainUrl) : null;
  const composited = injectTerrainBackground(svg, url);
  const html = `<!doctype html><html><body style="margin:0">${composited}</body></html>`;
  writeFileSync(args.out, html);
  console.log("wrote", args.out);
  console.log(
    "render to PNG with:",
    `LD_LIBRARY_PATH=$HOME/.local/chromium-deps/lib node ~/.local/bin/svgshot.mjs ${args.out} ${args.out.replace(/\.html$/, ".png")}`
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
```

- [ ] **Step 2: Add the package script**

In `packages/board-render/package.json`, add to `"scripts"` (after `"preview"`):

```json
    "terrain-shot": "tsx scripts/terrain-shot.ts"
```

- [ ] **Step 3: Typecheck board-render (the script is covered by tsconfig)**

Run: `corepack pnpm --filter @sengoku-jidai/board-render typecheck`
Expected: no errors. (`Parameters<typeof compileHexMap>[0]` types the source without importing the type name; `fetch`/`Buffer` come from `@types/node`.)

- [ ] **Step 4: Smoke-run the tool (flat + with an existing terrain — no fal credits)**

Requires the local deploy on `:18081`. Use the existing custom map id `fc5161b0-f889-41e6-ab32-9106276c86c7` (Small Testmap, terrain ready).

Flat:
```bash
corepack pnpm --filter @sengoku-jidai/board-render exec tsx scripts/terrain-shot.ts \
  --map fc5161b0-f889-41e6-ab32-9106276c86c7 --out /tmp/shot-flat.html
```
With its current terrain:
```bash
corepack pnpm --filter @sengoku-jidai/board-render exec tsx scripts/terrain-shot.ts \
  --map fc5161b0-f889-41e6-ab32-9106276c86c7 \
  --terrain-url http://localhost:18081/api/maps/fc5161b0-f889-41e6-ab32-9106276c86c7/terrain.webp \
  --out /tmp/shot-terrain.html
```
Then render each to PNG (printed command) and confirm: flat = clean tile fills; terrain = islands showing through with tile outlines + solid feature glyphs. Record both commands + outcome in the report.
Expected: both HTML files written; the terrain PNG shows terrain (not flat), matching the editor Preview.

- [ ] **Step 5: Commit**

```bash
git add packages/board-render/scripts/terrain-shot.ts packages/board-render/package.json
git commit -m "feat(board-render): terrain-shot dev tool for local render verification"
```

---

## Self-Review

**Spec coverage:**
- Part 1 relocation (parseViewBox/injectTerrainBackground/terrainImageAttrs → board-render; web repointed; tests moved; web helper deleted) → Task 1. ✓
- Part 2 tool (`terrain-shot.ts`, map-id+terrain→HTML, prints svgshot PNG command, `--base` default, url-or-path terrain, no new deps) → Task 2. ✓
- Error handling (missing args → usage+exit 1; non-200/read failure → exit 1) → Task 2 Step 1. ✓
- Testing (relocated unit tests stay green; manual smoke run documented) → Task 1 Steps 6–8, Task 2 Step 4. ✓

**Placeholder scan:** No TBD/TODO; every code step shows full code; commands have expected output. ✓

**Type consistency:** `terrainImageAttrs`/`parseViewBox`/`injectTerrainBackground` signatures identical across Task 1 (definition) and Task 2 (use); the tool consumes them from `../src/index.js` which re-exports `terrainComposite.js`. ✓
