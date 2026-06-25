# Online Multiplayer — Backend (Phase 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add named seats and a seat-claim flow to the server so a creator can name themselves, pick a side, and hand the other seat's link to an opponent who names themselves on join.

**Architecture:** Build additively on the existing per-seat bearer-token model. `createGame` gains an optional creator name + side: the creator's seat becomes `claimed` with that name, the other seat becomes `open`. A new `POST /api/games/:id/claim` lets the holder of the open seat's token set its name. Seat names/status travel in the API envelope (read from `game_seats`), never inside the engine view. No new tables, no migration.

**Tech Stack:** TypeScript, Fastify 5, better-sqlite3, zod, vitest (`app.inject` for HTTP tests).

## Global Constraints

- Node `>=22`; package manager `pnpm@9.15.2` (invoke via `corepack pnpm` or `pnpm`).
- `@sengoku-jidai/shared` and `@sengoku-jidai/engine` are consumed by the server as **built output** — after editing `shared`, rebuild it (`pnpm --filter @sengoku-jidai/shared build`) before the server typechecks/tests see the change. Running `pnpm test` / `pnpm typecheck` from the repo root builds libs first.
- Backward compatibility: the existing web client and the current server test must keep working. New request fields are optional; new response fields are additive.
- TDD: write the failing test first, watch it fail, implement minimally, watch it pass, commit.
- Commit messages end with a trailer line: `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.
- Work on a branch off fresh `main` (e.g. `feat/online-mp-backend`); ship as one PR through the full gate (`pnpm typecheck`, `pnpm test`, `pnpm build`, `pnpm lint`, `pnpm exec prettier --check .`) + CI watch; ask before merging.
- Run all commands from the repo root `/mnt/ssd_pool/martin/repos/sengoku_jidai` (bash cwd persists between calls).

---

## File Structure

- `packages/shared/src/schemas.ts` — add creator `name`/`side` to the create-game request; add the claim request schema.
- `packages/shared/src/api.ts` — add `SeatStatus`, `GameSeatInfo`, and `seatInfo` on the view envelope.
- `packages/shared/test/schemas.test.ts` — **create**; parse tests for the new/changed schemas.
- `packages/server/src/persistence/repository.ts` — `getSeatInfo`; thread `seatInfo` through `getPlayerView` and `CreatedGame`; creator name/side + open seat in `createGame`; new `claimSeat`.
- `packages/server/test/repository.test.ts` — **create**; repository-level unit tests against an in-memory DB.
- `packages/server/src/api/routes.ts` — pass name/side on `POST /api/games`; include `seatInfo` on `GET /api/games/:id`; replace the `/join` 501 stub with `/api/games/:id/claim`.
- `packages/server/test/server.test.ts` — extend with create-with-name and claim HTTP tests.

---

## Task 1: Shared schemas & types

**Files:**
- Modify: `packages/shared/src/schemas.ts`
- Modify: `packages/shared/src/api.ts`
- Test: `packages/shared/test/schemas.test.ts` (create)

**Interfaces:**
- Produces:
  - `createGameRequestSchema` now also parses `name?: string` (trimmed, 1–80) and `side?: "red"|"black"`.
  - `claimGameRequestSchema = z.object({ name: string(1–80) })`; type `ClaimGameRequest`.
  - `type SeatStatus = "open" | "claimed"`.
  - `interface GameSeatInfo { seat: SeatId; name: string | null; status: SeatStatus }`.
  - `PlayerGameViewEnvelope` gains `seatInfo: GameSeatInfo[]`.

- [ ] **Step 1: Write the failing test**

Create `packages/shared/test/schemas.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { claimGameRequestSchema, createGameRequestSchema } from "../src/schemas.js";

describe("createGameRequestSchema", () => {
  it("accepts an optional creator name and side", () => {
    const parsed = createGameRequestSchema.parse({ name: "  Kenshin  ", side: "black" });
    expect(parsed.name).toBe("Kenshin");
    expect(parsed.side).toBe("black");
  });

  it("still accepts a bare hotseat request (backward compatible)", () => {
    const parsed = createGameRequestSchema.parse({ mode: "hotseat" });
    expect(parsed.mode).toBe("hotseat");
    expect(parsed.name).toBeUndefined();
  });
});

