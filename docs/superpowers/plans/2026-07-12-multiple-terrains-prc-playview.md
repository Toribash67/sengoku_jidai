# PR-C — In-game play-view terrain picker Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a per-viewer, per-map play-view picker that chooses which terrain the board shows (Flat default, ready terrains, built-in "Original"), persisted in localStorage, and retire the now-dead legacy terrain field/routes.

**Architecture:** Pure helpers build the option list and resolve a persisted selection; a hook fetches `MapDetail` once and owns state + persistence; a small presentational `<select>` drives it. The board contract is unchanged — a single `terrainUrl` still flows into `MapBoard`. The legacy single-URL path (`MapDetail.terrain`, `/terrain.webp`, `POST /terrain`) is deleted.

**Tech Stack:** TypeScript, React (web), Fastify (server), Vitest. pnpm workspace; `@sengoku-jidai/shared` holds cross-package types.

## Global Constraints

- Web package has **no jsdom** → only pure logic gets unit tests; hooks/components are verified by `pnpm typecheck` + `pnpm build` + the CI Browser Smoke Test.
- Cross-package types live in `packages/shared/src/api.ts`; changing them requires rebuilding shared before filtered web/server tests (`pnpm --filter @sengoku-jidai/shared build`).
- Pre-push gate (run from repo root, fix until green): `pnpm typecheck && pnpm test && pnpm build && pnpm lint && corepack pnpm exec prettier --check .`.
- Option order is fixed: **Flat** first (key `"flat"`), then **Original** (key `"original"`, built-in committed asset only), then each **ready** terrain oldest-first (key = terrain id). Default selection = Flat.
- localStorage keys use the existing `sengoku-jidai.*` namespace with try/catch-on-parse (see `state/localGame.ts`).
- Commit messages end with `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.

---

### Task 1: Option/selection helpers + cache-bust refactor

**Files:**
- Modify: `packages/web/src/components/board/terrainImages.ts`
- Test: `packages/web/test/board/terrainImages.test.ts`

**Interfaces:**
- Consumes: existing `terrainByIdApiUrl(mapId, terrainId)`, `TerrainInfo` from `@sengoku-jidai/shared`.
- Produces:
  - `FLAT_TERRAIN_KEY = "flat"`, `ORIGINAL_TERRAIN_KEY = "original"` (string consts).
  - `interface TerrainOption { key: string; label: string; url: string | null }`.
  - `terrainByIdCacheBustedUrl(mapId: string, terrain: TerrainInfo): string` — `terrainByIdApiUrl` + `?v=<encoded updatedAt>`.
  - `buildTerrainOptions(args: { mapId: string; committed: string | null; terrains: TerrainInfo[] }): TerrainOption[]`.
  - `resolveTerrainOption(options: TerrainOption[], key: string | null): TerrainOption`.

- [ ] **Step 1: Write the failing tests**

Append to `packages/web/test/board/terrainImages.test.ts` (the `t(...)` helper already exists there):

```ts
import {
  buildTerrainOptions,
  resolveTerrainOption,
  terrainByIdCacheBustedUrl,
  FLAT_TERRAIN_KEY,
  ORIGINAL_TERRAIN_KEY
} from "../../src/components/board/terrainImages.js";

describe("terrainByIdCacheBustedUrl", () => {
  it("appends the encoded updatedAt", () => {
    expect(terrainByIdCacheBustedUrl("m1", t("a", "ready", "2026-01-01T00:00:00Z"))).toBe(
      "/api/maps/m1/terrains/a.webp?v=2026-01-01T00%3A00%3A00Z"
    );
  });
});

describe("buildTerrainOptions", () => {
  it("built-in with a committed asset yields Flat + Original", () => {
    const opts = buildTerrainOptions({ mapId: "rivers", committed: "/a/rivers.webp", terrains: [] });
    expect(opts).toEqual([
      { key: FLAT_TERRAIN_KEY, label: "Flat", url: null },
      { key: ORIGINAL_TERRAIN_KEY, label: "Original", url: "/a/rivers.webp" }
    ]);
  });

  it("custom map lists Flat then ready terrains oldest-first, skipping non-ready", () => {
    const terrains = [
      t("a", "ready", "2026-01-01T00:00:00Z"),
      t("b", "pending"),
      t("c", "ready", "2026-02-02T00:00:00Z")
    ];
    const opts = buildTerrainOptions({ mapId: "m1", committed: null, terrains });
    expect(opts.map((o) => o.key)).toEqual([FLAT_TERRAIN_KEY, "a", "c"]);
    expect(opts[1]).toEqual({ key: "a", label: "a", url: "/api/maps/m1/terrains/a.webp?v=2026-01-01T00%3A00%3A00Z" });
  });

  it("nothing to pick yields just Flat", () => {
    expect(buildTerrainOptions({ mapId: "m1", committed: null, terrains: [] })).toEqual([
      { key: FLAT_TERRAIN_KEY, label: "Flat", url: null }
    ]);
  });
});

