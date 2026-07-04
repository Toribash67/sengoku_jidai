# Map Editor UI (SP5) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Author, manage, and play custom hex maps entirely in the browser: a `/maps` library screen, a hex editor saving through the SP4 maps API, and a map picker on the create-game screen.

**Architecture:** All web-only (plus additive re-exports in `engine/src/client.ts`). Editor state is a pure reducer over a `HexMapSource`-shaped document (hex-per-tile default, merge for multi-hex tiles), rendered on a schematic SVG canvas; the real board-render pipeline powers an optional preview. Spec: `docs/superpowers/specs/2026-07-03-map-editor-ui-design.md`.

**Tech Stack:** React 18 + TypeScript (packages/web), vitest, Playwright, engine hex geometry (`pixelToAxial` etc.), board-render for preview.

## Global Constraints

- Web imports the engine ONLY via `@sengoku-jidai/engine/client` (ESLint-enforced). Anything new the web needs is re-exported from `packages/engine/src/client.ts`.
- `engine/client` is consumed from **dist**: after editing `client.ts`, run `corepack pnpm --filter @sengoku-jidai/engine build` or web typecheck/tests see stale types.
- Full gate before every push: `corepack pnpm typecheck && corepack pnpm test && corepack pnpm build && corepack pnpm lint && corepack pnpm exec prettier --check .` (run `prettier --write` on touched files first).
- Commits end with `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`. PR bodies end with the Claude Code line. Squash-merge, delete branch — and **ask Martin before merging**.
- Three PRs: PR 1 (Tasks 1–5) on the existing `sp5-map-editor-ui` branch; PR 2 (Tasks 6–15) on `sp5-editor-core` off fresh main after PR 1 merges; PR 3 (Tasks 16–19) on `sp5-editor-finish` off fresh main after PR 2 merges.
- New unit tests live in `packages/web/test/editor/`; edits to existing colocated test files (`src/client/api.test.ts`, `src/state/route.test.ts`) stay colocated.
- Run a single web test file with: `corepack pnpm --filter @sengoku-jidai/web exec vitest run <path relative to packages/web>`.
- No `Date.now()`-dependent test assertions; drafts store ISO strings compared lexically.

---

# PR 1 — Map library screen + create-game picker (branch `sp5-map-editor-ui`)

### Task 1: Maps API client + `createGame` mapId

**Files:**
- Modify: `packages/web/src/client/api.ts`
- Test: `packages/web/src/client/api.test.ts`

**Interfaces:**
- Consumes: `ListMapsResponse`, `MapDetail`, `ApiErrorBody` from `@sengoku-jidai/shared`; `HexMapSource` from `@sengoku-jidai/engine/client`.
- Produces (later tasks rely on these exact signatures):
  - `listMaps(): Promise<ListMapsResponse>`
  - `createMap(source: HexMapSource): Promise<MapDetail>`
  - `updateMap(mapId: string, source: HexMapSource): Promise<MapDetail>`
  - `deleteMap(mapId: string): Promise<void>` (server replies 204)
  - `createGame(input: { name: string; side: SeatId; mapId?: string })`
  - `apiErrorMessage(caught: unknown): string`

- [ ] **Step 1: Write the failing tests**

Append to `packages/web/src/client/api.test.ts` (self-contained describe block; mirror the fetch-stub helper style already used in `test/client/maps.test.ts`):

```ts
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ApiError,
  apiErrorMessage,
  createGame,
  createMap,
  deleteMap,
  listMaps,
  updateMap
} from "./api.js";
import type { HexMapSource } from "@sengoku-jidai/engine/client";

function stubFetch(status: number, body: unknown): ReturnType<typeof vi.fn> {
  const mock = vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body)
  });
  vi.stubGlobal("fetch", mock);
  return mock;
}

const SOURCE: HexMapSource = {
  id: "new-map",
  name: "Test",
  layout: { size: 114, originX: 0, originY: 0 },
  tiles: [{ id: "t1", kind: "land", hexes: [{ q: 0, r: 0 }], features: {} }],
  startingDeployment: {},
  bonusSlots: []
};

describe("maps api client", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("lists maps", async () => {
    const mock = stubFetch(200, { maps: [] });
    await expect(listMaps()).resolves.toEqual({ maps: [] });
    expect(mock).toHaveBeenCalledWith("/api/maps", expect.anything());
  });

  it("creates a map with POST", async () => {
    const mock = stubFetch(201, { id: "abc" });
    await createMap(SOURCE);
    const [url, init] = mock.mock.calls[0]!;
    expect(url).toBe("/api/maps");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body as string).name).toBe("Test");
  });

  it("updates a map with PUT", async () => {
    const mock = stubFetch(200, { id: "abc" });
    await updateMap("abc", SOURCE);
    const [url, init] = mock.mock.calls[0]!;
    expect(url).toBe("/api/maps/abc");
    expect(init.method).toBe("PUT");
  });

  it("deletes a map and tolerates the empty 204 body", async () => {
    const mock = vi.fn().mockResolvedValue({
      ok: true,
      status: 204,
      json: () => Promise.reject(new Error("no body"))
    });
    vi.stubGlobal("fetch", mock);
    await expect(deleteMap("abc")).resolves.toBeUndefined();
    expect(mock.mock.calls[0]![1].method).toBe("DELETE");
  });

  it("sends mapId when creating a game", async () => {
    const mock = stubFetch(200, { gameId: "g1" });
    await createGame({ name: "Oda", side: "red", mapId: "abc" });
    expect(JSON.parse(mock.mock.calls[0]![1].body as string).mapId).toBe("abc");
  });

  it("extracts the server error envelope message", () => {
    const err = new ApiError(409, {
      error: { code: "mapInUse", message: "Map is used by existing games.", requestId: "r" }
    });
    expect(apiErrorMessage(err)).toBe("Map is used by existing games.");
    expect(apiErrorMessage(new Error("boom"))).toBe("boom");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `corepack pnpm --filter @sengoku-jidai/web exec vitest run src/client/api.test.ts`
Expected: FAIL — `listMaps` etc. are not exported.

- [ ] **Step 3: Implement**

In `packages/web/src/client/api.ts`:

1. Extend imports: add `ListMapsResponse` and `ApiErrorBody` to the `@sengoku-jidai/shared` type import; add `HexMapSource` to the engine client type import.
2. `createGame` gains `mapId`:

```ts
export async function createGame(input: {
  name: string;
  side: SeatId;
  mapId?: string;
}): Promise<CreateGameResponse<PlayerGameView>> {
  return request("/api/games", {
    method: "POST",
    body: JSON.stringify({
      mode: "private_multiplayer",
      name: input.name,
      side: input.side,
      mapId: input.mapId
    })
  });
}
```

3. New functions (below `fetchMap`):

```ts
export async function listMaps(): Promise<ListMapsResponse> {
  return request("/api/maps");
}

export async function createMap(source: HexMapSource): Promise<MapDetail> {
  return request("/api/maps", { method: "POST", body: JSON.stringify(source) });
}

export async function updateMap(mapId: string, source: HexMapSource): Promise<MapDetail> {
  return request(`/api/maps/${encodeURIComponent(mapId)}`, {
    method: "PUT",
    body: JSON.stringify(source)
  });
}

export async function deleteMap(mapId: string): Promise<void> {
  return request(`/api/maps/${encodeURIComponent(mapId)}`, { method: "DELETE" });
}
```

4. In `request`, handle bodyless success before parsing JSON:

```ts
  const response = await fetch(url, { ...init, headers });
  if (response.status === 204) {
    return undefined as T;
  }
  const body = (await response.json()) as T;
```

5. Error-message helper (exported, next to `ApiError`):

```ts
/** Human-readable message for a failed call: the server envelope's message when present. */
export function apiErrorMessage(caught: unknown): string {
  if (caught instanceof ApiError) {
    const body = caught.body as Partial<ApiErrorBody> | null;
    const message = body?.error?.message;
    if (typeof message === "string" && message.length > 0) {
      return message;
    }
  }
  return caught instanceof Error ? caught.message : "Something went wrong.";
}
```

Note: if TS rejects assigning the engine `HexMapSource` to the shared zod DTO anywhere, keep the engine type as the parameter type (as above) — the wire shape is identical (SP4 keeps them in sync with a compile-time assertion in the server).

- [ ] **Step 4: Run tests to verify they pass**

Run: `corepack pnpm --filter @sengoku-jidai/web exec vitest run src/client/api.test.ts`
Expected: PASS. Also run the untouched suites: `corepack pnpm --filter @sengoku-jidai/web test` — all green.

- [ ] **Step 5: Commit**

```bash
git add packages/web/src/client/api.ts packages/web/src/client/api.test.ts
git commit -m "feat(web): maps API client + createGame mapId

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: Routes for `/maps` and the editor

**Files:**
- Modify: `packages/web/src/state/route.ts`
- Test: `packages/web/src/state/route.test.ts`

**Interfaces:**
- Produces:
  - `Route` union: `{ kind: "create"; map: string | null } | { kind: "game"; gameId: string; token: string } | { kind: "maps" } | { kind: "editor"; mapId: string | null }`
  - `parseRoute(loc: { pathname: string; hash: string; search: string }): Route`
  - `mapsUrl(): string` → `"/maps"`
  - `editorUrl(mapId: string | null): string` → `"/maps/new"` or `"/maps/<id>/edit"`
  - `createUrl(mapId?: string): string` → `"/"` or `"/?map=<id>"`

- [ ] **Step 1: Write the failing tests**

Add to `packages/web/src/state/route.test.ts` (existing tests that call `parseRoute({ pathname, hash })` gain `search: ""`; keep their assertions, with create-route expectations now including `map: null`):

```ts
describe("SP5 routes", () => {
  it("parses /maps", () => {
    expect(parseRoute({ pathname: "/maps", hash: "", search: "" })).toEqual({ kind: "maps" });
    expect(parseRoute({ pathname: "/maps/", hash: "", search: "" })).toEqual({ kind: "maps" });
  });

  it("parses the editor routes", () => {
    expect(parseRoute({ pathname: "/maps/new", hash: "", search: "" })).toEqual({
      kind: "editor",
      mapId: null
    });
    expect(parseRoute({ pathname: "/maps/abc-123/edit", hash: "", search: "" })).toEqual({
      kind: "editor",
      mapId: "abc-123"
    });
  });

  it("parses the create route's map preselect", () => {
    expect(parseRoute({ pathname: "/", hash: "", search: "?map=abc" })).toEqual({
      kind: "create",
      map: "abc"
    });
    expect(parseRoute({ pathname: "/", hash: "", search: "" })).toEqual({
      kind: "create",
      map: null
    });
  });

  it("builds urls", () => {
    expect(mapsUrl()).toBe("/maps");
    expect(editorUrl(null)).toBe("/maps/new");
    expect(editorUrl("a b")).toBe("/maps/a%20b/edit");
    expect(createUrl()).toBe("/");
    expect(createUrl("a b")).toBe("/?map=a%20b");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `corepack pnpm --filter @sengoku-jidai/web exec vitest run src/state/route.test.ts`
Expected: FAIL — routes/helpers missing.

- [ ] **Step 3: Implement**

In `packages/web/src/state/route.ts`:

```ts
export type Route =
  | { kind: "create"; map: string | null }
  | { kind: "game"; gameId: string; token: string }
  | { kind: "maps" }
  | { kind: "editor"; mapId: string | null };

const GAME_PATH = /^\/g\/([^/]+)\/?$/;
const MAPS_PATH = /^\/maps\/?$/;
const EDITOR_NEW_PATH = /^\/maps\/new\/?$/;
const EDITOR_EDIT_PATH = /^\/maps\/([^/]+)\/edit\/?$/;

/** Parse a location into a route. The seat token rides in the URL fragment so it
 *  never reaches the server. Pure — takes the location parts as an argument. */
export function parseRoute(loc: { pathname: string; hash: string; search: string }): Route {
  const game = GAME_PATH.exec(loc.pathname);
  if (game) {
    const token = loc.hash.startsWith("#") ? loc.hash.slice(1) : "";
    return { kind: "game", gameId: decodeURIComponent(game[1]!), token };
  }
  if (EDITOR_NEW_PATH.test(loc.pathname)) {
    return { kind: "editor", mapId: null };
  }
  const edit = EDITOR_EDIT_PATH.exec(loc.pathname);
  if (edit) {
    return { kind: "editor", mapId: decodeURIComponent(edit[1]!) };
  }
  if (MAPS_PATH.test(loc.pathname)) {
    return { kind: "maps" };
  }
  return { kind: "create", map: new URLSearchParams(loc.search).get("map") };
}

export function mapsUrl(): string {
  return "/maps";
}

export function editorUrl(mapId: string | null): string {
  return mapId === null ? "/maps/new" : `/maps/${encodeURIComponent(mapId)}/edit`;
}

export function createUrl(mapId?: string): string {
  return mapId ? `/?map=${encodeURIComponent(mapId)}` : "/";
}
```

`gameUrl`, `inviteUrl`, `navigateTo`, `useRoute` stay as they are (`window.location` already has `search`).

- [ ] **Step 4: Run tests to verify they pass**

Run: `corepack pnpm --filter @sengoku-jidai/web exec vitest run src/state/route.test.ts`
Expected: PASS. Then `corepack pnpm --filter @sengoku-jidai/web exec tsc --noEmit -p tsconfig.json` (or root `corepack pnpm typecheck`) — App.tsx still compiles because `route.kind === "create"` narrowing is unchanged.

- [ ] **Step 5: Commit**

```bash
git add packages/web/src/state/route.ts packages/web/src/state/route.test.ts
git commit -m "feat(web): routes for map library and editor

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: Map library screen (browse / delete / new game)

**Files:**
- Create: `packages/web/src/components/MapLibraryScreen.tsx`
- Modify: `packages/web/src/App.tsx` (route branch), `packages/web/src/styles/app.css`

**Interfaces:**
- Consumes: `listMaps`, `deleteMap`, `apiErrorMessage` (Task 1); `navigateTo`, `createUrl`, `editorUrl` (Task 2); `MapSummary` from `@sengoku-jidai/shared`.
- Produces: `MapLibraryScreen()` React component (no props). **No Edit/New-map buttons yet** — the editor ships in PR 2; this screen is browse/delete/new-game only.

- [ ] **Step 1: Implement the component**

Create `packages/web/src/components/MapLibraryScreen.tsx`:

