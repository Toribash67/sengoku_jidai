# Order-First Command Flow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Invert the base-order UX from tile-first to order-first — click a verb, candidate tiles glow, click a tile, compose, confirm.

**Architecture:** Extract a pure decision module (`orders.ts`) for verb availability, candidate-tile glow, and tile→order resolution; unit-test it. Replace the tile-contextual ActionBar with a fixed verb palette. In `App.tsx`, introduce one `armedOrder` state that drives candidate glow and tile resolution for BOTH base orders and operation-card plays, deleting the old `playingCard` state and the `contextualMove`/`contextualStrike` lookups.

**Tech Stack:** TypeScript, React (no component-test harness in this package), Vitest (pure-logic unit tests), Playwright (E2E smoke). Package manager: `corepack pnpm`.

## Global Constraints

- This package has **no React component-test harness** (no Testing Library). Pure logic is unit-tested with Vitest; component/integration behavior is verified by `typecheck` + `build` + Playwright E2E. Do NOT add a new test framework.
- No local browser verification is available — rely on the gate commands below and CI's Browser Smoke Test.
- Tiles are always referred to by descriptive name in UI copy, never raw ids (existing rule; the palette/banner copy must follow it).
- ESM imports use explicit `.js` extensions (e.g. `./composer.js`), matching the codebase.
- Per-task gate (run from repo root unless noted):
  - `corepack pnpm --filter @sengoku-jidai/web test`
  - `corepack pnpm typecheck`
  - `corepack pnpm lint`
- Commit messages end with the trailer:
  `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`
- Branch is already `feat/order-first-flow`. Do not merge without asking.

---

## File Structure

- **Create** `packages/web/src/components/board/orders.ts` — pure order-flow logic: `ArmedOrder` type, `verbAvailability`, `armMove`, `armStrike`, `candidateTiles`, `resolveArmedTile`. One responsibility: decide what's usable, what glows, and what a click resolves to. No React.
- **Create** `packages/web/src/components/board/orders.test.ts` — Vitest unit tests for `orders.ts`.
- **Modify** `packages/web/src/components/board/ActionBar.tsx` — replace `IdleBar` with the fixed verb palette + targeting banner; update `ActionBarProps`.
- **Modify** `packages/web/src/App.tsx` — add `armedOrder` state + palette handlers + tile resolution; rewrite `legalTargetIds` and `handleSelectArea`; delete `playingCard`, `contextualMove`, `contextualStrike`; rewire `<ActionBar>` and `startCardPlay`.
- **Modify** `packages/web/src/styles/app.css` — palette layout + disabled-verb styling.
- **Modify** `tests/e2e/movement.spec.ts` — order-first movement flow.
- **Verify (no change expected)** `tests/e2e/support-actions.spec.ts` — Reinforce/Plan path is unchanged.

---

## Task 1: Pure order-flow module (`orders.ts`)

**Files:**
- Create: `packages/web/src/components/board/orders.ts`
- Test: `packages/web/src/components/board/orders.test.ts`

**Interfaces:**
- Consumes: `LegalCommandSummary`, `LegalMove`, `LegalStrike`, `LegalPlacement`, `OperationCard` from `@sengoku-jidai/engine`.
- Produces (relied on by Tasks 2 & 3):
  - `type ArmedOrder = { kind: "move"; type: "advance" | "sail"; moves: LegalMove[]; card?: OperationCard; bonusMax?: number } | { kind: "strike"; type: "bombard" | "shell"; strikes: LegalStrike[]; card?: OperationCard }`
  - `type OrderVerb = "advance" | "sail" | "bombard" | "shell" | "reinforce" | "embark" | "plan" | "pass"`
  - `type VerbAvailability = Record<OrderVerb, boolean>`
  - `type ResolvedOrder = { kind: "move"; move: LegalMove } | { kind: "strike"; strike: LegalStrike }`
  - `verbAvailability(legal: LegalCommandSummary): VerbAvailability`
  - `armMove(legal: LegalCommandSummary, type: "advance" | "sail"): ArmedOrder | null`
  - `armStrike(legal: LegalCommandSummary, type: "bombard" | "shell"): ArmedOrder | null`
  - `candidateTiles(armed: ArmedOrder): Set<string>`
  - `resolveArmedTile(armed: ArmedOrder, areaId: string): ResolvedOrder | null`

