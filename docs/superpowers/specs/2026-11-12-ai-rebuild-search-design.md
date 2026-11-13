# AI Rebuild, Part 1: A Search That Understands Dice and Cards — Design Spec

_Date: 2026-11-12_

## 1. Intent

The current AI opponent (`AlphaBetaBot`) can be surprised by an Ambush no matter how many
cards its opponent holds. The cause is structural, not a tuning problem. Inside its look-ahead:

- every battle is settled by a fixed rule in which nobody plays Ambush, nobody rerolls, and
  Ship Strike / Siege Assault / Take Cover are always declined (`heuristics.ts` `resolvePending`);
- every battle lands on the single rounded-mean roll (`expectedCombat`), so a coin-flip attack
  and a near-certain one look alike;
- cards are valued only by count (`card · √hand`), so an Ambush is worth the same as any card
  and the opponent's hand size never makes an attack look riskier;
- it is handed the full `GameState`, including the opponent's real hand and the deck order;
- its real combat-time card play (`combatResponse`) is a separate one-step rule that the
  look-ahead knows nothing about.

This project replaces the search core with one that treats dice as a probability distribution,
reasons about hidden cards by counting, plans its own card play inside the same look-ahead, and
only ever sees what its seat is entitled to see.

This is part 1 of three agreed projects. Part 2 measures and tunes the scoring function against
game outcomes. Part 3 revisits raw speed (including a possible Rust port) with profiling data.

## 2. Goals

1. **Card-aware.** The value of an attack depends on the probability that the defender holds an
   Ambush and on how many rerolls the roller can afford. More cards in the opponent's hand must
   make marginal attacks less attractive.
2. **Dice-aware.** Battles branch over their actual outcomes with exact probabilities.
3. **Fair.** The AI decides from its seat's information only: the board, its own hand, the
   opponent's hand _size_, and the whole discard pile (owner's decision: everything spent,
   including cards discarded to reroll, counts as known).
4. **Stronger than the old bot** head-to-head at equal thinking time (§9).
5. **Not exploitable by card traps**, shown by fixed test positions and a sparring bot (§9).
6. **Adjustable thinking time**, chosen per game at creation (owner's decision).
7. Works for both rulesets (Rivers and Fortress) and for custom maps.

## 3. Non-goals

- Changing the scoring function's weights or shape. Part 1 keeps `evaluate` and
  `DEFAULT_WEIGHTS` so old-versus-new measures the search alone. (One small addition: a
  card-kind ranking used only to pick _which_ card to spend, §6.4.)
- Rust, WebAssembly, or any second implementation of the rules.
- Inferring the opponent's hand from their behaviour ("they didn't Ambush last time"). Beliefs
  come from counting only.
- Difficulty levels or personalities.
- Showing the discard pile in the web UI. (Worth a small follow-up so a human has the same
  information the AI now counts with; not part of this project.)
- Removing the old bots. `AlphaBetaBot`, `GreedyBot`, `RandomBot` and `IsmctsBot` stay in the
  repo as sparring partners and baselines.

## 4. Anti-goals

The project has failed, even if the win rate looks good, if any of these is true:

- the AI's choice changes when only hidden information changes (opponent hand identities, deck
  order);
- it ever emits a command the engine rejects;
- it overruns its thinking budget by more than a small margin;
- its fixed-depth behaviour is not reproducible (same input, different move).

## 5. Constraints

- Package boundaries from `AGENTS.md`: `packages/ai` stays pure and deterministic (wall-clock
  only for the deadline, as today); the engine is not given AI-specific concepts beyond what
  already exists.
- The engine's `GameState` must stay JSON-compatible; do not add a "hidden card" sentinel to the
  engine's `OperationCard` union.
- Search runs in a worker thread so it never blocks the server's event loop, and the worker must
  register the game's map before searching (see the existing alpha-beta worker and PR #137).
- Persisting the per-game thinking time must not reset or migrate away existing SQLite data;
  games created before this change behave as "Normal".
- Dice faces, round count, commander count and the deck come from `state.rules` / `deckFor`,
  never hard-coded.

## 6. The design

New code lives beside the old in `packages/ai/src` (suggested: a `search2/` folder plus
`bots/expecti.ts`); nothing in the old search is modified except the harness fix in §8.

### 6.1 Information boundary

One function, `observe(state, seat)`, is the only code that touches a full `GameState`. It
produces an **observation**: everything public, the seat's own hand, the opponent's hand
_count_, and the **unseen pool** — the ruleset's full deck minus the seat's hand minus the
discard pile, as a count per card kind. The opponent's hand identities and the deck order are
not in it.

- The server calls `observe` _before_ handing work to the worker, so hidden information never
  crosses that boundary.
- For harness compatibility the new bot still implements `Bot.chooseCommand(state, seat)`; its
  first act is `observe`, and nothing after that may read the original state.
- How the search represents "a hand of n unknown cards" in its working states is the builder's
  call. The contract is the fairness test in §9.3.

