# AI-seat lifecycle hardening — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Refuse claiming an AI-controlled seat, and make a transient AI-worker failure self-heal with a bounded retry instead of stalling the seat.

**Architecture:** Server-package only. `claimSeat` gains a `controller` check and returns a discriminated result the `/claim` route maps to HTTP; the production AI picker wraps its worker call in a small bounded-retry helper.

**Tech Stack:** TypeScript (ESM), Fastify, better-sqlite3, Vitest, pnpm workspaces.

## Global Constraints

- ESM: relative imports use `.js` extensions from `.ts` sources.
- Server package only — no web, no shared, no schema/migration change.
- Bounded retry only — never re-schedule the whole drive on failure (infinite-loop risk).
- Pre-push gate (in order, format LAST): `corepack pnpm build:libs` → `corepack pnpm -r --sort run test` → `corepack pnpm lint` → `corepack pnpm -r run typecheck` → `corepack pnpm format`.
- One focused branch off `main`; ask before merging; squash-merge; merge-on-green via `gh pr checks <n> --watch` then `gh pr merge --squash`.

---

Branch: `git switch -c ai-seat-hardening`

## File structure

- Modify `packages/server/src/persistence/repository.ts` — `claimSeat` returns a discriminated result, refuses AI seats.
- Modify `packages/server/src/api/routes.ts` — `/claim` maps the result to HTTP; default picker wraps `runIsmctsInWorker` in `withRetry`.
- Create `packages/server/src/ai/withRetry.ts` — bounded async retry helper.
- Modify `packages/server/test/repository.test.ts` — adapt to the discriminated result; add the AI-seat refusal case.
- Create `packages/server/test/withRetry.test.ts` — retry helper unit tests.
- Modify `packages/server/test/server.test.ts` — add a 409 case for claiming the AI seat (the existing 200 human-claim test is unchanged).

---

### Task 1: Refuse claiming an AI-controlled seat

**Files:**
- Modify: `packages/server/src/persistence/repository.ts` (`claimSeat`, lines 285-313)
- Modify: `packages/server/src/api/routes.ts` (`/claim` handler, lines 358-369)
- Modify: `packages/server/test/repository.test.ts` (lines 44-60)
- Modify: `packages/server/test/server.test.ts` (add a case after the existing claim test ~line 76)

**Interfaces:**
- Produces: `claimSeat(gameId, seat, name): ClaimResult` where
  `type ClaimResult = { ok: true; revision: number; view: PlayerGameView; seatInfo: GameSeatInfo[] } | { ok: false; reason: "notFound" | "aiSeat" }`.

- [ ] **Step 1: Write the failing repository test (AI-seat refusal + adapt existing)**

In `packages/server/test/repository.test.ts`, update the existing claim tests to the new shape and add the refusal case. Replace the three claim tests (lines 44-60) with:

```ts
  it("claims the open seat by setting its name", () => {
    const repo = makeRepo();
    const game = repo.createGame("private_multiplayer", "s4", { creatorName: "Oda" });

    const claimed = repo.claimSeat(game.gameId, "black", "Takeda");
    expect(claimed.ok).toBe(true);
    if (!claimed.ok) throw new Error("expected ok");
    expect(bySeat(claimed.seatInfo, "black")).toMatchObject({ name: "Takeda", status: "claimed" });

    // Re-claim on an already-claimed seat is a no-op on the name.
    const again = repo.claimSeat(game.gameId, "black", "Someone Else");
    if (!again.ok) throw new Error("expected ok");
    expect(bySeat(again.seatInfo, "black").name).toBe("Takeda");
  });

  it("returns notFound when claiming a seat in a missing game", () => {
    const repo = makeRepo();
    expect(repo.claimSeat("no-such-game", "red", "Ghost")).toEqual({
      ok: false,
      reason: "notFound"
    });
  });

  it("refuses to claim an AI-controlled seat and leaves it unchanged", () => {
    const repo = makeRepo();
    const game = repo.createGame("private_multiplayer", "s5", {
      creatorName: "Oda",
      creatorSide: "red",
      aiSeats: ["black"]
    });

    expect(repo.claimSeat(game.gameId, "black", "Intruder")).toEqual({
      ok: false,
      reason: "aiSeat"
    });
    // The AI seat is untouched: still controller ai, no human name.
    const info = repo.getSeatInfo(game.gameId);
    expect(bySeat(info, "black").controller).toBe("ai");
    expect(bySeat(info, "black").name).toBeNull();
  });
```

- [ ] **Step 2: Run to verify it fails**

