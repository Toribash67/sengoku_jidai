# AI worker-thread offload + web opponent picker — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop the ISMCTS think from blocking the Fastify event loop (run it on a worker thread), and let a game creator pick a human or AI opponent in the web UI with a "Computer is thinking…" indicator.

**Architecture:** PR 1 moves `IsmctsBot.chooseCommand` into a short-lived `worker_threads` worker exposed as `runIsmctsInWorker`, and makes the server's `driveAiTurns` async around an injected `pickCommand`. PR 2 threads an `opponent` field through the web create-game flow (server already accepts it) and surfaces a per-seat `controller` so the client can show when the AI seat is on the clock.

**Tech Stack:** TypeScript (ESM, `"type":"module"`), Node `worker_threads`, Fastify, React, Vitest, pnpm workspaces (tsc → `dist`).

## Global Constraints

- All packages are ESM (`"type": "module"`); relative imports use `.js` extensions even from `.ts` sources.
- `@sengoku-jidai/ai` is server-only and consumes the engine root export; it builds via `tsc -p tsconfig.build.json` to `dist/`. The server consumes ai's **built dist**, so ai must be built before server tests run (`corepack pnpm build:libs` includes `--filter @sengoku-jidai/ai`).
- Determinism: ISMCTS is only bit-reproducible under `iterations` mode (fixed count); `deadlineMs` depends on wall-clock. Equivalence assertions MUST use `iterations`.
- Never surface raw tile ids in the UI (not relevant here, but the repo rule stands).
- Pre-push gate (run in this order, format LAST): `corepack pnpm build:libs` → `corepack pnpm -r --sort run test` → `corepack pnpm lint` → `corepack pnpm -r run typecheck` → `corepack pnpm format`.
- Two independent PRs, each on its own focused branch off `main`. Ask before merging; squash-merge; merge-on-green via `gh pr checks <n> --watch` then `gh pr merge --squash`.

---

# PR 1 — Worker-thread offload

Branch: `git switch -c ai-worker-offload`

## File structure (PR 1)

- Create `packages/ai/src/ismcts.worker.ts` — worker entry: run one ISMCTS decision, post the command back.
- Create `packages/ai/src/ismctsWorkerRunner.ts` — `runIsmctsInWorker(state, seat, opts)`: spawn worker, await result, terminate.
- Modify `packages/ai/src/ismcts.ts` — export a named `IsmctsBotOptions` type; use it in the `IsmctsBot` constructor.
- Modify `packages/ai/src/index.ts` — export `runIsmctsInWorker` and `type IsmctsBotOptions`.
- Modify `packages/server/src/ai/aiDriver.ts` — make `driveAiTurns` async around an injected `pickCommand`.
- Modify `packages/server/src/api/routes.ts` — swap the `aiBotFor` seam for an `aiPickCommandFor` factory defaulting to the worker.
- Modify `packages/server/src/app.ts` — `BuildAppOptions.aiPickCommandFor`.
- Modify `packages/server/test/aiGame.test.ts` and `packages/server/test/mapsApi.test.ts` — update the injected seam.
- Create `packages/server/test/ismctsWorker.test.ts` — worker round-trip + determinism.

---

### Task 1: Named `IsmctsBotOptions` type

**Files:**
- Modify: `packages/ai/src/ismcts.ts` (constructor around line 183-193)
- Modify: `packages/ai/src/index.ts`

**Interfaces:**
- Produces: `export interface IsmctsBotOptions { iterations?: number; deadlineMs?: number; seed?: string; depthCap?: number; exploration?: number; weights?: EvalWeights }` (from `packages/ai/src/ismcts.ts`), re-exported from the package root.

- [ ] **Step 1: Add and use the named type**

In `packages/ai/src/ismcts.ts`, add above the `IsmctsBot` class (keep the existing `EvalWeights` import):

```ts
/** Serializable options for a single ISMCTS decision. Plain data so it can cross a worker
 *  boundary (see runIsmctsInWorker). */
export interface IsmctsBotOptions {
  iterations?: number;
  deadlineMs?: number;
  seed?: string;
  depthCap?: number;
  exploration?: number;
  weights?: EvalWeights;
}
```

Change the constructor from the inline object type to:

```ts
export class IsmctsBot implements Bot {
  constructor(private readonly opts: IsmctsBotOptions) {}
```

- [ ] **Step 2: Re-export from the package root**

In `packages/ai/src/index.ts`, change the ismcts export line to also export the type:

```ts
export { chooseCommandIsmcts, IsmctsBot, type IsmctsOptions, type IsmctsBotOptions } from "./ismcts.js";
```

- [ ] **Step 3: Typecheck**

Run: `corepack pnpm --filter @sengoku-jidai/ai run typecheck`
Expected: PASS (no behavior change; existing tests still compile).

