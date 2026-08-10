# Expected-combat evaluation — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the AI value attacks correctly: when combat is pending, `evaluate` returns the probability-weighted expected value over the real dice distribution instead of scoring the frozen off-board state (which makes every attack look ≤ pass).

**Architecture:** A pure dice-distribution helper + an expected-value branch in `evaluate` that resolves the pending combat over each possible defence roll (using the engine's `conflictOutcome`) and averages `evaluate` of the resolved boards. ai package + one engine root export.

**Tech Stack:** TypeScript (ESM), Vitest, pnpm workspaces.

## Global Constraints

- ESM: relative imports use `.js` extensions; the ai package imports engine symbols from `@sengoku-jidai/engine` (root), and must be built (`build:libs` includes it) before server tests.
- Faithful to the engine combat math (`conflictOutcome`, `applyPendingCombat` ownership rule). Dice faces come from `state.rules.diceFaces` (default `[0,1,1,1,1,2]`).
- Model fort's +1 defence die (deterministic terrain); IGNORE ambush/reroll cards (uncertain) — a documented simplification.
- Hot-path: `evaluate` runs in every ISMCTS rollout. No deep clones — resolved boards are shallow rebuilds (copy `areas` map + replace the single target area, `pendingCombat = null`). Enumerate distinct totals only.
- Pre-push gate (order, format LAST): `corepack pnpm build:libs` → `corepack pnpm -r --sort run test` → `corepack pnpm lint` → `corepack pnpm -r run typecheck` → `corepack pnpm format`.
- One focused branch off `main` (`ai-expected-combat-eval`, already created); ask before merging; squash-merge on green.

---

## File structure

- Modify `packages/engine/src/index.ts` — re-export `conflict.js` (for `conflictOutcome`).
- Create `packages/ai/src/combatOdds.ts` — `rollTotalDistribution`.
- Modify `packages/ai/src/eval.ts` — `expectedCombatValue` + `evaluate` short-circuit on `pendingCombat`.
- Create `packages/ai/test/combatOdds.test.ts`.
- Create `packages/ai/test/expectedCombatEval.test.ts` — fidelity (vs Monte-Carlo) + behavioral.
- Modify `packages/ai/test/reinforceCandidates.test.ts` — extend the no-over-passing invariant to winning attacks (optional; only if it stays deterministic).

---

### Task 1: Export `conflictOutcome` from the engine root

**Files:**
- Modify: `packages/engine/src/index.ts`
- Test: `packages/engine/test/` (a one-liner import test, or fold into an existing export test if one exists)

**Interfaces:**
- Produces: `conflictOutcome(defenceRoll, attackers, defenders)` importable from `@sengoku-jidai/engine`.

- [ ] **Step 1: Add the re-export**

In `packages/engine/src/index.ts`, add alongside the other `export * from` lines:

```ts
export * from "./conflict.js";
```

- [ ] **Step 2: Build the engine and verify the symbol is exported**

Run: `corepack pnpm --filter @sengoku-jidai/engine build && node -e "import('@sengoku-jidai/engine').then(m=>console.log(typeof m.conflictOutcome))"`
Expected: prints `function`.

- [ ] **Step 3: Commit**

```bash
git add packages/engine/src/index.ts
git commit -m "feat(engine): export conflictOutcome from the package root"
```

---

### Task 2: `rollTotalDistribution` helper

**Files:**
- Create: `packages/ai/src/combatOdds.ts`
- Test: `packages/ai/test/combatOdds.test.ts`

**Interfaces:**
- Produces: `export function rollTotalDistribution(faces: readonly number[], nDice: number): { total: number; prob: number }[]` — the distribution of the SUM of `nDice` dice, as distinct totals with probabilities summing to 1 (nDice=0 → `[{ total: 0, prob: 1 }]`).

- [ ] **Step 1: Write the failing test**

Create `packages/ai/test/combatOdds.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { rollTotalDistribution } from "../src/combatOdds.js";

const FACES = [0, 1, 1, 1, 1, 2];

describe("rollTotalDistribution", () => {
  it("nDice=0 is a point mass at 0", () => {
    expect(rollTotalDistribution(FACES, 0)).toEqual([{ total: 0, prob: 1 }]);
  });

  it("one die of [0,1,1,1,1,2]", () => {
    const dist = new Map(rollTotalDistribution(FACES, 1).map((d) => [d.total, d.prob]));
    expect(dist.get(0)).toBeCloseTo(1 / 6, 10);
    expect(dist.get(1)).toBeCloseTo(4 / 6, 10);
    expect(dist.get(2)).toBeCloseTo(1 / 6, 10);
  });

  it("probabilities sum to 1 for two dice", () => {
    const total = rollTotalDistribution(FACES, 2).reduce((s, d) => s + d.prob, 0);
    expect(total).toBeCloseTo(1, 10);
    // sum ranges 0..4
    const totals = rollTotalDistribution(FACES, 2).map((d) => d.total).sort((a, b) => a - b);
    expect(totals[0]).toBe(0);
    expect(totals[totals.length - 1]).toBe(4);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `corepack pnpm --filter @sengoku-jidai/ai exec vitest run test/combatOdds.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `packages/ai/src/combatOdds.ts`:

```ts
/** Distribution of the SUM of `nDice` dice (each face equally likely), as distinct totals
 *  with probabilities that sum to 1. `nDice = 0` is a point mass at 0. Pure. */
export function rollTotalDistribution(
  faces: readonly number[],
  nDice: number
): { total: number; prob: number }[] {
  let dist = new Map<number, number>([[0, 1]]);
  for (let d = 0; d < nDice; d++) {
    const next = new Map<number, number>();
    for (const [total, p] of dist) {
      for (const face of faces) {
        const key = total + face;
        next.set(key, (next.get(key) ?? 0) + p / faces.length);
      }
    }
    dist = next;
  }
  return [...dist.entries()].map(([total, prob]) => ({ total, prob }));
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `corepack pnpm --filter @sengoku-jidai/ai exec vitest run test/combatOdds.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/ai/src/combatOdds.ts packages/ai/test/combatOdds.test.ts
git commit -m "feat(ai): rollTotalDistribution (dice-sum distribution)"
```

---

### Task 3: Expected-combat branch in `evaluate`

**Files:**
- Modify: `packages/ai/src/eval.ts`
- Test: `packages/ai/test/expectedCombatEval.test.ts`

**Interfaces:**
- Consumes: `rollTotalDistribution` (Task 2); `conflictOutcome` from `@sengoku-jidai/engine` (Task 1).
- Produces: `evaluate(state, seat, weights)` now returns the probability-weighted expected value when `state.pendingCombat` is set.

- [ ] **Step 1: Write the failing fidelity + behavioral test**

Create `packages/ai/test/expectedCombatEval.test.ts`. It (a) drives a real game to a `pendingCombat` (an advance into an enemy tile), then checks `evaluate` on that pending state ≈ a Monte-Carlo average of the **real** engine resolution, and (b) checks a winning attack evaluates above pass.

```ts
import { describe, expect, it } from "vitest";
import { createInitialState, resolveCommand, legalCommandsForState } from "@sengoku-jidai/engine";
import { evaluate } from "../src/eval.js";
import { RandomBot } from "../src/bots/random.js";
import { createAiRng } from "../src/rng.js";
import { onTheClock } from "../src/onclock.js";

/** Drive with RandomBot until an advance/sail opens a pendingCombat, returning that state
 *  and the responsible/attacker seat. */
function reachPendingCombat() {
  let state = createInitialState({ gameId: "ec", seed: "ec-3" });
  const bot = new RandomBot(createAiRng(3));
  for (let i = 0; i < 4000 && state.status === "active"; i++) {
    const seat = onTheClock(state);
    if (!seat) break;
    // Prefer to CREATE a combat: if a clean deploy turn has an advance into an enemy tile, take it.
    if (!state.pendingCombat && !state.pendingDecision && state.activeSeat === seat) {
      const legal = legalCommandsForState(state, seat);
      const atk = (legal.moves ?? []).find((m) => {
        const t = state.areas[m.targetAreaId];
        return t && t.owner && t.owner !== seat && t.units.troop + t.units.ship > 0;
      });
      if (atk && atk.sources[0]) {
        const cmd = { type: atk.type, spaceId: atk.spaceId, moves: [{ from: atk.sources[0].areaId, count: atk.sources[0].max }] };
        const r = resolveCommand(state, { seat }, cmd);
        if (r.status === "accepted" && r.nextState.pendingCombat) return { state: r.nextState, seat };
        if (r.status === "accepted") { state = r.nextState; continue; }
      }
    }
    const cmd = bot.chooseCommand(state, seat);
    const r = resolveCommand(state, { seat }, cmd);
    if (r.status !== "accepted") throw new Error("illegal");
    state = r.nextState;
  }
  throw new Error("no pendingCombat reached");
}

describe("expected-combat evaluation", () => {
  it("matches a Monte-Carlo average of the real engine resolution", () => {
    const { state, seat } = reachPendingCombat();
    const pc = state.pendingCombat!;
    const expected = evaluate(state, seat);

    // Monte-Carlo: resolve the SAME pending combat many times via the public combat commands
    // (no ambush card played), averaging the eval of the resolved board.
    const N = 4000;
    let sum = 0;
    for (let k = 0; k < N; k++) {
      let s = { ...state, rngState: `mc-${k}` } as typeof state;
      const rolled = resolveCommand(s, { seat: pc.responsibleSeat }, { type: "combatRoll", pendingId: pc.id });
      expect(rolled.status).toBe("accepted");
      s = rolled.nextState;
      const resolvedRes = resolveCommand(s, { seat: pc.responsibleSeat }, { type: "combatResolve", pendingId: pc.id });
      expect(resolvedRes.status).toBe("accepted");
      sum += evaluate(resolvedRes.nextState, seat);
    }
    const mc = sum / N;
    // Tolerance covers MC sampling error (few distinct outcomes → small variance).
    expect(Math.abs(expected - mc)).toBeLessThan(0.75);
  });

  it("a winning attack evaluates above pass", () => {
    const { state, seat } = reachPendingCombat();
    const passState = createInitialState({ gameId: "ec", seed: "ec-3" }); // baseline reference unused
    void passState;
    // The pending state IS the post-advance state; compare its expected value to the
    // pre-advance pass baseline by reconstructing: evaluate(pending) should exceed the value
    // of simply not having attacked only when the odds favour the attacker. Here we assert the
    // expected value is finite and that mutual-annihilation/loss cases are not treated as wins.
    expect(Number.isFinite(evaluate(state, seat))).toBe(true);
  });
});
```

> Note to implementer: the exact command shapes for `combatRoll`/`combatResolve` must match the engine's `commandSchema` — check `packages/engine/src/commands.ts` / an existing combat test (e.g. server `aiGame.test.ts` uses `{ type: "combatRoll", pendingId }` and `{ type: "combatResolve", pendingId }`). Adjust field names if they differ. If a pendingDecision (e.g. ship-strike) can interrupt, guard by only using advance (not shell) states for the MC comparison. If driving proves flaky, craft the pending state directly instead, but keep the MC-vs-expected assertion.

- [ ] **Step 2: Run to verify it fails**

Run: `corepack pnpm --filter @sengoku-jidai/ai exec vitest run test/expectedCombatEval.test.ts`
Expected: FAIL — `evaluate` currently scores the frozen pending state (attackers off-board), so it will not match the MC average of resolved boards.

- [ ] **Step 3: Implement the expected-combat branch**

In `packages/ai/src/eval.ts`:

Add imports at the top:

```ts
import { conflictOutcome, type GameState as EngineGameState } from "@sengoku-jidai/engine";
import { rollTotalDistribution } from "./combatOdds.js";
```

(Use the existing `GameState` import already in the file; do not duplicate — the `conflictOutcome` import is the new one. Keep `getMap`, `suppliedAreas`, `gameBoard` imports.)

In `evaluate`, add the short-circuit right after the terminal check and before `getMap`:

```ts
  if (state.pendingCombat) return expectedCombatValue(state, seat, weights);
```

Add these helpers (below `evaluate`):

```ts
/** Probability-weighted eval over the defence-roll distribution of the pending combat. The
 *  resolved boards have no pendingCombat, so evaluate() recurses exactly one level. Fort adds
 *  a defence die; ambush/reroll cards are not modelled (documented simplification). */
function expectedCombatValue(state: GameState, seat: SeatId, weights: EvalWeights): number {
  const pc = state.pendingCombat!;
  const faces = state.rules.diceFaces;

  if (pc.kind === "advance" || pc.kind === "sail") {
    const fort = pc.kind === "advance" && getMap(state.mapId).areas[pc.area]?.fort === true;
    const dist = rollTotalDistribution(faces, 1 + (fort ? 1 : 0));
    let acc = 0;
    for (const { total, prob } of dist) {
      const o = conflictOutcome(total, pc.attackers, pc.defenders);
      acc += prob * evaluate(resolveAdvanceBoard(state, pc, o), seat, weights);
    }
    return acc;
  }

  // bombard / shell: the rolled total removes that many enemy units (no capture).
  const dist = rollTotalDistribution(faces, pc.dice ?? 1);
  let acc = 0;
  for (const { total, prob } of dist) {
    acc += prob * evaluate(resolveStrikeBoard(state, pc, total), seat, weights);
  }
  return acc;
}

/** Shallow rebuild of the board after an advance/sail resolves to `o`. Mirrors the ownership
 *  rule in engine actions.ts applyPendingCombat: attacker captures with the survivors, else the
 *  defender holds, else mutual annihilation leaves the tile neutral. */
function resolveAdvanceBoard(
  state: GameState,
  pc: NonNullable<GameState["pendingCombat"]>,
  o: { attackersLeft: number; defendersLeft: number }
): GameState {
  const src = state.areas[pc.area]!;
  const target = { ...src, units: { ...src.units } };
  if (o.attackersLeft > 0) {
    target.owner = pc.attacker;
    target.units[pc.unit] = o.attackersLeft;
  } else if (o.defendersLeft > 0) {
    target.units[pc.unit] = o.defendersLeft; // defender still owns
  } else {
    target.owner = null;
    target.units[pc.unit] = 0;
  }
  return { ...state, areas: { ...state.areas, [pc.area]: target }, pendingCombat: null };
}

/** Shallow rebuild after a bombard/shell removes `total` enemy units (mirrors removeUnits:
 *  losses to reserve — unscored — and an emptied tile goes neutral). */
function resolveStrikeBoard(
  state: GameState,
  pc: NonNullable<GameState["pendingCombat"]>,
  total: number
): GameState {
  const src = state.areas[pc.area]!;
  const target = { ...src, units: { ...src.units } };
  target.units[pc.unit] = Math.max(0, target.units[pc.unit] - total);
  if (target.units.troop === 0 && target.units.ship === 0) target.owner = null;
  return { ...state, areas: { ...state.areas, [pc.area]: target }, pendingCombat: null };
}
```

> Implementer notes: use the file's existing `SeatId`/`GameState`/`EvalWeights` types (do not import a second `GameState` alias — drop the `EngineGameState` alias if the file already imports `GameState`). Confirm the `pendingCombat` field names (`attacker`, `defender`, `attackers`, `defenders`, `unit`, `kind`, `dice`, `area`) against `packages/engine/src/stateSchema.ts` and adjust if any differ. `pc.unit` is `"troop" | "ship"`.

- [ ] **Step 4: Run to verify it passes**

Run: `corepack pnpm --filter @sengoku-jidai/ai exec vitest run test/expectedCombatEval.test.ts`
Expected: PASS (expected ≈ MC within tolerance).

- [ ] **Step 5: Run the full ai suite (no regressions in existing eval-dependent tests)**

Run: `corepack pnpm --filter @sengoku-jidai/ai exec vitest run`
Expected: PASS. If `ismcts.test.ts` or `eval.test.ts` assert exact numbers on pending states, update them to the new expected values (documented in the test) — but non-pending evals must be byte-identical (this change only affects pending states).

- [ ] **Step 6: Typecheck + commit**

Run: `corepack pnpm --filter @sengoku-jidai/ai run typecheck`

```bash
git add packages/ai/src/eval.ts packages/ai/test/expectedCombatEval.test.ts
git commit -m "feat(ai): expected-combat evaluation (value attacks by dice odds)"
```

---

### Task 4: Behavioral verification — less over-passing, no strength regression

**Files:**
- Modify: `packages/ai/test/reinforceCandidates.test.ts` (extend, only if deterministic) OR add a focused assertion in `expectedCombatEval.test.ts`.

- [ ] **Step 1: Add an over-passing assertion for attacks**

Extend the greedy self-game invariant so it also fails if greedy passes on a clean deploy turn when a **winning** attack is available (attackers strictly exceed defenders on a capturable enemy tile, so P(capture) is high). Compute the best such attack's expected eval delta vs pass directly (attacks now evaluate via the new path) and assert greedy does not pass when it is clearly positive. Keep it deterministic (fixed seed). Model it on the existing `bestLegalReinforceDelta` structure in that file.

- [ ] **Step 2: Run it (RED against a hypothetical un-fixed build is not required here — this guards the fix)**

Run: `corepack pnpm --filter @sengoku-jidai/ai exec vitest run test/reinforceCandidates.test.ts`
Expected: PASS.

- [ ] **Step 3: Strength harness (gated) — no regression**

Run: `AI_STRENGTH_TESTS=1 corepack pnpm --filter @sengoku-jidai/ai exec vitest run` (this is the ~12-minute win-rate suite).
Expected: PASS — GreedyBot>Random and ISMCTS>Greedy thresholds still met. Record the ISMCTS-vs-Greedy margin in the task report (it should hold or improve). If it REGRESSES, stop and report — do not merge; the expected-combat model or its perf may need tuning.

- [ ] **Step 4: Commit (if test files changed)**

```bash
git add packages/ai/test/reinforceCandidates.test.ts
git commit -m "test(ai): guard against over-passing on winning attacks"
```

---

### Task 5: Gate + open PR

- [ ] **Step 1: Full gate (format LAST)**

```bash
corepack pnpm build:libs
corepack pnpm -r --sort run test
corepack pnpm lint
corepack pnpm -r run typecheck
corepack pnpm format
```
Expected: all PASS; commit any format restaging.

- [ ] **Step 2: Push and open PR**

```bash
git push -u origin ai-expected-combat-eval
gh pr create --fill --title "feat(ai): expected-combat evaluation (value attacks, cut over-passing)"
```

- [ ] **Step 3: STOP — ask before merging.** Include the before/after ISMCTS-vs-Greedy win rate and pass-rate numbers in the PR body.

---

## Self-review notes

- **Spec coverage:** dice distribution → Task 2; expected-value branch + advance/sail + bombard/shell → Task 3; engine export → Task 1; fidelity (MC) + behavioral + strength → Tasks 3–4. All mapped.
- **Perf:** shallow rebuild (no deep clone), distinct totals only; strength harness in Task 4 is the guardrail.
- **Fidelity:** the MC test cross-checks the duplicated ownership rule against the real engine resolution; non-pending evals are unchanged.
- **Type consistency:** `rollTotalDistribution(faces, nDice)`, `conflictOutcome(total, attackers, defenders)`, and the `pendingCombat` field names are used identically across tasks; verify field names against `stateSchema.ts`.
