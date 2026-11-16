# AI search rebuild: duel results (2026-11-13)

Branch `ai-rebuild-search` at `39828d6`. Every series plays each seed twice with the seats
swapped, on one machine with 7 games in parallel. "Win rate" is the new bot's share of decisive
games, with a 95% Wilson interval. "VP margin" is the new bot's victory points minus the
opponent's, averaged per game. No game was drawn.

Spec: `docs/superpowers/specs/2026-11-12-ai-rebuild-search-design.md` (bars in §9).

## Acceptance series

| Series                         | Opponent          | Games | W–L    | Win rate | 95% interval  | VP margin | New bot ms (avg / worst) | Bar                                 | Result   |
| ------------------------------ | ----------------- | ----- | ------ | -------- | ------------- | --------- | ------------------------ | ----------------------------------- | -------- |
| Rivers, Quick (1.5 s)          | `alphabeta` 1.5 s | 200   | 97–103 | 48.5%    | 41.7% – 55.4% | −0.78     | 823 / 1523               | ≥ 55% and interval lower bound > 50% | **Miss** |
| Fortress, Quick (1.5 s)        | `alphabeta` 1.5 s | 100   | 54–46  | 54.0%    | 44.3% – 63.4% | −0.09     | 830 / 1506               | ≥ 50%                               | Pass     |
| Rivers vs Trapper, Quick 1.5 s | `trapper` 1.5 s   | 100   | 73–27  | 73.0%    | 63.6% – 80.7% | +1.50     | 851 / 1516               | ≥ 55%                               | Pass     |
| Rivers, Normal (5 s)           | `alphabeta` 5 s   | 40    | 20–20  | 50.0%    | 35.2% – 64.8% | −0.23     | 2635 / 5018              | ≥ 50%                               | Pass     |

The headline bar is missed. At equal thinking time the new bot is level with the old one, not
ahead of it: 48.5% over 200 Rivers games, with an interval that comfortably includes 50%. Per
spec §9.5 the server therefore stays on the old bot until the owner decides.

The Trapper pass says little on its own. Trapper is a weak sparring partner; in an earlier
depth-3 check the old bot beat it 78.5% of the time and the new bot 81.0%.

## Ablations

Each row is the new bot with one piece of modelling switched off, against `alphabeta` at 1.5 s
on the same 20 Rivers seeds (40 games, seed prefix `abl`).

| New bot configuration                         | W–L   | Win rate | 95% interval  | VP margin |
| --------------------------------------------- | ----- | -------- | ------------- | --------- |
| Everything on (as shipped)                    | 16–24 | 40.0%    | 26.3% – 55.4% | −1.90     |
| Dice distribution off (mean roll only)        | 20–20 | 50.0%    | 35.2% – 64.8% | +0.03     |
| Opponent Ambush off                           | 12–28 | 30.0%    | 18.1% – 45.4% | −2.27     |
| Rerolls off                                   | 15–25 | 37.5%    | 24.2% – 53.0% | −1.80     |
| Take Cover and follow-ups off                 | 11–29 | 27.5%    | 16.1% – 42.8% | −2.52     |
| Opponent deploy-time card threats off         | 19–21 | 47.5%    | 32.9% – 62.5% | −1.23     |
| First battle on a line fully expanded (not folded) | 17–23 | 42.5%    | 28.5% – 57.8% | −0.75     |

Forty games is too few to rank these: every interval overlaps every other, and the full
configuration scored 40.0% on these seeds against 48.5% on the 200-game series. The only
readings worth carrying forward are directional:

- Switching off opponent Ambush, or Take Cover and follow-ups, never helped. The card modelling
  is not what costs strength.
- Switching off the dice distribution or the deploy-time threat penalty did not hurt and may
  help. Both are candidates for a larger test.

## Follow-up: the two candidates at 200 games

