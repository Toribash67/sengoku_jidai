# AI Rebuild, Part 1: Dice- and Card-Aware Search — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a new AI bot (`ExpectiBot`) that values battles by their real dice odds, counts cards to price the opponent's hidden hand, plans its own card play inside the look-ahead, sees only its seat's information, and has a per-game thinking time — then prove it against the old bot.

**Architecture:** A new `packages/ai/src/search2/` module set beside the untouched old search. `observe()` redacts a `GameState` into one where every card the seat cannot see is a `HIDDEN` placeholder; everything downstream works on such states with the ordinary engine. A battle resolver turns a pending combat into a short list of weighted result states; a depth-limited search maximises on the AI's choices, minimises on the opponent's, and averages over battle results. Opponent cards are modelled by "granting" a placeholder a real identity with the counted probability.

**Tech Stack:** TypeScript, pnpm workspace, vitest, `node:worker_threads`, Fastify + better-sqlite3 (server), React (web), zod (shared).

**Spec:** `docs/superpowers/specs/2026-11-12-ai-rebuild-search-design.md` — read it first; section numbers below (§) refer to it.

## Global Constraints

- Use `corepack pnpm ...`. `packages/ai` imports the engine from its built `dist`: run `corepack pnpm --filter @sengoku-jidai/engine build` after any engine edit and before AI tests on a fresh checkout.
- `packages/ai` stays pure and deterministic; wall-clock is used only for the search deadline.
- Do not change `packages/engine` types. In particular do not add a hidden-card value to the engine's `OperationCard` union; `HIDDEN` is an AI-side cast (Task 2).
- Do not modify the old search (`bots/alphabeta.ts`, `heuristics.ts`, `eval.ts`, `candidates.ts`, `ismcts.ts`) except `match.ts` in Task 1. `evaluate` and `DEFAULT_WEIGHTS` are used as they are.
- Dice faces, rounds, commanders and the deck come from `state.rules` and `deckFor(state.rules.rulesetId)`; never hard-code them.
- Fixed-depth behaviour must be a pure function of the observation: no `Math.random`, no RNG, stable iteration order, ties keep the first-seen candidate.
- The new bot must never emit `HIDDEN` in a command, and every command it emits must be accepted by the engine.
- Server: new SQLite migrations only add; never reset or rewrite existing data. Games without a stored thinking time behave as Normal.
- Thinking-time presets, exact: Quick 1500 ms, Normal 5000 ms (default), Long 10000 ms.
- Finish each task with `corepack pnpm --filter <package> typecheck`, `corepack pnpm lint` and `corepack pnpm exec prettier --check .` clean. Known local quirk: `packages/web` typecheck fails on case-insensitive filesystems (macOS) because of pre-existing `GameLog`/`gameLog` and `ActionGlyph`/`actionGlyph` file pairs; treat CI as the judge for web typecheck.
- Commit after every task with a conventional message (`feat(ai): …`, `test(ai): …`) ending in `Co-Authored-By: Claude <noreply@anthropic.com>`.

## Review Focus

Conditions the spec implies but does not spell out, most likely to bite first. Each has a pinned test in the task named.

1. **Several battles queued by one Commandeer** (a resolved battle leaves another `pendingCombat` or a `selectCombat` decision): the search must walk through them without looping or crashing. → Task 7.
2. **Degenerate card counts** (opponent holds 0 cards; no unseen copies of a kind; hand larger than what is unseen): probabilities must be exactly 0 or 1, never `NaN`. → Task 3.
3. **A deadline too short to finish even depth 1**: the bot still returns a legal command. → Task 7.
4. **The AI is on the clock mid-battle after extra dice were thrown** (phase `rolled` with 3 or 4 dice showing, or `awaiting-cover`): a reroll is valued with the same number of dice, and Take Cover is answered. → Task 6.
5. **A game on a custom map, and a game stored before the thinking-time column existed or with an out-of-range value**: the worker finds the map; the server falls back to Normal and clamps. → Tasks 11 and 12.

## File Structure

```
packages/ai/src/
  match.ts                      (modify) draws, ruleset passthrough
  search2/
    hidden.ts                   HIDDEN placeholder, observe(), grantCard()
    belief.ts                   unseenPool(), holdProbability()
    cardRank.ts                 CARD_KEEP_RANK, cardToSpend()
    features.ts                 Features, DEFAULT_FEATURES, ExpectiOptions
    battle.ts                   battleOutcomes(), battleDecision()
    search.ts                   searchValue(), chooseCommand()
  bots/expecti.ts               ExpectiBot
  bots/trapper.ts               TrapperBot
  botRegistry.ts                parseBotSpec()
  expecti.worker.ts             worker entry
  expectiWorkerRunner.ts        runExpectiInWorker()
  index.ts                      (modify) exports
packages/ai/scripts/duel.ts     series runner CLI
packages/ai/test/search2/       one test file per source file, plus scenario.ts, traps.test.ts
packages/shared/src/schemas.ts  (modify) aiThinkTime, AI_THINK_MS
packages/server/migrations/010_ai_think_ms.sql
packages/server/src/…           (modify) config.ts, persistence/database.ts, persistence/repository.ts, api/routes.ts
packages/web/src/…              (modify) components/CreateGameScreen.tsx, client/api.ts, App.tsx
```

---

### Task 1: Harness — count draws, pass a ruleset through

**Files:**
- Modify: `packages/ai/src/match.ts`
- Test: `packages/ai/test/match.test.ts`

**Interfaces:**
- Produces: `SeriesResult` gains `draws: number`; `aWins`/`bWins` no longer include draws. `runMatches(botA, botB, opts)` accepts `opts.rules?: RulesConfig` and `opts.seeds?: string[]` (when given, plays each seed **twice**, once with A as red and once as black, ignoring `games`/`seedPrefix`; `games` in the result is `2 × seeds.length`).

- [ ] **Step 1: Write the failing tests** in `match.test.ts`

```ts
it("counts a drawn game as a draw, not a win for B", () => {
  const draw: Bot = { chooseCommand: () => ({ type: "pass" }) }; // both pass forever → equal VP
  const res = runMatches(draw, draw, { games: 2, seedPrefix: "draw" });
  expect(res.aWins + res.bWins + res.draws).toBe(2);
  // whatever the tiebreak yields, a null winner must land in draws
  const single = runMatch(draw, draw, { seed: "draw-0" });
  if (single.winner === null) expect(res.draws).toBeGreaterThan(0);
});

it("mirrors each seed when seeds are given", () => {
  const mk = () => new RandomBot(createAiRng(7));
  const res = runMatches(mk(), mk(), { seeds: ["m1", "m2", "m3"] });
  expect(res.games).toBe(6);
  expect(res.aWins + res.bWins + res.draws).toBe(6);
});
```

Also change the existing assertion `expect(res.aWins + res.bWins).toBe(6)` to include `+ res.draws`.

- [ ] **Step 2: Run** `corepack pnpm --filter @sengoku-jidai/ai exec vitest run test/match.test.ts` — expect the two new tests to fail (`draws` undefined, `seeds` ignored).
- [ ] **Step 3: Implement** in `match.ts`: a `null` winner increments `draws` only; `rules` is forwarded to `runMatch`; the `seeds` mode as described.
- [ ] **Step 4: Run the same command** — expect PASS. Run the whole AI suite (`corepack pnpm --filter @sengoku-jidai/ai test`) to confirm no other test relied on the old counting.
- [ ] **Step 5: Commit** — `fix(ai): count drawn matches separately and mirror seeds in series`

---

### Task 2: The information boundary — `observe`, `HIDDEN`, `grantCard`

**Files:**
- Create: `packages/ai/src/search2/hidden.ts`
- Test: `packages/ai/test/search2/hidden.test.ts`

**Interfaces:**
- Produces:
  - `export const HIDDEN = "hidden" as OperationCard` — a placeholder for a card whose identity the observer does not know. The engine only ever tests hands with `includes`/`indexOf`/`length`, so a placeholder counts toward hand size, can be discarded to reroll, and enables no card ability.
  - `export function observe(state: GameState, seat: SeatId): GameState` — a deep copy in which the opponent's hand is `HIDDEN` × its length, `deck` is `HIDDEN` × its length, and `rngState` is the constant `createRngState("observed")`. Own hand, discard, board and everything else are unchanged.
  - `export function grantCard(state: GameState, seat: SeatId, card: OperationCard): GameState | null` — a copy where one `HIDDEN` in `seat`'s hand becomes `card`; `null` if that hand has no `HIDDEN`.
  - `export function isRealCard(card: OperationCard): boolean`.

