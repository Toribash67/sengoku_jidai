# Game-status HUD: game-over overlay, initiative marker, round clock

**Date:** 2026-07-13
**Status:** Approved for planning

## Goal

Make the stakes of a game visible. Three additions in one PR:

1. **Round clock** — show `Round N / max` so players feel the clock ticking toward final scoring.
2. **Initiative marker** — show who holds initiative (goes first next round + wins the final-VP tie).
3. **Game-over overlay + banner** — give a match a real ending: who won, why, final score.

All three read state the view already computes; only the round clock needs a new (additive)
view field. The rest is web-only.

## Non-goals

- No engine/rules changes, no `GameState` shape change, no multiplayer/session change.
- No full game-to-completion e2e test (games are long; rely on CI Browser Smoke + manual check).
- No redesign of the scoreboard or action bar beyond these three additions.

## 1. Round clock

**Engine.** Add `maxRounds: number` to the `PlayerGameView` interface
(`packages/engine/src/view.ts`), populated in `playerView` from `state.rules.maxRounds`.

- The view is a projection type, not Zod-validated by `stateSchema.ts`, so no schema change.
- The field reaches the web through the existing `@sengoku-jidai/engine/client` re-export of
  `PlayerGameView` — no `client.ts` change.

**Web.** In the `App.tsx` scoreboard `.round-meta`, render the round as two elements:

```jsx
<span className="round-no">Round {game.view.round}</span>
<span className="round-total">/ {game.view.maxRounds}</span>
```

Keeping `Round {round}` as its own element preserves its exact text content, so the existing
e2e assertions `page.getByText("Round 1", { exact: true })`
(`tests/e2e/hotseat.spec.ts`, `tests/e2e/map-editor.spec.ts`) keep matching — no spec changes.
`.round-total` is styled in the muted secondary color.

## 2. Initiative marker

**Web only.** Driven by `game.view.initiative` (already on the view).

A gold war-banner glyph (`⚑`, color `--kin`) rendered next to the current holder in the
scoreboard: immediately before the `RED` side-label when red holds, immediately after the
`BLACK` side-label when black holds (mirrors the scoreboard's outward-facing symmetry). The
glyph is `aria-hidden`; a visually-hidden span carries the accessible text
`"{Side} holds initiative"`.

- New CSS class `.score-initiative` (gold, sized to sit with the side label).
- A `.visually-hidden` utility class if one does not already exist (clip-rect pattern).
- Placement is conditional per side; when initiative flips, the glyph moves to the other side on
  the next view.

## 3. Game-over overlay + banner

**Web only.** Reads `status`, `winner`, `endReason`, `victoryPoints` (all on the view) and
player names from `seatInfo` (`GameSeatInfo.name: string | null`).

### Pure helpers (unit-tested — web has no jsdom)

Placed in a new `packages/web/src/components/board/gameOver.ts`:

- `endReasonText(endReason: "hqEliminated" | "victoryPoints"): string`
  - `hqEliminated` → `"Captured the enemy headquarters"`
  - `victoryPoints` → `"Most supply points at the final round"`
- `seatDisplayName(seat: SeatId, seatInfo: GameSeatInfo[]): string`
  - returns the seat's `name` if present, else the capitalized seat (`"Red"` / `"Black"`).

### `GameOverOverlay` component

New `packages/web/src/components/GameOverOverlay.tsx`. Full-screen fixed scrim, same structural
pattern as `CardPreview` (`.card-preview-overlay`). Contents:

- Headline: `⚑ {winnerName} wins` (winner via `seatDisplayName(view.winner, seatInfo)`).
- Reason line: `endReasonText(view.endReason)`.
- Final score: `{vp.red} — {vp.black}`, each number in its faction color.
- Actions: **New game** (`navigateTo("/")`) and **View final board** (dismiss).

Props are plain data + two callbacks (`onNewGame`, `onDismiss`); no view/engine coupling beyond
the already-client-safe types.

### Dismiss model (in `App.tsx`)

- New state `const [dismissedEndFor, setDismissedEndFor] = useState<string | null>(null)`.
- Overlay renders when `view.status === "complete" && view.winner !== null && dismissedEndFor !== game.gameId`.
- **View final board** → `setDismissedEndFor(game.gameId)`.
- Keying on `gameId` means the dismiss auto-resets for a different game and is stable across the
  3-second poll (polling replaces the view, never touches `dismissedEndFor`).

### Terminal-state banner (action-bar slot)

The board column already swaps the `ActionBar` for `CombatPanel` / `PendingDecisionPanel` via a
conditional chain. Extend it: when the game is over, show a slim terminal banner in that slot
instead of the `ActionBar`.

- `status === "complete"`: `"Game over — {winnerName} wins {vp.red}–{vp.black}"` plus a
  **Show result** button that reopens the overlay (`setDismissedEndFor(null)`).
- `status === "abandoned"`: `"Game abandoned"` (no button, no overlay). This replaces today's
  misleading `"Waiting for the other player…"` idle text for a finished-but-abandoned game.

Ordering in the chain: `pendingCombat` → `pendingDecision` → terminal banner (complete/abandoned)
→ `ActionBar`. A completed game has no pending combat/decision in practice, but this order is
defensive and unambiguous.

## Testing

- **Engine:** extend the existing `playerView` test to assert `maxRounds` equals the rules value.
- **Web (pure-logic only):** unit tests for `endReasonText` (both reasons) and `seatDisplayName`
  (named seat, null-name fallback for both sides).
- **No component-render tests** (no jsdom in web — matches the rest of the package).
- **CI Browser Smoke** remains the integration gate; existing e2e specs are unaffected by the
  round-clock markup (see §1).

### Manual check (post-merge, Martin)

- Round clock shows `Round N / 4`.
- ⚑ sits by the initiative holder and moves when a `Plan (★)` seizes initiative.
- Playing a game to its end shows the overlay with the correct winner name, reason, and score;
  **View final board** dismisses to the board with a "Game over" banner; **Show result** reopens
  it; **New game** returns to the start screen.

## Files touched

- `packages/engine/src/view.ts` — add + populate `maxRounds`.
- `packages/engine/test/view.test.ts` — assert `maxRounds`.
- `packages/web/src/App.tsx` — round-clock markup, initiative glyph, `dismissedEndFor` state,
  terminal banner in the action-bar slot, render `GameOverOverlay`.
- `packages/web/src/components/GameOverOverlay.tsx` — new.
- `packages/web/src/components/board/gameOver.ts` — new pure helpers.
- `packages/web/src/components/board/gameOver.test.ts` — new tests.
- `packages/web/src/styles/app.css` — `.round-total`, `.score-initiative`, `.visually-hidden`,
  game-over overlay + banner styles (reusing overlay/panel tokens where possible).