- [ ] **Step 4: Commit**

```bash
git add packages/ai/src/ismcts.ts packages/ai/src/index.ts
git commit -m "refactor(ai): export named IsmctsBotOptions type"
```

---

### Task 2: Worker entry + `runIsmctsInWorker`

**Files:**
- Create: `packages/ai/src/ismcts.worker.ts`
- Create: `packages/ai/src/ismctsWorkerRunner.ts`
- Modify: `packages/ai/src/index.ts`
- Test: `packages/server/test/ismctsWorker.test.ts` (lives in server because vitest runs ai against `src`, where the compiled worker `.js` does not exist; server tests run against ai's built `dist`).

**Interfaces:**
- Consumes: `IsmctsBot`, `IsmctsBotOptions` (Task 1); `GameState`, `SeatId`, `Command` from `./types.js`.
- Produces: `export function runIsmctsInWorker(state: GameState, seat: SeatId, opts: IsmctsBotOptions): Promise<Command>` (from `packages/ai/src/ismctsWorkerRunner.ts`), re-exported from the package root.
- Worker message protocol: main→worker `{ state, seat, opts }`; worker→main `{ ok: true, command } | { ok: false, error: string }`.

- [ ] **Step 1: Write the failing test**

Create `packages/server/test/ismctsWorker.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { IsmctsBot, onTheClock, runIsmctsInWorker } from "@sengoku-jidai/ai";
import { openDatabase, runMigrations } from "../src/persistence/database.js";
import { GameRepository } from "../src/persistence/repository.js";

describe("runIsmctsInWorker", () => {
  it("returns the same command as the in-process bot (serialization + determinism)", async () => {
    const db = openDatabase(":memory:");
    runMigrations(db);
    const repo = new GameRepository(db);
    const game = repo.createGame("hotseat", 12345, { creatorName: "P1", creatorSide: "red" });
    const state = repo.currentState(game.gameId);
    const seat = onTheClock(state);
    expect(seat).not.toBeNull();

    // iterations (not deadlineMs) so the result is bit-reproducible across process/worker.
    const opts = { iterations: 150, seed: "worker-test" };
    const inProcess = new IsmctsBot(opts).chooseCommand(state, seat!);
    const viaWorker = await runIsmctsInWorker(state, seat!, opts);

    expect(viaWorker).toEqual(inProcess);
    db.close();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `corepack pnpm --filter @sengoku-jidai/ai build && corepack pnpm --filter @sengoku-jidai/server exec vitest run test/ismctsWorker.test.ts`
Expected: FAIL — `runIsmctsInWorker` is not exported yet.

- [ ] **Step 3: Write the worker entry**

Create `packages/ai/src/ismcts.worker.ts`:

```ts
import { parentPort } from "node:worker_threads";
import { IsmctsBot } from "./ismcts.js";
import type { Command, GameState, SeatId } from "./types.js";
import type { IsmctsBotOptions } from "./ismcts.js";

if (!parentPort) {
  throw new Error("ismcts.worker must be run as a worker thread");
}

interface WorkerRequest {
  state: GameState;
  seat: SeatId;
  opts: IsmctsBotOptions;
}

export type WorkerResponse = { ok: true; command: Command } | { ok: false; error: string };

parentPort.on("message", (req: WorkerRequest) => {
  try {
    const command = new IsmctsBot(req.opts).chooseCommand(req.state, req.seat);
    parentPort!.postMessage({ ok: true, command } satisfies WorkerResponse);
  } catch (err) {
    parentPort!.postMessage({
      ok: false,
      error: err instanceof Error ? err.message : String(err)
    } satisfies WorkerResponse);
  }
});
```

- [ ] **Step 4: Write the runner**

Create `packages/ai/src/ismctsWorkerRunner.ts`:

```ts
import { Worker } from "node:worker_threads";
import type { Command, GameState, SeatId } from "./types.js";
import type { IsmctsBotOptions } from "./ismcts.js";
import type { WorkerResponse } from "./ismcts.worker.js";

/** Run one ISMCTS decision on a worker thread so the caller's event loop stays free during the
 *  (CPU-bound, ~1s+) search. Spawns a fresh worker per call and terminates it once the decision
 *  is posted back. The worker path is resolved relative to the compiled runner in dist. */
export function runIsmctsInWorker(
  state: GameState,
  seat: SeatId,
  opts: IsmctsBotOptions
): Promise<Command> {
  return new Promise<Command>((resolve, reject) => {
    const worker = new Worker(new URL("./ismcts.worker.js", import.meta.url));
    let settled = false;
    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      void worker.terminate();
      fn();
    };
    worker.on("message", (msg: WorkerResponse) => {
      if (msg.ok) finish(() => resolve(msg.command));
      else finish(() => reject(new Error(`ISMCTS worker failed: ${msg.error}`)));
    });
    worker.on("error", (err) => finish(() => reject(err)));
    worker.on("exit", (code) => {
      if (code !== 0) finish(() => reject(new Error(`ISMCTS worker exited with code ${code}`)));
    });
    worker.postMessage({ state, seat, opts });
  });
}
```

- [ ] **Step 5: Export the runner from the package root**

In `packages/ai/src/index.ts`, add:

```ts
export { runIsmctsInWorker } from "./ismctsWorkerRunner.js";
```

- [ ] **Step 6: Run test to verify it passes**

Run: `corepack pnpm --filter @sengoku-jidai/ai build && corepack pnpm --filter @sengoku-jidai/server exec vitest run test/ismctsWorker.test.ts`
Expected: PASS.

- [ ] **Step 7: Typecheck ai (worker files included in tsconfig src glob)**

Run: `corepack pnpm --filter @sengoku-jidai/ai run typecheck`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add packages/ai/src/ismcts.worker.ts packages/ai/src/ismctsWorkerRunner.ts packages/ai/src/index.ts packages/server/test/ismctsWorker.test.ts
git commit -m "feat(ai): run ISMCTS on a worker thread (runIsmctsInWorker)"
```

