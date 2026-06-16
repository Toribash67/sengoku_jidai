# Engine Foundations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the deterministic, board-data-independent foundations of the Rivers engine — a seedable PRNG, the Rivers `RulesConfig`, the corrected map shape, and the pure derivation layer (control, supply, victory points, game-end) — all behind tests.

**Architecture:** Pure additive/decoupled modules in `packages/engine/src`. The derivation layer operates on the static `MapDefinition` plus a tiny `SupplyBoard` accessor interface, so it does not depend on the (future) full `GameState`. This keeps the placeholder engine compiling at every commit while the real model is built up underneath it.

**Tech Stack:** TypeScript (ESM, NodeNext), Vitest. Run commands with `corepack pnpm`.

This is **Plan 1 of 4** for the engine model (see `docs/superpowers/specs/2026-06-16-engine-model-design.md`). It deliberately does **not** touch the placeholder `GameState`, `resolveCommand`, `createGame`, or server — those come in Plans 2–4.

---

## File Structure

- `packages/engine/src/rng.ts` (create) — deterministic PRNG: seed → state string, float/die/shuffle draws. One responsibility: reproducible randomness.
- `packages/engine/src/rng.test.ts` (create) — PRNG determinism/distribution tests.
- `packages/engine/src/rules.ts` (create) — `ActionType`, `BonusType`, the extended `RulesConfig`, and the `riversRuleset` constant.
- `packages/engine/src/rules.test.ts` (create) — ruleset shape tests.
- `packages/engine/src/maps/riversMap.ts` (modify) — replace `landAdjacent`/`seaAdjacent` with a single `adjacent`, rename `piers` → `ports`.
- `packages/engine/src/test/riversMap.test.ts` (modify) — update invariants for the new shape.
- `packages/engine/src/supply.ts` (create) — control + supply derivation over a map + `SupplyBoard`.
- `packages/engine/src/supply.test.ts` (create) — supply tests on a synthetic map.
- `packages/engine/src/scoring.ts` (create) — victory points + game-end evaluation.
- `packages/engine/src/scoring.test.ts` (create) — scoring/end tests.
- `packages/engine/src/index.ts` (modify) — export the new modules.

The `SeatId` type already exists in `packages/engine/src/types.ts` (`"red" | "black"`) and is re-exported from `index.ts`. Reuse it; do not redefine it.

---

## Task 1: Deterministic PRNG (`rng.ts`)

**Files:**
- Create: `packages/engine/src/rng.ts`
- Test: `packages/engine/src/rng.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// packages/engine/src/rng.test.ts
import { describe, expect, it } from "vitest";
import { createRngState, nextFloat, rollDie, shuffle, DEFAULT_DICE_FACES } from "./rng.js";

describe("rng", () => {
  it("derives a stable state string from a seed", () => {
    expect(createRngState("seed")).toBe(createRngState("seed"));
    expect(createRngState("a")).not.toBe(createRngState("b"));
  });

  it("produces a deterministic, advancing float stream", () => {
    const s0 = createRngState("seed");
    const a = nextFloat(s0);
    const b = nextFloat(a.state);
    expect(a.value).toBeGreaterThanOrEqual(0);
    expect(a.value).toBeLessThan(1);
    expect(a.state).not.toBe(s0); // state advanced
    // same start state reproduces the same value
    expect(nextFloat(s0).value).toBe(a.value);
    expect(b.value).not.toBe(a.value);
  });

  it("rolls dice from the configured faces", () => {
    let state = createRngState("dice");
    const counts = new Map<number, number>();
    for (let i = 0; i < 6000; i++) {
      const r = rollDie(state, DEFAULT_DICE_FACES);
      state = r.state;
      counts.set(r.value, (counts.get(r.value) ?? 0) + 1);
    }
    // only the configured face values ever appear
    for (const v of counts.keys()) expect(DEFAULT_DICE_FACES).toContain(v);
    // 0,1,2 all appear given the [0,1,1,1,1,2] distribution
    expect(counts.get(0)).toBeGreaterThan(0);
    expect(counts.get(1)).toBeGreaterThan(0);
    expect(counts.get(2)).toBeGreaterThan(0);
  });

  it("shuffles deterministically without losing elements", () => {
    const s0 = createRngState("shuffle");
    const input = [1, 2, 3, 4, 5];
    const r1 = shuffle(s0, input);
    const r2 = shuffle(s0, input);
    expect(r1.value).toEqual(r2.value); // same seed -> same order
    expect([...r1.value].sort((x, y) => x - y)).toEqual(input); // permutation
    expect(input).toEqual([1, 2, 3, 4, 5]); // input not mutated
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `corepack pnpm --filter @sengoku-jidai/engine exec vitest run src/rng.test.ts`
Expected: FAIL — cannot find module `./rng.js`.

- [ ] **Step 3: Write minimal implementation**

```ts
// packages/engine/src/rng.ts