Run: `corepack pnpm --filter @sengoku-jidai/server exec vitest run test/repository.test.ts`
Expected: FAIL — `claimSeat` still returns `{…} | null` (`.ok` is undefined; the missing-game case returns `null`, not the object).

- [ ] **Step 3: Rewrite `claimSeat` to a discriminated result with the AI guard**

In `packages/server/src/persistence/repository.ts`, replace `claimSeat` (lines 285-313) with:

```ts
  claimSeat(
    gameId: string,
    seat: SeatId,
    name: string
  ):
    | { ok: true; revision: number; view: PlayerGameView; seatInfo: GameSeatInfo[] }
    | { ok: false; reason: "notFound" | "aiSeat" } {
    const game = this.getGameRow(gameId);
    if (!game) {
      return { ok: false, reason: "notFound" };
    }
    const row = this.db
      .prepare("SELECT status, controller FROM game_seats WHERE game_id = ? AND seat = ?")
      .get(gameId, seat) as { status: SeatStatus; controller: "human" | "ai" } | undefined;
    if (!row) {
      return { ok: false, reason: "notFound" };
    }
    if (row.controller === "ai") {
      return { ok: false, reason: "aiSeat" };
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
      ok: true,
      revision: game.current_revision,
      view: playerView(state, seat),
      seatInfo: this.getSeatInfo(gameId)
    };
  }
```

- [ ] **Step 4: Update the `/claim` route to map the result**

In `packages/server/src/api/routes.ts`, replace the claim result handling (lines 358-369) with:

```ts
    const result = repository.claimSeat(params.data.gameId, session.seat, body.data.name);
    if (!result.ok) {
      if (result.reason === "aiSeat") {
        return sendError(reply, 409, "seatNotClaimable", "That seat is computer-controlled.");
      }
      return sendError(reply, 404, "gameNotFound", "Game was not found.");
    }

    return reply.send({
      gameId: params.data.gameId,
      seat: session.seat,
      revision: result.revision,
      view: result.view,
      seatInfo: result.seatInfo
    });
```

- [ ] **Step 5: Add the HTTP 409 case in `server.test.ts`**

In `packages/server/test/server.test.ts`, add a test (after the existing claim test, ~line 78) that creates an AI game and claims the AI seat via its token, expecting 409. Mirror the existing claim test's setup (it creates a game and reads the black seat token from the create response). Concretely:

```ts
  it("refuses to claim the AI-controlled seat", async () => {
    const app = buildApp(testConfig());
    const created = await app.inject({
      method: "POST",
      url: "/api/games",
      payload: { mode: "private_multiplayer", name: "Oda", side: "red", opponent: "ai" }
    });
    const body = created.json();
    const blackToken = body.seats.find((s: { seat: string }) => s.seat === "black").token;

    const res = await app.inject({
      method: "POST",
      url: `/api/games/${body.gameId}/claim`,
      headers: { authorization: `Bearer ${blackToken}` },
      payload: { name: "Intruder" }
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe("seatNotClaimable");
    await app.close();
  });
```

Check the top of `server.test.ts` for how it builds the app / config (`buildApp`, `testConfig`) and reuse those exact helpers; if it uses a different setup pattern for the existing claim test, mirror that instead. Do NOT inject an `aiPickCommandFor` — the AI drive firing here is harmless (the test asserts the 409 synchronously), but if the real worker slows the test, inject a fast in-process picker exactly like `mapsApi.test.ts` does: `aiPickCommandFor: () => (seat, state) => Promise.resolve(new RandomBot(createAiRng(1)).chooseCommand(state, seat))` (import `RandomBot`, `createAiRng` from `@sengoku-jidai/ai`).

- [ ] **Step 6: Run all affected tests**

Run: `corepack pnpm --filter @sengoku-jidai/ai build && corepack pnpm --filter @sengoku-jidai/server exec vitest run test/repository.test.ts test/server.test.ts`
Expected: PASS.

- [ ] **Step 7: Server typecheck**

Run: `corepack pnpm --filter @sengoku-jidai/server run typecheck`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add packages/server/src/persistence/repository.ts packages/server/src/api/routes.ts packages/server/test/repository.test.ts packages/server/test/server.test.ts
git commit -m "feat(server): refuse claiming an AI-controlled seat (409)"
```

---

### Task 2: Bounded retry in the production AI picker

**Files:**
- Create: `packages/server/src/ai/withRetry.ts`
- Modify: `packages/server/src/api/routes.ts` (default `aiPickCommandFor`, lines 37-38 area)
- Test: `packages/server/test/withRetry.test.ts`

**Interfaces:**
- Produces: `export function withRetry<T>(fn: () => Promise<T>, opts: { attempts: number; delayMs: number }): Promise<T>` (from `packages/server/src/ai/withRetry.ts`).

- [ ] **Step 1: Write the failing test**

Create `packages/server/test/withRetry.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { withRetry } from "../src/ai/withRetry.js";

