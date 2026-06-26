# Order-first command flow

**Date:** 2026-06-26
**Status:** Design approved, pending spec review

## Problem

Issuing a base order (deploying a commander to Advance/Sail/Bombard/Shell) is currently
**tile-first**: the player selects a tile, the bottom ActionBar surfaces the orders contextual
to that tile ("Advance here", "Strike from here"), and clicking one opens the composer. This is
backwards from how players think — they decide *what* they want to do, then look for *where* they
can do it.

We want to invert it to **order-first**: click an order verb → candidate tiles glow → click a
tile → compose → confirm.

## Key insight: most of this already exists

Three "support" orders (Reinforce, Embark, Plan) and the entire **card-play flow** are already
order-first today. Playing a move/strike card arms a "targeting mode" (`playingCard` state) that
glows candidate tiles and resolves the order when a tile is clicked. Only the two **base** order
families — **move** (Advance/Sail) and **strike** (Bombard/Shell) — remain tile-first.

So this is not a rewrite. It is **generalizing the existing card-targeting machinery to cover
base orders**, plus replacing the contextual ActionBar with a fixed verb palette.

## Approach

Unify base orders and card plays into a single **armed targeting** state. The current
`contextualMove` / `contextualStrike` lookups and the "Advance here" / "Strike from here"
buttons are removed; the tile click itself becomes the trigger.

Data guarantee that makes this safe (verified in `enumerateMoves`, `view.ts`): there is exactly
one advance/sail `LegalMove` per action space, keyed to that space's `areaId`. Within one armed
verb, `targetAreaId` is unique, so a destination click always resolves to exactly one order.
Multiple **sources** feeding one destination are already part of that single `LegalMove` (staged
per-source in the composer) — that is the normal one-commander advance, not competing orders.

## Components

### 1. Armed-order state (`App.tsx`)

A single state value replaces the move/strike use of `playingCard`:

```ts
type ArmedOrder =
  | { kind: "move";   type: "advance" | "sail";   moves:   LegalMove[];   card?: OperationCard; bonusMax?: number }
  | { kind: "strike"; type: "bombard" | "shell";  strikes: LegalStrike[]; card?: OperationCard }
```

- **Arming from the palette** fills it with the base legal options
  (`game.view.legal.moves` filtered by type, or `legal.strikes` filtered by type).
- **Playing a move/strike card** fills it with the card's (modified) options and the card
  context (`card`, `bonusMax`). Same state, same glow, same resolution path.
- Placement cards and the single-target `bombard` card keep their existing shortcut of opening
  the composer directly (they do not need a tile-pick step).

`armedOrder` and `composer` are mutually exclusive phases of a single order: armed = choosing the
target tile; composer = staging + confirming. Cancel from either returns to idle.

### 2. Verb palette (idle ActionBar — `ActionBar.tsx` `IdleBar`)

Replace the contextual + support split with a **fixed palette of all 8 verbs**: Advance, Sail,
Bombard, Shell, Reinforce, Embark, Plan, Pass. Each is greyed (disabled) when it has no legal
candidate this turn. Availability:

| Verb               | Enabled when                                              |
| ------------------ | --------------------------------------------------------- |
| Advance / Sail     | `legal.moves` contains a move of that type                |
| Bombard / Shell    | `legal.strikes` contains a strike of that type            |
| Reinforce / Embark | `largestPlacementPerType(legal.placements)` has that type |
| Plan               | `legal.plans` is non-empty                                |
| Pass               | `legal.canPass`                                           |

Clicking a verb:

- **Advance / Sail / Bombard / Shell** → set `armedOrder`; candidate tiles glow; the bar shows a
  targeting banner (see §4).
- **Reinforce / Embark** → open the placement composer directly (its `targets` glow inside the
  composer, unchanged).
- **Plan** → open the Plan confirm bar (unchanged). If both a plain Plan and a Plan★ (initiative)
  space are legal, show both, as today.
- **Pass** → execute immediately (unchanged).

Layout is stable across turns (fixed set, only enabled/disabled changes) so it is learnable.

### 3. Glow (`App.tsx` `legalTargetIds`)

Glow the candidate tiles **only while armed**:

- move → the armed moves' `targetAreaId`s (destinations)
- strike → the armed strikes' `linkedAreaId`s (enemy targets)

When idle (nothing armed) and not composing, **nothing glows**. This is a deliberate improvement:
today advance destinations glow at all times at idle, which is noisy. The board stays calm until
the player declares intent. The composer's own source/target glow (`sourceIds`) is unchanged.

### 4. Targeting banner + tile click

While armed, the ActionBar shows a banner: the verb name + a hint
("Advance — tap a glowing destination", "Bombard — tap a glowing enemy area") + a **Cancel**
button. This generalizes the current `cardModeLabel` banner.

Tile click behavior (`handleSelectArea`), honoring "inspect always works":

1. **Always** update `selectedAreaId` so AreaDetails reflects the clicked tile.
2. If `armedOrder` is set **and** the tile is a candidate, also resolve the specific
   `LegalMove` / `LegalStrike` for that tile and open the composer:
   - **move** → MoveBar: sources glow, steppers stage per-source counts → **Confirm Advance/Sail**
   - **strike** → StrikeBar: target pre-selected, dice shown → **Confirm Bombard/Shell**
3. If armed and the tile is **not** a candidate, just inspect; the banner keeps its generic hint.
   A precise per-tile "why not eligible" reason needs engine support and is **out of scope** — the
   hint stays generic.

The composer is the "...and confirm" step; no extra confirmation screen is added.

### 5. Cancel / lifecycle

- Cancel while armed → clear `armedOrder`, return to the calm palette.
- Cancel while composing → clear `composer` (and any `armedOrder`/card context), return to idle.
- Confirming an order submits the command exactly as today (`buildCommand`, `handleConfirmOrder`).

## Removed / simplified

- `contextualMove`, `contextualStrike` memos — deleted.
- "Advance here" / "Strike from here" contextual buttons in `IdleBar` — deleted.
- `playingCard`'s separate move/strike role — folded into `armedOrder`.

## Testing

- Update `localGame.test.ts` and any ActionBar/App interaction tests to the new flow:
  arm verb → glow → click candidate → compose → confirm.
- Keep card-play paths green: move/strike cards arm `armedOrder` with card context; placement and
  single-target bombard cards still open the composer directly.
- Verify disabled-verb states match the availability table.
- Verify idle shows no glow; armed shows exactly the candidate set.
- CI Browser Smoke Test covers the end-to-end click path (no local browser verification).

## Out of scope

- Per-tile "why this tile is ineligible" explanations (needs engine reason codes).
- Any change to the composer internals, combat resolution, or command schema.
- Disambiguation UI for a destination reachable by two orders — provably impossible within one
  armed verb, so not needed.