Option 2 below was chosen. Each candidate played the same 100 Rivers seeds as the acceptance
series (prefix `acc-r`, 200 games) against `alphabeta` at 1.5 s.

| New bot configuration                 | W–L     | Win rate | 95% interval  | VP margin |
| ------------------------------------- | ------- | -------- | ------------- | --------- |
| Everything on (acceptance series)     | 97–103  | 48.5%    | 41.7% – 55.4% | −0.78     |
| Dice distribution off                 | 95–105  | 47.5%    | 40.7% – 54.4% | +0.07     |
| Opponent deploy-time card threats off | 104–96  | 52.0%    | 45.1% – 58.8% | −0.46     |
| Both off                              | 100–100 | 50.0%    | 43.1% – 56.9% | +0.23     |

Neither candidate clears the bar, and neither is distinguishable from the full configuration:
all four sit within a few games of 50%. The 40-game hints were noise. No setting of the
existing switches makes the new bot stronger than the old one at equal thinking time.

## Follow-up: ten times the thinking time

To check how much search depth decides games, one side got 15 s a move against the old bot at
1.5 s (first 50 `acc-r` Rivers seeds, 100 games each).

| 15 s side   | 1.5 s side  | W–L   | Win rate | 95% interval  | VP margin |
| ----------- | ----------- | ----- | -------- | ------------- | --------- |
| `expecti`   | `alphabeta` | 57–43 | 57.0%    | 47.2% – 66.3% | −0.09     |
| `alphabeta` | `alphabeta` | 64–36 | 64.0%    | 54.2% – 72.7% | +1.25     |

Ten times the time is worth roughly 14 points to the old bot and roughly 8 to the new one. The
two are not statistically distinguishable at 100 games, but the new bot shows no sign of using
extra time better than the old one, and time alone is a slow route to strength for both.

## What the rebuild does deliver

- Fair play: the bot is given only what a player at that seat could see.
- Trap resistance, pinned by tests in `packages/ai/test/search2/traps.test.ts`: in fixed
  positions the old bot attacks whatever the defender's hand size; the new bot backs off thin
  attacks as the hand grows and still commits overwhelming ones.
- Equal head-to-head strength at Quick and Normal thinking time on both rulesets.

## Options (spec §9.5)

1. Ship as is. Level head-to-head, fair, and no longer walks into Ambush. Misses the "beats the
   old bot" goal.
2. Test the two candidates from the ablations (mean roll in deep battles, no deploy-threat
   penalty) on 200 games each and keep whichever clears the bar.
3. Move to project 2 (measure and tune the scoring function) first. Both bots share that
   function, so a better one lifts both, and the new bot's extra modelling has more to work with.
4. Bring the speed work forward. Depth is decisive in this game (old bot at depth 3 beats itself
   at depth 2 by 35–13), and the new bot spends its time on chance and card branches.

## Follow-up: scoring weights fitted to outcomes (2026-11-14)

2,000 Rivers games between the two search bots (all four pairings, depth 3) were recorded
position by position with `packages/ai/scripts/evalstudy.ts`. Findings on the hand-set scoring
function:

- 69% of games ended on points, 31% by HQ elimination. Against each other the new bot won 235
  games by HQ and 259 on points; the old bot 103 by HQ and 403 on points.
- The side the function favoured went on to win 60% of the time in round 1, 65% in round 3 and
  73% in round 4. The round-1 initiative holder alone won about 60%.
- A per-round logistic regression on simple counts predicted better at every stage (AUC 0.690 →
  0.731, cross-validated by game). It valued cards, commanders still to deploy, and closeness to
  the enemy HQ far more than the hand-set weights, and stars far less early than late.

Those fitted weights are `TUNED_WEIGHTS` in `packages/ai/src/eval.ts` (bot option
`weights=tuned`). The hand-set weights remain the default.

### Fixed depth 3, Rivers, 200 games each