```tsx
import { useEffect, useState } from "react";
import type { MapSummary } from "@sengoku-jidai/shared";
import { apiErrorMessage, deleteMap, listMaps } from "../client/api.js";
import { createUrl, navigateTo } from "../state/route.js";

export function MapLibraryScreen() {
  const [maps, setMaps] = useState<MapSummary[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  async function load() {
    setLoadError(null);
    try {
      const response = await listMaps();
      setMaps(response.maps);
    } catch (caught) {
      setLoadError(apiErrorMessage(caught));
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function handleDelete(map: MapSummary) {
    if (!window.confirm(`Delete "${map.name}"? This cannot be undone.`)) {
      return;
    }
    setActionError(null);
    try {
      await deleteMap(map.id);
      await load();
    } catch (caught) {
      setActionError(apiErrorMessage(caught));
    }
  }

  return (
    <main className="app-shell app-empty">
      <section className="start-panel map-library" aria-label="Map library">
        <header className="map-library-header">
          <h1>Map library</h1>
          <button type="button" className="secondary-action" onClick={() => navigateTo("/")}>
            Back to game
          </button>
        </header>
        {actionError ? <p className="error-text">{actionError}</p> : null}
        {loadError ? (
          <>
            <p className="error-text">{loadError}</p>
            <button type="button" className="secondary-action" onClick={() => void load()}>
              Retry
            </button>
          </>
        ) : maps === null ? (
          <p className="muted">Loading maps…</p>
        ) : (
          <ul className="map-list">
            {maps.map((map) => (
              <li key={map.id} className="map-row">
                <div className="map-row-info">
                  <strong>{map.name}</strong>
                  <span className="muted">
                    {map.tileCount} tiles
                    {map.builtin ? " · built-in" : ""}
                    {map.updatedAt ? ` · ${new Date(map.updatedAt).toLocaleDateString()}` : ""}
                  </span>
                </div>
                <div className="map-row-actions">
                  <button
                    type="button"
                    className="primary-action"
                    onClick={() => navigateTo(createUrl(map.id))}
                  >
                    New game
                  </button>
                  {!map.builtin ? (
                    <button
                      type="button"
                      className="secondary-action"
                      onClick={() => void handleDelete(map)}
                    >
                      Delete
                    </button>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
```

- [ ] **Step 2: Wire the route in App.tsx**

In `packages/web/src/App.tsx`, import the screen and add the branch immediately before `if (route.kind === "create")` (around line 683):

```tsx
import { MapLibraryScreen } from "./components/MapLibraryScreen.js";
```

```tsx
  if (route.kind === "maps") {
    return <MapLibraryScreen />;
  }
```

Also add a temporary editor placeholder so the `editor` route kind is exhaustively handled until PR 2 (App returns the not-found panel otherwise):

```tsx
  if (route.kind === "editor") {
    return (
      <main className="app-shell app-empty">
        <section className="start-panel" aria-label="Map editor">
          <p className="muted">The map editor arrives in the next update.</p>
          <button type="button" className="secondary-action" onClick={() => navigateTo("/maps")}>
            Back to library
          </button>
        </section>
      </main>
    );
  }
```

- [ ] **Step 3: Styles**

Append to `packages/web/src/styles/app.css`:

```css
/* --- Map library --- */
.map-library {
  width: min(560px, 92vw);
}
.map-library-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}
.map-list {
  list-style: none;
  margin: 16px 0 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.map-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 10px 12px;
  border: 1px solid rgba(0, 0, 0, 0.12);
  border-radius: 8px;
}
.map-row-info {
  display: flex;
  flex-direction: column;
  gap: 2px;
  text-align: left;
}
.map-row-actions {
  display: flex;
  gap: 8px;
}
```

