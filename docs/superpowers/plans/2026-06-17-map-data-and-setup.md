# Map Data + Setup Implementation Plan (Plan 2)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the real schemaVersion-2 `GameState` model and a deterministic, seeded `createInitialState` that builds the opening Rivers position (HQ garrisons, reserves, commanders, randomized bonus placement, initiative), plus the map's bonus-slot data.

**Architecture:** Purely additive on top of the merged Plan 1 foundations. A new `state.ts` holds the dynamic v2 model; a new `game.ts` holds `createInitialState`, which reads the static `riversMap` + `riversRuleset` and the seedable PRNG (`rng.ts`). The placeholder engine (`types.ts` `GameState`, `setup.ts` `createGame`, `resolveCommand.ts`) is left untouched — it is replaced in Plan 3/4 to avoid breaking the server/shared/web packages now. New symbols are exported explicitly from `index.ts`, dodging the placeholder name clashes exactly as Plan 1 does for `RulesConfig`.

**Tech Stack:** TypeScript (NodeNext ESM, `.js` import specifiers), Vitest. Tests live in `packages/engine/test/` mirroring `src/` (never alongside source).

**Scope notes / deferred to later plans:**

- Action-space layout (Plan 3): `actionSpaces` is initialized to `{}`. Plan 3 defines the spaces and the deploy pipeline.
- `randomDraw` audit events (§5): deferred to Plan 3 with the event/pipeline system.
- Bonus-slot areas are an **interim placeholder** (`tile6`, `tile16`, `tile20`) until the board author confirms real slots; trivially editable in one place.
- Starting deployment is interim (3 troops per HQ) per the user; real rulebook setup lands later. Exact positions are not important at this stage.

---

## File Structure

- `packages/engine/src/maps/riversMap.ts` (modify) — add `bonusSlots: string[]` to `MapDefinition` + `riversMap`; drop the INTERIM adjacency comments (topology is authoritative and already test-covered).
- `packages/engine/src/state.ts` (create) — v2 dynamic model: `UnitType`, `UnitCounts`, `Phase`, `EndReason`, `OperationCard`, `AreaRuntime`, `PlayerState`, `GameState`; helpers `zeroUnits`, constants `RIVERS_UNIT_POOL`, `HQ_STARTING_TROOPS`.
- `packages/engine/src/game.ts` (create) — `GameSetupOptions`, `createInitialState`.
- `packages/engine/src/index.ts` (modify) — explicitly export the new, non-clashing symbols.
- `packages/engine/test/maps/riversMap.test.ts` (modify) — bonus-slot invariant.
- `packages/engine/test/state.test.ts` (create) — helper/constant tests.
- `packages/engine/test/game.test.ts` (create) — `createInitialState` behavior + determinism.
- `packages/engine/test/index.test.ts` (create) — index export smoke test.

All test commands run from `packages/engine` (`cd packages/engine` first).

---

### Task 1: Map bonus slots

**Files:**

- Modify: `packages/engine/src/maps/riversMap.ts`
- Test: `packages/engine/test/maps/riversMap.test.ts`

- [ ] **Step 1: Add the failing invariant test**

Append this block inside the `describe("rivers map topology", ...)` body in `packages/engine/test/maps/riversMap.test.ts` (before the closing `});`):

```ts
it("defines exactly 3 distinct bonus-slot areas that exist on the map", () => {
  const slots = riversMap.bonusSlots;
  expect(slots).toHaveLength(3);
  expect(new Set(slots).size).toBe(3);
  for (const id of slots) {
    expect(riversMap.areas[id], `bonus slot ${id}`).toBeDefined();
  }
});
```

- [ ] **Step 2: Run the test, verify it fails**

Run: `npx vitest run test/maps/riversMap.test.ts`
Expected: FAIL — TypeScript/runtime error that `bonusSlots` does not exist on `riversMap`.

- [ ] **Step 3: Add `bonusSlots` to the map definition**

In `packages/engine/src/maps/riversMap.ts`, add the field to the `MapDefinition` interface (after `areas`):

