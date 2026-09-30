# Sengoku Jidai — Rules Primer (engine-accurate)

Two seats, red and black. Terms: an area is **land** (holds troops) or **sea** (holds ships).
You **control** an area when you have units in it. It becomes neutral when its last unit is removed.
A die has faces `0,1,1,1,1,2`, so the average is 1 per die.

## 1. Goal & game end

- **HQ elimination (checked after every command):** if you have no units in your own HQ, you lose
  immediately. If both HQs fall at once, the initiative holder wins.
- **Round limit:** after the recall of round `maxRounds` (Rivers: 4), score VP. Your VP = the sum of
  `valueStars` (0–2) on every area you **supply** (land or sea). Areas you control but do not supply
  score 0. Nothing is scored before the final round.
- **Ties** go to the initiative holder at that moment (a Plan taken in the final round counts).

## 2. Round structure

- **Deploy phase.** Each seat has N commanders per round (Rivers: 5; a map can override this).
  The initiative holder acts first, then the seats alternate. Each turn spends one commander in one
  of three ways: deploy it to a free action space and resolve that action at once, play
  Counterattack, or **pass** (the commander goes to standby for the rest of the round). Passing
  does not end your round: you still act on later turns while you have commanders.
- Round 1 initiative is random.
- **Recall:** when both seats have 0 commanders left, all spaces clear and all commanders return.
  The next round starts with the current initiative holder.
- **Initiative:** deploying to the initiative Plan space (`plan-a`) makes you the initiative holder
  immediately. This sets who acts first next round and breaks ties.
- **Cards:** you gain cards only through Plan. The shared deck has 24 cards (3 of each kind) and is
  never reshuffled. There is no hand limit. Hands are hidden; your opponent sees only your card count.

## 3. Action spaces

Each space holds one commander per round (the only exception is Counterattack).

- **Linked spaces:** every land area has an Advance space. Every sea area has a Sail space and a
  Bombard space. Shellable land areas also have a Shell space.
- **Support spaces:** `reinforce-a` (6), `reinforce-b` (5), `embark-a` (3), `embark-b` (2),
  `plan-a` (initiative, draw 1) and `plan-b` (draw 2). Each seat may use at most **one space of each
  support type per round**.
- **Advance** (into the linked land). The target must not be yours. Move troops in from land areas
  you supply that are either adjacent to the target or adjacent to a sea you supply that borders the
  target (a sea bridge). You may use several sources, but each source must keep ≥1 troop. If the
  target is empty or neutral, you capture it with no combat. If the enemy holds it, combat follows.
  You can never move troops into land you already control.
- **Sail** (into the linked sea). The target must not be yours. Ships come from seas you supply
  that connect to the target through an unbroken chain of seas you supply. Each source keeps ≥1
  ship. A neutral sea is captured. An enemy sea triggers combat.
- **Bombard** (from the linked sea, which you must supply). Pick one adjacent enemy-held land.
  You roll 1 die per ship in the linked sea (+1 with Pirate Haven, +2 with Shore Strike). The
  target loses troops equal to the **pip total**.
- **Shell** (from the linked land, which you must supply). Pick one adjacent enemy-held sea. You
  roll 2 dice, and the target loses ships equal to the pip total.
- **Reinforce:** take troops from your reserve and split them among any land you supply. The total
  is at most the space amount (+2 with Barracks, +2 with Mobilise) and at most your reserve.
- **Embark:** take ships from your reserve and split them among seas you supply, plus any sea
  reached by a port of a harbor land you supply, as long as the enemy does not hold that sea. The
  total is at most the space amount (+1 with Commandeer) and at most your reserve.
- **Plan:** draw 1 card (`plan-a`, which also takes initiative) or 2 cards (`plan-b`). War Room
  adds +1 card to either.
- **Siege** is not enabled in Rivers.

## 4. Supply

- Your supplied areas are the connected group of areas you control (by general adjacency, land and
  sea mixed) that includes your HQ. If you lose your HQ you supply nothing.
- **These need supply:** Advance sources, Sail sources and the sea chain, the Bombard linked sea,
  the Shell linked land, Reinforce targets, Embark targets and harbors, scoring VP, and holding bonuses.
- An area that is cut off stays yours but is dead weight. Its units cannot move, it scores nothing,
  and it cannot receive reinforcements.

## 5. Combat

Combat pauses the game. Only the **roller** acts, in two steps: `combatRoll`, then either
`combatReroll` (repeatable) or `combatResolve`.

