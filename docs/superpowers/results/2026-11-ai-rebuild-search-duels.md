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