- [ ] **Step 1: Write the failing test**

Create `packages/web/src/components/board/orders.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { LegalCommandSummary, LegalMove, LegalStrike } from "@sengoku-jidai/engine";
import {
  armMove,
  armStrike,
  candidateTiles,
  resolveArmedTile,
  verbAvailability
} from "./orders.js";

const advance: LegalMove = {
  spaceId: "advance-x",
  type: "advance",
  targetAreaId: "tile3",
  sources: [{ areaId: "tile2", max: 2 }]
};
const sail: LegalMove = {
  spaceId: "sail-y",
  type: "sail",
  targetAreaId: "sea1",
  sources: [{ areaId: "sea0", max: 1 }]
};
const bombard: LegalStrike = {
  spaceId: "bombard-y",
  type: "bombard",
  linkedAreaId: "sea1",
  targets: ["tile5"],
  dice: 2
};

/** A minimal legal summary; only the fields the functions read need to be real. */
function legal(over: Partial<LegalCommandSummary>): LegalCommandSummary {
  return {
    activeSeat: "red",
    spaces: [],
    canPass: false,
    moves: [],
    strikes: [],
    placements: [],
    plans: [],
    cardPlays: [],
    canRollCombat: false,
    canResolveCombat: false,
    canRerollCombat: false,
    canAmbush: false,
    ...over
  };
}

describe("verbAvailability", () => {
  it("flags a verb usable when at least one matching option exists", () => {
    const avail = verbAvailability(
      legal({
        moves: [advance],
        strikes: [bombard],
        placements: [
          { spaceId: "reinforce-a", type: "reinforce", unit: "troop", targets: ["tile2"], pool: 6, reserve: 4 }
        ],
        plans: [{ spaceId: "plan-a", initiative: true }],
        canPass: true
      })
    );
    expect(avail).toMatchObject({
      advance: true,
      sail: false,
      bombard: true,
      shell: false,
      reinforce: true,
      embark: false,
      plan: true,
      pass: true
    });
  });

  it("flags everything false on an empty summary", () => {
    expect(verbAvailability(legal({}))).toMatchObject({
      advance: false,
      sail: false,
      bombard: false,
      shell: false,
      reinforce: false,
      embark: false,
      plan: false,
      pass: false
    });
  });
});

describe("armMove / armStrike", () => {
  it("arms only the moves of the requested type", () => {
    const armed = armMove(legal({ moves: [advance, sail] }), "advance");
    expect(armed).toEqual({ kind: "move", type: "advance", moves: [advance] });
  });

  it("returns null when no move of that type is legal", () => {
    expect(armMove(legal({ moves: [sail] }), "advance")).toBeNull();
  });

  it("arms only the strikes of the requested type", () => {
    const armed = armStrike(legal({ strikes: [bombard] }), "bombard");
    expect(armed).toEqual({ kind: "strike", type: "bombard", strikes: [bombard] });
  });
});

describe("candidateTiles", () => {
  it("uses move destinations", () => {
    expect(candidateTiles({ kind: "move", type: "advance", moves: [advance, sail] })).toEqual(
      new Set(["tile3", "sea1"])
    );
  });

  it("uses strike linked areas", () => {
    expect(candidateTiles({ kind: "strike", type: "bombard", strikes: [bombard] })).toEqual(
      new Set(["sea1"])
    );
  });
});

describe("resolveArmedTile", () => {
  it("resolves a destination click to its move", () => {
    expect(resolveArmedTile({ kind: "move", type: "advance", moves: [advance] }, "tile3")).toEqual({
      kind: "move",
      move: advance
    });
  });

  it("resolves a strike target click to its strike", () => {
    expect(
      resolveArmedTile({ kind: "strike", type: "bombard", strikes: [bombard] }, "sea1")
    ).toEqual({ kind: "strike", strike: bombard });
  });

  it("returns null for a non-candidate tile", () => {
    expect(resolveArmedTile({ kind: "move", type: "advance", moves: [advance] }, "tile9")).toBeNull();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `corepack pnpm --filter @sengoku-jidai/web test orders`
Expected: FAIL — `Cannot find module './orders.js'` (the module does not exist yet).

- [ ] **Step 3: Write the module**

Create `packages/web/src/components/board/orders.ts`:

```ts
import type {
  LegalCommandSummary,
  LegalMove,
  LegalStrike,
  OperationCard
} from "@sengoku-jidai/engine";