- [ ] **Step 1: Write the failing tests**

```ts
const base = () => {
  const s = createInitialState({ gameId: "g", seed: "obs" });
  s.players.red.hand = ["ambush", "mobilise"];
  s.players.black.hand = ["ambush", "commandeer", "ship_strike"];
  return s;
};

it("hides the opponent's cards, the deck order and the rng", () => {
  const o = observe(base(), "red");
  expect(o.players.red.hand).toEqual(["ambush", "mobilise"]);
  expect(o.players.black.hand).toEqual([HIDDEN, HIDDEN, HIDDEN]);
  expect(o.deck).toHaveLength(base().deck.length);
  expect(o.deck.every((c) => c === HIDDEN)).toBe(true);
});

it("is identical for states that differ only in hidden information", () => {
  const a = base();
  const b = base();
  b.players.black.hand = ["mobilise", "mobilise", "river_assault"];
  b.deck = [...b.deck].reverse();
  b.rngState = createRngState("other");
  expect(observe(a, "red")).toEqual(observe(b, "red"));
});

it("does not mutate its input", () => {
  const s = base();
  const before = structuredClone(s);
  observe(s, "red");
  expect(s).toEqual(before);
});

it("grantCard turns one placeholder into a real card", () => {
  const o = observe(base(), "red");
  const g = grantCard(o, "black", "ambush")!;
  expect(g.players.black.hand.filter((c) => c === "ambush")).toHaveLength(1);
  expect(g.players.black.hand).toHaveLength(3);
  expect(grantCard(o, "red", "ambush")).toBeNull(); // red's own hand has no placeholders
});

it("a placeholder hand offers the engine no card plays", () => {
  const o = observe(base(), "red");
  expect(legalCommandsForState(o, "black").cardPlays).toEqual([]);
});
```

- [ ] **Step 2: Run** `corepack pnpm --filter @sengoku-jidai/ai exec vitest run test/search2/hidden.test.ts` — expect FAIL (module missing).
- [ ] **Step 3: Implement** the four exports in `hidden.ts`.
- [ ] **Step 4: Run** — expect PASS.
- [ ] **Step 5: Commit** — `feat(ai): observation boundary with hidden-card placeholders`

---

### Task 3: Beliefs by counting

**Files:**
- Create: `packages/ai/src/search2/belief.ts`
- Test: `packages/ai/test/search2/belief.test.ts`

**Interfaces:**
- Consumes: `HIDDEN`, `isRealCard` (Task 2).
- Produces:
  - `export function unseenPool(state: GameState): Partial<Record<OperationCard, number>>` — the ruleset's full deck (`deckFor(state.rules.rulesetId)`) minus every **real** card visible anywhere in `state` (both hands, discard). Placeholders are ignored.
  - `export function holdProbability(state: GameState, holder: SeatId, card: OperationCard, absent: ReadonlySet<OperationCard>): number` — probability that `holder` has at least one `card` among their placeholders. Returns 1 if `holder`'s hand already contains the real card; 0 if `card` is in `absent`; otherwise `1 − C(U−c, n) / C(U, n)` where `n` = placeholders in `holder`'s hand, `c` = unseen copies of `card`, `U` = total of `unseenPool`.

- [ ] **Step 1: Write the failing tests**

```ts
// Rivers: 24 cards, 3 Ambush. Opponent holds n placeholders, nothing else seen.
const obs = (n: number, discard: OperationCard[] = []) => {
  const s = createInitialState({ gameId: "g", seed: "b" });
  s.players.red.hand = [];
  s.players.black.hand = Array(n).fill("mobilise"); // identities irrelevant after observe
  s.discard = discard;
  return observe(s, "red");
};
const none = new Set<OperationCard>();

it("matches the hypergeometric value", () => {
  // 1 − C(21,4)/C(24,4) = 1 − 5985/10626
  expect(holdProbability(obs(4), "black", "ambush", none)).toBeCloseTo(1 - 5985 / 10626, 10);
});
it("rises with hand size", () => {
  const p = [0, 1, 2, 3, 4].map((n) => holdProbability(obs(n), "black", "ambush", none));
  expect(p[0]).toBe(0);
  for (let i = 1; i < p.length; i++) expect(p[i]).toBeGreaterThan(p[i - 1]!);
});
it("is 0 once every copy is in the discard pile", () => {
  expect(holdProbability(obs(4, ["ambush", "ambush", "ambush"]), "black", "ambush", none)).toBe(0);
});
it("is 0 for a kind marked absent and 1 for a granted card", () => {
  expect(holdProbability(obs(4), "black", "ambush", new Set(["ambush"]))).toBe(0);
  expect(holdProbability(grantCard(obs(4), "black", "ambush")!, "black", "ambush", none)).toBe(1);
});
it("is 0 for a card that is not in this ruleset's deck", () => {
  expect(holdProbability(obs(4), "black", "take_cover", none)).toBe(0);
});
it("never returns NaN when the hand is larger than what is unseen", () => {
  const s = obs(4);
  s.discard = deckFor("rivers").slice(0, 22) as OperationCard[]; // 2 unseen, 4 placeholders
  const p = holdProbability(s, "black", "ambush", none);
  expect(Number.isNaN(p)).toBe(false);
  expect(p).toBeGreaterThanOrEqual(0);
  expect(p).toBeLessThanOrEqual(1);
});
```

- [ ] **Step 2: Run** `… vitest run test/search2/belief.test.ts` — expect FAIL.
- [ ] **Step 3: Implement.** Compute the ratio `C(U−c, n)/C(U, n)` as the product `∏_{i=0}^{n−1} (U−c−i)/(U−i)`, treating any non-positive factor as making the ratio 0 and clamping `n` to `U`.
- [ ] **Step 4: Run** — expect PASS.
- [ ] **Step 5: Commit** — `feat(ai): card-counting beliefs for the hidden hand`

---

### Task 4: Which card to spend, and the options object

**Files:**
- Create: `packages/ai/src/search2/cardRank.ts`, `packages/ai/src/search2/features.ts`
- Test: `packages/ai/test/search2/cardRank.test.ts`

**Interfaces:**
- Produces:
  - `export const CARD_KEEP_RANK: Record<string, number>` — higher means keep longer. Values: `ambush` 5, `take_cover` 5, `ship_strike` 3, `siege_assault` 3, `ground_assault` 3, `river_assault` 3, `commandeer` 3, `hidden` 3, `counterattack` 2, `mobilise` 2, `shore_strike` 2, `volley` 2.
  - `export function cardToSpend(hand: readonly OperationCard[]): OperationCard | null` — the lowest-ranked card, first-seen on ties; `null` for an empty hand.
  - In `features.ts`:

```ts
export interface Features {
  diceDistribution: boolean; // false → one outcome at the rounded mean total
  opponentAmbush: boolean;
  rerolls: boolean;
  rerollCap: number; // rethrows considered per battle
  takeCover: boolean;
  followUps: boolean; // Ship Strike / Siege Assault, both sides
  opponentDeployThreats: boolean;
}
export const DEFAULT_FEATURES: Features = {
  diceDistribution: true, opponentAmbush: true, rerolls: true, rerollCap: 2,
  takeCover: true, followUps: true, opponentDeployThreats: true
};
export interface ExpectiOptions {
  depth?: number; // fixed depth in deployments: deterministic, no deadline
  deadlineMs?: number; // default 5000
  maxDepth?: number; // default 20
  weights?: EvalWeights;
  features?: Partial<Features>;
}
```

- [ ] **Step 1: Write the failing tests**

