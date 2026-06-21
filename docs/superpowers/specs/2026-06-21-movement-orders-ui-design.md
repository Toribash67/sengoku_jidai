# Movement Orders in the UI — Design

**Date:** 2026-06-21
**Status:** Approved (brainstorm)
**Scope:** Let a player issue **Advance** and **Sail** orders from the interactive
SVG board. Today the UI can only `pass`.

## Background

The engine already fully *resolves* movement:

- `validateAdvance` / `validateSail` (`engine/src/validate.ts`) enforce legality.
- `applyAdvance` / `applySail` + `resolveMoveIn` (`engine/src/actions.ts`) move
  troops/ships and resolve conflict.
- `advanceSources` / `sailReachable` (`engine/src/legality.ts`) compute legal
  source areas.
- The shared command schema and `submitCommand` endpoint already accept the
  `advance` / `sail` command shapes; the web already uses `submitCommand` for `pass`.

The gap is **discovery**: `legalCommandsForState` (`engine/src/view.ts`) emits only a
per-space *deployability* boolean (`LegalSpace.legal`). It does not tell the UI which
targets are reachable, which source areas can feed a given target, or how many units
each source can spare. Without that, the web would have to re-derive engine legality —
which we will not do.

A movement order is issued by deploying a commander to a **target-linked action
space** (`advance-<landId>` / `sail-<seaId>`); the linked area is the area you move
*into*. The command carries `moves: [{ from, count }]` naming the source areas and
counts. At least one unit must be left behind in each source (`count ≤ units − 1`).
The target must not already be controlled by the acting seat.

## Goals

- A player whose turn it is can advance troops into a linked land and sail ships into
  a linked sea, entirely from the board UI.
- Legal targets and sources are surfaced by the engine (single source of truth) and
  shown on the map.
- Rejections surface as readable messages; no silent failures.

## Non-goals (deferred)

- Bombard, Shell, Reinforce, Embark, Plan (the other five actions).
- Operation cards / pending decisions, Fortress/Siege.
- WebSocket realtime; the existing fetch-on-action flow stays.

## Section 1 — Engine: enrich the `legal` payload

**Approach A (chosen):** enumerate movement options inside `legalCommandsForState`
and carry them on the existing `LegalCommandSummary`.

New type in `engine/src/view.ts`:

```ts
export interface LegalMove {
  spaceId: string;          // "advance-tile9" | "sail-tile22"
  type: "advance" | "sail";
  targetAreaId: string;     // linked land/sea you move INTO
  sources: { areaId: string; max: number }[]; // max = units there − 1
}
```

`LegalCommandSummary` gains `moves: LegalMove[]`.

Enumeration rules (reusing existing primitives):

- Only when the deploy gate passes (`status === "active"`, `phase === "deploy"`,
  `activeSeat === seat`, no pending decision, `available(state, seat) > 0`).
- For each free `advance-<land>` space whose land the seat does **not** own: sources =
  `advanceSources(map, board, seat, land)`, each capped at `units.troop − 1`; keep only
  sources with `max ≥ 1`. Emit the target only if ≥1 source remains.
- For each free `sail-<sea>` space whose sea the seat does **not** own: sources =
  `sailReachable(map, board, seat, sea)`, each capped at `units.ship − 1`; same filter.

`spaces` and `canPass` are unchanged. The field flows through `playerView` → API →
web with no new endpoint. Rejected alternatives: a lazy per-target engine call (extra
round-trips, more API surface) and re-deriving sources in the web (drift).

## Section 2 — Front-end: order-composition flow

A small state machine in `App.tsx` (extractable to a `useOrderComposer` hook):

- **idle** — your turn, no order started. Map glows every `legal.moves[].targetAreaId`.
  Panel shows selected-area details (as today); if the selected area is a legal target,
  an **"Advance into X" / "Sail into X"** call-to-action button appears. `Pass` stays
  available.
- **composing** — a target is chosen. State:
  `{ spaceId, type, targetAreaId, counts: Map<sourceAreaId, number> }`. Panel lists each
  legal source with a `[−] n [+]` stepper capped at that source's `max`, plus a running
  total. Map glows the source tiles. Clicking a glowing source tile bumps its count +1
  (capped). Buttons: **Confirm** (enabled when total ≥ 1) and **Cancel** (→ idle).
- **submitting** — Confirm builds `{ type, spaceId, moves }` (zero-count sources
  dropped) and calls `submitCommand`. Success → update view/revision, prepend events,
  reset to idle, clear selection. Reject → stay composing, show message.

Components:

- New `OrderComposer.tsx` — the panel UI for the composing state (source steppers,
  total, Confirm/Cancel).
- `AreaDetails.tsx` — gains the "Advance/Sail into X" CTA when the selected area is a
  legal movement target.

Not-your-turn → no glow, no compose button (read-only, as today). Seat-switcher,
draggable divider, and clear-game are unchanged.

## Section 3 — Map highlighting

`MapBoard` gains optional props `legalTargetIds: Set<string>` and
`sourceIds: Set<string>`. Two overlay styles are painted in the existing overlay layer
(so they obey the `getScreenCTM`-composed local→viewBox matrix rule documented in
`MapBoard.tsx`, **not** `getCTM()`):

- **Target glow** — gold ring, shown in idle state on legal targets.
- **Source glow** — green ring, shown while composing on legal sources.

The selected target keeps the existing selection outline. Owner/supply tinting and unit
token stacks are unchanged.

## Section 4 — Errors, edges, testing

- **Rejections** → friendly inline text in the existing panel `error` slot, mapping
  `RejectionReason.code` to a short message (raw `message` as fallback).
- **Staleness** — a rejected/late command (revision moved on) shows the error and
  refetches the view.
- **Tests:**
  - Engine unit tests for `moves` enumeration: correct sources and `max = units − 1`;
    target excluded when already owned, when no source has a spare unit, when the space
    is occupied, when not the deploy phase, and when not the viewer's turn.
  - An e2e (Playwright, extends the hotseat smoke) that creates a game, advances a troop
    into an adjacent area, and asserts the unit moved.

## Decisions locked

- Scope = Advance + Sail only.
- Interaction = map-driven, target-first.
- Clicking a glowing source bumps its count +1.
- After a successful order the displayed seat does **not** auto-switch (manual
  seat-switcher, as today).
- Source glow = green, target glow = gold.