```ts
export interface MapDefinition {
  id: string;
  /** Human-facing name for map selection UI. */
  name: string;
  areas: Record<string, MapArea>;
  /**
   * The fixed areas that receive a randomly-assigned bonus at setup (3 of the 5
   * bonus types are drawn per game). INTERIM placeholder areas until confirmed by
   * the board author; change here only.
   */
  bonusSlots: string[];
}
```

Then add the data to the `riversMap` export object:

```ts
export const riversMap: MapDefinition = {
  id: riversMapId,
  name: "Rivers",
  areas: Object.fromEntries(areaList.map((area) => [area.id, area])),
  bonusSlots: ["tile6", "tile16", "tile20"]
};
```

- [ ] **Step 4: Drop the INTERIM adjacency notes (topology is authoritative)**

In `packages/engine/src/maps/riversMap.ts`, change the `adjacent` doc on `MapArea` from:

```ts
  /** General adjacency: every area sharing a border (land, sea, or mixed). INTERIM data — Plan 2 re-derives this accurately from cloned_map.svg. */
  adjacent: string[];
```

to:

```ts
  /** General adjacency: every area sharing a border (land, sea, or mixed). Derived from cloned_map.svg; symmetry + no-dangling enforced by riversMap.test.ts. */
  adjacent: string[];
```

And delete the two-line `// NOTE: ... // Plan 2 re-derives ...` comment immediately above `const areaList`.

- [ ] **Step 5: Run the test, verify it passes**

Run: `npx vitest run test/maps/riversMap.test.ts`
Expected: PASS (all topology specs, including the new bonus-slot spec).

- [ ] **Step 6 (optional manual check): eyeball adjacency against a render**

The adjacency is already complete and symmetric (Plan 1). For an extra visual confirmation only (not required to proceed):
Run: `inkscape cloned_map.svg --export-type=png --export-filename=/tmp/rivers.png 2>/dev/null || pdftoppr -png cloned_map.pdf /tmp/rivers`
Open `/tmp/rivers.png` and spot-check a few borders. No code change expected.

- [ ] **Step 7: Commit**

```bash
git add packages/engine/src/maps/riversMap.ts packages/engine/test/maps/riversMap.test.ts
git commit -m "feat(engine): add map bonus-slot data; finalize Rivers adjacency"
```

---

### Task 2: Dynamic state model (`state.ts`)

**Files:**

- Create: `packages/engine/src/state.ts`
- Test: `packages/engine/test/state.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/engine/test/state.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { HQ_STARTING_TROOPS, RIVERS_UNIT_POOL, zeroUnits } from "../src/state.js";

describe("unit state helpers", () => {
  it("zeroUnits returns a fresh all-zero counts object", () => {
    const a = zeroUnits();
    expect(a).toEqual({ troop: 0, ship: 0, siege: 0 });
    a.troop = 5;
    expect(zeroUnits().troop).toBe(0); // each call is independent
  });

  it("defines the Rivers unit pools and starting garrison size", () => {
    expect(RIVERS_UNIT_POOL).toEqual({ troop: 25, ship: 10, siege: 0 });
    expect(HQ_STARTING_TROOPS).toBe(3);
  });
});
```

- [ ] **Step 2: Run the test, verify it fails**

Run: `npx vitest run test/state.test.ts`
Expected: FAIL — cannot resolve `../src/state.js`.

- [ ] **Step 3: Create the state model**

Create `packages/engine/src/state.ts`:

```ts
import type { GameMode, GameStatus, SeatId } from "./types.js";
import type { BonusType, RulesConfig } from "./rules.js";

/** Unit kinds. `siege` exists for the Fortress map and is always 0 in Rivers. */
export type UnitType = "troop" | "ship" | "siege";
export type UnitCounts = Record<UnitType, number>;

/** Round phases. */
export type Phase = "deploy" | "recall";

/** Why the game ended (null while active). */
export type EndReason = "hqEliminated" | "victoryPoints";

/** Operation card — no effects ship until the cards phase. */
export type OperationCard = never;

/** Full per-player unit pools in Rivers (siege unused). */
export const RIVERS_UNIT_POOL: UnitCounts = { troop: 25, ship: 10, siege: 0 };

/** Interim starting garrison: troops placed in each player's HQ at setup. */
export const HQ_STARTING_TROOPS = 3;

/** A fresh, independent all-zero unit-counts object. */
export function zeroUnits(): UnitCounts {
  return { troop: 0, ship: 0, siege: 0 };
}

/**
 * Dynamic per-area state. Control IS `owner` (a player controls an area when
 * `owner === seat`); supply is always derived, never stored. At rest an area is
 * single-owner; transient both-sides states exist only inside command resolution.
 */
export interface AreaRuntime {
  owner: SeatId | null;
  units: UnitCounts;
}

export interface PlayerState {
  seat: SeatId;
  reserve: UnitCounts;
  /** `total` commanders; `standby` are passed-out and unavailable until next round. */
  commanders: { total: number; standby: number };
  hand: OperationCard[];
  /** Whether this seat has passed this round. */
  passed: boolean;
}

/**
 * The full dynamic game state (schemaVersion 2). Static facts (adjacency, HQs,
 * stars, bonus slots) live in the MapDefinition; only what changes lives here.
 */
export interface GameState {
  schemaVersion: 2;
  gameId: string;
  mapId: string;
  rules: RulesConfig;
  mode: GameMode;
  status: GameStatus; // "setup" | "active" | "complete" | "abandoned"

  round: number;
  phase: Phase;
  initiative: SeatId; // deploys first this round; VP tiebreak
  activeSeat: SeatId; // whose turn within deploy

  rngState: string;

  players: Record<SeatId, PlayerState>;
  areas: Record<string, AreaRuntime>;
  actionSpaces: Record<string, SeatId | null>; // populated in Plan 3
  bonuses: Record<string, BonusType>; // bonus-slot areaId -> assigned bonus (3 entries)

  winner: SeatId | null;
  endReason: EndReason | null;
}
```

- [ ] **Step 4: Run the test, verify it passes**

Run: `npx vitest run test/state.test.ts`
Expected: PASS.

- [ ] **Step 5: Typecheck**

Run: `npx tsc -p tsconfig.json --noEmit`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add packages/engine/src/state.ts packages/engine/test/state.test.ts
git commit -m "feat(engine): add schemaVersion-2 dynamic state model"
```

---

### Task 3: `createInitialState` (`game.ts`)

**Files:**

- Create: `packages/engine/src/game.ts`
- Test: `packages/engine/test/game.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/engine/test/game.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { createInitialState } from "../src/game.js";
import { riversMap } from "../src/maps/riversMap.js";
import { riversRuleset } from "../src/rules.js";
import { createRngState } from "../src/rng.js";

const opts = { gameId: "g1", seed: "seed-A" };

