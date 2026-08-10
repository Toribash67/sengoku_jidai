# AI-seat lifecycle hardening

_Design — 2026-08-10_

Two small server-only follow-ups surfaced by the whole-branch reviews of the AI
worker-offload (#120) and opponent-picker (#121) PRs. Both are pre-existing gaps
that became user-reachable once the web picker shipped. No web UI change.

## 1. Refuse claiming an AI-controlled seat

`GameRepository.claimSeat` flips any `status:"open"` seat to `claimed` with no
`controller` check. An AI game's AI seat is persisted `status:"open"` and its
token is held by the creator, so a saved/shared token hitting `POST
/api/games/:id/claim` would "claim" the AI seat — leaving a human display name on
a seat the computer still plays (`controllersOf` keeps returning `"ai"`).

**Decision:** refuse. A human may **not** take over an AI seat (AI seats are
non-transferable for the life of the game).

- `claimSeat` reads `controller` in its existing seat `SELECT` and returns a
  **discriminated result** instead of `{…} | null`:
  - `{ ok: true; revision; view; seatInfo }`
  - `{ ok: false; reason: "notFound" }` (game/seat missing)
  - `{ ok: false; reason: "aiSeat" }` (seat is computer-controlled — no DB write)
- The `/claim` route maps: `aiSeat → 409 seatNotClaimable` ("That seat is
  computer-controlled."), `notFound → 404 gameNotFound`, `ok → 200` (unchanged
  response shape).

## 2. Bounded retry in the production AI picker

`driveAiSoon`'s worker pick has no retry, so a transient worker crash (spawn
hiccup, OOM) rejects the drive, is logged, and stalls the AI seat until the next
accepted command — which can't come, because it's the AI's turn.

**Decision:** bounded per-think retry only (no whole-drive re-scheduling, which
could loop forever on a deterministic bug).

- Add a small, unit-testable helper `withRetry(fn, { attempts, delayMs })` that
  awaits `fn`, and on rejection retries up to `attempts` total with a short
  backoff, then rethrows the last error. It takes the async `fn` as a parameter
  so tests inject a fake (no real workers).
- The default `aiPickCommandFor` in `routes.ts` wraps its
  `runIsmctsInWorker(...)` call in `withRetry(..., { attempts: 3, delayMs: 50 })`.
  Transient failures self-heal; a truly deterministic failure exhausts the
  attempts, propagates to the existing `.catch → app.log.error`, and stops
  (no infinite loop). Test injections (in-process sync bots) are unaffected —
  they don't go through this default factory.

## Scope / non-goals

- Server package only (`repository.ts`, `routes.ts`, one small helper module,
  and tests). No web UI, no takeover, no schema/migration change.
- No re-scheduling of the whole drive on failure.

## Testing

- `claimSeat` returns `{ ok: false, reason: "aiSeat" }` for an AI seat (and does
  not write), `{ ok: true, … }` for a human open seat, `{ ok: false, reason:
  "notFound" }` for a missing game.
- `/claim` route: 409 `seatNotClaimable` for the AI seat; still 200 for a human
  open seat (existing `server.test.ts` HTTP claim test keeps passing).
- `withRetry`: resolves after `attempts-1` failures; rethrows the last error
  after exhausting `attempts`; calls `fn` exactly `attempts` times in the
  all-fail case.