```ts
it("spends the least useful card and keeps Ambush", () => {
  expect(cardToSpend(["ambush", "mobilise", "commandeer"])).toBe("mobilise");
  expect(cardToSpend(["ambush", HIDDEN])).toBe(HIDDEN);
  expect(cardToSpend(["ambush"])).toBe("ambush");
  expect(cardToSpend([])).toBeNull();
});
it("ranks every card of both decks", () => {
  for (const c of [...deckFor("rivers"), ...deckFor("fortress")]) {
    expect(CARD_KEEP_RANK[c]).toBeGreaterThan(0);
  }
});
```

- [ ] **Step 2: Run** `… vitest run test/search2/cardRank.test.ts` — expect FAIL.
- [ ] **Step 3: Implement** both files.
- [ ] **Step 4: Run** — expect PASS.
- [ ] **Step 5: Commit** — `feat(ai): card keep-ranking and search feature switches`

---

### Task 5: Battle resolver — dice and rerolls

**Files:**
- Create: `packages/ai/src/search2/battle.ts`
- Create: `packages/ai/test/search2/scenario.ts` (test support)
- Test: `packages/ai/test/search2/battle.test.ts`

**Interfaces:**
- Consumes: `rollTotalDistribution` (`../combatOdds.js`), `evaluate`, `cardToSpend`, `Features`, `HIDDEN`.
- Produces:

```ts
export interface BattleCtx {
  viewer: SeatId; // the seat the AI plays; decides whose cards are known
  weights: EvalWeights;
  features: Features;
}
export interface Outcome {
  prob: number;
  state: GameState; // the battle is resolved (this pendingCombat is gone)
  absent: ReadonlySet<OperationCard>; // kinds the opponent is assumed not to hold, from here on
}
export function battleOutcomes(
  state: GameState, // state.pendingCombat set, any phase
  absent: ReadonlySet<OperationCard>,
  ctx: BattleCtx
): Outcome[];
```

- Test support, `scenario.ts`:

```ts
/** An observed state (viewer = attacker "red") paused on an Advance: `attackers` troops moving
 *  into an enemy land holding `defenders`. Built by taking the first legal advance from a fresh
 *  game, rewriting the target to be black-owned with `defenders` troops and the chosen source to
 *  hold `attackers + 1`, issuing the advance from that single source, then applying the hands and
 *  discard and calling observe(). `viewer` may be set to "black" to test the defender's side. */
export function advanceScenario(o: {
  attackers: number; defenders: number;
  redHand?: OperationCard[]; blackHand?: OperationCard[]; discard?: OperationCard[];
  viewer?: SeatId; ruleset?: RulesConfig;
}): GameState;
/** Same idea for a strike: red's first legal bombard/shell/siege against `defenders` units. */
export function strikeScenario(o: {
  type: "bombard" | "shell" | "siege"; defenders: number;
  redHand?: OperationCard[]; blackHand?: OperationCard[]; discard?: OperationCard[];
  viewer?: SeatId; ruleset?: RulesConfig;
}): GameState;
```

**How the resolver works (the part the signature does not determine):**