/** A base order (or operation-card play) that has been "armed": the player picked a verb and
 *  now chooses one of its candidate tiles. A move arms advance/sail destinations; a strike arms
 *  bombard/shell enemy targets. `card`/`bonusMax` carry an operation card played as the
 *  commander deploys (set only for card plays). */
export type ArmedOrder =
  | {
      kind: "move";
      type: "advance" | "sail";
      moves: LegalMove[];
      card?: OperationCard;
      bonusMax?: number;
    }
  | {
      kind: "strike";
      type: "bombard" | "shell";
      strikes: LegalStrike[];
      card?: OperationCard;
    };

export type OrderVerb =
  | "advance"
  | "sail"
  | "bombard"
  | "shell"
  | "reinforce"
  | "embark"
  | "plan"
  | "pass";

export type VerbAvailability = Record<OrderVerb, boolean>;

export type ResolvedOrder =
  | { kind: "move"; move: LegalMove }
  | { kind: "strike"; strike: LegalStrike };

/** Which palette verbs have at least one legal candidate this turn. Drives greying. */
export function verbAvailability(legal: LegalCommandSummary): VerbAvailability {
  return {
    advance: legal.moves.some((m) => m.type === "advance"),
    sail: legal.moves.some((m) => m.type === "sail"),
    bombard: legal.strikes.some((s) => s.type === "bombard"),
    shell: legal.strikes.some((s) => s.type === "shell"),
    reinforce: legal.placements.some((p) => p.type === "reinforce"),
    embark: legal.placements.some((p) => p.type === "embark"),
    plan: legal.plans.length > 0,
    pass: legal.canPass
  };
}

/** Arm a move verb (advance/sail) from the base legal moves. Null when none are legal. */
export function armMove(legal: LegalCommandSummary, type: "advance" | "sail"): ArmedOrder | null {
  const moves = legal.moves.filter((m) => m.type === type);
  return moves.length > 0 ? { kind: "move", type, moves } : null;
}

/** Arm a strike verb (bombard/shell) from the base legal strikes. Null when none are legal. */
export function armStrike(legal: LegalCommandSummary, type: "bombard" | "shell"): ArmedOrder | null {
  const strikes = legal.strikes.filter((s) => s.type === type);
  return strikes.length > 0 ? { kind: "strike", type, strikes } : null;
}

/** Candidate tiles to glow for the armed order: move destinations or strike enemy targets. */
export function candidateTiles(armed: ArmedOrder): Set<string> {
  return armed.kind === "move"
    ? new Set(armed.moves.map((m) => m.targetAreaId))
    : new Set(armed.strikes.map((s) => s.linkedAreaId));
}