(Match the file's existing color-variable conventions if it uses CSS custom properties — reuse them rather than hardcoding.)

- [ ] **Step 4: Verify**

Run: `corepack pnpm typecheck && corepack pnpm --filter @sengoku-jidai/web test && corepack pnpm lint`
Expected: green. Optionally eyeball via `corepack pnpm dev` → `http://localhost:<port>/maps` shows Rivers with a New game button and no Delete.

- [ ] **Step 5: Commit**

```bash
git add packages/web/src/components/MapLibraryScreen.tsx packages/web/src/App.tsx packages/web/src/styles/app.css
git commit -m "feat(web): map library screen at /maps

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 4: Create-game map picker

**Files:**
- Modify: `packages/web/src/components/CreateGameScreen.tsx`, `packages/web/src/App.tsx`

**Interfaces:**
- Consumes: `listMaps`, `apiErrorMessage` (Task 1); `route.map` + `mapsUrl` (Task 2); `riversMapId` from `@sengoku-jidai/engine/client`.
- Produces: `CreateGameScreenProps` gains `preselectMapId: string | null` and `onCreate: (name: string, side: SeatId, mapId: string) => void`.

- [ ] **Step 1: Extend CreateGameScreen**

Replace `packages/web/src/components/CreateGameScreen.tsx` content with:

```tsx
import { useEffect, useState, type FormEvent } from "react";
import type { SeatId } from "@sengoku-jidai/engine/client";
import { riversMapId } from "@sengoku-jidai/engine/client";
import type { MapSummary } from "@sengoku-jidai/shared";
import { listMaps } from "../client/api.js";
import { mapsUrl, navigateTo } from "../state/route.js";

interface CreateGameScreenProps {
  busy: boolean;
  error: string | null;
  preselectMapId: string | null;
  onCreate: (name: string, side: SeatId, mapId: string) => void;
}

const SIDES: { id: SeatId; label: string }[] = [
  { id: "red", label: "Red" },
  { id: "black", label: "Black" }
];

export function CreateGameScreen({ busy, error, preselectMapId, onCreate }: CreateGameScreenProps) {
  const [name, setName] = useState("");
  const [side, setSide] = useState<SeatId>("red");
  const [maps, setMaps] = useState<MapSummary[] | null>(null);
  const [mapsFailed, setMapsFailed] = useState(false);
  const [mapId, setMapId] = useState<string>(riversMapId);
  const trimmed = name.trim();

  useEffect(() => {
    let cancelled = false;
    listMaps()
      .then((response) => {
        if (cancelled) {
          return;
        }
        setMaps(response.maps);
        if (preselectMapId && response.maps.some((m) => m.id === preselectMapId)) {
          setMapId(preselectMapId);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setMapsFailed(true);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [preselectMapId]);

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (trimmed.length === 0 || busy) {
      return;
    }
    onCreate(trimmed, side, mapId);
  }

  return (
    <main className="app-shell app-empty">
      <section className="start-panel create-screen" aria-label="Create game">
        <h1>General Orders: Sengoku Jidai</h1>
        <form className="create-form" onSubmit={handleSubmit}>
          <label className="field">
            <span>Your name</span>
            <input
              type="text"
              value={name}
              maxLength={80}
              autoFocus
              placeholder="e.g. Nobunaga"
              onChange={(event) => setName(event.target.value)}
            />
          </label>

          <label className="field">
            <span>Map</span>
            <select value={mapId} onChange={(event) => setMapId(event.target.value)}>
              {(maps ?? [{ id: riversMapId, name: "Rivers", tileCount: 22, builtin: true, updatedAt: null }]).map(
                (map) => (
                  <option key={map.id} value={map.id}>
                    {map.name} ({map.tileCount} tiles)
                  </option>
                )
              )}
            </select>
          </label>
          {mapsFailed ? <p className="muted">Couldn’t load the map library — using Rivers.</p> : null}

          <fieldset className="side-toggle">
            <legend>Your side</legend>
            {SIDES.map((option) => (
              <button
                key={option.id}
                type="button"
                data-side={option.id}
                aria-pressed={side === option.id}
                className={side === option.id ? "is-active" : ""}
                onClick={() => setSide(option.id)}
              >
                {option.label}
              </button>
            ))}
          </fieldset>

          <button type="submit" className="primary-action" disabled={busy || trimmed.length === 0}>
            {busy ? "Creating…" : "Create game"}
          </button>
        </form>
        {error ? <p className="error-text">{error}</p> : null}
        <button type="button" className="secondary-action" onClick={() => navigateTo(mapsUrl())}>
          Map library
        </button>
      </section>
    </main>
  );
}
```

- [ ] **Step 2: Wire App.tsx**

In `packages/web/src/App.tsx`:

1. `handleCreate` signature and call (line ~308):

```tsx
  async function handleCreate(name: string, side: SeatId, mapId: string) {
    setBusy(true);
    setError(null);
    try {
      const created = await createGame({ name, side, mapId });
```

(the rest of the body is unchanged — `ensureMapLoaded(created.view.mapId)` already handles custom maps).

2. The create branch (line ~683):

```tsx
  if (route.kind === "create") {
    return (
      <CreateGameScreen
        busy={busy}
        error={error}
        preselectMapId={route.map}
        onCreate={handleCreate}
      />
    );
  }
```

- [ ] **Step 3: Verify**

Run: `corepack pnpm typecheck && corepack pnpm --filter @sengoku-jidai/web test && corepack pnpm lint`
Expected: green. The e2e suite (`corepack pnpm exec playwright test`) should also stay green — the create flow still defaults to Rivers; run it if the environment allows, otherwise rely on CI.

- [ ] **Step 4: Commit**

```bash
git add packages/web/src/components/CreateGameScreen.tsx packages/web/src/App.tsx
git commit -m "feat(web): map picker on the create-game screen

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 5: PR 1 gate + pull request

- [ ] **Step 1: Full gate**

```bash
corepack pnpm exec prettier --write packages/web docs/superpowers
corepack pnpm typecheck && corepack pnpm test && corepack pnpm build && corepack pnpm lint && corepack pnpm exec prettier --check .
```

Expected: all green. Fix anything red before proceeding (commit fixes with sensible messages).

- [ ] **Step 2: Push and open PR**

```bash
git push -u origin sp5-map-editor-ui
gh pr create --title "feat(web): map library screen + create-game map picker (SP5 part 1)" --body "$(cat <<'EOF'
## Summary
- /maps library screen: browse all maps (built-ins + uploads), delete unused custom maps, start a game on any map
- Create-game screen gains a map picker (defaults to Rivers, honors ?map= preselect) and always sends mapId
- Maps API client (list/create/update/delete) + 204 handling + error-envelope helper
- Routes for /maps, /maps/new, /maps/:id/edit (editor itself lands in SP5 part 2)

Spec: docs/superpowers/specs/2026-07-03-map-editor-ui-design.md

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
gh pr checks --watch
```

Expected: CI green. **Ask Martin to review/merge** (squash + delete branch). PR 2 starts only after this merges.

---

# PR 2 — Editor core (branch `sp5-editor-core`)

Start: `git checkout main && git pull && git checkout -b sp5-editor-core`

### Task 6: Engine client exports + editor document module

**Files:**
- Modify: `packages/engine/src/client.ts`
- Create: `packages/web/src/editor/doc.ts`
- Test: `packages/web/test/editor/doc.test.ts`

**Interfaces:**
- Produces (engine client — additive re-exports only, no logic changes):
  - `validateHexMap(source: HexMapSource): void` (throws with a message)
  - `axialKey`, `axialToPixel`, `pixelToAxial`, `neighbors`, `NEIGHBOR_DIRS`
  - types `Axial`, `HexLayout`, `Pixel`, `HexTileSource`
  - `riversRuleset` (for `bonusSet.length`)
- Produces (doc module):
  - `EDITOR_LAYOUT: HexLayout` = `{ size: 114, originX: 0, originY: 0 }`
  - `interface EditorDoc { id: string | null; name: string; layout: HexLayout; tiles: HexTileSource[]; startingDeployment: Record<string, StartingUnits>; bonusSlots: string[]; nextTileNumber: number }`
  - `emptyDoc(): EditorDoc`
  - `docFromSource(source: HexMapSource, options: { asCopy: boolean }): EditorDoc`
  - `docToSource(doc: EditorDoc, id?: string): HexMapSource` (id precedence: arg → doc.id → `"editor-draft"`)

- [ ] **Step 1: Engine client exports**

Append to `packages/engine/src/client.ts` (in the "Static map data and geometry" section):

```ts
export { validateHexMap } from "./maps/hex/validate.js";
export {
  axialKey,
  axialToPixel,
  neighbors,
  NEIGHBOR_DIRS,
  pixelToAxial
} from "./maps/hex/coords.js";
export type { Axial, HexLayout, Pixel } from "./maps/hex/coords.js";
export type { HexTileSource } from "./maps/hex/source.js";
export { riversRuleset } from "./rules.js";
```

All of these are static geometry/validation/ruleset data — safe for the client surface (no `GameState`, RNG, or deck order). Rebuild so the web sees the new dist:

Run: `corepack pnpm --filter @sengoku-jidai/engine build`
Expected: clean build.

- [ ] **Step 2: Write the failing doc tests**

Create `packages/web/test/editor/doc.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { riversSource } from "@sengoku-jidai/engine/client";
import { docFromSource, docToSource, emptyDoc } from "../../src/editor/doc.js";

describe("editor doc", () => {
  it("starts empty with tile numbering at 1", () => {
    const doc = emptyDoc();
    expect(doc.id).toBeNull();
    expect(doc.tiles).toEqual([]);
    expect(doc.nextTileNumber).toBe(1);
  });

  it("round-trips a source", () => {
    const doc = docFromSource(riversSource, { asCopy: false });
    const source = docToSource(doc);
    expect(source.id).toBe(riversSource.id);
    expect(source.tiles).toEqual(riversSource.tiles);
    expect(source.startingDeployment).toEqual(riversSource.startingDeployment);
    expect(source.bonusSlots).toEqual(riversSource.bonusSlots);
  });

  it("loads as copy with a null id and (copy) name", () => {
    const doc = docFromSource(riversSource, { asCopy: true });
    expect(doc.id).toBeNull();
    expect(doc.name).toBe(`${riversSource.name} (copy)`);
    expect(docToSource(doc).id).toBe("editor-draft");
    expect(docToSource(doc, "srv").id).toBe("srv");
  });

  it("continues generated ids past existing t<N> ids", () => {
    const doc = docFromSource(
      {
        ...riversSource,
        tiles: [
          { id: "t7", kind: "land", hexes: [{ q: 0, r: 0 }], features: {} },
          { id: "other", kind: "sea", hexes: [{ q: 1, r: 0 }], features: {} }
        ],
        startingDeployment: {},
        bonusSlots: []
      },
      { asCopy: false }
    );
    expect(doc.nextTileNumber).toBe(8);
  });
});
```

Run: `corepack pnpm --filter @sengoku-jidai/web exec vitest run test/editor/doc.test.ts`
Expected: FAIL — module missing.

- [ ] **Step 3: Implement `doc.ts`**

Create `packages/web/src/editor/doc.ts`:

```ts
import type {
  HexLayout,
  HexMapSource,
  HexTileSource,
  StartingUnits
} from "@sengoku-jidai/engine/client";

/** Native board.svg scale: preview and play render 1:1 with Rivers art. */
export const EDITOR_LAYOUT: HexLayout = { size: 114, originX: 0, originY: 0 };

/** The editor's working document: a HexMapSource that may not be saved yet. */
export interface EditorDoc {
  id: string | null;
  name: string;
  layout: HexLayout;
  tiles: HexTileSource[];
  startingDeployment: Record<string, StartingUnits>;
  bonusSlots: string[];
  /** Monotonic counter behind generated tile ids (t1, t2, …). */
  nextTileNumber: number;
}

export function emptyDoc(): EditorDoc {
  return {
    id: null,
    name: "",
    layout: EDITOR_LAYOUT,
    tiles: [],
    startingDeployment: {},
    bonusSlots: [],
    nextTileNumber: 1
  };
}

export function docFromSource(source: HexMapSource, options: { asCopy: boolean }): EditorDoc {
  let max = 0;
  for (const tile of source.tiles) {
    const match = /^t(\d+)$/.exec(tile.id);
    if (match) {
      max = Math.max(max, Number(match[1]));
    }
  }
  return {
    id: options.asCopy ? null : source.id,
    name: options.asCopy ? `${source.name} (copy)` : source.name,
    layout: source.layout,
    tiles: source.tiles,
    startingDeployment: source.startingDeployment,
    bonusSlots: source.bonusSlots,
    nextTileNumber: max + 1
  };
}

export function docToSource(doc: EditorDoc, id?: string): HexMapSource {
  return {
    id: id ?? doc.id ?? "editor-draft",
    name: doc.name,
    layout: doc.layout,
    tiles: doc.tiles,
    startingDeployment: doc.startingDeployment,
    bonusSlots: doc.bonusSlots
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `corepack pnpm --filter @sengoku-jidai/web exec vitest run test/editor/doc.test.ts`
Expected: PASS. Also `corepack pnpm --filter @sengoku-jidai/engine test` — engine untouched logically, stays green.

- [ ] **Step 5: Commit**

```bash
git add packages/engine/src/client.ts packages/web/src/editor/doc.ts packages/web/test/editor/doc.test.ts
git commit -m "feat(web): editor document model + engine client geometry exports

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 7: Reducer — painting and erasing

**Files:**
- Create: `packages/web/src/editor/reducer.ts`
- Test: `packages/web/test/editor/reducer-paint.test.ts`

**Interfaces:**
- Produces (later tasks extend this same file):
  - `type Tool = "select" | "land" | "sea" | "erase"`
  - `interface EditorState { doc: EditorDoc; tool: Tool; selection: string[]; portArming: boolean; past: EditorDoc[]; future: EditorDoc[] }`
  - `initialEditorState(doc: EditorDoc): EditorState`
  - `editorReducer(state: EditorState, action: EditorAction): EditorState`
  - `tileAt(doc: EditorDoc, hex: Axial): HexTileSource | undefined`
  - `connectedComponents(hexes: Axial[]): Axial[][]`
  - Actions this task: `{ type: "setTool"; tool }`, `{ type: "paintHex"; kind: "land" | "sea"; hex }`, `{ type: "eraseHex"; hex }`, `{ type: "loadDoc"; doc }`, `{ type: "undo" }`, `{ type: "redo" }` (undo/redo minimally wired here; more actions in Tasks 8–9).

- [ ] **Step 1: Write the failing tests**

Create `packages/web/test/editor/reducer-paint.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { emptyDoc } from "../../src/editor/doc.js";
import {
  editorReducer,
  initialEditorState,
  tileAt,
  type EditorAction,
  type EditorState
} from "../../src/editor/reducer.js";

function run(actions: EditorAction[], from?: EditorState): EditorState {
  return actions.reduce(editorReducer, from ?? initialEditorState(emptyDoc()));
}

describe("painting", () => {
  it("paints a hex as its own new tile with generated ids", () => {
    const state = run([
      { type: "paintHex", kind: "land", hex: { q: 0, r: 0 } },
      { type: "paintHex", kind: "sea", hex: { q: 1, r: 0 } }
    ]);
    expect(state.doc.tiles).toHaveLength(2);
    expect(state.doc.tiles[0]).toEqual({
      id: "t1",
      kind: "land",
      hexes: [{ q: 0, r: 0 }],
      features: {}
    });
    expect(state.doc.tiles[1]!.id).toBe("t2");
    expect(state.doc.tiles[1]!.kind).toBe("sea");
  });

  it("is a no-op when painting the same kind over a hex", () => {
    const one = run([{ type: "paintHex", kind: "land", hex: { q: 0, r: 0 } }]);
    const two = editorReducer(one, { type: "paintHex", kind: "land", hex: { q: 0, r: 0 } });
    expect(two).toBe(one);
  });

  it("re-kinds a hex into a fresh tile and drops the old tile's references", () => {
    let state = run([{ type: "paintHex", kind: "sea", hex: { q: 0, r: 0 } }]);
    // reference the sea tile from a fake harbor's ports and bonusSlots/deployment
    state = {
      ...state,
      doc: {
        ...state.doc,
        tiles: [
          ...state.doc.tiles,
          {
            id: "t9",
            kind: "land",
            hexes: [{ q: 5, r: 5 }],
            features: { harbor: true },
            ports: ["t1"]
          }
        ],
        startingDeployment: { t1: { seat: "red", ship: 1 } },
        bonusSlots: ["t1"]
      }
    };
    const next = editorReducer(state, { type: "paintHex", kind: "land", hex: { q: 0, r: 0 } });
    const ids = next.doc.tiles.map((t) => t.id);
    expect(ids).not.toContain("t1");
    expect(tileAt(next.doc, { q: 0, r: 0 })!.kind).toBe("land");
    expect(next.doc.tiles.find((t) => t.id === "t9")!.ports).toBeUndefined();
    expect(next.doc.startingDeployment).toEqual({});
    expect(next.doc.bonusSlots).toEqual([]);
  });

  it("erase splits a disconnected remainder; the largest piece keeps id and features", () => {
    // Build a 3-in-a-row land tile by hand (merge arrives in Task 8).
    const base = initialEditorState({
      ...emptyDoc(),
      tiles: [
        {
          id: "t1",
          kind: "land",
          hexes: [
            { q: 0, r: 0 },
            { q: 1, r: 0 },
            { q: 2, r: 0 },
            { q: 3, r: 0 }
          ],
          features: { valueStars: 1 }
        }
      ],
      nextTileNumber: 2
    });
    const next = editorReducer(base, { type: "eraseHex", hex: { q: 2, r: 0 } });
    expect(next.doc.tiles).toHaveLength(2);
    const survivor = next.doc.tiles.find((t) => t.id === "t1")!;
    expect(survivor.hexes).toEqual([
      { q: 0, r: 0 },
      { q: 1, r: 0 }
    ]);
    expect(survivor.features).toEqual({ valueStars: 1 });
    const split = next.doc.tiles.find((t) => t.id === "t2")!;
    expect(split.hexes).toEqual([{ q: 3, r: 0 }]);
    expect(split.features).toEqual({});
  });

  it("undo/redo round-trips the doc", () => {
    const one = run([{ type: "paintHex", kind: "land", hex: { q: 0, r: 0 } }]);
    const undone = editorReducer(one, { type: "undo" });
    expect(undone.doc.tiles).toHaveLength(0);
    const redone = editorReducer(undone, { type: "redo" });
    expect(redone.doc).toEqual(one.doc);
  });

  it("prunes selection when undo removes the selected tile", () => {
    let state = run([{ type: "paintHex", kind: "land", hex: { q: 0, r: 0 } }]);
    state = editorReducer(state, { type: "selectTile", tileId: "t1" });
    expect(state.selection).toEqual(["t1"]);
    const undone = editorReducer(state, { type: "undo" });
    expect(undone.selection).toEqual([]);
  });
});
```

(The last test also exercises the minimal `selectTile` case; Task 8 expands it.)

Run: `corepack pnpm --filter @sengoku-jidai/web exec vitest run test/editor/reducer-paint.test.ts`
Expected: FAIL — module missing.

- [ ] **Step 2: Implement**

Create `packages/web/src/editor/reducer.ts`:

```ts
import type { Axial, HexTileSource, SeatId, StartingUnits } from "@sengoku-jidai/engine/client";
import { axialKey, axialToPixel, neighbors } from "@sengoku-jidai/engine/client";
import type { EditorDoc } from "./doc.js";

export type Tool = "select" | "land" | "sea" | "erase";

export interface EditorState {
  doc: EditorDoc;
  tool: Tool;
  /** Selected tile ids; [0] is the primary (inspector subject, merge survivor). */
  selection: string[];
  /** True while "Add port" waits for a sea-tile click (applies to selection[0]). */
  portArming: boolean;
  past: EditorDoc[];
  future: EditorDoc[];
}

export type FeaturePatch = {
  hq?: SeatId | null;
  valueStars?: 0 | 1 | 2;
  harbor?: boolean;
  shellable?: boolean;
};

export type EditorAction =
  | { type: "setTool"; tool: Tool }
  | { type: "paintHex"; kind: "land" | "sea"; hex: Axial }
  | { type: "eraseHex"; hex: Axial }
  | { type: "selectTile"; tileId: string | null; additive?: boolean }
  | { type: "mergeSelection" }
  | { type: "unmergeTile"; tileId: string }
  | { type: "setFeature"; tileId: string; patch: FeaturePatch }
  | { type: "armPort"; arming: boolean }
  | { type: "removePort"; harborId: string; seaId: string }
  | { type: "setDeployment"; tileId: string; units: StartingUnits | null }
  | { type: "toggleBonusSlot"; tileId: string }
  | { type: "setName"; name: string }
  | { type: "undo" }
  | { type: "redo" }
  | { type: "loadDoc"; doc: EditorDoc };

const HISTORY_LIMIT = 100;

export function initialEditorState(doc: EditorDoc): EditorState {
  return { doc, tool: "land", selection: [], portArming: false, past: [], future: [] };
}

export function tileAt(doc: EditorDoc, hex: Axial): HexTileSource | undefined {
  const key = axialKey(hex);
  return doc.tiles.find((t) => t.hexes.some((h) => axialKey(h) === key));
}

/** Edge-connected components, discovery order = first-hex order in the input. */
export function connectedComponents(hexes: Axial[]): Axial[][] {
  const remaining = new Map(hexes.map((h) => [axialKey(h), h] as const));
  const components: Axial[][] = [];
  for (const hex of hexes) {
    const key = axialKey(hex);
    if (!remaining.has(key)) {
      continue;
    }
    remaining.delete(key);
    const component: Axial[] = [];
    const stack = [hex];
    while (stack.length > 0) {
      const current = stack.pop()!;
      component.push(current);
      for (const n of neighbors(current)) {
        const nKey = axialKey(n);
        const found = remaining.get(nKey);
        if (found) {
          remaining.delete(nKey);
          stack.push(found);
        }
      }
    }
    components.push(component);
  }
  return components;
}

/** Drop tiles and scrub every reference to them (ports, deployment, bonus slots). */
function dropTiles(doc: EditorDoc, ids: string[]): EditorDoc {
  const removed = new Set(ids);
  const tiles = doc.tiles
    .filter((t) => !removed.has(t.id))
    .map((t) => {
      if (!t.ports || !t.ports.some((p) => removed.has(p))) {
        return t;
      }
      const ports = t.ports.filter((p) => !removed.has(p));
      const next: HexTileSource = { ...t };
      if (ports.length > 0) {
        next.ports = ports;
      } else {
        delete next.ports;
      }
      return next;
    });
  const startingDeployment = Object.fromEntries(
    Object.entries(doc.startingDeployment).filter(([id]) => !removed.has(id))
  );
  const bonusSlots = doc.bonusSlots.filter((id) => !removed.has(id));
  return { ...doc, tiles, startingDeployment, bonusSlots };
}

/** Remove one hex from a tile: delete a 1-hex tile, else split the remainder into
 *  connected components — the largest (ties: discovery order) keeps id/features/ports. */
function removeHex(doc: EditorDoc, tileId: string, hex: Axial): EditorDoc {
  const tile = doc.tiles.find((t) => t.id === tileId)!;
  if (tile.hexes.length === 1) {
    return dropTiles(doc, [tileId]);
  }
  const key = axialKey(hex);
  const remaining = tile.hexes.filter((h) => axialKey(h) !== key);
  const components = connectedComponents(remaining).sort((a, b) => b.length - a.length);
  const [surviving, ...rest] = components;
  let nextNumber = doc.nextTileNumber;
  const fresh: HexTileSource[] = rest.map((hexes) => ({
    id: `t${nextNumber++}`,
    kind: tile.kind,
    hexes,
    features: {}
  }));
  const tiles = doc.tiles
    .map((t) => (t.id === tileId ? { ...t, hexes: surviving! } : t))
    .concat(fresh);
  return { ...doc, tiles, nextTileNumber: nextNumber };
}

function paintHex(doc: EditorDoc, kind: "land" | "sea", hex: Axial): EditorDoc {
  const owner = tileAt(doc, hex);
  if (owner && owner.kind === kind) {
    return doc;
  }
  const cleared = owner ? removeHex(doc, owner.id, hex) : doc;
  const tile: HexTileSource = {
    id: `t${cleared.nextTileNumber}`,
    kind,
    hexes: [hex],
    features: {}
  };
  return { ...cleared, tiles: [...cleared.tiles, tile], nextTileNumber: cleared.nextTileNumber + 1 };
}

function eraseHex(doc: EditorDoc, hex: Axial): EditorDoc {
  const owner = tileAt(doc, hex);
  return owner ? removeHex(doc, owner.id, hex) : doc;
}

/** Keep selection/portArming meaningful after any doc change. */
function normalize(state: EditorState): EditorState {
  const ids = new Set(state.doc.tiles.map((t) => t.id));
  const selection = state.selection.filter((id) => ids.has(id));
  const primary = state.doc.tiles.find((t) => t.id === selection[0]);
  const portArming = state.portArming && primary?.features.harbor === true;
  if (selection.length === state.selection.length && portArming === state.portArming) {
    return state;
  }
  return { ...state, selection, portArming };
}

/** Record history and swap in a new doc (no-op when the doc is unchanged). */
function withDoc(state: EditorState, doc: EditorDoc, extra?: Partial<EditorState>): EditorState {
  if (doc === state.doc) {
    return extra ? normalize({ ...state, ...extra }) : state;
  }
  return normalize({
    ...state,
    ...extra,
    doc,
    past: [...state.past, state.doc].slice(-HISTORY_LIMIT),
    future: []
  });
}

export function editorReducer(state: EditorState, action: EditorAction): EditorState {
  switch (action.type) {
    case "setTool":
      return { ...state, tool: action.tool, portArming: false };
    case "loadDoc":
      return initialEditorState(action.doc);
    case "paintHex":
      return withDoc(state, paintHex(state.doc, action.kind, action.hex));
    case "eraseHex":
      return withDoc(state, eraseHex(state.doc, action.hex));
    case "selectTile": {
      if (action.tileId === null) {
        return { ...state, selection: [], portArming: false };
      }
      const selection = action.additive
        ? state.selection.includes(action.tileId)
          ? state.selection.filter((id) => id !== action.tileId)
          : [...state.selection, action.tileId]
        : [action.tileId];
      return normalize({ ...state, selection });
    }
    case "undo": {
      const previous = state.past[state.past.length - 1];
      if (!previous) {
        return state;
      }
      return normalize({
        ...state,
        doc: previous,
        past: state.past.slice(0, -1),
        future: [state.doc, ...state.future]
      });
    }
    case "redo": {
      const [next, ...future] = state.future;
      if (!next) {
        return state;
      }
      return normalize({ ...state, doc: next, past: [...state.past, state.doc], future });
    }
    default:
      // Remaining actions land in Tasks 8–9.
      return state;
  }
}
```

Note: `axialToPixel`, `SeatId`, `StartingUnits`, and the `armPort`/`removePort`/etc. action variants are used by Tasks 8–9; the compiler will flag them as unused until then — that's fine (or prefix with `void` usage; do NOT delete them).
If `noUnusedLocals` fails the build at this intermediate step, temporarily reference them: `void axialToPixel;` at module bottom, removed in Task 8.

- [ ] **Step 3: Run tests to verify they pass**

Run: `corepack pnpm --filter @sengoku-jidai/web exec vitest run test/editor/reducer-paint.test.ts`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add packages/web/src/editor/reducer.ts packages/web/test/editor/reducer-paint.test.ts
git commit -m "feat(web): editor reducer — paint, erase, split, undo/redo

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 8: Reducer — merge and unmerge

**Files:**
- Modify: `packages/web/src/editor/reducer.ts`
- Test: `packages/web/test/editor/reducer-merge.test.ts`

**Interfaces:**
- Produces: `canMergeSelection(doc: EditorDoc, selection: string[]): boolean` (exported; the inspector's Merge button disables on false); reducer handles `mergeSelection` and `unmergeTile`.

- [ ] **Step 1: Write the failing tests**

Create `packages/web/test/editor/reducer-merge.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { emptyDoc } from "../../src/editor/doc.js";
import {
  canMergeSelection,
  editorReducer,
  initialEditorState,
  type EditorState
} from "../../src/editor/reducer.js";

/** t1=(0,0) land, t2=(1,0) land, t3=(0,1) sea, t4=(3,3) land (far away). */
function fourTiles(): EditorState {
  return initialEditorState({
    ...emptyDoc(),
    tiles: [
      { id: "t1", kind: "land", hexes: [{ q: 0, r: 0 }], features: { valueStars: 1 } },
      { id: "t2", kind: "land", hexes: [{ q: 1, r: 0 }], features: {} },
      { id: "t3", kind: "sea", hexes: [{ q: 0, r: 1 }], features: {} },
      { id: "t4", kind: "land", hexes: [{ q: 3, r: 3 }], features: {} }
    ],
    startingDeployment: { t2: { seat: "black", troop: 2 } },
    bonusSlots: ["t2"],
    nextTileNumber: 5
  });
}

describe("merge", () => {
  it("guards: needs 2+, same kind, edge-connected union", () => {
    const { doc } = fourTiles();
    expect(canMergeSelection(doc, ["t1"])).toBe(false);
    expect(canMergeSelection(doc, ["t1", "t3"])).toBe(false); // kinds differ
    expect(canMergeSelection(doc, ["t1", "t4"])).toBe(false); // disconnected
    expect(canMergeSelection(doc, ["t1", "t2"])).toBe(true);
  });

  it("merges into the primary: id, features, remapped references", () => {
    let state = fourTiles();
    state = { ...state, selection: ["t1", "t2"] };
    const next = editorReducer(state, { type: "mergeSelection" });
    expect(next.doc.tiles.map((t) => t.id)).toEqual(["t1", "t3", "t4"]);
    const merged = next.doc.tiles[0]!;
    expect(merged.hexes).toEqual([
      { q: 0, r: 0 },
      { q: 1, r: 0 }
    ]);
    expect(merged.features).toEqual({ valueStars: 1 }); // survivor's features
    // absorbed t2's deployment moved (survivor had none); bonus slot remapped + deduped
    expect(next.doc.startingDeployment).toEqual({ t1: { seat: "black", troop: 2 } });
    expect(next.doc.bonusSlots).toEqual(["t1"]);
    expect(next.selection).toEqual(["t1"]);
  });

  it("remaps inbound ports from an absorbed sea tile", () => {
    let state = initialEditorState({
      ...emptyDoc(),
      tiles: [
        { id: "s1", kind: "sea", hexes: [{ q: 0, r: 0 }], features: {} },
        { id: "s2", kind: "sea", hexes: [{ q: 1, r: 0 }], features: {} },
        {
          id: "h1",
          kind: "land",
          hexes: [{ q: 0, r: 1 }],
          features: { harbor: true },
          ports: ["s1", "s2"]
        }
      ],
      nextTileNumber: 1
    });
    state = { ...state, selection: ["s1", "s2"] };
    const next = editorReducer(state, { type: "mergeSelection" });
    expect(next.doc.tiles.find((t) => t.id === "h1")!.ports).toEqual(["s1"]);
  });

  it("unmerge explodes back to single-hex tiles; centroid hex keeps the identity", () => {
    let state = fourTiles();
    state = { ...state, selection: ["t1", "t2"] };
    state = editorReducer(state, { type: "mergeSelection" });
    const next = editorReducer(state, { type: "unmergeTile", tileId: "t1" });
    expect(next.doc.tiles).toHaveLength(4);
    const keeper = next.doc.tiles.find((t) => t.id === "t1")!;
    expect(keeper.hexes).toHaveLength(1);
    expect(keeper.features).toEqual({ valueStars: 1 });
    const fresh = next.doc.tiles.filter((t) => /^t[56]$/.test(t.id));
    expect(fresh).toHaveLength(1);
    expect(fresh[0]!.features).toEqual({});
  });
});
```

Run: `corepack pnpm --filter @sengoku-jidai/web exec vitest run test/editor/reducer-merge.test.ts`
Expected: FAIL — `canMergeSelection` missing, merge action falls through.

- [ ] **Step 2: Implement**

Add to `packages/web/src/editor/reducer.ts` (and remove any temporary `void` references from Task 7):

```ts
export function canMergeSelection(doc: EditorDoc, selection: string[]): boolean {
  if (selection.length < 2) {
    return false;
  }
  const tiles = selection.map((id) => doc.tiles.find((t) => t.id === id));
  if (tiles.some((t) => t === undefined)) {
    return false;
  }
  const kind = tiles[0]!.kind;
  if (tiles.some((t) => t!.kind !== kind)) {
    return false;
  }
  const union = tiles.flatMap((t) => t!.hexes);
  return connectedComponents(union).length === 1;
}

function dedupe(ids: string[]): string[] {
  return [...new Set(ids)];
}

function mergeSelection(doc: EditorDoc, selection: string[]): EditorDoc {
  if (!canMergeSelection(doc, selection)) {
    return doc;
  }
  const [survivorId, ...absorbedIds] = selection;
  const absorbed = new Set(absorbedIds);
  const mergedHexes = selection.flatMap((id) => doc.tiles.find((t) => t.id === id)!.hexes);

  const startingDeployment = { ...doc.startingDeployment };
  if (!startingDeployment[survivorId!]) {
    const donor = absorbedIds.find((id) => startingDeployment[id]);
    if (donor) {
      startingDeployment[survivorId!] = startingDeployment[donor]!;
    }
  }
  for (const id of absorbedIds) {
    delete startingDeployment[id];
  }

  const bonusSlots = dedupe(doc.bonusSlots.map((id) => (absorbed.has(id) ? survivorId! : id)));

  const tiles = doc.tiles
    .filter((t) => !absorbed.has(t.id))
    .map((t) => {
      const base = t.id === survivorId ? { ...t, hexes: mergedHexes } : t;
      if (!base.ports || !base.ports.some((p) => absorbed.has(p))) {
        return base;
      }
      return { ...base, ports: dedupe(base.ports.map((p) => (absorbed.has(p) ? survivorId! : p))) };
    });

  return { ...doc, tiles, startingDeployment, bonusSlots };
}

function unmergeTile(doc: EditorDoc, tileId: string): EditorDoc {
  const tile = doc.tiles.find((t) => t.id === tileId);
  if (!tile || tile.hexes.length < 2) {
    return doc;
  }
  const centers = tile.hexes.map((h) => axialToPixel(h, doc.layout));
  const centroid = {
    x: centers.reduce((sum, p) => sum + p.x, 0) / centers.length,
    y: centers.reduce((sum, p) => sum + p.y, 0) / centers.length
  };
  let keeperIndex = 0;
  let best = Infinity;
  centers.forEach((p, i) => {
    const d = (p.x - centroid.x) ** 2 + (p.y - centroid.y) ** 2;
    if (d < best) {
      best = d;
      keeperIndex = i;
    }
  });
  let nextNumber = doc.nextTileNumber;
  const fresh: HexTileSource[] = tile.hexes
    .filter((_, i) => i !== keeperIndex)
    .map((hex) => ({ id: `t${nextNumber++}`, kind: tile.kind, hexes: [hex], features: {} }));
  const tiles = doc.tiles
    .map((t) => (t.id === tileId ? { ...t, hexes: [tile.hexes[keeperIndex]!] } : t))
    .concat(fresh);
  return { ...doc, tiles, nextTileNumber: nextNumber };
}
```

And in `editorReducer`'s switch, replace the `default` fall-through for these two:

```ts
    case "mergeSelection":
      return withDoc(state, mergeSelection(state.doc, state.selection), {
        selection: state.selection.slice(0, 1)
      });
    case "unmergeTile":
      return withDoc(state, unmergeTile(state.doc, action.tileId));
```

- [ ] **Step 3: Run tests to verify they pass**

Run: `corepack pnpm --filter @sengoku-jidai/web exec vitest run test/editor/reducer-merge.test.ts test/editor/reducer-paint.test.ts`
Expected: PASS (both files).

- [ ] **Step 4: Commit**

```bash
git add packages/web/src/editor/reducer.ts packages/web/test/editor/reducer-merge.test.ts
git commit -m "feat(web): editor reducer — merge and unmerge with reference remapping

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 9: Reducer — features, ports, deployment, bonus, name

**Files:**
- Modify: `packages/web/src/editor/reducer.ts`
- Test: `packages/web/test/editor/reducer-attrs.test.ts`

**Interfaces:**
- Produces: reducer handles `setFeature` (with HQ one-per-seat steal, harbor-off drops ports), `armPort`, `selectTile`-while-armed (adds the port), `removePort`, `setDeployment` (null deletes; zero counts normalize away), `toggleBonusSlot`, `setName`.

- [ ] **Step 1: Write the failing tests**

Create `packages/web/test/editor/reducer-attrs.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { emptyDoc } from "../../src/editor/doc.js";
import { editorReducer, initialEditorState, type EditorState } from "../../src/editor/reducer.js";

function board(): EditorState {
  return initialEditorState({
    ...emptyDoc(),
    tiles: [
      { id: "t1", kind: "land", hexes: [{ q: 0, r: 0 }], features: {} },
      { id: "t2", kind: "land", hexes: [{ q: 1, r: 0 }], features: {} },
      { id: "s1", kind: "sea", hexes: [{ q: 0, r: 1 }], features: {} }
    ],
    nextTileNumber: 3
  });
}

describe("tile attributes", () => {
  it("assigning an HQ seat steals it from the previous holder", () => {
    let state = board();
    state = editorReducer(state, { type: "setFeature", tileId: "t1", patch: { hq: "red" } });
    state = editorReducer(state, { type: "setFeature", tileId: "t2", patch: { hq: "red" } });
    expect(state.doc.tiles.find((t) => t.id === "t1")!.features.hq).toBeUndefined();
    expect(state.doc.tiles.find((t) => t.id === "t2")!.features.hq).toBe("red");
    state = editorReducer(state, { type: "setFeature", tileId: "t2", patch: { hq: null } });
    expect(state.doc.tiles.find((t) => t.id === "t2")!.features.hq).toBeUndefined();
  });

  it("keeps features normalized: false/0 disappear, harbor off drops ports", () => {
    let state = board();
    state = editorReducer(state, { type: "setFeature", tileId: "t1", patch: { harbor: true } });
    state = editorReducer(state, { type: "selectTile", tileId: "t1" });
    state = editorReducer(state, { type: "armPort", arming: true });
    state = editorReducer(state, { type: "selectTile", tileId: "s1" });
    expect(state.doc.tiles.find((t) => t.id === "t1")!.ports).toEqual(["s1"]);
    expect(state.portArming).toBe(false);
    expect(state.selection).toEqual(["t1"]); // armed click keeps the harbor selected

    state = editorReducer(state, {
      type: "setFeature",
      tileId: "t1",
      patch: { valueStars: 2, shellable: true }
    });
    state = editorReducer(state, {
      type: "setFeature",
      tileId: "t1",
      patch: { valueStars: 0, shellable: false, harbor: false }
    });
    const t1 = state.doc.tiles.find((t) => t.id === "t1")!;
    expect(t1.features).toEqual({});
    expect(t1.ports).toBeUndefined();
  });

  it("armed port click on a non-sea tile just disarms", () => {
    let state = board();
    state = editorReducer(state, { type: "setFeature", tileId: "t1", patch: { harbor: true } });
    state = editorReducer(state, { type: "selectTile", tileId: "t1" });
    state = editorReducer(state, { type: "armPort", arming: true });
    state = editorReducer(state, { type: "selectTile", tileId: "t2" });
    expect(state.portArming).toBe(false);
    expect(state.doc.tiles.find((t) => t.id === "t1")!.ports).toBeUndefined();
  });

  it("removePort deletes the key when the list empties", () => {
    let state = board();
    state = editorReducer(state, { type: "setFeature", tileId: "t1", patch: { harbor: true } });
    state = editorReducer(state, { type: "selectTile", tileId: "t1" });
    state = editorReducer(state, { type: "armPort", arming: true });
    state = editorReducer(state, { type: "selectTile", tileId: "s1" });
    state = editorReducer(state, { type: "removePort", harborId: "t1", seaId: "s1" });
    expect(state.doc.tiles.find((t) => t.id === "t1")!.ports).toBeUndefined();
  });

  it("deployment sets, normalizes zeros away, and clears", () => {
    let state = board();
    state = editorReducer(state, {
      type: "setDeployment",
      tileId: "t1",
      units: { seat: "red", troop: 3, ship: 0 }
    });
    expect(state.doc.startingDeployment).toEqual({ t1: { seat: "red", troop: 3 } });
    state = editorReducer(state, {
      type: "setDeployment",
      tileId: "t1",
      units: { seat: "red", troop: 0 }
    });
    expect(state.doc.startingDeployment).toEqual({});
    state = editorReducer(state, { type: "setDeployment", tileId: "t1", units: null });
    expect(state.doc.startingDeployment).toEqual({});
  });

  it("bonus slots toggle and name updates", () => {
    let state = board();
    state = editorReducer(state, { type: "toggleBonusSlot", tileId: "t1" });
    expect(state.doc.bonusSlots).toEqual(["t1"]);
    state = editorReducer(state, { type: "toggleBonusSlot", tileId: "t1" });
    expect(state.doc.bonusSlots).toEqual([]);
    state = editorReducer(state, { type: "setName", name: "My Map" });
    expect(state.doc.name).toBe("My Map");
  });
});
```

Run: `corepack pnpm --filter @sengoku-jidai/web exec vitest run test/editor/reducer-attrs.test.ts`
Expected: FAIL.

- [ ] **Step 2: Implement**

Add to `packages/web/src/editor/reducer.ts`:

```ts
function setFeature(doc: EditorDoc, tileId: string, patch: FeaturePatch): EditorDoc {
  const tiles = doc.tiles.map((t) => {
    if (t.id !== tileId) {
      if (patch.hq && t.features.hq === patch.hq) {
        const { hq: _stolen, ...rest } = t.features;
        return { ...t, features: rest };
      }
      return t;
    }
    const features = { ...t.features };
    if ("hq" in patch) {
      if (patch.hq) {
        features.hq = patch.hq;
      } else {
        delete features.hq;
      }
    }
    if (patch.valueStars !== undefined) {
      if (patch.valueStars > 0) {
        features.valueStars = patch.valueStars;
      } else {
        delete features.valueStars;
      }
    }
    if (patch.harbor !== undefined) {
      if (patch.harbor) {
        features.harbor = true;
      } else {
        delete features.harbor;
      }
    }
    if (patch.shellable !== undefined) {
      if (patch.shellable) {
        features.shellable = true;
      } else {
        delete features.shellable;
      }
    }
    const next: HexTileSource = { ...t, features };
    if (patch.harbor === false) {
      delete next.ports;
    }
    return next;
  });
  return { ...doc, tiles };
}

function addPort(doc: EditorDoc, harborId: string, seaId: string): EditorDoc {
  const harbor = doc.tiles.find((t) => t.id === harborId);
  const target = doc.tiles.find((t) => t.id === seaId);
  if (!harbor?.features.harbor || target?.kind !== "sea" || harbor.ports?.includes(seaId)) {
    return doc;
  }
  const tiles = doc.tiles.map((t) =>
    t.id === harborId ? { ...t, ports: [...(t.ports ?? []), seaId] } : t
  );
  return { ...doc, tiles };
}

function removePort(doc: EditorDoc, harborId: string, seaId: string): EditorDoc {
  const tiles = doc.tiles.map((t) => {
    if (t.id !== harborId || !t.ports) {
      return t;
    }
    const ports = t.ports.filter((p) => p !== seaId);
    const next: HexTileSource = { ...t };
    if (ports.length > 0) {
      next.ports = ports;
    } else {
      delete next.ports;
    }
    return next;
  });
  return { ...doc, tiles };
}

function setDeployment(doc: EditorDoc, tileId: string, units: StartingUnits | null): EditorDoc {
  const startingDeployment = { ...doc.startingDeployment };
  const normalized = units
    ? {
        seat: units.seat,
        ...(units.troop && units.troop > 0 ? { troop: units.troop } : {}),
        ...(units.ship && units.ship > 0 ? { ship: units.ship } : {})
      }
    : null;
  if (!normalized || (normalized.troop === undefined && normalized.ship === undefined)) {
    delete startingDeployment[tileId];
  } else {
    startingDeployment[tileId] = normalized;
  }
  return { ...doc, startingDeployment };
}
```

In `editorReducer`, extend the `selectTile` case to consume an armed port click, and add the new cases (the `default` branch then only serves exhaustiveness — replace it with `return state` on a `never`-checked action if preferred):

```ts
    case "selectTile": {
      if (action.tileId === null) {
        return { ...state, selection: [], portArming: false };
      }
      if (state.portArming && state.selection[0]) {
        const target = state.doc.tiles.find((t) => t.id === action.tileId);
        if (target?.kind === "sea") {
          return withDoc(state, addPort(state.doc, state.selection[0], action.tileId), {
            portArming: false
          });
        }
        return { ...state, portArming: false };
      }
      const selection = action.additive
        ? state.selection.includes(action.tileId)
          ? state.selection.filter((id) => id !== action.tileId)
          : [...state.selection, action.tileId]
        : [action.tileId];
      return normalize({ ...state, selection });
    }
    case "armPort":
      return { ...state, portArming: action.arming };
    case "removePort":
      return withDoc(state, removePort(state.doc, action.harborId, action.seaId));
    case "setFeature":
      return withDoc(state, setFeature(state.doc, action.tileId, action.patch));
    case "setDeployment":
      return withDoc(state, setDeployment(state.doc, action.tileId, action.units));
    case "toggleBonusSlot": {
      const bonusSlots = state.doc.bonusSlots.includes(action.tileId)
        ? state.doc.bonusSlots.filter((id) => id !== action.tileId)
        : [...state.doc.bonusSlots, action.tileId];
      return withDoc(state, { ...state.doc, bonusSlots });
    }
    case "setName":
      return withDoc(state, { ...state.doc, name: action.name });
```

- [ ] **Step 3: Run all reducer tests**

Run: `corepack pnpm --filter @sengoku-jidai/web exec vitest run test/editor/`
Expected: PASS across all three reducer files + doc test.

- [ ] **Step 4: Commit**

```bash
git add packages/web/src/editor/reducer.ts packages/web/test/editor/reducer-attrs.test.ts
git commit -m "feat(web): editor reducer — features, ports, deployment, bonus slots

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 10: Canvas geometry helpers

**Files:**
- Create: `packages/web/src/editor/geometry.ts`
- Test: `packages/web/test/editor/geometry.test.ts`

**Interfaces:**
- Produces:
  - `hexCorner(center: Pixel, size: number, corner: number): Pixel` (flat-top; corner k at angle 60k°)
  - `hexPoints(center: Pixel, size: number): string` (SVG polygon `points`)
  - `EDGE_CORNERS: readonly (readonly [number, number])[]` — corner pair of the edge shared with `NEIGHBOR_DIRS[i]`, same index order: `[[0,1],[5,0],[4,5],[3,4],[2,3],[1,2]]`
  - `axialsInRect(rect: { x; y; width; height }, layout: HexLayout): Axial[]`
  - `tileCentroid(hexes: Axial[], layout: HexLayout): Pixel`
  - `tileBoundarySegments(tiles: HexTileSource[], layout: HexLayout): { x1; y1; x2; y2 }[]` (deduped: a shared boundary edge appears once)

- [ ] **Step 1: Write the failing tests**

Create `packages/web/test/editor/geometry.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { axialToPixel, NEIGHBOR_DIRS } from "@sengoku-jidai/engine/client";
import type { HexTileSource } from "@sengoku-jidai/engine/client";
import {
  axialsInRect,
  EDGE_CORNERS,
  hexCorner,
  tileBoundarySegments
} from "../../src/editor/geometry.js";

const LAYOUT = { size: 114, originX: 0, originY: 0 };

describe("geometry", () => {
  it("EDGE_CORNERS matches NEIGHBOR_DIRS: both sides of a shared edge agree", () => {
    const a = { q: 0, r: 0 };
    NEIGHBOR_DIRS.forEach((dir, i) => {
      const b = { q: a.q + dir.q, r: a.r + dir.r };
      const [c1, c2] = EDGE_CORNERS[i]!;
      const j = NEIGHBOR_DIRS.findIndex((d) => d.q === -dir.q && d.r === -dir.r);
      const [d1, d2] = EDGE_CORNERS[j]!;
      const edgeFromA = [
        hexCorner(axialToPixel(a, LAYOUT), LAYOUT.size, c1),
        hexCorner(axialToPixel(a, LAYOUT), LAYOUT.size, c2)
      ];
      const edgeFromB = [
        hexCorner(axialToPixel(b, LAYOUT), LAYOUT.size, d1),
        hexCorner(axialToPixel(b, LAYOUT), LAYOUT.size, d2)
      ];
      const key = (p: { x: number; y: number }) => `${p.x.toFixed(3)},${p.y.toFixed(3)}`;
      expect(new Set(edgeFromA.map(key))).toEqual(new Set(edgeFromB.map(key)));
    });
  });

  it("enumerates the axials covering a rect (origin hex included)", () => {
    const axials = axialsInRect({ x: -120, y: -120, width: 240, height: 240 }, LAYOUT);
    expect(axials).toContainEqual({ q: 0, r: 0 });
    expect(axials.length).toBeGreaterThan(4);
  });

  it("boundary segments: 6 for a lone hex, 11 for two adjacent tiles (shared edge once), 10 for one two-hex tile", () => {
    const lone: HexTileSource[] = [
      { id: "a", kind: "land", hexes: [{ q: 0, r: 0 }], features: {} }
    ];
    expect(tileBoundarySegments(lone, LAYOUT)).toHaveLength(6);

    const twoTiles: HexTileSource[] = [
      { id: "a", kind: "land", hexes: [{ q: 0, r: 0 }], features: {} },
      { id: "b", kind: "land", hexes: [{ q: 1, r: 0 }], features: {} }
    ];
    expect(tileBoundarySegments(twoTiles, LAYOUT)).toHaveLength(11);

    const oneTile: HexTileSource[] = [
      {
        id: "a",
        kind: "land",
        hexes: [
          { q: 0, r: 0 },
          { q: 1, r: 0 }
        ],
        features: {}
      }
    ];
    expect(tileBoundarySegments(oneTile, LAYOUT)).toHaveLength(10);
  });
});
```

Run: `corepack pnpm --filter @sengoku-jidai/web exec vitest run test/editor/geometry.test.ts`
Expected: FAIL.

- [ ] **Step 2: Implement**

Create `packages/web/src/editor/geometry.ts`:

```ts
import type { Axial, HexLayout, HexTileSource, Pixel } from "@sengoku-jidai/engine/client";
import { axialKey, axialToPixel, NEIGHBOR_DIRS } from "@sengoku-jidai/engine/client";

/** Flat-top hex corner k, at angle 60k° from the center (SVG y-down). */
export function hexCorner(center: Pixel, size: number, corner: number): Pixel {
  const angle = (Math.PI / 3) * corner;
  return { x: center.x + size * Math.cos(angle), y: center.y + size * Math.sin(angle) };
}

export function hexPoints(center: Pixel, size: number): string {
  return Array.from({ length: 6 }, (_, i) => hexCorner(center, size, i))
    .map((p) => `${p.x.toFixed(2)},${p.y.toFixed(2)}`)
    .join(" ");
}

/** Corner pair [a, b] of the edge shared with NEIGHBOR_DIRS[i] (same index order). */
export const EDGE_CORNERS: readonly (readonly [number, number])[] = [
  [0, 1],
  [5, 0],
  [4, 5],
  [3, 4],
  [2, 3],
  [1, 2]
];

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Axial coords whose hexes could intersect the rect (one hex of margin). */
export function axialsInRect(rect: Rect, layout: HexLayout): Axial[] {
  const result: Axial[] = [];
  const columnWidth = layout.size * 1.5;
  const rowHeight = layout.size * Math.sqrt(3);
  const qMin = Math.floor((rect.x - layout.originX) / columnWidth) - 1;
  const qMax = Math.ceil((rect.x + rect.width - layout.originX) / columnWidth) + 1;
  for (let q = qMin; q <= qMax; q++) {
    const rMin = Math.floor((rect.y - layout.originY) / rowHeight - q / 2) - 1;
    const rMax = Math.ceil((rect.y + rect.height - layout.originY) / rowHeight - q / 2) + 1;
    for (let r = rMin; r <= rMax; r++) {
      result.push({ q, r });
    }
  }
  return result;
}

export function tileCentroid(hexes: Axial[], layout: HexLayout): Pixel {
  const centers = hexes.map((h) => axialToPixel(h, layout));
  return {
    x: centers.reduce((sum, p) => sum + p.x, 0) / centers.length,
    y: centers.reduce((sum, p) => sum + p.y, 0) / centers.length
  };
}

export interface Segment {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

/** Edges where a hex's neighbor belongs to a different tile (or none). Deduped. */
export function tileBoundarySegments(tiles: HexTileSource[], layout: HexLayout): Segment[] {
  const owner = new Map<string, string>();
  for (const tile of tiles) {
    for (const hex of tile.hexes) {
      owner.set(axialKey(hex), tile.id);
    }
  }
  const segments: Segment[] = [];
  const seen = new Set<string>();
  for (const tile of tiles) {
    for (const hex of tile.hexes) {
      const center = axialToPixel(hex, layout);
      NEIGHBOR_DIRS.forEach((dir, i) => {
        const neighborOwner = owner.get(axialKey({ q: hex.q + dir.q, r: hex.r + dir.r }));
        if (neighborOwner === tile.id) {
          return;
        }
        const [a, b] = EDGE_CORNERS[i]!;
        const p1 = hexCorner(center, layout.size, a);
        const p2 = hexCorner(center, layout.size, b);
        const key = [p1, p2]
          .map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`)
          .sort()
          .join("|");
        if (seen.has(key)) {
          return;
        }
        seen.add(key);
        segments.push({ x1: p1.x, y1: p1.y, x2: p2.x, y2: p2.y });
      });
    }
  }
  return segments;
}
```

- [ ] **Step 3: Run tests to verify they pass**

Run: `corepack pnpm --filter @sengoku-jidai/web exec vitest run test/editor/geometry.test.ts`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add packages/web/src/editor/geometry.ts packages/web/test/editor/geometry.test.ts
git commit -m "feat(web): editor canvas geometry helpers

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 11: Validation and draft modules

**Files:**
- Create: `packages/web/src/editor/validation.ts`, `packages/web/src/editor/draft.ts`
- Test: `packages/web/test/editor/validation.test.ts`, `packages/web/test/editor/draft.test.ts`

**Interfaces:**
- Produces:
  - `validationMessage(doc: EditorDoc): string | null` (null = valid; else the engine's message)
  - `interface DraftStore { getItem(key: string): string | null; setItem(key: string, value: string): void; removeItem(key: string): void }`
  - `interface SavedDraft { doc: EditorDoc; savedAt: string }`
  - `saveDraft(doc: EditorDoc, store?: DraftStore): void` / `loadDraft(id: string | null, store?: DraftStore): SavedDraft | null` / `clearDraft(id: string | null, store?: DraftStore): void` — key `editor-draft:<id|new>`, store defaults to `window.localStorage`.

- [ ] **Step 1: Write the failing tests**

Create `packages/web/test/editor/validation.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { riversSource } from "@sengoku-jidai/engine/client";
import { docFromSource, emptyDoc } from "../../src/editor/doc.js";
import { validationMessage } from "../../src/editor/validation.js";

describe("validationMessage", () => {
  it("passes a known-good map", () => {
    expect(validationMessage(docFromSource(riversSource, { asCopy: true }))).toBeNull();
  });

  it("surfaces the engine's message for an empty map", () => {
    expect(validationMessage(emptyDoc())).toBe("map has no tiles");
  });
});
```

Create `packages/web/test/editor/draft.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { emptyDoc } from "../../src/editor/doc.js";
import { clearDraft, loadDraft, saveDraft, type DraftStore } from "../../src/editor/draft.js";

function fakeStore(): DraftStore & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => void data.set(k, v),
    removeItem: (k) => void data.delete(k)
  };
}

