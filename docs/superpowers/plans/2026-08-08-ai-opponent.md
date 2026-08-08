# AI Opponent Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a Determinized Information-Set MCTS computer opponent (plus baseline bots and a headless match-runner harness) in a new `@sengoku-jidai/ai` package on top of the existing engine.

**Architecture:** A new server-only package consumes the engine's public API (`resolveCommand`, `legalCommandsForState`, scoring). Bots implement one `chooseCommand(state, seat)` interface. Deploy decisions are canonicalized into a small candidate set and searched; combat/pending decisions use fixed heuristics. Evaluation is position-based (the game is territorial, not attritional). All randomness comes from a seeded search RNG kept separate from the engine's game RNG, so search is reproducible.

**Tech Stack:** TypeScript (ESM, `"type": "module"`), vitest, pnpm workspace. Depends on `@sengoku-jidai/engine` via `workspace:*`.

**Scope of this plan:** Stages 1–3 — the AI brain and validation harness (package scaffold, RNG, heuristics, deploy-candidate generation, RandomBot, match runner, evaluation, GreedyBot, determinization, ISMCTS). Stage 4 (server AI-seat wiring: `controllers` flag, DB migration, auto-drive loop) is a **separate follow-up plan**, written after this merges.

**Design spec:** `docs/superpowers/specs/2026-08-08-ai-opponent-design.md`.

## Global Constraints

- Package name: `@sengoku-jidai/ai`. Location: `packages/ai/`. Private, ESM.
- The AI imports the engine ONLY through its root export `@sengoku-jidai/engine` (never deep-imports `dist/` internals or `src/`).
- The AI MUST NOT mutate or read from the engine's game RNG (`state.rngState`) as a source of its own randomness. Its own randomness comes from a seeded `AiRng`.
- `chooseCommand` for the ISMCTS bot MUST be reproducible given `(state, seed, iterations)` — tests drive it by fixed iteration count, never wall-clock.
- Match-runner and bots run entirely headless (no server, no DB).
- Test files live in `packages/ai/test/*.test.ts`, import implementation from `../src/<file>.js` (note the `.js` extension in imports — this repo compiles ESM), and use vitest globals (`describe`/`it`/`expect`).
- Follow the engine's existing style: no default exports, named exports only; JSDoc on exported functions.
- Casualties recycle to reserve and material is ~conserved — do NOT add a material term to the eval.
- Per-tile caps: land ≤ 5, sea ≤ 3.
- Rivers ruleset: `maxRounds = 4`, `commandersPerPlayer = 5`, dice faces `[0,1,1,1,1,2]`, deck = 24 cards (3 copies of 8 kinds).

---

## Engine API reference (verbatim signatures the tasks consume)

From `@sengoku-jidai/engine` (root export). These are exact — use them as written.

```ts
// state / setup
function createInitialState(options: { gameId: string; seed: string; mode?: GameMode; mapId?: string; rules?: RulesConfig }): GameState;
function resolveCommand(state: GameState, actor: { seat: SeatId }, command: Command):
  | { status: "accepted"; nextState: GameState; events: GameEvent[] }
  | { status: "rejected"; reason: { code: string; message: string } };

// legality (move generation)
function legalCommandsForState(state: GameState, seat: SeatId): LegalCommandSummary;

// map + supply + scoring
function getMap(mapId: string): MapDefinition;
function gameBoard(state: GameState): SupplyBoard;                      // { ownerOf(areaId): SeatId | null }
function suppliedAreas(map: MapDefinition, board: SupplyBoard, seat: SeatId): Set<string>;
function victoryPoints(map: MapDefinition, board: SupplyBoard, seat: SeatId): number;
function hqEliminated(map: MapDefinition, board: SupplyBoard, seat: SeatId): boolean;

// data
const RIVERS_DECK: readonly OperationCard[];                            // 24 cards

// key types
type SeatId = "red" | "black";
type OperationCard = "ambush" | "commandeer" | "counterattack" | "ground_assault"
  | "mobilise" | "river_assault" | "ship_strike" | "shore_strike";
type BonusType = "barracks" | "warRoom" | "pirateHaven" | "shipyard" | "hiddenBase";
type EndReason = "hqEliminated" | "victoryPoints";

interface MapArea { id: string; kind: "land" | "sea"; hq: SeatId | null;
  valueStars: 0 | 1 | 2; harbor: boolean; shellable: boolean; fort: boolean;
  adjacent: string[]; ports: string[]; }
interface MapDefinition { id: string; name: string; areas: Record<string, MapArea>;
  bonusSlots: string[]; commandersPerRound?: number; }

interface LegalMove { spaceId: string; type: "advance" | "sail"; targetAreaId: string;
  sources: { areaId: string; max: number }[]; }
interface LegalStrike { spaceId: string; type: "bombard" | "shell"; linkedAreaId: string;
  targets: string[]; dice: number; }
interface LegalPlacement { spaceId: string; type: "reinforce" | "embark";
  unit: "troop" | "ship"; targets: string[]; pool: number; reserve: number; }
interface LegalPlan { spaceId: string; initiative: boolean; }
interface LegalCommandSummary {
  activeSeat: SeatId; canPass: boolean;
  moves: LegalMove[]; strikes: LegalStrike[]; placements: LegalPlacement[]; plans: LegalPlan[];
  canRollCombat: boolean; canResolveCombat: boolean; canRerollCombat: boolean; canAmbush: boolean;
  // (spaces, cardPlays also exist; unused here)
}

// GameState fields used here:
//   status: "setup" | "active" | "complete" | "abandoned"; phase: "deploy" | "recall";
//   activeSeat: SeatId; initiative: SeatId; round: number; rngState: string;
//   winner: SeatId | null; endReason: EndReason | null;
//   players: Record<SeatId, { hand: OperationCard[]; reserve: { troop:number; ship:number; siege:number }; ... }>;
//   areas: Record<string, { owner: SeatId | null; units: { troop:number; ship:number; siege:number } }>;
//   bonuses: Record<string, BonusType>;
//   pendingCombat: { id: string; responsibleSeat: SeatId; phase: "awaiting-roll" | "rolled"; ... } | null;
//   pendingDecision: { id: string; seat: SeatId; choices: { id: string; label: string }[]; kind?: string } | null;
//   deck: OperationCard[];
```

`Command` union (from the engine) — the shapes the bots construct:

```ts
type Command =
  | { type: "advance"; spaceId: string; moves: { from: string; count: number }[]; card?: OperationCard; cardBonus?: number }
  | { type: "sail";    spaceId: string; moves: { from: string; count: number }[]; card?: OperationCard; cardBonus?: number }
  | { type: "bombard"; spaceId: string; targetAreaId: string; card?: OperationCard }
  | { type: "shell";   spaceId: string; targetAreaId: string }
  | { type: "reinforce"; spaceId: string; placements: { area: string; count: number }[]; card?: OperationCard }
  | { type: "embark";    spaceId: string; placements: { area: string; count: number }[]; card?: OperationCard }
  | { type: "plan"; spaceId: string }
  | { type: "pass" }
  | { type: "combatRoll"; pendingId: string; card?: OperationCard }
  | { type: "combatReroll"; pendingId: string; card: OperationCard }
  | { type: "combatResolve"; pendingId: string }
  | { type: "choosePendingDecision"; pendingId: string; choice: { id: string; label: string } };
```

---

## File Structure

```
packages/ai/
  package.json                 # workspace package, deps: engine; devDeps: vitest, typescript, @types/node
  tsconfig.json                # extends ../../tsconfig.base.json, noEmit, includes src+test
  tsconfig.build.json          # extends base, declaration, outDir dist, rootDir src, includes src
  src/
    index.ts                   # public exports: bots, AiPlayer, runMatch, runMatches, types
    types.ts                   # Bot, AiPlayer, seat helpers (other)
    rng.ts                     # AiRng, createAiRng, seedFromString, pick, shuffle
    onclock.ts                 # onTheClock(state)
    heuristics.ts              # resolvePending(state, seat)
    candidates.ts              # deployCandidates(state, seat)
    match.ts                   # runMatch, runMatches
    bots/random.ts             # RandomBot
    eval.ts                    # evaluate(state, seat, weights?), DEFAULT_WEIGHTS
    geometry.ts                # distanceMaps(map) cache, tileBaseValue
    bots/greedy.ts             # GreedyBot + greedyCommand()
    determinize.ts             # determinize(state, seat, rng)
    ismcts.ts                  # chooseCommandIsmcts(...) + IsmctsBot
  test/
    rng.test.ts
    onclock.test.ts
    heuristics.test.ts
    candidates.test.ts
    match.test.ts
    eval.test.ts
    greedy.test.ts
    determinize.test.ts
    ismcts.test.ts
```