describe("createInitialState", () => {
  it("is deterministic for a given seed", () => {
    expect(createInitialState(opts)).toEqual(createInitialState(opts));
  });

  it("opens at round 1, deploy phase, active, activeSeat = initiative", () => {
    const s = createInitialState(opts);
    expect(s.schemaVersion).toBe(2);
    expect(s.gameId).toBe("g1");
    expect(s.mapId).toBe("rivers");
    expect(s.mode).toBe("hotseat");
    expect(s.round).toBe(1);
    expect(s.phase).toBe("deploy");
    expect(s.status).toBe("active");
    expect(["red", "black"]).toContain(s.initiative);
    expect(s.activeSeat).toBe(s.initiative);
    expect(s.actionSpaces).toEqual({});
    expect(s.winner).toBeNull();
    expect(s.endReason).toBeNull();
  });

  it("places 3 troops in each HQ and leaves every other area empty", () => {
    const s = createInitialState(opts);
    expect(s.areas.tile9).toEqual({ owner: "red", units: { troop: 3, ship: 0, siege: 0 } });
    expect(s.areas.tile13).toEqual({ owner: "black", units: { troop: 3, ship: 0, siege: 0 } });
    for (const [id, a] of Object.entries(s.areas)) {
      if (id === "tile9" || id === "tile13") continue;
      expect(a, id).toEqual({ owner: null, units: { troop: 0, ship: 0, siege: 0 } });
    }
    expect(Object.keys(s.areas).sort()).toEqual(Object.keys(riversMap.areas).sort());
  });

  it("gives each player the pool minus deployed troops, plus 5 commanders", () => {
    const s = createInitialState(opts);
    for (const seat of ["red", "black"] as const) {
      expect(s.players[seat].seat).toBe(seat);
      expect(s.players[seat].reserve).toEqual({ troop: 22, ship: 10, siege: 0 });
      expect(s.players[seat].commanders).toEqual({ total: 5, standby: 0 });
      expect(s.players[seat].hand).toEqual([]);
      expect(s.players[seat].passed).toBe(false);
    }
  });

  it("assigns 3 distinct bonuses to the map's bonus slots", () => {
    const s = createInitialState(opts);
    expect(Object.keys(s.bonuses).sort()).toEqual([...riversMap.bonusSlots].sort());
    const vals = Object.values(s.bonuses);
    expect(new Set(vals).size).toBe(3);
    for (const b of vals) expect(riversRuleset.bonusSet).toContain(b);
  });

  it("advances the rng state away from the raw seed", () => {
    const s = createInitialState(opts);
    expect(s.rngState).not.toBe(createRngState(opts.seed));
  });
});
```

- [ ] **Step 2: Run the test, verify it fails**

Run: `npx vitest run test/game.test.ts`
Expected: FAIL — cannot resolve `../src/game.js`.

- [ ] **Step 3: Implement `createInitialState`**

Create `packages/engine/src/game.ts`:

```ts
import { getMap } from "./maps/registry.js";
import { riversMapId } from "./maps/riversMap.js";
import { createRngState, nextFloat, shuffle } from "./rng.js";
import { riversRuleset } from "./rules.js";
import type { BonusType, RulesConfig } from "./rules.js";
import type { GameMode, SeatId } from "./types.js";
import {
  HQ_STARTING_TROOPS,
  RIVERS_UNIT_POOL,
  zeroUnits,
  type AreaRuntime,
  type GameState,
  type PlayerState
} from "./state.js";

export interface GameSetupOptions {
  gameId: string;
  /** Seed string; identical seeds replay identically. */
  seed: string;
  mode?: GameMode;
  mapId?: string;
  rules?: RulesConfig;
}

/**
 * Build the opening Rivers position deterministically from a seed.
 *
 * RNG draw order (must stay stable for replay): (1) shuffle bonuses and assign
 * 3 to the map's slots, (2) pick the initiative holder.
 */
export function createInitialState(options: GameSetupOptions): GameState {
  const mapId = options.mapId ?? riversMapId;
  const rules = options.rules ?? riversRuleset;
  const map = getMap(mapId);

  if (map.bonusSlots.length !== 3) {
    throw new Error(`Map ${mapId} must define exactly 3 bonus slots`);
  }
  if (rules.bonusSet.length < 3) {
    throw new Error(`Ruleset ${rules.rulesetId} must offer at least 3 bonuses`);
  }

  let rngState = createRngState(options.seed);

  // (1) shuffle the bonus pool, take 3, assign to the fixed slots.
  const shuffled = shuffle(rngState, rules.bonusSet);
  rngState = shuffled.state;
  const bonuses: Record<string, BonusType> = {};
  map.bonusSlots.forEach((areaId, i) => {
    bonuses[areaId] = shuffled.value[i]!;
  });

  // (2) pick the initiative holder.
  const draw = nextFloat(rngState);
  rngState = draw.state;
  const initiative: SeatId = draw.value < 0.5 ? "red" : "black";

  // Build areas, garrisoning each HQ.
  const areas: Record<string, AreaRuntime> = {};
  for (const area of Object.values(map.areas)) {
    areas[area.id] =
      area.hq !== null
        ? { owner: area.hq, units: { ...zeroUnits(), troop: HQ_STARTING_TROOPS } }
        : { owner: null, units: zeroUnits() };
  }

  const makePlayer = (seat: SeatId): PlayerState => ({
    seat,
    reserve: { ...RIVERS_UNIT_POOL, troop: RIVERS_UNIT_POOL.troop - HQ_STARTING_TROOPS },
    commanders: { total: rules.commandersPerPlayer, standby: 0 },
    hand: [],
    passed: false
  });

  return {
    schemaVersion: 2,
    gameId: options.gameId,
    mapId,
    rules,
    mode: options.mode ?? "hotseat",
    status: "active",
    round: 1,
    phase: "deploy",
    initiative,
    activeSeat: initiative,
    rngState,
    players: { red: makePlayer("red"), black: makePlayer("black") },
    areas,
    actionSpaces: {},
    bonuses,
    winner: null,
    endReason: null
  };
}
```

- [ ] **Step 4: Run the test, verify it passes**

Run: `npx vitest run test/game.test.ts`
Expected: PASS (all 6 specs).

- [ ] **Step 5: Typecheck**

Run: `npx tsc -p tsconfig.json --noEmit`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add packages/engine/src/game.ts packages/engine/test/game.test.ts
git commit -m "feat(engine): seeded createInitialState builds opening Rivers position"
```