describe("drafts", () => {
  it("round-trips under the id key, 'new' for unsaved docs", () => {
    const store = fakeStore();
    const doc = { ...emptyDoc(), name: "WIP" };
    saveDraft(doc, store);
    expect(store.data.has("editor-draft:new")).toBe(true);
    const loaded = loadDraft(null, store);
    expect(loaded?.doc.name).toBe("WIP");
    expect(typeof loaded?.savedAt).toBe("string");
    clearDraft(null, store);
    expect(loadDraft(null, store)).toBeNull();
  });

  it("uses the map id as key once saved", () => {
    const store = fakeStore();
    saveDraft({ ...emptyDoc(), id: "abc" }, store);
    expect(loadDraft("abc", store)).not.toBeNull();
    expect(loadDraft(null, store)).toBeNull();
  });

  it("tolerates corrupt payloads", () => {
    const store = fakeStore();
    store.setItem("editor-draft:new", "{nope");
    expect(loadDraft(null, store)).toBeNull();
  });
});
```

Run: `corepack pnpm --filter @sengoku-jidai/web exec vitest run test/editor/validation.test.ts test/editor/draft.test.ts`
Expected: FAIL — modules missing.

- [ ] **Step 2: Implement**

Create `packages/web/src/editor/validation.ts`:

```ts
import { validateHexMap } from "@sengoku-jidai/engine/client";
import { docToSource, type EditorDoc } from "./doc.js";