---

# Stage 1 — Foundation & harness (PR 1)

Delivers: a package that can run RandomBot vs RandomBot to a completed game, headless and reproducibly.

### Task 1.1: Package scaffold

**Files:**
- Create: `packages/ai/package.json`
- Create: `packages/ai/tsconfig.json`
- Create: `packages/ai/tsconfig.build.json`
- Create: `packages/ai/src/index.ts` (temporary stub)

**Interfaces:**
- Produces: the `@sengoku-jidai/ai` package, buildable and testable.

- [ ] **Step 1: Create `package.json`**

```json
{
  "name": "@sengoku-jidai/ai",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js"
    }
  },
  "scripts": {
    "build": "tsc -p tsconfig.build.json",
    "dev": "tsc -p tsconfig.build.json --watch",
    "test": "vitest run --passWithNoTests",
    "typecheck": "tsc -p tsconfig.json --noEmit"
  },
  "dependencies": {
    "@sengoku-jidai/engine": "workspace:*"
  },
  "devDependencies": {
    "@types/node": "^22.10.5",
    "typescript": "^5.7.2",
    "vitest": "^2.1.8"
  }
}
```

- [ ] **Step 2: Create `tsconfig.json`**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "noEmit": true,
    "types": ["node", "vitest/globals"]
  },
  "include": ["src/**/*.ts", "test/**/*.ts"]
}
```

- [ ] **Step 3: Create `tsconfig.build.json`**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "declaration": true,
    "outDir": "dist",
    "rootDir": "src",
    "types": ["node"]
  },
  "include": ["src/**/*.ts"]
}
```

- [ ] **Step 4: Create stub `src/index.ts`**

```ts
export const AI_PACKAGE = "@sengoku-jidai/ai";
```

- [ ] **Step 5: Install + build the workspace**

Run: `corepack pnpm install`
Then: `corepack pnpm --filter @sengoku-jidai/ai build`
Expected: install links the workspace package; build emits `dist/index.js` with no errors.

- [ ] **Step 6: Commit**

```bash
git add packages/ai/package.json packages/ai/tsconfig.json packages/ai/tsconfig.build.json packages/ai/src/index.ts pnpm-lock.yaml
git commit -m "feat(ai): scaffold @sengoku-jidai/ai package"
```

---

### Task 1.2: Seeded search RNG (`rng.ts`)

**Files:**
- Create: `packages/ai/src/rng.ts`
- Test: `packages/ai/test/rng.test.ts`

**Interfaces:**
- Produces:
  - `interface AiRng { next(): number }` — float in [0,1).
  - `function createAiRng(seed: number): AiRng`
  - `function seedFromString(s: string): number`
  - `function pick<T>(rng: AiRng, items: readonly T[]): T`
  - `function shuffle<T>(rng: AiRng, items: readonly T[]): T[]` (does not mutate input)

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import { createAiRng, seedFromString, pick, shuffle } from "../src/rng.js";