/** Resolve a clicked tile to its specific order, or null when the tile is not a candidate. */
export function resolveArmedTile(armed: ArmedOrder, areaId: string): ResolvedOrder | null {
  if (armed.kind === "move") {
    const move = armed.moves.find((m) => m.targetAreaId === areaId);
    return move ? { kind: "move", move } : null;
  }
  const strike = armed.strikes.find((s) => s.linkedAreaId === areaId);
  return strike ? { kind: "strike", strike } : null;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `corepack pnpm --filter @sengoku-jidai/web test orders`
Expected: PASS (all cases green).

- [ ] **Step 5: Typecheck + lint**

Run: `corepack pnpm typecheck && corepack pnpm lint`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add packages/web/src/components/board/orders.ts packages/web/src/components/board/orders.test.ts
git commit -m "feat(web): pure order-flow module (verb availability, glow, tile resolution)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 2: Verb palette + App integration

This is the integration seam. Base orders and operation-card plays both flow through one
`armedOrder` state. The ActionBar prop change and the App rewrite must land together to keep the
package compiling, so they are one task. Work top-to-bottom; the gate runs at the end.

**Files:**
- Modify: `packages/web/src/components/board/ActionBar.tsx`
- Modify: `packages/web/src/App.tsx`

**Interfaces:**
- Consumes (from Task 1): `ArmedOrder`, `OrderVerb`, `VerbAvailability`, `ResolvedOrder`, `verbAvailability`, `armMove`, `armStrike`, `candidateTiles`, `resolveArmedTile`.
- Produces: the new `IdleBar` palette (clickable verb buttons, each carrying `data-order-verb="<verb>"`) and the `armedOrder`-driven targeting used by Task 3's E2E.

- [ ] **Step 1: Rewrite `IdleBar` and `ActionBarProps` in `ActionBar.tsx`**

Replace the `ActionBarProps` interface's idle-mode block and the entire `IdleBar` function. Keep
`Stepper`, `ComposerActions`, `MoveBar`, `PlacementBar`, `StrikeBar`, `PlanBar`, and the bottom
`ActionBar` dispatcher unchanged.

First, update the imports at the top of the file to add the verb types and helper:

```ts
import type { LegalPlacement, LegalPlan } from "@sengoku-jidai/engine";
import { cardLabel } from "./cardImages.js";
import { UNIT_NOUN, VERB, sumCounts, type ComposerState } from "./composer.js";
import type { OrderVerb, VerbAvailability } from "./orders.js";
```

(Removes the now-unused `LegalMove`/`LegalStrike` type imports; `LegalPlacement`/`LegalPlan` stay
for the support handlers.)

Replace the idle-mode fields of `ActionBarProps` (the block from `// Idle-mode inputs...`
through `onPass: () => void;`) with:

```ts
  // Idle-mode inputs: the fixed verb palette + the active targeting banner.
  /** Which palette verbs are usable this turn (others render greyed). */
  availability: VerbAvailability;
  /** Banner shown while a move/strike verb is armed: its label + glow hint. Null when idle. */
  armedLabel: string | null;
  placements: LegalPlacement[];
  plans: LegalPlan[];
  onArmVerb: (verb: "advance" | "sail" | "bombard" | "shell") => void;
  onStartPlacement: (placement: LegalPlacement) => void;
  onStartPlan: (plan: LegalPlan) => void;
  onPass: () => void;
```

(Delete the `cardModeLabel`, `contextualMove`, `contextualStrike`, `onStartOrder`, `onStartStrike`
fields. `onAdjust`, `onAdjustBonus`, `onConfirm`, `onCancel` stay for compose mode.)

Now replace the whole `IdleBar` function with:

```tsx
/** A move/strike verb in the palette. Placement/Plan/Pass have their own handlers below. */
const MOVE_STRIKE_VERBS: { verb: "advance" | "sail" | "bombard" | "shell" }[] = [
  { verb: "advance" },
  { verb: "sail" },
  { verb: "bombard" },
  { verb: "shell" }
];

function IdleBar(props: ActionBarProps) {
  const {
    isViewerActive,
    busy,
    availability,
    armedLabel,
    placements,
    plans,
    onArmVerb,
    onStartPlacement,
    onStartPlan,
    onPass,
    onCancel
  } = props;

  if (!isViewerActive) {
    return <span className="action-bar-hint">Waiting for the other player…</span>;
  }

  // Targeting mode: a move/strike verb is armed and its candidate tiles glow on the map.
  if (armedLabel) {
    return (
      <>
        <span className="action-bar-info">
          <strong>{armedLabel}</strong>
          <span className="action-bar-hint">Tap a glowing area to choose its target.</span>
        </span>
        <span className="action-bar-buttons">
          <button type="button" className="secondary-action" onClick={onCancel} disabled={busy}>
            Cancel
          </button>
        </span>
      </>
    );
  }

  // The fixed verb palette. Layout is stable; unusable verbs render disabled.
  return (
    <>
      <span className="action-bar-group order-palette">
        {MOVE_STRIKE_VERBS.map(({ verb }) => (
          <button
            key={verb}
            type="button"
            data-order-verb={verb}
            onClick={() => onArmVerb(verb)}
            disabled={busy || !availability[verb]}
          >
            {VERB[verb]}
          </button>
        ))}
        {placements.map((placement) => (
          <button
            key={placement.spaceId}
            type="button"
            data-order-verb={placement.type}
            onClick={() => onStartPlacement(placement)}
            disabled={busy}
          >
            {VERB[placement.type]}{" "}
            <span className="action-meta">up to {Math.min(placement.pool, placement.reserve)}</span>
          </button>
        ))}
        {plans.map((plan) => (
          <button
            key={plan.spaceId}
            type="button"
            data-order-verb="plan"
            onClick={() => onStartPlan(plan)}
            disabled={busy}
          >
            Plan {plan.initiative ? <span className="action-meta">★</span> : null}
          </button>
        ))}
        <button
          type="button"
          data-order-verb="pass"
          onClick={onPass}
          disabled={busy || !availability.pass}
        >
          Pass
        </button>
      </span>
    </>
  );
}
```

Notes for the implementer:
- `placements` is already pre-filtered by App to the largest space per type, so it renders at
  most one Reinforce and one Embark button — that is why placement verbs are driven by the array
  rather than `availability` (an empty array simply renders no button, which matches "disable
  when unusable" closely enough; `availability.reinforce/embark` exist for parity and future use).
- `VERB` has keys `advance | sail | bombard | shell | reinforce | embark` — all used above.

- [ ] **Step 2: Update `App.tsx` imports and state**

In the import block, drop `LegalCardPlay` from the engine type import (no longer used) and add the
orders module. After the `composer.js` import (line ~24-28) add:

```ts
import {
  type ArmedOrder,
  armMove,
  armStrike,
  candidateTiles,
  resolveArmedTile,
  verbAvailability
} from "./components/board/orders.js";
```

Replace the `playingCard` state declaration (the `const [playingCard, setPlayingCard] = ...` line
and its two comment lines, ~73-75) with:

```ts
  // A move/strike order being targeted: the player armed a verb (or played a move/strike card)
  // and now picks a candidate tile on the map. Placement/Plan open their composer directly.
  const [armedOrder, setArmedOrder] = useState<ArmedOrder | null>(null);
```

- [ ] **Step 3: Replace the glow + remove contextual memos in `App.tsx`**

Replace the `legalTargetIds` memo (~237-253) with an armed-driven version, and DELETE the
`contextualMove` and `contextualStrike` memos (~269-286) entirely:

```ts
  // Candidate tiles to glow while a move/strike verb is armed. Nothing glows when idle.
  const legalTargetIds = useMemo(() => {
    if (composer || !armedOrder) {
      return new Set<string>();
    }
    return candidateTiles(armedOrder);
  }, [composer, armedOrder]);
```

Replace the `availability`/derived values: after the `placements` memo (~293-296) add:

```ts
  const availability = useMemo(
    () =>
      game
        ? verbAvailability(game.view.legal)
        : {
            advance: false,
            sail: false,
            bombard: false,
            shell: false,
            reinforce: false,
            embark: false,
            plan: false,
            pass: false
          },
    [game]
  );
```

(Leave `sourceIds`, `stagedCounts`, `placements`, `cardPlays`, `playableCards` as they are.)

- [ ] **Step 4: Add palette + targeting handlers, update tile selection, in `App.tsx`**

Add an arming handler and a resolver, and update `handleSelectArea`. Place `armVerb` and
`resolveArmed` next to the other order handlers (near `startOrder`, ~380). `startOrder` and
`startStrike` already accept an optional `card`/`bonusMax`, so reuse them:

```ts
  // Arm a move/strike verb from the palette: glow its candidate tiles, await a tile click.
  function armVerb(verb: "advance" | "sail" | "bombard" | "shell") {
    if (!game) {
      return;
    }
    const armed =
      verb === "advance" || verb === "sail"
        ? armMove(game.view.legal, verb)
        : armStrike(game.view.legal, verb);
    if (armed) {
      setComposer(null);
      setArmedOrder(armed);
    }
  }

  // Open the composer for the order the clicked candidate tile resolves to.
  function resolveArmed(areaId: string) {
    if (!armedOrder) {
      return;
    }
    const resolved = resolveArmedTile(armedOrder, areaId);
    if (!resolved) {
      return;
    }
    if (resolved.kind === "move") {
      startOrder(resolved.move, armedOrder.card, armedOrder.bonusMax);
    } else {
      startStrike(resolved.strike, armedOrder.card);
    }
  }
```

`startOrder`, `startStrike`, `startPlacement` currently call `setPlayingCard(null)`. Replace each
of those three `setPlayingCard(null);` lines with `setArmedOrder(null);` (the order is now
committed to the composer, so the armed-targeting phase ends).

Update `cancelOrder` (~447-450) to clear the new state:

```ts
  // Cancel any in-progress order or targeting, returning to the palette.
  function cancelOrder() {
    setComposer(null);
    setArmedOrder(null);
  }
```

Replace `handleSelectArea` (~504-509). Inspection always works; a candidate click also opens the
composer:

```ts
  // Tile selection. Inspection always updates AreaDetails. While composing a move, keep the gold
  // highlight pinned to the target rather than letting it follow source clicks. While a verb is
  // armed, a click on a candidate tile also resolves the order and opens its composer.
  function handleSelectArea(areaId: string) {
    if (composer?.kind !== "move") {
      setSelectedAreaId(areaId);
    }
    if (armedOrder) {
      resolveArmed(areaId);
    }
  }
```

(The `composer?.kind === "move"` guard that previously skipped selection is preserved as the
negated branch above — during a move the gold stays on the target.)

- [ ] **Step 5: Fold card plays into `armedOrder` in `App.tsx`**

Replace `startCardPlay` (~430-444) so move/strike cards arm the unified state with card context:

```ts
  // Begin playing a card. Placement cards (mobilise/commandeer) open their composer at once; a
  // single-target bombard card opens its strike composer directly; other move/strike cards arm
  // targeting mode (glow the card's options, await a tile click) carrying the card context.
  function startCardPlay(play: LegalCardPlay) {
    setPreviewCard(null);
    if (play.placements && play.placements.length > 0) {
      const best = play.placements.reduce((a, b) => (b.pool > a.pool ? b : a));
      startPlacement(best, play.card);
      return;
    }
    if (play.action === "bombard" && play.strikes && play.strikes.length === 1) {
      startStrike(play.strikes[0]!, play.card);
      return;
    }
    setComposer(null);
    setSelectedAreaId(null);
    if (play.moves && play.moves.length > 0) {
      setArmedOrder({
        kind: "move",
        type: play.action === "sail" ? "sail" : "advance",
        moves: play.moves,
        card: play.card,
        bonusMax: play.bonusMax
      });
    } else if (play.strikes && play.strikes.length > 0) {
      setArmedOrder({ kind: "strike", type: "bombard", strikes: play.strikes, card: play.card });
    }
  }
```

(`LegalCardPlay.action` is one of `advance | sail | reinforce | embark | bombard`; strike cards
here are always bombard — shell has no card. The single-target bombard shortcut above still fires
first, so the `strikes` branch covers multi-target bombard cards.)

`LegalCardPlay` is still referenced by `startCardPlay`'s parameter and the `cardPlays` memo, so
keep its import. Re-add it to the engine type import if Step 2 removed it — verify against the
final usage and keep the import list matching what's used (the gate's lint/typecheck will flag a
wrong choice).

- [ ] **Step 6: Find any remaining `playingCard`/`setPlayingCard` references and update them**

Run: `grep -n "playingCard\|setPlayingCard\|contextualMove\|contextualStrike" packages/web/src/App.tsx`

Expected remaining sites and their fixes:
- The `setPlayingCard(null);` inside the route-load effect (~153) and the `handleConfirmOrder`
  success path (~541) → change each to `setArmedOrder(null);`.
- The `handleCreate` reset (~320) `setPlayingCard(null);` → `setArmedOrder(null);`.
- Any other `setPlayingCard(null)` resets → `setArmedOrder(null);`.

There must be **zero** remaining `playingCard`, `setPlayingCard`, `contextualMove`, or
`contextualStrike` references after this step.

- [ ] **Step 7: Rewire the `<ActionBar>` props in `App.tsx`**

Replace the `<ActionBar .../>` element (~780-800) with the new prop set:

```tsx
            <ActionBar
              composer={composer}
              isViewerActive={isViewerActive}
              busy={busy}
              selectedAreaId={stepperAreaId}
              availability={availability}
              armedLabel={armedOrder ? cardLabel(armedOrder.card ?? VERB[armedOrder.type]) : null}
              placements={placements}
              plans={game.view.legal.plans}
              onArmVerb={armVerb}
              onStartPlacement={startPlacement}
              onStartPlan={startPlan}
              onPass={handlePass}
              onAdjust={adjustCount}
              onAdjustBonus={adjustBonus}
              onConfirm={handleConfirmOrder}
              onCancel={cancelOrder}
            />
```

IMPORTANT — `cardLabel` expects an `OperationCard`. For the banner we want: the card's label when
a card is armed, else the verb name. Implement that with a tiny inline helper instead of abusing
`cardLabel`. Add near the top of the component body (after `armedOrder` is in scope), and use it
in the prop:

```ts
  const armedLabel = armedOrder
    ? armedOrder.card
      ? cardLabel(armedOrder.card)
      : VERB[armedOrder.type]
    : null;
```

Then set `armedLabel={armedLabel}` in the JSX above. `VERB` is imported from `composer.js` — add
it to that existing import: `import { type ComposerState, VERB, largestPlacementPerType, stagedCountsFor } from "./components/board/composer.js";`

- [ ] **Step 8: Run the web unit tests**

Run: `corepack pnpm --filter @sengoku-jidai/web test`
Expected: PASS (Task 1 tests + existing state/route/polling/api tests).

- [ ] **Step 9: Typecheck, lint, build**

Run: `corepack pnpm typecheck && corepack pnpm lint && corepack pnpm --filter @sengoku-jidai/web build`
Expected: no errors. (Typecheck is the real verification here — it proves the ActionBar/App prop
contract matches and that no dangling `playingCard` references remain.)

- [ ] **Step 10: Commit**

```bash
git add packages/web/src/components/board/ActionBar.tsx packages/web/src/App.tsx
git commit -m "feat(web): order-first command flow — verb palette + armed targeting

Replace the tile-contextual ActionBar with a fixed verb palette. One armedOrder
state drives candidate-tile glow and click resolution for both base orders and
operation-card plays, replacing playingCard and the contextual move/strike lookups.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 3: Palette + banner styling

**Files:**
- Modify: `packages/web/src/styles/app.css`

**Interfaces:**
- Consumes: the `.order-palette` wrapper and `button[data-order-verb]` markup from Task 2.

- [ ] **Step 1: Add palette styling**

Append to the action-bar section of `packages/web/src/styles/app.css` (after the
`.action-bar-group` rules, ~694):

```css
/* The order-first verb palette: a stable row of order buttons, greyed when unusable. */
.order-palette {
  flex-wrap: wrap;
}

.order-palette button:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}
```

- [ ] **Step 2: Verify the stylesheet builds**

Run: `corepack pnpm --filter @sengoku-jidai/web build`
Expected: build succeeds (Vite processes the CSS without error).

- [ ] **Step 3: Commit**

```bash
git add packages/web/src/styles/app.css
git commit -m "style(web): order palette layout + disabled-verb styling

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 4: Update E2E for the order-first flow