### 6.2 Beliefs by counting

The opponent's `n` cards are a uniform random draw from the unseen pool of `U` cards. With `c`
unseen copies of a kind, the chance they hold at least one is `1 − C(U−c, n) / C(U, n)`.

Along one line of look-ahead the belief is updated by what that line assumes: a card the
opponent is assumed to play leaves their hand and the pool; a card they are assumed _not_ to
hold (the branch where no Ambush came) is treated as absent for the rest of that line.

### 6.3 The battle resolver

Each battle is a small chance process with a few decisions in it: dice are thrown, the defender
may add Ambush dice, the roller may discard a card to rethrow, a sieged defender may Take Cover.
The resolver computes it exactly and returns a short list of _(probability, resulting state)_
pairs, merged wherever two paths give the same result (an Advance's result is fully described
by attackers left and defenders left, so the list is short).

Rules it applies:

- **Dice:** exact distribution of the total for the number of dice in play
  (`rollTotalDistribution` already does this), including the fort die.
- **Ambush, defender is the AI:** it holds the card or it doesn't; it plays it when that gives
  the better expected result.
- **Ambush, defender is the opponent:** with the counted probability they hold one. If they
  hold it, they play it whenever it improves their expected result. So an Advance is valued as
  "p × (three dice, if that's better for them) + (1 − p) × one die".
- **Rerolls:** any card can be discarded to rethrow, so the opponent's reroll budget is public
  (their hand count) and needs no guessing. After each throw the roller keeps or rethrows,
  whichever is better for them, counting the card as a cost. Cap the rethrows considered per
  battle (default 2) to bound the work.
- **Take Cover (Fortress):** same treatment as Ambush, for the sieged defender.
- **Results are applied through the engine** (force the total, then `combatResolve`, as
  `expectedResolveValue` does today) so captures, caps, HQ elimination and the turn tail stay
  the engine's job.

Decisions _inside_ the resolver (play Ambush? rethrow?) are judged with the scoring function on
the resulting board. Using deeper search there is allowed if the builder finds it affordable.

Follow-up offers after a battle — **Ship Strike** and **Siege Assault** — are real choices in
the tree for the AI's own side (take it or decline). For the opponent they are weighted by the
counted probability of holding the card.

Priority if scope must be trimmed: dice, Ambush and rerolls are essential; Take Cover, Ship
Strike and Siege Assault follow.

### 6.4 The look-ahead

Depth-limited search, iterative deepening against the deadline, depth counted in commander
deployments (as today). Three kinds of step:

- **The AI chooses:** take the best option.
- **The opponent chooses:** take the option worst for the AI.
- **Chance:** a battle; take the probability-weighted average over the resolver's results.

Candidate moves come from the existing `deployCandidates` / `moveArchetypes`, including the
AI's own deploy-time card plays.

**Opponent deploy-time cards** (Ground/River Assault, Mobilise, Commandeer, Counterattack,
Shore Strike, Volley) are modelled as probability-weighted threats: at an opponent step,
compute the value without cards, then for each kind they might hold, the value if they had it,
and pull the step's value toward the threat in proportion to the probability of holding it
(never beyond the worst single threat). This is an approximation and is expensive, so by
default apply it only to the opponent's immediate reply.

**Which card to spend.** When the AI discards to reroll, it spends its least useful card. That
needs an ordering of card kinds — a small hand-set table (defensive surprise cards such as
Ambush and Take Cover ranked highest). This is the builder's call for now and a tuning target
in part 2. The scoring function's total card term is unchanged.

**The AI's real combat steps** (roll with or without Ambush, rethrow or accept, take a
follow-up) are chosen by the same resolver and tree — there is no separate combat rule set
beside the search any more.

**Keeping it affordable.** Branching on dice makes each step costlier than in the old search.
Pruning at choice steps still applies; at chance steps the builder may bound or drop
low-probability results (renormalising) and should avoid recomputing identical positions.

**Every modelling feature has an off switch** (dice distribution, opponent Ambush, rerolls,
opponent deploy-time threats, follow-ups) so the harness can measure what each one is worth and
drop any that costs more depth than it earns.

### 6.5 Thinking time

