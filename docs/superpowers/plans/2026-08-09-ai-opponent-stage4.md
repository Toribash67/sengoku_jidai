# AI Opponent — Stage 4 (Server AI-Seat Wiring) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a game seat be AI-controlled so a human can play against the `@sengoku-jidai/ai` opponent through the real server, with AI moves driven automatically and surfaced via the existing event-polling mechanism.

**Architecture:** A seat is marked `controller = 'human' | 'ai'` (new `game_seats` column). After any accepted command — and right after game creation — the server runs an **auto-drive loop**: while the seat now on the clock is AI-controlled and the game is active, it calls `IsmctsBot.chooseCommand` and applies the result through the same authoritative persistence path a human command uses (new snapshot + events + revision bump). The human's HTTP request returns immediately; the AI's moves land as new events that the client's existing `GET /events` poll picks up. The bot is injected (a factory) so tests use a fast stub instead of the ~1.5 s ISMCTS.

**Tech Stack:** TypeScript (ESM), Fastify, better-sqlite3, vitest, pnpm workspace. Server package `@sengoku-jidai/server` depends on `@sengoku-jidai/engine` and (new) `@sengoku-jidai/ai`.

**Design spec:** `docs/superpowers/specs/2026-08-08-ai-opponent-design.md` (§9). Stages 1–3 (the AI brain) merged in PR #118.

## Global Constraints

- AI runs **server-side** with a per-decision **deadline** (default 1500 ms); production bot: `new IsmctsBot({ deadlineMs: 1500, seed: gameId })`. The AI reasons from its own seat's information set (fair — Stages 1–3 already guarantee this via determinization).
- The AI-apply path MUST reuse the same persistence effects as `submitCommand`'s accept branch: insert snapshot, insert events, insert a command attempt, `UPDATE games SET current_revision/status/updated_at`. It does NOT create sessions and does NOT do client-command-id dedup or stale-revision checks (the server drives it authoritatively at the current revision).
- The auto-drive loop MUST NOT block the human's HTTP response: send the response first, then drive the AI (fire-and-forget via `setImmediate`). ISMCTS is synchronous and CPU-bound; v1 accepts brief event-loop blocking during the AI's think (worker-thread offload is a deferred follow-up).
- The bot is INJECTED into the driver as a `botFor(seat) => Bot` factory so tests can pass a fast bot (e.g. `IsmctsBot({ iterations: 20 })` or `RandomBot`). Never hard-code `IsmctsBot` inside the driver loop.
- The driver loop MUST be bounded (a max-steps guard, e.g. 2000) to prevent any accidental non-termination.
- `game_seats.controller` defaults to `'human'`; existing rows and existing code paths are unaffected.
- Migrations are append-only: add `007_ai_controllers.sql`, register it in `database.ts`'s `migrations` array; never edit an applied migration.
- Follow existing server style: better-sqlite3 prepared statements, `db.transaction(...)` for multi-write effects, named exports, JSDoc on exported functions.
- Also fix the Stage-4 hazard logged from Stage 1–3: `packages/ai/src/geometry.ts` distance cache keyed by `map.id` never invalidates when the map editor re-registers a map in place. This plan is where the AI runs in the long-lived server, so it becomes live.

## Server API reference (verbatim — the code these tasks integrate with)

`packages/server/src/persistence/database.ts`:
```ts
export function runMigrations(db: SqliteDatabase): void; // applies each file in the `migrations` array once
// migrations = ["001_initial.sql", ..., "006_terrain_candidates.sql"]  // append 007 here
```

`packages/server/src/persistence/repository.ts` (relevant existing internals — all `private`):
```ts
createGame(mode, seed?, opts: { creatorName?; creatorSide?; mapId? }): CreatedGame
submitCommand(gameId, session, baseRevision, clientCommandId, command): CommandSubmission
private getGameRow(gameId): { id; mode; current_revision } | null
private loadSnapshot(gameId, revision): GameState             // deserializeState(JSON.parse(state_json))
private insertSnapshot(state, now): void                      // INSERT game_snapshots (serializeState)
private insertEvents(gameId, revision, events, now): void     // INSERT game_events
private insertCommandAttempt({ gameId, seat, clientCommandId, baseRevision, acceptedRevision, command, resultStatus, rejectionCode, now }): void
// createGame writes game_seats rows: (game_id, seat, player_id, status, display_name, claimed_at, last_seen_at)
// accept branch effects: insertSnapshot; insertEvents; insertCommandAttempt(accepted); UPDATE games SET current_revision=?, status=?, updated_at=? WHERE id=?
```