/** Null when the doc passes the engine's structural validation, else its message.
 *  Client-side UX only — the server re-runs the authoritative pipeline on save. */
export function validationMessage(doc: EditorDoc): string | null {
  try {
    validateHexMap(docToSource(doc));
    return null;
  } catch (caught) {
    return caught instanceof Error ? caught.message : String(caught);
  }
}
```

Create `packages/web/src/editor/draft.ts`:

```ts
import type { EditorDoc } from "./doc.js";

export interface DraftStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface SavedDraft {
  doc: EditorDoc;
  savedAt: string;
}

function draftKey(id: string | null): string {
  return `editor-draft:${id ?? "new"}`;
}

export function saveDraft(doc: EditorDoc, store: DraftStore = window.localStorage): void {
  store.setItem(draftKey(doc.id), JSON.stringify({ doc, savedAt: new Date().toISOString() }));
}

export function loadDraft(
  id: string | null,
  store: DraftStore = window.localStorage
): SavedDraft | null {
  const raw = store.getItem(draftKey(id));
  if (!raw) {
    return null;
  }
  try {
    const parsed = JSON.parse(raw) as SavedDraft;
    if (!parsed || !Array.isArray(parsed.doc?.tiles) || typeof parsed.savedAt !== "string") {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function clearDraft(id: string | null, store: DraftStore = window.localStorage): void {
  store.removeItem(draftKey(id));
}
```

- [ ] **Step 3: Run tests to verify they pass**

Run: `corepack pnpm --filter @sengoku-jidai/web exec vitest run test/editor/validation.test.ts test/editor/draft.test.ts`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add packages/web/src/editor/validation.ts packages/web/src/editor/draft.ts packages/web/test/editor/validation.test.ts packages/web/test/editor/draft.test.ts
git commit -m "feat(web): editor validation strip logic + localStorage drafts

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 12: Editor canvas component

**Files:**
- Create: `packages/web/src/components/editor/EditorCanvas.tsx`

**Interfaces:**
- Consumes: reducer state/actions (Tasks 7–9), geometry (Task 10).
- Produces: `EditorCanvas({ state, dispatch }: { state: EditorState; dispatch: Dispatch<EditorAction> })`.
- DOM contract (e2e relies on it): every rendered hex polygon carries `data-axial="q,r"`; painted hexes also carry `data-tile-id`; the svg has `data-testid="editor-canvas"`.

No unit test (the repo has no DOM-test infra; behavior is covered by the pure modules + the PR 3 e2e).

- [ ] **Step 1: Implement**

Create `packages/web/src/components/editor/EditorCanvas.tsx`:

```tsx
import {
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type PointerEvent as ReactPointerEvent
} from "react";
import type { Axial, HexTileSource, Pixel } from "@sengoku-jidai/engine/client";
import { axialKey, axialToPixel, pixelToAxial } from "@sengoku-jidai/engine/client";
import { axialsInRect, hexPoints, tileBoundarySegments, tileCentroid } from "../../editor/geometry.js";
import { tileAt, type EditorAction, type EditorState } from "../../editor/reducer.js";

const INITIAL_VIEW = { x: -900, y: -700, width: 2600, height: 2000 };
const MIN_VIEW_WIDTH = 500;
const MAX_VIEW_WIDTH = 14000;

interface Gesture {
  mode: "paint" | "pan";
  startClientX: number;
  startClientY: number;
  viewX: number;
  viewY: number;
  moved: boolean;
  lastAxial: string | null;
}

interface EditorCanvasProps {
  state: EditorState;
  dispatch: Dispatch<EditorAction>;
}

export function EditorCanvas({ state, dispatch }: EditorCanvasProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [view, setView] = useState(INITIAL_VIEW);
  const gestureRef = useRef<Gesture | null>(null);
  const { doc, tool, selection } = state;
  const selected = new Set(selection);

  function toBoard(client: { clientX: number; clientY: number }): Pixel {
    const rect = svgRef.current!.getBoundingClientRect();
    return {
      x: view.x + ((client.clientX - rect.left) / rect.width) * view.width,
      y: view.y + ((client.clientY - rect.top) / rect.height) * view.height
    };
  }

  function paintAt(client: { clientX: number; clientY: number }): void {
    const hex = pixelToAxial(toBoard(client), doc.layout);
    const key = axialKey(hex);
    if (gestureRef.current?.lastAxial === key) {
      return;
    }
    if (gestureRef.current) {
      gestureRef.current.lastAxial = key;
    }
    if (tool === "erase") {
      dispatch({ type: "eraseHex", hex });
    } else if (tool === "land" || tool === "sea") {
      dispatch({ type: "paintHex", kind: tool, hex });
    }
  }

  function handlePointerDown(event: ReactPointerEvent<SVGSVGElement>) {
    event.currentTarget.setPointerCapture(event.pointerId);
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
    if (!gesture) {
      return;
    }
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
    setView((v) => ({ ...v, x: gesture.viewX - dx, y: gesture.viewY - dy }));
  }

  function handlePointerUp(event: ReactPointerEvent<SVGSVGElement>) {
    const gesture = gestureRef.current;
    gestureRef.current = null;
    if (!gesture || gesture.mode !== "pan" || gesture.moved || tool !== "select") {
      return;
    }
    const hex = pixelToAxial(toBoard(event), doc.layout);
    const tile = tileAt(doc, hex);
    dispatch({ type: "selectTile", tileId: tile?.id ?? null, additive: event.shiftKey });
  }

  // Native non-passive wheel listener: React's synthetic onWheel can't preventDefault.
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) {
      return;
    }
    const handleWheel = (event: WheelEvent) => {
      event.preventDefault();
      setView((v) => {
        const factor = Math.exp(event.deltaY * 0.001);
        const width = Math.min(Math.max(v.width * factor, MIN_VIEW_WIDTH), MAX_VIEW_WIDTH);
        const scale = width / v.width;
        const rect = svg.getBoundingClientRect();
        const px = v.x + ((event.clientX - rect.left) / rect.width) * v.width;
        const py = v.y + ((event.clientY - rect.top) / rect.height) * v.height;
        return {
          x: px - (px - v.x) * scale,
          y: py - (py - v.y) * scale,
          width,
          height: v.height * scale
        };
      });
    };
    svg.addEventListener("wheel", handleWheel, { passive: false });
    return () => svg.removeEventListener("wheel", handleWheel);
  }, []);

  const gridCells = axialsInRect(view, doc.layout);
  const boundaries = tileBoundarySegments(doc.tiles, doc.layout);
  const primary = doc.tiles.find((t) => t.id === selection[0]);

  return (
    <svg
      ref={svgRef}
      data-testid="editor-canvas"
      className={`editor-canvas is-tool-${tool}`}
      viewBox={`${view.x} ${view.y} ${view.width} ${view.height}`}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
    >
      <g className="editor-grid">
        {gridCells.map((hex) => (
          <polygon
            key={axialKey(hex)}
            data-axial={`${hex.q},${hex.r}`}
            points={hexPoints(axialToPixel(hex, doc.layout), doc.layout.size)}
          />
        ))}
      </g>
      <g className="editor-tiles">
        {doc.tiles.map((tile) =>
          tile.hexes.map((hex) => (
            <polygon
              key={axialKey(hex)}
              data-tile-id={tile.id}
              data-axial={`${hex.q},${hex.r}`}
              className={`editor-hex is-${tile.kind}${selected.has(tile.id) ? " is-selected" : ""}`}
              points={hexPoints(axialToPixel(hex, doc.layout), doc.layout.size)}
            />
          ))
        )}
      </g>
      <g className="editor-boundaries">
        {boundaries.map((s, i) => (
          <line key={i} x1={s.x1} y1={s.y1} x2={s.x2} y2={s.y2} />
        ))}
      </g>
      {primary?.features.harbor && primary.ports ? (
        <g className="editor-ports">
          {primary.ports.map((seaId) => {
            const sea = doc.tiles.find((t) => t.id === seaId);
            if (!sea) {
              return null;
            }
            const from = tileCentroid(primary.hexes, doc.layout);
            const to = tileCentroid(sea.hexes, doc.layout);
            return <line key={seaId} x1={from.x} y1={from.y} x2={to.x} y2={to.y} />;
          })}
        </g>
      ) : null}
      <g className="editor-badges">
        {doc.tiles.map((tile) => (
          <TileBadge key={tile.id} tile={tile} state={state} />
        ))}
      </g>
    </svg>
  );
}