**Files:**
- Modify: `tests/e2e/movement.spec.ts`
- Verify (expect green, no change): `tests/e2e/support-actions.spec.ts`

**Interfaces:**
- Consumes: palette buttons carry `data-order-verb="advance|sail|..."`; candidate tiles glow with
  `data-legal-target='true'`; sources glow with `data-source='true'` (all from Task 2 / unchanged
  MapBoard).

- [ ] **Step 1: Rewrite the movement E2E to order-first**

Replace the body of the test in `tests/e2e/movement.spec.ts` (keep the imports and the test name):

```ts
import { expect, test } from "@playwright/test";

test("issues a movement order from the board and resolves it", async ({ page }) => {
  await page.goto("/");
  await page.getByLabel("Your name").fill("Oda");
  await page.getByRole("button", { name: "Create game" }).click();
  await expect(page.getByTestId("board")).toBeVisible();

  // Switch the view to whichever seat has initiative this game.
  const actor = await page.locator(".app-shell").getAttribute("data-active-seat");
  expect(actor === "red" || actor === "black").toBe(true);
  const actorSeat = page.locator(`button[data-seat="${actor}"]`);
  if (await actorSeat.isEnabled()) {
    await actorSeat.click();
  }

  // Order-first: click a movement verb in the palette (whichever of Advance/Sail is usable).
  const advance = page.locator('button[data-order-verb="advance"]');
  const sail = page.locator('button[data-order-verb="sail"]');
  const moveVerb = (await advance.isEnabled()) ? advance : sail;
  await moveVerb.click();

  // Candidate destinations now glow; pick the first one.
  const target = page.locator("[data-legal-target='true']").first();
  await expect(target).toBeVisible();
  await target.click();

  // A legal source glows; click it to stage one unit, then confirm.
  const source = page.locator("[data-source='true']").first();
  await expect(source).toBeVisible();
  await source.click();
  await page.getByRole("button", { name: /^Confirm/ }).click();

  // The order resolved: a unit-move event is logged.
  await expect(page.getByText(/moved/)).toBeVisible();
});
```