| A                | B                  | W–L    | A win rate |
| ---------------- | ------------------ | ------ | ---------- |
| `alphabeta` tuned | `alphabeta`        | 135–65 | 67.5%      |
| `expecti` tuned  | `expecti`          | 127–73 | 63.5%      |
| `expecti` tuned  | `alphabeta` tuned  | 115–85 | 57.5%      |
| `expecti` tuned  | `alphabeta`        | 146–54 | 73.0%      |
| `alphabeta` tuned | `expecti`          | 142–58 | 71.0%      |
| `expecti`        | `alphabeta`        | 96–104 | 48.0%      |

Against the sparring bots (no cycle: tuned does at least as well as untuned against each):

| A                 | vs `trapper` depth 3 | vs `greedy` |
| ----------------- | -------------------- | ----------- |
| `alphabeta`       | 156–44               | 176–24      |
| `alphabeta` tuned | 170–30               | 190–10      |
| `expecti`         | 156–44               | 178–22      |
| `expecti` tuned   | 157–43               | 190–10      |

### Equal thinking time, 1.5 s

| A               | B                 | Ruleset  | Games | W–L    | A win rate | 95% interval  |
| --------------- | ----------------- | -------- | ----- | ------ | ---------- | ------------- |
| `expecti` tuned | `alphabeta`       | Rivers   | 200   | 141–59 | 70.5%      | 63.8% – 76.4% |
| `expecti` tuned | `alphabeta`       | Fortress | 100   | 77–23  | 77.0%      | 67.8% – 84.2% |
| `expecti` tuned | `alphabeta` tuned | Rivers   | 200   | 90–110 | 45.0%      | 38.3% – 51.9% |

The tuned new bot clears the spec's bars against the deployed bot on both rulesets. The gain
comes from the weights: the old search with the same weights is level with the new one at equal
time. Only the new search reacts to the opponent's hand size in the trap positions (4v1, 4v2 and
5v3 attacks are declined as the defender's hand grows; the old search attacks regardless), a
weakness no bot in the pool exploits.

## Follow-up: playtests by agents without source access (2026-11-14)

Two fresh agents, given only the play skill and the rulebook summary, each played a best of
three (red, black, red; Normal 5 s) against one blind-labelled opponent. Weights were the first
fitted round.

| Opponent                        | Bot's result | Agent's rating |
| ------------------------------- | ------------ | -------------- |
| Deployed bot (`alphabeta`)      | Won 3–0      | 7 / 10         |
| `expecti` with first-round weights | Won 2–1   | 6.5 / 10       |

Both bots were ambushed (old: a 4v3 attack into one held card; new: 6v4 into one card and 7v5
into two), and neither agent saw signs of play around a hand of one or two cards. The battle
model puts a margin-2 attack at 83% / 71% / 61% / 38% to capture against 0 / 1 / 2 / 4 hidden
cards, so the 7v5 attack was a known 60/40 gamble, not a miscount. Weaknesses both agents
reported: stripping the own HQ to one troop, supply links and garrisons held by one unit, all-in
attacks, low-value card use. Strengths: HQ kills over a sea bridge, supply cuts, immediate
refills, bombard timing.

## Follow-up: more scoring ingredients, and two more fitting rounds (2026-11-15)

Counts for the reported weaknesses (tiles held by one unit, stars and units lost to the worst
single supply cut, HQ garrison and enemy units next to it) were logged by `evalstudy.ts` and
added to the regression. They added nothing: winner prediction stayed at 67.6% (67.6–67.8% with
them). Bots do not punish these weaknesses beyond their look-ahead, so bot games cannot teach
their price. They were left out of the scoring function.

The weights were refitted twice on fresh games played by the previous round's bots (2,000 games
each, the last fit on all 6,000). Each round against the one before, fixed depth 3, 200 games:

| Round            | `alphabeta` | `expecti` |
| ---------------- | ----------- | --------- |
| Second vs first  | 130–70      | 118–82    |
| Third vs second  | 122–78      | 107–93    |