function TileBadge({ tile, state }: { tile: HexTileSource; state: EditorState }) {
  const { doc } = state;
  const center = tileCentroid(tile.hexes, doc.layout);
  const deployment = doc.startingDeployment[tile.id];
  const lines: { text: string; seat?: string }[] = [];
  const traits: string[] = [];
  if (tile.features.hq) {
    traits.push(tile.features.hq === "red" ? "HQ·R" : "HQ·B");
  }
  if (tile.features.valueStars) {
    traits.push("★".repeat(tile.features.valueStars));
  }
  if (tile.features.harbor) {
    traits.push("⚓");
  }
  if (tile.features.shellable) {
    traits.push("◎");
  }
  if (doc.bonusSlots.includes(tile.id)) {
    traits.push("✦");
  }
  if (traits.length > 0) {
    lines.push({ text: traits.join(" ") });
  }
  if (deployment) {
    const units = [
      deployment.troop ? `${deployment.troop}⚔` : null,
      deployment.ship ? `${deployment.ship}⛵` : null
    ]
      .filter(Boolean)
      .join(" ");
    lines.push({ text: units, seat: deployment.seat });
  }
  if (lines.length === 0) {
    return null;
  }
  return (
    <text x={center.x} y={center.y} className="editor-badge">
      {lines.map((line, i) => (
        <tspan key={i} x={center.x} dy={i === 0 ? 0 : "1.2em"} data-seat={line.seat}>
          {line.text}
        </tspan>
      ))}
    </text>
  );
}
```

- [ ] **Step 2: Verify it compiles**

Run: `corepack pnpm typecheck && corepack pnpm lint`
Expected: green (the component is not yet mounted anywhere; that's Task 14).
If lint complains about the unused component, wire-up in Task 14 resolves it — you may combine the commits if the linter hard-fails on unused exports (it should not: it's an export).

- [ ] **Step 3: Commit**

```bash
git add packages/web/src/components/editor/EditorCanvas.tsx
git commit -m "feat(web): schematic SVG editor canvas

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 13: Toolbar + inspector components

**Files:**
- Create: `packages/web/src/components/editor/EditorToolbar.tsx`, `packages/web/src/components/editor/InspectorPanel.tsx`

**Interfaces:**
- Consumes: reducer (Tasks 7–9), `validationMessage` not here (screen-level), `riversRuleset` from engine client.
- Produces:
  - `EditorToolbar({ state, dispatch })` — tool buttons with exact accessible names: "Select tool", "Paint land", "Paint sea", "Erase", "Undo", "Redo" (`aria-pressed` marks the active tool).
  - `InspectorPanel({ state, dispatch })` — control accessible names the e2e uses: "HQ owner", "Value stars", "Harbor", "Shellable", "Bonus slot", "Deployment seat", "Troops", "Ships", "Add port", "Merge tiles", "Unmerge tile".

- [ ] **Step 1: Implement the toolbar**

Create `packages/web/src/components/editor/EditorToolbar.tsx`:

```tsx
import type { Dispatch } from "react";
import type { EditorAction, EditorState, Tool } from "../../editor/reducer.js";

const TOOLS: { tool: Tool; label: string }[] = [
  { tool: "select", label: "Select tool" },
  { tool: "land", label: "Paint land" },
  { tool: "sea", label: "Paint sea" },
  { tool: "erase", label: "Erase" }
];

export function EditorToolbar({
  state,
  dispatch
}: {
  state: EditorState;
  dispatch: Dispatch<EditorAction>;
}) {
  return (
    <div className="editor-toolbar" role="toolbar" aria-label="Editor tools">
      {TOOLS.map(({ tool, label }) => (
        <button
          key={tool}
          type="button"
          aria-pressed={state.tool === tool}
          className={state.tool === tool ? "is-active" : ""}
          onClick={() => dispatch({ type: "setTool", tool })}
        >
          {label}
        </button>
      ))}
      <hr />
      <button type="button" disabled={state.past.length === 0} onClick={() => dispatch({ type: "undo" })}>
        Undo
      </button>
      <button type="button" disabled={state.future.length === 0} onClick={() => dispatch({ type: "redo" })}>
        Redo
      </button>
    </div>
  );
}
```

- [ ] **Step 2: Implement the inspector**

