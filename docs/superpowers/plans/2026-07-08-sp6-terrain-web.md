# SP6 Terrain — Web Implementation Plan (PR 2 of 2)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the author a "Generate terrain" button for saved custom maps and paint the generated terrain on the board once ready — lighting up the backend from PR 1.

**Architecture:** A pure resolver picks the terrain URL for a map (built-in → committed asset; custom + `ready` → `/api/maps/:id/terrain.webp`; else null). A `useTerrainUrl` hook applies it in the play view; the editor gets a button that POSTs to the generate endpoint and polls the map detail until `ready`/`failed`. Feature-unavailable (`503`) is handled reactively on click.

**Tech Stack:** React 18, TypeScript, vitest, Playwright. No new dependencies.

**Depends on:** PR 1 (backend) merged — endpoints `POST /api/maps/:id/terrain`, `GET /api/maps/:id/terrain.webp`, and `MapDetail.terrain: TerrainStatus` must exist.

**Spec:** `docs/superpowers/specs/2026-07-08-sp6-terrain-custom-maps-design.md`.

## Global Constraints

- No new npm dependencies.
- `TerrainStatus` is `"none" | "pending" | "ready" | "failed"` (imported from `@sengoku-jidai/shared`).
- Built-in Rivers keeps its committed Vite-glob asset; only custom maps with `terrain === "ready"` use the API URL. Flat authored fills remain the fallback for every other state — no behavior change for maps without ready terrain.
- Generation is author-triggered only. The button reactively handles `503` (no `FAL_KEY`) by disabling with a hint — do NOT add an availability endpoint (not in the spec).
- The existing editor/board e2e (`tests/e2e/map-editor.spec.ts`, `tests/e2e/map-editor-mobile.spec.ts`) must stay green. Do NOT add an e2e that triggers real generation (it would call fal.ai; CI has no key).
- Preserve accessible names and stable DOM hooks used by existing e2e.
- Use `corepack pnpm`; rebuild libs before filtered web tests (`corepack pnpm build:libs`). Stage files INDIVIDUALLY. vitest does not typecheck — run typecheck separately.
- E2e only via the temp-port recipe (18081 = LIVE prod container); revert `playwright.config.ts` + `packages/web/vite.config.ts` after every run.
- Branch: continue on `sp6-terrain-custom-maps` if PR 1 has not merged, or a fresh branch off updated main after PR 1 merges — the controller decides at execution time based on merge state.

## File structure

| File | Responsibility |
|---|---|
| `packages/web/src/client/api.ts` (modify) | `generateTerrain(mapId)` POST helper |
| `packages/web/src/components/board/terrainImages.ts` (modify) | `resolveTerrainUrl` pure resolver + `terrainApiUrl` |
| `packages/web/src/components/board/useTerrainUrl.ts` (create) | Hook: resolve terrain URL for a map id in the play view |
| `packages/web/src/App.tsx` (modify) | Use the hook for `MapBoard.terrainUrl` |
| `packages/web/src/components/editor/TerrainButton.tsx` (create) | Generate button + status polling |
| `packages/web/src/components/editor/EditorScreen.tsx` (modify) | Render `TerrainButton` for saved maps |
| `packages/web/test/board/terrainImages.test.ts` (modify) | Resolver tests |
| `packages/web/test/board/useTerrainUrl.test.ts` (create) | Hook tests |

---

### Task 1: `generateTerrain` API helper

**Files:**
- Modify: `packages/web/src/client/api.ts`
- Test: `packages/web/test/client/terrainApi.test.ts` (create)

**Interfaces:**
- Consumes: existing `request`/`ApiError` machinery in `api.ts`.
- Produces: `generateTerrain(mapId: string): Promise<void>` — POSTs to `/api/maps/:id/terrain`; resolves on `202`, throws `ApiError` (with `status`) otherwise so callers can detect `503`.

- [ ] **Step 1: Write the failing test**