The third round is `weights=tuned`; the earlier ones stay as `tuned1` and `tuned2`.

### Third-round weights against the pool, fixed depth 3, Rivers, 200 games each

| A                 | B                  | W–L     | A win rate |
| ----------------- | ------------------ | ------- | ---------- |
| `alphabeta` tuned | `alphabeta`        | 164–36  | 82.0%      |
| `alphabeta` tuned | `alphabeta` tuned1 | 122–78  | 61.0%      |
| `expecti` tuned   | `expecti`          | 166–34  | 83.0%      |
| `expecti` tuned   | `expecti` tuned1   | 124–76  | 62.0%      |
| `expecti` tuned   | `alphabeta` tuned  | 88–112  | 44.0%      |
| `alphabeta` tuned | `trapper` depth 3  | 180–20  | 90.0%      |
| `alphabeta` tuned | `greedy`           | 194–6   | 97.0%      |
| `expecti` tuned   | `trapper` depth 3  | 182–18  | 91.0%      |
| `expecti` tuned   | `greedy`           | 194–6   | 97.0%      |

No cycle: the third round beats the hand-set weights by more than the first round did (82–83%
against 64–68%), beats the first round directly, and does better against both sparring bots
(first round: 157–170 of 200 against Trapper, 190 against Greedy).

### Equal thinking time, 1.5 s, third-round weights

| A                 | B                 | Ruleset  | Games | W–L     | A win rate | 95% interval  |
| ----------------- | ----------------- | -------- | ----- | ------- | ---------- | ------------- |
| `expecti` tuned   | `alphabeta`       | Rivers   | 200   | 165–35  | 82.5%      | 76.6% – 87.1% |
| `alphabeta` tuned | `alphabeta`       | Rivers   | 200   | 158–42  | 79.0%      | 72.8% – 84.1% |
| `expecti` tuned   | `alphabeta` tuned | Rivers   | 200   | 99–101  | 49.5%      | 42.6% – 56.4% |
| `expecti` tuned   | `alphabeta`       | Fortress | 100   | 78–22   | 78.0%      | 68.9% – 85.0% |
| `alphabeta` tuned | `alphabeta`       | Fortress | 100   | 83–17   | 83.0%      | 74.5% – 89.1% |

Against the deployed bot the tuned new bot now wins about four games in five on both rulesets.
All of that comes from the weights: with the same weights the two searches are level at equal
time, and at a fixed depth of 3 the old search is slightly ahead.

### Second playtest by agents without source access (2026-11-15)

Same setup as the first, with fresh agents and the third-round weights on the new bot.

| Opponent                           | First playtest       | Second playtest      |
| ---------------------------------- | -------------------- | -------------------- |
| Deployed bot (`alphabeta`)         | Bot won 3–0, 7 / 10  | Bot lost 1–2, 5 / 10 |
| `expecti` with fitted weights      | Bot won 2–1, 6.5 / 10 | Bot won 2–1, 7 / 10 |

The deployed bot did not change between the two, so three games per opponent is a noisy
measure; the agent that beat it reported well above average dice in both wins. All three bot
losses in this playtest were HQ kills by bombardment from the sea while the bot was level or
ahead on points. Both agents named the same main flaw: the HQ is left at one to three troops and
defended only against a kill available on the very next action. The new bot parried more of
these threats (shelling or cutting off the threatening fleet) but still lost one game to it.

Card play: the deployed bot attacked 7v5 into two held cards and 4v3 at sea into one. The new
bot attacked 4v2 into a hand of five cards and 5v5 into two (the latter a forced HQ parry); its
7v3 attack into three cards survived an Ambush. The new bot never took initiative with a Plan
order in three games, which matches the fitted initiative weight of about zero.

## Follow-up: search speed-ups, a second map, and the server switch (2026-11-16)

Three changes to the new search and the engine under it:

- **Order memory.** Replies that refuted a sibling line, and the best reply from the previous
  deepening pass, are tried first. Exact: the choice is unchanged, only the time.
- **Uneven depth.** In nodes with three or more plies left, options after the third that start no
  battle are searched one ply shallower first and re-searched at full depth only if they beat
  the bound. Not exact; measured below.
- **Cheaper copying and scoring.** The engine copies `areas` and `actionSpaces` by their known
  shape instead of through JSON, and the fitted scoring walks the map once for both seats.

Total search time over 16 benchmark positions (`scripts/bench2.ts`):

| Version                         | Depth 4  | Depth 5 | Depth 6  |
| ------------------------------- | -------- | ------- | -------- |
| Before                          | 8113 ms  |         |          |
| Exact (order memory, fast copy) | 2567 ms  |         |          |
| With uneven depth               | 1464 ms  | 5820 ms | 27723 ms |

### 1.5 s per move, Rivers, 200 games each

| A               | B                              | W–L     | A win rate | 95% interval  |
| --------------- | ------------------------------ | ------- | ---------- | ------------- |
| `expecti` tuned | same, both additions off       | 116–84  | 58.0%      | 51.1% – 64.6% |
| `expecti` tuned | same, uneven depth off         | 110–90  | 55.0%      | 48.1% – 61.7% |
| `reduceAfter=2` | `expecti` tuned (default 3)    | 89–111  | 44.5%      | 37.8% – 51.4% |
| `reduceFrom=2`  | `expecti` tuned (default 3)    | 103–97  | 51.5%      | 44.6% – 58.3% |
| `expecti` tuned | `alphabeta` tuned              | 102–98  | 51.0%      | 44.1% – 57.8% |
| `expecti` tuned | `alphabeta` (deployed)         | 156–44  | 78.0%      | 71.8% – 83.2% |

The engine speed-up helps the old search as much as the new one, so with the same weights the
two searches are still level. Neither more aggressive uneven-depth setting helped; the defaults
stay at 3 and 3.

### Does it hold on a map the weights were not fitted on?

The scoring function is feature-based (stars held, bonuses by type, graph distance to the enemy
HQ, units next to it, cards, commanders left, initiative, with weights per round); nothing in it
names a Rivers tile. The weights, however, were fitted on Rivers games only. To check that they
carry over, `scripts/testMap.ts` builds "River Disc": 37 single-hex tiles, a river of five sea
tiles across the middle, an HQ at each end, mirrored through the centre.

| A               | B                      | Map / ruleset      | Time  | Games | W–L    | A win rate | 95% interval  |
| --------------- | ---------------------- | ------------------ | ----- | ----- | ------ | ---------- | ------------- |
| `expecti` tuned | `alphabeta` (deployed) | River Disc         | 1.5 s | 200   | 114–86 | 57.0%      | 50.1% – 63.7% |
| `expecti` tuned | `expecti` hand-set     | River Disc         | 1.5 s | 200   | 128–72 | 64.0%      | 57.1% – 70.3% |
| `expecti` tuned | `alphabeta` (deployed) | Rivers / Fortress  | 1.5 s | 100   | 81–19  | 81.0%      | 72.2% – 87.5% |
| `expecti` tuned | `alphabeta` (deployed) | Rivers             | 5 s   | 60    | 46–14  | 76.7%      | 64.6% – 85.6% |

The fitted weights beat the hand-set ones on the unseen map too, so they are used on every map.
The margin over the deployed bot is much smaller there than on Rivers (57% against 78%), and it
is one synthetic map: custom maps with very different shapes are untested.

### Server default

The server now uses the new search with the fitted weights unless told otherwise. To go back
without a deploy of new code, set `AI_BOT=alphabeta` and `AI_WEIGHTS=default`.

Known weaknesses carried over, from the playtests: the HQ is defended only against a kill on the
very next action, and the bot rarely takes initiative with a Plan order.
