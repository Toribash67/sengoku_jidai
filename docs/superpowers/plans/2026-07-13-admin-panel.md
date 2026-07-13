# Admin Panel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a password-gated `/admin` page that lists every game, shows metadata and seat info, exposes retrievable invite links for games created after this ships, and deletes games.

**Architecture:** A single shared `ADMIN_PASSWORD` env var gates new `/api/admin/*` Fastify routes (direct string compare, no accounts). A migration adds a nullable `token` column to `game_sessions` so raw seat tokens created from now on are recoverable; the admin list joins it to build invite links. The web app gains an `/admin` route rendering a self-contained `AdminScreen`.

**Tech Stack:** Fastify 5, better-sqlite3, Zod, React 19, Vitest. pnpm workspace with `@sengoku-jidai/{shared,server,web}` packages.

## Global Constraints

- Package manager is pnpm via corepack. Run library-consuming tests only after building libs (`corepack pnpm build:libs`) — the dist-consumption trap: `web`/`server` import the built `shared`/`engine`, not their source.
- Shared API contract types live in `packages/shared/src/api.ts` and are re-exported from `packages/shared/src/index.ts`.
- Server error responses use the existing `sendError(reply, status, code, message)` shape `{ error: { code, message, requestId } }`.
- Raw seat tokens are secrets: they may be returned ONLY from authenticated admin endpoints, never logged.
- The seat-token pattern: invite URL is `${origin}/g/${gameId}#${token}` via the existing `inviteUrl(origin, gameId, token)` helper in `packages/web/src/state/route.ts`.
- Migrations are applied in array order in `packages/server/src/persistence/database.ts`; SQL files live in `packages/server/migrations/`.

---

### Task 1: Config — `ADMIN_PASSWORD`

