# Expected-combat evaluation (fix AI attack under-valuation)

_Design — 2026-08-10_

## Problem

The position eval (`packages/ai/src/eval.ts`) scores the **unresolved** `pendingCombat`
state produced by an attack. When an `advance`/`sail`/`bombard`/`shell` opens combat,
the attacking units are staged **off-board** (`pendingCombat.attackers`, see engine
`actions.ts`) and the target is still enemy-owned — so `evaluate`, which only sums
units in `state.areas`, sees an attack as a **pure loss of force with no upside**.
Every attack therefore scores ≤ pass in a one-ply eval. Consequences (verified by
instrumentation on seed `repro-7`):

- **Greedy** (one-ply) can never prefer an attack → passes in capped-out states,
  wasting a commander (passing banks a commander to standby for the round).
- This poisons **ISMCTS**, whose rollout policy *is* greedy and whose pending-combat
  leaf evals are undercounted.

This is the second, distinct root cause of the AI's over-passing (the first —
capacity-blind reinforce targeting — was fixed in PR #123).

## Fix (decided: principled expected-outcome model)

When `state.pendingCombat` is set, `evaluate` returns the **probability-weighted
expected value** over the defence-roll distribution, using the engine's own combat math.

### Combat model (faithful to the engine)

Dice faces `[0,1,1,1,1,2]` (via `DEFAULT_DICE_FACES`): P(0)=1/6, P(1)=2/3, P(2)=1/6, E=1.

- **advance / sail** — the defender throws `nDice = 1 + (fort ? 1 : 0)` dice (fort is a
  deterministic terrain +1 on a land advance into a fort tile). **Ambush is ignored**
  (it is an uncertain hand card; assume not played — an explicit, documented
  simplification). For each possible defence total `t` with probability `p`:
  - `outcome = conflictOutcome(t, pc.attackers, pc.defenders)` (engine).
  - Resolve the target per `applyPendingCombat`'s ownership rule: `attackersLeft > 0`
    → attacker owns with `attackersLeft` units; else `defendersLeft > 0` → defender
    holds with `defendersLeft`; else neutral (owner null, 0 units).
  - Losses return to reserve (reserve is unscored — ignore).
- **bombard / shell** — `nDice = pc.dice` (shell = 2). For each total `t` (prob `p`):
  remove `min(t, defenderUnits)` of the target's units; if the tile empties, owner → null.
  No capture.

Expected value = Σ `p · evaluate(resolvedBoard, seat, weights)`. The resolved board has
no `pendingCombat`, so the recursion terminates at depth 1.

### Implementation

- **engine:** export `conflictOutcome` from the package root (add `export * from
  "./conflict.js"` to `packages/engine/src/index.ts`) so the ai package has a single
  source of truth for the casualty math. (`DEFAULT_DICE_FACES` is already exported via
  `rng.js`.)
- **`packages/ai/src/combatOdds.ts`** (new, pure): `rollTotalDistribution(faces, nDice)`
  → `Array<{ total: number; prob: number }>` (distinct totals; convolution for nDice>1).
- **`packages/ai/src/eval.ts`:** `evaluate` short-circuits on `state.pendingCombat` to a
  new `expectedCombatValue(state, seat, weights)`. Resolved boards are built by a **shallow
  rebuild** — copy `state.areas`, replace the single target area, set `pendingCombat = null`
  — not a deep clone (the hot path forbids it). The tiny ownership rule is duplicated from
  `applyPendingCombat`; a cross-check test guarantees fidelity.

### Performance

`evaluate` is on the ISMCTS hot path (rollout policy scores attack candidates). The
expected value enumerates only **distinct totals** (≤3 for 1 die, ≤5 for 2), and the
shallow rebuild avoids deep clones, so an attack eval costs ~N× a normal eval (N =
distinct totals). Acceptable, but MUST be validated: the gated strength harness
(`AI_STRENGTH_TESTS=1`) must still pass and ISMCTS>Greedy should not regress (ideally
improves).

## Scope / non-goals

- ai + one engine export only. No web/server change.
- Ambush / reroll / card play in combat are not modeled (documented simplification).
- No change to the eval weights or the non-combat scoring.

## Testing

- `rollTotalDistribution`: exact distribution for 1 and 2 dice of `[0,1,1,1,1,2]`
  (probabilities sum to 1; known values).
- `expectedCombatValue` fidelity: for several (attackers, defenders, fort) setups, the
  expected value equals a **Monte-Carlo average** of the *real* engine resolution
  (`rollPendingCombat` + `applyPendingCombat` over many seeds) within tolerance.
- Behavioral regression: a clearly-winning attack (many attackers vs few defenders on a
  valuable tile) now evaluates **> pass**; a clearly-losing attack (few vs many) stays
  **≤ pass**.
- Over-passing: extend the greedy self-game invariant — the bot does not pass on a clean
  deploy turn when a winning attack is available.
- Strength: `AI_STRENGTH_TESTS=1` gated harness still green; capture ISMCTS-vs-Greedy
  win rate before/after.