describe("AiRng", () => {
  it("is deterministic for a given seed", () => {
    const a = createAiRng(seedFromString("hello"));
    const b = createAiRng(seedFromString("hello"));
    const seqA = [a.next(), a.next(), a.next()];
    const seqB = [b.next(), b.next(), b.next()];
    expect(seqA).toEqual(seqB);
    expect(seqA[0]).toBeGreaterThanOrEqual(0);
    expect(seqA[0]).toBeLessThan(1);
  });

  it("shuffle is a permutation and does not mutate input", () => {
    const input = [1, 2, 3, 4, 5];
    const out = shuffle(createAiRng(42), input);
    expect(out).toHaveLength(5);
    expect([...out].sort()).toEqual([1, 2, 3, 4, 5]);
    expect(input).toEqual([1, 2, 3, 4, 5]);
  });

  it("pick returns an element of the array", () => {
    const arr = ["a", "b", "c"];
    expect(arr).toContain(pick(createAiRng(7), arr));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `corepack pnpm --filter @sengoku-jidai/ai exec vitest run test/rng.test.ts`
Expected: FAIL (module not found / exports missing).

- [ ] **Step 3: Write `src/rng.ts`**

```ts
/** A seeded PRNG for the AI search — kept entirely separate from the engine's game RNG. */
export interface AiRng {
  /** Next float in [0, 1). */
  next(): number;
}

/** mulberry32, matching the engine's generator family. */
export function createAiRng(seed: number): AiRng {
  let s = seed >>> 0;
  return {
    next(): number {
      s = (s + 0x6d2b79f5) | 0;
      let t = Math.imul(s ^ (s >>> 15), 1 | s);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    }
  };
}

/** FNV-1a hash of a string to a 32-bit seed (same scheme as the engine). */
export function seedFromString(s: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** Uniformly pick one element (caller guarantees non-empty). */
export function pick<T>(rng: AiRng, items: readonly T[]): T {
  return items[Math.floor(rng.next() * items.length)]!;
}

/** Fisher-Yates shuffle into a new array; input is not mutated. */
export function shuffle<T>(rng: AiRng, items: readonly T[]): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng.next() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `corepack pnpm --filter @sengoku-jidai/ai exec vitest run test/rng.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/ai/src/rng.ts packages/ai/test/rng.test.ts
git commit -m "feat(ai): seeded search RNG"
```

---

### Task 1.3: Seat helpers + on-the-clock (`types.ts`, `onclock.ts`)

**Files:**
- Create: `packages/ai/src/types.ts`
- Create: `packages/ai/src/onclock.ts`
- Test: `packages/ai/test/onclock.test.ts`

**Interfaces:**
- Produces:
  - `type SeatId` re-export and `function other(seat: SeatId): SeatId`
  - `interface Bot { chooseCommand(state: GameState, seat: SeatId): Command }`
  - `function onTheClock(state: GameState): SeatId | null` — the seat that must issue the next command, or null if the game is over.

- [ ] **Step 1: Write `src/types.ts`** (no test of its own; exercised throughout)

```ts
import type { GameState, Command, SeatId } from "@sengoku-jidai/engine";

export type { GameState, Command, SeatId };

/** The single method every bot implements. */
export interface Bot {
  chooseCommand(state: GameState, seat: SeatId): Command;
}

/** The opposing seat. */
export function other(seat: SeatId): SeatId {
  return seat === "red" ? "black" : "red";
}
```

- [ ] **Step 2: Write the failing test for `onTheClock`**

```ts
import { describe, expect, it } from "vitest";
import { createInitialState } from "@sengoku-jidai/engine";
import { onTheClock } from "../src/onclock.js";

describe("onTheClock", () => {
  it("returns the active seat at the opening (deploy phase, no pending)", () => {
    const s = createInitialState({ gameId: "g", seed: "seed-A" });
    expect(onTheClock(s)).toBe(s.activeSeat);
  });

  it("returns null once the game is not active", () => {
    const s = createInitialState({ gameId: "g", seed: "seed-A" });
    const done = { ...s, status: "complete" as const };
    expect(onTheClock(done)).toBeNull();
  });

  it("prefers the combat-responsible seat when a combat is pending", () => {
    const s = createInitialState({ gameId: "g", seed: "seed-A" });
    const withCombat = {
      ...s,
      pendingCombat: { id: "c1", responsibleSeat: other(s.activeSeat), phase: "awaiting-roll" }
    } as unknown as typeof s;
    expect(onTheClock(withCombat)).toBe(other(s.activeSeat));
  });
});

import { other } from "../src/types.js";
```

- [ ] **Step 3: Run test to verify it fails**

Run: `corepack pnpm --filter @sengoku-jidai/ai exec vitest run test/onclock.test.ts`
Expected: FAIL (onclock.js missing).

- [ ] **Step 4: Write `src/onclock.ts`**

```ts
import type { GameState, SeatId } from "@sengoku-jidai/engine";

/**
 * The seat that must issue the next command in a stable state:
 * the combat/decision responsible seat when one is pending, otherwise the
 * active deploying seat. Returns null when the game is no longer active.
 * (Recall is processed automatically inside resolveCommand, so a stable state
 * is never waiting on a recall command.)
 */
export function onTheClock(state: GameState): SeatId | null {
  if (state.status !== "active") return null;
  if (state.pendingCombat) return state.pendingCombat.responsibleSeat;
  if (state.pendingDecision) return state.pendingDecision.seat;
  return state.activeSeat;
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `corepack pnpm --filter @sengoku-jidai/ai exec vitest run test/onclock.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/ai/src/types.ts packages/ai/src/onclock.ts packages/ai/test/onclock.test.ts
git commit -m "feat(ai): Bot interface + onTheClock"
```

---

### Task 1.4: Pending-decision heuristics (`heuristics.ts`)

**Files:**
- Create: `packages/ai/src/heuristics.ts`
- Test: `packages/ai/test/heuristics.test.ts`

**Interfaces:**
- Consumes: `GameState`, `Command`, `SeatId`.
- Produces: `function resolvePending(state: GameState, seat: SeatId): Command | null` — the fixed policy for combat rolls / resolves and pending decisions. Returns null when nothing is pending for `seat`. v1 policy: roll without a card, always resolve, never reroll/ambush; for a pending decision pick a "decline" choice if present else the first choice.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import { createInitialState } from "@sengoku-jidai/engine";
import { resolvePending } from "../src/heuristics.js";

function withCombat(phase: "awaiting-roll" | "rolled") {
  const s = createInitialState({ gameId: "g", seed: "seed-A" });
  return {
    ...s,
    pendingCombat: { id: "c1", responsibleSeat: "red", phase }
  } as unknown as typeof s;
}

describe("resolvePending", () => {
  it("rolls (no card) on an awaiting-roll combat for the responsible seat", () => {
    expect(resolvePending(withCombat("awaiting-roll"), "red")).toEqual({
      type: "combatRoll",
      pendingId: "c1"
    });
  });

  it("resolves a rolled combat", () => {
    expect(resolvePending(withCombat("rolled"), "red")).toEqual({
      type: "combatResolve",
      pendingId: "c1"
    });
  });

  it("returns null when nothing is pending for the seat", () => {
    const s = createInitialState({ gameId: "g", seed: "seed-A" });
    expect(resolvePending(s, s.activeSeat)).toBeNull();
  });

  it("declines a pending decision when a decline choice exists", () => {
    const s = createInitialState({ gameId: "g", seed: "seed-A" });
    const withDecision = {
      ...s,
      pendingDecision: {
        id: "d1",
        seat: "red",
        choices: [
          { id: "tileX", label: "Shell tileX" },
          { id: "decline", label: "Decline" }
        ]
      }
    } as unknown as typeof s;
    expect(resolvePending(withDecision, "red")).toEqual({
      type: "choosePendingDecision",
      pendingId: "d1",
      choice: { id: "decline", label: "Decline" }
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `corepack pnpm --filter @sengoku-jidai/ai exec vitest run test/heuristics.test.ts`
Expected: FAIL.

- [ ] **Step 3: Write `src/heuristics.ts`**

```ts
import type { Command, GameState, SeatId } from "@sengoku-jidai/engine";

/**
 * Fixed (non-searched) policy for the combat/decision nodes. v1 keeps this simple:
 * roll without spending a card, always resolve the reviewed roll, never reroll or
 * ambush, and answer a pending decision by declining when possible (else the first
 * choice — e.g. selectCombat, which has no decline). Returns null when nothing is
 * pending for `seat`.
 */
export function resolvePending(state: GameState, seat: SeatId): Command | null {
  const pc = state.pendingCombat;
  if (pc && pc.responsibleSeat === seat) {
    if (pc.phase === "awaiting-roll") return { type: "combatRoll", pendingId: pc.id };
    if (pc.phase === "rolled") return { type: "combatResolve", pendingId: pc.id };
  }
  const pd = state.pendingDecision;
  if (pd && pd.seat === seat) {
    const decline = pd.choices.find((c) => c.id === "decline") ?? pd.choices[0]!;
    return { type: "choosePendingDecision", pendingId: pd.id, choice: decline };
  }
  return null;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `corepack pnpm --filter @sengoku-jidai/ai exec vitest run test/heuristics.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/ai/src/heuristics.ts packages/ai/test/heuristics.test.ts
git commit -m "feat(ai): pending-combat/decision heuristics"
```

---

### Task 1.5: Deploy-candidate generation (`candidates.ts`)

**Files:**
- Create: `packages/ai/src/candidates.ts`
- Test: `packages/ai/test/candidates.test.ts`

**Interfaces:**
- Consumes: `legalCommandsForState`, `getMap`, `GameState`, `Command`, `SeatId`, and the `Legal*` types.
- Produces: `function deployCandidates(state: GameState, seat: SeatId): Command[]` — the canonical set of concrete deploy commands the seat may issue now (empty if it is not this seat's clean deploy turn). Always includes `pass` when legal. This is the branching-factor lever (§6 of the spec): a handful of archetypes per action space, NOT every unit split.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import { createInitialState, resolveCommand } from "@sengoku-jidai/engine";
import { deployCandidates } from "../src/candidates.js";

describe("deployCandidates", () => {
  it("offers a non-empty candidate set including pass at the opening", () => {
    const s = createInitialState({ gameId: "g", seed: "seed-A" });
    const cands = deployCandidates(s, s.activeSeat);
    expect(cands.length).toBeGreaterThan(1);
    expect(cands).toContainEqual({ type: "pass" });
  });

  it("only produces commands the engine accepts", () => {
    const s = createInitialState({ gameId: "g", seed: "seed-A" });
    const seat = s.activeSeat;
    for (const c of deployCandidates(s, seat)) {
      const r = resolveCommand(s, { seat }, c);
      expect(r.status, `rejected ${JSON.stringify(c)}`).toBe("accepted");
    }
  });

  it("returns an empty set when it is not the seat's clean deploy turn", () => {
    const s = createInitialState({ gameId: "g", seed: "seed-A" });
    const notActive = s.activeSeat === "red" ? "black" : "red";
    expect(deployCandidates(s, notActive)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `corepack pnpm --filter @sengoku-jidai/ai exec vitest run test/candidates.test.ts`
Expected: FAIL.

- [ ] **Step 3: Write `src/candidates.ts`**

```ts
import {
  getMap,
  legalCommandsForState,
  type Command,
  type GameState,
  type LegalMove,
  type SeatId
} from "@sengoku-jidai/engine";

/** How many candidate archetypes we keep per move space. Widening this trades speed for
 *  coverage — a deliberate cap, not an accident. */
const _WIDTH_NOTE = "advance/sail: all-in, strongest-single, minimum-viable";

/** Concrete, engine-legal deploy commands for `seat` right now (empty if not its clean
 *  deploy turn). Canonical archetypes only — see the spec §6. */
export function deployCandidates(state: GameState, seat: SeatId): Command[] {
  const legal = legalCommandsForState(state, seat);
  if (legal.activeSeat !== seat || !legal.canPass) {
    // canPass is the shared deployability gate; if it is false the seat cannot deploy now.
    return [];
  }
  const map = getMap(state.mapId);
  const out: Command[] = [];

  // Pass is always available when deployable.
  out.push({ type: "pass" });

  // Plans.
  for (const p of legal.plans) out.push({ type: "plan", spaceId: p.spaceId });

  // Reinforce / Embark: fill the placeable pool into the single highest-value target.
  for (const pl of legal.placements) {
    const placeable = Math.min(pl.pool, pl.reserve);
    if (placeable <= 0 || pl.targets.length === 0) continue;
    const target = [...pl.targets].sort(
      (a, b) => (map.areas[b]?.valueStars ?? 0) - (map.areas[a]?.valueStars ?? 0)
    )[0]!;
    out.push({ type: pl.type, spaceId: pl.spaceId, placements: [{ area: target, count: placeable }] });
  }

  // Bombard / Shell: one candidate per enemy target.
  for (const st of legal.strikes) {
    for (const target of st.targets) {
      if (st.type === "bombard") out.push({ type: "bombard", spaceId: st.spaceId, targetAreaId: target });
      else out.push({ type: "shell", spaceId: st.spaceId, targetAreaId: target });
    }
  }

  // Advance / Sail: archetype allocations over the legal sources.
  for (const mv of legal.moves) out.push(...moveArchetypes(state, seat, mv));

  // De-duplicate by structural signature (archetypes can coincide).
  const seen = new Set<string>();
  return out.filter((c) => {
    const k = JSON.stringify(c);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

function moveArchetypes(state: GameState, seat: SeatId, mv: LegalMove): Command[] {
  const sources = mv.sources.filter((s) => s.max > 0);
  if (sources.length === 0) return [];
  const unit = mv.type === "advance" ? "troop" : "ship";
  const tgt = state.areas[mv.targetAreaId];
  const defenders = tgt && tgt.owner !== seat ? tgt.units[unit] : 0;

  const commands: Command[] = [];
  const build = (moves: { from: string; count: number }[]): Command | null => {
    const nonzero = moves.filter((m) => m.count > 0);
    const total = nonzero.reduce((n, m) => n + m.count, 0);
    if (total < 1) return null;
    return { type: mv.type, spaceId: mv.spaceId, moves: nonzero };
  };

  // All-in: every source contributes its max.
  const allIn = build(sources.map((s) => ({ from: s.areaId, count: s.max })));
  if (allIn) commands.push(allIn);

  // Strongest single source.
  const strongest = [...sources].sort((a, b) => b.max - a.max)[0]!;
  const single = build([{ from: strongest.areaId, count: strongest.max }]);
  if (single) commands.push(single);

  // Minimum viable: attackers = defenders + 1, greedily from the biggest sources.
  let need = defenders + 1;
  const minMoves: { from: string; count: number }[] = [];
  for (const s of [...sources].sort((a, b) => b.max - a.max)) {
    if (need <= 0) break;
    const take = Math.min(need, s.max);
    minMoves.push({ from: s.areaId, count: take });
    need -= take;
  }
  const minViable = build(minMoves);
  if (minViable) commands.push(minViable);

  return commands;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `corepack pnpm --filter @sengoku-jidai/ai exec vitest run test/candidates.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/ai/src/candidates.ts packages/ai/test/candidates.test.ts
git commit -m "feat(ai): canonical deploy-candidate generation"
```

---

### Task 1.6: RandomBot (`bots/random.ts`)

**Files:**
- Create: `packages/ai/src/bots/random.ts`
- Test: `packages/ai/test/greedy.test.ts` is later; RandomBot gets covered by the match test (1.7). Add a focused unit test: `packages/ai/test/random.test.ts`

**Interfaces:**
- Consumes: `Bot`, `resolvePending`, `deployCandidates`, `AiRng`, `pick`.
- Produces: `class RandomBot implements Bot` constructed with an `AiRng`; picks uniformly among candidates (heuristics handle pending nodes).

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import { createInitialState, resolveCommand } from "@sengoku-jidai/engine";
import { createAiRng } from "../src/rng.js";
import { RandomBot } from "../src/bots/random.js";

describe("RandomBot", () => {
  it("always returns an engine-accepted command", () => {
    const bot = new RandomBot(createAiRng(1));
    const s = createInitialState({ gameId: "g", seed: "seed-A" });
    const cmd = bot.chooseCommand(s, s.activeSeat);
    expect(resolveCommand(s, { seat: s.activeSeat }, cmd).status).toBe("accepted");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `corepack pnpm --filter @sengoku-jidai/ai exec vitest run test/random.test.ts`
Expected: FAIL.

- [ ] **Step 3: Write `src/bots/random.ts`**

```ts
import type { Bot, GameState, Command, SeatId } from "../types.js";
import type { AiRng } from "../rng.js";
import { pick } from "../rng.js";
import { resolvePending } from "../heuristics.js";
import { deployCandidates } from "../candidates.js";

/** Uniform-random baseline. Resolves pending combat/decisions via heuristics, otherwise
 *  picks uniformly among the canonical deploy candidates. */
export class RandomBot implements Bot {
  constructor(private readonly rng: AiRng) {}

  chooseCommand(state: GameState, seat: SeatId): Command {
    const pending = resolvePending(state, seat);
    if (pending) return pending;
    const candidates = deployCandidates(state, seat);
    if (candidates.length === 0) return { type: "pass" };
    return pick(this.rng, candidates);
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `corepack pnpm --filter @sengoku-jidai/ai exec vitest run test/random.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/ai/src/bots/random.ts packages/ai/test/random.test.ts
git commit -m "feat(ai): RandomBot baseline"
```

---

### Task 1.7: Match runner (`match.ts`) + self-play smoke test

**Files:**
- Create: `packages/ai/src/match.ts`
- Modify: `packages/ai/src/index.ts` (export the public surface)
- Test: `packages/ai/test/match.test.ts`

**Interfaces:**
- Consumes: `Bot`, `onTheClock`, `createInitialState`, `resolveCommand`.
- Produces:
  - `interface MatchResult { winner: SeatId | null; rounds: number; commands: number; endReason: EndReason | null }`
  - `function runMatch(botRed: Bot, botBlack: Bot, opts: { seed: string; gameId?: string; maxCommands?: number }): MatchResult`
  - `interface SeriesResult { redSeatWins: number; blackSeatWins: number; aWins: number; bWins: number; games: number }`
  - `function runMatches(botA: Bot, botB: Bot, opts: { games: number; seedPrefix: string; maxCommands?: number }): SeriesResult` — alternates which bot takes red across games to cancel first-move bias; `aWins`/`bWins` count wins for botA/botB respectively.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import { createAiRng } from "../src/rng.js";
import { RandomBot } from "../src/bots/random.js";
import { runMatch, runMatches } from "../src/match.js";

describe("runMatch", () => {
  it("plays RandomBot vs RandomBot to a decisive, reproducible result", () => {
    const mk = () => new RandomBot(createAiRng(123));
    const a = runMatch(mk(), mk(), { seed: "match-1" });
    const b = runMatch(mk(), mk(), { seed: "match-1" });
    expect(a.winner).not.toBeNull();
    expect(a.commands).toBeGreaterThan(0);
    expect(a).toEqual(b); // deterministic given seed + bot seeds
  });

  it("runMatches aggregates a series without throwing", () => {
    const res = runMatches(new RandomBot(createAiRng(1)), new RandomBot(createAiRng(2)), {
      games: 6,
      seedPrefix: "series"
    });
    expect(res.games).toBe(6);
    expect(res.aWins + res.bWins).toBe(6);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `corepack pnpm --filter @sengoku-jidai/ai exec vitest run test/match.test.ts`
Expected: FAIL.

- [ ] **Step 3: Write `src/match.ts`**

```ts
import { createInitialState, resolveCommand, type EndReason } from "@sengoku-jidai/engine";
import type { Bot, SeatId } from "./types.js";
import { onTheClock } from "./onclock.js";

export interface MatchResult {
  winner: SeatId | null;
  rounds: number;
  commands: number;
  endReason: EndReason | null;
}

/** Drive one full game between two bots, headless. Throws if a bot ever emits an
 *  illegal command (that is a bot bug, not an expected outcome). */
export function runMatch(
  botRed: Bot,
  botBlack: Bot,
  opts: { seed: string; gameId?: string; maxCommands?: number }
): MatchResult {
  let state = createInitialState({ gameId: opts.gameId ?? "match", seed: opts.seed });
  const max = opts.maxCommands ?? 100_000;
  let commands = 0;

  while (state.status === "active") {
    const seat = onTheClock(state);
    if (!seat) break;
    const bot = seat === "red" ? botRed : botBlack;
    const cmd = bot.chooseCommand(state, seat);
    const r = resolveCommand(state, { seat }, cmd);
    if (r.status !== "accepted") {
      throw new Error(
        `bot(${seat}) illegal command ${JSON.stringify(cmd)}: ${r.reason.code} — ${r.reason.message}`
      );
    }
    state = r.nextState;
    if (++commands > max) throw new Error("runMatch exceeded maxCommands (non-terminating bot?)");
  }

  return {
    winner: state.winner,
    rounds: state.round,
    commands,
    endReason: state.endReason
  };
}

export interface SeriesResult {
  redSeatWins: number;
  blackSeatWins: number;
  aWins: number;
  bWins: number;
  games: number;
}

/** Play a series, alternating which bot is red to cancel first-move bias. */
export function runMatches(
  botA: Bot,
  botB: Bot,
  opts: { games: number; seedPrefix: string; maxCommands?: number }
): SeriesResult {
  let redSeatWins = 0;
  let blackSeatWins = 0;
  let aWins = 0;
  let bWins = 0;
  for (let i = 0; i < opts.games; i++) {
    const aIsRed = i % 2 === 0;
    const red = aIsRed ? botA : botB;
    const black = aIsRed ? botB : botA;
    const res = runMatch(red, black, {
      seed: `${opts.seedPrefix}-${i}`,
      gameId: `${opts.seedPrefix}-${i}`,
      maxCommands: opts.maxCommands
    });
    if (res.winner === "red") redSeatWins++;
    else if (res.winner === "black") blackSeatWins++;
    const winnerIsA = (res.winner === "red" && aIsRed) || (res.winner === "black" && !aIsRed);
    if (winnerIsA) aWins++;
    else bWins++;
  }
  return { redSeatWins, blackSeatWins, aWins, bWins, games: opts.games };
}
```

- [ ] **Step 4: Update `src/index.ts` to the public surface**

```ts
export type { Bot, SeatId, GameState, Command } from "./types.js";
export { other } from "./types.js";
export { createAiRng, seedFromString, pick, shuffle, type AiRng } from "./rng.js";
export { onTheClock } from "./onclock.js";
export { resolvePending } from "./heuristics.js";
export { deployCandidates } from "./candidates.js";
export { RandomBot } from "./bots/random.js";
export { runMatch, runMatches, type MatchResult, type SeriesResult } from "./match.js";
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `corepack pnpm --filter @sengoku-jidai/ai exec vitest run`
Expected: PASS (all Stage 1 tests).

- [ ] **Step 6: Full gate + commit**

Run: `corepack pnpm --filter @sengoku-jidai/ai typecheck && corepack pnpm lint`
Then:

```bash
git add packages/ai/src/match.ts packages/ai/src/index.ts packages/ai/test/match.test.ts
git commit -m "feat(ai): headless match runner + self-play smoke test"
```

**PR 1 boundary — open a PR for Stage 1.**

---

# Stage 2 — Evaluation & GreedyBot (PR 2)

Delivers: a position evaluation and a 1-ply greedy bot that beats RandomBot by a wide margin — the eval-tuning baseline and the ISMCTS rollout policy.

### Task 2.1: Board geometry cache (`geometry.ts`)

**Files:**
- Create: `packages/ai/src/geometry.ts`
- Test: `packages/ai/test/eval.test.ts` (shared file created here; geometry-specific asserts)

**Interfaces:**
- Consumes: `MapDefinition`, `MapArea`.
- Produces:
  - `function hqDistances(map: MapDefinition, seat: SeatId): Map<string, number>` — BFS hop-count from `seat`'s HQ to every reachable area, cached per `(mapId, seat)`.
  - `function tileBaseValue(map: MapDefinition, seat: SeatId, areaId: string, w: TileValueWeights): number` — geometry-only importance of a tile to `seat`: stars + bonus-slot bump + proximity to the *enemy* HQ.
  - `interface TileValueWeights { star: number; bonusSlot: number; proximity: number }`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import { getMap } from "@sengoku-jidai/engine";
import { hqDistances, tileBaseValue } from "../src/geometry.js";

describe("geometry", () => {
  it("computes zero distance at a seat's own HQ and positive elsewhere", () => {
    const map = getMap("rivers");
    const dist = hqDistances(map, "red");
    const redHq = Object.values(map.areas).find((a) => a.hq === "red")!;
    expect(dist.get(redHq.id)).toBe(0);
    const someOther = Object.values(map.areas).find((a) => a.hq !== "red")!;
    expect(dist.get(someOther.id)!).toBeGreaterThan(0);
  });

  it("values a tile nearer the enemy HQ more highly (proximity term only)", () => {
    const map = getMap("rivers");
    const w = { star: 0, bonusSlot: 0, proximity: 1 };
    const blackHq = Object.values(map.areas).find((a) => a.hq === "black")!;
    const adjToBlack = blackHq.adjacent[0]!;
    const distRed = hqDistances(map, "red");
    // A tile adjacent to black HQ is closer to the enemy (for red) than red's own HQ tile.
    const redHq = Object.values(map.areas).find((a) => a.hq === "red")!;
    expect(tileBaseValue(map, "red", adjToBlack, w)).toBeGreaterThan(
      tileBaseValue(map, "red", redHq.id, w)
    );
    expect(distRed).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `corepack pnpm --filter @sengoku-jidai/ai exec vitest run test/eval.test.ts`
Expected: FAIL (geometry.js missing).

- [ ] **Step 3: Write `src/geometry.ts`**

```ts
import type { MapDefinition, SeatId } from "@sengoku-jidai/engine";

export interface TileValueWeights {
  star: number;
  bonusSlot: number;
  proximity: number;
}

const distanceCache = new Map<string, Map<string, number>>();

/** BFS hop-count from `seat`'s HQ over general adjacency. Cached per (mapId, seat). */
export function hqDistances(map: MapDefinition, seat: SeatId): Map<string, number> {
  const key = `${map.id}:${seat}`;
  const cached = distanceCache.get(key);
  if (cached) return cached;

  const dist = new Map<string, number>();
  const hq = Object.values(map.areas).find((a) => a.hq === seat);
  if (hq) {
    dist.set(hq.id, 0);
    const queue: string[] = [hq.id];
    while (queue.length > 0) {
      const cur = queue.shift()!;
      const d = dist.get(cur)!;
      for (const n of map.areas[cur]!.adjacent) {
        if (!dist.has(n)) {
          dist.set(n, d + 1);
          queue.push(n);
        }
      }
    }
  }
  distanceCache.set(key, dist);
  return dist;
}

/** Geometry-only importance of `areaId` to `seat`: star value, a bonus-slot bump, and
 *  proximity to the ENEMY HQ (so offense — and, via the eval's differential, defense —
 *  concentrate where they matter). */
export function tileBaseValue(
  map: MapDefinition,
  seat: SeatId,
  areaId: string,
  w: TileValueWeights
): number {
  const area = map.areas[areaId]!;
  const enemy: SeatId = seat === "red" ? "black" : "red";
  const enemyDist = hqDistances(map, enemy).get(areaId);
  // Nearer the enemy HQ => higher proximity. 1/(dist+1) in [0,1], 0 if unreachable.
  const proximity = enemyDist === undefined ? 0 : 1 / (enemyDist + 1);
  const bonusSlot = map.bonusSlots.includes(areaId) ? 1 : 0;
  return w.star * area.valueStars + w.bonusSlot * bonusSlot + w.proximity * proximity;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `corepack pnpm --filter @sengoku-jidai/ai exec vitest run test/eval.test.ts`
Expected: geometry asserts PASS (eval asserts added next task in same file).

- [ ] **Step 5: Commit**

```bash
git add packages/ai/src/geometry.ts packages/ai/test/eval.test.ts
git commit -m "feat(ai): board geometry (HQ distances, tile base value)"
```

---

### Task 2.2: Evaluation function (`eval.ts`)

**Files:**
- Create: `packages/ai/src/eval.ts`
- Test: `packages/ai/test/eval.test.ts` (extend with eval asserts)

**Interfaces:**
- Consumes: `getMap`, `gameBoard`, `suppliedAreas`, geometry helpers, `GameState`, `SeatId`, `BonusType`.
- Produces:
  - `interface EvalWeights { vp: number; bonus: Record<BonusType, number>; tile: TileValueWeights; unsuppliedFactor: number; card: number; initiative: number; terminal: number }`
  - `const DEFAULT_WEIGHTS: EvalWeights`
  - `function evaluate(state: GameState, seat: SeatId, weights?: EvalWeights): number` — antisymmetric differential (seat − opponent). Terminal states short-circuit to ±`terminal`.

- [ ] **Step 1: Write the failing test (append to `test/eval.test.ts`)**

```ts
import { createInitialState, gameBoard, getMap, victoryPoints } from "@sengoku-jidai/engine";
import { evaluate, DEFAULT_WEIGHTS } from "../src/eval.js";

describe("evaluate", () => {
  it("is antisymmetric between the seats", () => {
    const s = createInitialState({ gameId: "g", seed: "seed-A" });
    expect(evaluate(s, "red")).toBeCloseTo(-evaluate(s, "black"), 6);
  });

  it("is ~0 at the symmetric opening", () => {
    const s = createInitialState({ gameId: "g", seed: "seed-A" });
    // Rivers starts mirror-symmetric; initiative/first-move may tilt it slightly.
    expect(Math.abs(evaluate(s, "red"))).toBeLessThan(DEFAULT_WEIGHTS.initiative + 1e-6 + 0.5);
  });

  it("rewards holding more victory points", () => {
    const s = createInitialState({ gameId: "g", seed: "seed-A" });
    const map = getMap(s.mapId);
    // Find a starred tile red does not yet supply, and give red a unit + ownership there.
    const board = gameBoard(s);
    const before = evaluate(s, "red");
    const starTile = Object.values(map.areas).find(
      (a) => a.valueStars > 0 && board.ownerOf(a.id) !== "red"
    )!;
    const s2 = structuredClone(s);
    s2.areas[starTile.id] = { owner: "red", units: { troop: 1, ship: 0, siege: 0 } };
    expect(evaluate(s2, "red")).toBeGreaterThan(before);
    expect(victoryPoints).toBeTruthy();
  });

  it("returns a large positive value when the opponent's HQ is eliminated", () => {
    const s = createInitialState({ gameId: "g", seed: "seed-A" });
    const done = structuredClone(s);
    done.status = "complete";
    done.winner = "red";
    expect(evaluate(done, "red")).toBeGreaterThan(500);
    expect(evaluate(done, "black")).toBeLessThan(-500);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `corepack pnpm --filter @sengoku-jidai/ai exec vitest run test/eval.test.ts`
Expected: FAIL (eval.js missing).

- [ ] **Step 3: Write `src/eval.ts`**

```ts
import {
  gameBoard,
  getMap,
  suppliedAreas,
  type BonusType,
  type GameState,
  type MapDefinition,
  type SeatId
} from "@sengoku-jidai/engine";
import { tileBaseValue, type TileValueWeights } from "./geometry.js";

export interface EvalWeights {
  vp: number;
  bonus: Record<BonusType, number>;
  tile: TileValueWeights;
  /** Multiplier applied to controlled-but-unsupplied tiles (0.2 = "big discount, not zero"). */
  unsuppliedFactor: number;
  card: number;
  initiative: number;
  /** Magnitude of a terminal win/loss. */
  terminal: number;
}

export const DEFAULT_WEIGHTS: EvalWeights = {
  vp: 10,
  bonus: { barracks: 3, warRoom: 3, pirateHaven: 2, shipyard: 2, hiddenBase: 2 },
  tile: { star: 2, bonusSlot: 1.5, proximity: 1 },
  unsuppliedFactor: 0.2,
  card: 1.5,
  initiative: 1,
  terminal: 1000
};

/** Concave presence curve: rewards having a unit at all, with diminishing returns per
 *  extra unit (bounded anyway by the 5/3 per-tile caps). */
function presence(units: number): number {
  return units <= 0 ? 0 : 1 + Math.log2(units);
}

/** Diminishing value of holding more cards. */
function cardValue(hand: number): number {
  return hand <= 0 ? 0 : Math.sqrt(hand);
}

/** Per-seat raw score. Positive is good for `seat`. */
function rawScore(state: GameState, map: MapDefinition, seat: SeatId, w: EvalWeights): number {
  const board = gameBoard(state);
  const supplied = suppliedAreas(map, board, seat);
  let score = 0;

  for (const [id, rt] of Object.entries(state.areas)) {
    if (rt.owner !== seat) continue;
    const units = rt.units.troop + rt.units.ship; // siege is 0 in Rivers
    if (units <= 0) continue; // owned ⟺ has units here; skip defensively
    const sf = supplied.has(id) ? 1 : w.unsuppliedFactor;
    const area = map.areas[id]!;
    score += w.vp * area.valueStars * sf; // VP payoff — flat in unit count
    const bonusType = state.bonuses[id];
    if (bonusType) score += w.bonus[bonusType] * sf; // bonus payoff — flat
    score += tileBaseValue(map, seat, id, w.tile) * presence(units) * sf; // military — scales
  }

  score += w.card * cardValue(state.players[seat].hand.length);
  if (state.initiative === seat) score += w.initiative;
  return score;
}

/** Antisymmetric position value for `seat` (seat − opponent). Terminal states short-circuit. */
export function evaluate(state: GameState, seat: SeatId, weights: EvalWeights = DEFAULT_WEIGHTS): number {
  const enemy: SeatId = seat === "red" ? "black" : "red";
  if (state.status === "complete") {
    if (state.winner === seat) return weights.terminal;
    if (state.winner === enemy) return -weights.terminal;
    return 0;
  }
  const map = getMap(state.mapId);
  return rawScore(state, map, seat, weights) - rawScore(state, map, enemy, weights);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `corepack pnpm --filter @sengoku-jidai/ai exec vitest run test/eval.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/ai/src/eval.ts packages/ai/test/eval.test.ts
git commit -m "feat(ai): position evaluation function"
```

---

### Task 2.3: GreedyBot (`bots/greedy.ts`)

**Files:**
- Create: `packages/ai/src/bots/greedy.ts`
- Modify: `packages/ai/src/index.ts` (export GreedyBot, evaluate, DEFAULT_WEIGHTS)
- Test: `packages/ai/test/greedy.test.ts`

**Interfaces:**
- Consumes: `Bot`, `resolvePending`, `deployCandidates`, `evaluate`, `EvalWeights`, `resolveCommand`.
- Produces:
  - `function greedyCommand(state: GameState, seat: SeatId, weights?: EvalWeights): Command` — best immediate deploy by 1-ply eval (pending nodes via heuristics). Ties broken by first-seen for determinism.
  - `class GreedyBot implements Bot` (wraps `greedyCommand`).

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import { createInitialState, resolveCommand } from "@sengoku-jidai/engine";
import { createAiRng } from "../src/rng.js";
import { RandomBot } from "../src/bots/random.js";
import { GreedyBot, greedyCommand } from "../src/bots/greedy.js";
import { runMatches } from "../src/match.js";

describe("GreedyBot", () => {
  it("returns an engine-accepted command", () => {
    const s = createInitialState({ gameId: "g", seed: "seed-A" });
    const cmd = greedyCommand(s, s.activeSeat);
    expect(resolveCommand(s, { seat: s.activeSeat }, cmd).status).toBe("accepted");
  });

  it("is deterministic (same state -> same command)", () => {
    const s = createInitialState({ gameId: "g", seed: "seed-A" });
    expect(greedyCommand(s, s.activeSeat)).toEqual(greedyCommand(s, s.activeSeat));
  });

  it("beats RandomBot by a wide margin over a seeded series", () => {
    const greedy = new GreedyBot();
    const random = new RandomBot(createAiRng(99));
    const res = runMatches(greedy, random, { games: 20, seedPrefix: "g-vs-r" });
    expect(res.aWins).toBeGreaterThanOrEqual(15); // ≥75% for greedy(A)
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `corepack pnpm --filter @sengoku-jidai/ai exec vitest run test/greedy.test.ts`
Expected: FAIL.

- [ ] **Step 3: Write `src/bots/greedy.ts`**

```ts
import { resolveCommand } from "@sengoku-jidai/engine";
import type { Bot, Command, GameState, SeatId } from "../types.js";
import { resolvePending } from "../heuristics.js";
import { deployCandidates } from "../candidates.js";
import { evaluate, DEFAULT_WEIGHTS, type EvalWeights } from "../eval.js";

/** Best immediate deploy by one-ply evaluation. Pending combat/decisions resolve via
 *  heuristics. Deterministic: ties keep the first-seen (candidate order is stable). */
export function greedyCommand(
  state: GameState,
  seat: SeatId,
  weights: EvalWeights = DEFAULT_WEIGHTS
): Command {
  const pending = resolvePending(state, seat);
  if (pending) return pending;

  const candidates = deployCandidates(state, seat);
  if (candidates.length === 0) return { type: "pass" };

  let best: Command = candidates[0]!;
  let bestValue = -Infinity;
  for (const cmd of candidates) {
    const r = resolveCommand(state, { seat }, cmd);
    if (r.status !== "accepted") continue;
    const value = evaluate(r.nextState, seat, weights);
    if (value > bestValue) {
      bestValue = value;
      best = cmd;
    }
  }
  return best;
}

/** 1-ply greedy baseline bot (also the ISMCTS rollout policy). */
export class GreedyBot implements Bot {
  constructor(private readonly weights: EvalWeights = DEFAULT_WEIGHTS) {}

  chooseCommand(state: GameState, seat: SeatId): Command {
    return greedyCommand(state, seat, this.weights);
  }
}
```

- [ ] **Step 4: Update `src/index.ts` (append)**

```ts
export { evaluate, DEFAULT_WEIGHTS, type EvalWeights } from "./eval.js";
export { GreedyBot, greedyCommand } from "./bots/greedy.js";
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `corepack pnpm --filter @sengoku-jidai/ai exec vitest run`
Expected: PASS. If the win-rate assert is flaky, tune `DEFAULT_WEIGHTS` (not the threshold) until greedy dominates random — that is the intended tuning signal.

- [ ] **Step 6: Full gate + commit**

Run: `corepack pnpm --filter @sengoku-jidai/ai typecheck && corepack pnpm lint`
Then:

```bash
git add packages/ai/src/bots/greedy.ts packages/ai/src/index.ts packages/ai/test/greedy.test.ts
git commit -m "feat(ai): GreedyBot 1-ply baseline (beats random)"
```

**PR 2 boundary — open a PR for Stage 2.**

---

# Stage 3 — Determinization & ISMCTS (PR 3)

Delivers: the fair, information-set search that beats the greedy baseline, driven reproducibly by iteration count.

### Task 3.1: Determinization (`determinize.ts`)

**Files:**
- Create: `packages/ai/src/determinize.ts`
- Test: `packages/ai/test/determinize.test.ts`

**Interfaces:**
- Consumes: `RIVERS_DECK`, `GameState`, `SeatId`, `OperationCard`, `AiRng`, `shuffle`, `other`.
- Produces: `function determinize(state: GameState, seat: SeatId, rng: AiRng): GameState` — a deep clone of `state` in which the opponent's hidden hand and the deck order are re-sampled uniformly from the cards consistent with `seat`'s information set (its own hand, the public discard, and the known deck composition). `seat`'s own hand, all board/area/bonus state, and hand *sizes* are preserved.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import { createInitialState } from "@sengoku-jidai/engine";
import { createAiRng } from "../src/rng.js";
import { determinize } from "../src/determinize.js";
import { other } from "../src/types.js";

function totalCards(state: ReturnType<typeof createInitialState>) {
  const counts: Record<string, number> = {};
  const add = (c: string) => (counts[c] = (counts[c] ?? 0) + 1);
  state.players.red.hand.forEach(add);
  state.players.black.hand.forEach(add);
  state.deck.forEach(add);
  state.discard.forEach(add);
  return counts;
}

describe("determinize", () => {
  it("preserves the seat's own hand and all hand sizes and the full card multiset", () => {
    const s = createInitialState({ gameId: "g", seed: "seed-A" });
    // Give both players some cards to make the test meaningful.
    s.players.red.hand = ["ambush", "mobilise"];
    s.players.black.hand = ["ground_assault"];
    s.deck = s.deck.slice(3);
    const before = totalCards(s);

    const d = determinize(s, "red", createAiRng(5));
    expect(d.players.red.hand).toEqual(["ambush", "mobilise"]); // own hand untouched
    expect(d.players.black.hand).toHaveLength(1); // opponent hand SIZE preserved
    expect(d.deck).toHaveLength(s.deck.length);
    expect(totalCards(d)).toEqual(before); // conserves the 24-card multiset
  });

  it("does not mutate the input state", () => {
    const s = createInitialState({ gameId: "g", seed: "seed-A" });
    s.players.black.hand = ["ambush"];
    const deckBefore = [...s.deck];
    determinize(s, "red", createAiRng(1));
    expect(s.deck).toEqual(deckBefore);
    expect(s.players.black.hand).toEqual(["ambush"]);
    expect(other("red")).toBe("black");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `corepack pnpm --filter @sengoku-jidai/ai exec vitest run test/determinize.test.ts`
Expected: FAIL.

- [ ] **Step 3: Write `src/determinize.ts`**

```ts
import { RIVERS_DECK, type GameState, type OperationCard, type SeatId } from "@sengoku-jidai/engine";
import type { AiRng } from "./rng.js";
import { shuffle } from "./rng.js";
import { other } from "./types.js";

/**
 * Sample a full state consistent with `seat`'s information set: keep `seat`'s own hand,
 * the public discard, and all board state; re-draw the OPPONENT's hidden hand and the
 * deck order from the remaining (unseen) cards. Hand sizes and the total 24-card multiset
 * are preserved. The input is not mutated.
 */
export function determinize(state: GameState, seat: SeatId, rng: AiRng): GameState {
  const clone = structuredClone(state) as GameState;
  const enemy = other(seat);

  // Unseen-from-seat pool = full deck minus what seat can see (own hand + discard).
  const pool = countCards(RIVERS_DECK);
  for (const c of clone.players[seat].hand) pool[c]--;
  for (const c of clone.discard) pool[c]--;

  // The unseen cards are exactly the opponent's hand plus the draw deck.
  const unseen: OperationCard[] = [];
  for (const card of Object.keys(pool) as OperationCard[]) {
    for (let i = 0; i < pool[card]; i++) unseen.push(card);
  }
  const shuffled = shuffle(rng, unseen);

  const enemyHandSize = clone.players[enemy].hand.length;
  clone.players[enemy].hand = shuffled.slice(0, enemyHandSize);
  clone.deck = shuffled.slice(enemyHandSize);
  return clone;
}

function countCards(cards: readonly OperationCard[]): Record<OperationCard, number> {
  const counts = {} as Record<OperationCard, number>;
  for (const c of cards) counts[c] = (counts[c] ?? 0) + 1;
  return counts;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `corepack pnpm --filter @sengoku-jidai/ai exec vitest run test/determinize.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/ai/src/determinize.ts packages/ai/test/determinize.test.ts
git commit -m "feat(ai): information-set determinization"
```

---

### Task 3.2: ISMCTS core (`ismcts.ts`)

**Files:**
- Create: `packages/ai/src/ismcts.ts`
- Modify: `packages/ai/src/index.ts` (export IsmctsBot, chooseCommandIsmcts)
- Test: `packages/ai/test/ismcts.test.ts`

**Interfaces:**
- Consumes: `resolveCommand`, `deployCandidates`, `resolvePending`, `evaluate`, `greedyCommand`, `determinize`, `onTheClock`, `createAiRng`, `AiRng`.
- Produces:
  - `interface IsmctsOptions { iterations?: number; deadlineMs?: number; rng: AiRng; depthCap?: number; exploration?: number; weights?: EvalWeights }`
  - `function chooseCommandIsmcts(state: GameState, seat: SeatId, opts: IsmctsOptions): Command`
  - `class IsmctsBot implements Bot` — constructed with `{ iterations?, deadlineMs?, seed?, ... }`; for reproducible tests pass `iterations` and a fixed `seed` (derives a fresh `AiRng` per decision from `seed + state.revision`).

**Design notes (fixed-root-perspective single-tree ISMCTS):**
- Tree edges are deploy commands. Between deploy nodes, `autoAdvance` runs pending combat/decisions via heuristics (advancing the working state's RNG, so combat outcomes vary per determinization).
- All node values are stored in the ROOT seat's perspective (`evaluate(state, rootSeat)`); no negamax sign juggling. UCB orients exploitation by whether the node's mover is the root seat (maximize `W/N`) or the opponent (use `-W/N`).
- Each iteration re-determinizes at the root and descends, re-applying edge commands to that determinization (standard ISMCTS: the tree stores statistics, the state is reconstructed per iteration).

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import { createInitialState, resolveCommand } from "@sengoku-jidai/engine";
import { createAiRng } from "../src/rng.js";
import { chooseCommandIsmcts, IsmctsBot } from "../src/ismcts.js";
import { GreedyBot } from "../src/bots/greedy.js";
import { runMatches } from "../src/match.js";

describe("chooseCommandIsmcts", () => {
  it("returns an engine-accepted command", () => {
    const s = createInitialState({ gameId: "g", seed: "seed-A" });
    const cmd = chooseCommandIsmcts(s, s.activeSeat, { iterations: 50, rng: createAiRng(1) });
    expect(resolveCommand(s, { seat: s.activeSeat }, cmd).status).toBe("accepted");
  });

  it("is reproducible for a fixed seed + iteration count", () => {
    const s = createInitialState({ gameId: "g", seed: "seed-A" });
    const a = chooseCommandIsmcts(s, s.activeSeat, { iterations: 80, rng: createAiRng(7) });
    const b = chooseCommandIsmcts(s, s.activeSeat, { iterations: 80, rng: createAiRng(7) });
    expect(a).toEqual(b);
  });

  it("beats the greedy baseline over a seeded series", () => {
    const ismcts = new IsmctsBot({ iterations: 120, seed: "ai" });
    const greedy = new GreedyBot();
    const res = runMatches(ismcts, greedy, { games: 12, seedPrefix: "mcts-vs-greedy" });
    expect(res.aWins).toBeGreaterThanOrEqual(8); // ≥~65% for ISMCTS(A)
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `corepack pnpm --filter @sengoku-jidai/ai exec vitest run test/ismcts.test.ts`
Expected: FAIL.

- [ ] **Step 3: Write `src/ismcts.ts`**

```ts
import { resolveCommand, type Command, type GameState, type SeatId } from "@sengoku-jidai/engine";
import type { Bot } from "./types.js";
import { createAiRng, seedFromString, type AiRng } from "./rng.js";
import { onTheClock } from "./onclock.js";
import { resolvePending } from "./heuristics.js";
import { deployCandidates } from "./candidates.js";
import { greedyCommand } from "./bots/greedy.js";
import { evaluate, DEFAULT_WEIGHTS, type EvalWeights } from "./eval.js";
import { determinize } from "./determinize.js";

export interface IsmctsOptions {
  iterations?: number;
  deadlineMs?: number;
  rng: AiRng;
  depthCap?: number;
  exploration?: number;
  weights?: EvalWeights;
}

interface Edge {
  cmd: Command;
  n: number;
  w: number; // sum of values in ROOT-seat perspective
  child: Node | null;
}

interface Node {
  n: number;
  edges: Edge[] | null; // null until expanded (lazy: needs the node's state)
}

/** The optimization seam: every search transition goes through here. Throws on an
 *  illegal command (a search bug). Swap the body for copy-on-write later. */
function applyForSearch(state: GameState, seat: SeatId, cmd: Command): GameState {
  const r = resolveCommand(state, { seat }, cmd);
  if (r.status !== "accepted") {
    throw new Error(`search illegal command ${JSON.stringify(cmd)}: ${r.reason.code}`);
  }
  return r.nextState;
}

/** Resolve pending combat/decisions via heuristics until the state is a clean deploy or
 *  the game ends. Combat dice consume the (already-perturbed) working RNG, so outcomes
 *  differ per determinization. */
function autoAdvance(state: GameState): GameState {
  let cur = state;
  let guard = 0;
  while (cur.status === "active") {
    const clock = onTheClock(cur);
    if (!clock) break;
    if (cur.pendingCombat || cur.pendingDecision) {
      const cmd = resolvePending(cur, clock)!;
      cur = applyForSearch(cur, clock, cmd);
      if (++guard > 10_000) throw new Error("autoAdvance did not terminate");
      continue;
    }
    break;
  }
  return cur;
}

function perturbRng(state: GameState, rng: AiRng): GameState {
  return { ...state, rngState: String(Math.floor(rng.next() * 0x1_0000_0000)) };
}

function ucbSelect(node: Node, mover: SeatId, rootSeat: SeatId, c: number, rng: AiRng): Edge {
  const logN = Math.log(node.n + 1);
  let best: Edge | null = null;
  let bestScore = -Infinity;
  for (const e of node.edges!) {
    if (e.n === 0) return e; // try every edge at least once
    const mean = e.w / e.n; // root-seat perspective
    const exploit = mover === rootSeat ? mean : -mean;
    const score = exploit + c * Math.sqrt(logN / e.n) + rng.next() * 1e-9; // tiny tie-break
    if (score > bestScore) {
      bestScore = score;
      best = e;
    }
  }
  return best!;
}

/** Greedy rollout to terminal or depth cap; returns value in ROOT-seat perspective. */
function rollout(
  state: GameState,
  rootSeat: SeatId,
  weights: EvalWeights,
  depth: number,
  depthCap: number
): number {
  let cur = autoAdvance(state);
  let d = depth;
  while (cur.status === "active" && d < depthCap) {
    const seat = onTheClock(cur)!;
    const cmd = greedyCommand(cur, seat, weights);
    cur = autoAdvance(applyForSearch(cur, seat, cmd));
    d++;
  }
  return evaluate(cur, rootSeat, weights);
}

/** One ISMCTS descent. Returns the leaf value in ROOT-seat perspective. */
function descend(
  node: Node,
  state: GameState,
  rootSeat: SeatId,
  rng: AiRng,
  weights: EvalWeights,
  depth: number,
  depthCap: number,
  c: number
): number {
  const cur = autoAdvance(state);
  if (cur.status !== "active" || depth >= depthCap) {
    return evaluate(cur, rootSeat, weights);
  }
  const mover = onTheClock(cur)!;

  if (node.edges === null) {
    node.edges = deployCandidates(cur, mover).map((cmd) => ({ cmd, n: 0, w: 0, child: null }));
    if (node.edges.length === 0) node.edges = [{ cmd: { type: "pass" }, n: 0, w: 0, child: null }];
  }

  const edge = ucbSelect(node, mover, rootSeat, c, rng);
  const next = applyForSearch(cur, mover, edge.cmd);

  let value: number;
  if (edge.n === 0) {
    edge.child = { n: 0, edges: null };
    value = rollout(next, rootSeat, weights, depth + 1, depthCap);
  } else {
    value = descend(edge.child!, next, rootSeat, rng, weights, depth + 1, depthCap, c);
  }

  edge.n++;
  edge.w += value;
  node.n++;
  return value;
}

/** Run ISMCTS and return the most-visited root deploy command. Pending nodes short-circuit
 *  to the heuristic policy. */
export function chooseCommandIsmcts(state: GameState, seat: SeatId, opts: IsmctsOptions): Command {
  const pending = resolvePending(state, seat);
  if (pending) return pending;

  const candidates = deployCandidates(state, seat);
  if (candidates.length <= 1) return candidates[0] ?? { type: "pass" };

  const weights = opts.weights ?? DEFAULT_WEIGHTS;
  const depthCap = opts.depthCap ?? 40;
  const c = opts.exploration ?? 1.4;
  const root: Node = { n: 0, edges: candidates.map((cmd) => ({ cmd, n: 0, w: 0, child: null })) };

  const useIterations = opts.iterations !== undefined;
  const deadline = useIterations ? 0 : Date.now() + (opts.deadlineMs ?? 1000);
  let i = 0;
  while (useIterations ? i < opts.iterations! : Date.now() < deadline) {
    const d = perturbRng(determinize(state, seat, opts.rng), opts.rng);
    descend(root, d, seat, opts.rng, weights, 0, depthCap, c);
    i++;
  }

  // Most-visited root edge (robust choice); ties -> first (candidate order stable).
  let best = root.edges![0]!;
  for (const e of root.edges!) if (e.n > best.n) best = e;
  return best.cmd;
}

/** The AI opponent. For reproducible tests pass `iterations` + `seed`; for production pass
 *  `deadlineMs`. A fresh RNG is derived per decision from `seed + state.revision`. */
export class IsmctsBot implements Bot {
  constructor(
    private readonly opts: {
      iterations?: number;
      deadlineMs?: number;
      seed?: string;
      depthCap?: number;
      exploration?: number;
      weights?: EvalWeights;
    }
  ) {}

  chooseCommand(state: GameState, seat: SeatId): Command {
    const rng = createAiRng(seedFromString(`${this.opts.seed ?? "ai"}:${state.revision}:${seat}`));
    return chooseCommandIsmcts(state, seat, {
      iterations: this.opts.iterations,
      deadlineMs: this.opts.deadlineMs,
      rng,
      depthCap: this.opts.depthCap,
      exploration: this.opts.exploration,
      weights: this.opts.weights
    });
  }
}
```

- [ ] **Step 4: Update `src/index.ts` (append)**

```ts
export { chooseCommandIsmcts, IsmctsBot, type IsmctsOptions } from "./ismcts.js";
export { determinize } from "./determinize.js";
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `corepack pnpm --filter @sengoku-jidai/ai exec vitest run`
Expected: PASS. If the win-rate assert is close/flaky, first raise `iterations` in the test; if still weak, tune `DEFAULT_WEIGHTS`/`exploration`/`depthCap` — do NOT lower the threshold below ~65%.

- [ ] **Step 6: Full gate + commit**

Run: `corepack pnpm --filter @sengoku-jidai/ai typecheck && corepack pnpm lint`
Then:

```bash
git add packages/ai/src/ismcts.ts packages/ai/src/index.ts packages/ai/test/ismcts.test.ts
git commit -m "feat(ai): determinized ISMCTS opponent (beats greedy)"
```

**PR 3 boundary — open a PR for Stage 3.**

---

## Follow-up (separate plan)

**Stage 4 — server AI-seat wiring** gets its own plan after Stages 1–3 merge. It will:
- Add `controllers: Record<SeatId, "human" | "ai">` to a game (DB migration + creation API).
- Add an auto-drive loop in the server command path: after any accepted command, while the on-the-clock seat is AI-controlled, call `IsmctsBot.chooseCommand` (deadline-based) and apply it via `resolveCommand`, surfacing moves through the existing revision/realtime mechanism (human request returns immediately).
- Requires detailed reading of `packages/server/src/persistence/repository.ts`, `database.ts`, `api/routes.ts`, and `realtime/`.

---

## Self-Review

**Spec coverage:**
- §4 package layout → Tasks 1.1–3.2 (all modules present; `heuristics`, `candidates` cover the "heuristic rest" and move canonicalization). ✓
- §5 ISMCTS loop → Task 3.2 (determinize per iteration, UCB, greedy rollout, most-visited choice, `applyForSearch` seam). ✓
- §6 move canonicalization → Task 1.5 (all-in / strongest-single / minimum-viable; placements/strikes/plans/pass). ✓
- §7 eval (unified supply multiplier, flat VP/bonus, unit-scaled military, cards, initiative, terminal; compute-supply-once) → Tasks 2.1–2.2. ✓
- §8 determinism / separate RNG → Task 1.2 + iteration-driven search in 3.2. ✓
- §9 server integration → deferred to the follow-up plan (noted). ✓ (out of this plan's scope by design)
- §10 validation harness (RandomBot, GreedyBot, match runner, win-rate gates) → Tasks 1.6, 1.7, 2.3, 3.2. ✓
- §11 testing (pure units + win-rate + determinism) → every task has tests; determinism tested in 2.3 and 3.2. ✓

**Placeholder scan:** no TBD/TODO; every code step has complete code. ✓

**Type consistency:** `Bot.chooseCommand(state, seat)` used uniformly; `deployCandidates`, `resolvePending`, `evaluate(state, seat, weights?)`, `greedyCommand`, `determinize(state, seat, rng)`, `onTheClock` signatures match across producer/consumer tasks; `EvalWeights`/`TileValueWeights` shapes consistent between `geometry.ts` and `eval.ts`. ✓

**Known tuning risk:** the two win-rate gates (greedy ≥75% vs random; ISMCTS ≥~65% vs greedy) may need weight/iteration tuning during execution. The plan instructs tuning the AI, not lowering thresholds — this is expected TDD-on-strength, not a defect.
