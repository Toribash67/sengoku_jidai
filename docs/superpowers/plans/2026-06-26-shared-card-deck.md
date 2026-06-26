# Shared Operation-Card Deck Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the two per-player 8-card decks with a single shared, shuffled 24-card deck (3 copies of each of the 8 kinds) drawn from the top.

**Architecture:** Add a physical `RIVERS_DECK` (24 cards) in `cards.ts`. Move `deck`/`discard` off `PlayerState` onto `GameState` as shared piles, bump the game-state schema 2→3, shuffle the shared deck once at init, and draw from it (no reshuffle — ≤16 draws of 24 never empties). All engine tests that referenced per-player `deck`/`discard` or the v2 state schema are migrated.

**Tech Stack:** TypeScript, engine package (`@sengoku-jidai/engine`), Vitest. Package manager: `corepack pnpm`. Tests live in `packages/engine/test/*.test.ts`.

## Global Constraints

- One **shared** 24-card deck (3 copies × 8 kinds) in game state; both players draw from the same top. No per-player decks. No reshuffle. No deck-empty handling beyond a trivial guard.
- Only the **game-state** `schemaVersion` bumps 2→3 (`state.ts` `GameState`, `game.ts` initial-state literal, `serialization.ts` guard). The **view** schema `PlayerGameView.schemaVersion` in `view.ts` MUST stay `2` — do not touch `view.ts` or `view.test.ts`.
- The deck shuffle stays the **last** RNG draw at init (after bonus pool + initiative), so the bonus assignment and initiative holder are byte-identical. The post-init `rngState` anchor value *does* change (the deck shuffle consumes RNG differently) and gets re-pinned.
- ESM imports use explicit `.js` extensions. Keep imports matching usage (lint errors on unused imports).
- Per-task gate (from repo root): `corepack pnpm typecheck && corepack pnpm lint && corepack pnpm test && corepack pnpm exec prettier --check .` — all green. (`prettier --check .` is a required CI job; do not skip it.)
- Commit messages end with the trailer: `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.
- Branch is already `feat/shared-card-deck`. Do not merge without asking.

## File Structure

- **Modify** `packages/engine/src/cards.ts` — add `RIVERS_CARD_COPIES` and the physical `RIVERS_DECK` (24 cards). `RIVERS_CARDS` stays the canonical kind list.
- **Modify** `packages/engine/src/state.ts` — move `deck`/`discard` from `PlayerState` to `GameState`; bump `GameState.schemaVersion` to 3.
- **Modify** `packages/engine/src/game.ts` — single shared deck shuffle at init; `makePlayer` drops `deck`/`discard`; state literal sets `deck`/`discard` and `schemaVersion: 3`.
- **Modify** `packages/engine/src/actions.ts` — `drawCards` draws from `state.deck` (no reshuffle); `playCard` and `rerollPendingCombat` push to `state.discard`; drop the now-unused `shuffle` import.
- **Modify** `packages/engine/src/serialization.ts` — deserialize guard accepts `schemaVersion === 3`.
- **Modify (tests)** `packages/engine/test/cards.test.ts`, `game.test.ts`, `pendingCombat.test.ts`, `cardAbilities.test.ts`, `index.test.ts`, `serialization.test.ts` — migrate to shared `state.deck`/`state.discard` and schema 3; add shared-draw + determinism + composition coverage.

---

## Task 1: Physical 24-card deck in `cards.ts`

Purely additive — `RIVERS_CARDS` is unchanged, so this compiles and passes against the current code.

**Files:**
- Modify: `packages/engine/src/cards.ts`
- Test: `packages/engine/test/cards.test.ts` (append a new describe block only)

**Interfaces:**
- Produces (consumed by Task 2): `export const RIVERS_CARD_COPIES = 3` and `export const RIVERS_DECK: readonly OperationCard[]` — `RIVERS_CARDS` expanded to 3 copies each, 24 cards.

- [ ] **Step 1: Write the failing test**

Append to `packages/engine/test/cards.test.ts` (keep the existing imports; add `RIVERS_CARD_COPIES`, `RIVERS_CARDS`, `RIVERS_DECK` to a new import line from `../src/cards.js`):

```ts
import { RIVERS_CARD_COPIES, RIVERS_CARDS, RIVERS_DECK } from "../src/cards.js";

