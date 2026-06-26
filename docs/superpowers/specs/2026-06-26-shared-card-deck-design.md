# Shared operation-card deck

**Date:** 2026-06-26
**Status:** Design approved, pending spec review

## Problem

Operation cards should be drawn from a real, finite deck so draw probabilities depend on what
has already been drawn (draw an Ambush and the next Ambush is less likely). Today each player has
their own deck seeded from `RIVERS_CARDS` — but that constant holds only the **8 distinct kinds,
one copy each**. So a player cycles through 8 unique cards and can never hold two of the same
kind until their discard reshuffles. The intended deck is **3 copies of each kind = 24 cards**,
shared by both players, drawn from the top.

## Decision (from brainstorming)

**One shared 24-card deck**, not per-player decks. A draw by either player consumes a card for
both. At most 16 cards are drawn in a game, so a 24-card deck never empties — no reshuffle, no
empty-pile handling.

## Components

### 1. Deck composition — `packages/engine/src/cards.ts`

Add, alongside the existing `RIVERS_CARDS` kind list:

- `RIVERS_CARD_COPIES = 3` — copies of each kind in the deck.
- `RIVERS_DECK: readonly OperationCard[]` — `RIVERS_CARDS` expanded to `RIVERS_CARD_COPIES`
  copies each (24 cards, unshuffled; deterministic order). `RIVERS_CARDS` stays the canonical
  list of kinds; `RIVERS_DECK` is the physical deck.

### 2. State shape — `packages/engine/src/state.ts`

- **Move** `deck: OperationCard[]` and `discard: OperationCard[]` **off** `PlayerState` and **onto**
  `GameState` as shared piles. `PlayerState` keeps `hand` (per-player, hidden) and loses both
  `deck` and `discard`.
- `GameState.deck` — undrawn cards, top first. `GameState.discard` — spent/played cards.
- **Bump the game-state schema:** `GameState.schemaVersion` `2 → 3`.

This is the only state-shape change. Three state-`schemaVersion` sites change: `state.ts`
(the `GameState` type literal), `game.ts` (the initial-state literal), and `serialization.ts`
(the deserialize guard). **The `PlayerGameView.schemaVersion` in `view.ts` (the *view* schema) is
a separate number and MUST NOT change** — the view is unaffected.

### 3. Initialization — `packages/engine/src/game.ts`

Replace step (3)'s two per-player shuffles with a **single** shared shuffle:

- When `rules.cards` is true: `shuffle(rngState, RIVERS_DECK)` once, advance `rngState`, set
  `state.deck` to the shuffled 24; else `state.deck = []`.
- `state.discard = []`.
- `makePlayer` no longer sets `deck`/`discard`.
- Keep this shuffle in the **same position** — after the bonus-pool shuffle and the initiative
  draw — so those earlier RNG outcomes (board setup) are byte-identical. Update the "RNG draw
  order" doc comment to describe one shared deck shuffle instead of two per-player shuffles.

### 4. Drawing — `packages/engine/src/actions.ts` `drawCards`

Draw from `state.deck` instead of `player.deck`:

- For each of `n` draws: if `state.deck` is empty, stop (trivial guard — unreachable in a real
  game, but keeps it from ever throwing). Otherwise `player.hand.push(state.deck.shift()!)`.
- **Remove** the discard-reshuffle branch entirely (the deck cannot empty within ≤16 draws of 24).
- Signature and call sites unchanged: still `drawCards(state, seat, n)`, still fills the seat's
  hand.

### 5. Discarding — `packages/engine/src/actions.ts`

Two sites push spent cards to a player's discard today; both move to the shared pile:

- `discardCard` (plays an operation card from hand): push to `state.discard`.
- The combat **reroll** path (discard a card to re-throw dice): push to `state.discard`.

Nothing reads `discard` after the reshuffle removal; it is retained as the spent-card record and
a hook for a future "cards spent" display.

### 6. Serialization — `packages/engine/src/serialization.ts`

Deserialize guard accepts `schemaVersion === 3` and rejects anything else (the existing throw
message stands). Persisted dev games saved at version 2 will be rejected loudly; clear them with
the existing `pnpm db:reset`. No migration is written (dev-stage, resettable store).

### 7. View — no change

`view.ts` does not expose `deck`/`discard`; `hand` stays per-player and hidden and
`opponentHandCount` is unchanged. The remaining-deck count is intentionally **not** surfaced in
the UI (YAGNI).

## Testing

Engine unit tests (Vitest), following existing engine test style:

1. **Deck composition:** `RIVERS_DECK` has length 24 and exactly `RIVERS_CARD_COPIES` (3) of each
   of the 8 kinds.
2. **Shared draw:** after a draw, `state.deck` has one fewer card; the drawn card is the former
   top. A red draw followed by a black draw takes the next two distinct top cards from the **same**
   pile (proves the deck is shared, not per-player).
3. **Probability shrinks:** drawing a kind reduces that kind's remaining count in `state.deck`
   (e.g. draw the only-remaining copies of a kind until zero remain).
4. **Determinism:** two `createInitialState` calls with the same seed produce identical
   `state.deck` order; the bonus assignment and initiative holder are unchanged from before this
   change (guard against accidental RNG-order drift in board setup).
5. **Discard:** playing a card moves it from `hand` to `state.discard`; the reroll path also lands
   its card in `state.discard`.
6. **Serialization round-trip:** a v3 state serializes and deserializes to an equal state; a v2
   payload is rejected.

## Out of scope

- Card abilities (still: any card discardable to reroll a combat). Unchanged by this work.
- Per-player decks; reshuffling; deck-empty handling.
- Surfacing deck/discard counts in the UI.
- State migration from schema 2 to 3 (dev store is reset instead).