/** Custom dice faces for General Orders: 0,1,1,1,1,2 pips. */
export const DEFAULT_DICE_FACES = [0, 1, 1, 1, 1, 2] as const;

/** FNV-1a hash of a seed string to a 32-bit unsigned int. */
function hashSeed(seed: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** Create the initial serializable RNG state for a seed. */
export function createRngState(seed: string): string {
  return String(hashSeed(seed));
}

/**
 * mulberry32 step. Returns the next float in [0,1) and the advanced state.
 * State is the 32-bit counter, serialized as a decimal string for JSON safety.
 */
export function nextFloat(state: string): { value: number; state: string } {
  let a = (Number(state) + 0x6d2b79f5) | 0;
  const advanced = a >>> 0;
  let t = Math.imul(a ^ (a >>> 15), 1 | a);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  const value = ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  return { value, state: String(advanced) };
}

/** Roll a die from the given faces. */
export function rollDie(
  state: string,
  faces: readonly number[]
): { value: number; state: string } {
  const r = nextFloat(state);
  const index = Math.floor(r.value * faces.length);
  return { value: faces[index]!, state: r.state };
}

/** Fisher-Yates shuffle. Does not mutate the input array. */
export function shuffle<T>(state: string, items: readonly T[]): { value: T[]; state: string } {
  const out = [...items];
  let s = state;
  for (let i = out.length - 1; i > 0; i--) {
    const r = nextFloat(s);
    s = r.state;
    const j = Math.floor(r.value * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return { value: out, state: s };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `corepack pnpm --filter @sengoku-jidai/engine exec vitest run src/rng.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/engine/src/rng.ts packages/engine/src/rng.test.ts
git commit -m "feat(engine): deterministic seedable PRNG"
```

---

## Task 2: Rivers ruleset (`rules.ts`)

**Files:**
- Create: `packages/engine/src/rules.ts`
- Test: `packages/engine/src/rules.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// packages/engine/src/rules.test.ts
import { describe, expect, it } from "vitest";
import { riversRuleset } from "./rules.js";
import { DEFAULT_DICE_FACES } from "./rng.js";

describe("rivers ruleset", () => {
  it("describes the Rivers variant knobs", () => {
    expect(riversRuleset.commandersPerPlayer).toBe(5);
    expect(riversRuleset.maxRounds).toBe(4);
    expect(riversRuleset.diceFaces).toEqual([...DEFAULT_DICE_FACES]);
    expect(riversRuleset.fortifications).toBe(false);
    expect(riversRuleset.cards).toBe(false);
  });

  it("enables the seven Rivers actions and omits Siege", () => {
    expect(riversRuleset.enabledActions).toEqual(
      expect.arrayContaining(["advance", "sail", "bombard", "shell", "reinforce", "embark", "plan"])
    );
    expect(riversRuleset.enabledActions).not.toContain("siege");
    expect(riversRuleset.enabledActions).toHaveLength(7);
  });

  it("uses the five Rivers bonuses and omits Armoury", () => {
    expect(riversRuleset.bonusSet).toEqual(
      expect.arrayContaining(["barracks", "warRoom", "pirateHaven", "shipyard", "hiddenBase"])
    );
    expect(riversRuleset.bonusSet).not.toContain("armoury");
    expect(riversRuleset.bonusSet).toHaveLength(5);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `corepack pnpm --filter @sengoku-jidai/engine exec vitest run src/rules.test.ts`
Expected: FAIL — cannot find module `./rules.js`.

- [ ] **Step 3: Write minimal implementation**

```ts
// packages/engine/src/rules.ts
import { DEFAULT_DICE_FACES } from "./rng.js";

export type ActionType =
  | "advance"
  | "sail"
  | "bombard"
  | "shell"
  | "siege"
  | "reinforce"
  | "embark"
  | "plan";

export type BonusType =
  | "barracks"
  | "warRoom"
  | "pirateHaven"
  | "shipyard"
  | "hiddenBase"
  | "armoury";

/** Variance carrier: everything that differs between maps/modes lives here. */
export interface RulesConfig {
  rulesetId: string;
  rulesetVersion: string;
  rulesetHash: string;
  commandersPerPlayer: number;
  maxRounds: number;
  diceFaces: number[];
  enabledActions: ActionType[];
  bonusSet: BonusType[];
  fortifications: boolean;
  cards: boolean;
}

export const riversRuleset: RulesConfig = {
  rulesetId: "rivers",
  rulesetVersion: "0.1.0",
  rulesetHash: "rivers-0.1.0",
  commandersPerPlayer: 5,
  maxRounds: 4,
  diceFaces: [...DEFAULT_DICE_FACES],
  enabledActions: ["advance", "sail", "bombard", "shell", "reinforce", "embark", "plan"],
  bonusSet: ["barracks", "warRoom", "pirateHaven", "shipyard", "hiddenBase"],
  fortifications: false,
  cards: false
};
```

Note: a separate `RulesConfig` already exists in `types.ts` (id/version/hash only) used by the placeholder. Leave that one untouched for now; this is the new, richer config consumed by the new modules. Plans 2–4 migrate the placeholder onto this one and delete the old.

- [ ] **Step 4: Run test to verify it passes**

Run: `corepack pnpm --filter @sengoku-jidai/engine exec vitest run src/rules.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/engine/src/rules.ts packages/engine/src/rules.test.ts
git commit -m "feat(engine): rivers ruleset config and action/bonus types"
```

---

## Task 3: Correct the map shape (`adjacent` + `ports`)

Replace the kind-split adjacency with one general adjacency graph, and rename `piers` → `ports`. The new `adjacent` is, **for this plan only**, the mechanical union of the existing `landAdjacent`, `seaAdjacent`, and pier links — an interim value. Plan 2 re-derives accurate general adjacency from the SVG and confirms it by eye.

**Files:**
- Modify: `packages/engine/src/maps/riversMap.ts`
- Modify: `packages/engine/src/test/riversMap.test.ts`

- [ ] **Step 1: Update the `MapArea` interface**

In `riversMap.ts`, replace the `landAdjacent`/`seaAdjacent`/`piers` fields of `MapArea` with:

```ts
  /** General adjacency: every area sharing a border (land, sea, or mixed). */
  adjacent: string[];
  /** For harbours: water areas reachable via a pier (Embark placement + navy building). */
  ports: string[];
```

Keep `id`, `kind`, `hq`, `valueStars`, `harbor`, `shellable`.

- [ ] **Step 2: Update the `land`/`sea` builders and area list**

Replace the `land()` and `sea()` helpers and the `areaList` so each area carries `adjacent` and (for harbours) `ports`. Use these exact values (interim union of the previous land/sea/pier data, made symmetric):

```ts
function area(
  id: string,
  kind: AreaKind,
  adjacent: string[],
  opts: { hq?: SeatId; valueStars?: 0 | 1 | 2; harbor?: boolean; shellable?: boolean; ports?: string[] } = {}
): MapArea {
  return {
    id,
    kind,
    hq: opts.hq ?? null,
    valueStars: opts.valueStars ?? 0,
    harbor: opts.harbor ?? false,
    shellable: opts.shellable ?? false,
    adjacent,
    ports: opts.ports ?? []
  };
}

const areaList: MapArea[] = [
  area("tile1", "land", ["tile6", "tile9", "tile10"]),
  area("tile2", "land", ["tile6"], { valueStars: 1 }),
  area("tile3", "sea", ["tile7", "tile6", "tile8"], { valueStars: 1 }),
  area("tile4", "land", ["tile8"], { valueStars: 1 }),
  area("tile5", "land", ["tile8", "tile12", "tile13"]),
  area("tile6", "land", ["tile1", "tile2", "tile10", "tile3", "tile7"], { valueStars: 1, harbor: true, ports: ["tile3", "tile7"] }),
  area("tile7", "sea", ["tile3", "tile11", "tile6", "tile8"], { valueStars: 1 }),
  area("tile8", "land", ["tile4", "tile5", "tile12", "tile3", "tile7"], { valueStars: 1, harbor: true, ports: ["tile3", "tile7"] }),
  area("tile9", "land", ["tile1", "tile10", "tile14", "tile15"], { hq: "red", harbor: true, ports: ["tile14", "tile15"] }),
  area("tile10", "land", ["tile1", "tile6", "tile9"], { shellable: true }),
  area("tile11", "sea", ["tile7", "tile15", "tile17", "tile16"], { valueStars: 1 }),
  area("tile12", "land", ["tile5", "tile8", "tile13"], { shellable: true }),
  area("tile13", "land", ["tile5", "tile12", "tile17", "tile18"], { hq: "black", harbor: true, ports: ["tile17", "tile18"] }),
  area("tile14", "sea", ["tile22", "tile9"]),
  area("tile15", "sea", ["tile11", "tile9", "tile16"], { valueStars: 1 }),
  area("tile16", "land", ["tile19", "tile20", "tile21", "tile11", "tile15", "tile17"], { valueStars: 2, harbor: true, ports: ["tile11", "tile15", "tile17"] }),
  area("tile17", "sea", ["tile11", "tile13", "tile16"], { valueStars: 1 }),
  area("tile18", "sea", ["tile22", "tile13"]),
  area("tile19", "land", ["tile16", "tile20"], { shellable: true }),
  area("tile20", "land", ["tile16", "tile19", "tile21"], { valueStars: 2 }),
  area("tile21", "land", ["tile16", "tile20"], { shellable: true }),
  area("tile22", "sea", ["tile14", "tile18"])
];
```

Add a comment above `areaList`:

```ts
// NOTE: `adjacent` here is an INTERIM union of the old land/sea/pier data.
// Plan 2 re-derives accurate general (shared-border) adjacency from cloned_map.svg.
```

Update the doc comment block's bullet describing connectivity to say `adjacent` is general shared-border adjacency and `ports` are the pier overlay.

- [ ] **Step 3: Update the invariants test**

In `test/riversMap.test.ts`, replace the "keeps land and sea adjacency within their own kind", "has symmetric land and sea adjacency", and pier tests with:

```ts
  it("references no dangling area ids", () => {
    for (const a of areas) {
      for (const id of [...a.adjacent, ...a.ports]) {
        expect(riversMap.areas[id], `${a.id} -> ${id}`).toBeDefined();
      }
    }
  });

  it("has symmetric general adjacency", () => {
    for (const a of areas) {
      for (const id of a.adjacent) {
        expect(riversMap.areas[id]?.adjacent, `${a.id} <-> ${id}`).toContain(a.id);
      }
    }
  });

  it("only places ports on harbour land areas, pointing at sea areas", () => {
    for (const a of areas) {
      if (a.ports.length > 0) {
        expect(a.kind).toBe("land");
        expect(a.harbor).toBe(true);
        for (const id of a.ports) expect(riversMap.areas[id]?.kind).toBe("sea");
      }
      if (a.harbor) expect(a.ports.length).toBeGreaterThan(0);
    }
  });
```

Keep the existing "22 areas / 14 land / 8 sea", "one red + one black HQ", and "value stars" tests unchanged.

- [ ] **Step 4: Run tests + typecheck**

Run: `corepack pnpm --filter @sengoku-jidai/engine exec vitest run src/test/riversMap.test.ts`
Expected: PASS.
Run: `corepack pnpm --filter @sengoku-jidai/engine run typecheck`
Expected: PASS (no references to removed `landAdjacent`/`seaAdjacent`/`piers` remain).

- [ ] **Step 5: Commit**

```bash
git add packages/engine/src/maps/riversMap.ts packages/engine/src/test/riversMap.test.ts
git commit -m "refactor(engine): single general adjacency + ports on rivers map (interim data)"
```

---

## Task 4: Control & supply derivation (`supply.ts`)

**Files:**
- Create: `packages/engine/src/supply.ts`
- Test: `packages/engine/src/supply.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// packages/engine/src/supply.test.ts
import { describe, expect, it } from "vitest";
import type { MapDefinition } from "./maps/riversMap.js";
import { controls, suppliedAreas, inSupply } from "./supply.js";

// Synthetic line map: hqR - a - b ... gap ... c - hqB
function testMap(): MapDefinition {
  const A = (id: string, adjacent: string[], hq?: "red" | "black", stars: 0 | 1 | 2 = 0) => ({
    id, kind: "land" as const, hq: hq ?? null, valueStars: stars, harbor: false, shellable: false, adjacent, ports: []
  });
  return {
    id: "test",
    name: "Test",
    areas: Object.fromEntries(
      [
        A("hqR", ["a"], "red"),
        A("a", ["hqR", "b"]),
        A("b", ["a", "c"]),
        A("c", ["b", "hqB"]),
        A("hqB", ["c"], "black")
      ].map((x) => [x.id, x])
    )
  };
}

const owners = (m: Record<string, "red" | "black" | null>) => ({ ownerOf: (id: string) => m[id] ?? null });

describe("supply", () => {
  it("control is unit presence", () => {
    const board = owners({ a: "red" });
    expect(controls(board, "red", "a")).toBe(true);
    expect(controls(board, "black", "a")).toBe(false);
    expect(controls(board, "red", "b")).toBe(false);
  });

  it("supplies areas chained to the HQ through controlled areas", () => {
    const board = owners({ hqR: "red", a: "red", b: "red" });
    const s = suppliedAreas(testMap(), board, "red");
    expect([...s].sort()).toEqual(["a", "b", "hqR"]);
    expect(inSupply(testMap(), board, "red", "b")).toBe(true);
  });

  it("does not supply a controlled area cut off from the HQ", () => {
    // red controls hqR, a, and c — but b (between a and c) is not red-controlled
    const board = owners({ hqR: "red", a: "red", c: "red" });
    const s = suppliedAreas(testMap(), board, "red");
    expect([...s].sort()).toEqual(["a", "hqR"]);
    expect(inSupply(testMap(), board, "red", "c")).toBe(false);
  });

  it("supplies nothing when the HQ is not controlled", () => {
    const board = owners({ a: "red", b: "red" }); // hqR empty/lost
    expect(suppliedAreas(testMap(), board, "red").size).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `corepack pnpm --filter @sengoku-jidai/engine exec vitest run src/supply.test.ts`
Expected: FAIL — cannot find module `./supply.js`.

- [ ] **Step 3: Write minimal implementation**

```ts
// packages/engine/src/supply.ts
import type { MapDefinition } from "./maps/riversMap.js";
import type { SeatId } from "./types.js";

/** Minimal read access the derivation layer needs: who has units in an area. */
export interface SupplyBoard {
  ownerOf(areaId: string): SeatId | null;
}

/** You control an area if you have at least one unit in it. */
export function controls(board: SupplyBoard, seat: SeatId, areaId: string): boolean {
  return board.ownerOf(areaId) === seat;
}

/**
 * Areas in supply for `seat`: the connected component of areas the seat controls
 * that contains the seat's HQ land area, walked over general adjacency.
 * Empty if the seat does not control its HQ.
 */
export function suppliedAreas(map: MapDefinition, board: SupplyBoard, seat: SeatId): Set<string> {
  const hq = Object.values(map.areas).find((a) => a.hq === seat);
  const supplied = new Set<string>();
  if (!hq || board.ownerOf(hq.id) !== seat) {
    return supplied;
  }
  const queue: string[] = [hq.id];
  supplied.add(hq.id);
  while (queue.length > 0) {
    const current = queue.shift()!;
    for (const neighbour of map.areas[current]!.adjacent) {
      if (!supplied.has(neighbour) && board.ownerOf(neighbour) === seat) {
        supplied.add(neighbour);
        queue.push(neighbour);
      }
    }
  }
  return supplied;
}

export function inSupply(
  map: MapDefinition,
  board: SupplyBoard,
  seat: SeatId,
  areaId: string
): boolean {
  return suppliedAreas(map, board, seat).has(areaId);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `corepack pnpm --filter @sengoku-jidai/engine exec vitest run src/supply.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/engine/src/supply.ts packages/engine/src/supply.test.ts
git commit -m "feat(engine): control and supply derivation"
```

---

## Task 5: Victory points & game-end evaluation (`scoring.ts`)

**Files:**
- Create: `packages/engine/src/scoring.ts`
- Test: `packages/engine/src/scoring.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// packages/engine/src/scoring.test.ts
import { describe, expect, it } from "vitest";
import type { MapDefinition } from "./maps/riversMap.js";
import type { SupplyBoard } from "./supply.js";
import { victoryPoints, hqEliminated, evaluateGameEnd } from "./scoring.js";

function testMap(): MapDefinition {
  const A = (id: string, adjacent: string[], hq?: "red" | "black", stars: 0 | 1 | 2 = 0) => ({
    id, kind: "land" as const, hq: hq ?? null, valueStars: stars, harbor: false, shellable: false, adjacent, ports: []
  });
  return {
    id: "test",
    name: "Test",
    areas: Object.fromEntries(
      [
        A("hqR", ["a"], "red"),
        A("a", ["hqR", "b"], undefined, 2),
        A("b", ["a", "hqB"], undefined, 1),
        A("hqB", ["b"], "black")
      ].map((x) => [x.id, x])
    )
  };
}
const owners = (m: Record<string, "red" | "black" | null>): SupplyBoard => ({ ownerOf: (id) => m[id] ?? null });

describe("scoring", () => {
  it("sums value stars over supplied areas only", () => {
    const board = owners({ hqR: "red", a: "red" }); // b not red -> a(2) counts, b(1) does not
    expect(victoryPoints(testMap(), board, "red")).toBe(2);
  });

  it("detects an eliminated HQ", () => {
    expect(hqEliminated(testMap(), owners({ hqR: "red" }), "red")).toBe(false);
    expect(hqEliminated(testMap(), owners({ hqR: "black" }), "red")).toBe(true); // red has no units in its HQ
    expect(hqEliminated(testMap(), owners({}), "red")).toBe(true); // empty HQ
  });

  it("ends immediately when a HQ is eliminated", () => {
    const board = owners({ hqR: "black", a: "red", hqB: "black" });
    const result = evaluateGameEnd(testMap(), board, { round: 2, maxRounds: 4, initiative: "red" });
    expect(result).toEqual({ complete: true, winner: "black", endReason: "hqEliminated" });
  });

  it("does not end mid-game when both HQs stand", () => {
    const board = owners({ hqR: "red", hqB: "black" });
    expect(evaluateGameEnd(testMap(), board, { round: 2, maxRounds: 4, initiative: "red" })).toEqual({
      complete: false,
      winner: null,
      endReason: null
    });
  });

  it("scores by supplied VP after the final round, breaking ties on initiative", () => {
    // After round 4, both HQs stand. red supplies a(2); black supplies b(1) -> red wins.
    const board = owners({ hqR: "red", a: "red", b: "black", hqB: "black" });
    expect(evaluateGameEnd(testMap(), board, { round: 4, maxRounds: 4, initiative: "black" })).toEqual({
      complete: true,
      winner: "red",
      endReason: "victoryPoints"
    });

    // Tie -> initiative holder wins.
    const tied = owners({ hqR: "red", hqB: "black" }); // both supply only their 0-star HQ
    expect(evaluateGameEnd(testMap(), tied, { round: 4, maxRounds: 4, initiative: "black" })).toEqual({
      complete: true,
      winner: "black",
      endReason: "victoryPoints"
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `corepack pnpm --filter @sengoku-jidai/engine exec vitest run src/scoring.test.ts`
Expected: FAIL — cannot find module `./scoring.js`.

- [ ] **Step 3: Write minimal implementation**

```ts
// packages/engine/src/scoring.ts
import type { MapDefinition } from "./maps/riversMap.js";
import type { SeatId } from "./types.js";
import { suppliedAreas, type SupplyBoard } from "./supply.js";

const SEATS: SeatId[] = ["red", "black"];

/** Total value stars on areas the seat supplies. */
export function victoryPoints(map: MapDefinition, board: SupplyBoard, seat: SeatId): number {
  let total = 0;
  for (const id of suppliedAreas(map, board, seat)) {
    total += map.areas[id]!.valueStars;
  }
  return total;
}

/** True if the seat has no units in its own HQ area (or has no HQ). */
export function hqEliminated(map: MapDefinition, board: SupplyBoard, seat: SeatId): boolean {
  const hq = Object.values(map.areas).find((a) => a.hq === seat);
  return !hq || board.ownerOf(hq.id) !== seat;
}

export interface GameEndContext {
  round: number;
  maxRounds: number;
  initiative: SeatId;
}

export interface GameEndResult {
  complete: boolean;
  winner: SeatId | null;
  endReason: "hqEliminated" | "victoryPoints" | null;
}

/**
 * Evaluate end conditions. Immediate loss on an eliminated HQ (checked first);
 * otherwise, once the final round is reached, score supplied VP with ties going
 * to the initiative holder.
 */
export function evaluateGameEnd(
  map: MapDefinition,
  board: SupplyBoard,
  ctx: GameEndContext
): GameEndResult {
  const redOut = hqEliminated(map, board, "red");
  const blackOut = hqEliminated(map, board, "black");
  if (redOut || blackOut) {
    // If both somehow fall at once, the initiative holder survives the tiebreak.
    const winner: SeatId = redOut && blackOut ? ctx.initiative : redOut ? "black" : "red";
    return { complete: true, winner, endReason: "hqEliminated" };
  }

  if (ctx.round < ctx.maxRounds) {
    return { complete: false, winner: null, endReason: null };
  }

  const scores = SEATS.map((seat) => ({ seat, vp: victoryPoints(map, board, seat) }));
  const [a, b] = scores as [{ seat: SeatId; vp: number }, { seat: SeatId; vp: number }];
  const winner = a.vp === b.vp ? ctx.initiative : a.vp > b.vp ? a.seat : b.seat;
  return { complete: true, winner, endReason: "victoryPoints" };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `corepack pnpm --filter @sengoku-jidai/engine exec vitest run src/scoring.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/engine/src/scoring.ts packages/engine/src/scoring.test.ts
git commit -m "feat(engine): victory points and game-end evaluation"
```

---

## Task 6: Export the new modules + full verification

**Files:**
- Modify: `packages/engine/src/index.ts`

- [ ] **Step 1: Add exports**

Append to `packages/engine/src/index.ts`:

```ts
export * from "./rng.js";
export * from "./supply.js";
export * from "./scoring.js";
// rules.js re-exported explicitly: its `RulesConfig` would otherwise clash (TS2308)
// with the placeholder `RulesConfig` still exported from types.js. Plan 2 deletes
// the placeholder and switches this to `export * from "./rules.js"`.
export { riversRuleset } from "./rules.js";
export type { ActionType, BonusType } from "./rules.js";
```

- [ ] **Step 2: Full engine verification**

Run: `corepack pnpm --filter @sengoku-jidai/engine run typecheck`
Expected: PASS.
Run: `corepack pnpm --filter @sengoku-jidai/engine exec vitest run`
Expected: PASS (all suites: rng, rules, riversMap, supply, scoring, plus the existing engine.test.ts).

- [ ] **Step 3: Repo-wide guard (no downstream breakage)**

Run: `corepack pnpm typecheck`
Expected: PASS — the server still builds because the placeholder `GameState`/`RulesConfig` in `types.ts` were left intact.

- [ ] **Step 4: Commit**

```bash
git add packages/engine/src/index.ts
git commit -m "feat(engine): export rng, rules, supply, scoring"
```

---

## Notes for Plan 2 (do not implement here)

- Re-derive accurate general `adjacent` from `cloned_map.svg` (Inkscape `--query-all` geometry) and confirm by eye; replace the interim values from Task 3.
- Extract action-space layout from the `move/sail/bombard/shell-*` overlays.
- Obtain the 3 bonus-slot areas and the starting unit positions (board scan / author).
- Introduce the real `GameState`/`PlayerState`/`AreaRuntime` types and migrate the placeholder + server onto the new `RulesConfig`; implement `createGame` using `rng`, `riversRuleset`, and the map data.
