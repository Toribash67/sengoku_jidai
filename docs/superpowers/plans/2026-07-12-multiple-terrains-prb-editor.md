# PR-B Editor Terrains Panel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the editor's single "Generate terrain" button with a Terrains panel that lists, renames, deletes, generates (with a style choice), retries, and previews the up-to-six terrains a map can now hold.

**Architecture:** `EditorScreen` owns terrain list + preview-selection state (the Preview overlay needs them) and renders a new `TerrainsPanel` that performs all mutations and polling against the PR-A many-terrains endpoints. Pure helpers (URL building, selection, disable logic) are extracted and unit-tested; the React component itself is verified by typecheck + the full gate (the web package has no jsdom, so no render tests).

**Tech Stack:** React (function components + hooks), TypeScript, Vitest, Fastify backend (already built in PR-A).

## Global Constraints

- Backend endpoints (PR-A, live): `POST /api/maps/:mapId/terrains` body `{ styleId? }` → `202 {id}` (errors `503`/`403`/`409`/`422`/`400`/`404`); `PATCH …/terrains/:terrainId` body `{ name }` (1–40 chars) → `200`; `DELETE …/terrains/:terrainId` → `204`; `GET …/terrains/:terrainId.webp`. No per-terrain regenerate endpoint.
- Shared contract: `MapDetail.terrains: TerrainInfo[]` (`{ id, name, styleId, status: "pending"|"ready"|"failed", updatedAt }`, oldest-first); `TERRAIN_STYLES`, `DEFAULT_TERRAIN_STYLE = "antique"`, `MAX_TERRAINS_PER_MAP = 6`, `TerrainStyleId`, `isTerrainStyleId`.
- Backward-compat: legacy `GET /terrain.webp` and `MapDetail.terrain` stay live (removed in PR-C); only the legacy `POST /terrain` **web usage** is retired here. Do NOT touch `useTerrainUrl.ts` / `fetchTerrainUrl` / `resolveTerrainUrl` / `terrainApiUrl` / `terrainImage` (play-view path).
- No engine/session/realtime/backend/terrain-package changes.
- Panel visibility guard (unchanged from today): render only when `state.doc.id` is set and `!== "rivers"`.
- Web tests are pure-logic only (no jsdom). Copy text uses a curly apostrophe `’` to match existing strings (e.g. `isn’t`).
- Before running filtered web tests, build shared so `@sengoku-jidai/shared` dist is current (cross-package dist-consumption rule): `corepack pnpm --filter @sengoku-jidai/shared build`.

---

## File Structure

- `packages/web/src/client/api.ts` — **modify**: add `createTerrain` / `renameTerrain` / `deleteTerrain`; remove `generateTerrain` (Task 4).
- `packages/web/src/components/board/terrainImages.ts` — **modify**: add `terrainByIdApiUrl`, `previewTerrainUrl`, `defaultSelection`.
- `packages/web/src/components/editor/TerrainsPanel.tsx` — **create**: the panel component + pure helpers `isGenerating`, `canGenerate`, `generateErrorEffect`, `styleLabel`.
- `packages/web/src/components/editor/TerrainButton.tsx` — **delete** (Task 4).
- `packages/web/src/components/editor/EditorScreen.tsx` — **modify**: list-based state + selection; wire `TerrainsPanel`; preview URL via `previewTerrainUrl` (Task 4).
- `packages/web/src/styles/app.css` — **modify**: panel/row styles.
- Tests: `packages/web/test/client/terrainApi.test.ts` (rewrite), `packages/web/test/board/terrainImages.test.ts` (extend), `packages/web/test/editor/terrainsPanel.test.ts` (new), `packages/web/test/editor/terrainButton.test.ts` (delete, Task 4).

---

## Task 1: API client — add terrain CRUD functions

**Files:**
- Modify: `packages/web/src/client/api.ts`
- Test: `packages/web/test/client/terrainApi.test.ts` (rewrite)

**Interfaces:**
- Consumes: existing `request<T>` helper and `ApiError` in `api.ts`.
- Produces:
  - `createTerrain(mapId: string, styleId: TerrainStyleId): Promise<{ id: string }>`
  - `renameTerrain(mapId: string, terrainId: string, name: string): Promise<void>`
  - `deleteTerrain(mapId: string, terrainId: string): Promise<void>`

- [ ] **Step 1: Write the failing tests** — replace the entire contents of `packages/web/test/client/terrainApi.test.ts`:

```ts
import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError, createTerrain, deleteTerrain, renameTerrain } from "../../src/client/api.js";

afterEach(() => vi.restoreAllMocks());

describe("createTerrain", () => {
  it("POSTs the styleId and returns the new id on 202", async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, status: 202, json: async () => ({ id: "t1" }) }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(createTerrain("m1", "ink")).resolves.toEqual({ id: "t1" });
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/maps/m1/terrains",
      expect.objectContaining({ method: "POST" })
    );
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ styleId: "ink" });
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
    await expect(createTerrain("m1", "antique")).rejects.toMatchObject({ status: 503 });
    await expect(createTerrain("m1", "antique")).rejects.toBeInstanceOf(ApiError);
  });
});

describe("renameTerrain", () => {
  it("PATCHes the name and resolves on 200", async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ ok: true }) }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(renameTerrain("m1", "t1", "Coast")).resolves.toBeUndefined();
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/maps/m1/terrains/t1",
      expect.objectContaining({ method: "PATCH" })
    );
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ name: "Coast" });
  });
});

describe("deleteTerrain", () => {
  it("DELETEs and resolves on 204", async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, status: 204 }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(deleteTerrain("m1", "t1")).resolves.toBeUndefined();
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/maps/m1/terrains/t1",
      expect.objectContaining({ method: "DELETE" })
    );
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `corepack pnpm --filter @sengoku-jidai/shared build && corepack pnpm --filter @sengoku-jidai/web exec vitest run test/client/terrainApi.test.ts`
Expected: FAIL — `createTerrain`, `renameTerrain`, `deleteTerrain` are not exported.

- [ ] **Step 3: Implement the client functions** — in `packages/web/src/client/api.ts`, add `TerrainStyleId` to the shared type import, and replace the existing `generateTerrain` function with the three new functions (keep `generateTerrain` for now — it is removed in Task 4):

Add `TerrainStyleId` to the `@sengoku-jidai/shared` import list at the top:

```ts
import type {
  ApiErrorBody,
  CreateGameResponse,
  ListMapsResponse,
  MapDetail,
  PlayerGameViewEnvelope,
  SubmitCommandResponse,
  TerrainStyleId
} from "@sengoku-jidai/shared";
```

Then add these functions immediately after the existing `generateTerrain` (do not delete `generateTerrain` yet):

```ts
export async function createTerrain(
  mapId: string,
  styleId: TerrainStyleId
): Promise<{ id: string }> {
  return request(`/api/maps/${encodeURIComponent(mapId)}/terrains`, {
    method: "POST",
    body: JSON.stringify({ styleId })
  });
}

export async function renameTerrain(
  mapId: string,
  terrainId: string,
  name: string
): Promise<void> {
  await request(
    `/api/maps/${encodeURIComponent(mapId)}/terrains/${encodeURIComponent(terrainId)}`,
    { method: "PATCH", body: JSON.stringify({ name }) }
  );
}