describe("RIVERS_DECK", () => {
  it("holds RIVERS_CARD_COPIES (3) copies of every kind, 24 cards total", () => {
    expect(RIVERS_CARD_COPIES).toBe(3);
    expect(RIVERS_DECK).toHaveLength(RIVERS_CARDS.length * RIVERS_CARD_COPIES);
    expect(RIVERS_DECK).toHaveLength(24);
    for (const kind of RIVERS_CARDS) {
      expect(RIVERS_DECK.filter((c) => c === kind)).toHaveLength(RIVERS_CARD_COPIES);
    }
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `corepack pnpm --filter @sengoku-jidai/engine test cards`
Expected: FAIL — `RIVERS_CARD_COPIES`/`RIVERS_DECK` are not exported (import error / undefined).

- [ ] **Step 3: Add the deck to `cards.ts`**

Append to `packages/engine/src/cards.ts` (after the existing `RIVERS_CARDS` declaration):

```ts
/** Copies of each kind in the physical deck. With 8 kinds this makes a 24-card deck. */
export const RIVERS_CARD_COPIES = 3;

/**
 * The physical Rivers deck: `RIVERS_CARD_COPIES` copies of each kind (24 cards), in a fixed
 * unshuffled order. A game shuffles this once at setup into the shared draw pile. `RIVERS_CARDS`
 * stays the canonical list of distinct kinds.
 */
export const RIVERS_DECK: readonly OperationCard[] = RIVERS_CARDS.flatMap((card) =>
  Array.from({ length: RIVERS_CARD_COPIES }, () => card)
);
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `corepack pnpm --filter @sengoku-jidai/engine test cards`
Expected: PASS (the new describe block plus the existing Plan-draw tests, which still use the current per-player deck and are untouched).

- [ ] **Step 5: Gate + commit**

Run: `corepack pnpm typecheck && corepack pnpm lint`
Expected: clean.

```bash
git add packages/engine/src/cards.ts packages/engine/test/cards.test.ts
git commit -m "feat(engine): physical 24-card Rivers deck (3 copies per kind)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 2: Shared deck/discard on game state

This is the atomic seam: moving `deck`/`discard` from `PlayerState` to `GameState` breaks every reference until all are updated, so the source change and all test migrations land in one task. Work top-to-bottom; the gate runs at the end.

**Files:**
- Modify: `packages/engine/src/state.ts`, `game.ts`, `actions.ts`, `serialization.ts`
- Test: `packages/engine/test/cards.test.ts`, `game.test.ts`, `pendingCombat.test.ts`, `cardAbilities.test.ts`, `index.test.ts`, `serialization.test.ts`

**Interfaces:**
- Consumes (from Task 1): `RIVERS_DECK`, `RIVERS_CARD_COPIES` from `../src/cards.js`.
- Produces: `GameState.deck: OperationCard[]` and `GameState.discard: OperationCard[]` (shared, top-of-deck first); `PlayerState` no longer has `deck`/`discard`; `GameState.schemaVersion: 3`. `drawCards(state, seat, n)` and `playCard`/`rerollPendingCombat` signatures unchanged.

- [ ] **Step 1: Move the fields and bump the schema in `state.ts`**

In `packages/engine/src/state.ts`, delete the `deck` and `discard` fields from `PlayerState` (the two blocks with comments `/** Undrawn cards, top of deck first. */` and `/** Spent cards; reshuffled into the deck when the deck runs short. */`). `PlayerState` keeps `hand`. The `hand` comment stays.

Then, in the `GameState` interface, change the schema literal and add the shared piles. Change:

```ts
  schemaVersion: 2;
```
to:
```ts
  schemaVersion: 3;
```

And add these two fields to `GameState` (put them next to `players` / `rngState`, near the other dynamic collections):

```ts
  /** Shared operation-card draw pile, top first. Shuffled once at setup; never reshuffled
   *  (≤16 draws from 24 cards never empties it). */
  deck: OperationCard[];
  /** Shared pile of spent cards (played or discarded to reroll). Not drawn from. */
  discard: OperationCard[];
```

Update the `GameState` doc comment that says `(schemaVersion 2)` to `(schemaVersion 3)`. Ensure `OperationCard` is imported in `state.ts` (it already is — `PlayerState.hand` uses it).

- [ ] **Step 2: One shared shuffle + schema literal in `game.ts`**

In `packages/engine/src/game.ts`:

Change the import on line 2 from `RIVERS_CARDS` to `RIVERS_DECK`:
```ts
import { RIVERS_DECK } from "./cards.js";
```
(If `OperationCard` was imported only for the `decks` Record removed below and is now unused, drop it from its import; if still used elsewhere in the file, keep it. Lint will tell you.)

Replace the step-(3) block (the `const decks: Record<SeatId, OperationCard[]> = ...` through the closing `}` of the `if (rules.cards)`):

```ts
  // (3) shuffle the single shared operation-card deck (only when the ruleset uses cards).
  // Appended AFTER the bonus + initiative draws so those outcomes are unchanged.
  let deck: OperationCard[] = [];
  if (rules.cards) {
    const shuffledDeck = shuffle(rngState, RIVERS_DECK);
    rngState = shuffledDeck.state;
    deck = shuffledDeck.value;
  }
```

(Keep `OperationCard` imported here since `deck` is typed with it; adjust the type import so it resolves — `import type { OperationCard } from "./state.js"` or wherever it currently comes from.)

In `makePlayer`, remove the `deck: decks[seat],` and `discard: [],` lines (the returned `PlayerState` keeps `seat`, `reserve`, `commanders`, `hand: []`, `passed: false`).

In the final returned state literal, change `schemaVersion: 2,` to `schemaVersion: 3,` and add the shared piles (put them near `players`):

```ts
    schemaVersion: 3,
```
and, alongside `players: { red: makePlayer("red"), black: makePlayer("black") },` (or wherever the literal builds its fields), add:
```ts
    deck,
    discard: [],
```

- [ ] **Step 3: Draw + discard from shared state in `actions.ts`**

In `packages/engine/src/actions.ts`:

Replace `drawCards` (the function starting `function drawCards(state: GameState, seat: SeatId, n: number)`) with:

```ts
/** Draw up to `n` cards from the top of the shared deck into the seat's hand. The deck is never
 *  reshuffled — at most 16 cards are drawn in a game from a 24-card deck, so it cannot empty; the
 *  length check is a guard that simply stops, never throws. */
function drawCards(state: GameState, seat: SeatId, n: number): GameEvent[] {
  const player = state.players[seat];
  let drawn = 0;
  for (let i = 0; i < n; i++) {
    if (state.deck.length === 0) break; // unreachable in a real game; never throw
    player.hand.push(state.deck.shift()!);
    drawn += 1;
  }
  return drawn > 0 ? [{ type: "cardsDrawn", seat, count: drawn }] : [];
}
```

In `playCard`, change `player.discard.push(card);` to `state.discard.push(card);`.

In `rerollPendingCombat`, change `player.discard.push(card);` to `state.discard.push(card);`.

Remove `shuffle` from the `rng.js` import (line 8) — it is no longer used in this file:
```ts
import { rollDie } from "./rng.js";
```
(Verify with `grep -n shuffle packages/engine/src/actions.ts` → only nothing, or fix if another use exists.)

- [ ] **Step 4: Accept schema 3 in `serialization.ts`**

In `packages/engine/src/serialization.ts`, change the guard:

```ts
  if (json.schemaVersion !== 3) {
```
and update the doc comment `JSON-serializable form of a v2 game state` → `... v3 game state`.

- [ ] **Step 5: Migrate `cards.test.ts` Plan-draw tests to the shared deck**

In `packages/engine/test/cards.test.ts`, the `describe("Plan draws cards", ...)` block reads `s.players.red.deck`. Update it to the shared deck and drop the reshuffle test (reshuffle no longer exists). Replace the whole `describe("Plan draws cards", ...)` block with:

```ts
describe("Plan draws cards", () => {
  it("a normal Plan draws 2 cards from the top of the shared deck", () => {
    const s = game();
    const before = [...s.deck];
    const r = resolveCommand(s, { seat: "red" }, { type: "plan", spaceId: "plan-b" });
    expect(r.status).toBe("accepted");
    if (r.status !== "accepted") return;
    expect(r.nextState.players.red.hand).toEqual(before.slice(0, 2));
    expect(r.nextState.deck).toHaveLength(22);
    const drew = r.events.find((e) => e.type === "cardsDrawn");
    expect(drew && drew.type === "cardsDrawn" ? drew.count : 0).toBe(2);
  });

  it("the initiative Plan draws only 1 card", () => {
    const s = game();
    const r = resolveCommand(s, { seat: "red" }, { type: "plan", spaceId: "plan-a" });
    expect(r.status).toBe("accepted");
    if (r.status !== "accepted") return;
    expect(r.nextState.players.red.hand).toHaveLength(1);
    expect(r.nextState.deck).toHaveLength(23);
  });

  it("War Room grants +1 card", () => {
    const s = game();
    s.bonuses = { tile9: "warRoom" }; // red supplies its HQ
    const r = resolveCommand(s, { seat: "red" }, { type: "plan", spaceId: "plan-b" });
    expect(r.status).toBe("accepted");
    if (r.status !== "accepted") return;
    expect(r.nextState.players.red.hand).toHaveLength(3); // 2 + 1 War Room
  });

  it("is a shared pile: red's draw is consumed for black too", () => {
    const s = game();
    const before = [...s.deck];
    const r1 = resolveCommand(s, { seat: "red" }, { type: "plan", spaceId: "plan-b" });
    expect(r1.status).toBe("accepted");
    if (r1.status !== "accepted") return;
    // Black draws next from the SAME pile, so it gets the cards red did not take.
    const s2 = r1.nextState;
    s2.initiative = "black";
    s2.activeSeat = "black";
    const r2 = resolveCommand(s2, { seat: "black" }, { type: "plan", spaceId: "plan-b" });
    expect(r2.status).toBe("accepted");
    if (r2.status !== "accepted") return;
    expect(r2.nextState.players.black.hand).toEqual(before.slice(2, 4));
    expect(r2.nextState.deck).toHaveLength(20);
  });
});
```

(The `game()` helper at the top of the file is unchanged; it already returns a `createInitialState` with `initiative`/`activeSeat` set to `red`. The new shared-pile test flips the seat between draws on the resulting state.)

- [ ] **Step 6: Migrate `game.test.ts` (deck shape, schema, rng anchor)**

In `packages/engine/test/game.test.ts`:

Replace the test `it("deals each player a full, empty-handed operation-card deck", ...)` (the block asserting `s.players[seat].deck`/`discard` and `red.deck != black.deck`) with:

```ts
  it("seeds one shared, shuffled 24-card deck and empty hands", () => {
    const s = createInitialState(opts);
    for (const seat of ["red", "black"] as const) {
      expect(s.players[seat].hand).toEqual([]);
    }
    expect(s.discard).toEqual([]);
    expect(s.deck).toHaveLength(24);
    for (const kind of RIVERS_CARDS) {
      expect(s.deck.filter((c) => c === kind)).toHaveLength(3);
    }
  });

  it("shuffles the shared deck deterministically for a seed", () => {
    expect(createInitialState(opts).deck).toEqual(createInitialState(opts).deck);
  });
```

(`RIVERS_CARDS` is already imported in this file. `createInitialState`, `opts` already in scope.)

In `it("opens at round 1, ...")`, change `expect(s.schemaVersion).toBe(2);` to `expect(s.schemaVersion).toBe(3);`.

In `it("produces a fixed output for a known seed (replay anchor)", ...)`: the `initiative` and `bonuses` assertions stay exactly as they are (board setup is unchanged). The `expect(s.rngState).toBe("548158277");` line is now wrong because the single 24-card shuffle consumes RNG differently than the old two 8-card shuffles. Run the test (next step) to observe the new deterministic value and pin it. Also update that test's comment from "deck shuffles" (plural) to "the shared deck shuffle".

- [ ] **Step 7: Re-pin the rngState anchor**

Run: `corepack pnpm --filter @sengoku-jidai/engine test game`
Expected: the replay-anchor test FAILS on `rngState` with `Expected "548158277"` vs a new received value (e.g. `Received "<NEW>"`). Copy the exact received string and set `expect(s.rngState).toBe("<NEW>");` to it. The `initiative`/`bonuses` assertions must still pass unchanged — if either of THOSE changed, stop: the deck shuffle was not kept last and the board RNG drifted; fix Step 2 so the deck shuffle stays after the initiative draw.

Re-run: `corepack pnpm --filter @sengoku-jidai/engine test game`
Expected: PASS.

- [ ] **Step 8: Migrate the discard assertions in `pendingCombat.test.ts` and `cardAbilities.test.ts`**

These assert that a played/rerolled card lands in a player's discard; the pile is now shared. Mechanically replace each occurrence:

In `packages/engine/test/pendingCombat.test.ts`:
- `reroll.nextState.players.black.discard` → `reroll.nextState.discard`
- `rolled.nextState.players.black.discard` → `rolled.nextState.discard`
- `again.nextState.players.red.discard` → `again.nextState.discard`

In `packages/engine/test/cardAbilities.test.ts`, replace every `r.nextState.players.red.discard` with `r.nextState.discard` (8 occurrences: the `.toContain(...)` assertions for mobilise, commandeer ×3, ground_assault, river_assault, shore_strike, counterattack).

Use a check after editing: `grep -rn "players\.\(red\|black\)\.\(deck\|discard\)" packages/engine/test` must return **no matches**.

- [ ] **Step 9: Bump schema in `index.test.ts` and `serialization.test.ts`**

In `packages/engine/test/index.test.ts`: change the test title `"createInitialState produces a schemaVersion-2 state via the index"` to `"... schemaVersion-3 state ..."` and `expect(s.schemaVersion).toBe(2);` to `toBe(3);`.

In `packages/engine/test/serialization.test.ts`: rename `describe("v2 serialization", ...)` to `describe("v3 serialization", ...)`; change `expect(restored.schemaVersion).toBe(2);` to `toBe(3);`; and change the "rejects an unsupported schema version" case to prove the old version is now rejected — set the bad version to `2`:

```ts
    const bad = { ...serializeState(state), schemaVersion: 2 } as unknown as ReturnType<
      typeof serializeState
    >;
    expect(() => deserializeState(bad)).toThrow(/schema version/i);
```

Do NOT touch `view.test.ts` (the view schema stays 2).

- [ ] **Step 10: Full gate**

Run: `corepack pnpm typecheck && corepack pnpm lint && corepack pnpm test && corepack pnpm exec prettier --check .`
Expected: all green. (`prettier --check .` flags only tracked files in CI; if it flags a file you edited, run `corepack pnpm exec prettier --write <file>` and re-stage.)

Also confirm the whole repo builds (engine is consumed by server/web):
Run: `corepack pnpm build`
Expected: success.

- [ ] **Step 11: Commit**

```bash
git add packages/engine/src/state.ts packages/engine/src/game.ts packages/engine/src/actions.ts packages/engine/src/serialization.ts packages/engine/test/cards.test.ts packages/engine/test/game.test.ts packages/engine/test/pendingCombat.test.ts packages/engine/test/cardAbilities.test.ts packages/engine/test/index.test.ts packages/engine/test/serialization.test.ts
git commit -m "feat(engine): shared 24-card operation deck (state schema v3)

Move deck/discard from PlayerState to GameState as shared piles, shuffle a
single 24-card deck (3 per kind) once at setup, draw from the top with no
reshuffle. Bumps game-state schemaVersion 2->3; the view schema is unchanged.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 3: Reset the dev game store

The schema bump rejects any v2 game persisted in the server's SQLite store. Clear it so a fresh dev run starts clean.

**Files:** none (operational).

- [ ] **Step 1: Reset the store**

Run: `corepack pnpm db:reset`
Expected: completes without error (the dev SQLite DB is recreated empty). If the command needs the server build first and errors, run `corepack pnpm build:libs` then retry. This is a local dev convenience; CI starts from a fresh DB and is unaffected.

(No commit — this changes only the local `.data` store, which is git-ignored.)

---

## Self-Review

**Spec coverage:**
- Deck composition `RIVERS_CARD_COPIES`/`RIVERS_DECK` (24, 3 each) → Task 1. ✅
- Move `deck`/`discard` to shared `GameState`; `PlayerState` keeps `hand`; schema 2→3; view schema untouched → Task 2 Steps 1, 9 (and the "do not touch view" constraint). ✅
- Single shared shuffle at init, kept last so board RNG is identical → Task 2 Step 2 + Step 7 guard (initiative/bonuses must stay green). ✅
- `drawCards` from shared deck, reshuffle removed, trivial empty-guard → Task 2 Step 3. ✅
- Both discard paths (`playCard`, `rerollPendingCombat`) → `state.discard` → Task 2 Step 3, asserted by Step 8 tests. ✅
- Serialization accepts v3, rejects older → Task 2 Step 4 + Step 9 test. ✅
- View unchanged → no view task; constraint stated; `view.test.ts` explicitly excluded. ✅
- Tests: composition, shared draw, determinism, discard, serialization round-trip → Task 1 Step 1; Task 2 Steps 5, 6, 8, 9. ✅
- Persisted dev games reset via `db:reset` → Task 3. ✅

**Placeholder scan:** No TBD/TODO. The one runtime-derived value (the new `rngState` anchor) is handled by an explicit observe-and-pin step (Task 2 Step 7), with a guard that catches board-RNG drift — not a vague placeholder. ✅

**Type/name consistency:** `RIVERS_DECK`, `RIVERS_CARD_COPIES` defined in Task 1 and consumed in Task 2 Step 2 with identical names. `state.deck`/`state.discard` introduced in Step 1 and used consistently in Steps 2, 3, 5, 6, 8. `drawCards(state, seat, n)` signature unchanged. Schema literal `3` consistent across `state.ts`, `game.ts`, `serialization.ts`, and the tests. ✅