Create `packages/web/test/client/terrainApi.test.ts`:

```ts
import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError, generateTerrain } from "../../src/client/api.js";

afterEach(() => vi.restoreAllMocks());

describe("generateTerrain", () => {
  it("resolves on 202", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: true, status: 202, json: async () => ({ status: "pending" }) }))
    );
    await expect(generateTerrain("m1")).resolves.toBeUndefined();
  });

  it("throws ApiError with the status on 503", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: false,
        status: 503,
        json: async () => ({ error: { code: "terrainUnavailable", message: "nope" } })
      }))
    );
    await expect(generateTerrain("m1")).rejects.toMatchObject({ status: 503 });
    await expect(generateTerrain("m1")).rejects.toBeInstanceOf(ApiError);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `corepack pnpm build:libs && corepack pnpm --filter @sengoku-jidai/web exec vitest run test/client/terrainApi.test.ts`
Expected: FAIL — `generateTerrain` is not exported.

- [ ] **Step 3: Implement the helper**

In `packages/web/src/client/api.ts`, add (near `updateMap`):

```ts
export async function generateTerrain(mapId: string): Promise<void> {
  await request(`/api/maps/${encodeURIComponent(mapId)}/terrain`, { method: "POST" });
}
```

(Confirm `request` already throws `ApiError` carrying `status` on non-ok responses — the existing `fetchMap`/`createMap` rely on it, so `503` surfaces as `ApiError` with `status: 503`. If `request` returns `void`-incompatible parsing for an empty body, ensure a `202` with a JSON body resolves; the test covers this.)

- [ ] **Step 4: Run test to verify it passes**

Run: `corepack pnpm --filter @sengoku-jidai/web exec vitest run test/client/terrainApi.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/web/src/client/api.ts packages/web/test/client/terrainApi.test.ts
git commit -m "feat(web): generateTerrain API client helper"
```

---

### Task 2: `resolveTerrainUrl` pure resolver

**Files:**
- Modify: `packages/web/src/components/board/terrainImages.ts`
- Test: `packages/web/test/board/terrainImages.test.ts`

**Interfaces:**
- Consumes: existing `resolveTerrain` (committed-asset glob lookup), `TerrainStatus` from shared.
- Produces:
  - `terrainApiUrl(mapId: string): string` → `/api/maps/:id/terrain.webp`.
  - `resolveTerrainUrl(args: { committed: string | null; terrain: TerrainStatus; mapId: string }): string | null` — committed asset wins (Rivers); else the API URL iff `terrain === "ready"`; else null.

- [ ] **Step 1: Write the failing test**

Add to `packages/web/test/board/terrainImages.test.ts` (create the file if absent):

```ts
import { describe, expect, it } from "vitest";
import { resolveTerrainUrl, terrainApiUrl } from "../../src/components/board/terrainImages.js";