describe("withRetry", () => {
  it("resolves after attempts-1 failures", async () => {
    let calls = 0;
    const fn = vi.fn(async () => {
      calls += 1;
      if (calls < 3) throw new Error(`fail ${calls}`);
      return "ok";
    });
    await expect(withRetry(fn, { attempts: 3, delayMs: 0 })).resolves.toBe("ok");
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it("rethrows the last error after exhausting attempts", async () => {
    let calls = 0;
    const fn = vi.fn(async () => {
      calls += 1;
      throw new Error(`fail ${calls}`);
    });
    await expect(withRetry(fn, { attempts: 3, delayMs: 0 })).rejects.toThrow("fail 3");
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it("does not retry on first success", async () => {
    const fn = vi.fn(async () => "first");
    await expect(withRetry(fn, { attempts: 3, delayMs: 0 })).resolves.toBe("first");
    expect(fn).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `corepack pnpm --filter @sengoku-jidai/server exec vitest run test/withRetry.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the helper**

Create `packages/server/src/ai/withRetry.ts`:

```ts
/** Await `fn`, retrying up to `attempts` total on rejection with a fixed `delayMs` backoff
 *  between tries, then rethrowing the last error. Bounded on purpose: a deterministic failure
 *  exhausts the attempts rather than looping forever. */
export async function withRetry<T>(
  fn: () => Promise<T>,
  opts: { attempts: number; delayMs: number }
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= opts.attempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      if (attempt < opts.attempts && opts.delayMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, opts.delayMs));
      }
    }
  }
  throw lastError;
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `corepack pnpm --filter @sengoku-jidai/server exec vitest run test/withRetry.test.ts`
Expected: PASS.

- [ ] **Step 5: Wire it into the default picker**

In `packages/server/src/api/routes.ts`, add the import near the other ai/driver imports:

```ts
import { withRetry } from "../ai/withRetry.js";
```

Change the default `aiPickCommandFor` factory (currently
`(gameId) => (seat, state) => runIsmctsInWorker(state, seat, { deadlineMs: 1500, seed: gameId })`)
to wrap the worker call in a bounded retry:

```ts
  aiPickCommandFor: (gameId: string) => (seat: SeatId, state: GameState) => Promise<Command> = (
    gameId
  ) => (seat, state) =>
    withRetry(() => runIsmctsInWorker(state, seat, { deadlineMs: 1500, seed: gameId }), {
      attempts: 3,
      delayMs: 50
    })
```

- [ ] **Step 6: Server typecheck + the AI end-to-end test still passes**

Run: `corepack pnpm --filter @sengoku-jidai/ai build && corepack pnpm --filter @sengoku-jidai/server run typecheck && corepack pnpm --filter @sengoku-jidai/server exec vitest run test/aiGame.test.ts`
Expected: PASS (the e2e test injects its own sync picker, so it bypasses the retry-wrapped default — this just confirms no typecheck/wiring regression).

- [ ] **Step 7: Commit**

```bash
git add packages/server/src/ai/withRetry.ts packages/server/src/api/routes.ts packages/server/test/withRetry.test.ts
git commit -m "feat(server): bounded retry for the AI worker pick (self-heal transient failures)"
```

---

### Task 3: Gate + open PR

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
git push -u origin ai-seat-hardening
gh pr create --fill --title "feat(server): harden AI-seat lifecycle (refuse claim + bounded worker retry)"
```

- [ ] **Step 3: STOP — ask before merging.** On approval: `gh pr checks <n> --watch` then `gh pr merge --squash`.

---

## Self-review notes

- **Spec coverage:** claim refusal → Task 1 (repo + route + tests); bounded retry → Task 2 (helper + wiring + tests). All spec sections mapped.
- **Ripple handling:** every `claimSeat` caller updated — `routes.ts` (Task 1 Step 4) and `repository.test.ts` (Task 1 Step 1). `server.test.ts`'s existing 200 claim test is unaffected (success shape unchanged); a 409 case is added.
- **Type consistency:** `ClaimResult` discriminated union used identically in `claimSeat`, the route, and the tests. `withRetry<T>(fn, { attempts, delayMs })` signature matches producer and all consumers.
- **No infinite loop:** retry is bounded (`attempts: 3`); no whole-drive re-scheduling, per the Global Constraint.