- Dice in play at `awaiting-roll`: Advance/Sail `1`, plus `1` if the Advance targets a fort tile (`getMap(state.mapId).areas[pc.area]?.fort`); strikes `pc.dice`. At `rolled`, the number of dice is `pc.rolls.length` and the current total is `pc.total`.
- To apply a total: copy the state with `pendingCombat` set to `{ ...pc, phase: "rolled", total, rolls: [total] }` and send `combatResolve` from `pc.responsibleSeat` through `resolveCommand`. Never call `combatRoll` (it would touch the rng).
- With `features.diceDistribution` false, use the single total `expectedRollTotal(faces, nDice)` at probability 1.
- Rerolls (only if `features.rerolls`): after a total `t`, the roller compares `evaluate` (from the roller's seat) of keeping `t` against the probability-weighted `evaluate` of rethrowing with one card fewer. Rethrow wins only if strictly greater. The rethrow's outcome list does not depend on `t`, so compute it once per level. Stop at `features.rerollCap` rethrows or an empty hand. The card discarded is `cardToSpend(hand)` when the roller is `ctx.viewer`; when the roller is the opponent, a `HIDDEN` if they have one, else `cardToSpend(hand)`. Discarding means removing it from the hand and pushing it onto `discard`.
- Merge outcomes whose resulting `state.areas[pc.area]`, both hand lengths and `absent` set are equal, summing probabilities. Probabilities must sum to 1.
- `advanceScenario` should prefer a target tile with `valueStars > 0` when one is reachable, so that holding or taking it is worth more than a card and the reroll tests are meaningful.
- This task leaves Ambush and Take Cover out (Task 6): Advance uses the base dice; a siege that pauses in `awaiting-cover` is resolved by the defender accepting the damage (`combatResolve` with no card).

- [ ] **Step 1: Write `scenario.ts`**, then the failing tests in `battle.test.ts`

```ts
const ctx = (over: Partial<Features> = {}): BattleCtx => ({
  viewer: "red", weights: DEFAULT_WEIGHTS, features: { ...DEFAULT_FEATURES, ...over }
});
const none = new Set<OperationCard>();
const captureProb = (outs: Outcome[], area: string) =>
  outs.filter((o) => o.state.areas[area]!.owner === "red").reduce((p, o) => p + o.prob, 0);

it("probabilities sum to 1 and every outcome is resolved", () => {
  const s = advanceScenario({ attackers: 3, defenders: 1 });
  const outs = battleOutcomes(s, none, ctx());
  expect(outs.reduce((p, o) => p + o.prob, 0)).toBeCloseTo(1, 10);
  for (const o of outs) expect(o.state.pendingCombat?.id).not.toBe(s.pendingCombat!.id);
});

it("3 attackers on 1 defender with one die capture 5/6 of the time", () => {
  // faces 0,1,1,1,1,2: totals 0 and 1 leave ≥1 attacker after attrition; total 2 leaves none.
  const s = advanceScenario({ attackers: 3, defenders: 1 }); // black holds no cards
  expect(captureProb(battleOutcomes(s, none, ctx()), s.pendingCombat!.area)).toBeCloseTo(5 / 6, 10);
});

it("a defender holding cards rerolls a lost defence, lowering the capture odds", () => {
  const noCards = advanceScenario({ attackers: 3, defenders: 1 });
  const twoCards = advanceScenario({ attackers: 3, defenders: 1, blackHand: ["mobilise", "mobilise"] });
  const area = noCards.pendingCombat!.area;
  const f = { opponentAmbush: false };
  const p0 = captureProb(battleOutcomes(noCards, none, ctx(f)), area);
  const p2 = captureProb(battleOutcomes(twoCards, none, ctx(f)), area);
  expect(p2).toBeLessThan(p0);
  expect(captureProb(battleOutcomes(twoCards, none, ctx({ ...f, rerolls: false })), area)).toBeCloseTo(p0, 10);
});

it("with the dice distribution off there is a single outcome", () => {
  const s = advanceScenario({ attackers: 3, defenders: 1 });
  expect(battleOutcomes(s, none, ctx({ diceDistribution: false, rerolls: false }))).toHaveLength(1);
});

it("a strike's outcomes follow its dice count", () => {
  const s = strikeScenario({ type: "bombard", defenders: 3 });
  const outs = battleOutcomes(s, none, ctx({ rerolls: false }));
  expect(outs.reduce((p, o) => p + o.prob, 0)).toBeCloseTo(1, 10);
  expect(outs.length).toBeGreaterThan(1);
});

it("does not mutate its input", () => {
  const s = advanceScenario({ attackers: 3, defenders: 1, blackHand: ["mobilise"] });
  const before = structuredClone(s);
  battleOutcomes(s, none, ctx());
  expect(s).toEqual(before);
});
```

- [ ] **Step 2: Run** `… vitest run test/search2/battle.test.ts` — expect FAIL (module missing).
- [ ] **Step 3: Implement** `battleOutcomes` as described.
- [ ] **Step 4: Run** — expect PASS.
- [ ] **Step 5: Commit** — `feat(ai): battle resolver with exact dice odds and rerolls`

---

### Task 6: Battle resolver — Ambush, Take Cover, and the AI's own combat steps

**Files:**
- Modify: `packages/ai/src/search2/battle.ts`
- Test: `packages/ai/test/search2/battleCards.test.ts`

**Interfaces:**
- Consumes: `holdProbability`, `grantCard` (Tasks 2–3).
- Produces: `battleOutcomes` now models Ambush and Take Cover; and

```ts
/** The command for the seat on the clock in a pending combat (must be ctx.viewer). */
export function battleDecision(state: GameState, ctx: BattleCtx): Command;
```

**Rules:**

- **Ambush** applies to an Advance at `awaiting-roll`, defender = roller. Adds 2 dice; the card leaves the hand for the discard pile.
  - Defender is `ctx.viewer`: if the hand holds `ambush`, compare the expected `evaluate` (defender's seat) with and without; play only if strictly better.
  - Defender is the opponent and `features.opponentAmbush`: let `p = holdProbability(state, defender, "ambush", absent)`. Compute the with-Ambush outcome list on `grantCard(state, defender, "ambush")` with the card then spent. If playing is strictly better for the defender, the result is `p ×` the with-Ambush outcomes plus `(1 − p) ×` the without outcomes, the latter carrying `absent ∪ {ambush}`. If playing is not better, the result is the without outcomes, `absent` unchanged. Skip the branch when `p` is 0 or 1 accordingly.
- **Take Cover** applies to a siege whose `combatResolve` by the attacker leaves the state in `awaiting-cover` (the engine pauses whenever the defender's hand is non-empty and the total is positive). Same three cases as Ambush, with `take_cover`, `features.takeCover`, and the two options being `combatResolve` with and without `card: "take_cover"`.
- **`battleDecision`**, for the viewer:
  - `awaiting-roll`: `combatRoll` with `card: "ambush"` exactly when the Ambush rule above says play; otherwise plain `combatRoll`.
  - `rolled`: `combatReroll` with `card: cardToSpend(hand)` exactly when the reroll rule (Task 5) says rethrow, using `pc.rolls.length` dice; otherwise `combatResolve`. The reroll cap does not limit real rerolls: the AI may keep rerolling across successive calls while it is strictly better.
  - `awaiting-cover`: `combatResolve` with or without `card: "take_cover"`, whichever evaluates better.

- [ ] **Step 1: Write the failing tests**

```ts
it("an opponent who may hold Ambush lowers the capture odds as their hand grows", () => {
  const p = [0, 1, 2, 4].map((n) => {
    const s = advanceScenario({ attackers: 3, defenders: 1, blackHand: Array(n).fill("mobilise") });
    return captureProb(battleOutcomes(s, none, ctx({ rerolls: false })), s.pendingCombat!.area);
  });
  for (let i = 1; i < p.length; i++) expect(p[i]).toBeLessThan(p[i - 1]!);
});

it("matches the hand-computed mix for 4 cards", () => {
  // 3 attackers vs 1: capture needs total ≤ 1. One die: 5/6. Three dice: 13/216.
  const pHold = 1 - 5985 / 10626;
  const s = advanceScenario({ attackers: 3, defenders: 1, blackHand: Array(4).fill("mobilise") });
  const got = captureProb(battleOutcomes(s, none, ctx({ rerolls: false })), s.pendingCombat!.area);
  expect(got).toBeCloseTo(pHold * (13 / 216) + (1 - pHold) * (5 / 6), 10);
});

it("hand size stops mattering once all Ambushes are discarded (rerolls off)", () => {
  const gone: OperationCard[] = ["ambush", "ambush", "ambush"];
  const a = advanceScenario({ attackers: 3, defenders: 1, discard: gone });
  const b = advanceScenario({ attackers: 3, defenders: 1, discard: gone, blackHand: Array(4).fill("mobilise") });
  const f = ctx({ rerolls: false });
  expect(captureProb(battleOutcomes(b, none, f), b.pendingCombat!.area))
    .toBeCloseTo(captureProb(battleOutcomes(a, none, f), a.pendingCombat!.area), 10);
});

it("the no-Ambush branch marks Ambush absent; the Ambush branch spends a card", () => {
  const s = advanceScenario({ attackers: 3, defenders: 1, blackHand: Array(4).fill("mobilise") });
  const outs = battleOutcomes(s, none, ctx({ rerolls: false }));
  expect(outs.some((o) => o.absent.has("ambush") && o.state.players.black.hand.length === 4)).toBe(true);
  expect(outs.some((o) => !o.absent.has("ambush") && o.state.players.black.hand.length === 3
    && o.state.discard.includes("ambush"))).toBe(true);
});

it("as defender the AI plays its own Ambush when it saves the tile", () => {
  const s = advanceScenario({ attackers: 3, defenders: 1, blackHand: ["ambush"], viewer: "black" });
  expect(battleDecision(s, { ...ctx(), viewer: "black" }))
    .toEqual({ type: "combatRoll", pendingId: s.pendingCombat!.id, card: "ambush" });
});

it("rerolling spends the least useful card, never Ambush first", () => {
  const s = advanceScenario({ attackers: 3, defenders: 1, blackHand: ["ambush", "mobilise"], viewer: "black" });
  s.pendingCombat = { ...s.pendingCombat!, phase: "rolled", rolls: [0], total: 0 }; // a lost defence
  const cmd = battleDecision(s, { ...ctx(), viewer: "black" });
  expect(cmd).toEqual({ type: "combatReroll", pendingId: s.pendingCombat.id, card: "mobilise" });
});

it("a reroll after an Ambush roll is valued with three dice", () => {
  const s = advanceScenario({ attackers: 3, defenders: 1, blackHand: ["mobilise"], viewer: "black" });
  s.pendingCombat = { ...s.pendingCombat!, phase: "rolled", rolls: [1, 1, 0], total: 2 }; // defence already holds
  expect(battleDecision(s, { ...ctx(), viewer: "black" }).type).toBe("combatResolve");
});

it("answers a siege's Take Cover offer (Fortress)", () => {
  const s = strikeScenario({ type: "siege", defenders: 3, blackHand: ["take_cover"], viewer: "black", ruleset: fortressRuleset });
  s.pendingCombat = { ...s.pendingCombat!, phase: "awaiting-cover", responsibleSeat: "black", rolls: [2, 1], total: 3 };
  const cmd = battleDecision(s, { ...ctx(), viewer: "black" });
  expect(cmd.type).toBe("combatResolve");
  expect(resolveCommand(s, { seat: "black" }, cmd).status).toBe("accepted");
});
```

- [ ] **Step 2: Run** `… vitest run test/search2/battleCards.test.ts` — expect FAIL.
- [ ] **Step 3: Implement** the Ambush and Take Cover branches and `battleDecision`.
- [ ] **Step 4: Run both battle test files** — expect PASS.
- [ ] **Step 5: Commit** — `feat(ai): Ambush, Take Cover and live combat decisions in the battle resolver`

---

### Task 7: The look-ahead and `ExpectiBot`

**Files:**
- Create: `packages/ai/src/search2/search.ts`, `packages/ai/src/bots/expecti.ts`
- Modify: `packages/ai/src/index.ts` (export `ExpectiBot`, `chooseCommand` as `expectiCommand`, `observe`, `HIDDEN`, `ExpectiOptions`, `Features`, `DEFAULT_FEATURES`)
- Test: `packages/ai/test/search2/search.test.ts`, `packages/ai/test/search2/expectiGames.test.ts`

**Interfaces:**
- Consumes: everything from Tasks 2–6; `deployCandidates`, `moveArchetypes` (`../candidates.js`); `legalCommandsForState`, `resolveCommand`.
- Produces:

```ts
/** Value of `state` for ctx.viewer. `depth` counts deployments still to be searched. */
export function searchValue(
  state: GameState, absent: ReadonlySet<OperationCard>, depth: number,
  alpha: number, beta: number, ctx: SearchCtx
): number;
/** `threatDepth`: the `depth` value at which an opponent deploy step counts as "the immediate
 *  reply" (Task 8). The root sets it to d − 1 while searching depth d; −1 disables it. */
export interface SearchCtx extends BattleCtx { deadline: number; threatDepth: number }
/** Pick a command from an OBSERVED state (see observe()). */
export function chooseCommand(observed: GameState, seat: SeatId, opts?: ExpectiOptions): Command;

export class ExpectiBot implements Bot {
  constructor(opts?: ExpectiOptions);
  chooseCommand(state: GameState, seat: SeatId): Command; // = chooseCommand(observe(state, seat), seat, opts)
}
```

**Node rules for `searchValue`, in this order:**

1. Past the deadline (`deadline > 0 && Date.now() >= deadline`): throw the module's `SearchTimeout`.
2. `state.status !== "active"`: return `evaluate(state, viewer, weights)`.
3. `state.pendingCombat` set — a chance step, at any depth: return `Σ prob × searchValue(outcome.state, outcome.absent, depth, −∞, +∞, ctx)` over `battleOutcomes`. Depth is not consumed.
4. `state.pendingDecision` set — a choice for `pendingDecision.seat`, at any depth, depth not consumed. Options: every `choosePendingDecision` choice; and, for a `siegeAssault` decision, the advances `moveArchetypes(state, seat, legal.siegeAssault, "siege_assault")`. With `features.followUps` false, take only `decline` when it exists. The viewer maximises; the opponent minimises.
5. `depth <= 0`: return `evaluate`.
6. Deploy step for `state.activeSeat`: children are `deployCandidates(state, mover)` applied with `resolveCommand` (skip rejected ones), ordered best-first for the mover by `evaluate` of the child; recurse with `depth − 1`; alpha-beta prune. No candidates → `evaluate`.

**`chooseCommand` at the root:**

- Pending combat on the viewer → `battleDecision`.
- Pending decision on the viewer → the option with the best `searchValue` at depth 0 (ties: first).
- Otherwise the deploy step with iterative deepening `d = 1, 2, …` up to `maxDepth` until the deadline (`deadlineMs`, default 5000); keep the best command of the deepest **completed** depth. With `opts.depth` set, search exactly that depth with no deadline.
- If even depth 1 times out, return the candidate with the best static `evaluate` of its child (the greedy choice). One candidate → return it without searching. Not on the clock or no candidates → `{ type: "pass" }`.

- [ ] **Step 1: Write the failing tests** in `search.test.ts`

```ts
const opening = (seed: string) => createInitialState({ gameId: "g", seed });

it("returns an engine-accepted command from the opening", () => {
  const s = opening("x1");
  const cmd = new ExpectiBot({ depth: 2 }).chooseCommand(s, s.activeSeat);
  expect(resolveCommand(s, { seat: s.activeSeat }, cmd).status).toBe("accepted");
});

it("is a pure function of the observation at fixed depth", () => {
  const s = opening("x2");
  const bot = new ExpectiBot({ depth: 2 });
  expect(bot.chooseCommand(s, s.activeSeat)).toEqual(bot.chooseCommand(s, s.activeSeat));
});

it("ignores hidden information (fairness)", () => {
  for (const seed of ["f1", "f2", "f3", "f4"]) {
    const a = stateAfterGreedyPlies(seed, 12); // helper: play 12 greedy commands from the opening
    const seat = onTheClock(a)!;
    const enemy = other(seat);
    const b = structuredClone(a);
    const pool = [...b.players[enemy].hand, ...b.deck]; // reshuffle the unseen cards
    pool.reverse();
    b.players[enemy].hand = pool.slice(0, a.players[enemy].hand.length);
    b.deck = pool.slice(a.players[enemy].hand.length);
    b.rngState = createRngState("different");
    const bot = new ExpectiBot({ depth: 2 });
    expect(bot.chooseCommand(b, seat)).toEqual(bot.chooseCommand(a, seat));
  }
});

it("still answers when the deadline is too short for depth 1", () => {
  const s = opening("x3");
  const cmd = new ExpectiBot({ deadlineMs: 0 }).chooseCommand(s, s.activeSeat);
  expect(resolveCommand(s, { seat: s.activeSeat }, cmd).status).toBe("accepted");
});

it("respects its deadline", () => {
  const s = stateAfterGreedyPlies("x4", 12);
  const t = Date.now();
  new ExpectiBot({ deadlineMs: 300 }).chooseCommand(s, onTheClock(s)!);
  expect(Date.now() - t).toBeLessThan(300 + 400); // budget plus a margin for one node
});

it("never emits a hidden card", () => {
  const s = advanceScenarioRaw({ attackers: 3, defenders: 1, blackHand: ["mobilise"], rolled: [0] });
  // black is on the clock in `rolled`; raw = not observed, as the bot receives it
  const cmd = new ExpectiBot({ depth: 1 }).chooseCommand(s, "black");
  expect(JSON.stringify(cmd)).not.toContain("hidden");
});
```

Add `stateAfterGreedyPlies(seed, plies, rules?)` and `advanceScenarioRaw` (the un-observed form of `advanceScenario`, with an optional `rolled` total list that puts the combat in the `rolled` phase) to `scenario.ts`.

- [ ] **Step 2: Write the failing tests** in `expectiGames.test.ts`

```ts
it.each([["rivers", undefined], ["fortress", fortressRuleset]] as const)(
  "plays whole %s games against random and greedy without an illegal command",
  (_name, rules) => {
    for (const seed of ["g1", "g2", "g3"]) {
      for (const foe of [new RandomBot(createAiRng(5)), new GreedyBot()]) {
        const r = runMatch(new ExpectiBot({ depth: 1 }), foe, { seed, rules }); // throws on illegal
        expect(r.commands).toBeGreaterThan(0);
        runMatch(foe, new ExpectiBot({ depth: 1 }), { seed, rules });
      }
    }
  },
  120_000
);

it("walks through several battles queued by one Commandeer", () => {
  // Review Focus 1. Build: red holds commandeer and can embark into two black seas at once.
  const s = commandeerTwoBattlesScenario(); // add to scenario.ts: returns a state where red's
  // commandeer embark with placements in two enemy seas is legal, and that command.
  const after = resolveCommand(s.state, { seat: "red" }, s.command);
  expect(after.status).toBe("accepted");
  if (after.status !== "accepted") return;
  let cur = after.nextState;
  const bots = { red: new ExpectiBot({ depth: 1 }), black: new ExpectiBot({ depth: 1 }) };
  for (let i = 0; i < 50 && (cur.pendingCombat || cur.pendingDecision); i++) {
    const seat = onTheClock(cur)!;
    const r = resolveCommand(cur, { seat }, bots[seat].chooseCommand(cur, seat));
    expect(r.status).toBe("accepted");
    if (r.status !== "accepted") return;
    cur = r.nextState;
  }
  expect(cur.pendingCombat).toBeNull();
  expect(cur.combatQueue).toHaveLength(0);
});

it.skipIf(!process.env.AI_STRENGTH_TESTS)(
  "depth-2 expecti beats the greedy baseline over a seeded series",
  () => {
    const res = runMatches(new ExpectiBot({ depth: 2 }), new GreedyBot(), {
      seeds: ["s1", "s2", "s3", "s4", "s5", "s6"]
    });
    expect(res.aWins).toBeGreaterThanOrEqual(9); // of 12
  },
  600_000
);
```

- [ ] **Step 3: Run** `… vitest run test/search2/search.test.ts test/search2/expectiGames.test.ts` — expect FAIL.
- [ ] **Step 4: Implement** `search.ts` and `bots/expecti.ts`, and the exports.
- [ ] **Step 5: Run** the two files — expect PASS. Then `AI_STRENGTH_TESTS=1 corepack pnpm --filter @sengoku-jidai/ai exec vitest run test/search2/expectiGames.test.ts` — expect PASS; if the greedy gate fails, stop and report the score rather than weakening it.
- [ ] **Step 6: Commit** — `feat(ai): ExpectiBot — look-ahead over choices, battles and hidden cards`

---

### Task 8: Opponent card threats — follow-ups and deploy-time cards

**Files:**
- Modify: `packages/ai/src/search2/search.ts`
- Test: `packages/ai/test/search2/threats.test.ts`

**Interfaces:**
- Consumes: `grantCard`, `holdProbability`, `SearchCtx.threatDepth`.
- Produces: no new exports; `searchValue`'s deploy step changes for the opponent.

**Rules (opponent deploy step only; the viewer's own cards are already real and already searched):**

- **Follow-ups** (`features.followUps`): when the opponent's candidate is a `shell` (Rivers) or `siege` (Fortress), let `card` be `ship_strike` or `siege_assault` and `p = holdProbability(state, mover, card, absent)`. If `p > 0`, the candidate's value is `(1 − p) × V(plain) + p × V(granted)`, where `V(granted)` applies the same command to `grantCard(state, mover, card)` — the engine then raises the follow-up decision by itself and rule 4 of Task 7 handles it.
- **Deploy-time threats** (`features.opponentDeployThreats`), applied only at an opponent deploy step whose `depth === ctx.threatDepth`: let `v0` be the step's ordinary minimised value. For each kind `k` in `ground_assault`, `river_assault`, `mobilise`, `commandeer`, `counterattack`, `shore_strike`, `volley` with `p_k = holdProbability(…) > 0`: on `grantCard(state, mover, k)`, take the candidates of `deployCandidates` that carry `card: k`, and let `v_k` be their minimised value (skip the kind if there are none). The step's value is `max( min_k v_k , v0 − Σ_k p_k × max(0, v0 − v_k) )`.
- Both are skipped for the viewer's own steps and when the mover's hand has no `HIDDEN`.

- [ ] **Step 1: Write the failing tests**

```ts
// opponentToMove(seed, enemyHand): a raw state on a clean deploy turn, plus `viewer` = the seat
// NOT on the clock, with the mover's hand replaced by `enemyHand`.
// ctxFor(viewer, features?) builds a SearchCtx with deadline 0 and threatDepth 1.
const value = (seed: string, n: number, features?: Partial<Features>) => {
  const { state, viewer } = opponentToMove(seed, Array(n).fill("mobilise"));
  return searchValue(observe(state, viewer), new Set(), 1, -Infinity, Infinity, ctxFor(viewer, features));
};
const seeds = ["t1", "t2", "t3", "t4"];

it("possible opponent cards can only lower the position's value", () => {
  for (const seed of seeds) {
    expect(value(seed, 4)).toBeLessThanOrEqual(
      value(seed, 4, { opponentDeployThreats: false, followUps: false }) + 1e-9
    );
  }
});

it("they lower it strictly somewhere", () => {
  expect(seeds.some((seed) =>
    value(seed, 4) < value(seed, 4, { opponentDeployThreats: false, followUps: false }) - 1e-9
  )).toBe(true);
});

it("an opponent with no cards poses no card threat", () => {
  for (const seed of seeds) {
    expect(value(seed, 0)).toBeCloseTo(value(seed, 0, { opponentDeployThreats: false, followUps: false }), 9);
  }
});

it("the value never drops below the worst single threat", () => {
  for (const seed of seeds) {
    const { state, viewer } = opponentToMove(seed, Array(6).fill("mobilise"));
    const worst = worstSingleThreatValue(observe(state, viewer), viewer); // min over kinds of v_k, each kind granted outright
    expect(value(seed, 6, { followUps: false })).toBeGreaterThanOrEqual(worst - 1e-9);
  }
});
```

Add `opponentToMove`, `ctxFor` and `worstSingleThreatValue` to `scenario.ts`.

- [ ] **Step 2: Run** `… vitest run test/search2/threats.test.ts` — expect FAIL.
- [ ] **Step 3: Implement** the two rules.
- [ ] **Step 4: Run** the whole `test/search2` folder — expect PASS (Task 7's fairness and full-game tests must still pass).
- [ ] **Step 5: Commit** — `feat(ai): weigh the opponent's possible follow-up and deploy-time cards`

---

### Task 9: Trap positions (spec §9.2)

**Files:**
- Test: `packages/ai/test/search2/traps.test.ts`

**Interfaces:**
- Consumes: `advanceScenarioRaw`-style builders, `ExpectiBot`, `battleOutcomes`. Move the `ctx()` and `captureProb()` helpers from `battle.test.ts` into `scenario.ts` and import them in both places.

These tests pin the behaviour the project exists for. They need a position _before_ the attack is launched, so add to `scenario.ts`:

```ts
/** A raw (un-observed) deploy position for red in which the only interesting choice is one
 *  Advance of `attackers` troops into a black land holding `defenders`, worth `stars` VP.
 *  Returns the state and that advance command. */
export function attackChoiceScenario(o: {
  attackers: number; defenders: number; blackHand: OperationCard[]; discard?: OperationCard[];
}): { state: GameState; attack: Command };
```

- [ ] **Step 1: Write the tests**

```ts
const hand = (n: number): OperationCard[] => Array(n).fill("mobilise");
const attacks = (cmd: Command, attack: Command) => JSON.stringify(cmd) === JSON.stringify(attack);
const grid = [2, 3, 4, 5].flatMap((a) => [1, 2, 3].filter((d) => d < a).map((d) => ({ a, d })));

it("there is an attack it makes against an empty hand and declines against four cards", () => {
  const bot = new ExpectiBot({ depth: 2 });
  const flips = grid.filter(({ a, d }) => {
    const empty = attackChoiceScenario({ attackers: a, defenders: d, blackHand: [] });
    const full = attackChoiceScenario({ attackers: a, defenders: d, blackHand: hand(4) });
    return attacks(bot.chooseCommand(empty.state, "red"), empty.attack)
      && !attacks(bot.chooseCommand(full.state, "red"), full.attack);
  });
  expect(flips.length).toBeGreaterThan(0);
});

it("it never does the reverse: attack into four cards but not into none", () => {
  const bot = new ExpectiBot({ depth: 2 });
  for (const { a, d } of grid) {
    const empty = attackChoiceScenario({ attackers: a, defenders: d, blackHand: [] });
    const full = attackChoiceScenario({ attackers: a, defenders: d, blackHand: hand(4) });
    if (attacks(bot.chooseCommand(full.state, "red"), full.attack)) {
      expect(attacks(bot.chooseCommand(empty.state, "red"), empty.attack)).toBe(true);
    }
  }
});

it("the old bot attacks regardless of hand size (the bug this project fixes)", () => {
  const old = new AlphaBetaBot({ depth: 2 });
  for (const { a, d } of grid) {
    const empty = attackChoiceScenario({ attackers: a, defenders: d, blackHand: [] });
    const full = attackChoiceScenario({ attackers: a, defenders: d, blackHand: hand(4) });
    expect(attacks(old.chooseCommand(full.state, "red"), full.attack))
      .toBe(attacks(old.chooseCommand(empty.state, "red"), empty.attack));
  }
});

it("with every Ambush discarded and rerolls off, four cards no longer deter", () => {
  const gone: OperationCard[] = ["ambush", "ambush", "ambush"];
  const bot = new ExpectiBot({ depth: 2, features: { rerolls: false, opponentDeployThreats: false } });
  for (const { a, d } of grid) {
    const empty = attackChoiceScenario({ attackers: a, defenders: d, blackHand: [], discard: gone });
    const full = attackChoiceScenario({ attackers: a, defenders: d, blackHand: hand(4), discard: gone });
    expect(attacks(bot.chooseCommand(full.state, "red"), full.attack))
      .toBe(attacks(bot.chooseCommand(empty.state, "red"), empty.attack));
  }
});

it("values a safe attack above a risky one with the same average roll", () => {
  // Same expected total, different spread: 4 attackers vs 2 (needs total ≤ 1: 5/6)
  // against the single mean roll the old search uses (total 1 → capture, always).
  const s = advanceScenario({ attackers: 4, defenders: 2 });
  const exact = battleOutcomes(s, new Set(), ctx({ rerolls: false }));
  const mean = battleOutcomes(s, new Set(), ctx({ rerolls: false, diceDistribution: false }));
  const ev = (o: Outcome[]) => o.reduce((v, x) => v + x.prob * evaluate(x.state, "red"), 0);
  expect(ev(exact)).toBeLessThan(ev(mean));
});
```

- [ ] **Step 2: Run** `… vitest run test/search2/traps.test.ts`. Expected: PASS if Tasks 5–8 are right. The third test documents the old bot; if it fails because the old bot _does_ react to hand size somewhere in the grid, delete that grid cell from the assertion and note it in the commit message. If the first test fails, do not edit the grid to force it: report which cells were tried and each side's chosen commands.
- [ ] **Step 3: Commit** — `test(ai): trap positions — attacks priced by the opponent's hand`

---

### Task 10: Trapper bot and the duel script

**Files:**
- Create: `packages/ai/src/bots/trapper.ts`, `packages/ai/src/botRegistry.ts`, `packages/ai/scripts/duel.ts`
- Modify: `packages/ai/src/index.ts`, `packages/ai/package.json` (script `"duel": "tsx scripts/duel.ts"`)
- Test: `packages/ai/test/trapper.test.ts`, `packages/ai/test/botRegistry.test.ts`

**Interfaces:**
- Produces:
  - `export class TrapperBot implements Bot { constructor(opts?: AlphaBetaOptions) }` — the old alpha-beta bot with three overrides: (a) on a clean deploy turn in rounds 1–2 with fewer than 3 cards in hand and a legal Plan, it takes the first Plan; (b) defending an Advance at `awaiting-roll` while holding `ambush`, it always rolls with Ambush; (c) when the old `combatResponse` would reroll by discarding `ambush`, it discards its first non-Ambush card instead, or resolves if it has none.
  - `export function parseBotSpec(spec: string): { name: string; make: () => Bot }` — grammar `name[:key=value[,key=value…]]`. Names: `expecti`, `alphabeta`, `trapper`, `greedy`, `random`. Keys: `ms` (deadline), `depth`, `off` (`+`-separated `Features` switches to turn off, `expecti` only), `rerollCap`, `seed` (`random` only). Unknown names or keys throw with the offending token in the message.
  - CLI: `corepack pnpm --filter @sengoku-jidai/ai duel -- --a <spec> --b <spec> --seeds <n> [--seed-prefix <s>] [--ruleset rivers|fortress] [--jobs <n>] [--json <path>]`. Each of the `n` seeds is played twice with sides swapped. Prints: wins / draws / losses for A; A's win rate over decisive games with a 95% Wilson interval; average VP margin (A − B); average and worst milliseconds per command for each bot; both specs. `--jobs` splits the seed list across child processes; the mechanism is the builder's choice, but for fixed-depth bots the totals must equal the `--jobs 1` totals.

- [ ] **Step 1: Write the failing tests**

```ts
// trapper.test.ts
it("always ambushes when defending with an Ambush in hand", () => {
  const s = advanceScenarioRaw({ attackers: 5, defenders: 1, blackHand: ["ambush"] });
  expect(new TrapperBot({ depth: 1 }).chooseCommand(s, "black"))
    .toEqual({ type: "combatRoll", pendingId: s.pendingCombat!.id, card: "ambush" });
});
it("never discards Ambush to reroll", () => {
  const s = advanceScenarioRaw({ attackers: 3, defenders: 1, blackHand: ["ambush"], rolled: [0] });
  expect(new TrapperBot({ depth: 1 }).chooseCommand(s, "black").type).toBe("combatResolve");
});
it("plans early to build a hand", () => {
  const s = createInitialState({ gameId: "g", seed: "tr" });
  expect(new TrapperBot({ depth: 1 }).chooseCommand(s, s.activeSeat).type).toBe("plan");
});
it("plays whole games legally", () => {
  runMatch(new TrapperBot({ depth: 1 }), new GreedyBot(), { seed: "tr-1" });
  runMatch(new GreedyBot(), new TrapperBot({ depth: 1 }), { seed: "tr-1" });
});

// botRegistry.test.ts
it("builds bots from specs", () => {
  expect(parseBotSpec("expecti:depth=2,off=rerolls+opponentAmbush").make()).toBeInstanceOf(ExpectiBot);
  expect(parseBotSpec("alphabeta:ms=1500").make()).toBeInstanceOf(AlphaBetaBot);
  expect(parseBotSpec("trapper").make()).toBeInstanceOf(TrapperBot);
});
it("rejects unknown names and keys", () => {
  expect(() => parseBotSpec("nope")).toThrow(/nope/);
  expect(() => parseBotSpec("expecti:off=telepathy")).toThrow(/telepathy/);
});
```

- [ ] **Step 2: Run** `… vitest run test/trapper.test.ts test/botRegistry.test.ts` — expect FAIL.
- [ ] **Step 3: Implement** `trapper.ts`, `botRegistry.ts`, the exports and `duel.ts`.
- [ ] **Step 4: Run** the two test files — expect PASS. Then smoke the CLI: `corepack pnpm --filter @sengoku-jidai/ai duel -- --a expecti:depth=1 --b greedy --seeds 2` prints a 4-game result; and again with `--jobs 2` prints identical win/draw/loss counts.
- [ ] **Step 5: Commit** — `feat(ai): trapper sparring bot and duel series runner`

---

### Task 11: Worker thread runner

**Files:**
- Create: `packages/ai/src/expecti.worker.ts`, `packages/ai/src/expectiWorkerRunner.ts`
- Modify: `packages/ai/src/index.ts`
- Test: `packages/server/test/expectiWorker.test.ts` (beside the existing `ismctsWorker.test.ts`, which shows how worker tests are set up against the built `dist`)

**Interfaces:**
- Produces: `export function runExpectiInWorker(observed: GameState, seat: SeatId, opts: ExpectiOptions): Promise<Command>` — mirrors `runAlphaBetaInWorker` (fresh worker per call, terminate on reply, reject on error or early exit, ship `getMap(observed.mapId)` so the worker can `registerMap` it). The worker calls `chooseCommand(observed, seat, opts)` from `search2/search.ts`. **The caller observes; the worker never receives an un-observed state.**

- [ ] **Step 1: Write the failing tests**

```ts
it("returns the same command as an in-process search", async () => {
  const s = createInitialState({ gameId: "g", seed: "w1" });
  const o = observe(s, s.activeSeat);
  const viaWorker = await runExpectiInWorker(o, s.activeSeat, { depth: 2 });
  expect(viaWorker).toEqual(expectiCommand(o, s.activeSeat, { depth: 2 }));
});

it("works on a custom map the worker has never seen", async () => {
  // Review Focus 5. Follow alphabetaWorkerCustomMap.test.ts in packages/ai/test for how a custom
  // map is compiled and registered in the main thread only.
  const s = createInitialState({ gameId: "g", seed: "w2", mapId: registerCustomTestMap() });
  const cmd = await runExpectiInWorker(observe(s, s.activeSeat), s.activeSeat, { depth: 1 });
  expect(resolveCommand(s, { seat: s.activeSeat }, cmd).status).toBe("accepted");
});
```

- [ ] **Step 2: Build and run** `corepack pnpm --filter @sengoku-jidai/ai build && corepack pnpm --filter @sengoku-jidai/server exec vitest run test/expectiWorker.test.ts` — expect FAIL (export missing).
- [ ] **Step 3: Implement** the worker and runner; export the runner.
- [ ] **Step 4: Build and run** the same command — expect PASS.
- [ ] **Step 5: Commit** — `feat(ai): worker-thread runner for ExpectiBot`

---

### Task 12: Per-game thinking time

**Files:**
- Modify: `packages/shared/src/schemas.ts`
- Create: `packages/server/migrations/010_ai_think_ms.sql`
- Modify: `packages/server/src/persistence/database.ts`, `packages/server/src/persistence/repository.ts`, `packages/server/src/config.ts`, `packages/server/src/api/routes.ts`
- Modify: `packages/web/src/components/CreateGameScreen.tsx`, `packages/web/src/client/api.ts`, `packages/web/src/App.tsx`
- Test: `packages/shared` schema test file (beside the existing ones), `packages/server/test/aiThinkTime.test.ts`, `packages/web/test/createGameThinkTime.test.tsx` (or the existing create-screen test if one exists)

**Interfaces:**
- Produces:
  - shared: `export const AI_THINK_TIMES = ["quick", "normal", "long"] as const; export type AiThinkTime = (typeof AI_THINK_TIMES)[number]; export const AI_THINK_MS: Record<AiThinkTime, number> = { quick: 1500, normal: 5000, long: 10000 }; export const DEFAULT_AI_THINK_TIME: AiThinkTime = "normal";` and `createGameRequestSchema` gains `aiThinkTime: z.enum(AI_THINK_TIMES).optional()`.
  - server migration: `ALTER TABLE games ADD COLUMN ai_think_ms INTEGER;` (NULL means default), appended to the `migrations` list in `database.ts`.
  - repository: `createGame(mode, seed, opts)` accepts `opts.aiThinkMs?: number` and stores it only when the game has an AI seat; `aiThinkMsOf(gameId: string): number | null`.
  - config: `aiMaxThinkMs` from env `AI_MAX_THINK_MS`, default `10000`, integer ≥ 100.
  - routes: `export function resolveThinkMs(stored: number | null, maxMs: number): number` — `min(maxMs, stored)` when `stored` is a finite number ≥ 100, else `min(maxMs, AI_THINK_MS.normal)`. The default `aiPickCommandFor(gameId)` reads `repository.aiThinkMsOf(gameId)` per command and passes `deadlineMs: resolveThinkMs(...)` to the bot runner. **The bot stays `runAlphaBetaInWorker` in this task** (the switch is Task 13).
  - web: when Opponent is "Computer (AI)", the create screen shows a fieldset with legend `AI thinking time` and three toggle buttons labelled `Quick (1.5 s)`, `Normal (5 s)`, `Long (10 s)`, styled like the Opponent toggle, `Normal` selected by default; hidden for a human opponent. `onCreate` gains a fifth argument `aiThinkTime: AiThinkTime`; `createGame` in `client/api.ts` sends `aiThinkTime` only when `opponent === "ai"`.

- [ ] **Step 1: Write the failing tests**

```ts
// shared
it("accepts the three thinking times and rejects others", () => {
  for (const t of ["quick", "normal", "long"]) {
    expect(createGameRequestSchema.safeParse({ opponent: "ai", aiThinkTime: t }).success).toBe(true);
  }
  expect(createGameRequestSchema.safeParse({ aiThinkTime: "forever" }).success).toBe(false);
  expect(AI_THINK_MS).toEqual({ quick: 1500, normal: 5000, long: 10000 });
});

// server/test/aiThinkTime.test.ts
it("stores the chosen thinking time with an AI game", () => {
  const repo = makeTestRepository(); // as repository.test.ts does
  const g = repo.createGame("private_multiplayer", "s", { creatorName: "M", creatorSide: "red", aiSeats: ["black"], aiThinkMs: 10000 });
  expect(repo.aiThinkMsOf(g.gameId)).toBe(10000);
});
it("games without a stored value fall back to Normal, and values are clamped", () => {
  expect(resolveThinkMs(null, 10000)).toBe(5000);
  expect(resolveThinkMs(10000, 3000)).toBe(3000);
  expect(resolveThinkMs(5, 10000)).toBe(5000);
  expect(resolveThinkMs(Number.NaN, 10000)).toBe(5000);
});
it("a database created before the column exists gains it without losing games", () => {
  // Follow terrainMigration.test.ts: open a DB with migrations 001–009 applied and one game row,
  // re-open through the normal initialiser, then:
  expect(repo.aiThinkMsOf(existingGameId)).toBeNull();
  expect(repo.currentState(existingGameId)).toBeDefined();
});
it("POST /api/games passes the preset through to the AI's deadline", async () => {
  // buildApp with an aiPickCommandFor spy is NOT enough (it replaces the default); instead assert
  // on repo.aiThinkMsOf after POST { opponent: "ai", aiThinkTime: "quick" } → 1500.
});

// web
it("offers thinking time only for a computer opponent and defaults to Normal", () => {
  render(<CreateGameScreen busy={false} error={null} onCreate={onCreate} />);
  expect(screen.queryByText("AI thinking time")).toBeNull();
  fireEvent.click(screen.getByText("Computer (AI)"));
  expect(screen.getByRole("button", { name: "Normal (5 s)" })).toHaveAttribute("aria-pressed", "true");
  fireEvent.click(screen.getByRole("button", { name: "Long (10 s)" }));
  // fill the name, submit, then:
  expect(onCreate).toHaveBeenCalledWith(expect.any(String), expect.any(String), expect.any(String), "ai", "long");
});
```

If `packages/web` has no component-rendering test setup (check `packages/web/test` and its vitest config for a DOM environment), do not add one: move the web assertions into a pure helper test (`thinkTimeOptions()` returning the three `{ value, label }` pairs in order, and the request body built by `createGame`) and say so in the commit message.

- [ ] **Step 2: Run** each package's new test file — expect FAIL.
- [ ] **Step 3: Implement** shared, then server, then web.
- [ ] **Step 4: Run** `corepack pnpm test` (all packages) — expect PASS. Run `corepack pnpm test:e2e` since the create screen changed — expect PASS.
- [ ] **Step 5: Commit** — `feat: per-game AI thinking time (Quick 1.5 s / Normal 5 s / Long 10 s)`

---

### Task 13: Measure, report, and (only if the bars are met) go live

**Files:**
- Create: `docs/superpowers/results/2026-11-ai-rebuild-search-duels.md`
- Modify (conditional): `packages/server/src/api/routes.ts`, `packages/server/test/aiGame.test.ts`

**Interfaces:**
- Consumes: the `duel` CLI (Task 10), `runExpectiInWorker` + `observe` (Tasks 2, 11), `resolveThinkMs` (Task 12).

- [ ] **Step 1: Run the acceptance series** (spec §9.1), saving each `--json`. Use `--jobs` equal to the machine's physical cores minus one, and nothing else heavy running, since both bots are on a wall-clock budget.

```bash
corepack pnpm --filter @sengoku-jidai/ai duel -- --a expecti:ms=1500 --b alphabeta:ms=1500 --seeds 100 --ruleset rivers   --seed-prefix acc-r  --json rivers.json
corepack pnpm --filter @sengoku-jidai/ai duel -- --a expecti:ms=1500 --b alphabeta:ms=1500 --seeds 50  --ruleset fortress --seed-prefix acc-f  --json fortress.json
corepack pnpm --filter @sengoku-jidai/ai duel -- --a expecti:ms=1500 --b trapper:ms=1500   --seeds 50  --ruleset rivers   --seed-prefix acc-t  --json trapper.json
corepack pnpm --filter @sengoku-jidai/ai duel -- --a expecti:ms=5000 --b alphabeta:ms=5000 --seeds 20  --ruleset rivers   --seed-prefix acc-n  --json normal.json
```

Bars: Rivers ≥ 55% of decisive games **and** interval lower bound > 50%; Fortress ≥ 50%; Trapper ≥ 55%; Normal-budget ≥ 50%.

- [ ] **Step 2: Run one ablation per feature switch** at 40 mirrored games each (`--seeds 20`, `ms=1500`, Rivers, versus `alphabeta:ms=1500`), with `off=` set to each of `diceDistribution`, `opponentAmbush`, `rerolls`, `takeCover+followUps`, `opponentDeployThreats` in turn.
- [ ] **Step 3: Write the results file**: one table for the four acceptance series (W/D/L, win rate, interval, VP margin, ms per command, pass or fail against its bar) and one for the ablations (win rate with the feature off, next to the full bot's). State plainly whether every bar was met.
- [ ] **Step 4: Commit** — `docs(ai): duel results for the search rebuild`
- [ ] **Step 5: Stop and report to the owner.** If any bar is missed, do not continue: present the tables and the options from spec §9.5.
- [ ] **Step 6 (only when every bar is met and the owner agrees): switch the server.** In `routes.ts`, the default `aiPickCommandFor` becomes `runExpectiInWorker(observe(state, seat), seat, { deadlineMs: resolveThinkMs(...) })` inside the existing `withRetry`. Add to `aiGame.test.ts`:

```ts
it("the default AI plays a game through the server with the new bot", async () => {
  // buildApp(testConfig()) with NO aiPickCommandFor override; create { opponent: "ai", aiThinkTime: "quick" }
  // against a test config whose aiMaxThinkMs is 200; submit one legal human command; poll until the
  // human is on the clock again; expect the revision to have advanced and no error logged.
});
```

- [ ] **Step 7: Run** `corepack pnpm typecheck && corepack pnpm test && corepack pnpm lint && corepack pnpm exec prettier --check . && corepack pnpm build`, then `docker build -t sengoku-jidai-web:test .` if Docker is available (the worker file must be present in the image's `packages/ai/dist`).
- [ ] **Step 8: Commit** — `feat(server): play AI seats with ExpectiBot`