---

### Task 3: Make `driveAiTurns` async around an injected `pickCommand`

**Files:**
- Modify: `packages/server/src/ai/aiDriver.ts`

**Interfaces:**
- Produces: `export async function driveAiTurns(deps: AiDriverDeps, gameId: string, pickCommand: (seat: SeatId, state: GameState) => Promise<Command>, maxSteps?: number): Promise<void>`.
- `AiDriverDeps` is unchanged.

- [ ] **Step 1: Rewrite the driver**

Replace the body of `packages/server/src/ai/aiDriver.ts` with:

```ts
import type { Command, GameState, SeatId } from "@sengoku-jidai/engine";
import { onTheClock } from "@sengoku-jidai/ai";

export interface AiDriverDeps {
  controllersOf(gameId: string): Record<SeatId, "human" | "ai">;
  currentState(gameId: string): GameState;
  applyAiCommand(
    gameId: string,
    seat: SeatId,
    command: Command
  ): { status: "accepted" | "rejected"; revision: number };
}

/**
 * Drive AI seats to completion of their turns. While the seat on the clock is AI-controlled
 * and the game is active, pick and apply one AI command per step. Stops when a human is on the
 * clock, the game ends, or `maxSteps` is reached. Throws if an AI command is rejected — that is
 * a bug (the AI must only ever emit engine-legal commands), not an expected outcome.
 *
 * `pickCommand` is async so the ISMCTS search can run off the event loop (see runIsmctsInWorker).
 */
export async function driveAiTurns(
  deps: AiDriverDeps,
  gameId: string,
  pickCommand: (seat: SeatId, state: GameState) => Promise<Command>,
  maxSteps = 2000
): Promise<void> {
  const controllers = deps.controllersOf(gameId);
  for (let step = 0; step < maxSteps; step++) {
    const state = deps.currentState(gameId);
    if (state.status !== "active") return;
    const seat = onTheClock(state);
    if (!seat || controllers[seat] !== "ai") return; // human (or nobody) on the clock
    const command = await pickCommand(seat, state);
    const res = deps.applyAiCommand(gameId, seat, command);
    if (res.status !== "accepted") {
      throw new Error(`driveAiTurns: AI(${seat}) emitted an illegal command for game ${gameId}`);
    }
  }
  throw new Error(`driveAiTurns: exceeded ${maxSteps} steps for game ${gameId} (non-terminating?)`);
}
```

- [ ] **Step 2: Typecheck (will fail at call sites — expected, fixed in Tasks 4–5)**

Run: `corepack pnpm --filter @sengoku-jidai/server run typecheck`
Expected: FAIL only in `routes.ts`/`app.ts`/tests (call-site signature mismatch). No errors inside `aiDriver.ts` itself.

- [ ] **Step 3: Commit**

```bash
git add packages/server/src/ai/aiDriver.ts
git commit -m "refactor(server): make driveAiTurns async around an injected pickCommand"
```

---

### Task 4: Wire the worker into routes + buildApp

**Files:**
- Modify: `packages/server/src/api/routes.ts` (imports ~line 12-21; `registerApiRoutes` signature line 30-39; `driveAiSoon` line 40-55)
- Modify: `packages/server/src/app.ts` (`BuildAppOptions` line 16-18; `registerApiRoutes` call line 43-51)

**Interfaces:**
- Consumes: `runIsmctsInWorker` (Task 2), `driveAiTurns` (Task 3).
- Produces: `registerApiRoutes(..., aiPickCommandFor?: (gameId: string) => (seat: SeatId, state: GameState) => Promise<Command>)`; `BuildAppOptions.aiPickCommandFor?: (gameId: string) => (seat: SeatId, state: GameState) => Promise<Command>`.