---

### Task 4: Wire exports

**Files:**

- Modify: `packages/engine/src/index.ts`
- Test: `packages/engine/test/index.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/engine/test/index.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import * as engine from "../src/index.js";

describe("engine package exports", () => {
  it("exposes the v2 setup surface", () => {
    expect(typeof engine.createInitialState).toBe("function");
    expect(typeof engine.zeroUnits).toBe("function");
    expect(engine.RIVERS_UNIT_POOL).toEqual({ troop: 25, ship: 10, siege: 0 });
    expect(engine.HQ_STARTING_TROOPS).toBe(3);
  });

  it("createInitialState produces a schemaVersion-2 state via the index", () => {
    const s = engine.createInitialState({ gameId: "g", seed: "s" });
    expect(s.schemaVersion).toBe(2);
  });
});
```

- [ ] **Step 2: Run the test, verify it fails**

Run: `npx vitest run test/index.test.ts`
Expected: FAIL — `engine.createInitialState` is undefined.

- [ ] **Step 3: Add explicit exports**

Append to `packages/engine/src/index.ts`:

```ts
// Plan 2 — schemaVersion-2 model and setup. Exported explicitly to avoid clashing
// with the placeholder `GameState`/`PlayerState`/`createGame` still exported above.
// GameState/PlayerState from state.js are intentionally NOT re-exported yet; Plan 3
// deletes the placeholder and promotes the v2 model to the public surface.
export { createInitialState } from "./game.js";
export type { GameSetupOptions } from "./game.js";
export { zeroUnits, RIVERS_UNIT_POOL, HQ_STARTING_TROOPS } from "./state.js";
export type {
  UnitType,
  UnitCounts,
  Phase,
  EndReason,
  AreaRuntime,
  OperationCard
} from "./state.js";
```

- [ ] **Step 4: Run the test, verify it passes**

Run: `npx vitest run test/index.test.ts`
Expected: PASS.

- [ ] **Step 5: Run the full engine suite + typecheck**

Run: `npx vitest run && npx tsc -p tsconfig.json --noEmit`
Expected: all tests PASS, no type errors.

- [ ] **Step 6: Commit**

```bash
git add packages/engine/src/index.ts packages/engine/test/index.test.ts
git commit -m "feat(engine): export v2 state model and createInitialState"
```

---

## Self-Review

- **Spec coverage:** §4 state model → Task 2. §5 setup & seeded randomness (bonus shuffle then initiative) → Task 3. Bonus-slot data dependency (§13.3) → Task 1 (interim). Starting positions (§13.4) → Task 3 (interim, 3 troops/HQ per user). Adjacency (§13.1) → already authoritative + test-covered; Task 1 finalizes comments. Deferred and noted: action-space layout (§13.2), support N (§13.5), `randomDraw` audit events (§5), placeholder deletion + downstream migration (Plan 3/4).
- **Placeholder scan:** no TBD/“handle edge cases”/“similar to” — all steps carry complete code.
- **Type consistency:** `createInitialState`/`GameSetupOptions`/`GameState`(v2)/`PlayerState`/`AreaRuntime`/`UnitCounts`/`zeroUnits`/`RIVERS_UNIT_POOL`/`HQ_STARTING_TROOPS`/`BonusType` used consistently across tasks and match `state.ts`/`game.ts`.