describe("resolveTerrainOption", () => {
  const opts = buildTerrainOptions({ mapId: "m1", committed: null, terrains: [t("a", "ready")] });
  it("returns the option matching the key", () => {
    expect(resolveTerrainOption(opts, "a").key).toBe("a");
  });
  it("falls back to Flat for null / stale / deleted keys", () => {
    expect(resolveTerrainOption(opts, null).key).toBe(FLAT_TERRAIN_KEY);
    expect(resolveTerrainOption(opts, "gone").key).toBe(FLAT_TERRAIN_KEY);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `corepack pnpm --filter @sengoku-jidai/web exec vitest run test/board/terrainImages.test.ts`
Expected: FAIL — `buildTerrainOptions`/`resolveTerrainOption`/`terrainByIdCacheBustedUrl` not exported.

- [ ] **Step 3: Implement the helpers**

In `packages/web/src/components/board/terrainImages.ts`, add (and refactor `previewTerrainUrl` to reuse the new cache-bust helper):

```ts
export const FLAT_TERRAIN_KEY = "flat";
export const ORIGINAL_TERRAIN_KEY = "original";

export interface TerrainOption {
  key: string;
  label: string;
  url: string | null;
}

/** Per-terrain webp url cache-busted by updatedAt (also the server ETag key). */
export function terrainByIdCacheBustedUrl(mapId: string, terrain: TerrainInfo): string {
  return `${terrainByIdApiUrl(mapId, terrain.id)}?v=${encodeURIComponent(terrain.updatedAt)}`;
}

/** Play-view options: Flat first, Original for a built-in committed asset, then ready terrains
 *  (oldest first). Non-ready terrains are omitted. */
export function buildTerrainOptions(args: {
  mapId: string;
  committed: string | null;
  terrains: TerrainInfo[];
}): TerrainOption[] {
  const options: TerrainOption[] = [{ key: FLAT_TERRAIN_KEY, label: "Flat", url: null }];
  if (args.committed) {
    options.push({ key: ORIGINAL_TERRAIN_KEY, label: "Original", url: args.committed });
  }
  for (const terrain of args.terrains) {
    if (terrain.status === "ready") {
      options.push({
        key: terrain.id,
        label: terrain.name,
        url: terrainByIdCacheBustedUrl(args.mapId, terrain)
      });
    }
  }
  return options;
}

/** The option a persisted key selects, or the Flat option (always options[0]) if absent/stale. */
export function resolveTerrainOption(options: TerrainOption[], key: string | null): TerrainOption {
  return options.find((option) => option.key === key) ?? options[0];
}
```

Then update `previewTerrainUrl`'s return line to `return terrainByIdCacheBustedUrl(args.mapId, selected);` (behaviour identical — the existing `previewTerrainUrl` test still passes).

- [ ] **Step 4: Run tests to verify they pass**

Run: `corepack pnpm --filter @sengoku-jidai/web exec vitest run test/board/terrainImages.test.ts`
Expected: PASS (new blocks + the unchanged `previewTerrainUrl`/`terrainByIdApiUrl`/`defaultSelection` blocks). The `resolveTerrainUrl`/`terrainApiUrl` blocks still pass here — they are removed in Task 5.

- [ ] **Step 5: Commit**

```bash
git add packages/web/src/components/board/terrainImages.ts packages/web/test/board/terrainImages.test.ts
git commit -m "PR-C: play-view terrain option/selection helpers"
```

---

### Task 2: Per-map terrain choice persistence

**Files:**
- Modify: `packages/web/src/state/localGame.ts`
- Test: `packages/web/test/state/localGame.test.ts` (create if absent; else append)

**Interfaces:**
- Produces: `loadTerrainChoice(mapId: string): string | null`, `saveTerrainChoice(mapId: string, key: string): void`. Backing key `"sengoku-jidai.terrainChoice"` → `Record<mapId, optionKey>`.

- [ ] **Step 1: Write the failing test**

Create `packages/web/test/state/localGame.test.ts` (or append if it exists). This runs in the web vitest env; if `localStorage` is undefined there, add a minimal in-memory shim at the top of the test file:

```ts
import { afterEach, describe, expect, it } from "vitest";
import { loadTerrainChoice, saveTerrainChoice } from "../../src/state/localGame.js";

// Minimal localStorage shim if the vitest env lacks one.
if (typeof globalThis.localStorage === "undefined") {
  const store = new Map<string, string>();
  globalThis.localStorage = {
    getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
    clear: () => store.clear(),
    key: () => null,
    length: 0
  } as Storage;
}

afterEach(() => localStorage.clear());

describe("terrain choice persistence", () => {
  it("round-trips a choice per map", () => {
    saveTerrainChoice("m1", "abc");
    saveTerrainChoice("m2", "flat");
    expect(loadTerrainChoice("m1")).toBe("abc");
    expect(loadTerrainChoice("m2")).toBe("flat");
  });

  it("returns null for an unset map", () => {
    expect(loadTerrainChoice("nope")).toBeNull();
  });

  it("returns null and clears the key on corrupt JSON", () => {
    localStorage.setItem("sengoku-jidai.terrainChoice", "{not json");
    expect(loadTerrainChoice("m1")).toBeNull();
    expect(localStorage.getItem("sengoku-jidai.terrainChoice")).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `corepack pnpm --filter @sengoku-jidai/web exec vitest run test/state/localGame.test.ts`
Expected: FAIL — `loadTerrainChoice`/`saveTerrainChoice` not exported.

- [ ] **Step 3: Implement the helpers**

Append to `packages/web/src/state/localGame.ts`:

```ts
const terrainChoiceKey = "sengoku-jidai.terrainChoice";

type TerrainChoiceStore = Record<string, string>;

function readTerrainChoices(): TerrainChoiceStore {
  const raw = localStorage.getItem(terrainChoiceKey);
  if (!raw) {
    return {};
  }
  try {
    return JSON.parse(raw) as TerrainChoiceStore;
  } catch {
    localStorage.removeItem(terrainChoiceKey);
    return {};
  }
}

/** The persisted terrain option key for a map, or null if unset. */
export function loadTerrainChoice(mapId: string): string | null {
  return readTerrainChoices()[mapId] ?? null;
}

/** Persist the chosen terrain option key for a map. */
export function saveTerrainChoice(mapId: string, key: string): void {
  const store = readTerrainChoices();
  store[mapId] = key;
  localStorage.setItem(terrainChoiceKey, JSON.stringify(store));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `corepack pnpm --filter @sengoku-jidai/web exec vitest run test/state/localGame.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/web/src/state/localGame.ts packages/web/test/state/localGame.test.ts
git commit -m "PR-C: per-map terrain choice localStorage persistence"
```

---

### Task 3: Testable fetch seam + `useTerrainPicker` hook

**Files:**
- Create: `packages/web/src/components/board/useTerrainPicker.ts`
- Delete: `packages/web/src/components/board/useTerrainUrl.ts`
- Rename/replace test: `packages/web/test/board/useTerrainUrl.test.ts` → `packages/web/test/board/useTerrainPicker.test.ts`

**Interfaces:**
- Consumes: `terrainImage` (committed glob), `buildTerrainOptions`, `resolveTerrainOption`, `TerrainOption` (Task 1); `loadTerrainChoice`/`saveTerrainChoice` (Task 2); `fetchMap` (`client/api.js`); `MapDetail`/`TerrainInfo` (shared).
- Produces:
  - `fetchTerrains(mapId: string, fetchDetail: (id: string) => Promise<MapDetail>): Promise<TerrainInfo[]>` — pure, returns `detail.terrains` or `[]` on any error.
  - `interface TerrainPicker { options: TerrainOption[]; selectedKey: string; terrainUrl: string | null; select: (key: string) => void }`.
  - `useTerrainPicker(mapId: string): TerrainPicker`.

- [ ] **Step 1: Write the failing test** (replaces the deleted `fetchTerrainUrl` test)

Create `packages/web/test/board/useTerrainPicker.test.ts`:

```ts
import type { MapDetail } from "@sengoku-jidai/shared";
import { describe, expect, it, vi } from "vitest";
import { fetchTerrains } from "../../src/components/board/useTerrainPicker.js";

function detail(terrains: MapDetail["terrains"]): MapDetail {
  return {
    id: "abc",
    name: "Custom",
    builtin: false,
    updatedAt: "t",
    terrains,
    source: {} as never
  };
}

describe("fetchTerrains", () => {
  it("returns the map's terrains", async () => {
    const ts = [{ id: "a", name: "Terrain 1", styleId: "antique", status: "ready", updatedAt: "u" }];
    expect(await fetchTerrains("abc", vi.fn(async () => detail(ts as MapDetail["terrains"])))).toEqual(ts);
  });

  it("returns [] when the fetch fails (e.g. built-in 404)", async () => {
    const fetchDetail = vi.fn(async () => {
      throw new Error("boom");
    });
    expect(await fetchTerrains("rivers", fetchDetail)).toEqual([]);
  });
});
```

Note: `MapDetail` no longer has a `terrain` field — Task 5 removes it from the type. Until Task 5 lands, `pnpm typecheck` will flag the missing `terrain` on this fixture. That is expected and resolves in Task 5; the vitest run in Step 2/4 (no typecheck) passes regardless. If executing tasks strictly in order, keep this fixture minimal as shown (no `terrain` key) so it needs no edit after Task 5.

- [ ] **Step 2: Run test to verify it fails**

Run: `corepack pnpm --filter @sengoku-jidai/web exec vitest run test/board/useTerrainPicker.test.ts`
Expected: FAIL — module `useTerrainPicker.js` does not exist.

- [ ] **Step 3: Implement the hook and delete the old file**

Create `packages/web/src/components/board/useTerrainPicker.ts`:

```ts
import { useEffect, useMemo, useState } from "react";
import type { MapDetail, TerrainInfo } from "@sengoku-jidai/shared";
import { fetchMap } from "../../client/api.js";
import { loadTerrainChoice, saveTerrainChoice } from "../../state/localGame.js";
import {
  buildTerrainOptions,
  resolveTerrainOption,
  terrainImage,
  type TerrainOption
} from "./terrainImages.js";

export interface TerrainPicker {
  options: TerrainOption[];
  selectedKey: string;
  terrainUrl: string | null;
  select: (key: string) => void;
}

/** Fetch a map's terrains once; any error (including a built-in 404) yields []. */
export async function fetchTerrains(
  mapId: string,
  fetchDetail: (id: string) => Promise<MapDetail>
): Promise<TerrainInfo[]> {
  try {
    return (await fetchDetail(mapId)).terrains;
  } catch {
    return [];
  }
}

/** Play-view terrain picker state: builds the option list (committed "Original" + ready
 *  terrains), resolves the persisted per-map choice (stale keys fall back to Flat), and
 *  persists on select. */
export function useTerrainPicker(mapId: string): TerrainPicker {
  const committed = terrainImage(mapId);
  const [terrains, setTerrains] = useState<TerrainInfo[]>([]);
  const [selectedKey, setSelectedKey] = useState<string>(() => loadTerrainChoice(mapId) ?? "flat");

  useEffect(() => {
    let cancelled = false;
    setTerrains([]);
    setSelectedKey(loadTerrainChoice(mapId) ?? "flat");
    if (!mapId) {
      return;
    }
    fetchTerrains(mapId, fetchMap).then((result) => {
      if (!cancelled) {
        setTerrains(result);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [mapId]);

  const options = useMemo(
    () => buildTerrainOptions({ mapId, committed, terrains }),
    [mapId, committed, terrains]
  );
  const resolved = resolveTerrainOption(options, selectedKey);

  return {
    options,
    selectedKey: resolved.key,
    terrainUrl: resolved.url,
    select: (key: string) => {
      setSelectedKey(key);
      saveTerrainChoice(mapId, key);
    }
  };
}
```

Then delete the old hook and its test:

```bash
git rm packages/web/src/components/board/useTerrainUrl.ts packages/web/test/board/useTerrainUrl.test.ts
```

- [ ] **Step 4: Run test to verify it passes**

Run: `corepack pnpm --filter @sengoku-jidai/web exec vitest run test/board/useTerrainPicker.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/web/src/components/board/useTerrainPicker.ts packages/web/test/board/useTerrainPicker.test.ts
git commit -m "PR-C: useTerrainPicker hook (replaces useTerrainUrl)"
```

---

### Task 4: `TerrainPicker` component + App wiring + styles

**Files:**
- Create: `packages/web/src/components/board/TerrainPicker.tsx`
- Modify: `packages/web/src/App.tsx` (import swap ~line 39; hook call ~line 80; render above `<MapBoard>` ~line 815)
- Modify: `packages/web/src/App.css` (or the existing board/App stylesheet — match where `.board-column` is styled)

**Interfaces:**
- Consumes: `TerrainOption` (Task 1), `useTerrainPicker` (Task 3).
- Produces: `TerrainPicker` React component with props `{ options: TerrainOption[]; selectedKey: string; onSelect: (key: string) => void }`; renders `null` when `options.length <= 1`.

- [ ] **Step 1: Create the component**

`packages/web/src/components/board/TerrainPicker.tsx`:

```tsx
import type { TerrainOption } from "./terrainImages.js";

interface TerrainPickerProps {
  options: TerrainOption[];
  selectedKey: string;
  onSelect: (key: string) => void;
}

/** Compact play-view terrain selector. Renders nothing when there is only Flat to pick. */
export function TerrainPicker({ options, selectedKey, onSelect }: TerrainPickerProps) {
  if (options.length <= 1) {
    return null;
  }
  return (
    <label className="terrain-picker">
      <span className="terrain-picker-label">Terrain</span>
      <select
        aria-label="Terrain"
        value={selectedKey}
        onChange={(event) => onSelect(event.target.value)}
      >
        {options.map((option) => (
          <option key={option.key} value={option.key}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}
```

- [ ] **Step 2: Wire into `App.tsx`**

Replace the `useTerrainUrl` import (line ~39) with:

```ts
import { useTerrainPicker } from "./components/board/useTerrainPicker.js";
import { TerrainPicker } from "./components/board/TerrainPicker.js";
```

Replace the hook call (line ~80):

```ts
const terrain = useTerrainPicker(game?.view.mapId ?? "");
```

In the board column, render the picker directly above `<MapBoard …>` and pass the URL through:

```tsx
<div className="board-column">
  <TerrainPicker
    options={terrain.options}
    selectedKey={terrain.selectedKey}
    onSelect={terrain.select}
  />
  <MapBoard
    …
    terrainUrl={terrain.terrainUrl}
  />
```

(`game` is non-null in this branch of `App`, so `game?.view.mapId` matches the previous call site; keep the `?? ""` fallback.)

- [ ] **Step 3: Add styles**

Add a compact rule near the board-column styles (match existing control styling; keep it minimal):

```css
.terrain-picker {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  margin-bottom: 0.4rem;
  font-size: 0.85rem;
}
.terrain-picker-label {
  color: var(--muted, #8a8a8a);
}
```

- [ ] **Step 4: Verify typecheck + build (no jsdom for component render)**

Run: `corepack pnpm --filter @sengoku-jidai/web typecheck && corepack pnpm --filter @sengoku-jidai/web build`
Expected: PASS. (Component behaviour is verified in-browser per the spec's manual check + CI Browser Smoke Test.)

- [ ] **Step 5: Commit**

```bash
git add packages/web/src/components/board/TerrainPicker.tsx packages/web/src/App.tsx packages/web/src/App.css
git commit -m "PR-C: play-view TerrainPicker component + App wiring"
```

---

### Task 5: Retire the legacy terrain surface

**Files:**
- Modify: `packages/shared/src/api.ts` (drop `MapDetail.terrain`)
- Modify: `packages/web/src/components/board/terrainImages.ts` (drop `terrainApiUrl`, `resolveTerrainUrl`)
- Modify: `packages/web/test/board/terrainImages.test.ts` (drop the `resolveTerrainUrl`/`terrainApiUrl` blocks)
- Modify: `packages/server/src/api/routes.ts` (remove legacy routes + status arg)
- Modify: `packages/server/src/maps/library.ts` (drop `terrain` field + `terrainStatus` param)
- Modify: `packages/server/src/maps/terrainStore.ts` (drop orphaned `status`/`webp`/`updatedAt` primary adapters)
- Modify: `packages/server/src/maps/terrainService.ts` (drop `regeneratePrimary` if orphaned)
- Modify: server tests asserting the legacy field/routes: `terrainApi.test.ts`, `mapLibrary.test.ts`, and any of `terrainService.test.ts`/`terrainDefaultProfile.test.ts`/`terrainStyleSync.test.ts` that reference them.

- [ ] **Step 1: Remove the shared legacy field**

In `packages/shared/src/api.ts`, delete from `MapDetail` the `terrain: TerrainStatus;` line and its `LEGACY:` comment. Keep `TerrainStatus` (still used by `TerrainInfo.status`). Rebuild shared:

Run: `corepack pnpm --filter @sengoku-jidai/shared build`

- [ ] **Step 2: Remove the web legacy resolvers + their tests**

In `packages/web/src/components/board/terrainImages.ts`, delete `terrainApiUrl` and `resolveTerrainUrl` (keep `terrainImage`/`resolveTerrain` — they power "Original" — and everything from Task 1). In `packages/web/test/board/terrainImages.test.ts`, delete the `describe("resolveTerrainUrl", …)` block and remove `resolveTerrainUrl`/`terrainApiUrl` from the imports.

- [ ] **Step 3: Remove the server legacy routes + primary plumbing**

In `packages/server/src/api/routes.ts`:
- Delete the `app.post("/api/maps/:mapId/terrain", …)` block (~line 109) and the `app.get("/api/maps/:mapId/terrain.webp", …)` block (~line 133).
- In the `GET /api/maps/:mapId` handler, change the `mapLibrary.get(...)` call to drop the status arg:

```ts
const map = mapLibrary.get(params.data.mapId, (id) => terrainStore.list(id));
```

In `packages/server/src/maps/library.ts` `detail(...)` (or `get`): remove the `terrainStatus?` parameter and every `terrain: …` line (the built-in branch, the `terrainStatus ? … : "none"` line, and the `create`/`update` `terrain: "none"` lines). The `terrainsFn?` parameter and `terrains:` lines stay.

Then remove now-orphaned methods (verify with grep first — no remaining callers after the above):
- `packages/server/src/maps/terrainStore.ts`: `status`, `webp`, `updatedAt` (the per-map primary adapters; keep `webpById`/`updatedAtById`/`list`/`countForMap`/etc.).
- `packages/server/src/maps/terrainService.ts`: `regeneratePrimary` (and any private `primaryId` helper only it used).

Verify no stragglers:

Run: `grep -rn "\.terrain\b\|terrain\.webp\|regeneratePrimary\|terrainStore\.status\|POST.*/terrain\"" packages/server/src packages/web/src`
Expected: no matches (only `terrains`/`terrainById*`/`/terrains` remain).

- [ ] **Step 4: Update server tests**

Fix the tests flagged above so they no longer assert `detail.terrain`, `GET /terrain.webp`, or `POST /terrain` / `regeneratePrimary`. Concretely: in `terrainApi.test.ts` remove the legacy `POST /terrain` and `GET /terrain.webp` cases (the `…/terrains` cases stay); in `mapLibrary.test.ts` drop assertions on the `terrain` field (assert `terrains` instead). Where a test built a `MapDetail` fixture with a `terrain` key, remove that key.

- [ ] **Step 5: Run the full gate**

```bash
corepack pnpm --filter @sengoku-jidai/shared build
corepack pnpm typecheck && corepack pnpm test && corepack pnpm build && corepack pnpm lint && corepack pnpm exec prettier --check .
```
Expected: all green. Typecheck is the safety net that surfaces any missed `terrain` reference across packages.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "PR-C: retire legacy terrain field, /terrain.webp, POST /terrain"
```

---

## Self-Review

**Spec coverage:**
- Flat default + option order → Task 1 (`buildTerrainOptions`), Task 3 (seed `"flat"`).
- Built-in "Original" → Task 1 (`committed` branch), Task 3 (`terrainImage`).
- Ready-only terrains, oldest-first → Task 1.
- Persist per map, stale→Flat → Task 2 + `resolveTerrainOption` (Task 1) + hook (Task 3).
- Picker hides when only Flat → Task 4 (`options.length <= 1`).
- Placement (slim strip above board) → Task 4.
- Retire `MapDetail.terrain` / `/terrain.webp` / `POST /terrain` / primary adapters → Task 5.
- Testing (pure-logic units; typecheck/build for hook+component; server tests) → Tasks 1–5.
- No e2e changes (repo grep found none) → noted; not a task.

**Placeholder scan:** none — every code step shows full code; grep/expected outputs are concrete.

**Type consistency:** `TerrainOption`, `FLAT_TERRAIN_KEY`/`ORIGINAL_TERRAIN_KEY`, `buildTerrainOptions`, `resolveTerrainOption`, `terrainByIdCacheBustedUrl`, `fetchTerrains`, `useTerrainPicker`/`TerrainPicker` names are used identically across Tasks 1→4. `TerrainPicker.select` (hook) maps to the component's `onSelect` prop (wired in Task 4 Step 2). `mapLibrary.get(mapId, listFn)` single-arg-after-removal is consistent between routes.ts and library.ts in Task 5.