- [ ] **Step 1: Update `routes.ts` imports**

Replace the ai import (line 15) `import { IsmctsBot, type Bot } from "@sengoku-jidai/ai";` with:

```ts
import { runIsmctsInWorker } from "@sengoku-jidai/ai";
import type { Command, GameState } from "@sengoku-jidai/engine";
```

(Keep the existing `import type { SeatId } from "@sengoku-jidai/shared";`. Keep the `import { driveAiTurns } from "../ai/aiDriver.js";`.)

- [ ] **Step 2: Update the `registerApiRoutes` signature default**

Replace the `aiBotFor` parameter (lines 37-38) with:

```ts
  aiPickCommandFor: (gameId: string) => (seat: SeatId, state: GameState) => Promise<Command> = (
    gameId
  ) => (seat, state) => runIsmctsInWorker(state, seat, { deadlineMs: 1500, seed: gameId })
```

- [ ] **Step 3: Update `driveAiSoon`**

Replace the `driveAiSoon` const (lines 40-55) with:

```ts
  const driveAiSoon = (gameId: string) =>
    setImmediate(() => {
      driveAiTurns(
        {
          controllersOf: (id) => repository.controllersOf(id),
          currentState: (id) => repository.currentState(id),
          applyAiCommand: (id, seat, cmd) => repository.applyAiCommand(id, seat, cmd)
        },
        gameId,
        aiPickCommandFor(gameId)
      ).catch((err) => app.log.error({ err, gameId }, "AI driver failed"));
    });
```

- [ ] **Step 4: Update `app.ts`**

Replace the `Bot` import (line 6) `import type { Bot } from "@sengoku-jidai/ai";` with:

```ts
import type { Command, GameState } from "@sengoku-jidai/engine";
```

Replace `BuildAppOptions` (lines 16-18) with:

```ts
export interface BuildAppOptions {
  aiPickCommandFor?: (gameId: string) => (seat: SeatId, state: GameState) => Promise<Command>;
}
```

Change the `registerApiRoutes` call's last argument (line 50) from `opts?.aiBotFor` to `opts?.aiPickCommandFor`.

- [ ] **Step 5: Typecheck (tests still red until Task 5)**

Run: `corepack pnpm --filter @sengoku-jidai/server run typecheck`
Expected: FAIL only in `test/aiGame.test.ts` and `test/mapsApi.test.ts` (injected seam shape). `src/` typechecks clean.

- [ ] **Step 6: Commit**

```bash
git add packages/server/src/api/routes.ts packages/server/src/app.ts
git commit -m "feat(server): drive AI turns via worker-backed pickCommand"
```

---

### Task 5: Update the tests that inject or exercise the AI seam