export async function deleteTerrain(mapId: string, terrainId: string): Promise<void> {
  await request(
    `/api/maps/${encodeURIComponent(mapId)}/terrains/${encodeURIComponent(terrainId)}`,
    { method: "DELETE" }
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `corepack pnpm --filter @sengoku-jidai/web exec vitest run test/client/terrainApi.test.ts`
Expected: PASS (5 assertions across 3 suites).

- [ ] **Step 5: Commit**

```bash
git add packages/web/src/client/api.ts packages/web/test/client/terrainApi.test.ts
git commit -m "feat(web): add createTerrain/renameTerrain/deleteTerrain API client fns"
```

---

## Task 2: Board helpers — per-terrain URL, preview selection, default selection

**Files:**
- Modify: `packages/web/src/components/board/terrainImages.ts`
- Test: `packages/web/test/board/terrainImages.test.ts` (extend; keep existing suites)

**Interfaces:**
- Consumes: `TerrainInfo` from `@sengoku-jidai/shared`.
- Produces:
  - `terrainByIdApiUrl(mapId: string, terrainId: string): string`
  - `previewTerrainUrl(args: { terrains: TerrainInfo[]; selectedTerrainId: string | null; mapId: string }): string | null`
  - `defaultSelection(terrains: TerrainInfo[]): string | null`

- [ ] **Step 1: Write the failing tests** — append to `packages/web/test/board/terrainImages.test.ts`. First extend the import at the top to add the three new functions, then add the new suites:

```ts
// add to the existing import from "../../src/components/board/terrainImages.js":
//   defaultSelection, previewTerrainUrl, terrainByIdApiUrl
import type { TerrainInfo } from "@sengoku-jidai/shared";

const t = (id: string, status: TerrainInfo["status"], updatedAt = "2026-07-12T00:00:00Z"): TerrainInfo => ({
  id,
  name: id,
  styleId: "antique",
  status,
  updatedAt
});

describe("terrainByIdApiUrl", () => {
  it("builds the per-terrain webp path with encoded ids", () => {
    expect(terrainByIdApiUrl("m 1", "t/1")).toBe("/api/maps/m%201/terrains/t%2F1.webp");
  });
});

describe("defaultSelection", () => {
  it("returns the first ready terrain's id", () => {
    expect(defaultSelection([t("a", "failed"), t("b", "ready"), t("c", "ready")])).toBe("b");
  });
  it("returns null when no terrain is ready", () => {
    expect(defaultSelection([t("a", "pending"), t("b", "failed")])).toBeNull();
    expect(defaultSelection([])).toBeNull();
  });
});

describe("previewTerrainUrl", () => {
  const terrains = [t("a", "ready", "2026-01-01T00:00:00Z"), t("b", "pending")];
  it("returns null for the Flat selection", () => {
    expect(previewTerrainUrl({ terrains, selectedTerrainId: null, mapId: "m1" })).toBeNull();
  });
  it("returns null when the selected terrain is missing or not ready", () => {
    expect(previewTerrainUrl({ terrains, selectedTerrainId: "b", mapId: "m1" })).toBeNull();
    expect(previewTerrainUrl({ terrains, selectedTerrainId: "zzz", mapId: "m1" })).toBeNull();
  });
  it("returns the cache-busted per-terrain url for a ready selection", () => {
    expect(previewTerrainUrl({ terrains, selectedTerrainId: "a", mapId: "m1" })).toBe(
      "/api/maps/m1/terrains/a.webp?v=2026-01-01T00%3A00%3A00Z"
    );
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `corepack pnpm --filter @sengoku-jidai/web exec vitest run test/board/terrainImages.test.ts`
Expected: FAIL — the three new functions are not exported.

- [ ] **Step 3: Implement the helpers** — append to `packages/web/src/components/board/terrainImages.ts` (the `TerrainStatus` type import already exists; add `TerrainInfo` to it):

Change the import line at the top of the file from:

```ts
import type { TerrainStatus } from "@sengoku-jidai/shared";
```

to:

```ts
import type { TerrainInfo, TerrainStatus } from "@sengoku-jidai/shared";
```

Then append these functions at the end of the file:

```ts
/** Per-terrain background webp URL (many-terrains API). */
export function terrainByIdApiUrl(mapId: string, terrainId: string): string {
  return `/api/maps/${encodeURIComponent(mapId)}/terrains/${encodeURIComponent(terrainId)}.webp`;
}

/** The id the editor preview selects on load: the first ready terrain, else null (Flat). */
export function defaultSelection(terrains: TerrainInfo[]): string | null {
  return terrains.find((terrain) => terrain.status === "ready")?.id ?? null;
}

/** The terrain background URL for the editor preview given the current selection: null for the
 *  Flat selection or a non-ready/absent terrain; otherwise the per-terrain webp cache-busted with
 *  the terrain's updatedAt (which also keys the server ETag). */
export function previewTerrainUrl(args: {
  terrains: TerrainInfo[];
  selectedTerrainId: string | null;
  mapId: string;
}): string | null {
  if (args.selectedTerrainId === null) {
    return null;
  }
  const selected = args.terrains.find((terrain) => terrain.id === args.selectedTerrainId);
  if (!selected || selected.status !== "ready") {
    return null;
  }
  return `${terrainByIdApiUrl(args.mapId, selected.id)}?v=${encodeURIComponent(selected.updatedAt)}`;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `corepack pnpm --filter @sengoku-jidai/web exec vitest run test/board/terrainImages.test.ts`
Expected: PASS (existing `resolveTerrain`/`resolveTerrainUrl` suites plus the three new ones).

- [ ] **Step 5: Commit**

```bash
git add packages/web/src/components/board/terrainImages.ts packages/web/test/board/terrainImages.test.ts
git commit -m "feat(web): add per-terrain url + preview-selection helpers"
```

---

## Task 3: TerrainsPanel component + pure helpers

**Files:**
- Create: `packages/web/src/components/editor/TerrainsPanel.tsx`
- Create test: `packages/web/test/editor/terrainsPanel.test.ts`
- Modify: `packages/web/src/styles/app.css`

**Interfaces:**
- Consumes: `createTerrain` / `renameTerrain` / `deleteTerrain` / `fetchMap` / `ApiError` (Task 1 + existing `api.ts`); `defaultSelection` (Task 2); `TERRAIN_STYLES`, `DEFAULT_TERRAIN_STYLE`, `MAX_TERRAINS_PER_MAP`, `TerrainInfo`, `TerrainStyleId` (shared).
- Produces:
  - `TerrainsPanel(props: { mapId: string; terrains: TerrainInfo[]; selectedTerrainId: string | null; onSelect: (id: string | null) => void; onTerrainsChange: (terrains: TerrainInfo[]) => void }): JSX.Element`
  - `isGenerating(terrains: TerrainInfo[]): boolean`
  - `canGenerate(args: { terrains: TerrainInfo[]; unavailable: boolean }): { enabled: boolean; reason: string | null }`
  - `generateErrorEffect(status: number | null): "unavailable" | "cap" | "inProgress" | "failed"`
  - `styleLabel(styleId: string): string`

- [ ] **Step 1: Write the failing tests** — create `packages/web/test/editor/terrainsPanel.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { TerrainInfo } from "@sengoku-jidai/shared";
import {
  canGenerate,
  generateErrorEffect,
  isGenerating,
  styleLabel
} from "../../src/components/editor/TerrainsPanel.js";

const t = (status: TerrainInfo["status"]): TerrainInfo => ({
  id: status,
  name: status,
  styleId: "antique",
  status,
  updatedAt: "2026-07-12T00:00:00Z"
});

describe("isGenerating", () => {
  it("is true when any terrain is pending", () => {
    expect(isGenerating([t("ready"), t("pending")])).toBe(true);
    expect(isGenerating([t("ready"), t("failed")])).toBe(false);
    expect(isGenerating([])).toBe(false);
  });
});

describe("canGenerate", () => {
  it("blocks when unavailable, with the config reason (highest precedence)", () => {
    const r = canGenerate({ terrains: [], unavailable: true });
    expect(r.enabled).toBe(false);
    expect(r.reason).toMatch(/configured/);
  });
  it("blocks while a generation is pending", () => {
    const r = canGenerate({ terrains: [t("pending")], unavailable: false });
    expect(r.enabled).toBe(false);
    expect(r.reason).toMatch(/Generating/);
  });
  it("blocks at the cap of 6", () => {
    const six = [t("ready"), t("ready"), t("ready"), t("ready"), t("ready"), t("ready")];
    const r = canGenerate({ terrains: six, unavailable: false });
    expect(r.enabled).toBe(false);
    expect(r.reason).toMatch(/6/);
  });
  it("allows when under cap, idle, and available", () => {
    expect(canGenerate({ terrains: [t("ready")], unavailable: false })).toEqual({
      enabled: true,
      reason: null
    });
  });
});

describe("generateErrorEffect", () => {
  it("maps POST error statuses to effects", () => {
    expect(generateErrorEffect(503)).toBe("unavailable");
    expect(generateErrorEffect(422)).toBe("cap");
    expect(generateErrorEffect(409)).toBe("inProgress");
    expect(generateErrorEffect(500)).toBe("failed");
    expect(generateErrorEffect(null)).toBe("failed");
  });
});

describe("styleLabel", () => {
  it("returns the catalog label, falling back to the id", () => {
    expect(styleLabel("antique")).toBe("Antique (colour)");
    expect(styleLabel("ink")).toBe("Ink (greyscale)");
    expect(styleLabel("mystery")).toBe("mystery");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `corepack pnpm --filter @sengoku-jidai/web exec vitest run test/editor/terrainsPanel.test.ts`
Expected: FAIL — `TerrainsPanel.tsx` does not exist.

- [ ] **Step 3: Create the component + helpers** — create `packages/web/src/components/editor/TerrainsPanel.tsx`:

```tsx
import { useEffect, useState } from "react";
import {
  DEFAULT_TERRAIN_STYLE,
  MAX_TERRAINS_PER_MAP,
  TERRAIN_STYLES,
  type TerrainInfo,
  type TerrainStyleId
} from "@sengoku-jidai/shared";
import {
  ApiError,
  createTerrain,
  deleteTerrain,
  fetchMap,
  renameTerrain
} from "../../client/api.js";
import { defaultSelection } from "../board/terrainImages.js";

/** Pure: is a generation in flight for this map? (one-at-a-time per map on the server) */
export function isGenerating(terrains: TerrainInfo[]): boolean {
  return terrains.some((terrain) => terrain.status === "pending");
}

/** Pure: whether "Generate" is enabled, and the disabled reason to show. Precedence:
 *  unavailable > generating > cap. */
export function canGenerate(args: {
  terrains: TerrainInfo[];
  unavailable: boolean;
}): { enabled: boolean; reason: string | null } {
  if (args.unavailable) {
    return { enabled: false, reason: "Terrain generation isn’t configured on the server." };
  }
  if (isGenerating(args.terrains)) {
    return { enabled: false, reason: "Generating…" };
  }
  if (args.terrains.length >= MAX_TERRAINS_PER_MAP) {
    return { enabled: false, reason: `Maximum ${MAX_TERRAINS_PER_MAP} terrains.` };
  }
  return { enabled: true, reason: null };
}

/** Pure: how a failed generate POST should affect panel state, by HTTP status. */
export function generateErrorEffect(
  status: number | null
): "unavailable" | "cap" | "inProgress" | "failed" {
  if (status === 503) {
    return "unavailable";
  }
  if (status === 422) {
    return "cap";
  }
  if (status === 409) {
    return "inProgress";
  }
  return "failed";
}

/** Pure: human label for a style id, falling back to the raw id. */
export function styleLabel(styleId: string): string {
  return TERRAIN_STYLES.find((style) => style.id === styleId)?.label ?? styleId;
}

export function TerrainsPanel({
  mapId,
  terrains,
  selectedTerrainId,
  onSelect,
  onTerrainsChange
}: {
  mapId: string;
  terrains: TerrainInfo[];
  selectedTerrainId: string | null;
  onSelect: (id: string | null) => void;
  onTerrainsChange: (terrains: TerrainInfo[]) => void;
}) {
  const [style, setStyle] = useState<TerrainStyleId>(DEFAULT_TERRAIN_STYLE);
  const [unavailable, setUnavailable] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [confirmingDeleteId, setConfirmingDeleteId] = useState<string | null>(null);

  // Poll while a generation is in flight. The effect re-runs whenever `terrains` changes: each
  // poll updates `terrains` via onTerrainsChange, which reschedules the next poll; when nothing is
  // pending the effect returns early and polling stops. onTerrainsChange must be stable
  // (EditorScreen wraps it in useCallback).
  useEffect(() => {
    if (!isGenerating(terrains)) {
      return;
    }
    const run = { cancelled: false };
    const timer = window.setTimeout(() => {
      void fetchMap(mapId)
        .then((detail) => {
          if (!run.cancelled) {
            onTerrainsChange(detail.terrains);
          }
        })
        .catch(() => {
          /* transient error: stop polling, leave state as-is */
        });
    }, 1500);
    return () => {
      run.cancelled = true;
      window.clearTimeout(timer);
    };
  }, [terrains, mapId, onTerrainsChange]);

  async function refetch(): Promise<TerrainInfo[] | null> {
    try {
      const detail = await fetchMap(mapId);
      onTerrainsChange(detail.terrains);
      return detail.terrains;
    } catch {
      return null;
    }
  }

  function applyGenerateError(err: unknown): void {
    const status = err instanceof ApiError ? err.status : null;
    switch (generateErrorEffect(status)) {
      case "unavailable":
        setUnavailable(true);
        break;
      case "cap":
      case "inProgress":
        void refetch(); // list will reflect the cap / the in-flight generation (polling resumes)
        break;
      case "failed":
        setError("Generation failed — try again.");
        break;
    }
  }

  async function handleGenerate(): Promise<void> {
    setError(null);
    setBusy(true);
    try {
      const { id } = await createTerrain(mapId, style);
      onSelect(id); // auto-select: preview reveals it once it turns ready
      await refetch();
    } catch (err) {
      applyGenerateError(err);
    } finally {
      setBusy(false);
    }
  }

  async function handleRetry(terrain: TerrainInfo): Promise<void> {
    setError(null);
    setBusy(true);
    try {
      await deleteTerrain(mapId, terrain.id);
      const { id } = await createTerrain(mapId, terrain.styleId);
      onSelect(id);
      await refetch();
    } catch (err) {
      applyGenerateError(err);
      await refetch();
    } finally {
      setBusy(false);
    }
  }

  function startRename(terrain: TerrainInfo): void {
    setEditingId(terrain.id);
    setEditName(terrain.name);
  }

  async function commitRename(): Promise<void> {
    const id = editingId;
    if (id === null) {
      return;
    }
    setEditingId(null);
    const name = editName.trim();
    const current = terrains.find((terrain) => terrain.id === id);
    if (name.length === 0 || !current || name === current.name) {
      return; // empty or unchanged: no-op
    }
    onTerrainsChange(terrains.map((terrain) => (terrain.id === id ? { ...terrain, name } : terrain)));
    try {
      await renameTerrain(mapId, id, name);
    } catch {
      setError("Rename failed.");
      await refetch();
    }
  }

  async function confirmDelete(id: string): Promise<void> {
    setConfirmingDeleteId(null);
    setBusy(true);
    try {
      await deleteTerrain(mapId, id);
    } catch (err) {
      if (!(err instanceof ApiError && err.status === 404)) {
        setError("Delete failed.");
      }
    }
    const next = await refetch();
    if (next && selectedTerrainId === id) {
      onSelect(defaultSelection(next));
    }
    setBusy(false);
  }

  const gen = canGenerate({ terrains, unavailable });

  return (
    <div className="editor-terrains">
      <div className="terrains-head">
        <span className="terrains-title">Terrains</span>
        <select
          aria-label="Terrain style"
          value={style}
          disabled={busy}
          onChange={(event) => setStyle(event.target.value as TerrainStyleId)}
        >
          {TERRAIN_STYLES.map((option) => (
            <option key={option.id} value={option.id}>
              {option.label}
            </option>
          ))}
        </select>
        <button type="button" onClick={() => void handleGenerate()} disabled={!gen.enabled || busy}>
          + Generate
        </button>
        {gen.reason ? <span className="muted">{gen.reason}</span> : null}
      </div>

      <ul className="terrains-list">
        <li className="terrain-row">
          <label className="terrain-select">
            <input
              type="radio"
              name="terrain-preview"
              checked={selectedTerrainId === null}
              onChange={() => onSelect(null)}
            />
            <span>Flat (no terrain)</span>
          </label>
        </li>
        {terrains.map((terrain) => {
          const ready = terrain.status === "ready";
          return (
            <li key={terrain.id} className="terrain-row">
              <input
                type="radio"
                name="terrain-preview"
                aria-label={`Preview ${terrain.name}`}
                checked={selectedTerrainId === terrain.id}
                disabled={!ready}
                onChange={() => onSelect(terrain.id)}
              />
              {editingId === terrain.id ? (
                <input
                  className="terrain-name-edit"
                  aria-label="Terrain name"
                  value={editName}
                  maxLength={40}
                  autoFocus
                  onChange={(event) => setEditName(event.target.value)}
                  onBlur={() => void commitRename()}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      void commitRename();
                    } else if (event.key === "Escape") {
                      setEditingId(null);
                    }
                  }}
                />
              ) : (
                <button type="button" className="terrain-name" onClick={() => startRename(terrain)}>
                  {terrain.name}
                </button>
              )}
              <span className="terrain-style muted">{styleLabel(terrain.styleId)}</span>
              <span className={`terrain-badge is-${terrain.status}`}>{terrain.status}</span>
              {terrain.status === "failed" ? (
                <button type="button" onClick={() => void handleRetry(terrain)} disabled={busy}>
                  Retry
                </button>
              ) : null}
              {confirmingDeleteId === terrain.id ? (
                <span className="terrain-confirm">
                  <span>Delete this terrain?</span>
                  <button type="button" onClick={() => void confirmDelete(terrain.id)} disabled={busy}>
                    Delete
                  </button>
                  <button type="button" onClick={() => setConfirmingDeleteId(null)}>
                    Cancel
                  </button>
                </span>
              ) : (
                <button
                  type="button"
                  className="terrain-delete"
                  aria-label={`Delete ${terrain.name}`}
                  onClick={() => setConfirmingDeleteId(terrain.id)}
                  disabled={busy}
                >
                  🗑
                </button>
              )}
            </li>
          );
        })}
      </ul>
      {error ? <span className="muted">{error}</span> : null}
    </div>
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `corepack pnpm --filter @sengoku-jidai/web exec vitest run test/editor/terrainsPanel.test.ts`
Expected: PASS (isGenerating, canGenerate, generateErrorEffect, styleLabel suites).

- [ ] **Step 5: Add panel styles** — in `packages/web/src/styles/app.css`, add these rules immediately after the existing `.editor-terrain { … }` block (around line 1066):

```css
.editor-terrains {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 8px 12px;
  border-bottom: 1px solid var(--hairline);
}
.terrains-head {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}
.terrains-title {
  font-weight: 600;
}
.terrains-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.terrain-row {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}
.terrain-select {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}
.terrain-name {
  background: none;
  border: none;
  padding: 2px 4px;
  cursor: text;
  text-align: left;
  color: inherit;
  font: inherit;
}
.terrain-name-edit {
  font: inherit;
  padding: 2px 4px;
}
.terrain-badge {
  font-size: 12px;
  text-transform: capitalize;
}
.terrain-badge.is-ready {
  color: #2e7d32;
}
.terrain-badge.is-pending {
  color: var(--muted, #888);
}
.terrain-badge.is-failed {
  color: #c62828;
}
.terrain-confirm {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}
.terrain-delete {
  background: none;
  border: none;
  cursor: pointer;
}
```

- [ ] **Step 6: Verify typecheck + lint pass for the new component**

Run: `corepack pnpm --filter @sengoku-jidai/web typecheck && corepack pnpm exec eslint packages/web/src/components/editor/TerrainsPanel.tsx`
Expected: no errors. (The component is not yet wired into `EditorScreen`; that is Task 4.)

- [ ] **Step 7: Commit**

```bash
git add packages/web/src/components/editor/TerrainsPanel.tsx packages/web/test/editor/terrainsPanel.test.ts packages/web/src/styles/app.css
git commit -m "feat(web): TerrainsPanel component + panel-state helpers + styles"
```

---

## Task 4: Wire EditorScreen, retire the legacy button + POST /terrain usage

**Files:**
- Modify: `packages/web/src/components/editor/EditorScreen.tsx`
- Delete: `packages/web/src/components/editor/TerrainButton.tsx`
- Delete: `packages/web/test/editor/terrainButton.test.ts`
- Modify: `packages/web/src/client/api.ts` (remove `generateTerrain`)

**Interfaces:**
- Consumes: `TerrainsPanel`, `previewTerrainUrl`, `defaultSelection`, `TerrainInfo`.
- Produces: no new exports.

- [ ] **Step 1: Update `EditorScreen.tsx` imports.** Change line 1 to add `useCallback`:

```tsx
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
```

Change the shared type import (line 4) from `TerrainStatus` to `TerrainInfo`:

```tsx
import type { TerrainInfo } from "@sengoku-jidai/shared";
```

Change the terrainImages import (line 14):

```tsx
import { defaultSelection, previewTerrainUrl } from "../board/terrainImages.js";
```

Change the component import (line 18):

```tsx
import { TerrainsPanel } from "./TerrainsPanel.js";
```

- [ ] **Step 2: Swap terrain state.** Replace the two state lines (31–34):

```tsx
  const [terrainStatus, setTerrainStatus] = useState<TerrainStatus>("none");
  // Bumped whenever generation transitions to "ready" so a regenerated webp (same URL) is
  // re-fetched instead of served stale from cache.
  const [terrainVersion, setTerrainVersion] = useState(0);
```

with:

```tsx
  const [terrains, setTerrains] = useState<TerrainInfo[]>([]);
  const [selectedTerrainId, setSelectedTerrainId] = useState<string | null>(null);
```

- [ ] **Step 3: Update the load effect.** In the load effect, replace the reset lines (40–41):

```tsx
    setTerrainStatus("none");
    setTerrainVersion(0);
```

with:

```tsx
    setTerrains([]);
    setSelectedTerrainId(null);
```

Then, inside the `.then((detail) => { … })` block, immediately after the `dispatch({ type: "loadDoc", … })` call (after line 60), add:

```tsx
        setTerrains(detail.terrains);
        setSelectedTerrainId(defaultSelection(detail.terrains));
```

- [ ] **Step 4: Replace the preview-URL memo and status handler.** Replace the `terrainPreviewUrl` memo (105–111):

```tsx
  const terrainPreviewUrl = useMemo(() => {
    const id = state.doc.id ?? "";
    const committed = terrainImage(id);
    const base = resolveTerrainUrl({ committed, terrain: terrainStatus, mapId: id });
    // Cache-bust only the server-generated URL (committed built-in assets are immutable).
    return base && !committed ? `${base}?v=${terrainVersion}` : base;
  }, [state.doc.id, terrainStatus, terrainVersion]);
```

with:

```tsx
  const terrainPreviewUrl = useMemo(
    () => previewTerrainUrl({ terrains, selectedTerrainId, mapId: state.doc.id ?? "" }),
    [terrains, selectedTerrainId, state.doc.id]
  );
```

Replace the `handleTerrainStatus` function (113–118):

```tsx
  function handleTerrainStatus(terrain: TerrainStatus) {
    setTerrainStatus(terrain);
    if (terrain === "ready") {
      setTerrainVersion((v) => v + 1);
    }
  }
```

with stable callbacks (`onTerrainsChange` must be stable for the panel's polling effect):

```tsx
  const handleSelect = useCallback((id: string | null) => setSelectedTerrainId(id), []);
  const handleTerrainsChange = useCallback((next: TerrainInfo[]) => setTerrains(next), []);
```

- [ ] **Step 5: Swap the rendered component.** Replace the `TerrainButton` block (277–279):

```tsx
      {state.doc.id && state.doc.id !== "rivers" ? (
        <TerrainButton mapId={state.doc.id} onStatusChange={handleTerrainStatus} />
      ) : null}
```

with:

```tsx
      {state.doc.id && state.doc.id !== "rivers" ? (
        <TerrainsPanel
          mapId={state.doc.id}
          terrains={terrains}
          selectedTerrainId={selectedTerrainId}
          onSelect={handleSelect}
          onTerrainsChange={handleTerrainsChange}
        />
      ) : null}
```

- [ ] **Step 6: Remove the legacy button + client function.** Delete the files and the `generateTerrain` function:

```bash
git rm packages/web/src/components/editor/TerrainButton.tsx packages/web/test/editor/terrainButton.test.ts
```

Then in `packages/web/src/client/api.ts`, delete the `generateTerrain` function (the `POST …/terrain` call):

```ts
export async function generateTerrain(mapId: string): Promise<void> {
  await request(`/api/maps/${encodeURIComponent(mapId)}/terrain`, { method: "POST" });
}
```

- [ ] **Step 7: Verify no dangling references to the removed symbols**

Run: `grep -rn "generateTerrain\|TerrainButton\|resolveTerrainUrl\|terrainImage\|terrainStatus\|terrainVersion" packages/web/src`
Expected: only `resolveTerrainUrl` / `terrainImage` remain, and only inside `terrainImages.ts` and `useTerrainUrl.ts` (the play-view path). No hits for `generateTerrain`, `TerrainButton`, `terrainStatus`, or `terrainVersion`.

- [ ] **Step 8: Typecheck + web tests**

Run: `corepack pnpm --filter @sengoku-jidai/shared build && corepack pnpm --filter @sengoku-jidai/web typecheck && corepack pnpm --filter @sengoku-jidai/web test`
Expected: typecheck clean; all web tests pass (no `terrainButton.test.ts`; new suites green).

- [ ] **Step 9: Commit**

```bash
git add packages/web/src/components/editor/EditorScreen.tsx packages/web/src/client/api.ts
git commit -m "feat(web): editor Terrains panel replaces the single terrain button

Wire TerrainsPanel into EditorScreen with list-based terrain state and
per-terrain preview selection; retire the legacy POST /terrain web usage
and TerrainButton. Legacy GET /terrain.webp + MapDetail.terrain remain
for the play view (PR-C)."
```

---

## Task 5: Full gate + PR

- [ ] **Step 1: Run the full gate**

Run: `corepack pnpm typecheck && corepack pnpm lint && corepack pnpm test`
Expected: all green.

- [ ] **Step 2: Push and open the PR**

```bash
git push -u origin feat/terrains-panel
gh pr create --title "PR-B: editor Terrains panel (many-terrains manage/preview/style)" --body "$(cat <<'EOF'
Replaces the single "Generate terrain" button with a Terrains panel: list, inline-rename, delete-with-confirm, generate (style dropdown), one-click retry of failed terrains, and a per-terrain Preview selector (with a Flat option). Backed by the PR-A many-terrains endpoints.

Retires the legacy `POST /terrain` web usage (and `TerrainButton`); legacy `GET /terrain.webp` + `MapDetail.terrain` stay live for the play view until PR-C.

Spec: docs/superpowers/specs/2026-07-12-multiple-terrains-prb-editor-design.md
Plan: docs/superpowers/plans/2026-07-12-multiple-terrains-prb-editor.md

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 3: Watch CI**

Run: `gh pr checks --watch`
Expected: all checks pass.

- [ ] **Step 4: STOP — ask before merging.** Do not merge. Report CI status and hand off to Martin for review + a real browser check of the editor panel against the live deploy (per his workflow, PR-B is the first web-facing change worth eyeballing).

---

## Self-Review Notes

- **Spec coverage:** panel placement (Task 3 markup + Task 4 wiring), Flat row + default-to-first-ready (`defaultSelection`, Task 2 + Task 4 load effect), preview URL via `updatedAt` cache-bust dropping `terrainVersion` (Task 2 + Task 4), generate + style dropdown (Task 3), cap/generating/unavailable disable (`canGenerate`, Task 3), rename inline (Task 3), delete two-step confirm (Task 3), one-click retry (Task 3), polling reuse (Task 3 effect), API client CRUD + legacy retirement (Task 1 + Task 4), tests pure-logic only (Tasks 1–3), no e2e changes (none reference terrain). All covered.
- **Type consistency:** `TerrainInfo` / `TerrainStyleId` used consistently; `onTerrainsChange` / `onSelect` names match between `TerrainsPanel` props and `EditorScreen` callbacks; `defaultSelection` / `previewTerrainUrl` / `terrainByIdApiUrl` signatures identical across producer (Task 2) and consumers (Tasks 3–4).
- **Manual verification note:** the panel component has no automated render coverage (web has no jsdom); Task 5 step 4 defers a real-browser check to Martin.