Create `packages/web/src/components/editor/InspectorPanel.tsx`:

```tsx
import type { Dispatch } from "react";
import type { SeatId } from "@sengoku-jidai/engine/client";
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

  if (selection.length > 1) {
    return (
      <aside className="editor-inspector">
        <h2>{selection.length} tiles selected</h2>
        <button
          type="button"
          className="primary-action"
          disabled={!canMergeSelection(doc, selection)}
          onClick={() => dispatch({ type: "mergeSelection" })}
        >
          Merge tiles
        </button>
        <p className="muted">Merging requires the same kind and touching edges.</p>
      </aside>
    );
  }

  if (!primary) {
    const hqSeats = doc.tiles.filter((t) => t.features.hq).map((t) => t.features.hq);
    return (
      <aside className="editor-inspector">
        <h2>Map</h2>
        <ul className="editor-tally">
          <li>{doc.tiles.length} tiles</li>
          <li>Red HQ: {hqSeats.includes("red") ? "placed" : "missing"}</li>
          <li>Black HQ: {hqSeats.includes("black") ? "placed" : "missing"}</li>
          <li>
            Bonus slots: {doc.bonusSlots.length} of {riversRuleset.bonusSet.length}
          </li>
        </ul>
        <p className="muted">Click a tile to edit it; shift-click to select several.</p>
      </aside>
    );
  }

  const tileId = primary.id;
  const deployment = doc.startingDeployment[tileId];
  const isLand = primary.kind === "land";

  return (
    <aside className="editor-inspector">
      <h2>
        {isLand ? "Land tile" : "Sea tile"} · {primary.hexes.length}{" "}
        {primary.hexes.length === 1 ? "hex" : "hexes"}
      </h2>

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
                  patch: { hq: event.target.value === "none" ? null : (event.target.value as SeatId) }
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
    </aside>
  );
}
```

- [ ] **Step 3: Verify compile + commit**

Run: `corepack pnpm typecheck && corepack pnpm lint`
Expected: green.

```bash
git add packages/web/src/components/editor/EditorToolbar.tsx packages/web/src/components/editor/InspectorPanel.tsx
git commit -m "feat(web): editor toolbar and tile inspector

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 14: Editor screen — assembly, save, drafts

**Files:**
- Create: `packages/web/src/editor/save.ts`, `packages/web/src/components/editor/EditorScreen.tsx`
- Modify: `packages/web/src/App.tsx` (replace the placeholder editor branch), `packages/web/src/components/MapLibraryScreen.tsx` (add Edit + New map buttons), `packages/web/src/styles/app.css`
- Test: `packages/web/test/editor/save.test.ts`

**Interfaces:**
- Produces:
  - `persistDoc(doc: EditorDoc): Promise<MapDetail>` — trims the name (throws `Error("Name your map before saving.")` when empty), `POST` for `doc.id === null` (body id `"new-map"`, server overwrites), `PUT` otherwise.
  - `EditorScreen({ mapId }: { mapId: string | null })`.
  - Screen accessible names the e2e uses: "Map name" input, "Save map" button, "Back to library", "New game on this map", "Restore draft", "Discard draft"; validation strip shows exactly `Map is valid` or the engine message.
  - Loading an existing map uses `docFromSource(detail.source, { asCopy: detail.builtin })` — built-ins open as unsaved copies from day one.

- [ ] **Step 1: Write the failing save tests**

Create `packages/web/test/editor/save.test.ts`:

```ts
import { afterEach, describe, expect, it, vi } from "vitest";
import { emptyDoc } from "../../src/editor/doc.js";
import { persistDoc } from "../../src/editor/save.js";

function stubFetch(status: number, body: unknown): ReturnType<typeof vi.fn> {
  const mock = vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body)
  });
  vi.stubGlobal("fetch", mock);
  return mock;
}

describe("persistDoc", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("rejects a blank name without calling the API", async () => {
    const mock = stubFetch(201, {});
    await expect(persistDoc({ ...emptyDoc(), name: "  " })).rejects.toThrow(
      "Name your map before saving."
    );
    expect(mock).not.toHaveBeenCalled();
  });

  it("POSTs new docs with the placeholder id", async () => {
    const mock = stubFetch(201, { id: "srv-1" });
    await persistDoc({ ...emptyDoc(), name: " Fresh " });
    const [url, init] = mock.mock.calls[0]!;
    expect(url).toBe("/api/maps");
    expect(init.method).toBe("POST");
    const body = JSON.parse(init.body as string);
    expect(body.id).toBe("new-map");
    expect(body.name).toBe("Fresh");
  });

  it("PUTs saved docs under their id", async () => {
    const mock = stubFetch(200, { id: "abc" });
    await persistDoc({ ...emptyDoc(), id: "abc", name: "Known" });
    const [url, init] = mock.mock.calls[0]!;
    expect(url).toBe("/api/maps/abc");
    expect(init.method).toBe("PUT");
    expect(JSON.parse(init.body as string).id).toBe("abc");
  });
});
```

Run: `corepack pnpm --filter @sengoku-jidai/web exec vitest run test/editor/save.test.ts`
Expected: FAIL.

- [ ] **Step 2: Implement `save.ts`**

Create `packages/web/src/editor/save.ts`:

```ts
import type { MapDetail } from "@sengoku-jidai/shared";
import { createMap, updateMap } from "../client/api.js";
import { docToSource, type EditorDoc } from "./doc.js";

/** Persist the doc: POST for never-saved docs (server assigns the real id), PUT otherwise. */
export async function persistDoc(doc: EditorDoc): Promise<MapDetail> {
  const name = doc.name.trim();
  if (name.length === 0) {
    throw new Error("Name your map before saving.");
  }
  const named = { ...doc, name };
  if (doc.id === null) {
    return createMap(docToSource(named, "new-map"));
  }
  return updateMap(doc.id, docToSource(named));
}
```

Run: `corepack pnpm --filter @sengoku-jidai/web exec vitest run test/editor/save.test.ts` → PASS.

- [ ] **Step 3: Implement the screen**

Create `packages/web/src/components/editor/EditorScreen.tsx`:

```tsx
import { useEffect, useMemo, useReducer, useRef, useState } from "react";
import type { HexMapSource } from "@sengoku-jidai/engine/client";
import { apiErrorMessage, fetchMap } from "../../client/api.js";
import { docFromSource, emptyDoc } from "../../editor/doc.js";
import { clearDraft, loadDraft, saveDraft, type SavedDraft } from "../../editor/draft.js";
import { editorReducer, initialEditorState } from "../../editor/reducer.js";
import { persistDoc } from "../../editor/save.js";
import { validationMessage } from "../../editor/validation.js";
import { createUrl, editorUrl, mapsUrl, navigateTo } from "../../state/route.js";
import { EditorCanvas } from "./EditorCanvas.js";
import { EditorToolbar } from "./EditorToolbar.js";
import { InspectorPanel } from "./InspectorPanel.js";

