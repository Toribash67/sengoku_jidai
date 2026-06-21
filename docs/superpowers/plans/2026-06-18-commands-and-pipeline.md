# Commands + Resolution Pipeline + Turn Flow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make a complete hotseat Rivers game playable end-to-end (minus operation cards) by adding the `Command` union and a deterministic `resolveCommand` resolution pipeline over the schemaVersion-2 `GameState`.

**Architecture:** Approach C (spec §6/§7). Every command is an atomic, full-intent message run through a fixed pipeline: `validate → deployCommander → moveIn/placeUnits → [reactionWindow] → rollDice → [rerollWindow] → applyRemovals → attrition → updateOwners → applyAreaBonuses → enforceCaps → advanceTurn → checkGameEnd`. The bracketed windows are no-op seams for future cards. Control and supply are always **derived** from unit positions (never stored) via a `SupplyBoard` bridge over `GameState.areas`. Action spaces are **derived** from static map data, not stored as layout.

**Scope (decided 2026-06-18): ADDITIVE ONLY.** Build the v2 pipeline in new engine files, fully tested via direct `../src/*.js` imports. Do **NOT** delete the placeholder files (`types.ts`, `setup.ts`, `resolveCommand.ts`, `validateCommand.ts`, `view.ts`, `serialization.ts`, `maps/placeholderMap.ts`), do **NOT** change `index.ts`, and do **NOT** touch `server`/`shared`/`web`. That deletion + consumer migration belongs to Plan 4 (views/serialization). This mirrors how Plans 1 & 2 stayed additive and keeps every package independently green.

**Tech Stack:** TypeScript (ESM, `.js` import specifiers), Vitest. Tests live in `packages/engine/test/` mirroring `src/`. `tsconfig.json` typechecks src+test (`noEmit`); `tsconfig.build.json` emits src only.

**Naming note (avoid clashes with the still-present placeholder):** the placeholder already exports `Command`, `CommandActor`, `RejectionReason`, `GameEvent`, `CommandResult`, `validateCommand`, `resolveCommand`, `PendingDecision`, `PendingChoice` from `types.ts`/`resolveCommand.ts`/`validateCommand.ts`. The new v2 versions live in **new files** (`commands.ts`, `resolve.ts`, `validate.ts`) and are **not** re-exported from `index.ts` this plan, so there is no name collision. Tests import the new symbols directly from their source files.

---

## File Structure

**New files (all under `packages/engine/`):**

- `src/commands.ts` — v2 `Command` union, `CommandActor`, `RejectionReason`, `GameEvent`, `CommandResult`, `Move`, `Placement` types.
- `src/actionSpaces.ts` — `ActionSpace` descriptor + `buildActionSpaces(map)` / `actionSpaceMap(map)` / `emptyActionSpaceOccupancy(map)`. Linked spaces derived from map areas; support spaces are a fixed Rivers set.
- `src/board.ts` — `gameBoard(state)` → `SupplyBoard` bridge over `GameState.areas`.
- `src/legality.ts` — pure predicates shared by validation and resolution: `unitKindFor`, `advanceSources`, `sailReachable`, `reinforceTargets`, `embarkTargets`, `bombardTargets`, `shellTargets`, `available`, `occupiedCount`.
- `src/conflict.ts` — `resolveConflict(rngState, faces, attackers, defenders)` pure helper.
- `src/validate.ts` — `validateCommand(state, actor, command)` → `RejectionReason | null`.
- `src/actions.ts` — per-action mutators (`applyAdvance`, `applySail`, `applyBombard`, `applyShell`, `applyReinforce`, `applyEmbark`, `applyPlan`, `applyPass`) that mutate a draft state and return `GameEvent[]`.
- `src/resolve.ts` — `resolveCommand(state, actor, command)`: clone, validate, dispatch, run post-steps (`enforceCaps`, HQ check, `advanceTurn` w/ auto-recall + round-4 VP end), bump `revision`.

**Modified files:**

- `src/state.ts` — add `PendingChoice`/`PendingDecision` interfaces; add `pendingDecision` and `revision` to `GameState`.
- `src/game.ts` — set `revision: 0`, `pendingDecision: null`, and seed `actionSpaces` from the map.
- `test/game.test.ts` — update the `actionSpaces` assertion (line 38) and add new-field assertions.

**Test files (new):** `test/board.test.ts`, `test/actionSpaces.test.ts`, `test/conflict.test.ts`, `test/validate.test.ts`, `test/resolve.test.ts`, `test/actions.test.ts`, `test/goldenExampleTurn.test.ts`.

---

## Task 1: State fields — `pendingDecision` + `revision`

**Files:**

- Modify: `packages/engine/src/state.ts`
- Modify: `packages/engine/src/game.ts:101-119`
- Modify: `packages/engine/test/game.test.ts`

- [ ] **Step 1: Write the failing test** — append to `test/game.test.ts` inside the `describe("createInitialState", ...)` block:

```ts
it("opens with revision 0 and no pending decision", () => {
  const s = createInitialState(opts);
  expect(s.revision).toBe(0);
  expect(s.pendingDecision).toBeNull();
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @sengoku-jidai/engine test -- game`
Expected: FAIL — `revision`/`pendingDecision` are not on the type / are `undefined`.

- [ ] **Step 3: Add the types to `state.ts`**

After the `OperationCard` type (line 15), add:

```ts
/** A choice offered by a pending decision (future cards seam). */
export interface PendingChoice {
  id: string;
  label: string;
}

/** A decision the engine is waiting on before any other command (future cards). */
export interface PendingDecision {
  id: string;
  seat: SeatId;
  prompt: string;
  choices: PendingChoice[];
}
```

In the `GameState` interface, replace the trailing fields block:

```ts
  pendingDecision: null; // unused by actions in v1; populated only by future cards
  winner: SeatId | null;
  endReason: EndReason | null;
}
```

with:

```ts
  /** Monotonic version; bumped once per accepted command. Read by server persistence. */
  revision: number;

  pendingDecision: PendingDecision | null; // unused by actions in v1; populated only by future cards
  winner: SeatId | null;
  endReason: EndReason | null;
}
```

(The current `state.ts` GameState ends with `winner`/`endReason` and has no `pendingDecision`; insert both `revision` and `pendingDecision` before `winner`. Also delete the stale "Deliberately omitted until later plans" doc-comment block at lines 56-62 that says these fields are deferred.)

- [ ] **Step 4: Set the fields in `createInitialState`**

In `game.ts`, in the returned object (currently ending `actionSpaces: {}, bonuses, winner: null, endReason: null`), change to:

```ts
    actionSpaces: {},
    bonuses,
    revision: 0,
    pendingDecision: null,
    winner: null,
    endReason: null
```

(The `actionSpaces: {}` becomes a real seed in Task 2; leave it `{}` for now.)

- [ ] **Step 5: Run to verify it passes**

Run: `pnpm --filter @sengoku-jidai/engine test -- game`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/engine/src/state.ts packages/engine/src/game.ts packages/engine/test/game.test.ts
git commit -m "feat(engine): add revision and pendingDecision to v2 GameState"
```

---

## Task 2: Action-space catalog

**Files:**

- Create: `packages/engine/src/actionSpaces.ts`
- Create: `packages/engine/test/actionSpaces.test.ts`
- Modify: `packages/engine/src/game.ts`
- Modify: `packages/engine/test/game.test.ts:38`

- [ ] **Step 1: Write the failing test** — create `test/actionSpaces.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { riversMap } from "../src/maps/riversMap.js";
import {
  buildActionSpaces,
  actionSpaceMap,
  emptyActionSpaceOccupancy
} from "../src/actionSpaces.js";