**Files:**
- Modify: `packages/server/test/aiGame.test.ts` (line 26)
- Modify: `packages/server/test/mapsApi.test.ts` (lines 210-218)
- Modify: `packages/server/test/aiDriver.test.ts` (the direct `driveAiTurns` unit test — line 29 `it` callback and line 32 call)
- Modify: `packages/server/test/ismctsWorker.test.ts` (fix a latent seed-type error: `createGame`'s `seed` param is `string`, but the Task 2 test passes a number)

**Interfaces:**
- Consumes: `BuildAppOptions.aiPickCommandFor`, `registerApiRoutes`'s `aiPickCommandFor` param (Task 4); `driveAiTurns(deps, gameId, pickCommand, maxSteps?)` async signature (Task 3).

- [ ] **Step 1: Update `aiGame.test.ts`**

Replace line 26:

```ts
    const app = buildApp(testConfig(), { aiBotFor: () => new RandomBot(createAiRng(1)) });
```

with (construct one bot so it keeps a single deterministic RNG stream across the game, and wrap its sync pick in a resolved promise — no worker spawned in tests):

```ts
    const bot = new RandomBot(createAiRng(1));
    const app = buildApp(testConfig(), {
      aiPickCommandFor: () => (seat, state) => Promise.resolve(bot.chooseCommand(state, seat))
    });
```

Also update the comment on the `tick` helper (lines 18-20): the driver is now async, so replace "it's synchronous once started" with "it runs to completion asynchronously; one macrotask tick lets its awaited picks settle since the in-test pick resolves immediately".

- [ ] **Step 2: Update `mapsApi.test.ts`**

Replace the 7th argument (lines 216-217) `undefined,` / `() => new RandomBot(createAiRng(1))` block so the call reads:

```ts
    registerApiRoutes(
      app,
      repository,
      library,
      terrainStore,
      terrainService,
      undefined,
      () => (seat, state) => Promise.resolve(new RandomBot(createAiRng(1)).chooseCommand(state, seat))
    );
```

- [ ] **Step 3: Update `aiDriver.test.ts` (direct driver unit test)**

`driveAiTurns` is now async and takes an async `pickCommand`. In `packages/server/test/aiDriver.test.ts`, make the `it` callback async (line 29) and replace the call (line 32):

```ts
    const bot = new RandomBot(createAiRng(2));
    await driveAiTurns(f.deps, "g", (seat, state) => Promise.resolve(bot.chooseCommand(state, seat)));
```

- [ ] **Step 4: Fix the `ismctsWorker.test.ts` seed type**

`GameRepository.createGame(mode, seed?: string, opts)` takes a **string** seed. In `packages/server/test/ismctsWorker.test.ts`, change the numeric seed to a string:

```ts
    const game = repo.createGame("hotseat", "12345", { creatorName: "P1", creatorSide: "red" });
```

- [ ] **Step 5: Run the affected tests**

Run: `corepack pnpm --filter @sengoku-jidai/ai build && corepack pnpm --filter @sengoku-jidai/server exec vitest run test/aiGame.test.ts test/mapsApi.test.ts test/aiDriver.test.ts test/ismctsWorker.test.ts`
Expected: PASS.

- [ ] **Step 6: Full server typecheck**

Run: `corepack pnpm --filter @sengoku-jidai/server run typecheck`
Expected: PASS (all call-site and test signatures now match the async seam; the seed-type error is resolved).

- [ ] **Step 7: Commit**

```bash
git add packages/server/test/aiGame.test.ts packages/server/test/mapsApi.test.ts packages/server/test/aiDriver.test.ts packages/server/test/ismctsWorker.test.ts
git commit -m "test(server): drive AI turns via async pickCommand seam"
```

---

### Task 6: PR 1 gate + open PR

- [ ] **Step 1: Run the full gate (format LAST)**

```bash
corepack pnpm build:libs
corepack pnpm -r --sort run test
corepack pnpm lint
corepack pnpm -r run typecheck
corepack pnpm format
```
Expected: all PASS; `format` may restage files — commit if so.

- [ ] **Step 2: Push and open PR**

```bash
git push -u origin ai-worker-offload
gh pr create --fill --title "feat(ai): worker-thread offload for ISMCTS (non-blocking AI turns)"
```

- [ ] **Step 3: STOP — ask Martin before merging.** On approval: `gh pr checks <n> --watch` then `gh pr merge --squash`.

---

# PR 2 — Opponent picker + "Computer is thinking…" indicator

Branch (off updated `main` after PR 1 merges): `git switch main && git pull && git switch -c ai-opponent-picker`

## File structure (PR 2)

- Modify `packages/shared/src/api.ts` — add `controller` to `GameSeatInfo`.
- Modify `packages/server/src/persistence/repository.ts` — `getSeatInfo` selects/maps `controller`.
- Modify `packages/web/src/client/api.ts` — `createGame` takes `opponent`.
- Create `packages/web/src/state/onClock.ts` — pure "seat on the clock" helper.
- Modify `packages/web/src/components/CreateGameScreen.tsx` — opponent control; `onCreate` gains `opponent`.
- Modify `packages/web/src/App.tsx` — thread `opponent`; compute `thinkingSeat`; pass to `PlayersPanel`.
- Modify `packages/web/src/components/PlayersPanel.tsx` — render the thinking indicator.
- Modify `packages/web/src/styles/app.css` — minimal indicator style.
- Tests: `packages/web/src/state/onClock.test.ts`, extend `packages/web/src/client/api.test.ts`; fix any `GameSeatInfo` literals in web/server tests for the new field.

---

### Task 7: Add `controller` to `GameSeatInfo` (shared + repository)

**Files:**
- Modify: `packages/shared/src/api.ts` (`GameSeatInfo`, lines 10-14)
- Modify: `packages/server/src/persistence/repository.ts` (`getSeatInfo`, lines 98-103; the local `SeatInfoRow` type)
- Test: `packages/server/test/seatInfoController.test.ts` (new)

**Interfaces:**
- Produces: `GameSeatInfo { seat: SeatId; name: string | null; status: SeatStatus; controller: "human" | "ai" }`.

- [ ] **Step 1: Write the failing test**

Create `packages/server/test/seatInfoController.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { openDatabase, runMigrations } from "../src/persistence/database.js";
import { GameRepository } from "../src/persistence/repository.js";

describe("getSeatInfo controller", () => {
  it("reports the AI seat as ai and the human seat as human", () => {
    const db = openDatabase(":memory:");
    runMigrations(db);
    const repo = new GameRepository(db);
    const game = repo.createGame("hotseat", "1", {
      creatorName: "P1",
      creatorSide: "red",
      aiSeats: ["black"]
    });
    const info = repo.getSeatInfo(game.gameId);
    expect(info.find((s) => s.seat === "red")?.controller).toBe("human");
    expect(info.find((s) => s.seat === "black")?.controller).toBe("ai");
    db.close();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `corepack pnpm --filter @sengoku-jidai/shared build && corepack pnpm --filter @sengoku-jidai/server exec vitest run test/seatInfoController.test.ts`
Expected: FAIL — `controller` is `undefined` (not selected).

- [ ] **Step 3: Add the field to `GameSeatInfo`**

In `packages/shared/src/api.ts`, change `GameSeatInfo` to:

```ts
export interface GameSeatInfo {
  seat: SeatId;
  name: string | null;
  status: SeatStatus;
  controller: "human" | "ai";
}
```

- [ ] **Step 4: Select + map `controller` in `getSeatInfo`**

In `packages/server/src/persistence/repository.ts`, update the `SeatInfoRow` local type to include `controller: "human" | "ai"`, then change `getSeatInfo`:

```ts
  getSeatInfo(gameId: string): GameSeatInfo[] {
    const rows = this.db
      .prepare(
        "SELECT seat, display_name, status, controller FROM game_seats WHERE game_id = ? ORDER BY seat"
      )
      .all(gameId) as SeatInfoRow[];
    return rows.map((r) => ({
      seat: r.seat,
      name: r.display_name,
      status: r.status,
      controller: r.controller
    }));
  }
```

- [ ] **Step 5: Run to verify it passes**

Run: `corepack pnpm --filter @sengoku-jidai/shared build && corepack pnpm --filter @sengoku-jidai/server exec vitest run test/seatInfoController.test.ts`
Expected: PASS.

- [ ] **Step 6: Fix any now-broken `GameSeatInfo` literals**

Run: `corepack pnpm --filter @sengoku-jidai/server run typecheck`
For each TS error where a test/fixture builds a `GameSeatInfo` object literal without `controller`, add `controller: "human"` (or `"ai"` where the fixture models an AI seat). Re-run typecheck until clean.

- [ ] **Step 7: Commit**

```bash
git add packages/shared/src/api.ts packages/server/src/persistence/repository.ts packages/server/test/seatInfoController.test.ts
git commit -m "feat(server): expose per-seat controller in seat info"
```

---

### Task 8: `createGame` sends `opponent`

**Files:**
- Modify: `packages/web/src/client/api.ts` (`createGame`, lines 18-32)
- Test: `packages/web/src/client/api.test.ts` (extend)

**Interfaces:**
- Produces: `createGame(input: { name: string; side: SeatId; mapId?: string; opponent?: "human" | "ai" })`.

- [ ] **Step 1: Write the failing test**

In `packages/web/src/client/api.test.ts`, add a case that stubs `fetch`, calls `createGame({ name: "N", side: "red", opponent: "ai" })`, and asserts the request body includes `opponent: "ai"`. Match the file's existing fetch-mock style, e.g.:

```ts
it("sends opponent in the create-game body", async () => {
  const fetchMock = vi.fn().mockResolvedValue(
    new Response(JSON.stringify({ ok: true }), { status: 200, headers: { "content-type": "application/json" } })
  );
  vi.stubGlobal("fetch", fetchMock);
  await createGame({ name: "N", side: "red", opponent: "ai" });
  const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
  expect(body.opponent).toBe("ai");
  vi.unstubAllGlobals();
});
```

(If `api.test.ts` already imports `createGame`/`vi`, reuse those imports rather than re-adding.)

- [ ] **Step 2: Run to verify it fails**

Run: `corepack pnpm --filter @sengoku-jidai/web exec vitest run src/client/api.test.ts`
Expected: FAIL — `body.opponent` is `undefined`.

- [ ] **Step 3: Add the field**

In `packages/web/src/client/api.ts`, change `createGame`:

```ts
export async function createGame(input: {
  name: string;
  side: SeatId;
  mapId?: string;
  opponent?: "human" | "ai";
}): Promise<CreateGameResponse<PlayerGameView>> {
  return request("/api/games", {
    method: "POST",
    body: JSON.stringify({
      mode: "private_multiplayer",
      name: input.name,
      side: input.side,
      mapId: input.mapId,
      opponent: input.opponent
    })
  });
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `corepack pnpm --filter @sengoku-jidai/web exec vitest run src/client/api.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/web/src/client/api.ts packages/web/src/client/api.test.ts
git commit -m "feat(web): send opponent choice when creating a game"
```

---

### Task 9: `onClockSeat` helper

**Files:**
- Create: `packages/web/src/state/onClock.ts`
- Test: `packages/web/src/state/onClock.test.ts`

**Interfaces:**
- Produces: `export function onClockSeat(view: ClockView): SeatId | null` where `ClockView = { status: string; activeSeat: SeatId; pendingCombat: { responsibleSeat: SeatId } | null; pendingDecision: { seat: SeatId } | null }`.

- [ ] **Step 1: Write the failing test**

Create `packages/web/src/state/onClock.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { onClockSeat } from "./onClock.js";

const base = { status: "active" as const, activeSeat: "red" as const, pendingCombat: null, pendingDecision: null };

describe("onClockSeat", () => {
  it("returns null when the game is not active", () => {
    expect(onClockSeat({ ...base, status: "complete" })).toBeNull();
  });
  it("returns the active seat when nothing is pending", () => {
    expect(onClockSeat(base)).toBe("red");
  });
  it("prefers the combat responsible seat", () => {
    expect(onClockSeat({ ...base, pendingCombat: { responsibleSeat: "black" } })).toBe("black");
  });
  it("uses the pending decision seat over the active seat", () => {
    expect(onClockSeat({ ...base, pendingDecision: { seat: "black" } })).toBe("black");
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `corepack pnpm --filter @sengoku-jidai/web exec vitest run src/state/onClock.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the helper**

Create `packages/web/src/state/onClock.ts`:

```ts
import type { SeatId } from "@sengoku-jidai/engine/client";

/** Minimal shape of the player view needed to decide who is on the clock. */
export interface ClockView {
  status: string;
  activeSeat: SeatId;
  pendingCombat: { responsibleSeat: SeatId } | null;
  pendingDecision: { seat: SeatId } | null;
}

/**
 * The seat on the clock, mirroring the engine's onTheClock precedence
 * (pendingCombat → pendingDecision → activeSeat). Returns null when the game is not active.
 *
 * Note: the player view redacts the opponent's pendingDecision, so from a human viewer this
 * resolves the AI's clock via pendingCombat (visible) or activeSeat — which is exactly what the
 * "Computer is thinking…" indicator needs.
 */
export function onClockSeat(view: ClockView): SeatId | null {
  if (view.status !== "active") return null;
  if (view.pendingCombat) return view.pendingCombat.responsibleSeat;
  if (view.pendingDecision) return view.pendingDecision.seat;
  return view.activeSeat;
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `corepack pnpm --filter @sengoku-jidai/web exec vitest run src/state/onClock.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/web/src/state/onClock.ts packages/web/src/state/onClock.test.ts
git commit -m "feat(web): onClockSeat helper (who is on the clock)"
```

---

### Task 10: Opponent control in `CreateGameScreen`

**Files:**
- Modify: `packages/web/src/components/CreateGameScreen.tsx` (props line 8-13; `handleSubmit` line 52-58; add control near the side toggle line 95-109)
- Modify: `packages/web/src/App.tsx` (`handleCreate` line 354-381; `<CreateGameScreen onCreate>` usage line 758-763)
- Modify: `packages/web/src/styles/app.css` (reuse existing `side-toggle` styles; no new rule required unless spacing needs it)

**Interfaces:**
- Consumes: `createGame` `opponent` param (Task 8).
- Produces: `CreateGameScreenProps.onCreate: (name: string, side: SeatId, mapId: string, opponent: "human" | "ai") => void`.

- [ ] **Step 1: Update `CreateGameScreen` props + state + submit**

In `packages/web/src/components/CreateGameScreen.tsx`:

Change the prop type (line 12):

```ts
  onCreate: (name: string, side: SeatId, mapId: string, opponent: "human" | "ai") => void;
```

Add state (after the `side` state, line 22):

```ts
  const [opponent, setOpponent] = useState<"human" | "ai">("human");
```

Update `handleSubmit` (line 57):

```ts
    onCreate(trimmed, side, mapId, opponent);
```

- [ ] **Step 2: Add the opponent fieldset**

Immediately after the closing `</fieldset>` of the side toggle (line 109), add:

```tsx
          <fieldset className="side-toggle">
            <legend>Opponent</legend>
            <button
              type="button"
              aria-pressed={opponent === "human"}
              className={opponent === "human" ? "is-active" : ""}
              onClick={() => setOpponent("human")}
            >
              Human (invite a friend)
            </button>
            <button
              type="button"
              aria-pressed={opponent === "ai"}
              className={opponent === "ai" ? "is-active" : ""}
              onClick={() => setOpponent("ai")}
            >
              Computer (AI)
            </button>
          </fieldset>
```

- [ ] **Step 3: Thread `opponent` through `App.handleCreate`**

In `packages/web/src/App.tsx`, change `handleCreate` (line 354) to accept and forward `opponent`:

```ts
  async function handleCreate(name: string, side: SeatId, mapId: string, opponent: "human" | "ai") {
    setBusy(true);
    setError(null);
    try {
      const created = await createGame({ name, side, mapId, opponent });
```

(The rest of the function body is unchanged. The `<CreateGameScreen onCreate={handleCreate} />` usage at line 762 needs no change — the signature now matches.)

- [ ] **Step 4: Typecheck web**

Run: `corepack pnpm --filter @sengoku-jidai/web run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/web/src/components/CreateGameScreen.tsx packages/web/src/App.tsx
git commit -m "feat(web): opponent picker (human vs computer) on the create screen"
```

---

### Task 11: "Computer is thinking…" indicator

**Files:**
- Modify: `packages/web/src/components/PlayersPanel.tsx` (props line 33-41; render line 83-121)
- Modify: `packages/web/src/App.tsx` (compute `thinkingSeat`; pass to the main `<PlayersPanel>` usage)
- Modify: `packages/web/src/styles/app.css` (add `.player-thinking`)

**Interfaces:**
- Consumes: `onClockSeat` (Task 9); `GameSeatInfo.controller` (Task 7).
- Produces: `PlayersPanelProps.thinkingSeat?: SeatId | null` (optional, defaults to no indicator).

- [ ] **Step 1: Add the `thinkingSeat` prop + render**

In `packages/web/src/components/PlayersPanel.tsx`, add to `PlayersPanelProps`:

```ts
  thinkingSeat?: SeatId | null;
```

Destructure it (with default) in the component params:

```ts
  thinkingSeat = null,
```

Inside the `.map`, after computing `label`, add:

```ts
          const isThinking = seat.seat === thinkingSeat;
```

Add the indicator inside the `<li>`, after the seat pill (both the button and the read-only branch), e.g. append just before the closing `</li>`:

```tsx
              {isThinking ? (
                <span className="player-thinking" role="status" aria-live="polite">
                  Computer is thinking…
                </span>
              ) : null}
```

- [ ] **Step 2: Compute `thinkingSeat` in App and pass it**

In `packages/web/src/App.tsx`, add the import:

```ts
import { onClockSeat } from "./state/onClock.js";
```

Just before the main `<PlayersPanel .../>` render (the one showing the active game, near the side panel), compute:

```ts
  const clockSeat = onClockSeat(game.view);
  const thinkingSeat =
    clockSeat && game.seatInfo.find((s) => s.seat === clockSeat)?.controller === "ai"
      ? clockSeat
      : null;
```

Pass `thinkingSeat={thinkingSeat}` to that `<PlayersPanel>` usage. (Leave any secondary `PlayersPanel` usage untouched — the prop is optional.)

- [ ] **Step 3: Add a minimal style**

In `packages/web/src/styles/app.css`, add:

```css
.player-thinking {
  font-size: 0.8rem;
  font-style: italic;
  opacity: 0.75;
  margin-left: 0.5rem;
}
```

- [ ] **Step 4: Typecheck web**

Run: `corepack pnpm --filter @sengoku-jidai/web run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/web/src/components/PlayersPanel.tsx packages/web/src/App.tsx packages/web/src/styles/app.css
git commit -m "feat(web): show 'Computer is thinking…' while the AI seat is on the clock"
```

---

### Task 12: PR 2 gate + open PR

- [ ] **Step 1: Full gate (format LAST)**

```bash
corepack pnpm build:libs
corepack pnpm -r --sort run test
corepack pnpm lint
corepack pnpm -r run typecheck
corepack pnpm format
```
Expected: all PASS; commit any format restaging.

- [ ] **Step 2: Push and open PR**

```bash
git push -u origin ai-opponent-picker
gh pr create --fill --title "feat(web): opponent picker + AI thinking indicator"
```

- [ ] **Step 3: STOP — ask Martin before merging.** On approval: `gh pr checks <n> --watch` then `gh pr merge --squash`.

---

## Self-review notes

- **Spec coverage:** Worker offload → Tasks 1–5; async driver → Task 3; routes/buildApp wiring → Task 4; determinism test → Task 2; picker → Tasks 8, 10; `controller` field → Task 7; thinking indicator → Tasks 9, 11. All spec sections mapped.
- **Determinism:** equivalence asserted under `iterations` only (Task 2) — matches the Global Constraint.
- **Worker test location:** in `packages/server` (consumes ai dist) because vitest runs ai against `src` where the compiled worker `.js` is absent. Called out in Task 2.
- **Type consistency:** `runIsmctsInWorker(state, seat, opts)`, `IsmctsBotOptions`, `driveAiTurns(deps, gameId, pickCommand, maxSteps?)`, `aiPickCommandFor(gameId) => (seat, state) => Promise<Command>`, `onClockSeat(view)`, `GameSeatInfo.controller`, `PlayersPanelProps.thinkingSeat`, `CreateGameScreenProps.onCreate(name, side, mapId, opponent)` — used identically across producing/consuming tasks.
- **Both AI-seam call sites** (`aiGame.test.ts`, `mapsApi.test.ts`) updated in Task 5 (mapsApi passes it positionally inside an `opponent:'ai'` test, so it would otherwise fail).
