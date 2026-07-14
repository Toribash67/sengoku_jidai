# Richer event log

**Date:** 2026-07-14
**Status:** Approved for planning

## Goal

Make the "Recent events" panel actually readable. Backlog item #6 from the 2026-07-13 UX
review, three changes:

1. **Name the area** each event touched (via `describeArea`), instead of "captured an area".
2. **Player names** (from `seatInfo`) instead of raw seat colours ("red"/"black").
3. **Full history, no cap** — load the whole log on (re)load and stop dropping to the last 8, so
   reloading or switching seats no longer throws history away.

Web-only; no engine/server change. The server already serves the full per-seat event history
from revision 0.

## Non-goals

- No engine/rules/`GameState`/schema/server change.
- No unique per-tile names. `describeArea` labels are generic by design ("Inland",
  "Coastal land", "Sea", "Harbour", "Red/Black HQ") because tiles have no names and raw ids stay
  hidden ([[feedback-no-tile-ids-in-ui]]). A move may read "Inland → Inland"; still better than
  the current label and exactly what the backlog asked for.
- No new event *content* — same `GameEvent` union, richer phrasing only.
- No DOM/render unit tests (repo convention: the label function is pure and unit-tested).

## Background (current behaviour)

- The log renders in the side panel (`App.tsx` ~1011) from `events` state, labelled by a local,
  untested `eventLabel(event)` that emits raw seat colours and "captured an area".
- `events` is newest-first. It is set `[]` on route-load, create-game, and view-as switch, and
  every writer caps with `.slice(0, 8)` (the poll and the four command handlers).
- `describeArea(mapArea)` (`components/board/areaLabel.ts`) gives the human label;
  `getMap(mapId).areas[tileId]` resolves a tile id → `MapArea`.
- `seatDisplayName(seat, seatInfo)` (`components/board/gameOver.ts`) already returns a player
  name with a capitalised-seat fallback.
- `fetchEvents(gameId, token, after)` returns events with revision > `after`, ascending; the poll
  calls it with `current.revision`. `after = 0` returns the whole history.

## Change 1 + 2 — `describeEvent` (extract + enrich)

New pure module `packages/web/src/components/board/eventLog.ts`:

```ts
export interface EventLookup {
  seatName: (seat: SeatId) => string;
  areaName: (tileId: string) => string;
}
export function describeEvent(event: PlayerGameEvent, lookup: EventLookup): string
```

Injecting the two lookups keeps `describeEvent` pure and unit-testable without a map or DOM. App
supplies `seatName = s => seatDisplayName(s, seatInfo)` and
`areaName = id => describeArea(getMap(view.mapId).areas[id])`.

Phrasing (player names throughout):

- `areaCaptured` → `"<seat> captured <area>"`, and `" from <previousOwner>"` when set.
- `unitsMoved` → `"<seat> moved <n> <unit(s)> — <fromArea> → <toArea>"`.
- `unitsPlaced` → `"<seat> placed <n> <unit(s)> on <area>"`.
- `unitsRemoved` → `"<seat> lost <n> <unit(s)> at <area>"`.
- `commanderDeployed` → `"<seat> deployed a commander to <area>"`.
- `bonusApplied` → `"<seat> used a bonus at <area>"`.
- `capExceeded` → `"<n> <unit(s)> returned from <area> (over cap)"`.
- Non-spatial keep today's wording but with player names: `diceRolled`, `unitsRemoved` pluralise
  as now; `passed`, `cardsDrawn`, `cardDiscarded`, `cardPlayed`, `turnAdvanced`, `recalled`,
  `initiativeSeized`, `gameEnded`.

A shared `plural(count, noun)` helper keeps the `1 troop` / `2 troops` logic in one place.

`App.tsx` drops its local `eventLabel` and renders `describeEvent(event, lookup)`; the lookup is
memoised on `[seatInfo, mapId]`.

## Change 3 — full history, no cap

- **Load the full log** where the log is currently cleared to the last-seen tail:
  - Route-load (`~186`) and view-as switch (`~428`): after the view loads, fetch
    `fetchEvents(gameId, token, 0)` and set it newest-first. Wrapped so a history-fetch failure
    yields `[]` and never fails the whole load. A small local `loadHistory(gameId, token)` helper
    does the fetch + reverse.
  - Create-game (`~372`): stays `[]` — a new game has no events yet.
- **Drop `.slice(0, 8)`** in the poll and the four command handlers; also reverse the command
  handlers' `response.events` so a multi-event command reads newest-first like the poll already
  does (small consistency fix on lines already being touched).
- **Scrollable panel**: `.event-log` gets a `max-height` + `overflow-y: auto` so a long game
  doesn't blow out the side panel.

## Files touched

- `packages/web/src/components/board/eventLog.ts` (new) + `eventLog.test.ts` (new)
- `packages/web/src/App.tsx` — use `describeEvent`; `loadHistory` on route-load + seat switch;
  drop the caps; reverse command events
- `packages/web/src/styles/app.css` — scrollable `.event-log`

## Testing

`eventLog.test.ts` (pure, stub lookups):

- Each event type formats as specified; capture includes previous owner when set and omits it
  when null; move shows both endpoints.
- Singular vs plural units.
- `seatName`/`areaName` are actually used (stub returning sentinel values appears in output).
- Player-name fallback verified by wiring a `seatName` stub that mimics `seatDisplayName`.

Full local gate (typecheck / test / build / lint / prettier) then CI to green. Panel scrolling
and phrasing verified on the deploy.

## Risks / edge cases

- **Unknown/missing tile** — `getMap(...).areas[id]` could be undefined for a stale id; `areaName`
  guards and falls back to a neutral "an area" rather than throwing.
- **History size** — unbounded, but the log is text-only and scrolls; a full game is a few dozen
  entries. Acceptable per the "don't cap" requirement.
- **Per-seat redaction** — history is fetched with the active seat's token, so a view-as switch
  correctly reloads that seat's own (redacted) history.