describe("buildActionSpaces (rivers)", () => {
  const spaces = buildActionSpaces(riversMap);
  const byId = actionSpaceMap(riversMap);

  it("has one advance space per land area", () => {
    const lands = Object.values(riversMap.areas).filter((a) => a.kind === "land");
    for (const a of lands) {
      expect(byId[`advance-${a.id}`]).toMatchObject({ type: "advance", areaId: a.id });
    }
  });

  it("has sail + bombard per sea area", () => {
    const seas = Object.values(riversMap.areas).filter((a) => a.kind === "sea");
    for (const a of seas) {
      expect(byId[`sail-${a.id}`]).toMatchObject({ type: "sail", areaId: a.id });
      expect(byId[`bombard-${a.id}`]).toMatchObject({ type: "bombard", areaId: a.id });
    }
  });

  it("has a shell space exactly for shellable lands {10,12,19,21}", () => {
    const shellIds = spaces
      .filter((s) => s.type === "shell")
      .map((s) => s.areaId)
      .sort();
    expect(shellIds).toEqual(["tile10", "tile12", "tile19", "tile21"]);
  });

  it("has the fixed Rivers support spaces with N values", () => {
    expect(byId["reinforce-a"]).toMatchObject({ type: "reinforce", areaId: null, amount: 6 });
    expect(byId["reinforce-b"]).toMatchObject({ type: "reinforce", areaId: null, amount: 5 });
    expect(byId["embark-a"]).toMatchObject({ type: "embark", areaId: null, amount: 3 });
    expect(byId["embark-b"]).toMatchObject({ type: "embark", areaId: null, amount: 2 });
    expect(byId["plan-a"]).toMatchObject({ type: "plan", areaId: null, initiative: true });
    expect(byId["plan-b"].initiative).toBeUndefined();
  });

  it("emptyActionSpaceOccupancy maps every space id to null", () => {
    const occ = emptyActionSpaceOccupancy(riversMap);
    expect(Object.keys(occ).sort()).toEqual(spaces.map((s) => s.id).sort());
    expect(Object.values(occ).every((v) => v === null)).toBe(true);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @sengoku-jidai/engine test -- actionSpaces`
Expected: FAIL — `actionSpaces.js` does not exist.

- [ ] **Step 3: Implement `actionSpaces.ts`**

```ts
import type { MapDefinition } from "./maps/riversMap.js";
import type { ActionType } from "./rules.js";

/**
 * A deployable action space. Linked spaces (advance/sail/bombard/shell) are
 * derived from static map area data; support spaces (reinforce/embark/plan) are
 * a fixed per-board set. Occupancy lives in `GameState.actionSpaces`, keyed by id.
 */
export interface ActionSpace {
  id: string;
  type: ActionType;
  /** Linked board area for linked actions; null for support spaces. */
  areaId: string | null;
  /** N for reinforce (troops) / embark (ships) / plan (cards). */
  amount?: number;
  /** True for the single Plan space that seizes next-round initiative. */
  initiative?: boolean;
}

/** Rivers support board: two spaces per support type; one Plan space seizes initiative. */
const SUPPORT_SPACES: readonly ActionSpace[] = [
  { id: "reinforce-a", type: "reinforce", areaId: null, amount: 6 },
  { id: "reinforce-b", type: "reinforce", areaId: null, amount: 5 },
  { id: "embark-a", type: "embark", areaId: null, amount: 3 },
  { id: "embark-b", type: "embark", areaId: null, amount: 2 },
  { id: "plan-a", type: "plan", areaId: null, amount: 1, initiative: true },
  { id: "plan-b", type: "plan", areaId: null, amount: 1 }
];

/** The full action-space catalog for a map (deterministic order: areas then support). */
export function buildActionSpaces(map: MapDefinition): ActionSpace[] {
  const spaces: ActionSpace[] = [];
  for (const a of Object.values(map.areas)) {
    if (a.kind === "land") {
      spaces.push({ id: `advance-${a.id}`, type: "advance", areaId: a.id });
      if (a.shellable) spaces.push({ id: `shell-${a.id}`, type: "shell", areaId: a.id });
    } else {
      spaces.push({ id: `sail-${a.id}`, type: "sail", areaId: a.id });
      spaces.push({ id: `bombard-${a.id}`, type: "bombard", areaId: a.id });
    }
  }
  for (const s of SUPPORT_SPACES) spaces.push({ ...s });
  return spaces;
}

/** Catalog keyed by space id for O(1) descriptor lookup. */
export function actionSpaceMap(map: MapDefinition): Record<string, ActionSpace> {
  return Object.fromEntries(buildActionSpaces(map).map((s) => [s.id, s]));
}

/** Fresh occupancy record: every space id -> null. Seeds `GameState.actionSpaces`. */
export function emptyActionSpaceOccupancy(map: MapDefinition): Record<string, null> {
  return Object.fromEntries(buildActionSpaces(map).map((s) => [s.id, null]));
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @sengoku-jidai/engine test -- actionSpaces`
Expected: PASS.

- [ ] **Step 5: Seed `actionSpaces` in `createInitialState`**

In `game.ts`: add the import

```ts
import { emptyActionSpaceOccupancy } from "./actionSpaces.js";
```

and change `actionSpaces: {},` in the returned object to:

```ts
    actionSpaces: emptyActionSpaceOccupancy(map),
```

- [ ] **Step 6: Update the now-stale assertion in `game.test.ts`**

Replace line 38 `expect(s.actionSpaces).toEqual({});` with:

```ts
expect(Object.keys(s.actionSpaces).length).toBeGreaterThan(0);
expect(Object.values(s.actionSpaces).every((v) => v === null)).toBe(true);
```

- [ ] **Step 7: Run the full engine suite**

Run: `pnpm --filter @sengoku-jidai/engine test`
Expected: PASS (the replay-anchor test still passes — seeding spaces adds no RNG draws).

- [ ] **Step 8: Commit**

```bash
git add packages/engine/src/actionSpaces.ts packages/engine/test/actionSpaces.test.ts packages/engine/src/game.ts packages/engine/test/game.test.ts
git commit -m "feat(engine): derive action-space catalog and seed occupancy at setup"
```

---

## Task 3: SupplyBoard bridge

**Files:**

- Create: `packages/engine/src/board.ts`
- Create: `packages/engine/test/board.test.ts`

- [ ] **Step 1: Write the failing test** — create `test/board.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { createInitialState } from "../src/game.js";
import { riversMap } from "../src/maps/riversMap.js";
import { gameBoard } from "../src/board.js";
import { suppliedAreas } from "../src/supply.js";

const hqOf = (seat: "red" | "black") =>
  Object.values(riversMap.areas).find((a) => a.hq === seat)!.id;

describe("gameBoard", () => {
  it("reports the owner of each area from live state", () => {
    const s = createInitialState({ gameId: "g", seed: "seed-A" });
    const board = gameBoard(s);
    expect(board.ownerOf(hqOf("red"))).toBe("red");
    expect(board.ownerOf(hqOf("black"))).toBe("black");
    expect(board.ownerOf("tile3")).toBeNull();
  });

  it("returns null for unknown area ids", () => {
    const s = createInitialState({ gameId: "g", seed: "seed-A" });
    expect(gameBoard(s).ownerOf("nope")).toBeNull();
  });

  it("drives suppliedAreas over live state (HQ supplies itself at setup)", () => {
    const s = createInitialState({ gameId: "g", seed: "seed-A" });
    const supplied = suppliedAreas(riversMap, gameBoard(s), "red");
    expect(supplied.has(hqOf("red"))).toBe(true);
    // No adjacent areas are controlled at setup, so supply is just the HQ.
    expect(supplied.size).toBe(1);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @sengoku-jidai/engine test -- board`
Expected: FAIL — `board.js` does not exist.

- [ ] **Step 3: Implement `board.ts`**

```ts
import type { GameState } from "./state.js";
import type { SupplyBoard } from "./supply.js";

/**
 * Bridge live `GameState.areas` into the `SupplyBoard` the supply/scoring layer
 * consumes. Control is derived (owner === seat), never stored separately.
 */
export function gameBoard(state: GameState): SupplyBoard {
  return { ownerOf: (areaId) => state.areas[areaId]?.owner ?? null };
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @sengoku-jidai/engine test -- board`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/engine/src/board.ts packages/engine/test/board.test.ts
git commit -m "feat(engine): add SupplyBoard bridge over live GameState"
```

---

## Task 4: Command types + legality predicates

**Files:**

- Create: `packages/engine/src/commands.ts`
- Create: `packages/engine/src/legality.ts`
- Create: `packages/engine/test/legality.test.ts`

- [ ] **Step 1: Implement `commands.ts`** (pure types; exercised by later tasks)

```ts
import type { SeatId } from "./types.js";
import type { GameState, PendingChoice, UnitType } from "./state.js";
import type { BonusType } from "./rules.js";

/** Who is issuing the command. */
export interface CommandActor {
  seat: SeatId;
}

export type Move = { from: string; count: number };
export type Placement = { area: string; count: number };

export type Command =
  | { type: "advance"; spaceId: string; moves: Move[] }
  | { type: "sail"; spaceId: string; moves: Move[] }
  | { type: "bombard"; spaceId: string; targetAreaId: string }
  | { type: "shell"; spaceId: string; targetAreaId: string }
  | { type: "reinforce"; spaceId: string; placements: Placement[] }
  | { type: "embark"; spaceId: string; placements: Placement[] }
  | { type: "plan"; spaceId: string }
  | { type: "pass" }
  | { type: "choosePendingDecision"; pendingId: string; choice: PendingChoice };

export type RejectionReason =
  | { code: "notActiveSeat"; message: string }
  | { code: "wrongPhase"; message: string }
  | { code: "gameNotActive"; message: string }
  | { code: "spaceNotFound"; message: string }
  | { code: "spaceWrongType"; message: string }
  | { code: "spaceOccupied"; message: string }
  | { code: "actionDisabled"; message: string }
  | { code: "supportTypeUsed"; message: string }
  | { code: "criteriaNotMet"; message: string }
  | { code: "illegalMove"; message: string }
  | { code: "illegalPlacement"; message: string }
  | { code: "illegalTarget"; message: string }
  | { code: "insufficientReserve"; message: string }
  | { code: "pendingDecisionRequired"; message: string }
  | { code: "pendingDecisionNotFound"; message: string };

export type GameEvent =
  | { type: "commanderDeployed"; seat: SeatId; spaceId: string }
  | { type: "passed"; seat: SeatId }
  | { type: "unitsMoved"; seat: SeatId; from: string; to: string; unit: UnitType; count: number }
  | { type: "unitsPlaced"; seat: SeatId; area: string; unit: UnitType; count: number }
  | { type: "bonusApplied"; seat: SeatId; bonus: BonusType; area: string }
  | { type: "diceRolled"; seat: SeatId; purpose: string; rolls: number[]; total: number }
  | { type: "unitsRemoved"; seat: SeatId; area: string; unit: UnitType; count: number }
  | { type: "areaCaptured"; seat: SeatId; area: string; previousOwner: SeatId | null }
  | { type: "capExceeded"; area: string; unit: UnitType; returned: number; owner: SeatId }
  | { type: "turnAdvanced"; activeSeat: SeatId }
  | { type: "recalled"; round: number; initiative: SeatId }
  | { type: "initiativeSeized"; seat: SeatId }
  | { type: "gameEnded"; winner: SeatId | null; reason: "hqEliminated" | "victoryPoints" };

export type CommandResult =
  | { status: "accepted"; nextState: GameState; events: GameEvent[] }
  | { status: "rejected"; reason: RejectionReason };
```

- [ ] **Step 2: Write the failing test** — create `test/legality.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { createInitialState } from "../src/game.js";
import { riversMap } from "../src/maps/riversMap.js";
import { gameBoard } from "../src/board.js";
import {
  unitKindFor,
  advanceSources,
  sailReachable,
  reinforceTargets,
  bombardTargets,
  shellTargets,
  available,
  occupiedCount
} from "../src/legality.js";

const hqOf = (seat: "red" | "black") =>
  Object.values(riversMap.areas).find((a) => a.hq === seat)!.id;

function stateWith(
  units: Record<string, { owner: "red" | "black" | null; troop?: number; ship?: number }>
) {
  const s = createInitialState({ gameId: "g", seed: "seed-A" });
  for (const [id, u] of Object.entries(units)) {
    s.areas[id] = {
      owner: u.owner,
      units: { troop: u.troop ?? 0, ship: u.ship ?? 0, siege: 0 }
    };
  }
  return s;
}

describe("legality predicates", () => {
  it("unitKindFor maps land->troop, sea->ship", () => {
    expect(unitKindFor(riversMap.areas["tile10"]!)).toBe("troop");
    expect(unitKindFor(riversMap.areas["tile3"]!)).toBe("ship");
  });

  it("advanceSources: supplied land adjacent to the target", () => {
    // red HQ tile9 -> tile10 supplied; advancing into tile1 (adjacent to both).
    const s = stateWith({
      [hqOf("red")]: { owner: "red", troop: 3 },
      tile10: { owner: "red", troop: 2 }
    });
    const sources = advanceSources(riversMap, gameBoard(s), "red", "tile1");
    expect(sources.has(hqOf("red"))).toBe(true); // tile9 adjacent to tile1
    expect(sources.has("tile10")).toBe(true); // tile10 adjacent to tile1
  });

  it("advanceSources: supplied land adjacent to a supplied water adjacent to target", () => {
    // red supplies tile9(HQ)->tile15(sea)->... target tile16 is adjacent to tile15.
    const s = stateWith({
      [hqOf("red")]: { owner: "red", troop: 3 },
      tile15: { owner: "red", ship: 1 }
    });
    const sources = advanceSources(riversMap, gameBoard(s), "red", "tile16");
    // tile9 is land, supplied, adjacent to tile15 (supplied water) which is adjacent to tile16.
    expect(sources.has(hqOf("red"))).toBe(true);
  });

  it("sailReachable: supplied water chain to the target water", () => {
    // red supplies tile9(HQ land)->tile15(sea)->tile11(sea); sailing into tile17 (adj tile11).
    const s = stateWith({
      [hqOf("red")]: { owner: "red", troop: 3 },
      tile15: { owner: "red", ship: 2 },
      tile11: { owner: "red", ship: 2 }
    });
    const reach = sailReachable(riversMap, gameBoard(s), "red", "tile17");
    expect(reach.has("tile15")).toBe(true);
    expect(reach.has("tile11")).toBe(true);
  });

  it("reinforceTargets are exactly the supplied land areas", () => {
    const s = stateWith({
      [hqOf("red")]: { owner: "red", troop: 3 },
      tile10: { owner: "red", troop: 1 }
    });
    const targets = reinforceTargets(riversMap, gameBoard(s), "red");
    expect(targets.has(hqOf("red"))).toBe(true);
    expect(targets.has("tile10")).toBe(true);
    expect(targets.has("tile3")).toBe(false); // sea
  });

  it("bombardTargets are land areas adjacent to the linked water", () => {
    expect(bombardTargets(riversMap, "tile3").sort()).toEqual(["tile4", "tile6", "tile8"].sort());
  });

  it("shellTargets are water areas adjacent to the linked land", () => {
    expect(shellTargets(riversMap, "tile10")).toEqual([]); // tile10 has no adjacent sea
    expect(shellTargets(riversMap, "tile12")).toEqual([]);
  });

  it("available and occupiedCount track commander spend", () => {
    const s = createInitialState({ gameId: "g", seed: "seed-A" });
    s.actionSpaces["advance-tile1"] = "red";
    s.players.red.commanders.standby = 1;
    expect(occupiedCount(s, "red")).toBe(1);
    expect(available(s, "red")).toBe(5 - 1 - 1); // total - occupied - standby
  });
});
```

> Note: `bombardTargets`/`shellTargets` expectations above are derived from `riversMap.ts` adjacency. Before writing the implementation, confirm them against the actual `adjacent` arrays in `riversMap.ts`; `tile3.adjacent = ["tile7","tile6","tile8"]` includes sea `tile7`, so `bombardTargets` must filter to **land** neighbours → `["tile6","tile8","tile4"]` (tile4's adjacency includes tile8 only — recheck: a land neighbour of tile3 is any land area whose `adjacent` lists tile3 OR that tile3 lists). Use the symmetric adjacency already guaranteed by `riversMap.test.ts`: filter `map.areas[water].adjacent` to land. For tile3 that is `tile6`,`tile8` (both land) plus `tile4`? `tile4.adjacent=["tile8"]` only, so tile4 is NOT adjacent to tile3 — **fix the test expectation to `["tile6","tile8"]`** if the map says so. The implementer MUST read `riversMap.ts` and set the expectation to the true land neighbours of `tile3` before locking the test.

- [ ] **Step 3: Run to verify it fails**

Run: `pnpm --filter @sengoku-jidai/engine test -- legality`
Expected: FAIL — `legality.js` does not exist.

- [ ] **Step 4: Implement `legality.ts`**

```ts
import type { MapArea, MapDefinition } from "./maps/riversMap.js";
import type { SupplyBoard } from "./supply.js";
import { suppliedAreas } from "./supply.js";
import type { GameState, UnitType } from "./state.js";
import type { SeatId } from "./types.js";
import { buildActionSpaces } from "./actionSpaces.js";

/** Land areas hold troops; sea areas hold ships. */
export function unitKindFor(area: MapArea): UnitType {
  return area.kind === "land" ? "troop" : "ship";
}

/**
 * Legal Advance source land areas for moving troops into `targetId`:
 * land areas the seat supplies that are either adjacent to the target, or
 * adjacent to a water area the seat supplies that is itself adjacent to the target.
 */
export function advanceSources(
  map: MapDefinition,
  board: SupplyBoard,
  seat: SeatId,
  targetId: string
): Set<string> {
  const supplied = suppliedAreas(map, board, seat);
  const target = map.areas[targetId]!;
  // Water "bridges": supplied seas adjacent to the target.
  const bridges = new Set(
    target.adjacent.filter((id) => map.areas[id]!.kind === "sea" && supplied.has(id))
  );
  const sources = new Set<string>();
  for (const id of supplied) {
    const a = map.areas[id]!;
    if (a.kind !== "land") continue;
    const adjToTarget = a.adjacent.includes(targetId);
    const adjToBridge = a.adjacent.some((n) => bridges.has(n));
    if (adjToTarget || adjToBridge) sources.add(id);
  }
  return sources;
}

/**
 * Water areas the seat supplies that are connected to `targetId` through an
 * unbroken chain of water areas the seat supplies (the target itself excluded
 * from the supplied requirement — you are sailing INTO it).
 */
export function sailReachable(
  map: MapDefinition,
  board: SupplyBoard,
  seat: SeatId,
  targetId: string
): Set<string> {
  const supplied = suppliedAreas(map, board, seat);
  // Walk the graph of supplied seas, starting from supplied seas adjacent to the target.
  const reachable = new Set<string>();
  const queue: string[] = [];
  for (const n of map.areas[targetId]!.adjacent) {
    if (map.areas[n]!.kind === "sea" && supplied.has(n)) {
      reachable.add(n);
      queue.push(n);
    }
  }
  while (queue.length > 0) {
    const cur = queue.shift()!;
    for (const n of map.areas[cur]!.adjacent) {
      if (!reachable.has(n) && map.areas[n]!.kind === "sea" && supplied.has(n)) {
        reachable.add(n);
        queue.push(n);
      }
    }
  }
  return reachable;
}

/** Land areas the seat supplies (Reinforce placement targets). */
export function reinforceTargets(
  map: MapDefinition,
  board: SupplyBoard,
  seat: SeatId
): Set<string> {
  const out = new Set<string>();
  for (const id of suppliedAreas(map, board, seat)) {
    if (map.areas[id]!.kind === "land") out.add(id);
  }
  return out;
}

/**
 * Embark placement targets: water areas the seat supplies, plus water areas
 * reachable via a supplied port (harbor land the seat supplies) that contain no
 * enemy ships.
 */
export function embarkTargets(map: MapDefinition, state: GameState, seat: SeatId): Set<string> {
  const board: SupplyBoard = { ownerOf: (id) => state.areas[id]?.owner ?? null };
  const supplied = suppliedAreas(map, board, seat);
  const out = new Set<string>();
  for (const id of supplied) if (map.areas[id]!.kind === "sea") out.add(id);
  const enemy: SeatId = seat === "red" ? "black" : "red";
  for (const id of supplied) {
    const a = map.areas[id]!;
    if (!a.harbor) continue;
    for (const w of a.ports) {
      const rt = state.areas[w];
      const hasEnemyShips = rt?.owner === enemy && rt.units.ship > 0;
      if (!hasEnemyShips) out.add(w);
    }
  }
  return out;
}

/** Land areas adjacent to a water area (Bombard targets). */
export function bombardTargets(map: MapDefinition, waterId: string): string[] {
  return map.areas[waterId]!.adjacent.filter((id) => map.areas[id]!.kind === "land");
}

/** Water areas adjacent to a land area (Shell targets). */
export function shellTargets(map: MapDefinition, landId: string): string[] {
  return map.areas[landId]!.adjacent.filter((id) => map.areas[id]!.kind === "sea");
}

/** Number of action spaces currently occupied by a seat. */
export function occupiedCount(state: GameState, seat: SeatId): number {
  return Object.values(state.actionSpaces).filter((o) => o === seat).length;
}

/** Commanders the seat can still deploy this round. */
export function available(state: GameState, seat: SeatId): number {
  const p = state.players[seat];
  return p.commanders.total - occupiedCount(state, seat) - p.commanders.standby;
}

/** Whether the seat already occupies a support space of the given type this round. */
export function supportTypeOccupied(
  map: MapDefinition,
  state: GameState,
  seat: SeatId,
  type: "reinforce" | "embark" | "plan"
): boolean {
  const catalog = buildActionSpaces(map);
  return catalog.some((sp) => sp.type === type && state.actionSpaces[sp.id] === seat);
}
```

- [ ] **Step 5: Run to verify it passes** (fix the `bombardTargets`/`shellTargets` expectations in the test to the true map neighbours first, per the note in Step 2)

Run: `pnpm --filter @sengoku-jidai/engine test -- legality`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/engine/src/commands.ts packages/engine/src/legality.ts packages/engine/test/legality.test.ts
git commit -m "feat(engine): add v2 command types and legality predicates"
```

---

## Task 5: Conflict resolver

**Files:**

- Create: `packages/engine/src/conflict.ts`
- Create: `packages/engine/test/conflict.test.ts`

- [ ] **Step 1: Write the failing test** — create `test/conflict.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { resolveConflict } from "../src/conflict.js";

// All-1 faces make the defence roll deterministic (=1) for arithmetic assertions.
const ONES = [1, 1, 1, 1, 1, 1];

describe("resolveConflict", () => {
  it("defence removes attackers, then attrition removes one-for-one", () => {
    // 5 attackers vs 3 defenders, defence roll 1.
    const r = resolveConflict("123", ONES, 5, 3);
    expect(r.defenceRoll).toBe(1);
    // after defence: 4 attackers vs 3 defenders; attrition removes 3 each -> 1 vs 0.
    expect(r.attackersLeft).toBe(1);
    expect(r.defendersLeft).toBe(0);
    expect(r.attackerLosses).toBe(4); // 1 defence + 3 attrition
    expect(r.defenderLosses).toBe(3);
  });

  it("defender survives when attackers run out", () => {
    const r = resolveConflict("123", ONES, 3, 5);
    // after defence: 2 vs 5; attrition removes 2 each -> 0 vs 3.
    expect(r.attackersLeft).toBe(0);
    expect(r.defendersLeft).toBe(3);
  });

  it("a tie empties both sides", () => {
    const r = resolveConflict("123", ONES, 4, 3);
    // after defence: 3 vs 3; attrition -> 0 vs 0.
    expect(r.attackersLeft).toBe(0);
    expect(r.defendersLeft).toBe(0);
  });

  it("no attrition when defence wipes the attackers", () => {
    const big = [9, 9, 9, 9, 9, 9];
    const r = resolveConflict("123", big, 2, 4);
    expect(r.attackersLeft).toBe(0);
    expect(r.defendersLeft).toBe(4);
    expect(r.attackerLosses).toBe(2);
    expect(r.defenderLosses).toBe(0);
  });

  it("advances the rng state", () => {
    const r = resolveConflict("123", ONES, 1, 1);
    expect(r.rngState).not.toBe("123");
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @sengoku-jidai/engine test -- conflict`
Expected: FAIL — `conflict.js` does not exist.

- [ ] **Step 3: Implement `conflict.ts`**

```ts
import { rollDie } from "./rng.js";

export interface ConflictOutcome {
  rngState: string;
  defenceRoll: number;
  attackersLeft: number;
  defendersLeft: number;
  attackerLosses: number;
  defenderLosses: number;
}

/**
 * Section 3 conflict, pure: (1) defender rolls one die; attacker removes that many
 * attacking units. (2) If attackers remain, both sides remove one unit at a time
 * simultaneously until one side has none (= remove min of the two from each).
 */
export function resolveConflict(
  rngState: string,
  faces: readonly number[],
  attackers: number,
  defenders: number
): ConflictOutcome {
  const roll = rollDie(rngState, faces);
  const defenceRemoved = Math.min(roll.value, attackers);
  let a = attackers - defenceRemoved;
  let d = defenders;
  let attrition = 0;
  if (a > 0) {
    attrition = Math.min(a, d);
    a -= attrition;
    d -= attrition;
  }
  return {
    rngState: roll.state,
    defenceRoll: roll.value,
    attackersLeft: a,
    defendersLeft: d,
    attackerLosses: defenceRemoved + attrition,
    defenderLosses: attrition
  };
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @sengoku-jidai/engine test -- conflict`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/engine/src/conflict.ts packages/engine/test/conflict.test.ts
git commit -m "feat(engine): add pure conflict resolver"
```

---

## Task 6: Validation

**Files:**

- Create: `packages/engine/src/validate.ts`
- Create: `packages/engine/test/validate.test.ts`

`validateCommand` returns `null` (legal) or a `RejectionReason`. It enforces the common criteria (active seat, phase, status, pending-decision gate, space exists/type/unoccupied, action enabled, support-type-once) and per-action criteria (control/supply gates, source/placement/target legality, "can't take last unit", totals ≤ N, reserve sufficiency).

- [ ] **Step 1: Write the failing test** — create `test/validate.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { createInitialState } from "../src/game.js";
import { riversMap } from "../src/maps/riversMap.js";
import { validateCommand } from "../src/validate.js";
import type { Command } from "../src/commands.js";

const hqOf = (seat: "red" | "black") =>
  Object.values(riversMap.areas).find((a) => a.hq === seat)!.id;

function base() {
  const s = createInitialState({ gameId: "g", seed: "seed-A" });
  s.initiative = "red";
  s.activeSeat = "red";
  return s;
}

describe("validateCommand common criteria", () => {
  it("rejects when it is not the actor's turn", () => {
    const s = base();
    const r = validateCommand(s, { seat: "black" }, { type: "pass" });
    expect(r?.code).toBe("notActiveSeat");
  });

  it("rejects when the game is not active", () => {
    const s = base();
    s.status = "complete";
    expect(validateCommand(s, { seat: "red" }, { type: "pass" })?.code).toBe("gameNotActive");
  });

  it("accepts a pass on the active seat's turn", () => {
    const s = base();
    expect(validateCommand(s, { seat: "red" }, { type: "pass" })).toBeNull();
  });

  it("rejects an unknown space", () => {
    const s = base();
    const cmd: Command = { type: "advance", spaceId: "advance-nope", moves: [] };
    expect(validateCommand(s, { seat: "red" }, cmd)?.code).toBe("spaceNotFound");
  });

  it("rejects a space of the wrong type for the command", () => {
    const s = base();
    const cmd: Command = { type: "advance", spaceId: "sail-tile3", moves: [] };
    expect(validateCommand(s, { seat: "red" }, cmd)?.code).toBe("spaceWrongType");
  });

  it("rejects an occupied space", () => {
    const s = base();
    s.actionSpaces["advance-tile1"] = "black";
    const cmd: Command = {
      type: "advance",
      spaceId: "advance-tile1",
      moves: [{ from: hqOf("red"), count: 1 }]
    };
    expect(validateCommand(s, { seat: "red" }, cmd)?.code).toBe("spaceOccupied");
  });
});

describe("validateCommand per-action criteria", () => {
  it("advance: rejects taking the last unit from a source", () => {
    const s = base();
    // red HQ tile9 has 3 troops; tile1 is empty land adjacent to tile9.
    const cmd: Command = {
      type: "advance",
      spaceId: "advance-tile1",
      moves: [{ from: hqOf("red"), count: 3 }]
    };
    expect(validateCommand(s, { seat: "red" }, cmd)?.code).toBe("illegalMove");
  });

  it("advance: rejects advancing into an area you already control", () => {
    const s = base();
    const cmd: Command = {
      type: "advance",
      spaceId: `advance-${hqOf("red")}`,
      moves: [{ from: hqOf("red"), count: 1 }]
    };
    expect(validateCommand(s, { seat: "red" }, cmd)?.code).toBe("criteriaNotMet");
  });

  it("advance: accepts a legal single-troop move into an adjacent empty land", () => {
    const s = base();
    const cmd: Command = {
      type: "advance",
      spaceId: "advance-tile1",
      moves: [{ from: hqOf("red"), count: 2 }]
    };
    expect(validateCommand(s, { seat: "red" }, cmd)).toBeNull();
  });

  it("reinforce: rejects placing more than N (+ barracks) troops", () => {
    const s = base();
    // reinforce-b: N=5. Place 6 into HQ (supplied) -> exceeds N.
    const cmd: Command = {
      type: "reinforce",
      spaceId: "reinforce-b",
      placements: [{ area: hqOf("red"), count: 6 }]
    };
    expect(validateCommand(s, { seat: "red" }, cmd)?.code).toBe("illegalPlacement");
  });

  it("reinforce: rejects when reserve is insufficient", () => {
    const s = base();
    s.players.red.reserve.troop = 1;
    const cmd: Command = {
      type: "reinforce",
      spaceId: "reinforce-a",
      placements: [{ area: hqOf("red"), count: 2 }]
    };
    expect(validateCommand(s, { seat: "red" }, cmd)?.code).toBe("insufficientReserve");
  });

  it("reinforce: rejects a second reinforce space the same round", () => {
    const s = base();
    s.actionSpaces["reinforce-a"] = "red";
    const cmd: Command = {
      type: "reinforce",
      spaceId: "reinforce-b",
      placements: [{ area: hqOf("red"), count: 1 }]
    };
    expect(validateCommand(s, { seat: "red" }, cmd)?.code).toBe("supportTypeUsed");
  });

  it("bombard: rejects a target that is not adjacent land to the linked water", () => {
    const s = base();
    // Give red a ship in tile15 so they supply it (HQ tile9 adj tile15).
    s.areas["tile15"] = { owner: "red", units: { troop: 0, ship: 1, siege: 0 } };
    const cmd: Command = { type: "bombard", spaceId: "bombard-tile15", targetAreaId: "tile3" };
    expect(validateCommand(s, { seat: "red" }, cmd)?.code).toBe("illegalTarget");
  });

  it("choosePendingDecision: rejects when there is no pending decision", () => {
    const s = base();
    const cmd: Command = {
      type: "choosePendingDecision",
      pendingId: "x",
      choice: { id: "a", label: "A" }
    };
    expect(validateCommand(s, { seat: "red" }, cmd)?.code).toBe("pendingDecisionNotFound");
  });
});
```

> Before locking the `bombard` test, confirm via `riversMap.ts` that `tile15` is a sea area, that red's HQ supplies it through adjacency in this synthetic state, and that `tile3` is **not** a land neighbour of `tile15`. Adjust the chosen tiles if the map disagrees; the criterion under test (non-adjacent target rejected) is what matters.

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @sengoku-jidai/engine test -- validate`
Expected: FAIL — `validate.js` does not exist.

- [ ] **Step 3: Implement `validate.ts`**

```ts
import type { Command, CommandActor, Move, Placement, RejectionReason } from "./commands.js";
import type { GameState } from "./state.js";
import type { SeatId } from "./types.js";
import { getMap } from "./maps/registry.js";
import { actionSpaceMap, type ActionSpace } from "./actionSpaces.js";
import { gameBoard } from "./board.js";
import { suppliedAreas } from "./supply.js";
import {
  advanceSources,
  sailReachable,
  reinforceTargets,
  embarkTargets,
  bombardTargets,
  shellTargets,
  unitKindFor,
  supportTypeOccupied
} from "./legality.js";

function reject(code: RejectionReason["code"], message: string): RejectionReason {
  return { code, message } as RejectionReason;
}

/** Returns a RejectionReason if the command is illegal in `state`, else null. */
export function validateCommand(
  state: GameState,
  actor: CommandActor,
  command: Command
): RejectionReason | null {
  // Pending-decision gate (future cards seam).
  if (state.pendingDecision && command.type !== "choosePendingDecision") {
    return reject("pendingDecisionRequired", "A pending decision must be answered first.");
  }
  if (command.type === "choosePendingDecision") {
    if (!state.pendingDecision || state.pendingDecision.id !== command.pendingId) {
      return reject("pendingDecisionNotFound", "No such pending decision.");
    }
    if (state.pendingDecision.seat !== actor.seat) {
      return reject("notActiveSeat", "This seat cannot answer the pending decision.");
    }
    if (!state.pendingDecision.choices.some((c) => c.id === command.choice.id)) {
      return reject("illegalChoice" as RejectionReason["code"], "Illegal choice.");
    }
    return null;
  }

  if (state.status !== "active") return reject("gameNotActive", "The game is not active.");
  if (state.phase !== "deploy") return reject("wrongPhase", "Not the deploy phase.");
  if (state.activeSeat !== actor.seat)
    return reject("notActiveSeat", "It is not this seat's turn.");

  const map = getMap(state.mapId);
  const rules = state.rules;

  if (command.type === "pass") return null;

  // Linked/support actions: validate the space.
  const spaces = actionSpaceMap(map);
  const space = spaces[command.spaceId];
  if (!space) return reject("spaceNotFound", "No such action space.");
  if (space.type !== command.type) return reject("spaceWrongType", "Wrong space type for command.");
  if (state.actionSpaces[command.spaceId] != null) {
    return reject("spaceOccupied", "That action space is occupied.");
  }
  if (!rules.enabledActions.includes(space.type)) {
    return reject("actionDisabled", "That action is disabled in this ruleset.");
  }

  const seat = actor.seat;
  const board = gameBoard(state);
  const supplied = suppliedAreas(map, board, seat);

  switch (command.type) {
    case "advance":
      return validateAdvance(state, seat, space, command.moves);
    case "sail":
      return validateSail(state, seat, space, command.moves);
    case "bombard":
      return validateBombard(state, seat, space, command.targetAreaId, supplied);
    case "shell":
      return validateShell(state, seat, space, command.targetAreaId, supplied);
    case "reinforce":
      return validateReinforce(state, seat, space, command.placements, supplied);
    case "embark":
      return validateEmbark(state, seat, space, command.placements);
    case "plan":
      return supportTypeOccupied(map, state, seat, "plan")
        ? reject("supportTypeUsed", "Already used a Plan space this round.")
        : null;
  }
}

function validateAdvance(
  state: GameState,
  seat: SeatId,
  space: ActionSpace,
  moves: Move[]
): RejectionReason | null {
  const map = getMap(state.mapId);
  const board = gameBoard(state);
  const target = space.areaId!;
  // Criteria: you do not control the linked land.
  if (state.areas[target]?.owner === seat) {
    return reject("criteriaNotMet", "You already control the linked land.");
  }
  if (moves.length === 0) return reject("illegalMove", "Advance must move at least one troop.");
  const legalSources = advanceSources(map, board, seat, target);
  let total = 0;
  for (const m of moves) {
    if (!legalSources.has(m.from)) return reject("illegalMove", `Illegal source ${m.from}.`);
    if (m.count < 1) return reject("illegalMove", "Move count must be >= 1.");
    const have = state.areas[m.from]!.units.troop;
    if (m.count > have - 1) return reject("illegalMove", "Cannot take the last unit.");
    total += m.count;
  }
  if (total < 1) return reject("illegalMove", "Advance must move at least one troop.");
  return null;
}

function validateSail(
  state: GameState,
  seat: SeatId,
  space: ActionSpace,
  moves: Move[]
): RejectionReason | null {
  const map = getMap(state.mapId);
  const board = gameBoard(state);
  const target = space.areaId!;
  if (state.areas[target]?.owner === seat) {
    return reject("criteriaNotMet", "You already control the linked water.");
  }
  if (moves.length === 0) return reject("illegalMove", "Sail must move at least one ship.");
  const reachable = sailReachable(map, board, seat, target);
  let total = 0;
  for (const m of moves) {
    if (!reachable.has(m.from)) return reject("illegalMove", `Unreachable source ${m.from}.`);
    if (m.count < 1) return reject("illegalMove", "Move count must be >= 1.");
    const have = state.areas[m.from]!.units.ship;
    if (m.count > have - 1) return reject("illegalMove", "Cannot take the last unit.");
    total += m.count;
  }
  if (total < 1) return reject("illegalMove", "Sail must move at least one ship.");
  return null;
}

function validateBombard(
  state: GameState,
  seat: SeatId,
  space: ActionSpace,
  targetAreaId: string,
  supplied: Set<string>
): RejectionReason | null {
  const map = getMap(state.mapId);
  const water = space.areaId!;
  if (!supplied.has(water)) return reject("criteriaNotMet", "You do not supply the linked water.");
  if (!bombardTargets(map, water).includes(targetAreaId)) {
    return reject("illegalTarget", "Target is not land adjacent to the linked water.");
  }
  return null;
}

function validateShell(
  state: GameState,
  seat: SeatId,
  space: ActionSpace,
  targetAreaId: string,
  supplied: Set<string>
): RejectionReason | null {
  const map = getMap(state.mapId);
  const land = space.areaId!;
  if (!supplied.has(land)) return reject("criteriaNotMet", "You do not supply the linked land.");
  if (!shellTargets(map, land).includes(targetAreaId)) {
    return reject("illegalTarget", "Target is not water adjacent to the linked land.");
  }
  return null;
}

function validateReinforce(
  state: GameState,
  seat: SeatId,
  space: ActionSpace,
  placements: Placement[],
  supplied: Set<string>
): RejectionReason | null {
  const map = getMap(state.mapId);
  if (supportTypeOccupied(map, state, seat, "reinforce")) {
    return reject("supportTypeUsed", "Already used a Reinforce space this round.");
  }
  const board = gameBoard(state);
  const targets = reinforceTargets(map, board, seat);
  const barracks = suppliesBonus(state, seat, "barracks");
  const n = space.amount! + (barracks ? 2 : 0);
  return validatePlacements(state, seat, placements, targets, n, "troop");
}

function validateEmbark(
  state: GameState,
  seat: SeatId,
  space: ActionSpace,
  placements: Placement[]
): RejectionReason | null {
  const map = getMap(state.mapId);
  if (supportTypeOccupied(map, state, seat, "embark")) {
    return reject("supportTypeUsed", "Already used an Embark space this round.");
  }
  const targets = embarkTargets(map, state, seat);
  return validatePlacements(state, seat, placements, targets, space.amount!, "ship");
}

function validatePlacements(
  state: GameState,
  seat: SeatId,
  placements: Placement[],
  targets: Set<string>,
  n: number,
  unit: "troop" | "ship"
): RejectionReason | null {
  if (placements.length === 0) return reject("illegalPlacement", "Place at least one unit.");
  let total = 0;
  for (const p of placements) {
    if (!targets.has(p.area)) return reject("illegalPlacement", `Illegal target ${p.area}.`);
    if (p.count < 1) return reject("illegalPlacement", "Count must be >= 1.");
    total += p.count;
  }
  if (total > n) return reject("illegalPlacement", `Placed ${total} > limit ${n}.`);
  if (total > state.players[seat].reserve[unit]) {
    return reject("insufficientReserve", "Not enough units in reserve.");
  }
  return null;
}

/** Whether the seat currently supplies the area holding the given bonus. */
export function suppliesBonus(
  state: GameState,
  seat: SeatId,
  bonus: "barracks" | "warRoom" | "pirateHaven" | "shipyard" | "hiddenBase"
): boolean {
  const map = getMap(state.mapId);
  const board = gameBoard(state);
  const supplied = suppliedAreas(map, board, seat);
  for (const [areaId, b] of Object.entries(state.bonuses)) {
    if (b === bonus && supplied.has(areaId)) return true;
  }
  return false;
}
```

> The `choosePendingDecision` branch references an `illegalChoice` code. Add `| { code: "illegalChoice"; message: string }` to `RejectionReason` in `commands.ts` (it was omitted from the Task 4 list) and remove the `as` cast. Do this as part of this step.

- [ ] **Step 4: Run to verify it passes** (correct any map-derived test expectations first)

Run: `pnpm --filter @sengoku-jidai/engine test -- validate`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/engine/src/commands.ts packages/engine/src/validate.ts packages/engine/test/validate.test.ts
git commit -m "feat(engine): add command validation for all Rivers actions"
```

---

## Task 7: Pipeline backbone — `resolveCommand`, pass, turn flow, recall, game end

This task builds `resolve.ts` and the `applyPass` action, and wires the post-action steps: `enforceCaps`, HQ-elimination check, `advanceTurn` with automatic recall and round-4 VP scoring, and `revision` bump. Later tasks add the remaining action mutators to `actions.ts` and dispatch to them.

**Files:**

- Create: `packages/engine/src/actions.ts`
- Create: `packages/engine/src/resolve.ts`
- Create: `packages/engine/test/resolve.test.ts`

- [ ] **Step 1: Write the failing test** — create `test/resolve.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { createInitialState } from "../src/game.js";
import { resolveCommand } from "../src/resolve.js";
import { available } from "../src/legality.js";

function game() {
  const s = createInitialState({ gameId: "g", seed: "seed-A" });
  s.initiative = "red";
  s.activeSeat = "red";
  return s;
}

describe("resolveCommand — pass & turn flow", () => {
  it("rejects an illegal command without mutating state", () => {
    const s = game();
    const before = JSON.stringify(s);
    const r = resolveCommand(s, { seat: "black" }, { type: "pass" });
    expect(r.status).toBe("rejected");
    expect(JSON.stringify(s)).toBe(before); // input not mutated
  });

  it("pass moves a commander to standby, bumps revision, toggles active seat", () => {
    const s = game();
    const r = resolveCommand(s, { seat: "red" }, { type: "pass" });
    expect(r.status).toBe("accepted");
    if (r.status !== "accepted") return;
    expect(r.nextState.players.red.commanders.standby).toBe(1);
    expect(r.nextState.revision).toBe(1);
    expect(r.nextState.activeSeat).toBe("black");
    expect(available(r.nextState, "red")).toBe(4);
  });

  it("ten passes end round 1 and auto-recall advances to round 2", () => {
    let s = game();
    for (let i = 0; i < 10; i++) {
      const seat = i % 2 === 0 ? "red" : "black";
      const r = resolveCommand(s, { seat }, { type: "pass" });
      expect(r.status).toBe("accepted");
      if (r.status !== "accepted") return;
      s = r.nextState;
    }
    expect(s.round).toBe(2);
    expect(s.phase).toBe("deploy");
    expect(s.activeSeat).toBe(s.initiative);
    // recall returned all commanders: standby reset, no spaces occupied.
    expect(s.players.red.commanders.standby).toBe(0);
    expect(Object.values(s.actionSpaces).every((o) => o === null)).toBe(true);
  });

  it("after round 4 the game ends by victory points", () => {
    let s = game();
    for (let round = 1; round <= 4; round++) {
      for (let i = 0; i < 10; i++) {
        const seat = i % 2 === 0 ? s.initiative : s.initiative === "red" ? "black" : "red";
        const r = resolveCommand(s, { seat }, { type: "pass" });
        if (r.status !== "accepted") throw new Error("unexpected rejection");
        s = r.nextState;
      }
    }
    expect(s.status).toBe("complete");
    expect(s.endReason).toBe("victoryPoints");
    // Both HQs hold equal stars at setup -> tie -> initiative holder wins.
    expect(s.winner).toBe(s.initiative);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @sengoku-jidai/engine test -- resolve`
Expected: FAIL — `resolve.js` does not exist.

- [ ] **Step 3: Implement `actions.ts` (pass only for now)**

```ts
import type { Command, GameEvent } from "./commands.js";
import type { GameState } from "./state.js";
import type { SeatId } from "./types.js";

/** Pass: deploy a commander to standby (unavailable until next round). */
export function applyPass(state: GameState, seat: SeatId): GameEvent[] {
  state.players[seat].commanders.standby += 1;
  state.players[seat].passed = true;
  return [{ type: "passed", seat }];
}

// Action mutators added in later tasks: applyReinforce, applyEmbark, applyPlan,
// applyAdvance, applySail, applyBombard, applyShell. Each mutates `state` and
// returns the events it produced. Dispatch lives in resolve.ts.
export type ActionDispatch = (state: GameState, seat: SeatId, command: Command) => GameEvent[];
```

- [ ] **Step 4: Implement `resolve.ts`**

```ts
import type { Command, CommandActor, CommandResult, GameEvent } from "./commands.js";
import type { GameState } from "./state.js";
import type { SeatId } from "./types.js";
import { getMap } from "./maps/registry.js";
import { validateCommand } from "./validate.js";
import { gameBoard } from "./board.js";
import { hqEliminated, victoryPoints } from "./scoring.js";
import { available } from "./legality.js";
import { applyPass } from "./actions.js";

const other = (seat: SeatId): SeatId => (seat === "red" ? "black" : "red");

function clone(state: GameState): GameState {
  return JSON.parse(JSON.stringify(state)) as GameState;
}

/** Resolve a single command. Pure: returns a new state, never mutates the input. */
export function resolveCommand(
  state: GameState,
  actor: CommandActor,
  command: Command
): CommandResult {
  const rejection = validateCommand(state, actor, command);
  if (rejection) return { status: "rejected", reason: rejection };

  const next = clone(state);
  const seat = actor.seat;
  const events: GameEvent[] = [];

  // deployCommander: occupy the chosen space (support/linked) — pass goes to standby.
  if (command.type === "pass") {
    events.push(...applyPass(next, seat));
  } else if (command.type === "choosePendingDecision") {
    // v1 seam: never reached (pendingDecision is always null), but resolve harmlessly.
    next.pendingDecision = null;
  } else {
    next.actionSpaces[command.spaceId] = seat;
    events.push({ type: "commanderDeployed", seat, spaceId: command.spaceId });
    events.push(...dispatchAction(next, seat, command));
  }

  // enforceCaps: land <= 5, water <= 3; excess -> owner reserve.
  events.push(...enforceCaps(next));

  next.revision = state.revision + 1;

  // checkGameEnd (immediate): an emptied HQ loses now.
  const ended = checkHqElimination(next);
  if (ended) {
    events.push(ended);
    return { status: "accepted", nextState: next, events };
  }

  // advanceTurn: toggle, or auto-recall + round advance / round-4 VP end.
  events.push(...advanceTurn(next));

  return { status: "accepted", nextState: next, events };
}

function dispatchAction(state: GameState, seat: SeatId, command: Command): GameEvent[] {
  switch (command.type) {
    // Filled in by later tasks. Throw loudly if an un-wired action slips past validation.
    default:
      throw new Error(`No resolver for action ${command.type}`);
  }
}

/** Reduce each area to its cap; excess returns to the owner's reserve. */
export function enforceCaps(state: GameState): GameEvent[] {
  const map = getMap(state.mapId);
  const events: GameEvent[] = [];
  for (const [id, rt] of Object.entries(state.areas)) {
    if (rt.owner == null) continue;
    const kind = map.areas[id]!.kind;
    const unit = kind === "land" ? "troop" : "ship";
    const cap = kind === "land" ? 5 : 3;
    if (rt.units[unit] > cap) {
      const returned = rt.units[unit] - cap;
      rt.units[unit] = cap;
      state.players[rt.owner].reserve[unit] += returned;
      events.push({ type: "capExceeded", area: id, unit, returned, owner: rt.owner });
    }
  }
  return events;
}

/** Immediate-loss check: a seat with no units in its own HQ loses. */
function checkHqElimination(state: GameState): GameEvent | null {
  const map = getMap(state.mapId);
  const board = gameBoard(state);
  const redOut = hqEliminated(map, board, "red");
  const blackOut = hqEliminated(map, board, "black");
  if (!redOut && !blackOut) return null;
  const winner: SeatId = redOut && blackOut ? state.initiative : redOut ? "black" : "red";
  state.status = "complete";
  state.winner = winner;
  state.endReason = "hqEliminated";
  return { type: "gameEnded", winner, reason: "hqEliminated" };
}

/** Toggle the active seat, or — when both seats are out of commanders — recall. */
export function advanceTurn(state: GameState): GameEvent[] {
  const events: GameEvent[] = [];
  const bothSpent = available(state, "red") === 0 && available(state, "black") === 0;
  if (!bothSpent) {
    state.activeSeat = other(state.activeSeat);
    events.push({ type: "turnAdvanced", activeSeat: state.activeSeat });
    return events;
  }
  // End of round: recall, then advance the round or end the game after round 4.
  recall(state);
  if (state.round >= state.rules.maxRounds) {
    events.push(...endByVictoryPoints(state));
    return events;
  }
  state.round += 1;
  state.activeSeat = state.initiative;
  events.push({ type: "recalled", round: state.round, initiative: state.initiative });
  return events;
}

/** Return all commanders to reserve and clear the action board. */
function recall(state: GameState): void {
  for (const seat of ["red", "black"] as const) {
    state.players[seat].commanders.standby = 0;
    state.players[seat].passed = false;
  }
  for (const id of Object.keys(state.actionSpaces)) state.actionSpaces[id] = null;
}

function endByVictoryPoints(state: GameState): GameEvent[] {
  const map = getMap(state.mapId);
  const board = gameBoard(state);
  const redVp = victoryPoints(map, board, "red");
  const blackVp = victoryPoints(map, board, "black");
  const winner: SeatId = redVp === blackVp ? state.initiative : redVp > blackVp ? "red" : "black";
  state.status = "complete";
  state.winner = winner;
  state.endReason = "victoryPoints";
  return [{ type: "gameEnded", winner, reason: "victoryPoints" }];
}
```

- [ ] **Step 5: Run to verify it passes**

Run: `pnpm --filter @sengoku-jidai/engine test -- resolve`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/engine/src/actions.ts packages/engine/src/resolve.ts packages/engine/test/resolve.test.ts
git commit -m "feat(engine): add resolveCommand pipeline backbone, pass, turn flow, game end"
```

---

## Task 8: Reinforce + Plan actions

**Files:**

- Modify: `packages/engine/src/actions.ts`
- Modify: `packages/engine/src/resolve.ts` (dispatch)
- Create: `packages/engine/test/actions.test.ts`

- [ ] **Step 1: Write the failing test** — create `test/actions.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { createInitialState } from "../src/game.js";
import { riversMap } from "../src/maps/riversMap.js";
import { resolveCommand } from "../src/resolve.js";

const hqOf = (seat: "red" | "black") =>
  Object.values(riversMap.areas).find((a) => a.hq === seat)!.id;

function game() {
  const s = createInitialState({ gameId: "g", seed: "seed-A" });
  s.initiative = "red";
  s.activeSeat = "red";
  // Neutralise bonuses so they don't perturb base arithmetic in these tests.
  s.bonuses = {};
  return s;
}

describe("reinforce", () => {
  it("places troops from reserve into a supplied land area", () => {
    const s = game();
    const hq = hqOf("red");
    const before = s.players.red.reserve.troop;
    const r = resolveCommand(
      s,
      { seat: "red" },
      {
        type: "reinforce",
        spaceId: "reinforce-b", // N=5
        placements: [{ area: hq, count: 2 }]
      }
    );
    expect(r.status).toBe("accepted");
    if (r.status !== "accepted") return;
    // HQ had 3 troops; +2 = 5 (within the cap).
    expect(r.nextState.areas[hq]!.units.troop).toBe(5);
    expect(r.nextState.players.red.reserve.troop).toBe(before - 2);
    expect(r.nextState.actionSpaces["reinforce-b"]).toBe("red");
  });

  it("Barracks grants +2 to the reinforce limit", () => {
    const s = game();
    const hq = hqOf("red");
    // Put barracks on the HQ so red supplies it; HQ is empty land cap 5.
    s.bonuses = { [hq]: "barracks" };
    // reinforce-b N=5, +2 barracks = 7; place 7 across HQ + an adjacent supplied land.
    s.areas["tile10"] = { owner: "red", units: { troop: 1, ship: 0, siege: 0 } };
    const r = resolveCommand(
      s,
      { seat: "red" },
      {
        type: "reinforce",
        spaceId: "reinforce-b",
        placements: [
          { area: hq, count: 2 },
          { area: "tile10", count: 4 }
        ] // total 6 <= 7
      }
    );
    expect(r.status).toBe("accepted");
  });
});

describe("plan", () => {
  it("a Plan space without the initiative symbol just spends a commander", () => {
    const s = game();
    const before = s.initiative;
    const r = resolveCommand(s, { seat: "red" }, { type: "plan", spaceId: "plan-b" });
    expect(r.status).toBe("accepted");
    if (r.status !== "accepted") return;
    expect(r.nextState.initiative).toBe(before);
    expect(r.nextState.actionSpaces["plan-b"]).toBe("red");
  });

  it("the initiative Plan space seizes next-round initiative", () => {
    const s = game();
    s.initiative = "black";
    s.activeSeat = "red"; // red is allowed to act when it's red's turn; set it so
    s.activeSeat = "black";
    const r = resolveCommand(s, { seat: "black" }, { type: "plan", spaceId: "plan-a" });
    expect(r.status).toBe("accepted");
    if (r.status !== "accepted") return;
    expect(r.nextState.initiative).toBe("black"); // black already had it; still set
    // Now flip: red seizes it.
    const s2 = game();
    s2.initiative = "black";
    s2.activeSeat = "red";
    const r2 = resolveCommand(s2, { seat: "red" }, { type: "plan", spaceId: "plan-a" });
    expect(r2.status).toBe("accepted");
    if (r2.status !== "accepted") return;
    expect(r2.nextState.initiative).toBe("red");
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @sengoku-jidai/engine test -- actions`
Expected: FAIL — dispatch throws `No resolver for action reinforce`.

- [ ] **Step 3: Add `applyReinforce` and `applyPlan` to `actions.ts`**

Add imports at the top of `actions.ts`:

```ts
import { getMap } from "./maps/registry.js";
import { actionSpaceMap } from "./actionSpaces.js";
import { suppliesBonus } from "./validate.js";
```

Add the functions:

```ts
/** Reinforce: place troops from reserve into supplied land areas (validated upstream). */
export function applyReinforce(
  state: GameState,
  seat: SeatId,
  placements: { area: string; count: number }[]
): GameEvent[] {
  const events: GameEvent[] = [];
  for (const p of placements) {
    const rt = state.areas[p.area]!;
    rt.units.troop += p.count;
    rt.owner = seat;
    state.players[seat].reserve.troop -= p.count;
    events.push({ type: "unitsPlaced", seat, area: p.area, unit: "troop", count: p.count });
  }
  if (suppliesBonus(state, seat, "barracks")) {
    // Barracks affected the limit (handled in validation); record it for the log.
    events.push({
      type: "bonusApplied",
      seat,
      bonus: "barracks",
      area: bonusArea(state, "barracks")!
    });
  }
  return events;
}

/** Plan: no-op draw in v1; the initiative Plan space seizes next-round initiative. */
export function applyPlan(state: GameState, seat: SeatId, spaceId: string): GameEvent[] {
  const map = getMap(state.mapId);
  const space = actionSpaceMap(map)[spaceId]!;
  const events: GameEvent[] = [];
  if (space.initiative) {
    state.initiative = seat;
    events.push({ type: "initiativeSeized", seat });
  }
  if (suppliesBonus(state, seat, "warRoom")) {
    events.push({
      type: "bonusApplied",
      seat,
      bonus: "warRoom",
      area: bonusArea(state, "warRoom")!
    });
  }
  return events;
}

/** Area id currently holding a given bonus, if any. */
function bonusArea(state: GameState, bonus: string): string | undefined {
  return Object.entries(state.bonuses).find(([, b]) => b === bonus)?.[0];
}
```

> `bonusArea` may return `undefined` when the bonus isn't in play (e.g. tests that clear `s.bonuses`). The `suppliesBonus` guard already returns `false` in that case, so the `bonusApplied` push won't run with an undefined area. Keep the `!` assertions — they are only reached when the bonus is supplied (hence present).

- [ ] **Step 4: Wire dispatch in `resolve.ts`**

Add imports:

```ts
import { applyPass, applyReinforce, applyPlan } from "./actions.js";
```

Replace the `dispatchAction` body:

```ts
function dispatchAction(state: GameState, seat: SeatId, command: Command): GameEvent[] {
  switch (command.type) {
    case "reinforce":
      return applyReinforce(state, seat, command.placements);
    case "plan":
      return applyPlan(state, seat, command.spaceId);
    default:
      throw new Error(`No resolver for action ${command.type}`);
  }
}
```

- [ ] **Step 5: Run to verify it passes**

Run: `pnpm --filter @sengoku-jidai/engine test -- actions`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/engine/src/actions.ts packages/engine/src/resolve.ts packages/engine/test/actions.test.ts
git commit -m "feat(engine): implement Reinforce and Plan actions"
```

---

## Task 9: Embark action

**Files:**

- Modify: `packages/engine/src/actions.ts`
- Modify: `packages/engine/src/resolve.ts` (dispatch)
- Modify: `packages/engine/test/actions.test.ts`

- [ ] **Step 1: Add the failing test** — append to `test/actions.test.ts`:

```ts
describe("embark", () => {
  it("places ships from reserve into a supplied water area", () => {
    const s = game();
    // Give red a supplied water: HQ tile9 (land) supplies adjacent sea tile15 if red controls it.
    s.areas["tile15"] = { owner: "red", units: { troop: 0, ship: 1, siege: 0 } };
    const before = s.players.red.reserve.ship;
    const r = resolveCommand(
      s,
      { seat: "red" },
      {
        type: "embark",
        spaceId: "embark-a", // N=3
        placements: [{ area: "tile15", count: 2 }]
      }
    );
    expect(r.status).toBe("accepted");
    if (r.status !== "accepted") return;
    expect(r.nextState.areas["tile15"]!.units.ship).toBe(3); // 1 + 2, cap 3
    expect(r.nextState.players.red.reserve.ship).toBe(before - 2);
  });

  it("can place into an empty water adjacent to a supplied port", () => {
    const s = game();
    // Red supplies its HQ harbor tile9 (ports include tile14/tile15). tile14 empty.
    const r = resolveCommand(
      s,
      { seat: "red" },
      {
        type: "embark",
        spaceId: "embark-b", // N=2
        placements: [{ area: "tile14", count: 2 }]
      }
    );
    expect(r.status).toBe("accepted");
    if (r.status !== "accepted") return;
    expect(r.nextState.areas["tile14"]!.owner).toBe("red");
    expect(r.nextState.areas["tile14"]!.units.ship).toBe(2);
  });
});
```

> Confirm in `riversMap.ts` that the red HQ's `ports` include `tile14`/`tile15` (they do: `tile9` ports `["tile14","tile15"]`). Adjust ids if the map differs.

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @sengoku-jidai/engine test -- actions`
Expected: FAIL — dispatch throws `No resolver for action embark`.

- [ ] **Step 3: Add `applyEmbark` to `actions.ts`**

```ts
/** Embark: place ships from reserve into supplied/port-adjacent water (validated upstream). */
export function applyEmbark(
  state: GameState,
  seat: SeatId,
  placements: { area: string; count: number }[]
): GameEvent[] {
  const events: GameEvent[] = [];
  for (const p of placements) {
    const rt = state.areas[p.area]!;
    rt.units.ship += p.count;
    rt.owner = seat;
    state.players[seat].reserve.ship -= p.count;
    events.push({ type: "unitsPlaced", seat, area: p.area, unit: "ship", count: p.count });
  }
  return events;
}
```

- [ ] **Step 4: Wire dispatch in `resolve.ts`**

Update the import and the switch:

```ts
import { applyPass, applyReinforce, applyPlan, applyEmbark } from "./actions.js";
```

```ts
    case "embark":
      return applyEmbark(state, seat, command.placements);
```

- [ ] **Step 5: Run to verify it passes**

Run: `pnpm --filter @sengoku-jidai/engine test -- actions`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/engine/src/actions.ts packages/engine/src/resolve.ts packages/engine/test/actions.test.ts
git commit -m "feat(engine): implement Embark action"
```

---

## Task 10: Advance action (move-in, Hidden Base, conflict)

**Files:**

- Modify: `packages/engine/src/actions.ts`
- Modify: `packages/engine/src/resolve.ts` (dispatch)
- Modify: `packages/engine/test/actions.test.ts`

- [ ] **Step 1: Add the failing test** — append to `test/actions.test.ts`:

```ts
describe("advance", () => {
  it("moves troops into an empty adjacent land and takes control", () => {
    const s = game();
    const hq = hqOf("red"); // tile9, 3 troops; tile1 empty land adjacent.
    const r = resolveCommand(
      s,
      { seat: "red" },
      {
        type: "advance",
        spaceId: "advance-tile1",
        moves: [{ from: hq, count: 2 }]
      }
    );
    expect(r.status).toBe("accepted");
    if (r.status !== "accepted") return;
    expect(r.nextState.areas["tile1"]!.owner).toBe("red");
    expect(r.nextState.areas["tile1"]!.units.troop).toBe(2);
    expect(r.nextState.areas[hq]!.units.troop).toBe(1); // 3 - 2
  });

  it("resolves conflict when advancing into an enemy land", () => {
    const s = game();
    const hq = hqOf("red");
    // Put 1 black defender in tile1; use all-1 dice so defence roll = 1.
    s.rules = { ...s.rules, diceFaces: [1, 1, 1, 1, 1, 1] };
    s.areas["tile1"] = { owner: "black", units: { troop: 1, ship: 0, siege: 0 } };
    // Move 3 attackers from HQ (needs >=4 there): top up HQ.
    s.areas[hq] = { owner: "red", units: { troop: 5, ship: 0, siege: 0 } };
    const r = resolveCommand(
      s,
      { seat: "red" },
      {
        type: "advance",
        spaceId: "advance-tile1",
        moves: [{ from: hq, count: 3 }]
      }
    );
    expect(r.status).toBe("accepted");
    if (r.status !== "accepted") return;
    // defence removes 1 -> 2 attackers vs 1 defender; attrition -> 1 vs 0. red wins.
    expect(r.nextState.areas["tile1"]!.owner).toBe("red");
    expect(r.nextState.areas["tile1"]!.units.troop).toBe(1);
  });

  it("Hidden Base adds +1 troop at move-in before conflict", () => {
    const s = game();
    const hq = hqOf("red");
    s.rules = { ...s.rules, diceFaces: [1, 1, 1, 1, 1, 1] };
    s.bonuses = { [hq]: "hiddenBase" }; // red supplies its HQ -> bonus active
    s.areas["tile1"] = { owner: "black", units: { troop: 2, ship: 0, siege: 0 } };
    s.areas[hq] = { owner: "red", units: { troop: 5, ship: 0, siege: 0 } };
    const r = resolveCommand(
      s,
      { seat: "red" },
      {
        type: "advance",
        spaceId: "advance-tile1",
        moves: [{ from: hq, count: 2 }] // 2 + 1 hidden base = 3 attackers
      }
    );
    expect(r.status).toBe("accepted");
    if (r.status !== "accepted") return;
    // 3 attackers, defence -1 -> 2 vs 2 defenders -> tie -> area emptied.
    expect(r.nextState.areas["tile1"]!.owner).toBeNull();
  });
});
```

> Verify against `riversMap.ts` that `tile1` is land adjacent to the red HQ `tile9` (it is: `tile1.adjacent` includes `tile9`, and `tile9.adjacent` includes `tile1`). The Hidden-Base tie case assumes the all-1 dice; recompute expected owners if you change the dice faces.

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @sengoku-jidai/engine test -- actions`
Expected: FAIL — dispatch throws `No resolver for action advance`.

- [ ] **Step 3: Add `applyAdvance` to `actions.ts`**

Add imports:

```ts
import { resolveConflict } from "./conflict.js";
```

```ts
/**
 * Advance: move troops into the linked land (validated upstream), apply Hidden Base,
 * then resolve conflict if the target is enemy-controlled. Returns the events.
 */
export function applyAdvance(
  state: GameState,
  seat: SeatId,
  spaceId: string,
  moves: { from: string; count: number }[]
): GameEvent[] {
  const map = getMap(state.mapId);
  const target = actionSpaceMap(map)[spaceId]!.areaId!;
  const events: GameEvent[] = [];

  let attackers = 0;
  for (const m of moves) {
    state.areas[m.from]!.units.troop -= m.count;
    attackers += m.count;
    events.push({
      type: "unitsMoved",
      seat,
      from: m.from,
      to: target,
      unit: "troop",
      count: m.count
    });
  }

  // Hidden Base: +1 troop from reserve at move-in (before conflict), if supplied
  // and reserve has a troop. Cannot apply on the advance that first gains the bonus
  // area, which is impossible here because you cannot advance into an area you supply.
  if (suppliesBonus(state, seat, "hiddenBase") && state.players[seat].reserve.troop > 0) {
    state.players[seat].reserve.troop -= 1;
    attackers += 1;
    events.push({
      type: "bonusApplied",
      seat,
      bonus: "hiddenBase",
      area: bonusArea(state, "hiddenBase")!
    });
  }

  events.push(...resolveMoveIn(state, seat, target, "troop", attackers));
  return events;
}

/**
 * Shared move-in + conflict for Advance/Sail. `attackers` units of `unit` arrive in
 * `target`; resolve against any enemy garrison and set ownership.
 */
export function resolveMoveIn(
  state: GameState,
  seat: SeatId,
  target: string,
  unit: "troop" | "ship",
  attackers: number
): GameEvent[] {
  const rt = state.areas[target]!;
  const enemy: SeatId = seat === "red" ? "black" : "red";
  const events: GameEvent[] = [];

  if (rt.owner == null || rt.owner === seat) {
    rt.units[unit] += attackers;
    const previousOwner = rt.owner;
    rt.owner = seat;
    if (previousOwner !== seat)
      events.push({ type: "areaCaptured", seat, area: target, previousOwner });
    return events;
  }

  // Enemy-controlled: conflict.
  const defenders = rt.units[unit];
  const outcome = resolveConflict(state.rngState, state.rules.diceFaces, attackers, defenders);
  state.rngState = outcome.rngState;
  events.push({
    type: "diceRolled",
    seat,
    purpose: "defence",
    rolls: [outcome.defenceRoll],
    total: outcome.defenceRoll
  });

  // Return losses to reserves.
  state.players[seat].reserve[unit] += outcome.attackerLosses;
  state.players[enemy].reserve[unit] += outcome.defenderLosses;
  if (outcome.attackerLosses > 0)
    events.push({ type: "unitsRemoved", seat, area: target, unit, count: outcome.attackerLosses });
  if (outcome.defenderLosses > 0)
    events.push({
      type: "unitsRemoved",
      seat: enemy,
      area: target,
      unit,
      count: outcome.defenderLosses
    });

  if (outcome.attackersLeft > 0) {
    rt.owner = seat;
    rt.units[unit] = outcome.attackersLeft;
    events.push({ type: "areaCaptured", seat, area: target, previousOwner: enemy });
  } else if (outcome.defendersLeft > 0) {
    rt.units[unit] = outcome.defendersLeft; // defender holds
  } else {
    rt.owner = null; // mutual annihilation
    rt.units[unit] = 0;
  }
  return events;
}
```

- [ ] **Step 4: Wire dispatch in `resolve.ts`**

```ts
import { applyPass, applyReinforce, applyPlan, applyEmbark, applyAdvance } from "./actions.js";
```

```ts
    case "advance":
      return applyAdvance(state, seat, command.spaceId, command.moves);
```

- [ ] **Step 5: Run to verify it passes**

Run: `pnpm --filter @sengoku-jidai/engine test -- actions`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/engine/src/actions.ts packages/engine/src/resolve.ts packages/engine/test/actions.test.ts
git commit -m "feat(engine): implement Advance action with Hidden Base and conflict"
```

---

## Task 11: Sail action (Shipyard, conflict via shared move-in)

**Files:**

- Modify: `packages/engine/src/actions.ts`
- Modify: `packages/engine/src/resolve.ts` (dispatch)
- Modify: `packages/engine/test/actions.test.ts`

- [ ] **Step 1: Add the failing test** — append to `test/actions.test.ts`:

```ts
describe("sail", () => {
  it("moves ships through a supplied water chain into an empty water", () => {
    const s = game();
    // red supplies HQ tile9 (land) -> tile15 (sea, 2 ships). Sail into tile11 (adj tile15).
    s.areas["tile15"] = { owner: "red", units: { troop: 0, ship: 2, siege: 0 } };
    const r = resolveCommand(
      s,
      { seat: "red" },
      {
        type: "sail",
        spaceId: "sail-tile11",
        moves: [{ from: "tile15", count: 1 }]
      }
    );
    expect(r.status).toBe("accepted");
    if (r.status !== "accepted") return;
    expect(r.nextState.areas["tile11"]!.owner).toBe("red");
    expect(r.nextState.areas["tile11"]!.units.ship).toBe(1);
    expect(r.nextState.areas["tile15"]!.units.ship).toBe(1);
  });

  it("Shipyard adds +1 ship at move-in before conflict", () => {
    const s = game();
    s.rules = { ...s.rules, diceFaces: [1, 1, 1, 1, 1, 1] };
    s.areas["tile15"] = { owner: "red", units: { troop: 0, ship: 3, siege: 0 } };
    s.bonuses = { tile15: "shipyard" }; // red supplies tile15
    s.areas["tile11"] = { owner: "black", units: { troop: 0, ship: 2, siege: 0 } };
    const r = resolveCommand(
      s,
      { seat: "red" },
      {
        type: "sail",
        spaceId: "sail-tile11",
        moves: [{ from: "tile15", count: 2 }] // 2 + 1 shipyard = 3 attackers
      }
    );
    expect(r.status).toBe("accepted");
    if (r.status !== "accepted") return;
    // 3 attackers, defence -1 -> 2 vs 2 -> tie -> emptied.
    expect(r.nextState.areas["tile11"]!.owner).toBeNull();
  });
});
```

> Confirm via `riversMap.ts`: `tile15` is sea, adjacent to both `tile9` (red HQ land, for supply) and `tile11` (sea, sail target). Map shows `tile15.adjacent = ["tile11","tile9","tile16"]` — good.

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @sengoku-jidai/engine test -- actions`
Expected: FAIL — dispatch throws `No resolver for action sail`.

- [ ] **Step 3: Add `applySail` to `actions.ts`**

```ts
/** Sail: move ships into the linked water (validated upstream), apply Shipyard, resolve conflict. */
export function applySail(
  state: GameState,
  seat: SeatId,
  spaceId: string,
  moves: { from: string; count: number }[]
): GameEvent[] {
  const map = getMap(state.mapId);
  const target = actionSpaceMap(map)[spaceId]!.areaId!;
  const events: GameEvent[] = [];

  let attackers = 0;
  for (const m of moves) {
    state.areas[m.from]!.units.ship -= m.count;
    attackers += m.count;
    events.push({
      type: "unitsMoved",
      seat,
      from: m.from,
      to: target,
      unit: "ship",
      count: m.count
    });
  }

  if (suppliesBonus(state, seat, "shipyard") && state.players[seat].reserve.ship > 0) {
    state.players[seat].reserve.ship -= 1;
    attackers += 1;
    events.push({
      type: "bonusApplied",
      seat,
      bonus: "shipyard",
      area: bonusArea(state, "shipyard")!
    });
  }

  events.push(...resolveMoveIn(state, seat, target, "ship", attackers));
  return events;
}
```

- [ ] **Step 4: Wire dispatch in `resolve.ts`**

```ts
import {
  applyPass,
  applyReinforce,
  applyPlan,
  applyEmbark,
  applyAdvance,
  applySail
} from "./actions.js";
```

```ts
    case "sail":
      return applySail(state, seat, command.spaceId, command.moves);
```

- [ ] **Step 5: Run to verify it passes**

Run: `pnpm --filter @sengoku-jidai/engine test -- actions`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/engine/src/actions.ts packages/engine/src/resolve.ts packages/engine/test/actions.test.ts
git commit -m "feat(engine): implement Sail action with Shipyard and shared conflict"
```

---

## Task 12: Bombard + Shell actions

**Files:**

- Modify: `packages/engine/src/actions.ts`
- Modify: `packages/engine/src/resolve.ts` (dispatch)
- Modify: `packages/engine/test/actions.test.ts`

- [ ] **Step 1: Add the failing test** — append to `test/actions.test.ts`:

```ts
describe("bombard", () => {
  it("rolls one die per ship and removes that many enemy land units", () => {
    const s = game();
    s.rules = { ...s.rules, diceFaces: [1, 1, 1, 1, 1, 1] }; // each die = 1
    // red supplies sea tile15 with 2 ships; bombard adjacent land target.
    s.areas["tile15"] = { owner: "red", units: { troop: 0, ship: 2, siege: 0 } };
    // tile16 is land adjacent to tile15, held by black with 3 troops.
    s.areas["tile16"] = { owner: "black", units: { troop: 3, ship: 0, siege: 0 } };
    const r = resolveCommand(
      s,
      { seat: "red" },
      {
        type: "bombard",
        spaceId: "bombard-tile15",
        targetAreaId: "tile16"
      }
    );
    expect(r.status).toBe("accepted");
    if (r.status !== "accepted") return;
    // 2 ships -> 2 dice -> 2 pips -> remove 2 troops; 1 remains.
    expect(r.nextState.areas["tile16"]!.units.troop).toBe(1);
    expect(r.nextState.players.black.reserve.troop).toBeGreaterThan(0);
  });

  it("Pirate Haven adds +1 die", () => {
    const s = game();
    s.rules = { ...s.rules, diceFaces: [1, 1, 1, 1, 1, 1] };
    s.areas["tile15"] = { owner: "red", units: { troop: 0, ship: 1, siege: 0 } };
    s.bonuses = { tile15: "pirateHaven" }; // red supplies tile15
    s.areas["tile16"] = { owner: "black", units: { troop: 3, ship: 0, siege: 0 } };
    const r = resolveCommand(
      s,
      { seat: "red" },
      {
        type: "bombard",
        spaceId: "bombard-tile15",
        targetAreaId: "tile16"
      }
    );
    expect(r.status).toBe("accepted");
    if (r.status !== "accepted") return;
    // 1 ship + 1 pirate haven = 2 dice -> remove 2; 1 remains.
    expect(r.nextState.areas["tile16"]!.units.troop).toBe(1);
  });
});

describe("shell", () => {
  it("rolls two dice and removes that many enemy ships from the target water", () => {
    const s = game();
    s.rules = { ...s.rules, diceFaces: [1, 1, 1, 1, 1, 1] };
    // red supplies a shellable land; pick one adjacent to a sea with enemy ships.
    // tile16 (land) is adjacent to sea tile17; but shell needs a shellable land.
    // Use tile21 (shellable) adjacent to ... confirm a sea neighbour in the map.
    // Fallback general shape: red supplies the shellable land, black ships in target sea.
    s.areas["tile16"] = { owner: "red", units: { troop: 1, ship: 0, siege: 0 } };
    s.areas["tile21"] = { owner: "red", units: { troop: 1, ship: 0, siege: 0 } };
    // NOTE: tile21 has no sea neighbour in the base map; the implementer must pick a
    // shellable land that IS adjacent to a sea and adjust target accordingly. See note.
  });
});
```

Write the Shell test as a real end-to-end scenario now that the adjacency gap is fixed (commit `71d0339`). Shellable land `tile10` borders seas `{tile7, tile11, tile15}`. Example: red supplies `tile10` (a troop there, connected to red HQ), black has ships in adjacent sea `tile11`, force `diceFaces` to all-1s, then `shell` on `tile10` targeting `tile11` and assert two ships are removed (2 dice × 1) → black reserve, and `shellTargets(map, "tile10")` includes `tile11`:

```ts
describe("shell", () => {
  it("rolls two dice and removes that many enemy ships from the target water", () => {
    const s = game();
    s.rules = { ...s.rules, diceFaces: [1, 1, 1, 1, 1, 1] }; // each die = 1 -> total 2
    // red supplies shellable land tile10 (HQ tile9 is adjacent to tile10).
    s.areas["tile10"] = { owner: "red", units: { troop: 1, ship: 0, siege: 0 } };
    // black ships sit in adjacent sea tile11.
    s.areas["tile11"] = { owner: "black", units: { troop: 0, ship: 3, siege: 0 } };
    const r = resolveCommand(
      s,
      { seat: "red" },
      {
        type: "shell",
        spaceId: "shell-tile10",
        targetAreaId: "tile11"
      }
    );
    expect(r.status).toBe("accepted");
    if (r.status !== "accepted") return;
    // two dice of 1 -> remove 2 ships; 1 remains.
    expect(r.nextState.areas["tile11"]!.units.ship).toBe(1);
    expect(r.nextState.players.black.reserve.ship).toBeGreaterThan(0);
  });
});
```

> Confirm `tile9` (red HQ) is adjacent to `tile10` so red supplies it (it is: `tile9.adjacent` includes `tile10`). The shell action space id is `shell-tile10`.

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @sengoku-jidai/engine test -- actions`
Expected: FAIL — dispatch throws `No resolver for action bombard`.

- [ ] **Step 3: Add `applyBombard` and `applyShell` to `actions.ts`**

Add import:

```ts
import { rollDie } from "./rng.js";
```

```ts
/** Bombard: roll one die per ship in the linked water (+1 for Pirate Haven); remove that
 *  many enemy land units from the target (-> owner reserve). */
export function applyBombard(
  state: GameState,
  seat: SeatId,
  spaceId: string,
  targetAreaId: string
): GameEvent[] {
  const map = getMap(state.mapId);
  const water = actionSpaceMap(map)[spaceId]!.areaId!;
  const events: GameEvent[] = [];
  let dice = state.areas[water]!.units.ship;
  if (suppliesBonus(state, seat, "pirateHaven")) {
    dice += 1;
    events.push({
      type: "bonusApplied",
      seat,
      bonus: "pirateHaven",
      area: bonusArea(state, "pirateHaven")!
    });
  }
  const rolls: number[] = [];
  let total = 0;
  for (let i = 0; i < dice; i++) {
    const roll = rollDie(state.rngState, state.rules.diceFaces);
    state.rngState = roll.state;
    rolls.push(roll.value);
    total += roll.value;
  }
  events.push({ type: "diceRolled", seat, purpose: "bombard", rolls, total });
  events.push(...removeUnits(state, targetAreaId, "troop", total));
  return events;
}

/** Shell: roll two dice; remove that many enemy ships from the target water (-> owner reserve). */
export function applyShell(
  state: GameState,
  seat: SeatId,
  _spaceId: string,
  targetAreaId: string
): GameEvent[] {
  const events: GameEvent[] = [];
  const rolls: number[] = [];
  let total = 0;
  for (let i = 0; i < 2; i++) {
    const roll = rollDie(state.rngState, state.rules.diceFaces);
    state.rngState = roll.state;
    rolls.push(roll.value);
    total += roll.value;
  }
  events.push({ type: "diceRolled", seat, purpose: "shell", rolls, total });
  events.push(...removeUnits(state, targetAreaId, "ship", total));
  return events;
}

/** Remove up to `count` units of `unit` from `area`, returning them to the owner's reserve. */
function removeUnits(
  state: GameState,
  area: string,
  unit: "troop" | "ship",
  count: number
): GameEvent[] {
  const rt = state.areas[area]!;
  if (rt.owner == null || count <= 0) return [];
  const removed = Math.min(count, rt.units[unit]);
  rt.units[unit] -= removed;
  state.players[rt.owner].reserve[unit] += removed;
  const events: GameEvent[] = [
    { type: "unitsRemoved", seat: rt.owner, area, unit, count: removed }
  ];
  if (rt.units.troop === 0 && rt.units.ship === 0) rt.owner = null;
  return events;
}
```

- [ ] **Step 4: Wire dispatch in `resolve.ts`**

```ts
import {
  applyPass,
  applyReinforce,
  applyPlan,
  applyEmbark,
  applyAdvance,
  applySail,
  applyBombard,
  applyShell
} from "./actions.js";
```

```ts
    case "bombard":
      return applyBombard(state, seat, command.spaceId, command.targetAreaId);
    case "shell":
      return applyShell(state, seat, command.spaceId, command.targetAreaId);
```

- [ ] **Step 5: Run to verify it passes**

Run: `pnpm --filter @sengoku-jidai/engine test -- actions`
Expected: PASS (with the shell test written to whatever the resolved map data supports — see the Step 1 note).

- [ ] **Step 6: Commit**

```bash
git add packages/engine/src/actions.ts packages/engine/src/resolve.ts packages/engine/test/actions.test.ts
git commit -m "feat(engine): implement Bombard and Shell actions"
```

---

## Task 13: Determinism & replay equivalence

**Files:**

- Create: `packages/engine/test/replay.test.ts`

- [ ] **Step 1: Write the failing test** — create `test/replay.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { createInitialState } from "../src/game.js";
import { resolveCommand } from "../src/resolve.js";
import type { Command, CommandActor } from "../src/commands.js";

type Step = { actor: CommandActor; command: Command };

function play(seed: string, steps: Step[]) {
  let s = createInitialState({ gameId: "g", seed });
  for (const step of steps) {
    const r = resolveCommand(s, step.actor, step.command);
    if (r.status !== "accepted") throw new Error(`rejected: ${r.reason.code}`);
    s = r.nextState;
  }
  return s;
}

describe("replay equivalence", () => {
  it("seed + ordered commands replays identically", () => {
    const initiative = createInitialState({ gameId: "g", seed: "seed-A" }).initiative;
    const opp = initiative === "red" ? "black" : "red";
    const steps: Step[] = [
      { actor: { seat: initiative }, command: { type: "pass" } },
      { actor: { seat: opp }, command: { type: "plan", spaceId: "plan-b" } },
      { actor: { seat: initiative }, command: { type: "pass" } },
      { actor: { seat: opp }, command: { type: "pass" } }
    ];
    const a = play("seed-A", steps);
    const b = play("seed-A", steps);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it("survives a JSON round-trip mid-game (no class instances / functions in state)", () => {
    const s = createInitialState({ gameId: "g", seed: "seed-A" });
    const r = resolveCommand(s, { seat: s.initiative }, { type: "pass" });
    if (r.status !== "accepted") throw new Error("rejected");
    const roundTripped = JSON.parse(JSON.stringify(r.nextState));
    expect(roundTripped).toEqual(r.nextState);
  });
});
```

- [ ] **Step 2: Run to verify it passes** (the engine already supports this; the test pins it)

Run: `pnpm --filter @sengoku-jidai/engine test -- replay`
Expected: PASS. If it fails, the failure points to nondeterminism (e.g. iteration order, an unseeded `Math.random`) — fix the source, not the test.

- [ ] **Step 3: Commit**

```bash
git add packages/engine/test/replay.test.ts
git commit -m "test(engine): pin determinism and replay equivalence"
```

---

## Task 14: Golden test — rulebook "Example Turn"

**Files:**

- Create: `packages/engine/test/goldenExampleTurn.test.ts`

The spec (§12) calls for golden tests encoding the rulebook's worked examples. The exact figures live in the rulebook PDF (see the `rulebook-and-svg-tooling` memory for its location and poppler tooling).

- [ ] **Step 1: Extract the worked "Example Turn" from the rulebook**

Use poppler (`pdftotext`) on the rulebook PDF to read the Advance / Sail / Bombard / Shell / Conflict / Example Turn boxes. Record the starting positions, the dice results shown, and the resulting board for each example.

- [ ] **Step 2: Write the golden test** encoding ONE worked example end-to-end (start with Conflict or Advance, whichever the rulebook states with full numbers). Construct the exact starting `GameState`, force `diceFaces` and `rngState` so the dice match the rulebook's shown rolls (or assert on the arithmetic outcome independent of the specific roll where the rulebook abstracts it), run the command(s), and assert the resulting `areas`/reserves match the rulebook figure.

```ts
import { describe, expect, it } from "vitest";
// Construct a precise scenario mirroring the rulebook's worked example.
// Fill in concrete tiles, unit counts, dice, and expected end-state from the PDF.
describe("golden: rulebook Example Turn", () => {
  it.todo("reproduces the rulebook's worked Advance/Conflict outcome");
});
```

> This is the one task whose concrete numbers cannot be inlined here without the PDF in hand. Replace the `it.todo` with a real assertion-bearing test using the extracted figures. If the rulebook's example relies on operation cards (out of scope), pick a card-free example (Advance, Sail, Bombard, Shell, or the basic Conflict box).

- [ ] **Step 3: Run to verify it passes**

Run: `pnpm --filter @sengoku-jidai/engine test -- goldenExampleTurn`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add packages/engine/test/goldenExampleTurn.test.ts
git commit -m "test(engine): add golden test for a rulebook worked example"
```

---

## Task 15: Full-suite gate + roadmap update

**Files:**

- Modify: `/Users/martin/.claude/projects/-Users-martin-repos-sengoku-jidai/memory/engine-rebuild-roadmap.md`

- [ ] **Step 1: Run the whole engine suite + typecheck + lint**

Run:

```bash
pnpm --filter @sengoku-jidai/engine test
pnpm --filter @sengoku-jidai/engine exec tsc -p tsconfig.json --noEmit
pnpm -w lint
pnpm -w format
```

Expected: all green. The `server`/`shared`/`web` packages are untouched and must still build (additive scope), so also run `pnpm -w build` to confirm no cascade.

- [ ] **Step 2: Verify the placeholder is still intact and `index.ts` unchanged**

Run: `git diff --stat origin/main -- packages/server packages/shared packages/web packages/engine/src/index.ts`
Expected: NO changes to those paths (additive scope honored).

- [ ] **Step 3: Update the roadmap memory** — mark Plan 3 done (commands/pipeline/turn-flow landed additively as new engine files; placeholder deletion + server/shared/web migration deferred to Plan 4) and note the new files. Update the MEMORY.md hook line if the summary changed.

- [ ] **Step 4: Commit**

```bash
git add docs/superpowers/plans/2026-06-18-commands-and-pipeline.md
git commit -m "docs(engine): add Plan 3 (commands + pipeline) implementation plan"
```

(Plus the memory update, committed separately if memory lives outside the repo.)

---

## Notes & Open Items (carry into execution)

1. **Shell adjacency data gap (Task 12) — RESOLVED 2026-06-20.** The user hand-authored the full general adjacency (land+sea+mixed), now committed to `maps/riversMap.ts` (commit `71d0339`) and verified symmetric, with new map invariants asserting every shellable land borders sea and every sea borders land. Shellable lands' sea neighbours: **tile10 → {tile7, tile11, tile15}**, **tile12 → {tile7, tile11, tile17}**, **tile19 → {tile14, tile15, tile22}**, **tile21 → {tile17, tile18, tile22}**. Task 12's Shell test must now use a real scenario (e.g. red supplies shellable `tile10`, black ships in adjacent sea `tile11`, shell `tile10` → target `tile11`). The `ports`-overlay fallback was rejected.
2. **`index.ts` / placeholder retirement is Plan 4.** When Plan 4 deletes `types.ts`/`resolveCommand.ts`/`validateCommand.ts`/`view.ts`/`serialization.ts`/`setup.ts`/`maps/placeholderMap.ts`, it should rename/promote the new v2 symbols onto the public surface and migrate `server` (persistence reads `state.revision` — already added here), `shared` (Zod `commandSchema`), and `web` (`App.tsx`).
3. **`randomDraw` audit events (spec §5)** remain deferred; this plan emits `diceRolled` events instead. Revisit if exact RNG audit/replay tooling is needed.
4. **`pendingDecision` / `choosePendingDecision`** are wired as inert seams (always null in v1) for the future cards phase.

```

```
