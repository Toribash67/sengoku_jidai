# AI Opponent — Design Spec

_Date: 2026-08-08_

## 1. Summary

Add a computer opponent that can take a seat (`red`/`black`) in a Sengoku Jidai game
and play a full match against a human. Target strength: **challenge an intermediate
player** — plans a round ahead, uses the board and combat sensibly, does not blunder.

The opponent is a **Determinized Information-Set Monte Carlo Tree Search (ISMCTS)** that
reasons from its seat's information set (fair play — it does not read the opponent's
hidden hand), built as a new package on top of the existing `@sengoku-jidai/engine`.

## 2. Goals / Non-goals

**Goals (v1):**
- A server-driven AI seat that plays legal, sensible moves to game end.
- Search over **deploy** decisions; cheap heuristics for the rest (combat rolls,
  rerolls, pending decisions).
- Fair information-set play via determinization (no cheating on hidden info).
- Fully reproducible given `(state, seed)`.
- A headless validation harness (baseline bots + match runner + win-rate gates).

**Non-goals (v1, explicitly deferred):**
- Searching over operation-card attachment to deploys (card play stays heuristic).
- Searching over combat rerolls / pending decisions.
- Performance work beyond correctness (the `resolveCommand` `JSON` deep-clone stays;
  see §9 for the isolated optimization seam).
- A learned evaluation function (eval is hand-tuned in v1).

## 3. Why this shape (rationale from the rules)

Facts established from the engine that drive the design:

- **Stochastic + imperfect information.** Combat uses dice (`rng.rollDie`, faces
  `0,1,1,1,1,2`) and hands are hidden (`PlayerState.hand`). Plain minimax + alpha-beta
  does not apply; chance nodes need expectiminimax and hidden hands need
  determinization. ISMCTS handles both natively and is *anytime* (spends the whole
  time budget; more time → stronger).
- **Short horizon, moderate width.** `maxRounds = 4`, `commandersPerPlayer = 5`, so
  rollouts frequently reach terminal states — good for search quality.
- **Positional, not attritional.** Combat casualties recycle to each player's reserve
  (`actions.ts:526-527`, `370`), so total material is ~conserved. Value lives in
  *territory and supply*, not in trading units. This is why the eval is position-based
  and "material" is not a term.
- **Ownership ≡ unit presence.** A tile's last unit cannot be moved out
  (`validate.ts:226,280` — "Cannot take the last unit"); empty tiles arise only from
  combat, where the owner nulls (`actions.ts:374,556`). Supply (`SupplyBoard.ownerOf`
  reads `owner`) therefore means "an unbroken chain of unit-bearing tiles from this
  tile to the capital." VP scores only from supplied tiles.
- **A legal-move generator already exists** (`legalCommandsForState` in `view.ts`) and
  scoring primitives exist (`victoryPoints`, `hqEliminated`, `gameBoard`) — the AI
  reuses them rather than reimplementing rules.

## 4. Package layout — `packages/ai` (`@sengoku-jidai/ai`)

Depends on `@sengoku-jidai/engine` (root export). Server-only; never bundled into the
web client. Modules, each single-purpose and independently testable:

- `eval.ts` — static position evaluation, pure `(state, seat) => number` (§7).
- `determinize.ts` — sample a full state consistent with a seat's information set.
- `moves.ts` — enumerate + **canonicalize** candidate deploy commands (§6).
- `heuristics.ts` — fixed policies for combat rolls / rerolls / pending decisions.
- `greedy.ts` — 1-ply greedy-eval bot (ISMCTS rollout policy **and** a baseline bot).
- `ismcts.ts` — the tree search (§5).
- `rng.ts` — a seeded PRNG for the *search*, separate from the engine's game RNG (§8).
- `index.ts` — public `AiPlayer` surface + baseline bots + match runner.

Primary interface:

```ts
interface AiRng { next(): number; } // mulberry32-style, seeded
interface AiPlayer {
  chooseCommand(state: GameState, seat: SeatId,
                opts: { deadlineMs: number; rng: AiRng }): Command;
}
```

`AiPlayer.chooseCommand` must be able to produce **every** command type the engine can
require of a seat: deploy commands via search, and combat/pending commands via
`heuristics.ts`.

## 5. Search — Determinized ISMCTS (`ismcts.ts`)

Single tree, one fresh determinization per iteration:

```
chooseCommand(state, seat, {deadlineMs, rng}):
  root ← node(candidates from moves.ts)
  while now() < deadlineMs:
    d ← determinize(state, seat, rng)      // sample opponent hand + deck order
    perturb d.rngState from rng            // dice vary across iterations
    simulate(root, d, rng)                 // select → expand → rollout → backprop
  return most-visited root child.command   // robust choice
```

- **Select:** UCB1 over candidate children (tunable exploration constant).
- **Expand:** add one unvisited candidate.
- **Rollout:** play the greedy-eval policy (`greedy.ts`) for both sides to terminal or
  a depth cap, resolving combat sub-decisions via `heuristics.ts`; return `eval` at the
  leaf.
- **Backprop:** standard visit/value update.

**Single-tree validity:** deploy legality depends only on *public* supply/occupancy,
not hidden cards, so the candidate set is identical across determinizations — a clean
single ISMCTS tree. Only combat outcomes (chance) differ per determinization.

Every transition in tree + rollout goes through a thin wrapper
`applyForSearch(state, seat, command)` around `resolveCommand` (§9).

## 6. Move-space canonicalization (`moves.ts`)

A single `advance`/`sail` command is a multiset allocation (`moves: Move[]`) over legal
sources × counts; enumerating all splits explodes. On top of `legalCommandsForState`
(legal sources + caps), generate only a **handful of canonical candidates per action
space**:

- **Advance / Sail:** archetypes — *all-in* (max from every legal source), *strongest
  single source*, *minimum viable* (attackers = defenders + 1). ~2–3 per space.
- **Reinforce / Embark:** whole pool into the highest-value legal area, plus 1–2 spread
  patterns.
- **Bombard / Shell:** dice count is rules-fixed; candidates = each legal target.
- **Plan:** plan-a (seize initiative) vs plan-b. **Pass:** always a candidate.

The per-space candidate cap is a tunable width knob, commented as a deliberate coverage
limit to widen later. **v1 simplification:** search evaluates *card-less* deploys; card
attachment stays heuristic (first strength upgrade after v1).

## 7. Evaluation function (`eval.ts`)

Pure, symmetric, fast (runs at every rollout leaf). Terminal states short-circuit to a
large ±value. Non-terminal = weighted **differential (seat − opponent)**:

- **Supplied tiles** (≥1 unit + unit-chain to capital, via `suppliedAreas`):
  - `+ VPstars(t)` — flat, count-independent (VP saturates at the first unit).
  - `+ bonusValue(t)` if a supplied bonus slot — flat, valued per bonus type
    (`suppliesBonus`; e.g. an extra bombard die ≠ a reinforce bump).
  - `+ tileValue(t, seat) · f(#units)` — military position.
- **Controlled-but-unsupplied tiles** (have units, chain broken):
  - `+ tileValue(t, seat) · f(#units) · 0.2` — no VP/bonus (unsupplied).
- `+ cards` — diminishing in `hand.length`.
- `+ initiative` — small flat bonus for holding next-round initiative.
- **Terminal:** ±BIG for HQ loss / final-round VP result.

Definitions:
- `tileValue(t, seat)` is **asymmetric**: higher near the *enemy* capital, bumped for
  star/bonus tiles. Consequence: HQ *defense* falls out of the differential (enemy units
  massing near your capital score high in *their* positional term, subtracting from
  yours) — no separate defense term beyond the terminal HQ-loss value.
- `f(#units)` is concave: a presence constant plus a diminishing tail, bounded by the
  per-tile caps (5 land / 3 sea, `resolve.ts:100`) — prefers spreading over over-stacking.

**Dropped terms:** material (≈conserved via reserve recycling) and commanders-available
(uncontrollable and already seen by the search).

Weights start hand-tuned; the match runner (§10) is the tuning loop.

## 8. Determinism / RNG (`rng.ts`)

The engine forbids `Math.random`/`Date.now` and its `rngState` stream *is* authoritative
game history — the search must never advance it. The AI carries its **own** seeded PRNG
(`AiRng`, mulberry32 like `engine/rng.ts`), seeded per decision from `gameId + revision`.
Determinization, candidate tie-breaks, and rollout dice draw from `AiRng`; when
simulating combat the search overwrites the *working copy's* `rngState` from `AiRng` so
rolls vary across iterations while still flowing through the engine's deterministic roll
function. Net: `chooseCommand` is reproducible given `(state, seed)`.

## 9. Server integration + optimization seam

**AI-controlled seat.** Add `controllers: Record<SeatId, "human" | "ai">` to a game,
persisted at creation alongside `mode`. Orthogonal to `hotseat`/multiplayer modes.

**Auto-drive loop.** After any accepted command (`repository.ts` command path), the
server checks whether the seat now *on the clock* is AI-controlled — `activeSeat` during
deploy, or `pendingCombat.responsibleSeat` / `pendingDecision.seat` when set. If so it
calls `AiPlayer.chooseCommand` and applies the result through the same `resolveCommand`
path, looping until a human is on the clock or the game ends.

**Latency.** The ~10s think runs server-side in this loop. The human's HTTP response
returns immediately; the AI's move surfaces via the existing revision/refresh mechanism
(and `realtime/`) so the human is never blocked for the think time.

**Optimization seam.** All search transitions go through `applyForSearch`, which in v1
just calls `resolveCommand` (with its `JSON.parse(JSON.stringify)` deep-clone). This is
the single place to later swap in copy-on-write / apply-undo (or a WASM transition)
without touching search logic — the deferred throughput→depth win.

## 10. Validation harness

Headless, under `packages/ai`, no server:

- **Baseline bots:** `RandomBot` (uniform over legal commands) and `GreedyBot`
  (= `greedy.ts`). `GreedyBot` doubles as the ISMCTS rollout policy.
- **Match runner:** `runMatch(botA, botB, {seed})` drives a full game via
  `createInitialState` + `resolveCommand`, replicating the on-the-clock logic (deploy +
  `pendingCombat`/`pendingDecision`), returning winner + stats. `runMatches(n)`
  aggregates deterministic win-rates over a fixed seed sequence.
- **Automated gates (vitest):** e.g. ISMCTS beats Random ≥ ~90% and Greedy ≥ ~65% over
  N seeded games — start lenient, ratchet up. Plus a determinism test (same seed → same
  move).
- **Playtest:** flip the `controllers` flag on a local game and play the AI in the real
  web UI. The subjective "intermediate feel" is the final gate.

## 11. Testing

- Pure units get direct unit tests: `eval`, `determinize`, `moves` canonicalization,
  `heuristics`, `rng`.
- Search gets the win-rate gates + determinism test.
- Consistent with the repo norm of testing pure functions (no component-test infra
  needed — the AI is all logic).

## 12. Deferred / future strength upgrades

1. Fold card attachment into the deploy search.
2. Search over combat rerolls / pending decisions.
3. Kill the `resolveCommand` clone behind `applyForSearch` (copy-on-write / apply-undo).
4. Optional WASM hot-loop (transition + eval) if profiling proves TS is the wall.
5. Learned / auto-tuned evaluation weights driven by the match runner.
