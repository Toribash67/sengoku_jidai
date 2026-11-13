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