- **Advance/Sail into enemy units:** the moving units are held off-board. The **defender** rolls
  1 die, +2 with Ambush (Advance only), +1 if the target land is a fort (Advance only; stacks with
  Ambush). The attacker never rolls. Resolution:
  1. Remove attackers equal to the defence pip total.
  2. Surviving attackers and defenders then trade 1-for-1 until one side is empty.
  3. If any attackers remain, they capture the area. If only defenders remain, they hold. If both
     sides are empty, the area becomes neutral.
     The defender never loses more than the number of attackers that survived the roll.
- **Bombard/Shell:** the **attacker** rolls and the target loses units equal to the pip total.
  If the target area empties, it becomes neutral. Bombard/Shell never capture.
- **Reroll:** after the roll, the roller may discard **any** card (face-down) to re-throw the same
  number of dice. Repeat as often as your hand allows. The last roll stands.
- Every removed unit goes back to its owner's reserve.
- Caps, the HQ check and the turn change all happen after the combat is resolved.

## 6. Operation cards

Each command can carry at most one card. A played card is revealed and then discarded.

- **ground_assault:** played with Advance. Add 0–2 troops from your reserve to the moving force.
- **river_assault:** played with Sail. Add 0–2 ships from your reserve to the moving force.
- **shore_strike:** played with Bombard. +2 dice.
- **mobilise:** played with Reinforce. +2 to the placement limit.
- **commandeer:** played with Embark. +1 to the limit, and you may also place into **any
  enemy-held sea**, with no supply or port needed. Each enemy sea you place into becomes a
  Sail-style battle: the defender rolls 1 die against your placed ships. With several battles,
  you pick the order.
- **counterattack:** played with Advance, **onto an Advance space the opponent already occupies**,
  as long as the target land is not yours. It spends one of your commanders, and their commander
  stays on the space. Normal Advance rules apply.
- **ambush:** when you defend against an Advance, play it at `combatRoll` for +2 defence dice.
  It does not work against Sail.
- **ship_strike:** after your Shell resolves, if you hold it, you still supply the linked land, and
  an adjacent sea still has enemy ships, you are offered a second Shell from the same space with
  no commander spent. Choose a target or decline.
- **Any card** can instead be discarded to reroll a combat you are rolling (see §5).

## 7. Bonuses

- At setup, 3 bonuses are drawn at random from 5 (barracks, warRoom, pirateHaven, shipyard,
  hiddenBase) and placed on the map's bonus-slot areas. You hold a bonus while you **supply** its
  area. The effects are automatic.
- **barracks:** Reinforce +2 limit.
- **warRoom:** Plan draws +1 card.
- **pirateHaven:** Bombard +1 die.
- **shipyard:** every Sail adds +1 ship from your reserve to the moving force (if you have one).
- **hiddenBase:** every Advance adds +1 troop from your reserve to the moving force (if you have one).
- **armoury** only aids Siege, so it is not in Rivers.
- The shipyard and hiddenBase units join before combat, so they are also added on peaceful moves.

## 8. Stacking caps / other limits

- **Caps:** at most 5 troops per land and 3 ships per sea. They are enforced after each command (or
  after its combat resolves), and any excess goes back to reserve. Moving 6 troops into land
  therefore keeps only 5 there, but the overflow is not destroyed.
- **Reserve pools:** each seat has 25 troops and 10 ships in total, split between the board and
  the reserve. Losses return to reserve, so units are never gone for good. Reinforce, Embark and the
  card/bonus additions all draw from the reserve.
- **Command gates:** while a combat or pending decision is open, no other command is legal.
  Each Advance/Sail/Bombard/Shell space is used at most once per round in total
  (Counterattack excepted).

## Strategy notes (heuristics, not rules)

- Guard your HQ above all. It is an instant loss, and even a Bombard can empty it. Keep it at 3–5
  troops if enemy ships or land threaten it.
- Supply is what scores. Cutting one link in the enemy chain can strip VP from every area behind
  it, and can also cut them off from a bonus.
- Initiative (`plan-a`) buys the first move next round and wins ties. It matters most in round
  `maxRounds - 1` and the final round.
- An attack succeeds only if attackers > defenders + defence roll. Expect a roll of about 1 (or
  about 3 with Ambush or about 2 on a fort), so bring a margin. Losing attackers return to reserve,
  not the board.
- Capturing neutral land costs no combat, so grab starred neutral areas early. Each source must
  keep one unit, so a thin line is fragile.
- Cards double as rerolls. A hand of any cards is insurance on your key defence or bombard rolls,
  and the opponent can see how many you hold.
- The caps (5/3) reward spreading out. Overflow is wasted tempo, but it is not lost.
- Space denial is real: taking the linked space an opponent needs for an Advance blocks it for the
  round (unless they hold Counterattack).