- [ ] **Step 2: Confirm nothing glows before a verb is armed**

Add this assertion right after the seat switch and before clicking the verb (so the test also
guards the "calm board at idle" behavior):

```ts
  // Idle board is calm: no candidate tiles glow until a verb is armed.
  await expect(page.locator("[data-legal-target='true']")).toHaveCount(0);
```

- [ ] **Step 3: Run the E2E suite**

Run: `corepack pnpm test:e2e`
Expected: PASS for `hotseat.spec.ts` (unchanged), `movement.spec.ts` (rewritten), and
`support-actions.spec.ts` (Reinforce/Plan unchanged — its buttons still match `/^Reinforce/` and
`/^Plan/` and open the composer directly).

If `support-actions.spec.ts` fails because a verb is now disabled at game start, inspect which
support verb is unavailable; if Reinforce/Plan are genuinely unavailable in the start position the
test's precondition is wrong and predates this change — fix it by arming the available support
verb, but do NOT loosen the assertions. (Expected: they ARE available at start, so it passes
unchanged.)

- [ ] **Step 4: Commit**

```bash
git add tests/e2e/movement.spec.ts
git commit -m "test(e2e): order-first movement flow (arm verb, then pick destination)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 5: Final gate + push

**Files:** none (verification only).

- [ ] **Step 1: Full gate**

Run from repo root:
```bash
corepack pnpm typecheck && corepack pnpm lint && corepack pnpm test && corepack pnpm test:e2e
```
Expected: all green.

- [ ] **Step 2: Confirm no leftover references**

Run: `grep -rn "playingCard\|contextualMove\|contextualStrike\|cardModeLabel\|onStartOrder\|onStartStrike" packages/web/src`
Expected: **no matches** (all removed/renamed).

- [ ] **Step 3: Push and open the PR (ask first per workflow)**

Confirm with the user before pushing/opening the PR. Then:
```bash
git push -u origin feat/order-first-flow
gh pr create --fill --base main
```
Watch CI (including the Browser Smoke Test) and report status. Do not merge without asking.

---

## Self-Review

**Spec coverage:**
- Verb palette, all 8 verbs, greyed when unusable → Task 2 Step 1 (`IdleBar`), `availability` from `verbAvailability` (Task 1). ✅
- Armed targeting state unifying base orders + cards → Task 2 Steps 2–7 (`armedOrder`, `startCardPlay`). ✅
- Idle = nothing glows; armed = candidates glow → Task 2 Step 3 (`legalTargetIds`), guarded by Task 4 Step 2 E2E. ✅
- Inspect always works; candidate click also opens composer → Task 2 Step 4 (`handleSelectArea`). ✅
- Move → MoveBar with source steppers; Strike → StrikeBar target pre-selected → reuses existing `startOrder`/`startStrike` + composer bars (unchanged), driven by `resolveArmed` (Task 2 Step 4). ✅
- Non-candidate click just inspects + generic hint → `handleSelectArea` only resolves on a real candidate; banner copy is generic (Task 2 Steps 1, 4). ✅
- Reinforce/Embark/Plan/Pass unchanged paths → Task 2 Step 1 palette wires `onStartPlacement`/`onStartPlan`/`onPass`; Task 4 Step 3 keeps support E2E green. ✅
- Delete `contextualMove`/`contextualStrike`/`playingCard` + contextual buttons → Task 2 Steps 3, 6; verified Task 5 Step 2. ✅
- Per-tile "why ineligible" reason explicitly out of scope → generic banner hint only. ✅

**Placeholder scan:** No TBD/TODO; every code step shows full content; the only judgment call (import-list adjustment in Task 2 Step 5) is bounded by the gate. ✅

**Type consistency:** `ArmedOrder`, `verbAvailability`, `armMove`, `armStrike`, `candidateTiles`, `resolveArmedTile`, `VerbAvailability`, `ResolvedOrder` are defined in Task 1 and consumed with identical names/signatures in Task 2. `data-order-verb` attribute (Task 2) matches the E2E locators (Task 4). `armedLabel` prop name matches between ActionBar props (Task 2 Step 1) and the App wiring (Task 2 Step 7). ✅