describe("resolveTerrainUrl", () => {
  it("prefers a committed asset (built-ins) regardless of status", () => {
    expect(
      resolveTerrainUrl({ committed: "/assets/rivers/bg.webp", terrain: "none", mapId: "rivers" })
    ).toBe("/assets/rivers/bg.webp");
  });

  it("uses the API url for a custom map only when terrain is ready", () => {
    expect(resolveTerrainUrl({ committed: null, terrain: "ready", mapId: "abc" })).toBe(
      terrainApiUrl("abc")
    );
    expect(resolveTerrainUrl({ committed: null, terrain: "pending", mapId: "abc" })).toBeNull();
    expect(resolveTerrainUrl({ committed: null, terrain: "failed", mapId: "abc" })).toBeNull();
    expect(resolveTerrainUrl({ committed: null, terrain: "none", mapId: "abc" })).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `corepack pnpm --filter @sengoku-jidai/web exec vitest run test/board/terrainImages.test.ts`
Expected: FAIL — `resolveTerrainUrl`/`terrainApiUrl` not exported.

- [ ] **Step 3: Implement**

In `packages/web/src/components/board/terrainImages.ts`, add:

```ts
import type { TerrainStatus } from "@sengoku-jidai/shared";

export function terrainApiUrl(mapId: string): string {
  return `/api/maps/${encodeURIComponent(mapId)}/terrain.webp`;
}

/** Pick the terrain background URL for a map: a committed asset (built-ins) always wins;
 *  a custom map uses the server-generated image only once its status is "ready". */
export function resolveTerrainUrl(args: {
  committed: string | null;
  terrain: TerrainStatus;
  mapId: string;
}): string | null {
  if (args.committed) {
    return args.committed;
  }
  return args.terrain === "ready" ? terrainApiUrl(args.mapId) : null;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `corepack pnpm --filter @sengoku-jidai/web exec vitest run test/board/terrainImages.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/web/src/components/board/terrainImages.ts packages/web/test/board/terrainImages.test.ts
git commit -m "feat(web): resolveTerrainUrl picks committed vs generated terrain"
```

---

### Task 3: `useTerrainUrl` hook + wire the play view

**Files:**
- Create: `packages/web/src/components/board/useTerrainUrl.ts`
- Modify: `packages/web/src/App.tsx`
- Test: `packages/web/test/board/useTerrainUrl.test.ts`

**No component-test infra:** `@sengoku-jidai/web` has **no** `@testing-library/react` or jsdom (verified) and adding them violates no-new-deps. So the hook's non-trivial logic goes in an exported **pure async** helper that is unit-tested directly; the hook is a thin effect wrapper (not unit-tested, covered by typecheck + the existing e2e staying green).

**Interfaces:**
- Consumes: `terrainImage` (committed lookup), `resolveTerrainUrl`, `fetchMap` (for the custom-map status).
- Produces:
  - `fetchTerrainUrl(mapId, committed, fetchDetail): Promise<string | null>` — pure/injectable: returns `committed` if set; else calls `fetchDetail(mapId)` and applies `resolveTerrainUrl`; returns null on any error.
  - `useTerrainUrl(mapId: string): string | null` — thin hook: committed asset synchronously, else runs `fetchTerrainUrl` in an effect keyed on `mapId`.

- [ ] **Step 1: Write the failing test (pure helper, no rendering)**

Create `packages/web/test/board/useTerrainUrl.test.ts`:

```ts
import type { MapDetail } from "@sengoku-jidai/shared";
import { describe, expect, it, vi } from "vitest";
import { fetchTerrainUrl } from "../../src/components/board/useTerrainUrl.js";

function detail(terrain: MapDetail["terrain"]): MapDetail {
  return { id: "abc", name: "Custom", builtin: false, updatedAt: "t", terrain, source: {} as never };
}

describe("fetchTerrainUrl", () => {
  it("returns the committed asset without fetching (built-ins)", async () => {
    const fetchDetail = vi.fn();
    expect(await fetchTerrainUrl("rivers", "/assets/rivers/bg.webp", fetchDetail)).toBe(
      "/assets/rivers/bg.webp"
    );
    expect(fetchDetail).not.toHaveBeenCalled();
  });

  it("resolves the API url when a custom map is ready", async () => {
    const fetchDetail = vi.fn(async () => detail("ready"));
    expect(await fetchTerrainUrl("abc", null, fetchDetail)).toBe("/api/maps/abc/terrain.webp");
  });

  it("returns null when the map is not ready", async () => {
    const fetchDetail = vi.fn(async () => detail("pending"));
    expect(await fetchTerrainUrl("abc", null, fetchDetail)).toBeNull();
  });

  it("returns null when the fetch fails", async () => {
    const fetchDetail = vi.fn(async () => {
      throw new Error("boom");
    });
    expect(await fetchTerrainUrl("abc", null, fetchDetail)).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `corepack pnpm build:libs && corepack pnpm --filter @sengoku-jidai/web exec vitest run test/board/useTerrainUrl.test.ts`
Expected: FAIL — `fetchTerrainUrl` not found.

- [ ] **Step 3: Implement the helper + hook**

Create `packages/web/src/components/board/useTerrainUrl.ts`:

```ts
import { useEffect, useState } from "react";
import type { MapDetail } from "@sengoku-jidai/shared";
import { fetchMap } from "../../client/api.js";
import { resolveTerrainUrl, terrainImage } from "./terrainImages.js";

/** Pure/injectable resolution: committed asset wins; otherwise fetch the detail and apply the
 *  ready-gate. Any fetch error resolves to null (board falls back to flat fills). */
export async function fetchTerrainUrl(
  mapId: string,
  committed: string | null,
  fetchDetail: (id: string) => Promise<MapDetail>
): Promise<string | null> {
  if (committed) {
    return committed;
  }
  try {
    const detail = await fetchDetail(mapId);
    return resolveTerrainUrl({ committed: null, terrain: detail.terrain, mapId });
  } catch {
    return null;
  }
}

/** Terrain background URL for a map id. Built-ins resolve synchronously from the committed
 *  asset; custom maps fetch their detail once and light up when generation is `ready`. */
export function useTerrainUrl(mapId: string): string | null {
  const committed = terrainImage(mapId);
  const [url, setUrl] = useState<string | null>(committed);

  useEffect(() => {
    let cancelled = false;
    setUrl(committed);
    if (committed) {
      return;
    }
    fetchTerrainUrl(mapId, null, fetchMap).then((resolved) => {
      if (!cancelled) {
        setUrl(resolved);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [mapId, committed]);

  return url;
}
```

- [ ] **Step 4: Wire the play view**

In `packages/web/src/App.tsx`:
- Replace the import `import { terrainImage } from "./components/board/terrainImages.js";` with `import { useTerrainUrl } from "./components/board/useTerrainUrl.js";`
- Near the top of the component that renders the game board (where `game` is in scope), add: `const terrainUrl = useTerrainUrl(game.view.mapId);`
- Change the prop `terrainUrl={terrainImage(game.view.mapId)}` to `terrainUrl={terrainUrl}`.

(If `game` may be null before that point, guard the hook by moving it above the early return, passing `game?.view.mapId ?? ""`, and letting `terrainImage("")`/`fetchMap("")` resolve to null — hooks must not be conditional. Verify the render structure and place the hook at the top level of the component.)

- [ ] **Step 5: Run tests + typecheck**

Run: `corepack pnpm --filter @sengoku-jidai/web test && corepack pnpm --filter @sengoku-jidai/web typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/web/src/components/board/useTerrainUrl.ts packages/web/src/App.tsx packages/web/test/board/useTerrainUrl.test.ts
git commit -m "feat(web): resolve generated terrain in the play view"
```

---

### Task 4: `TerrainButton` (generate + poll) in the editor

**Files:**
- Create: `packages/web/src/components/editor/TerrainButton.tsx`
- Modify: `packages/web/src/components/editor/EditorScreen.tsx`
- Test: `packages/web/test/editor/terrainButton.test.tsx` (if testing-library is available; else a pure status-reducer test — see note)

**No component-test infra** (as in Task 3): the button's decision logic lives in a pure
state-machine `nextTerrainUiState` that is unit-tested; the component is a thin wrapper.
`ApiError`'s real constructor is `new ApiError(status, body)` (two args — verified in `api.ts`).

**Interfaces:**
- Consumes: `generateTerrain`, `fetchMap`, `ApiError` (constructor `(status, body)`), `TerrainStatus`.
- Produces:
  - `type TerrainUi = "idle" | "pending" | "ready" | "failed" | "unavailable"`.
  - `nextTerrainUiState(event): TerrainUi` — pure mapping from an outcome to the next UI state:
    `{ kind: "start" } → "pending"`; `{ kind: "poll", terrain } → terrain==="ready"?"ready":terrain==="failed"?"failed":"pending"`; `{ kind: "error", unavailable } → unavailable?"unavailable":"failed"`.
  - `<TerrainButton mapId={string} />` component.

- [ ] **Step 1: Write the failing test (pure state machine)**

Create `packages/web/test/editor/terrainButton.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { nextTerrainUiState } from "../../src/components/editor/TerrainButton.js";

describe("nextTerrainUiState", () => {
  it("start → pending", () => {
    expect(nextTerrainUiState({ kind: "start" })).toBe("pending");
  });
  it("poll maps terrain status", () => {
    expect(nextTerrainUiState({ kind: "poll", terrain: "ready" })).toBe("ready");
    expect(nextTerrainUiState({ kind: "poll", terrain: "failed" })).toBe("failed");
    expect(nextTerrainUiState({ kind: "poll", terrain: "pending" })).toBe("pending");
    expect(nextTerrainUiState({ kind: "poll", terrain: "none" })).toBe("pending");
  });
  it("error distinguishes unavailable (503) from failure", () => {
    expect(nextTerrainUiState({ kind: "error", unavailable: true })).toBe("unavailable");
    expect(nextTerrainUiState({ kind: "error", unavailable: false })).toBe("failed");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `corepack pnpm build:libs && corepack pnpm --filter @sengoku-jidai/web exec vitest run test/editor/terrainButton.test.ts`
Expected: FAIL — `nextTerrainUiState` not found.

- [ ] **Step 3: Implement the component + state machine**

Create `packages/web/src/components/editor/TerrainButton.tsx`:

```tsx
import { useState } from "react";
import type { TerrainStatus } from "@sengoku-jidai/shared";
import { ApiError, fetchMap, generateTerrain } from "../../client/api.js";

export type TerrainUi = "idle" | "pending" | "ready" | "failed" | "unavailable";

type TerrainEvent =
  | { kind: "start" }
  | { kind: "poll"; terrain: TerrainStatus }
  | { kind: "error"; unavailable: boolean };

/** Pure: next UI state for a generation outcome. */
export function nextTerrainUiState(event: TerrainEvent): TerrainUi {
  switch (event.kind) {
    case "start":
      return "pending";
    case "poll":
      return event.terrain === "ready" ? "ready" : event.terrain === "failed" ? "failed" : "pending";
    case "error":
      return event.unavailable ? "unavailable" : "failed";
  }
}

const LABEL: Record<TerrainUi, string> = {
  idle: "Generate terrain",
  pending: "Generating terrain…",
  ready: "Terrain ready — regenerate",
  failed: "Regenerate terrain",
  unavailable: "Generate terrain"
};

export function TerrainButton({ mapId }: { mapId: string }) {
  const [state, setState] = useState<TerrainUi>("idle");

  async function poll(): Promise<void> {
    const detail = await fetchMap(mapId);
    const next = nextTerrainUiState({ kind: "poll", terrain: detail.terrain });
    setState(next);
    if (next === "pending") {
      window.setTimeout(() => void poll(), 1500);
    }
  }

  async function handleClick(): Promise<void> {
    setState(nextTerrainUiState({ kind: "start" }));
    try {
      await generateTerrain(mapId);
      void poll();
    } catch (err) {
      const unavailable = err instanceof ApiError && err.status === 503;
      setState(nextTerrainUiState({ kind: "error", unavailable }));
    }
  }

  return (
    <div className="editor-terrain">
      <button
        type="button"
        onClick={() => void handleClick()}
        disabled={state === "pending" || state === "unavailable"}
      >
        {LABEL[state]}
      </button>
      {state === "failed" ? <span className="muted">Generation failed — try again.</span> : null}
      {state === "unavailable" ? (
        <span className="muted">Terrain generation isn’t configured on the server.</span>
      ) : null}
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `corepack pnpm --filter @sengoku-jidai/web exec vitest run test/editor/terrainButton.test.ts`
Expected: PASS.

- [ ] **Step 5: Render it in the editor for saved maps**

In `packages/web/src/components/editor/EditorScreen.tsx`, import it
(`import { TerrainButton } from "./TerrainButton.js";`) and render it where a saved custom map
has a real id — next to the save-success actions. Add:

```tsx
{state.doc.id && state.doc.id !== "rivers" ? <TerrainButton mapId={state.doc.id} /> : null}
```

Place it so it only shows for a persisted map (never `/maps/new` before first save). The
`!== "rivers"` guard keeps the button off built-ins even though the editor normally opens them
as copies.

- [ ] **Step 6: Run tests + typecheck**

Run: `corepack pnpm --filter @sengoku-jidai/web test && corepack pnpm --filter @sengoku-jidai/web typecheck`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/web/src/components/editor/TerrainButton.tsx packages/web/src/components/editor/EditorScreen.tsx packages/web/test/editor/terrainButton.test.ts
git commit -m "feat(web): editor Generate-terrain button with status polling"
```

---

### Task 5: Style, full gate, PR

**Files:**
- Modify: `packages/web/src/styles/app.css` (minimal `.editor-terrain` styling)

- [ ] **Step 1: Add minimal styling**

In `packages/web/src/styles/app.css`, add near the editor rules:

```css
.editor-terrain {
  display: flex;
  align-items: center;
  gap: 8px;
}
```

- [ ] **Step 2: Run the desktop + mobile editor e2e (must stay green)**

Temp-port recipe (18081 = LIVE prod container):

```bash
export SCRATCHPAD=/tmp/claude-3000/-mnt-ssd-pool-martin-repos-sengoku-jidai/364bbd6b-1c22-4871-92fd-fa71e4ea0a1d/scratchpad
sed -i 's/18081/18099/g' playwright.config.ts
sed -i 's/"3000"/"3009"/' playwright.config.ts
```

Add `cacheDir: process.env.VITE_CACHE_DIR ?? "node_modules/.vite",` as the first line inside `defineConfig({` in `packages/web/vite.config.ts`, then:

```bash
LD_LIBRARY_PATH=$HOME/.local/chromium-deps/lib VITE_CACHE_DIR=$SCRATCHPAD/vite-cache \
PLAYWRIGHT_HTML_REPORT=$SCRATCHPAD/pw-report \
corepack pnpm exec playwright test tests/e2e/map-editor.spec.ts tests/e2e/map-editor-mobile.spec.ts --output=$SCRATCHPAD/pw-results
```

Expected: PASS (the new button doesn't disrupt the authored flows; without `FAL_KEY` the dev server just wouldn't generate — the specs never click it). Revert overrides: `git checkout playwright.config.ts packages/web/vite.config.ts`.

- [ ] **Step 3: Full gate**

```bash
corepack pnpm build
corepack pnpm typecheck
corepack pnpm test
corepack pnpm lint
corepack pnpm exec prettier --check $(git diff --name-only main..HEAD -- 'packages/**')
```

Expected: all PASS.

- [ ] **Step 4: Push + PR (stop for review)**

```bash
git push -u origin <branch>
gh pr create --base main --title "feat(web): SP6 terrain for custom maps — web" --body "<summary: generate button, polling, board terrain resolution; depends on backend PR>"
```

Watch CI to green, then STOP for Martin's review/merge (squash + delete branch). Do not merge.

---

## Note on the two-PR sequence

- PR 1 (backend) must merge first: this PR consumes `MapDetail.terrain` and the endpoints.
- If PR 1 has not merged when this PR starts, build it on top of the same branch and open it stacked; the controller decides at execution time. The default is: land PR 1, merge, then branch PR 2 off updated main.
- After both merge: update `memory/custom-map-editor-initiative.md` — **the 6-sub-project initiative is COMPLETE**; note the terrain feature needs `FAL_KEY` in the deployed server env, and that Martin should generate terrain for a custom map on the deploy to confirm the fal round-trip end to end.
