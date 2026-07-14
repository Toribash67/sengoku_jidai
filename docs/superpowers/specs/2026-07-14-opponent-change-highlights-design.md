# Opponent-change highlights: tile pulse + turn alert

**Date:** 2026-07-14
**Status:** Approved for planning

## Goal

Make an opponent's turn legible without hunting the board or missing that it's your move.
Backlog item #4 from the 2026-07-13 UX review, in two cooperating parts:

1. **Tile pulse** — when a poll picks up the opponent's events, briefly pulse every tile they
   changed, so you can see at a glance where the action was.
2. **Turn alert** — when it becomes your turn while the tab is backgrounded, flash the browser
   tab's title so you're pulled back.

Both are fed entirely by data the poll **already** fetches (the event delta and the view's
`activeSeat`). Web-only; no engine, rules, `GameState`, or server change.

## Non-goals

- No engine/rules/`GameState`/schema change, no new server endpoint.
- **No dynamic favicon.** There is no favicon in the app today, and the primary target is
  mobile, where iOS Safari ignores dynamic favicon swaps and surfaces the page *title* in its
  tab switcher. The title flash covers mobile and desktop; a favicon dot is a possible
  desktop-only follow-up, out of scope here.
- No animation of moving unit stacks (still deferred — `decorate()` rebuilds the overlay
  wholesale; a pulse on already-present tiles avoids that lift).
- No sound, no browser Notifications API, no service worker.
- No DOM/render unit tests (matches repo convention: pure helpers are unit-tested, timing and
  DOM behaviour is verified on the deploy + CI Browser Smoke).

## Background (current behaviour)

- The 3s poll in `App.tsx` runs only via `shouldPoll` (game active AND not the viewer's turn or
  the opponent hasn't joined). When `envelope.revision > current.revision` it fetches the event
  delta with `fetchEvents(gameId, token, current.revision)` into `newEvents`, then prepends them
  to the capped event log. Those `newEvents` are precisely the opponent's actions since the
  viewer last saw the game — the exact set we want to highlight.
- Events already carry tile ids (`packages/engine/src/commands.ts` `GameEvent`):
  `commanderDeployed.spaceId`, `unitsMoved.from`/`.to`, `unitsPlaced.area`, `bonusApplied.area`,
  `unitsRemoved.area`, `areaCaptured.area`, `capExceeded.area`. Non-spatial events
  (`passed`, `diceRolled`, `cardsDrawn`, `cardDiscarded`, `cardPlayed`, `turnAdvanced`,
  `recalled`, `initiativeSeized`, `gameEnded`) touch no tile.
- `MapBoard.decorate()` locates a tile by area id via `svg.querySelector("#" + CSS.escape(id))`
  and already mutates per-tile state (e.g. `tile.dataset.legalTarget`) and paints a selection
  outline layered above supply tints. `decorate()` re-runs from a `useEffect` keyed on `areas`,
  `selectedAreaId`, `legalTargetIds`, … — so a new prop naturally triggers a re-decorate.
- `isViewerActive = view.activeSeat === view.viewerSeat` is already computed at `App.tsx:753`.
- The tab title is static (`General Orders: Sengoku Jidai`, `index.html`); nothing reads or
  writes `document.title` or listens for `visibilitychange` today.

## Part 1 — Tile pulse

### `affectedTileIds` (pure helper)

New file `packages/web/src/components/board/eventTiles.ts`:

```ts
export function affectedTileIds(events: PlayerGameEvent[]): string[]
```

Walks the events and collects the tile id(s) each one touched (`area`, `to`, `from`, `spaceId`),
de-duplicated, order-stable (first-seen). Non-spatial events contribute nothing. Exhaustive over
the `GameEvent` union so a future spatial event is a compile error to forget. Pure and
unit-tested (mirrors `gameOver.ts` / `diceReveal.ts`).

### App wiring

- New state `const [flashAreaIds, setFlashAreaIds] = useState<ReadonlySet<string>>(new Set())`.
- In the poll's existing `if (newEvents.length > 0)` branch: compute
  `affectedTileIds(newEvents)`; if non-empty, `setFlashAreaIds(new Set(ids))` and start a
  `FLASH_MS` (~1500ms) timeout that clears it back to an empty set. The timeout handle lives in a
  ref so a fresh batch cancels the prior one; it is also cleared when the game/route changes and
  on unmount.
- Pass `flashAreaIds` to `<MapBoard>`.

### MapBoard rendering

- `MapBoardProps` gains `flashAreaIds?: ReadonlySet<string>` (optional; defaults to empty so the
  editor/preview call sites are unaffected). Add it to the decorate deps.
- In `decorate()`, for each area whose id is in `flashAreaIds`, paint a **pulsing outline** on
  that tile using the same top-of-stack outline mechanism as the selection outline (so it reads
  above supply tints and terrain art), with a distinct class `tile-flash-outline`.
- CSS: a `tile-flash` pulse keyframe (glow/opacity, in the spirit of the existing `glow-pulse`)
  that runs a small fixed number of iterations (e.g. `1.2s ease-out 1`, or 2–3 short pulses) and
  is gated off under `prefers-reduced-motion`. Colour: a neutral attention tone (not a seat
  colour, to avoid implying ownership) — final shade chosen during implementation.
- Because `decorate()` rebuilds the overlay each run, the outline is recreated on intervening
  re-decorations within the flash window; acceptable for a ~1.5s pulse. The `flashAreaIds` set is
  the single source of truth and empties itself, so nothing lingers.

## Part 2 — Turn alert

### Pure helpers

In a new file `packages/web/src/state/turnAlert.ts`:

```ts
export function shouldAlert(prevViewerTurn: boolean, nextViewerTurn: boolean, hidden: boolean): boolean
export function alertTitle(baseTitle: string): string   // e.g. "● Your move — <base>"
```

`shouldAlert` is true only on a false→true turn transition while the tab is hidden. Pure and
unit-tested (transition matrix + formatter).

### `useTurnAlert` hook

`useTurnAlert(isViewerTurn: boolean, baseTitle: string)` (co-located in `turnAlert.ts` or App):

- Captures the base title once (defaulting to the current `document.title`).
- Tracks the previous `isViewerTurn` in a ref. On each change, if
  `shouldAlert(prev, next, document.hidden)` set an internal "alerting" flag and write
  `alertTitle(baseTitle)` to `document.title`.
- Registers a `visibilitychange` listener: when the tab becomes visible, clear the flag and
  restore `baseTitle`.
- On unmount / game change, restore `baseTitle` and remove the listener.
- Only the DOM side effects live here; the decision and the string are the tested pure helpers.

### App wiring

Call `useTurnAlert(isViewerActive, baseTitle)` at the top level of the game screen, where
`isViewerActive` already exists. No alert fires for a game that isn't active (guard on status,
already part of `isViewerActive`).