**Files:**
- Modify: `packages/server/src/config.ts`
- Test: `packages/server/test/config.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `ServerConfig.adminPassword?: string` (optional), populated from `env.ADMIN_PASSWORD`.

- [ ] **Step 1: Write the failing tests**

Append to `packages/server/test/config.test.ts` inside the existing `describe("loadConfig", ...)`:

```ts
  it("parses ADMIN_PASSWORD into adminPassword", () => {
    const config = loadConfig({ NODE_ENV: "development", ADMIN_PASSWORD: "hunter2" });
    expect(config.adminPassword).toBe("hunter2");
  });

  it("leaves adminPassword undefined when ADMIN_PASSWORD is unset", () => {
    const config = loadConfig({ NODE_ENV: "development" });
    expect(config.adminPassword).toBeUndefined();
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `corepack pnpm --filter @sengoku-jidai/server test config`
Expected: FAIL — `adminPassword` is undefined even when `ADMIN_PASSWORD` is set (the field doesn't exist yet).

- [ ] **Step 3: Add the config field**

In `packages/server/src/config.ts`, add to the `configSchema` object (after `falKey`):

```ts
    falKey: z.string().optional(),
    adminPassword: z.string().optional()
```

And in `loadConfig`'s `configSchema.parse({ ... })` call, add (after `falKey: env.FAL_KEY`):

```ts
    falKey: env.FAL_KEY,
    adminPassword: env.ADMIN_PASSWORD
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `corepack pnpm --filter @sengoku-jidai/server test config`
Expected: PASS (all config tests, including the two new ones).

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/config.ts packages/server/test/config.test.ts
git commit -m "feat(server): read ADMIN_PASSWORD into config"
```

---

### Task 2: Data layer — token storage, shared types, repository queries

**Files:**
- Create: `packages/server/migrations/005_admin_tokens.sql`
- Modify: `packages/server/src/persistence/database.ts` (migrations array)
- Modify: `packages/shared/src/api.ts` (admin types)
- Modify: `packages/server/src/persistence/repository.ts` (store token; `listGamesForAdmin`, `deleteGame`)
- Test: `packages/server/test/adminRepository.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces:
  - Shared types `AdminSeatSummary { seat: SeatId; name: string | null; status: SeatStatus; token: string | null }`, `AdminGameSummary { id: string; mode: GameMode; status: string; mapId: string; revision: number; createdAt: string; updatedAt: string; seats: AdminSeatSummary[] }`, `AdminGamesResponse { games: AdminGameSummary[] }`.
  - `GameRepository.listGamesForAdmin(): AdminGameSummary[]`
  - `GameRepository.deleteGame(gameId: string): boolean`

- [ ] **Step 1: Add the shared admin types**

In `packages/shared/src/api.ts`, after the `SeatToken` interface, add:

```ts
export interface AdminSeatSummary {
  seat: SeatId;
  name: string | null;
  status: SeatStatus;
  token: string | null;
}

export interface AdminGameSummary {
  id: string;
  mode: GameMode;
  status: string;
  mapId: string;
  revision: number;
  createdAt: string;
  updatedAt: string;
  seats: AdminSeatSummary[];
}

export interface AdminGamesResponse {
  games: AdminGameSummary[];
}
```

- [ ] **Step 2: Build shared so server/tests can import the new types**

Run: `corepack pnpm --filter @sengoku-jidai/shared build`
Expected: PASS (tsc emits, no errors).

- [ ] **Step 3: Create the migration**

Create `packages/server/migrations/005_admin_tokens.sql`:

```sql
ALTER TABLE game_sessions ADD COLUMN token TEXT;
```

- [ ] **Step 4: Register the migration**

In `packages/server/src/persistence/database.ts`, extend the `migrations` array:

```ts
  const migrations = [
    "001_initial.sql",
    "002_maps.sql",
    "003_map_terrain.sql",
    "004_map_terrains.sql",
    "005_admin_tokens.sql"
  ];
```

- [ ] **Step 5: Write the failing repository tests**

Create `packages/server/test/adminRepository.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { openDatabase, runMigrations } from "../src/persistence/database.js";
import { GameRepository } from "../src/persistence/repository.js";

function freshRepo() {
  const db = openDatabase(":memory:");
  runMigrations(db);
  return { db, repo: new GameRepository(db) };
}

describe("admin repository", () => {
  it("lists games with recoverable seat tokens", () => {
    const { repo } = freshRepo();
    const created = repo.createGame("private_multiplayer", "seed", {
      creatorName: "Alice",
      creatorSide: "red"
    });

    const games = repo.listGamesForAdmin();
    expect(games).toHaveLength(1);

    const game = games[0]!;
    expect(game.id).toBe(created.gameId);
    expect(game.mode).toBe("private_multiplayer");
    expect(game.seats).toHaveLength(2);

    const redSeat = game.seats.find((s) => s.seat === "red")!;
    const redToken = created.seats.find((s) => s.seat === "red")!.token;
    expect(redSeat.token).toBe(redToken);
    expect(redSeat.name).toBe("Alice");
    expect(redSeat.status).toBe("claimed");
  });

  it("hard-deletes a game and cascades to snapshots", () => {
    const { db, repo } = freshRepo();
    const created = repo.createGame("hotseat", "seed");

    expect(repo.deleteGame(created.gameId)).toBe(true);
    expect(repo.listGamesForAdmin()).toHaveLength(0);

    const snap = db
      .prepare("SELECT COUNT(*) AS n FROM game_snapshots WHERE game_id = ?")
      .get(created.gameId) as { n: number };
    expect(snap.n).toBe(0);

    expect(repo.deleteGame(created.gameId)).toBe(false);
  });
});
```

- [ ] **Step 6: Run tests to verify they fail**

Run: `corepack pnpm --filter @sengoku-jidai/server test adminRepository`
Expected: FAIL — `listGamesForAdmin`/`deleteGame` are not functions.

- [ ] **Step 7: Store the raw token at game creation**

In `packages/server/src/persistence/repository.ts`, inside `createGame`, change the `game_sessions` insert to include the `token` column:

```ts
        this.db
          .prepare(
            `INSERT INTO game_sessions
              (id, token_hash, token, game_id, seat, created_at, last_seen_at, revoked_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, NULL)`
          )
          .run(token.id, token.tokenHash, token.token, gameId, seat, now, now);
```

- [ ] **Step 8: Add the admin type import and repository methods**

In `packages/server/src/persistence/repository.ts`, add `AdminGameSummary` to the existing `@sengoku-jidai/shared` import:

```ts
import type { AdminGameSummary, GameSeatInfo, SeatStatus } from "@sengoku-jidai/shared";
```

Add these row interfaces near the other `interface ...Row` declarations:

```ts
interface AdminGameRow {
  id: string;
  mode: AdminGameSummary["mode"];
  status: string;
  map_id: string;
  current_revision: number;
  created_at: string;
  updated_at: string;
}

interface AdminSeatRow {
  seat: SeatId;
  display_name: string | null;
  status: SeatStatus;
  token: string | null;
}
```

Add these public methods to the `GameRepository` class (e.g. after `getSeatInfo`):

```ts
  listGamesForAdmin(): AdminGameSummary[] {
    const games = this.db
      .prepare(
        `SELECT id, mode, status, map_id, current_revision, created_at, updated_at
         FROM games
         ORDER BY updated_at DESC`
      )
      .all() as AdminGameRow[];

    const seatStmt = this.db.prepare(
      `SELECT s.seat AS seat, s.display_name AS display_name, s.status AS status, sess.token AS token
       FROM game_seats s
       LEFT JOIN game_sessions sess
         ON sess.game_id = s.game_id AND sess.seat = s.seat AND sess.revoked_at IS NULL
       WHERE s.game_id = ?
       ORDER BY s.seat`
    );

    return games.map((game) => ({
      id: game.id,
      mode: game.mode,
      status: game.status,
      mapId: game.map_id,
      revision: game.current_revision,
      createdAt: game.created_at,
      updatedAt: game.updated_at,
      seats: (seatStmt.all(game.id) as AdminSeatRow[]).map((row) => ({
        seat: row.seat,
        name: row.display_name,
        status: row.status,
        token: row.token ?? null
      }))
    }));
  }

  deleteGame(gameId: string): boolean {
    const info = this.db.prepare("DELETE FROM games WHERE id = ?").run(gameId);
    return info.changes > 0;
  }
```

- [ ] **Step 9: Run tests to verify they pass**

Run: `corepack pnpm --filter @sengoku-jidai/server test adminRepository`
Expected: PASS (both tests).

- [ ] **Step 10: Run the full server test suite to catch regressions**

Run: `corepack pnpm --filter @sengoku-jidai/server test`
Expected: PASS (existing repository/maps/server tests still green — the `game_sessions` insert change is backward compatible).

- [ ] **Step 11: Commit**

```bash
git add packages/shared/src/api.ts packages/server/migrations/005_admin_tokens.sql packages/server/src/persistence/database.ts packages/server/src/persistence/repository.ts packages/server/test/adminRepository.test.ts
git commit -m "feat(server): store raw seat tokens and add admin repository queries"
```

---

### Task 3: Admin API routes

**Files:**
- Modify: `packages/server/src/api/routes.ts` (auth guard + routes + `adminPassword` param)
- Modify: `packages/server/src/app.ts` (pass `config.adminPassword`)
- Test: `packages/server/test/adminApi.test.ts`

**Interfaces:**
- Consumes: `GameRepository.listGamesForAdmin()`, `GameRepository.deleteGame()`; `bearerToken` from `../sessions/tokens.js`; shared `AdminGamesResponse`.
- Produces: `GET /api/admin/games` → `{ games: AdminGameSummary[] }`; `DELETE /api/admin/games/:gameId` → 204/404. Guard returns 503 `adminDisabled` when no password configured, 401 `invalidAdmin` on missing/wrong bearer.
- Signature change: `registerApiRoutes(app, repository, mapLibrary, terrainStore, terrainService, adminPassword?: string)` — new LAST param is OPTIONAL so the two existing direct callers (`mapsApi.test.ts`, `terrainApi.test.ts`) keep compiling.

- [ ] **Step 1: Write the failing API tests**

Create `packages/server/test/adminApi.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import type { ServerConfig } from "../src/config.js";

function testConfig(adminPassword?: string): ServerConfig {
  return {
    nodeEnv: "test",
    host: "127.0.0.1",
    port: 0,
    webOrigin: "http://localhost:18081",
    sqlitePath: ":memory:",
    sessionSecret: "test-session-secret",
    logLevel: "silent",
    adminPassword
  };
}

async function createGame(app: Awaited<ReturnType<typeof buildApp>>) {
  const res = await app.inject({
    method: "POST",
    url: "/api/games",
    payload: { mode: "hotseat", seed: "seed" }
  });
  return res.json() as { gameId: string; seats: { seat: string; token: string }[] };
}

describe("admin API", () => {
  it("rejects a missing password with 401", async () => {
    const app = buildApp(testConfig("secret"));
    const res = await app.inject({ method: "GET", url: "/api/admin/games" });
    expect(res.statusCode).toBe(401);
    expect(res.json().error.code).toBe("invalidAdmin");
  });

  it("rejects a wrong password with 401", async () => {
    const app = buildApp(testConfig("secret"));
    const res = await app.inject({
      method: "GET",
      url: "/api/admin/games",
      headers: { authorization: "Bearer nope" }
    });
    expect(res.statusCode).toBe(401);
  });

  it("returns 503 when admin is not configured", async () => {
    const app = buildApp(testConfig(undefined));
    const res = await app.inject({
      method: "GET",
      url: "/api/admin/games",
      headers: { authorization: "Bearer anything" }
    });
    expect(res.statusCode).toBe(503);
    expect(res.json().error.code).toBe("adminDisabled");
  });

  it("lists games with recoverable tokens for the right password", async () => {
    const app = buildApp(testConfig("secret"));
    const created = await createGame(app);

    const res = await app.inject({
      method: "GET",
      url: "/api/admin/games",
      headers: { authorization: "Bearer secret" }
    });
    expect(res.statusCode).toBe(200);
    const { games } = res.json();
    expect(games).toHaveLength(1);
    expect(games[0].id).toBe(created.gameId);
    const redSeat = games[0].seats.find((s: { seat: string }) => s.seat === "red");
    const redToken = created.seats.find((s) => s.seat === "red")!.token;
    expect(redSeat.token).toBe(redToken);
  });

  it("deletes a game and 404s on a second delete", async () => {
    const app = buildApp(testConfig("secret"));
    const created = await createGame(app);

    const del = await app.inject({
      method: "DELETE",
      url: `/api/admin/games/${created.gameId}`,
      headers: { authorization: "Bearer secret" }
    });
    expect(del.statusCode).toBe(204);

    const list = await app.inject({
      method: "GET",
      url: "/api/admin/games",
      headers: { authorization: "Bearer secret" }
    });
    expect(list.json().games).toHaveLength(0);

    const again = await app.inject({
      method: "DELETE",
      url: `/api/admin/games/${created.gameId}`,
      headers: { authorization: "Bearer secret" }
    });
    expect(again.statusCode).toBe(404);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `corepack pnpm --filter @sengoku-jidai/server test adminApi`
Expected: FAIL — routes 404 (not registered) and `ServerConfig` has no `adminPassword` accepted by `buildApp` wiring yet.

- [ ] **Step 3: Add the `adminPassword` param and admin routes**

In `packages/server/src/api/routes.ts`, extend the `registerApiRoutes` signature (add the new optional last parameter):

```ts
export function registerApiRoutes(
  app: FastifyInstance,
  repository: GameRepository,
  mapLibrary: MapLibrary,
  terrainStore: TerrainStore,
  terrainService: TerrainService,
  adminPassword?: string
): void {
```

Add the admin routes just before the closing `}` of `registerApiRoutes` (after the `/api/games/:gameId/events` handler):

```ts
  app.get("/api/admin/games", async (request, reply) => {
    if (!requireAdmin(request, reply, adminPassword)) {
      return reply;
    }
    return reply.send({ games: repository.listGamesForAdmin() });
  });

  app.delete("/api/admin/games/:gameId", async (request, reply) => {
    if (!requireAdmin(request, reply, adminPassword)) {
      return reply;
    }
    const params = gameParamsSchema.safeParse(request.params);
    if (!params.success) {
      return sendError(reply, 400, "invalidRequest", "Game id is invalid.");
    }
    if (!repository.deleteGame(params.data.gameId)) {
      return sendError(reply, 404, "gameNotFound", "Game was not found.");
    }
    return reply.status(204).send();
  });
```

Add the guard helper next to the existing `authenticate` helper at the bottom of the file:

```ts
function requireAdmin(
  request: FastifyRequest,
  reply: FastifyReply,
  adminPassword: string | undefined
): boolean {
  if (!adminPassword) {
    sendError(reply, 503, "adminDisabled", "Admin API is not configured.");
    return false;
  }
  const token = bearerToken(request.headers.authorization);
  if (!token || token !== adminPassword) {
    sendError(reply, 401, "invalidAdmin", "Admin password is invalid.");
    return false;
  }
  return true;
}
```

- [ ] **Step 4: Pass the password from `buildApp`**

In `packages/server/src/app.ts`, update the `registerApiRoutes` call:

```ts
  registerApiRoutes(app, repository, mapLibrary, terrainStore, terrainService, config.adminPassword);
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `corepack pnpm --filter @sengoku-jidai/server test adminApi`
Expected: PASS (all five cases).

- [ ] **Step 6: Run the full server suite**

Run: `corepack pnpm --filter @sengoku-jidai/server test`
Expected: PASS (the optional param leaves `mapsApi.test.ts`/`terrainApi.test.ts` direct callers compiling and green).

- [ ] **Step 7: Commit**

```bash
git add packages/server/src/api/routes.ts packages/server/src/app.ts packages/server/test/adminApi.test.ts
git commit -m "feat(server): password-gated admin games list and delete routes"
```

---

### Task 4: Web route — `/admin`

**Files:**
- Modify: `packages/web/src/state/route.ts` (`Route` union + `parseRoute`)
- Test: `packages/web/src/state/route.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `Route` gains the variant `{ kind: "admin" }`; `parseRoute` returns it for `/admin` and `/admin/`.

- [ ] **Step 1: Write the failing tests**

Add to `packages/web/src/state/route.test.ts` inside the `describe("parseRoute", ...)` block:

```ts
  it("parses the admin route", () => {
    expect(parseRoute({ pathname: "/admin", hash: "", search: "" })).toEqual({ kind: "admin" });
  });

  it("tolerates a trailing slash on the admin route", () => {
    expect(parseRoute({ pathname: "/admin/", hash: "", search: "" })).toEqual({ kind: "admin" });
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `corepack pnpm --filter @sengoku-jidai/web test route`
Expected: FAIL — `/admin` currently falls through to `{ kind: "create", map: null }`.

- [ ] **Step 3: Add the route variant and matcher**

In `packages/web/src/state/route.ts`, add to the `Route` union:

```ts
export type Route =
  | { kind: "create"; map: string | null }
  | { kind: "game"; gameId: string; token: string }
  | { kind: "maps" }
  | { kind: "editor"; mapId: string | null }
  | { kind: "admin" };
```

Add the path constant next to the others:

```ts
const ADMIN_PATH = /^\/admin\/?$/;
```

In `parseRoute`, add this check before the `MAPS_PATH` check:

```ts
  if (ADMIN_PATH.test(loc.pathname)) {
    return { kind: "admin" };
  }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `corepack pnpm --filter @sengoku-jidai/web test route`
Expected: PASS (both new cases plus existing route tests).

- [ ] **Step 5: Commit**

```bash
git add packages/web/src/state/route.ts packages/web/src/state/route.test.ts
git commit -m "feat(web): add /admin route parsing"
```

---

### Task 5: Web admin client

**Files:**
- Create: `packages/web/src/client/admin.ts`
- Test: `packages/web/src/client/admin.test.ts`

**Interfaces:**
- Consumes: `ApiError` (exported from `./api.js`); shared `AdminGamesResponse`.
- Produces:
  - `fetchAdminGames(password: string): Promise<AdminGamesResponse>`
  - `deleteAdminGame(password: string, gameId: string): Promise<void>`
  Both send `Authorization: Bearer <password>`; a non-2xx response throws `ApiError`.

- [ ] **Step 1: Write the failing tests**

Create `packages/web/src/client/admin.test.ts`:

```ts
import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchAdminGames, deleteAdminGame } from "./admin.js";
import { ApiError } from "./api.js";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("fetchAdminGames", () => {
  it("GETs the admin list with a bearer password", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ games: [] })
    }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await fetchAdminGames("secret");
    expect(result).toEqual({ games: [] });

    const [url, init] = fetchMock.mock.calls[0]! as unknown as [string, RequestInit];
    expect(url).toBe("/api/admin/games");
    expect(new Headers(init.headers).get("authorization")).toBe("Bearer secret");
  });

  it("throws ApiError on a 401", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: false,
      status: 401,
      json: async () => ({ error: { code: "invalidAdmin", message: "bad" } })
    }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(fetchAdminGames("wrong")).rejects.toBeInstanceOf(ApiError);
  });
});

describe("deleteAdminGame", () => {
  it("DELETEs the game with a bearer password", async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, status: 204, json: async () => ({}) }));
    vi.stubGlobal("fetch", fetchMock);

    await deleteAdminGame("secret", "g1");

    const [url, init] = fetchMock.mock.calls[0]! as unknown as [string, RequestInit];
    expect(url).toBe("/api/admin/games/g1");
    expect(init.method).toBe("DELETE");
    expect(new Headers(init.headers).get("authorization")).toBe("Bearer secret");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `corepack pnpm --filter @sengoku-jidai/web test admin`
Expected: FAIL — `./admin.js` does not exist.

- [ ] **Step 3: Implement the admin client**

Create `packages/web/src/client/admin.ts`:

```ts
import type { AdminGamesResponse } from "@sengoku-jidai/shared";
import { ApiError } from "./api.js";

async function adminRequest<T>(
  url: string,
  password: string,
  init: RequestInit = {}
): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set("authorization", `Bearer ${password}`);

  const response = await fetch(url, { ...init, headers });
  if (response.status === 204) {
    return undefined as T;
  }
  const body = (await response.json()) as T;
  if (!response.ok) {
    throw new ApiError(response.status, body);
  }
  return body;
}

export async function fetchAdminGames(password: string): Promise<AdminGamesResponse> {
  return adminRequest("/api/admin/games", password);
}

export async function deleteAdminGame(password: string, gameId: string): Promise<void> {
  await adminRequest(`/api/admin/games/${encodeURIComponent(gameId)}`, password, {
    method: "DELETE"
  });
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `corepack pnpm --filter @sengoku-jidai/web test admin`
Expected: PASS (all three cases).

- [ ] **Step 5: Commit**

```bash
git add packages/web/src/client/admin.ts packages/web/src/client/admin.test.ts
git commit -m "feat(web): admin API client"
```

---

### Task 6: AdminScreen component, App wiring, styles, deploy doc

**Files:**
- Create: `packages/web/src/components/AdminScreen.tsx`
- Modify: `packages/web/src/App.tsx` (import + route branch)
- Modify: `packages/web/src/styles/app.css` (admin styles)
- Modify: `deploy/dockge/compose.yml` (document `ADMIN_PASSWORD`)
- Test: none (React components are not unit-rendered in this repo — no testing-library). Verified by typecheck + running the app.

**Interfaces:**
- Consumes: `fetchAdminGames`, `deleteAdminGame` (Task 5); `apiErrorMessage` from `../client/api.js`; `inviteUrl`, `navigateTo` from `../state/route.js`; shared `AdminGameSummary`, `AdminSeatSummary`.
- Produces: `AdminScreen` React component (default-free named export `export function AdminScreen()`), rendered by `App` when `route.kind === "admin"`.

- [ ] **Step 1: Implement `AdminScreen`**

Create `packages/web/src/components/AdminScreen.tsx`. It mirrors `MapLibraryScreen` conventions (CSS classes `app-shell`, `app-empty`, `start-panel`, `error-text`, `muted`, `primary-action`, `secondary-action`). The password is held in `sessionStorage` under `sengoku.adminPassword`; a 401 clears it and re-shows the prompt.

```tsx
import { useEffect, useState } from "react";
import type { AdminGameSummary, AdminSeatSummary } from "@sengoku-jidai/shared";
import { apiErrorMessage, ApiError } from "../client/api.js";
import { deleteAdminGame, fetchAdminGames } from "../client/admin.js";
import { inviteUrl, navigateTo } from "../state/route.js";

const PASSWORD_KEY = "sengoku.adminPassword";

export function AdminScreen() {
  const [password, setPassword] = useState<string | null>(
    () => sessionStorage.getItem(PASSWORD_KEY)
  );
  const [passwordInput, setPasswordInput] = useState("");
  const [games, setGames] = useState<AdminGameSummary[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  async function load(pw: string) {
    setLoadError(null);
    try {
      const response = await fetchAdminGames(pw);
      setGames(response.games);
    } catch (caught) {
      if (caught instanceof ApiError && caught.status === 401) {
        sessionStorage.removeItem(PASSWORD_KEY);
        setPassword(null);
        setGames(null);
        setLoadError("That password was not accepted.");
        return;
      }
      setLoadError(apiErrorMessage(caught));
    }
  }

  useEffect(() => {
    if (password !== null) {
      void load(password);
    }
  }, [password]);

  function handleLogin(event: React.FormEvent) {
    event.preventDefault();
    const pw = passwordInput.trim();
    if (pw.length === 0) {
      return;
    }
    sessionStorage.setItem(PASSWORD_KEY, pw);
    setPasswordInput("");
    setLoadError(null);
    setPassword(pw);
  }

  async function handleDelete(game: AdminGameSummary) {
    if (password === null) {
      return;
    }
    if (!window.confirm(`Delete game ${game.id}? This permanently removes it and cannot be undone.`)) {
      return;
    }
    setActionError(null);
    try {
      await deleteAdminGame(password, game.id);
      await load(password);
    } catch (caught) {
      setActionError(apiErrorMessage(caught));
    }
  }

  async function handleCopy(seat: AdminSeatSummary, gameId: string) {
    if (seat.token === null) {
      return;
    }
    const link = inviteUrl(window.location.origin, gameId, seat.token);
    try {
      await navigator.clipboard.writeText(link);
      setCopied(`${gameId}:${seat.seat}`);
      window.setTimeout(() => setCopied(null), 1500);
    } catch {
      window.prompt("Copy this invite link:", link);
    }
  }

  if (password === null) {
    return (
      <main className="app-shell app-empty">
        <section className="start-panel" aria-label="Admin login">
          <h1>Admin</h1>
          {loadError ? <p className="error-text">{loadError}</p> : null}
          <form onSubmit={handleLogin}>
            <input
              type="password"
              value={passwordInput}
              onChange={(event) => setPasswordInput(event.target.value)}
              placeholder="Admin password"
              aria-label="Admin password"
              autoFocus
            />
            <button type="submit" className="primary-action">
              Sign in
            </button>
          </form>
          <button type="button" className="secondary-action" onClick={() => navigateTo("/")}>
            Back to game
          </button>
        </section>
      </main>
    );
  }

  return (
    <main className="app-shell app-empty">
      <section className="start-panel admin-panel" aria-label="Admin">
        <header className="admin-header">
          <h1>Games</h1>
          <button type="button" className="secondary-action" onClick={() => void load(password)}>
            Refresh
          </button>
          <button type="button" className="secondary-action" onClick={() => navigateTo("/")}>
            Back to game
          </button>
        </header>
        {actionError ? <p className="error-text">{actionError}</p> : null}
        {loadError ? (
          <p className="error-text">{loadError}</p>
        ) : games === null ? (
          <p className="muted">Loading games…</p>
        ) : games.length === 0 ? (
          <p className="muted">No games.</p>
        ) : (
          <ul className="admin-list">
            {games.map((game) => (
              <li key={game.id} className="admin-row">
                <div className="admin-row-head">
                  <strong>{game.id}</strong>
                  <span className="muted">
                    {game.mode} · {game.status} · rev {game.revision}
                  </span>
                  <button
                    type="button"
                    className="secondary-action"
                    onClick={() => void handleDelete(game)}
                  >
                    Delete
                  </button>
                </div>
                <div className="muted admin-row-meta">
                  created {game.createdAt} · updated {game.updatedAt}
                </div>
                <ul className="admin-seats">
                  {game.seats.map((seat) => (
                    <li key={seat.seat} className="admin-seat">
                      <span>
                        {seat.seat}: {seat.name ?? "—"} ({seat.status})
                      </span>
                      {seat.token === null ? (
                        <span className="muted">link unavailable</span>
                      ) : (
                        <button
                          type="button"
                          className="secondary-action"
                          onClick={() => void handleCopy(seat, game.id)}
                        >
                          {copied === `${game.id}:${seat.seat}` ? "Copied!" : "Copy invite link"}
                        </button>
                      )}
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
```

- [ ] **Step 2: Verify `ApiError` is exported from the client**

Run: `grep -n "export class ApiError" packages/web/src/client/api.ts`
Expected: one match (the import in Step 1 resolves). It is already exported.

- [ ] **Step 3: Wire the route in `App.tsx`**

Add the import near the other screen imports (around the `MapLibraryScreen` import):

```ts
import { AdminScreen } from "./components/AdminScreen.js";
```

Add the branch alongside the other early-return route branches (next to `if (route.kind === "maps")`):

```ts
  if (route.kind === "admin") {
    return <AdminScreen />;
  }
```

- [ ] **Step 4: Add styles**

Append to `packages/web/src/styles/app.css`:

```css
.admin-panel {
  max-width: 720px;
  width: 100%;
}

.admin-header {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.admin-header h1 {
  margin-right: auto;
}

.admin-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}

.admin-row {
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 6px;
  padding: 0.75rem;
}

.admin-row-head {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  flex-wrap: wrap;
}

.admin-row-head strong {
  font-family: monospace;
}

.admin-row-head .secondary-action {
  margin-left: auto;
}

.admin-row-meta {
  font-size: 0.85em;
  margin: 0.25rem 0;
}

.admin-seats {
  list-style: none;
  margin: 0.5rem 0 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
}

.admin-seat {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  justify-content: space-between;
}
```

- [ ] **Step 5: Typecheck the web package**

Run: `corepack pnpm --filter @sengoku-jidai/web typecheck`
Expected: PASS (no type errors — the shared admin types resolve because `shared` was rebuilt in Task 2).

- [ ] **Step 6: Document the env var in the deploy compose**

In `deploy/dockge/compose.yml`, add under `environment:` (after `LOG_LEVEL: info`):

```yaml
      # Set to enable the /admin panel (list, invite links, delete games).
      # Leave unset to keep admin disabled. Only send over HTTPS.
      # ADMIN_PASSWORD: change-me
```

- [ ] **Step 7: Commit**

```bash
git add packages/web/src/components/AdminScreen.tsx packages/web/src/App.tsx packages/web/src/styles/app.css deploy/dockge/compose.yml
git commit -m "feat(web): admin panel screen, route wiring, and deploy docs"
```

---

### Task 7: Full gate

**Files:** none (verification only).

- [ ] **Step 1: Build libs, typecheck, lint, test across the workspace**

Run: `corepack pnpm build:libs && corepack pnpm typecheck && corepack pnpm lint && corepack pnpm test`
Expected: PASS — all packages typecheck, lint clean, all unit tests green.

- [ ] **Step 2: Manual smoke (optional, per no-local-browser-verification memory)**

Start the server with `ADMIN_PASSWORD=secret`, create a game, visit `/admin`, sign in, confirm the game lists with a working **Copy invite link**, then delete it and confirm it disappears. (Follow the local e2e recipe's temp-port/cacheDir precautions — never touch the live prod container on 18081.)

- [ ] **Step 3: Commit (only if the gate required fixups)**

```bash
git add -A
git commit -m "chore: admin panel gate fixups"
```

---

## Self-Review

**Spec coverage:**
- Password-gated auth, direct compare → Task 1 (config) + Task 3 (`requireAdmin`). ✓
- Store raw tokens going forward; old games "link unavailable" → Task 2 (migration + createGame insert + nullable token in list) + Task 6 (renders "link unavailable" when `token === null`). ✓
- Hard delete with cascade → Task 2 (`deleteGame`) + Task 3 (route) + Task 2 test asserts snapshot cascade. ✓
- List all games (ongoing + finished), metadata, seats → Task 2 `listGamesForAdmin` + Task 6 render. ✓
- Invite links via existing `inviteUrl` → Task 6 `handleCopy`. ✓
- `/admin` route, password form, sessionStorage, 401 handling → Task 4 + Task 6. ✓
- Shared API contract types → Task 2. ✓
- Tests: adminApi (401/503/list/delete/404), config, route, admin client → Tasks 1, 3, 4, 5. ✓
- Deploy `ADMIN_PASSWORD` doc → Task 6. ✓
- 503 adminDisabled, 401 re-prompt, delete 404, network errors → Task 3 (server) + Task 6 (client UX). ✓

**Placeholder scan:** No TBD/TODO; every code step shows full code and exact commands. ✓

**Type consistency:** `AdminGameSummary`/`AdminSeatSummary`/`AdminGamesResponse` defined in Task 2 and used identically in Tasks 3, 5, 6. `listGamesForAdmin`/`deleteGame` names match across repository (Task 2) and routes (Task 3). `fetchAdminGames`/`deleteAdminGame` signatures match across client (Task 5) and component (Task 6). `requireAdmin(request, reply, adminPassword)` consistent. `registerApiRoutes` new optional last param consistent with `app.ts` call and existing test callers. ✓