export function EditorScreen({ mapId }: { mapId: string | null }) {
  const [state, dispatch] = useReducer(editorReducer, emptyDoc(), initialEditorState);
  const [loading, setLoading] = useState(mapId !== null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [pendingDraft, setPendingDraft] = useState<SavedDraft | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [savedId, setSavedId] = useState<string | null>(null);
  const draftTimer = useRef<number | null>(null);

  // Load the map (or offer a draft for /maps/new).
  useEffect(() => {
    let cancelled = false;
    setSavedId(null);
    setSaveError(null);
    if (mapId === null) {
      dispatch({ type: "loadDoc", doc: emptyDoc() });
      setPendingDraft(loadDraft(null));
      setLoading(false);
      return;
    }
    setLoading(true);
    setLoadError(null);
    fetchMap(mapId)
      .then((detail) => {
        if (cancelled) {
          return;
        }
        dispatch({
          type: "loadDoc",
          doc: docFromSource(detail.source as HexMapSource, { asCopy: detail.builtin })
        });
        const draft = loadDraft(detail.builtin ? null : mapId);
        if (draft && (!detail.updatedAt || draft.savedAt > detail.updatedAt)) {
          setPendingDraft(draft);
        }
        setLoading(false);
      })
      .catch((caught) => {
        if (!cancelled) {
          setLoadError(apiErrorMessage(caught));
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [mapId]);

  // Debounced draft autosave (paused while a restore decision is pending).
  useEffect(() => {
    if (loading || pendingDraft) {
      return;
    }
    if (draftTimer.current !== null) {
      window.clearTimeout(draftTimer.current);
    }
    draftTimer.current = window.setTimeout(() => saveDraft(state.doc), 500);
    return () => {
      if (draftTimer.current !== null) {
        window.clearTimeout(draftTimer.current);
      }
    };
  }, [state.doc, loading, pendingDraft]);

  const problem = useMemo(() => validationMessage(state.doc), [state.doc]);

  async function handleSave() {
    setSaving(true);
    setSaveError(null);
    setSavedId(null);
    try {
      const previousId = state.doc.id;
      const detail = await persistDoc(state.doc);
      clearDraft(previousId);
      setSavedId(detail.id);
      if (previousId === null) {
        dispatch({
          type: "loadDoc",
          doc: docFromSource(detail.source as HexMapSource, { asCopy: false })
        });
        // Rebind the URL without navigateTo: a popstate would re-run the load
        // effect, which refetches and clears the "Saved" toast.
        window.history.replaceState(null, "", editorUrl(detail.id));
      }
    } catch (caught) {
      setSaveError(apiErrorMessage(caught));
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <main className="app-shell app-empty">
        <p className="muted">Loading map…</p>
      </main>
    );
  }
  if (loadError) {
    return (
      <main className="app-shell app-empty">
        <section className="start-panel" aria-label="Map editor">
          <p className="error-text">{loadError}</p>
          <button type="button" className="secondary-action" onClick={() => navigateTo(mapsUrl())}>
            Back to library
          </button>
        </section>
      </main>
    );
  }

  return (
    <main className="editor-shell">
      <header className="editor-header">
        <button type="button" className="secondary-action" onClick={() => navigateTo(mapsUrl())}>
          Back to library
        </button>
        <label className="field editor-name">
          <span>Map name</span>
          <input
            type="text"
            value={state.doc.name}
            maxLength={80}
            placeholder="e.g. Twin Rivers"
            onChange={(event) => dispatch({ type: "setName", name: event.target.value })}
          />
        </label>
        <span className={problem ? "editor-status is-invalid" : "editor-status is-valid"}>
          {problem ?? "Map is valid"}
        </span>
        <button type="button" className="primary-action" disabled={saving} onClick={() => void handleSave()}>
          {saving ? "Saving…" : "Save map"}
        </button>
      </header>

      {pendingDraft ? (
        <div className="editor-banner">
          <span>Unsaved draft from {new Date(pendingDraft.savedAt).toLocaleString()}.</span>
          <button
            type="button"
            onClick={() => {
              dispatch({ type: "loadDoc", doc: pendingDraft.doc });
              setPendingDraft(null);
            }}
          >
            Restore draft
          </button>
          <button
            type="button"
            onClick={() => {
              clearDraft(pendingDraft.doc.id);
              setPendingDraft(null);
            }}
          >
            Discard draft
          </button>
        </div>
      ) : null}
      {saveError ? <p className="error-text editor-save-error">{saveError}</p> : null}
      {savedId ? (
        <div className="editor-toast">
          <span>Saved.</span>
          <button type="button" onClick={() => navigateTo(mapsUrl())}>
            Back to library
          </button>
          <button type="button" onClick={() => navigateTo(createUrl(savedId))}>
            New game on this map
          </button>
        </div>
      ) : null}

      <div className="editor-body">
        <EditorToolbar state={state} dispatch={dispatch} />
        <EditorCanvas state={state} dispatch={dispatch} />
        <InspectorPanel state={state} dispatch={dispatch} />
      </div>
    </main>
  );
}
```

Note the builtin draft-key subtlety: builtins load `asCopy` (doc.id null), so their drafts live under `editor-draft:new` — `loadDraft(detail.builtin ? null : mapId)` matches that.

- [ ] **Step 4: Wire App + library buttons + styles**

1. In `packages/web/src/App.tsx`, replace the Task 3 placeholder branch with:

```tsx
import { EditorScreen } from "./components/editor/EditorScreen.js";
```

```tsx
  if (route.kind === "editor") {
    return <EditorScreen mapId={route.mapId} />;
  }
```

2. In `MapLibraryScreen.tsx`, add to the header a New map button, and per-row Edit for custom maps (builtin "Edit copy" arrives in PR 3):

```tsx
import { createUrl, editorUrl, navigateTo } from "../state/route.js";
```

Header (next to "Back to game"):

```tsx
          <button type="button" className="primary-action" onClick={() => navigateTo(editorUrl(null))}>
            New map
          </button>
```

Row actions (inside `map-row-actions`, before Delete):

```tsx
                  {!map.builtin ? (
                    <button
                      type="button"
                      className="secondary-action"
                      onClick={() => navigateTo(editorUrl(map.id))}
                    >
                      Edit
                    </button>
                  ) : null}
```

3. Append editor styles to `packages/web/src/styles/app.css`:

```css
/* --- Map editor --- */
.editor-shell {
  display: flex;
  flex-direction: column;
  height: 100vh;
}
.editor-header {
  display: flex;
  align-items: end;
  gap: 12px;
  padding: 10px 14px;
  border-bottom: 1px solid rgba(0, 0, 0, 0.15);
}
.editor-name {
  flex: 0 0 260px;
}
.editor-status {
  margin-left: auto;
  font-size: 0.9em;
}
.editor-status.is-valid {
  color: #2c7a34;
}
.editor-status.is-invalid {
  color: #b03030;
}
.editor-banner,
.editor-toast {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 14px;
  background: rgba(255, 220, 130, 0.35);
}
.editor-toast {
  background: rgba(140, 220, 150, 0.3);
}
.editor-save-error {
  padding: 8px 14px;
  margin: 0;
}
.editor-body {
  display: flex;
  flex: 1;
  min-height: 0;
}
.editor-toolbar {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 10px;
  border-right: 1px solid rgba(0, 0, 0, 0.15);
}
.editor-toolbar .is-active {
  outline: 2px solid #4a6fa5;
}
.editor-canvas {
  flex: 1;
  min-width: 0;
  touch-action: none;
  background: #f4f1e8;
}
.editor-canvas .editor-grid polygon {
  fill: transparent;
  stroke: rgba(0, 0, 0, 0.12);
  stroke-width: 2;
}
.editor-canvas .editor-hex.is-land {
  fill: #dcc98f;
}
.editor-canvas .editor-hex.is-sea {
  fill: #9fc3d8;
}
.editor-canvas .editor-hex.is-selected {
  fill-opacity: 0.75;
  stroke: #f5a623;
  stroke-width: 10;
}
.editor-canvas .editor-boundaries line {
  stroke: #4a3b22;
  stroke-width: 6;
  stroke-linecap: round;
  pointer-events: none;
}
.editor-canvas .editor-ports line {
  stroke: #2b5f8a;
  stroke-width: 5;
  stroke-dasharray: 14 10;
  pointer-events: none;
}
.editor-canvas .editor-badges {
  pointer-events: none;
}
.editor-canvas .editor-badge {
  font-size: 40px;
  text-anchor: middle;
  paint-order: stroke;
  stroke: rgba(255, 255, 255, 0.8);
  stroke-width: 6;
}
.editor-canvas .editor-badge tspan[data-seat="red"] {
  fill: #b03030;
}
.editor-canvas .editor-badge tspan[data-seat="black"] {
  fill: #222;
}
.editor-inspector {
  width: 280px;
  padding: 12px;
  border-left: 1px solid rgba(0, 0, 0, 0.15);
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.editor-tally {
  list-style: none;
  padding: 0;
  margin: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.editor-port-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
}
.check {
  display: flex;
  gap: 8px;
  align-items: center;
}
```

- [ ] **Step 5: Verify + manual smoke**

Run: `corepack pnpm typecheck && corepack pnpm --filter @sengoku-jidai/web test && corepack pnpm lint`
Expected: green. Then `corepack pnpm dev`, open `/maps/new`: paint a few hexes, merge two, set an HQ, watch the validation strip change, save with a name, confirm it appears at `/maps` and is playable from the picker. (Headless-verify per the local e2e recipe if no display.)

- [ ] **Step 6: Commit**

```bash
git add packages/web/src/editor/save.ts packages/web/test/editor/save.test.ts packages/web/src/components/editor/EditorScreen.tsx packages/web/src/App.tsx packages/web/src/components/MapLibraryScreen.tsx packages/web/src/styles/app.css
git commit -m "feat(web): editor screen — assembly, save flow, draft restore

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 15: PR 2 gate + pull request

- [ ] **Step 1: Full gate**

```bash
corepack pnpm exec prettier --write packages/web packages/engine/src/client.ts
corepack pnpm typecheck && corepack pnpm test && corepack pnpm build && corepack pnpm lint && corepack pnpm exec prettier --check .
```

Expected: green (note: `pnpm test` runs the engine determinism anchor — untouched by this PR, must stay green).

- [ ] **Step 2: Push and open PR**

```bash
git push -u origin sp5-editor-core
gh pr create --title "feat(web): hex map editor — canvas, inspector, save (SP5 part 2)" --body "$(cat <<'EOF'
## Summary
- /maps/new and /maps/:id/edit: schematic hex editor (paint land/sea/erase, hex-per-tile with merge/unmerge, undo/redo)
- Tile inspector: HQ (one per seat), value stars, harbor + ports (click-to-link), shellable, bonus slots, starting deployment
- Live validation strip driven by the engine's validateHexMap; save POST/PUT via the SP4 maps API; localStorage draft autosave with restore banner
- Engine: additive client.ts re-exports (validateHexMap, hex coords, riversRuleset) — no logic changes

Built-ins open as editable copies; the save-as-copy dialog for 409 mapInUse and the real-render preview land in part 3.

Spec: docs/superpowers/specs/2026-07-03-map-editor-ui-design.md

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
gh pr checks --watch
```

Expected: CI green. **Ask Martin to review/merge.**

---

# PR 3 — Preview, save-as-copy, full-loop e2e (branch `sp5-editor-finish`)

Start: `git checkout main && git pull && git checkout -b sp5-editor-finish`

### Task 16: Real-render preview pane

**Files:**
- Modify: `packages/web/src/components/editor/EditorScreen.tsx`, `packages/web/src/styles/app.css`

**Interfaces:**
- Consumes: `assembleBoardSvg`, `buildScene` from `@sengoku-jidai/board-render`; `compileHexMap` from engine client; `docToSource`.
- Produces: a "Preview" toggle button (aria-pressed) in the editor header; while on, the canvas area shows the board-render output or `Preview unavailable: <reason>`.

- [ ] **Step 1: Implement**

In `EditorScreen.tsx`:

1. Imports:

```tsx
import { compileHexMap } from "@sengoku-jidai/engine/client";
import { assembleBoardSvg, buildScene } from "@sengoku-jidai/board-render";
import { docToSource } from "../../editor/doc.js";
```

(`docFromSource`/`emptyDoc` imports already exist — extend that line.)

2. State + memo inside the component:

```tsx
  const [preview, setPreview] = useState(false);
  const previewResult = useMemo(() => {
    if (!preview) {
      return null;
    }
    try {
      return { svg: assembleBoardSvg(buildScene(compileHexMap(docToSource(state.doc)))) };
    } catch (caught) {
      return { error: caught instanceof Error ? caught.message : String(caught) };
    }
  }, [preview, state.doc]);
```

3. Header button (before "Save map"):

```tsx
        <button type="button" aria-pressed={preview} onClick={() => setPreview((p) => !p)}>
          Preview
        </button>
```

4. Body swap:

```tsx
      <div className="editor-body">
        <EditorToolbar state={state} dispatch={dispatch} />
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
          <EditorCanvas state={state} dispatch={dispatch} />
        )}
        <InspectorPanel state={state} dispatch={dispatch} />
      </div>
```

5. CSS:

```css
.editor-preview {
  flex: 1;
  min-width: 0;
  overflow: auto;
  padding: 12px;
}
.editor-preview svg {
  width: 100%;
  height: 100%;
}
```

- [ ] **Step 2: Verify + commit**

Run: `corepack pnpm typecheck && corepack pnpm lint && corepack pnpm --filter @sengoku-jidai/web test`
Expected: green.

```bash
git add packages/web/src/components/editor/EditorScreen.tsx packages/web/src/styles/app.css
git commit -m "feat(web): real board-render preview in the editor

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 17: Save-as-copy dialog + built-in "Edit copy" button

**Files:**
- Modify: `packages/web/src/components/editor/EditorScreen.tsx`, `packages/web/src/components/MapLibraryScreen.tsx`

**Interfaces:**
- Produces: on a 409 save failure, a dialog offers "Save as copy" (POSTs under `<name> (copy)`, rebinds the editor to the new id) or "Keep editing"; library built-in rows get an "Edit copy" button (same `editorUrl(id)` navigation — the editor already opens built-ins as copies).

- [ ] **Step 1: Implement the dialog**

In `EditorScreen.tsx`:

1. Import `ApiError` (extend the api import) and add state:

```tsx
import { ApiError, apiErrorMessage, fetchMap } from "../../client/api.js";
```

```tsx
  const [conflict, setConflict] = useState(false);
```

2. In `handleSave`'s catch, route 409s to the dialog:

```tsx
    } catch (caught) {
      if (caught instanceof ApiError && caught.status === 409) {
        setConflict(true);
      } else {
        setSaveError(apiErrorMessage(caught));
      }
    } finally {
```

3. Save-as-copy handler (next to `handleSave`):

```tsx
  async function handleSaveAsCopy() {
    const previousId = state.doc.id;
    const copy = { ...state.doc, id: null, name: `${state.doc.name.trim()} (copy)` };
    setConflict(false);
    setSaving(true);
    setSaveError(null);
    try {
      const detail = await persistDoc(copy);
      clearDraft(previousId);
      setSavedId(detail.id);
      dispatch({
        type: "loadDoc",
        doc: docFromSource(detail.source as HexMapSource, { asCopy: false })
      });
      // replaceState, not navigateTo — see handleSave.
      window.history.replaceState(null, "", editorUrl(detail.id));
    } catch (caught) {
      setSaveError(apiErrorMessage(caught));
    } finally {
      setSaving(false);
    }
  }
```

4. Dialog markup (next to the toast/banner block):

```tsx
      {conflict ? (
        <div className="editor-banner" role="alertdialog" aria-label="Map in use">
          <span>This map is used by existing games and can’t be changed.</span>
          <button type="button" onClick={() => void handleSaveAsCopy()}>
            Save as copy
          </button>
          <button type="button" onClick={() => setConflict(false)}>
            Keep editing
          </button>
        </div>
      ) : null}
```

- [ ] **Step 2: Library button**

In `MapLibraryScreen.tsx` row actions, next to the custom-map Edit button add the builtin branch:

```tsx
                  {map.builtin ? (
                    <button
                      type="button"
                      className="secondary-action"
                      onClick={() => navigateTo(editorUrl(map.id))}
                    >
                      Edit copy
                    </button>
                  ) : null}
```

- [ ] **Step 3: Verify + commit**

Run: `corepack pnpm typecheck && corepack pnpm lint && corepack pnpm --filter @sengoku-jidai/web test`
Expected: green. Manual check if convenient: save a map, start a game on it, then try saving an edit — the 409 dialog appears; "Save as copy" lands on a fresh id.

```bash
git add packages/web/src/components/editor/EditorScreen.tsx packages/web/src/components/MapLibraryScreen.tsx
git commit -m "feat(web): save-as-copy for in-use maps + edit-copy for built-ins

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 18: Full-loop e2e

**Files:**
- Create: `tests/e2e/map-editor.spec.ts`

**Interfaces:**
- Consumes the DOM contracts fixed earlier: `[data-axial]` hex polygons, `[data-tile-id]`, toolbar/inspector accessible names (Tasks 12–14), `getByTestId("board")` + `#t1`-style tile ids on the game board, the movement flow selectors from `tests/e2e/movement.spec.ts`.

- [ ] **Step 1: Write the spec**

Create `tests/e2e/map-editor.spec.ts`:

```ts
import { expect, test } from "@playwright/test";

test("author a custom map, save it, and play a move on it", async ({ page }) => {
  await page.goto("/maps/new");

  // Paint three land hexes in a row (the paint-land tool is active by default).
  await page.locator('[data-axial="0,0"]').click();
  await page.locator('[data-axial="1,0"]').click();
  await page.locator('[data-axial="2,0"]').click();

  // Red HQ + troops on t1.
  await page.getByRole("button", { name: "Select tool" }).click();
  await page.locator('[data-tile-id="t1"]').click();
  await page.getByLabel("HQ owner").selectOption("red");
  await page.getByLabel("Deployment seat").selectOption("red");
  await page.getByLabel("Troops").fill("3");

  // Black HQ + troops on t3.
  await page.locator('[data-tile-id="t3"]').click();
  await page.getByLabel("HQ owner").selectOption("black");
  await page.getByLabel("Deployment seat").selectOption("black");
  await page.getByLabel("Troops").fill("3");

  await expect(page.getByText("Map is valid")).toBeVisible();

  await page.getByLabel("Map name").fill("E2E Custom Map");
  await page.getByRole("button", { name: "Save map" }).click();
  await page.getByRole("button", { name: "New game on this map" }).click();

  // The create screen preselects the new map.
  await expect(page.getByLabel("Map").locator("option:checked")).toHaveText(/E2E Custom Map/);
  await page.getByLabel("Your name").fill("Oda");
  await page.getByRole("button", { name: "Create game" }).click();

  // The custom board renders with the generated tile ids.
  await expect(page.getByTestId("board")).toBeVisible();
  await expect(page.locator("#t1")).toBeVisible();
  await expect(page.getByText("Round 1", { exact: true })).toBeVisible();

  // Drive one move, same order-first flow as movement.spec.ts.
  const actor = await page.locator(".app-shell").getAttribute("data-active-seat");
  expect(actor === "red" || actor === "black").toBe(true);
  const actorSeat = page.locator(`button[data-seat="${actor}"]`);
  if (await actorSeat.isEnabled()) {
    await actorSeat.click();
  }
  const advance = page.locator('button[data-order-verb="advance"]');
  await expect(advance).toBeVisible();
  await advance.click();
  const target = page.locator("[data-legal-target='true']").first();
  await expect(target).toBeVisible();
  await target.click();
  const source = page.locator("[data-source='true']").first();
  await expect(source).toBeVisible();
  await source.click();
  await page.getByRole("button", { name: /^Confirm/ }).click();
  await expect(page.getByText(/moved/)).toBeVisible();
});
```

Notes for the implementer:
- Each Playwright test gets a fresh browser context (clean localStorage) — no draft banner interference.
- On this map only Advance is ever legal (no sea), so the spec arms `advance` directly rather than movement.spec's advance/sail fallback. If `advance` is disabled for the actor seat, that's a real bug — investigate, don't paper over.
- The `#t1` locator works because the procedural renderer emits `<path id="<tileId>">` per area (SP2 contract, relied on by SP4's custom-map rendering).
- If clicking `[data-axial="0,0"]` is flaky because the grid polygon is `fill: transparent`, click via position instead: `page.locator('[data-testid="editor-canvas"]').click({ position: ... })` — but try the data-axial route first; transparent fills do receive pointer events.

- [ ] **Step 2: Run it**

Run: `corepack pnpm exec playwright test tests/e2e/map-editor.spec.ts`
Expected: PASS locally (the playwright config boots the dev server with a scratch sqlite; see the no-local-browser-verification memory for the temp port/cacheDir recipe if running on this host). If local browsers are unavailable, lean on CI in Task 19 — but attempt locally first.

- [ ] **Step 3: Run the whole e2e suite**

Run: `corepack pnpm exec playwright test`
Expected: all specs pass (hotseat/movement/support-actions untouched).

- [ ] **Step 4: Commit**

```bash
git add tests/e2e/map-editor.spec.ts
git commit -m "test(e2e): author, save, and play a custom map end to end

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 19: PR 3 gate + pull request + memory

- [ ] **Step 1: Full gate**

```bash
corepack pnpm exec prettier --write packages/web tests
corepack pnpm typecheck && corepack pnpm test && corepack pnpm build && corepack pnpm lint && corepack pnpm exec prettier --check .
```

Expected: green.

- [ ] **Step 2: Push and open PR**

```bash
git push -u origin sp5-editor-finish
gh pr create --title "feat(web): editor preview, save-as-copy, full-loop e2e (SP5 part 3)" --body "$(cat <<'EOF'
## Summary
- Preview toggle renders the working map through the real board-render pipeline (or a clear "unavailable" reason mid-edit)
- 409 mapInUse on save now offers "Save as copy" (new id, "(copy)" name); built-ins get an "Edit copy" library button
- New e2e: paint a map at /maps/new, save, create a game on it, and resolve a movement order — the first browser-verified custom-map loop

Completes SP5. Spec: docs/superpowers/specs/2026-07-03-map-editor-ui-design.md

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
gh pr checks --watch
```

Expected: CI green. **Ask Martin to review/merge.**

- [ ] **Step 3: Update memory**

Update `custom-map-editor-initiative.md`'s RESUME POINTER: SP5 done (PR numbers, branch names, anything learned), next = SP6 (terrain for custom maps). Note any new loose ends (e.g. deploy not yet browser-verified by Martin).