describe("claimGameRequestSchema", () => {
  it("requires a 1–80 char name", () => {
    expect(claimGameRequestSchema.parse({ name: "Nobunaga" }).name).toBe("Nobunaga");
    expect(claimGameRequestSchema.safeParse({ name: "" }).success).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @sengoku-jidai/shared test`
Expected: FAIL — `claimGameRequestSchema` is not exported / `name` not parsed.

- [ ] **Step 3: Add the schema fields**

In `packages/shared/src/schemas.ts`, replace the `createGameRequestSchema` block and add the claim schema:

```ts
export const createGameRequestSchema = z.object({
  mode: gameModeSchema.default("hotseat"),
  seed: z.string().optional(),
  name: z.string().trim().min(1).max(80).optional(),
  side: seatIdSchema.optional()
});

export const claimGameRequestSchema = z.object({
  name: z.string().trim().min(1).max(80)
});
```

Add to the exported types near the bottom of the file:

```ts
export type ClaimGameRequest = z.infer<typeof claimGameRequestSchema>;
```

- [ ] **Step 4: Add the response types**

In `packages/shared/src/api.ts`, add `SeatStatus` + `GameSeatInfo` and extend the envelope:

```ts
export type SeatStatus = "open" | "claimed";

export interface GameSeatInfo {
  seat: SeatId;
  name: string | null;
  status: SeatStatus;
}

export interface PlayerGameViewEnvelope<View = unknown> {
  gameId: string;
  seat: SeatId;
  revision: number;
  view: View;
  seatInfo: GameSeatInfo[];
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm --filter @sengoku-jidai/shared test`
Expected: PASS (3 tests).

- [ ] **Step 6: Rebuild shared so dependents see the change**

Run: `pnpm --filter @sengoku-jidai/shared build`
Expected: `Done` with no type errors.

- [ ] **Step 7: Commit**

```bash
git add packages/shared/src/schemas.ts packages/shared/src/api.ts packages/shared/test/schemas.test.ts
git commit -m "feat(shared): creator name/side, claim request, seatInfo envelope

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 2: Repository — seat info, named create, claim

**Files:**
- Modify: `packages/server/src/persistence/repository.ts`
- Test: `packages/server/test/repository.test.ts` (create)

**Interfaces:**
- Consumes: `GameSeatInfo`, `SeatStatus` from `@sengoku-jidai/shared`; `openDatabase`, `runMigrations` from `../src/persistence/database.js`.
- Produces:
  - `CreatedGame` gains `seatInfo: GameSeatInfo[]`.
  - `createGame(mode: GameMode, seed?: string, opts?: { creatorName?: string; creatorSide?: SeatId }): CreatedGame` — when `creatorName` is given, the `creatorSide` seat (default `"red"`) is `claimed` with that name and the other seat is `open` (name `null`); both seat tokens are still returned. With no `creatorName`, behaviour is unchanged (both seats `claimed`, named after the seat).
  - `getSeatInfo(gameId: string): GameSeatInfo[]`.
  - `getPlayerView(...)` return gains `seatInfo: GameSeatInfo[]`.
  - `claimSeat(gameId: string, seat: SeatId, name: string): { revision: number; view: PlayerGameView; seatInfo: GameSeatInfo[] } | null` — sets the seat's name + `status='claimed'` only if it is currently `open`; returns the current view either way; `null` if the game is missing.

- [ ] **Step 1: Write the failing test**

Create `packages/server/test/repository.test.ts`:

```ts
import type { GameSeatInfo } from "@sengoku-jidai/shared";
import { describe, expect, it } from "vitest";
import { openDatabase, runMigrations } from "../src/persistence/database.js";
import { GameRepository } from "../src/persistence/repository.js";

function makeRepo(): GameRepository {
  const db = openDatabase(":memory:");
  runMigrations(db);
  return new GameRepository(db);
}

function bySeat(info: GameSeatInfo[], seat: "red" | "black"): GameSeatInfo {
  return info.find((s) => s.seat === seat)!;
}

describe("GameRepository named seats", () => {
  it("creates a named game with the chosen side claimed and the other open", () => {
    const repo = makeRepo();
    const game = repo.createGame("private_multiplayer", "seed-1", {
      creatorName: "Kenshin",
      creatorSide: "black"
    });

    expect(game.seat).toBe("black");
    expect(game.seats).toHaveLength(2); // both seat tokens returned
    expect(bySeat(game.seatInfo, "black")).toMatchObject({ name: "Kenshin", status: "claimed" });
    expect(bySeat(game.seatInfo, "red")).toMatchObject({ name: null, status: "open" });
  });

  it("defaults the creator to red and keeps legacy (unnamed) creation fully claimed", () => {
    const repo = makeRepo();
    const named = repo.createGame("private_multiplayer", "s2", { creatorName: "Oda" });
    expect(named.seat).toBe("red");
    expect(bySeat(named.seatInfo, "red")).toMatchObject({ name: "Oda", status: "claimed" });
    expect(bySeat(named.seatInfo, "black").status).toBe("open");

    const legacy = repo.createGame("hotseat", "s3");
    expect(bySeat(legacy.seatInfo, "red").status).toBe("claimed");
    expect(bySeat(legacy.seatInfo, "black").status).toBe("claimed");
  });

  it("claims the open seat by setting its name", () => {
    const repo = makeRepo();
    const game = repo.createGame("private_multiplayer", "s4", { creatorName: "Oda" });

    const claimed = repo.claimSeat(game.gameId, "black", "Takeda");
    expect(claimed).not.toBeNull();
    expect(bySeat(claimed!.seatInfo, "black")).toMatchObject({ name: "Takeda", status: "claimed" });

    // Re-claim on an already-claimed seat is a no-op on the name.
    const again = repo.claimSeat(game.gameId, "black", "Someone Else");
    expect(bySeat(again!.seatInfo, "black").name).toBe("Takeda");
  });

  it("returns null when claiming a seat in a missing game", () => {
    const repo = makeRepo();
    expect(repo.claimSeat("no-such-game", "red", "Ghost")).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @sengoku-jidai/server test`
Expected: FAIL — `createGame` rejects the 3rd arg / `seatInfo` and `claimSeat` are undefined.

- [ ] **Step 3: Add imports and `getSeatInfo`**

In `packages/server/src/persistence/repository.ts`, extend the engine/shared imports and add `GameSeatInfo`:

```ts
import type { GameSeatInfo, SeatStatus } from "@sengoku-jidai/shared";
```

Add a row interface near the other `*Row` interfaces:

```ts
interface SeatInfoRow {
  seat: SeatId;
  display_name: string | null;
  status: SeatStatus;
}
```

Add this public method to the `GameRepository` class:

```ts
getSeatInfo(gameId: string): GameSeatInfo[] {
  const rows = this.db
    .prepare("SELECT seat, display_name, status FROM game_seats WHERE game_id = ? ORDER BY seat")
    .all(gameId) as SeatInfoRow[];
  return rows.map((r) => ({ seat: r.seat, name: r.display_name, status: r.status }));
}
```

- [ ] **Step 4: Add `seatInfo` to `CreatedGame` and `getPlayerView`**

Extend the `CreatedGame` interface:

```ts
export interface CreatedGame {
  gameId: string;
  seat: SeatId;
  revision: number;
  view: PlayerGameView;
  seats: SeatTokenRecord[];
  seatInfo: GameSeatInfo[];
}
```

Change `getPlayerView` to return seat info:

```ts
getPlayerView(
  gameId: string,
  seat: SeatId
): { revision: number; view: PlayerGameView; seatInfo: GameSeatInfo[] } | null {
  const game = this.getGameRow(gameId);
  if (!game) {
    return null;
  }
  const state = this.loadSnapshot(gameId, game.current_revision);
  return {
    revision: game.current_revision,
    view: playerView(state, seat),
    seatInfo: this.getSeatInfo(gameId)
  };
}
```

- [ ] **Step 5: Teach `createGame` the creator name + side**

Replace the `createGame` signature line and its seat-insert loop + return. New signature:

```ts
createGame(
  mode: GameMode,
  seed?: string,
  opts: { creatorName?: string; creatorSide?: SeatId } = {}
): CreatedGame {
  const gameId = randomUUID();
  const now = new Date().toISOString();
  const state = createInitialState({ gameId, mode, seed: seed ?? randomUUID() });
  const creatorSide: SeatId = opts.creatorSide ?? "red";
  const named = opts.creatorName !== undefined;
  const seatTokens: SeatTokenRecord[] = [];
```

Inside the existing `this.db.transaction(() => { ... })`, keep the `games` INSERT unchanged, then replace the `for (const seat of ["red", "black"] as const)` body with:

```ts
      for (const seat of ["red", "black"] as const) {
        const isCreator = seat === creatorSide;
        const status: SeatStatus = !named || isCreator ? "claimed" : "open";
        const displayName = !named ? seat : isCreator ? opts.creatorName! : null;
        const claimedAt = status === "claimed" ? now : null;
        this.db
          .prepare(
            `INSERT INTO game_seats
              (game_id, seat, player_id, status, display_name, claimed_at, last_seen_at)
             VALUES (?, ?, ?, ?, ?, ?, ?)`
          )
          .run(gameId, seat, seat, status, displayName, claimedAt, now);

        const token = issueToken();
        seatTokens.push({ seat, token: token.token });
        this.db
          .prepare(
            `INSERT INTO game_sessions
              (id, token_hash, game_id, seat, created_at, last_seen_at, revoked_at)
             VALUES (?, ?, ?, ?, ?, ?, NULL)`
          )
          .run(token.id, token.tokenHash, gameId, seat, now, now);
      }
```

Replace the `return { ... }` at the end of `createGame` with:

```ts
    return {
      gameId,
      seat: creatorSide,
      revision: state.revision,
      view: playerView(state, creatorSide),
      seats: seatTokens,
      seatInfo: this.getSeatInfo(gameId)
    };
```

(`this.getSeatInfo` runs after `create()` has committed, so the rows are present.)

- [ ] **Step 6: Add `claimSeat`**

Add this public method to the class:

```ts
claimSeat(
  gameId: string,
  seat: SeatId,
  name: string
): { revision: number; view: PlayerGameView; seatInfo: GameSeatInfo[] } | null {
  const game = this.getGameRow(gameId);
  if (!game) {
    return null;
  }
  const row = this.db
    .prepare("SELECT status FROM game_seats WHERE game_id = ? AND seat = ?")
    .get(gameId, seat) as { status: SeatStatus } | undefined;
  if (!row) {
    return null;
  }
  if (row.status === "open") {
    this.db
      .prepare(
        "UPDATE game_seats SET display_name = ?, status = 'claimed', claimed_at = ? WHERE game_id = ? AND seat = ?"
      )
      .run(name, new Date().toISOString(), gameId, seat);
  }
  const state = this.loadSnapshot(gameId, game.current_revision);
  return {
    revision: game.current_revision,
    view: playerView(state, seat),
    seatInfo: this.getSeatInfo(gameId)
  };
}
```

- [ ] **Step 7: Run tests to verify they pass**

Run: `pnpm --filter @sengoku-jidai/server test`
Expected: PASS — the new `repository.test.ts` (4 tests) and the existing `server.test.ts` (1 test).

- [ ] **Step 8: Commit**

```bash
git add packages/server/src/persistence/repository.ts packages/server/test/repository.test.ts
git commit -m "feat(server): named seats, open invite seat, and claimSeat in the repository

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 3: Routes — name/side on create, seatInfo on view, claim endpoint

**Files:**
- Modify: `packages/server/src/api/routes.ts`
- Test: `packages/server/test/server.test.ts`

**Interfaces:**
- Consumes: `repository.createGame(mode, seed, { creatorName, creatorSide })`, `repository.getPlayerView(...)` (now with `seatInfo`), `repository.claimSeat(gameId, seat, name)`; `claimGameRequestSchema` from `@sengoku-jidai/shared`.
- Produces:
  - `POST /api/games` forwards `name` → `creatorName` and `side` → `creatorSide`.
  - `GET /api/games/:gameId` response includes `seatInfo`.
  - `POST /api/games/:gameId/claim` (Bearer = the open seat's token, body `{ name }`) sets the seat name, returns `{ gameId, seat, revision, view, seatInfo }`. Replaces the `/join` 501 stub.

- [ ] **Step 1: Write the failing test**

Append to `packages/server/test/server.test.ts` (inside the existing `describe("server", ...)`):

```ts
  it("creates a named game with an open invite seat and lets it be claimed", async () => {
    const app = buildApp(testConfig());

    const created = await app.inject({
      method: "POST",
      url: "/api/games",
      payload: { mode: "private_multiplayer", seed: "named", name: "Oda", side: "red" }
    });
    expect(created.statusCode).toBe(200);
    const body = created.json();
    expect(body.seat).toBe("red");
    const red = body.seatInfo.find((s: { seat: string }) => s.seat === "red");
    const black = body.seatInfo.find((s: { seat: string }) => s.seat === "black");
    expect(red).toMatchObject({ name: "Oda", status: "claimed" });
    expect(black).toMatchObject({ name: null, status: "open" });

    const blackToken = body.seats.find((s: { seat: string }) => s.seat === "black").token;
    const claimed = await app.inject({
      method: "POST",
      url: `/api/games/${body.gameId}/claim`,
      headers: { authorization: `Bearer ${blackToken}` },
      payload: { name: "Takeda" }
    });
    expect(claimed.statusCode).toBe(200);
    const claimedBlack = claimed
      .json()
      .seatInfo.find((s: { seat: string }) => s.seat === "black");
    expect(claimedBlack).toMatchObject({ name: "Takeda", status: "claimed" });

    await app.close();
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @sengoku-jidai/server test`
Expected: FAIL — `/claim` returns 501 (or 404) and `seatInfo` is missing on the create response.

- [ ] **Step 3: Forward name/side on create + add seatInfo on view**

In `packages/server/src/api/routes.ts`, update the create handler body:

```ts
    const game = repository.createGame(parsed.data.mode, parsed.data.seed, {
      creatorName: parsed.data.name,
      creatorSide: parsed.data.side
    });
    return reply.send(game);
```

Update the `GET /api/games/:gameId` success response to include `seatInfo`:

```ts
    return reply.send({
      gameId: params.data.gameId,
      seat: session.seat,
      revision: view.revision,
      view: view.view,
      seatInfo: view.seatInfo
    });
```

- [ ] **Step 4: Replace the `/join` stub with `/claim`**

Change the shared import at the top of the file: drop `joinGameRequestSchema`, add `claimGameRequestSchema`:

```ts
import {
  claimGameRequestSchema,
  createGameRequestSchema,
  eventQuerySchema,
  gameParamsSchema,
  submitCommandRequestSchema
} from "@sengoku-jidai/shared";
```

Replace the entire `app.post("/api/games/:gameId/join", ...)` handler with:

```ts
  app.post("/api/games/:gameId/claim", async (request, reply) => {
    const params = gameParamsSchema.safeParse(request.params);
    const body = claimGameRequestSchema.safeParse(request.body ?? {});
    if (!params.success || !body.success) {
      return sendError(reply, 400, "invalidRequest", "Claim request is invalid.");
    }

    const session = authenticate(request, repository);
    if (!session) {
      return sendError(reply, 401, "invalidSession", "A valid seat token is required.");
    }
    if (session.gameId !== params.data.gameId) {
      return sendError(reply, 403, "forbidden", "That seat token does not belong to this game.");
    }

    const result = repository.claimSeat(params.data.gameId, session.seat, body.data.name);
    if (!result) {
      return sendError(reply, 404, "gameNotFound", "Game was not found.");
    }

    return reply.send({
      gameId: params.data.gameId,
      seat: session.seat,
      revision: result.revision,
      view: result.view,
      seatInfo: result.seatInfo
    });
  });
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm --filter @sengoku-jidai/server test`
Expected: PASS — both `server.test.ts` tests and `repository.test.ts`.

- [ ] **Step 6: Commit**

```bash
git add packages/server/src/api/routes.ts packages/server/test/server.test.ts
git commit -m "feat(server): name/side on create, seatInfo on view, claim endpoint

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Final Verification (whole gate)

- [ ] **Run the full gate from the repo root:**

```bash
pnpm exec prettier --write packages/shared packages/server   # then re-check below
pnpm typecheck
pnpm test
pnpm build
pnpm lint
pnpm exec prettier --check .
```
Expected: all green. (`pnpm typecheck`/`pnpm test` rebuild libs first, so `server` sees the updated `shared`.)

- [ ] **Open the PR, watch CI to green, ask before merging.** The Browser Smoke Test still passes because the existing web client and its no-name `createHotseatGame` path are untouched (new fields are optional/additive).

---

## Self-Review notes (already reconciled)

- **Spec coverage:** create-with-name + side (Task 2/3), open invite seat (Task 2), claim/set-name replacing `/join` (Task 2/3), seat names in the envelope (Tasks 1–3). The web routing/create/invite/polling UI and removing the two-token bootstrap are **Phase 2** (separate plan), not this plan.
- **Backward compatibility:** `name`/`side` optional; unnamed creation keeps both seats `claimed`; `seatInfo` is additive; existing tests untouched except additions.
- **Type consistency:** `GameSeatInfo`/`SeatStatus` defined once in `shared` and imported by `server`; `createGame(mode, seed, opts)`, `getSeatInfo`, `claimSeat`, and `getPlayerView`'s `seatInfo` names match across tasks.