`game_seats` schema (migration 001): `(game_id, seat, player_id, status, display_name, claimed_at, last_seen_at)`, PK `(game_id, seat)`.

From `@sengoku-jidai/ai` (Stages 1–3, on main): `onTheClock(state): SeatId | null`, `IsmctsBot`, `RandomBot`, `createAiRng`, `type Bot { chooseCommand(state, seat): Command }`.
From `@sengoku-jidai/engine`: `resolveCommand`, `type GameState`, `type SeatId`, `type Command`.

## File Structure

```
packages/server/
  migrations/007_ai_controllers.sql        # ALTER game_seats ADD controller
  src/persistence/database.ts              # register 007 (modify)
  src/persistence/repository.ts            # write+read controllers; applyAiCommand (modify)
  src/ai/aiDriver.ts                       # driveAiTurns loop (new)
  src/api/routes.ts                        # invoke driver after create + after command (modify)
  test/aiDriver.test.ts                    # new
  test/aiGame.test.ts                      # new (end-to-end auto-drive)
  package.json                             # add @sengoku-jidai/ai dep (modify)
packages/shared/src/...                    # createGameRequest schema gains `opponent` (modify — locate in Task 2)
packages/ai/src/geometry.ts               # WeakMap cache fix (modify)
```

---

### Task 1: Migration + repository controller storage

**Files:**
- Create: `packages/server/migrations/007_ai_controllers.sql`
- Modify: `packages/server/src/persistence/database.ts` (append `"007_ai_controllers.sql"` to `migrations`)
- Modify: `packages/server/src/persistence/repository.ts` (write controllers in `createGame`; add `controllersOf`)
- Modify: `packages/server/package.json` (add `"@sengoku-jidai/ai": "workspace:*"` to dependencies)
- Test: `packages/server/test/repository.test.ts` (extend)

**Interfaces:**
- Produces:
  - `game_seats.controller TEXT NOT NULL DEFAULT 'human'`
  - `createGame(mode, seed?, opts: { creatorName?; creatorSide?; mapId?; aiSeats?: SeatId[] })` — writes `controller='ai'` for seats in `aiSeats`.
  - `Repository.controllersOf(gameId: string): Record<SeatId, "human" | "ai">`

- [ ] **Step 1: Write the migration** `packages/server/migrations/007_ai_controllers.sql`

```sql
ALTER TABLE game_seats ADD COLUMN controller TEXT NOT NULL DEFAULT 'human';
```

- [ ] **Step 2: Register it** — in `packages/server/src/persistence/database.ts`, append to the `migrations` array:

```ts
    "006_terrain_candidates.sql",
    "007_ai_controllers.sql"
```

- [ ] **Step 3: Add the ai dependency** — in `packages/server/package.json` dependencies add `"@sengoku-jidai/ai": "workspace:*"`. Do NOT run `pnpm install` yet; the workspace link resolves on the next install (Step 6 test run does it once).

