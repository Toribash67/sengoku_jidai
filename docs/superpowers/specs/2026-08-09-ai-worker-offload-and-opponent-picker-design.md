# AI follow-ups: worker-thread offload + web opponent picker

_Design — 2026-08-09_

Two independent, non-blocking follow-ups from the AI-opponent initiative (see
`2026-08-08-ai-opponent-design.md`). They ship as two focused PRs.

- **PR 1 — Worker-thread offload** (backend only): stop the ISMCTS think from
  blocking the Fastify event loop.
- **PR 2 — Opponent picker + "thinking" indicator** (server + web): let the game
  creator choose a human or AI opponent, and show when the computer is thinking.

---

## PR 1 — Worker-thread offload

### Problem

`IsmctsBot.chooseCommand` is synchronous and CPU-bound (~1.5s deadline). It runs
inside `driveAiTurns`, which is invoked on the main event loop via `setImmediate`
(`packages/server/src/api/routes.ts:41`). While the AI thinks, Fastify cannot
serve any request — health checks and the opponent's event polling stall for the
duration of every AI move.

### Approach

Run each ISMCTS think in a short-lived `worker_threads` worker: one worker per
`chooseCommand` call. A persistent pool is explicitly out of scope (YAGNI at
current traffic); the per-call spawn overhead (~tens of ms) is acceptable.

The worker path is used **only** by the server driver. The match harness
(`runMatch`/`runMatches`, which plays thousands of games) stays fully synchronous
and never spawns a worker.

### Changes

**`packages/ai`:**

- `src/ismcts.worker.ts` — worker entry point. Receives `{ state, seat, opts }`,
  runs `chooseCommandIsmcts(state, seat, opts)`, and posts back the resulting
  `Command`. `GameState` and `Command` are plain JSON-serializable data (the
  engine already round-trips state through a JSON deep-clone), so they transfer
  across the worker boundary cleanly.
- `src/ismctsWorkerRunner.ts` (exported as `runIsmctsInWorker`) —
  `runIsmctsInWorker(state, seat, opts): Promise<Command>`. Spawns the worker,
  awaits the posted `Command`, then terminates the worker. Resolves the compiled
  worker path via `new URL('./ismcts.worker.js', import.meta.url)` (dist-relative;
  the file ships in the `@sengoku-jidai/ai` dist that is already copied into the
  Docker image). Rejects if the worker errors or exits non-zero.
- Export `runIsmctsInWorker` (and its options type if needed) from
  `src/index.ts`.

**`packages/server`:**

- `src/ai/aiDriver.ts` — `driveAiTurns` becomes **async** (`Promise<void>`). It
  takes an injected `pickCommand(seat, state): Promise<Command>` in place of
  `botFor(seat) => Bot` / `.chooseCommand(...)`. The loop `await`s each pick.
  Rejection/illegal-command behavior is unchanged (throws → caller logs).
- `src/api/routes.ts` — `driveAiSoon` injects the worker-backed
  `pickCommand = (seat, state) => runIsmctsInWorker(state, seat, { deadlineMs: 1500, seed: gameId })`
  and `await`s `driveAiTurns` inside the `setImmediate` callback (still
  fire-and-forget from the request's perspective; failures still go to
  `app.log.error`). The `aiBotFor` injection seam is replaced by an injectable
  `pickCommand` factory so tests can substitute an in-process async chooser.

### Determinism

The worker runs the same `chooseCommandIsmcts` with the same seed
(`seed + state.revision`), so it produces an identical `Command` whether run
in-worker or in-process. This equivalence is directly asserted in tests.

### Testing

- New `packages/ai` test: `runIsmctsInWorker` returns an engine-legal command for
  a known state, and the returned command **equals** the in-process
  `chooseCommandIsmcts` result for the same state/seat/opts (verifies the
  serialization round-trip and determinism).
- `packages/server` `aiGame.test.ts`: switch the driver injection to an
  in-process async chooser (`async (seat, state) => new IsmctsBot({...}).chooseCommand(state, seat)`)
  so the end-to-end game test stays fast and deterministic without spawning
  workers. `driveAiTurns` calls become `await`ed.

---

## PR 2 — Opponent picker + "thinking" indicator

### Picker

Scope (decided): a **Human vs AI** toggle only. When AI is chosen, the AI seat
always uses the strongest bot (ISMCTS) — matching the server default today.
Choosing a difficulty/bot, or letting the AI take a chosen side, is out of scope.

**Web:**

- `CreateGameScreen` (`packages/web/src/components/CreateGameScreen.tsx`) gains an
  "Opponent" control with two choices: **Human (invite a friend)** (default) and
  **Computer (AI)**. Follows the existing `side-toggle` fieldset pattern.
- `onCreate` / `handleCreate` (`App.tsx:354`) thread the chosen opponent through.
- `createGame` (`packages/web/src/client/api.ts:18`) gains an
  `opponent?: 'human' | 'ai'` input and includes it in the POST body.

**Server:** no change needed — `POST /api/games` already reads
`opponent: 'ai'` and marks the non-creator seat AI (`routes.ts:298-309`).

### "Computer is thinking…" affordance

**Server / shared:**

- Add `controller: 'human' | 'ai'` to `GameSeatInfo`
  (`packages/shared/src/api.ts:10`).
- `getSeatInfo` (`packages/server/src/persistence/repository.ts:98`) includes
  `controller` in its `SELECT` and maps it onto each seat. The `controller`
  column already exists on `game_seats` (migration 007), so this is read-only —
  no schema change.

**Web:**

- Compute the on-the-clock seat from the player view, mirroring `onTheClock`:
  `pendingCombat.responsibleSeat` → `pendingDecision.seat` → `activeSeat`. Extract
  this as a small pure helper so it is unit-testable.
- When the game is `active` and the on-the-clock seat's `controller === 'ai'`,
  show an unobtrusive "Computer is thinking…" indicator near the active-seat
  marker / players panel. The indicator is derived purely from the polled view +
  seatInfo (no new polling); it naturally clears when the AI's move lands and the
  clock passes back to the human.

### Testing

- `packages/web` api test: `createGame({ opponent: 'ai' })` includes
  `opponent: 'ai'` in the request body; omitting it stays backward-compatible.
- `packages/web` pure-helper test: "which seat is on the clock" for the
  pending-combat / pending-decision / active-seat cases, and "is that seat AI"
  given seatInfo.
- Update any existing web tests / snapshots affected by the new `controller`
  field on `GameSeatInfo`.

---

## Out of scope (deferred, per the AI-opponent memory)

- Persistent worker pool (concurrency across many simultaneous AI games).
- Bot / difficulty selection in the picker.
- Letting the AI take a creator-chosen side (today it always takes the
  non-creator seat).