- At game creation, when the opponent is the AI, the player picks **Quick (1.5 s)**,
  **Normal (5 s, default)** or **Long (10 s)** per AI command (owner's decision).
- The choice is stored with the game and survives restarts. The server clamps it to a
  configured maximum.
- Touches: create screen (`packages/web`), create-game schema (`packages/shared`), game storage
  and AI dispatch (`packages/server`).

### 6.6 Going live

The server keeps using `AlphaBetaBot` until the bars in §9 are met. Then the default switches
to the new bot in one small change; the old bot remains selectable in the harness.

## 7. What is already decided, and by whom

Owner's decisions:

- Rebuild the search rather than patch it; keep the old AI to compete against.
- It must both beat the old bot and stop being exploitable through card play.
- It plays fair.
- The whole discard pile counts as known.
- Thinking time is adjustable, per game, at creation: Quick 1.5 s, Normal 5 s (default),
  Long 10 s.
- TypeScript now; Rust is deferred to part 3.
- Order of projects: search, then scoring function, then speed.

Designer's calls (open to challenge):

- Exact calculation with chance steps rather than Monte Carlo sampling.
- The AI receives an observation, enforced at the worker boundary.
- Uniform counting beliefs; no behavioural inference.
- Reroll cap of 2 per battle inside the look-ahead.
- Opponent deploy-time cards as weighted threats, immediate reply only.
- The acceptance bars in §9, measured at the Quick budget to keep the series affordable.

## 8. Harness

- **Fix:** `runMatches` counts a draw as a win for bot B. Report wins, draws and losses
  separately.
- **Duel script** (`packages/ai/scripts/duel.ts`): two bots by name, a time budget or fixed
  depth, a number of seeds, a ruleset. Each seed is played twice with sides swapped. Output:
  wins / draws / losses, win rate with a 95% confidence interval, average VP margin, average
  and worst thinking time per command, and the feature switches in effect.
- **Trapper bot:** the old alpha-beta bot with a card-trap habit — it draws cards early, never
  discards Ambush to reroll, and always Ambushes when it can. A stand-in for the human exploit.
- The old bots keep receiving the full state, exactly as they do in production today. The new
  bot is expected to win despite that.

## 9. Acceptance

### 9.1 Stronger

At equal thinking time, mirrored seeds. The main series run at the Quick budget (1.5 s per
command); the duel script should run games in parallel, since a few hundred games at this
budget is hours of thinking if played one after another.

- Rivers, 200 games versus `AlphaBetaBot`: new bot wins at least 55% of decisive games, and the
  lower end of the 95% interval is above 50%.
- Fortress, 100 games versus `AlphaBetaBot`: at least 50%.
- Rivers, 100 games versus the Trapper bot: at least 55%.
- Confirmation at the Normal budget (5 s): Rivers, 40 games versus `AlphaBetaBot`, at least
  50% — a check that the advantage does not vanish when both bots get more time.

### 9.2 Not exploitable — fixed positions

Fast deterministic tests on constructed positions:

- The same marginal Advance is valued strictly lower as the opponent's hand grows from 0 to 4
  cards (Ambushes unseen), and there is a position where it is chosen at 0 cards and declined
  at 4.
- With all Ambushes in the discard pile, the opponent's hand size no longer deters that attack
  (beyond the reroll effect).
- Of two attacks with the same average result, the one with the safer spread is preferred when
  failure is costly.
- Holding an Ambush, the AI keeps it in preference to a less useful card when discarding to
  reroll.

### 9.3 Fair

For a set of positions, replacing the opponent's hand with a different same-sized draw from the
unseen pool and reshuffling the deck leaves the chosen command unchanged at fixed depth.

### 9.4 Well-behaved

- Fixed-depth choice is a pure function of the observation.
- Every command in every harness game is accepted by the engine.
- Thinking time per command stays within budget plus a small margin, in the worker.

### 9.5 If the strength bar is missed

Do not switch the server over. Use the feature switches to find what costs more than it earns,
report the numbers, and decide with the owner whether to trim modelling, raise the default
thinking time, or bring part 3 (speed) forward.

## 10. Left to the builder

- Internal representation of unknown hands and of beliefs.
- Pruning details at chance steps and any caching.
- File and type names.
- Where per-game thinking time is persisted, within the constraint in §5.
- Whether the resolver's internal decisions use the scoring function alone or a shallow search.

## 11. Implementation notes (2026-11-13)

Where the build departed from the plain reading above, and why. Each is behind a switch.

- **Battles are folded by default, not fully expanded (§6.4 "chance").** Searching every outcome
  of every battle multiplies the tree by the number of outcomes. At equal depth that played
  better; at equal time it reached one or two plies less and lost about two games in three to
  the old bot. By default the search now follows a battle's most likely outcome and adds the
  exact expected static value of all outcomes minus that outcome's own. Dice and cards are still
  priced exactly at every battle; only what happens _after_ a deep battle is approximated.
  `fullBattles=N` expands the first N battles on a line fully.
- **Opponent deploy-time cards are a static penalty (§6.4).** For each kind they might hold:
  probability of holding it × how much their best play of it beats their best card-free option,
  both judged one deployment deep, capped at the worst single threat. Searching every such play
  to full depth cost nine times everything else combined.
- **Hidden cards are placeholders inside an ordinary game state (§6.1).** `observe()` replaces
  every card the seat cannot see with a `"hidden"` value that exists only in the AI package. The
  engine's own rules then enforce fairness: a placeholder hand offers no card plays.
- **The Trapper bot turned out to be a weak sparring partner (§8).** Spending early commanders on
  Plans costs it more than its Ambush habit gains; the old bot beats it about as often as the
  new one does. It does not tell the two apart. The trap _positions_ (§9.2) do.