- [ ] **Step 4: Write the failing test** (extend `packages/server/test/repository.test.ts` — follow the file's existing in-memory-DB setup pattern):

```ts
it("defaults both seats to human, and marks requested AI seats", () => {
  const repo = makeRepo(); // existing helper in this test file (in-memory db + migrations)
  const human = repo.createGame("hotseat", "seed-x");
  expect(repo.controllersOf(human.gameId)).toEqual({ red: "human", black: "human" });

  const vsAi = repo.createGame("hotseat", "seed-y", { aiSeats: ["black"] });
  expect(repo.controllersOf(vsAi.gameId)).toEqual({ red: "human", black: "ai" });
});
```

- [ ] **Step 5: Run test to verify it fails**

Run: `corepack pnpm --filter @sengoku-jidai/server exec vitest run test/repository.test.ts -t "AI seats"`
Expected: FAIL (`controllersOf` undefined / column missing).

- [ ] **Step 6: Implement** — in `repository.ts`:
  - Extend the `createGame` opts type with `aiSeats?: SeatId[]`.
  - In the seat-insert loop, compute `const controller = (opts.aiSeats ?? []).includes(seat) ? "ai" : "human";` and add `controller` to the `INSERT INTO game_seats (... , controller)` column list and values.
  - Add the reader:

```ts
/** Per-seat controller ('human' | 'ai') for a game. */
controllersOf(gameId: string): Record<SeatId, "human" | "ai"> {
  const rows = this.db
    .prepare("SELECT seat, controller FROM game_seats WHERE game_id = ?")
    .all(gameId) as { seat: SeatId; controller: "human" | "ai" }[];
  const out: Record<SeatId, "human" | "ai"> = { red: "human", black: "human" };
  for (const r of rows) out[r.seat] = r.controller;
  return out;
}
```

- [ ] **Step 7: Run tests to verify they pass**

Run: `corepack pnpm install && corepack pnpm --filter @sengoku-jidai/server exec vitest run test/repository.test.ts`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add packages/server/migrations/007_ai_controllers.sql packages/server/src/persistence/database.ts packages/server/src/persistence/repository.ts packages/server/package.json packages/server/test/repository.test.ts pnpm-lock.yaml
git commit -m "feat(server): per-seat AI controller column + controllersOf"
```

---

### Task 2: Request an AI opponent at game creation

**Files:**
- Modify: shared `createGameRequestSchema` (locate it: `grep -rn "createGameRequestSchema" packages/shared/src`) — add an optional `opponent` field.
- Modify: `packages/server/src/api/routes.ts` (`POST /api/games` handler, ~line 265–282) — translate `opponent: "ai"` into `aiSeats` for the non-creator seat.
- Test: `packages/server/test/mapsApi.test.ts` or the api test that covers `POST /api/games` (locate: `grep -rln "api/games" packages/server/test`).

**Interfaces:**
- Consumes: `createGame(..., { aiSeats })` from Task 1.
- Produces: `POST /api/games` accepts optional `{ opponent?: "human" | "ai" }` (default `"human"`); when `"ai"`, the seat opposite the creator (`creatorSide`, default `red`) is created as `controller='ai'`.

- [ ] **Step 1: Extend the schema** — in the shared schema module, add to the create-game object: `opponent: z.enum(["human", "ai"]).optional()`. Export the inferred type as before.

- [ ] **Step 2: Write the failing test** (in the api test file; follow its Fastify-inject pattern):

```ts
it("POST /api/games with opponent:'ai' marks the non-creator seat as ai", async () => {
  const res = await app.inject({
    method: "POST",
    url: "/api/games",
    payload: { mode: "hotseat", opponent: "ai" }
  });
  expect(res.statusCode).toBe(201);
  const { gameId } = res.json();
  expect(repository.controllersOf(gameId)).toEqual({ red: "human", black: "ai" });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `corepack pnpm --filter @sengoku-jidai/server exec vitest run test/<apiTestFile>.ts -t "opponent"`
Expected: FAIL.

- [ ] **Step 4: Implement** — in the `POST /api/games` handler, after parsing, compute the AI seats and pass them:

```ts
const creatorSide = parsed.data.creatorSide ?? "red";
const aiSeats =
  parsed.data.opponent === "ai" ? ([creatorSide === "red" ? "black" : "red"] as SeatId[]) : [];
const game = repository.createGame(parsed.data.mode, parsed.data.seed, {
  creatorName: parsed.data.creatorName,
  creatorSide: parsed.data.creatorSide,
  mapId: parsed.data.mapId,
  aiSeats
});
```
(Keep whatever opts the handler already passes; only add `aiSeats`.)

- [ ] **Step 5: Run test to verify it passes**

Run: `corepack pnpm --filter @sengoku-jidai/server exec vitest run test/<apiTestFile>.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/shared packages/server/src/api/routes.ts packages/server/test/<apiTestFile>.ts
git commit -m "feat(server): request an AI opponent via POST /api/games opponent:'ai'"
```

---

### Task 3: Fix the geometry distance-cache staleness (Stage-4 hazard)

**Files:**
- Modify: `packages/ai/src/geometry.ts`
- Test: `packages/ai/test/geometry cache` — extend `packages/ai/test/eval.test.ts` geometry block.

**Interfaces:**
- Produces: `hqDistances`/`tileBaseValue` unchanged signatures, but the internal cache is keyed on the `MapDefinition` OBJECT (via `WeakMap`) so a re-registered map (new object) gets a fresh cache line.

**Why:** the server's map editor (`MapLibrary.update` → `registerMap(compileHexMap(...).definition)`) replaces a map's definition object in place under the same id. The current `Map<string, ...>` keyed by `map.id` would keep serving stale geometry for the process lifetime once the AI has cached it. Keying a `WeakMap` on the definition object fixes this and needs no invalidation hook.

- [ ] **Step 1: Write the failing test** (append to the geometry `describe` in `packages/ai/test/eval.test.ts`):

```ts
it("returns fresh distances when a new map object reuses an id (no stale cache)", () => {
  const a = { id: "t", name: "t", bonusSlots: [], areas: {
    hq: { id: "hq", kind: "land", hq: "red", valueStars: 0, harbor: false, shellable: false, fort: false, adjacent: ["x"], ports: [] },
    x:  { id: "x",  kind: "land", hq: null,  valueStars: 0, harbor: false, shellable: false, fort: false, adjacent: ["hq"], ports: [] }
  } } as unknown as import("@sengoku-jidai/engine").MapDefinition;
  expect(hqDistances(a, "red").get("x")).toBe(1);
  // A DIFFERENT object with the same id but x no longer adjacent to hq -> unreachable.
  const b = { ...a, areas: { ...a.areas, x: { ...a.areas.x, adjacent: [] } } } as typeof a;
  expect(hqDistances(b, "red").get("x")).toBeUndefined();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `corepack pnpm --filter @sengoku-jidai/ai exec vitest run test/eval.test.ts -t "stale cache"`
Expected: FAIL (stale `Map<id>` cache returns distance 1 for `b.x`).

- [ ] **Step 3: Implement** — replace the module-level cache in `geometry.ts`:

```ts
const distanceCache = new WeakMap<MapDefinition, Map<SeatId, Map<string, number>>>();

export function hqDistances(map: MapDefinition, seat: SeatId): Map<string, number> {
  let perSeat = distanceCache.get(map);
  if (!perSeat) {
    perSeat = new Map();
    distanceCache.set(map, perSeat);
  }
  const cached = perSeat.get(seat);
  if (cached) return cached;

  const dist = new Map<string, number>();
  const hq = Object.values(map.areas).find((a) => a.hq === seat);
  if (hq) {
    dist.set(hq.id, 0);
    const queue: string[] = [hq.id];
    while (queue.length > 0) {
      const cur = queue.shift()!;
      const d = dist.get(cur)!;
      for (const n of map.areas[cur]!.adjacent) {
        if (!dist.has(n)) {
          dist.set(n, d + 1);
          queue.push(n);
        }
      }
    }
  }
  perSeat.set(seat, dist);
  return dist;
}
```
(Leave `tileBaseValue` and `TileValueWeights` unchanged.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `corepack pnpm --filter @sengoku-jidai/ai exec vitest run test/eval.test.ts && corepack pnpm --filter @sengoku-jidai/ai build`
Expected: PASS + typecheck clean.

- [ ] **Step 5: Commit**

```bash
git add packages/ai/src/geometry.ts packages/ai/test/eval.test.ts
git commit -m "fix(ai): key geometry distance cache on MapDefinition object (no stale cache on re-register)"
```

---

### Task 4: Authoritative AI-apply path in the repository

**Files:**
- Modify: `packages/server/src/persistence/repository.ts`
- Test: `packages/server/test/repository.test.ts` (extend)

**Interfaces:**
- Consumes: `resolveCommand`, `loadSnapshot`, `insertSnapshot`, `insertEvents`, `insertCommandAttempt`, `getGameRow`.
- Produces: `Repository.applyAiCommand(gameId: string, seat: SeatId, command: Command): { status: "accepted" | "rejected"; revision: number }` — applies an AI command at the current revision, mirroring `submitCommand`'s accept effects (snapshot + events + command attempt + games update), in one transaction. No session, no dedup, no stale check. On engine rejection, records a rejected attempt and returns `{status:"rejected"}` (the driver treats a rejection as a fatal bug and stops — see Task 5).

- [ ] **Step 1: Write the failing test**

```ts
it("applyAiCommand advances the game at the current revision", () => {
  const repo = makeRepo();
  const g = repo.createGame("hotseat", "seed-ai", { aiSeats: ["black"] });
  const state0 = repo.snapshotAt(g.gameId, g.revision); // add a tiny test helper or use an existing accessor
  const seat = onTheClock(state0)!;
  const cmd = new RandomBot(createAiRng(1)).chooseCommand(state0, seat);
  const res = repo.applyAiCommand(g.gameId, seat, cmd);
  expect(res.status).toBe("accepted");
  expect(res.revision).toBe(g.revision + 1);
});
```
(Imports: `onTheClock`, `RandomBot`, `createAiRng` from `@sengoku-jidai/ai`. If no public snapshot accessor exists, load the initial view's state via a minimal test-only reader, or assert purely on the returned revision without `state0` by first reading `onTheClock` from a fresh `createInitialState` with the same seed+mode+map — but prefer a real accessor.)

- [ ] **Step 2: Run test to verify it fails**

Run: `corepack pnpm --filter @sengoku-jidai/server exec vitest run test/repository.test.ts -t "applyAiCommand"`
Expected: FAIL.

- [ ] **Step 3: Implement** — add to `repository.ts` (model it on the accept branch of `submitCommand`, lines ~326–356):

```ts
/** Apply a server-driven AI command at the game's current revision. Mirrors the accept
 *  effects of submitCommand (snapshot + events + attempt + games update) but has no session,
 *  dedup, or stale check — the caller drives it authoritatively. */
applyAiCommand(gameId: string, seat: SeatId, command: Command): { status: "accepted" | "rejected"; revision: number } {
  const apply = this.db.transaction(() => {
    const game = this.getGameRow(gameId);
    if (!game) throw new Error(`applyAiCommand: game ${gameId} not found`);
    const state = this.loadSnapshot(gameId, game.current_revision);
    const result = resolveCommand(state, { seat }, command);
    const now = new Date().toISOString();

    if (result.status === "rejected") {
      this.insertCommandAttempt({
        gameId, seat, clientCommandId: `ai-${game.current_revision}-${Math.random().toString(36).slice(2)}`,
        baseRevision: game.current_revision, acceptedRevision: null, command,
        resultStatus: "rejected", rejectionCode: result.reason.code, now
      });
      return { status: "rejected" as const, revision: game.current_revision };
    }

    this.insertSnapshot(result.nextState, now);
    this.insertEvents(gameId, result.nextState.revision, result.events, now);
    this.insertCommandAttempt({
      gameId, seat, clientCommandId: `ai-${game.current_revision}`, baseRevision: game.current_revision,
      acceptedRevision: result.nextState.revision, command, resultStatus: "accepted", rejectionCode: null, now
    });
    this.db.prepare("UPDATE games SET current_revision = ?, status = ?, updated_at = ? WHERE id = ?")
      .run(result.nextState.revision, result.nextState.status, now, gameId);
    return { status: "accepted" as const, revision: result.nextState.revision };
  });
  return apply();
}
```
Note: `game_command_attempts` has a unique index on `(game_id, seat, client_command_id)` — the `ai-<rev>` id is unique per accepted revision; the rejected path adds a random suffix to avoid collisions. Import `Command` from the engine if not already imported.

- [ ] **Step 4: Run tests to verify they pass**

Run: `corepack pnpm --filter @sengoku-jidai/server exec vitest run test/repository.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/persistence/repository.ts packages/server/test/repository.test.ts
git commit -m "feat(server): authoritative applyAiCommand persistence path"
```

---

### Task 5: The AI auto-drive loop

**Files:**
- Create: `packages/server/src/ai/aiDriver.ts`
- Test: `packages/server/test/aiDriver.test.ts`

**Interfaces:**
- Consumes: `Repository.controllersOf`, `Repository.applyAiCommand`, a way to read the current `GameState` (add `Repository.currentState(gameId): GameState` — a thin public wrapper over `getGameRow` + `loadSnapshot` if none exists), `onTheClock` and `Bot` from `@sengoku-jidai/ai`.
- Produces:
  - `interface AiDriverDeps { controllersOf(gameId): Record<SeatId,"human"|"ai">; currentState(gameId): GameState; applyAiCommand(gameId, seat, command): { status: "accepted"|"rejected"; revision: number }; }`
  - `function driveAiTurns(deps: AiDriverDeps, gameId: string, botFor: (seat: SeatId) => Bot, maxSteps?: number): void` — loops while the on-the-clock seat is AI-controlled and the game is active, applying one AI command per step; stops when a human is on the clock, the game ends, or `maxSteps` (default 2000) is hit; throws on an AI rejection (a bug).

- [ ] **Step 1: Add `currentState` to the repository** (if absent): 

```ts
/** The authoritative GameState at the current revision. */
currentState(gameId: string): GameState {
  const game = this.getGameRow(gameId);
  if (!game) throw new Error(`currentState: game ${gameId} not found`);
  return this.loadSnapshot(gameId, game.current_revision);
}
```

- [ ] **Step 2: Write the failing test** `packages/server/test/aiDriver.test.ts`

```ts
import { describe, expect, it } from "vitest";
import { createInitialState, resolveCommand } from "@sengoku-jidai/engine";
import { RandomBot, createAiRng, onTheClock } from "@sengoku-jidai/ai";
import { driveAiTurns } from "../src/ai/aiDriver.js";

// Minimal in-memory fake of AiDriverDeps backed by a live GameState, so the driver logic
// is tested without the DB.
function fakeDeps(seed: string, aiSeat: "red" | "black") {
  let state = createInitialState({ gameId: "g", seed });
  return {
    controllersOf: () => ({ red: aiSeat === "red" ? "ai" : "human", black: aiSeat === "black" ? "ai" : "human" }) as const,
    currentState: () => state,
    applyAiCommand: (_g: string, seat: "red" | "black", cmd: any) => {
      const r = resolveCommand(state, { seat }, cmd);
      if (r.status !== "accepted") return { status: "rejected" as const, revision: state.revision };
      state = r.nextState;
      return { status: "accepted" as const, revision: state.revision };
    },
    _state: () => state
  };
}

describe("driveAiTurns", () => {
  it("advances only while the AI seat is on the clock, then stops for the human", () => {
    const deps = fakeDeps("seed-1", "black");
    // Force black (the AI) to be on the clock.
    // (If red holds initiative, this returns immediately — assert it never touches the human's turn.)
    driveAiTurns(deps as any, "g", () => new RandomBot(createAiRng(2)));
    const s = (deps as any)._state();
    // After driving, it's either the human's (red) turn, or the game is over.
    expect(s.status !== "active" || onTheClock(s) === "red").toBe(true);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `corepack pnpm --filter @sengoku-jidai/server exec vitest run test/aiDriver.test.ts`
Expected: FAIL (aiDriver.js missing).

- [ ] **Step 4: Implement** `packages/server/src/ai/aiDriver.ts`

```ts
import type { GameState, SeatId } from "@sengoku-jidai/engine";
import { onTheClock, type Bot } from "@sengoku-jidai/ai";

export interface AiDriverDeps {
  controllersOf(gameId: string): Record<SeatId, "human" | "ai">;
  currentState(gameId: string): GameState;
  applyAiCommand(
    gameId: string,
    seat: SeatId,
    command: import("@sengoku-jidai/engine").Command
  ): { status: "accepted" | "rejected"; revision: number };
}

/**
 * Drive AI seats to completion of their turns. While the seat on the clock is AI-controlled
 * and the game is active, pick and apply one AI command per step. Stops when a human is on the
 * clock, the game ends, or `maxSteps` is reached. Throws if an AI command is rejected — that is
 * a bug (the AI must only ever emit engine-legal commands), not an expected outcome.
 */
export function driveAiTurns(
  deps: AiDriverDeps,
  gameId: string,
  botFor: (seat: SeatId) => Bot,
  maxSteps = 2000
): void {
  const controllers = deps.controllersOf(gameId);
  for (let step = 0; step < maxSteps; step++) {
    const state = deps.currentState(gameId);
    if (state.status !== "active") return;
    const seat = onTheClock(state);
    if (!seat || controllers[seat] !== "ai") return; // human (or nobody) on the clock
    const command = botFor(seat).chooseCommand(state, seat);
    const res = deps.applyAiCommand(gameId, seat, command);
    if (res.status !== "accepted") {
      throw new Error(`driveAiTurns: AI(${seat}) emitted an illegal command for game ${gameId}`);
    }
  }
  throw new Error(`driveAiTurns: exceeded ${maxSteps} steps for game ${gameId} (non-terminating?)`);
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `corepack pnpm --filter @sengoku-jidai/server exec vitest run test/aiDriver.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/server/src/ai/aiDriver.ts packages/server/src/persistence/repository.ts packages/server/test/aiDriver.test.ts
git commit -m "feat(server): AI auto-drive loop (driveAiTurns)"
```

---

### Task 6: Wire the driver into the routes (create + command), non-blocking

**Files:**
- Modify: `packages/server/src/api/routes.ts` (`POST /api/games`, `POST /api/games/:gameId/commands`)
- Modify: `packages/server/src/app.ts` — pass a bot factory into the routes (config seam), default production factory `(seat) => new IsmctsBot({ deadlineMs: 1500, seed: gameId })`. Locate where routes are registered (`grep -n "registerRoutes\|routes(" packages/server/src/app.ts`).
- Test: covered end-to-end in Task 7.

**Interfaces:**
- Consumes: `driveAiTurns`, `repository.controllersOf`, `IsmctsBot`.
- Produces: after a game is created with an AI seat on the clock, and after every accepted human command, the server drives AI turns without blocking the HTTP response.

- [ ] **Step 1: Thread a bot factory to the routes.** Give the route registrar an optional `aiBotFor?: (gameId: string, seat: SeatId) => Bot` (default: `(gameId, seat) => new IsmctsBot({ deadlineMs: 1500, seed: gameId })`). This is the injection seam Task 7's tests use to pass a fast bot.

- [ ] **Step 2: Helper to schedule driving** — in `routes.ts`, add a small local:

```ts
const driveAiSoon = (gameId: string) =>
  setImmediate(() => {
    try {
      driveAiTurns(
        { controllersOf: (id) => repository.controllersOf(id), currentState: (id) => repository.currentState(id), applyAiCommand: (id, seat, cmd) => repository.applyAiCommand(id, seat, cmd) },
        gameId,
        (seat) => aiBotFor(gameId, seat)
      );
    } catch (err) {
      request.log.error({ err, gameId }, "AI driver failed");
    }
  });
```
(Use the route's logger; `setImmediate` lets the HTTP response flush before the synchronous ISMCTS work runs. v1 accepts brief event-loop blocking during the think — worker-thread offload is a deferred follow-up.)

- [ ] **Step 3: Call it after create** — at the end of the `POST /api/games` handler, after building the response, when the created game has an AI seat: `if (Object.values(repository.controllersOf(game.gameId)).includes("ai")) driveAiSoon(game.gameId);` then send the response as before. (Order: schedule via `setImmediate`, then `reply.send` — the send runs first.)

- [ ] **Step 4: Call it after an accepted command** — in `POST /api/games/:gameId/commands`, when `result.status === "accepted"`, `driveAiSoon(gameId)` before returning the reply.

- [ ] **Step 5: Typecheck + commit**

Run: `corepack pnpm --filter @sengoku-jidai/server typecheck`

```bash
git add packages/server/src/api/routes.ts packages/server/src/app.ts
git commit -m "feat(server): drive AI turns after create + accepted command (non-blocking)"
```

---

### Task 7: End-to-end auto-drive integration test

**Files:**
- Create: `packages/server/test/aiGame.test.ts`

**Interfaces:**
- Consumes: the app factory with an injected FAST bot (`IsmctsBot({ iterations: 15 })` or `RandomBot`), an in-memory DB.

- [ ] **Step 1: Write the test** — build the app with the fast-bot injection, create a game with `opponent:'ai'`, then play the human seat with a scripted/greedy policy, polling `GET /events` after each move, and assert the game reaches `complete` with the AI having taken its turns. Because the driver runs on `setImmediate`, `await` a tick (e.g. `await new Promise((r) => setImmediate(r))`) after each human command before polling.

```ts
import { describe, expect, it } from "vitest";
import { onTheClock, GreedyBot } from "@sengoku-jidai/ai";
// build app with aiBotFor: () => new RandomBot(createAiRng(1))  (fast); in-memory db; see test/server.test.ts for the app-build pattern.

describe("AI game (end-to-end auto-drive)", () => {
  it("plays a full human-vs-AI game to completion via the HTTP surface", async () => {
    // 1. POST /api/games { mode:"hotseat", opponent:"ai" } -> gameId + human (red) session token
    // 2. loop: after each accepted human command, await a setImmediate tick, GET the current view,
    //    and while it's red's turn submit a GreedyBot command for red; stop when status==="complete".
    // 3. assert the game completed and that black (AI) made ≥1 accepted command
    //    (query repository / events for an accepted attempt by seat "black").
    expect(onTheClock).toBeTruthy(); // placeholder — replace with the real flow above
    expect(GreedyBot).toBeTruthy();
  });
});
```
NOTE TO IMPLEMENTER: replace the placeholder asserts with the real flow — this step is NOT complete until the test actually drives a full game over HTTP and asserts completion + that the AI seat moved. Model the app build + `inject` calls on `packages/server/test/server.test.ts` and `test/mapsApi.test.ts`. Keep the bot fast (RandomBot or `IsmctsBot({iterations:15})`) so the test runs in seconds.

- [ ] **Step 2: Run + iterate to green**

Run: `corepack pnpm --filter @sengoku-jidai/server exec vitest run test/aiGame.test.ts`
Expected: PASS (full game completes; AI seat has accepted commands).

- [ ] **Step 3: Full gate + commit**

Run: `corepack pnpm --filter @sengoku-jidai/server typecheck && corepack pnpm --filter @sengoku-jidai/server exec vitest run && corepack pnpm lint`

```bash
git add packages/server/test/aiGame.test.ts
git commit -m "test(server): end-to-end human-vs-AI auto-drive game"
```

---

## Deferred follow-ups (out of scope for this plan)
- **Worker-thread offload:** ISMCTS is synchronous and CPU-bound; the `setImmediate` fire-and-forget still blocks the event loop during the think. For higher concurrency, move `chooseCommand` to a worker thread. Acceptable to skip for low-traffic play.
- **Web UI:** surfacing "AI is thinking…" and an opponent picker in the React client is a separate front-end task.
- **Admin/observability:** the admin panel could show which seats are AI.

## Self-Review

**Spec coverage (§9):** controllers flag → Task 1; create-time request → Task 2; auto-drive loop after create + command → Tasks 5–6; authoritative apply path → Task 4; latency (return immediately, drive async) → Task 6 (`setImmediate`); AI reasons from its info set → inherited from Stages 1–3. The logged Stage-4 hazard (geometry cache) → Task 3. ✓

**Placeholder scan:** Task 7's test body is intentionally a scaffold with an explicit NOTE that it is not done until it drives a real game — flagged, not hidden. Tasks 2 & 6 reference "locate X" for the shared schema and app wiring because those exact locations must be read at implementation time (the shared schema module and `app.ts` route registration were not pinned during planning); each says exactly what to grep. All other steps contain complete code.

**Type consistency:** `controllersOf` return type `Record<SeatId,"human"|"ai">`, `applyAiCommand(gameId, seat, command) => {status; revision}`, `AiDriverDeps`, and `driveAiTurns(deps, gameId, botFor, maxSteps?)` are used identically across Tasks 1/4/5/6. `Bot`/`onTheClock`/`IsmctsBot`/`RandomBot` come from `@sengoku-jidai/ai` (Stages 1–3, on main).

**Known risks called out:** event-loop blocking during synchronous ISMCTS (v1 accepted, worker-thread deferred); the shared-schema and `app.ts` wiring locations need reading at implement time; Task 7 requires real integration wiring, not the scaffold.