## Data flow

```
poll tick ──▶ fetchEvents delta (existing) ──▶ affectedTileIds ──▶ flashAreaIds ──▶ MapBoard pulse
                                                                     └─(clears after ~1.5s)
render ──▶ isViewerActive ──▶ useTurnAlert ──▶ document.title flip (only when hidden) ──▶ restore on focus
```

## Files touched

- `packages/web/src/components/board/eventTiles.ts` (new) + `eventTiles.test.ts` (new)
- `packages/web/src/state/turnAlert.ts` (new) + `turnAlert.test.ts` (new)
- `packages/web/src/components/board/MapBoard.tsx` — `flashAreaIds` prop + flash outline in
  `decorate()`
- `packages/web/src/App.tsx` — `flashAreaIds` state + timeout in the poll branch; pass to
  MapBoard; `useTurnAlert` call
- `packages/web/src/styles/app.css` — `tile-flash` keyframe + `.tile-flash-outline`,
  reduced-motion guard

## Testing

- **`eventTiles.test.ts`** — each spatial event → its tile id(s); `unitsMoved` yields both
  `from` and `to`; dedup across a multi-event turn; non-spatial events contribute nothing; empty
  in → empty out.
- **`turnAlert.test.ts`** — `shouldAlert` matrix: only `(false→true, hidden)` is true;
  `(false→true, visible)`, `(true→true, hidden)`, `(true→false, *)` are false; `alertTitle`
  formats the base title.
- Full local gate (typecheck / test / build / lint / prettier) then CI to green. Pulse feel,
  timing, and the title flip verified on the deploy.

## Risks / edge cases

- **Own actions never flash.** The poll only runs when it isn't the viewer's turn, and the
  delta it fetches is the opponent's; the viewer's own command results flow through
  `submitCommand`, not the poll, so they are never added to `flashAreaIds`.
- **Tiles removed/renamed between views** — a flashed id that no longer resolves via
  `querySelector` is simply skipped (no throw), same as existing decorate lookups.
- **Rapid consecutive polls** — the timeout ref ensures only the latest batch's window is live;
  an empty `affectedTileIds` (opponent turn with only non-spatial events) leaves the board quiet.
- **Title restore** — base title is always restored on visibility-regain and on unmount, so a
  backgrounded-then-closed tab can't leave a stale title in history.
