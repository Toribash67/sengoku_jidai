import type { Command, GameEvent } from "./commands.js";
import type { GameState } from "./state.js";
import type { SeatId } from "./types.js";
import { getMap } from "./maps/registry.js";
import { actionSpaceMap } from "./actionSpaces.js";
import { suppliesBonus } from "./validate.js";
import { conflictOutcome } from "./conflict.js";
import { rollDie, shuffle } from "./rng.js";
import type { OperationCard } from "./state.js";

/** Pass: deploy a commander to standby (unavailable until next round). */
export function applyPass(state: GameState, seat: SeatId): GameEvent[] {
  state.players[seat].commanders.standby += 1;
  state.players[seat].passed = true;
  return [{ type: "passed", seat }];
}

// Action mutators added in later tasks: applyEmbark, applyAdvance, applySail,
// applyBombard, applyShell. Each mutates `state` and returns the events it
// produced. Dispatch lives in resolve.ts.
export type ActionDispatch = (state: GameState, seat: SeatId, command: Command) => GameEvent[];

/** Reinforce: place troops from reserve into supplied land areas (validated upstream). */
export function applyReinforce(
  state: GameState,
  seat: SeatId,
  placements: { area: string; count: number }[],
  card?: OperationCard
): GameEvent[] {
  const events: GameEvent[] = [];
  for (const p of placements) {
    const rt = state.areas[p.area]!;
    rt.units.troop += p.count;
    rt.owner = seat;
    state.players[seat].reserve.troop -= p.count;
    events.push({ type: "unitsPlaced", seat, area: p.area, unit: "troop", count: p.count });
  }
  if (suppliesBonus(state, seat, "barracks")) {
    events.push({
      type: "bonusApplied",
      seat,
      bonus: "barracks",
      area: bonusArea(state, "barracks")!
    });
  }
  // Mobilise raised the placement limit by 2 (validated upstream); discard it.
  if (card) events.push(...playCard(state, seat, card));
  return events;
}

/**
 * Plan: draw cards and, for the initiative Plan space, seize next-round initiative.
 * Draw count: 2 for a normal Plan, 1 for the initiative Plan space, +1 if the seat supplies
 * War Room.
 */
export function applyPlan(state: GameState, seat: SeatId, spaceId: string): GameEvent[] {
  const map = getMap(state.mapId);
  const space = actionSpaceMap(map)[spaceId]!;
  const events: GameEvent[] = [];
  if (space.initiative) {
    state.initiative = seat;
    events.push({ type: "initiativeSeized", seat });
  }
  const warRoom = suppliesBonus(state, seat, "warRoom");
  if (warRoom) {
    events.push({
      type: "bonusApplied",
      seat,
      bonus: "warRoom",
      area: bonusArea(state, "warRoom")!
    });
  }
  const draw = (space.initiative ? 1 : 2) + (warRoom ? 1 : 0);
  events.push(...drawCards(state, seat, draw));
  return events;
}

/** Move a played operation card from the seat's hand to its discard pile. A played card's
 *  effect is public (extra units/dice/occupancy show on the board), so its id is revealed —
 *  unlike the face-down `cardDiscarded` of a combat reroll. */
function playCard(state: GameState, seat: SeatId, card: OperationCard): GameEvent[] {
  const player = state.players[seat];
  const i = player.hand.indexOf(card);
  if (i !== -1) {
    player.hand.splice(i, 1);
    player.discard.push(card);
  }
  return [{ type: "cardPlayed", seat, card }];
}

/** Draw up to `n` cards into the seat's hand, reshuffling the discard pile into the deck
 *  (deterministically, via `state.rngState`) when the deck runs short. */
function drawCards(state: GameState, seat: SeatId, n: number): GameEvent[] {
  const player = state.players[seat];
  let drawn = 0;
  for (let i = 0; i < n; i++) {
    if (player.deck.length === 0) {
      if (player.discard.length === 0) break; // nothing left to draw
      const reshuffled = shuffle(state.rngState, player.discard);
      state.rngState = reshuffled.state;
      player.deck = reshuffled.value;
      player.discard = [];
    }
    player.hand.push(player.deck.shift()!);
    drawn += 1;
  }
  return drawn > 0 ? [{ type: "cardsDrawn", seat, count: drawn }] : [];
}

/** Embark: place ships from reserve into supplied/port-adjacent water (validated upstream).
 *  With Commandeer the target set may include an opponent-controlled water; placing there
 *  routes through the Sail move-in (so it stages combat rather than co-occupying). */
export function applyEmbark(
  state: GameState,
  seat: SeatId,
  placements: { area: string; count: number }[],
  card?: OperationCard
): GameEvent[] {
  const events: GameEvent[] = [];
  for (const p of placements) {
    const rt = state.areas[p.area]!;
    state.players[seat].reserve.ship -= p.count;
    if (rt.owner != null && rt.owner !== seat) {
      // Commandeer into opponent water: stage a sail-style move-in (peaceful capture or combat).
      events.push(...resolveMoveIn(state, seat, "sail", p.area, "ship", p.count));
    } else {
      rt.units.ship += p.count;
      rt.owner = seat;
      events.push({ type: "unitsPlaced", seat, area: p.area, unit: "ship", count: p.count });
    }
  }
  if (card) events.push(...playCard(state, seat, card));
  return events;
}

/** Area id currently holding a given bonus, if any. */
function bonusArea(state: GameState, bonus: string): string | undefined {
  return Object.entries(state.bonuses).find(([, b]) => b === bonus)?.[0];
}

/**
 * Advance: move troops into the linked land (validated upstream), apply Hidden Base,
 * then resolve conflict if the target is enemy-controlled. Returns the events.
 */
export function applyAdvance(
  state: GameState,
  seat: SeatId,
  spaceId: string,
  moves: { from: string; count: number }[],
  card?: OperationCard,
  cardBonus?: number
): GameEvent[] {
  const map = getMap(state.mapId);
  const target = actionSpaceMap(map)[spaceId]!.areaId!;
  const events: GameEvent[] = [];

  let attackers = 0;
  for (const m of moves) {
    state.areas[m.from]!.units.troop -= m.count;
    attackers += m.count;
    events.push({
      type: "unitsMoved",
      seat,
      from: m.from,
      to: target,
      unit: "troop",
      count: m.count
    });
  }

  // Hidden Base: +1 troop from reserve at move-in (before conflict), if supplied and
  // reserve has a troop. Cannot apply on the advance that first gains the bonus area,
  // which is impossible here because you cannot advance into an area you supply.
  if (suppliesBonus(state, seat, "hiddenBase") && state.players[seat].reserve.troop > 0) {
    state.players[seat].reserve.troop -= 1;
    attackers += 1;
    events.push({
      type: "bonusApplied",
      seat,
      bonus: "hiddenBase",
      area: bonusArea(state, "hiddenBase")!
    });
  }

  // Ground Assault: up to 2 extra troops from reserve join the move-in (validated upstream).
  if (card === "ground_assault" && cardBonus) {
    state.players[seat].reserve.troop -= cardBonus;
    attackers += cardBonus;
  }

  events.push(...resolveMoveIn(state, seat, "advance", target, "troop", attackers));
  if (card) events.push(...playCard(state, seat, card));
  return events;
}

/** Sail: move ships into the linked water (validated upstream), apply Shipyard, resolve conflict. */
export function applySail(
  state: GameState,
  seat: SeatId,
  spaceId: string,
  moves: { from: string; count: number }[],
  card?: OperationCard,
  cardBonus?: number
): GameEvent[] {
  const map = getMap(state.mapId);
  const target = actionSpaceMap(map)[spaceId]!.areaId!;
  const events: GameEvent[] = [];

  let attackers = 0;
  for (const m of moves) {
    state.areas[m.from]!.units.ship -= m.count;
    attackers += m.count;
    events.push({
      type: "unitsMoved",
      seat,
      from: m.from,
      to: target,
      unit: "ship",
      count: m.count
    });
  }

  if (suppliesBonus(state, seat, "shipyard") && state.players[seat].reserve.ship > 0) {
    state.players[seat].reserve.ship -= 1;
    attackers += 1;
    events.push({
      type: "bonusApplied",
      seat,
      bonus: "shipyard",
      area: bonusArea(state, "shipyard")!
    });
  }

  // River Assault: up to 2 extra ships from reserve join the move-in (validated upstream).
  if (card === "river_assault" && cardBonus) {
    state.players[seat].reserve.ship -= cardBonus;
    attackers += cardBonus;
  }

  events.push(...resolveMoveIn(state, seat, "sail", target, "ship", attackers));
  if (card) events.push(...playCard(state, seat, card));
  return events;
}

const enemyOf = (seat: SeatId): SeatId => (seat === "red" ? "black" : "red");

/** Bombard: stage an attacker dice roll — one die per ship in the linked water (+1 for
 *  Pirate Haven). The roll is triggered later by the attacker via combatRoll. */
export function applyBombard(
  state: GameState,
  seat: SeatId,
  spaceId: string,
  targetAreaId: string,
  card?: OperationCard
): GameEvent[] {
  const map = getMap(state.mapId);
  const water = actionSpaceMap(map)[spaceId]!.areaId!;
  const events: GameEvent[] = [];
  let dice = state.areas[water]!.units.ship;
  if (suppliesBonus(state, seat, "pirateHaven")) {
    dice += 1;
    events.push({
      type: "bonusApplied",
      seat,
      bonus: "pirateHaven",
      area: bonusArea(state, "pirateHaven")!
    });
  }
  // Shore Strike: two extra dice (validated upstream).
  if (card === "shore_strike") dice += 2;
  if (card) events.push(...playCard(state, seat, card));
  state.pendingCombat = {
    id: `combat-${targetAreaId}`,
    kind: "bombard",
    attacker: seat,
    defender: enemyOf(seat),
    responsibleSeat: seat,
    phase: "awaiting-roll",
    area: targetAreaId,
    unit: "troop",
    dice
  };
  return events;
}

/** Shell: stage an attacker two-dice roll, triggered later by the attacker via combatRoll. */
export function applyShell(
  state: GameState,
  seat: SeatId,
  _spaceId: string,
  targetAreaId: string
): GameEvent[] {
  state.pendingCombat = {
    id: `combat-${targetAreaId}`,
    kind: "shell",
    attacker: seat,
    defender: enemyOf(seat),
    responsibleSeat: seat,
    phase: "awaiting-roll",
    area: targetAreaId,
    unit: "ship",
    dice: 2
  };
  return [];
}

/** Remove up to `count` units of `unit` from `area`, returning them to the owner's reserve. */
function removeUnits(
  state: GameState,
  area: string,
  unit: "troop" | "ship",
  count: number
): GameEvent[] {
  const rt = state.areas[area]!;
  if (rt.owner == null || count <= 0) return [];
  const removed = Math.min(count, rt.units[unit]);
  rt.units[unit] -= removed;
  state.players[rt.owner].reserve[unit] += removed;
  const events: GameEvent[] = [
    { type: "unitsRemoved", seat: rt.owner, area, unit, count: removed }
  ];
  if (rt.units.troop === 0 && rt.units.ship === 0) rt.owner = null;
  return events;
}

/**
 * Shared move-in for Advance/Sail. `attackers` units of `unit` arrive at `target`. A
 * peaceful move-in (empty or own area) captures immediately; an enemy-held target stages a
 * `pendingCombat` instead — the attackers are held in the pending record (off-board) until
 * the defender triggers the defence roll via `resolvePendingCombat`.
 */
export function resolveMoveIn(
  state: GameState,
  seat: SeatId,
  kind: "advance" | "sail",
  target: string,
  unit: "troop" | "ship",
  attackers: number
): GameEvent[] {
  const rt = state.areas[target]!;
  const events: GameEvent[] = [];

  if (rt.owner == null || rt.owner === seat) {
    rt.units[unit] += attackers;
    const previousOwner = rt.owner;
    rt.owner = seat;
    if (previousOwner !== seat)
      events.push({ type: "areaCaptured", seat, area: target, previousOwner });
    return events;
  }

  // Enemy-controlled: pause for the defender to roll. The board is frozen while pending,
  // so the defender snapshot stays valid until resolution.
  state.pendingCombat = {
    id: `combat-${target}`,
    kind,
    attacker: seat,
    defender: rt.owner,
    responsibleSeat: rt.owner,
    phase: "awaiting-roll",
    area: target,
    unit,
    attackers,
    defenders: rt.units[unit]
  };
  return events;
}

/**
 * Roll the paused combat's dice (RNG happens here), record them on `pendingCombat`, and
 * move it to the `rolled` phase WITHOUT touching the board. The responsible seat then
 * reviews the result before `applyPendingCombat` lands the casualties. Returns the
 * `diceRolled` event so the log/animation can show the throw.
 */
export function rollPendingCombat(state: GameState): GameEvent[] {
  const pc = state.pendingCombat!;
  const count = pc.kind === "advance" || pc.kind === "sail" ? 1 : pc.dice!;
  const rolls: number[] = [];
  let total = 0;
  for (let i = 0; i < count; i++) {
    const roll = rollDie(state.rngState, state.rules.diceFaces);
    state.rngState = roll.state;
    rolls.push(roll.value);
    total += roll.value;
  }
  pc.rolls = rolls;
  pc.total = total;
  pc.phase = "rolled";
  return [
    { type: "diceRolled", seat: pc.responsibleSeat, purpose: combatPurpose(state), rolls, total }
  ];
}

/** The diceRolled `purpose` for the active combat: "defence" for advance/sail, else the kind. */
function combatPurpose(state: GameState): string {
  const pc = state.pendingCombat!;
  return pc.kind === "advance" || pc.kind === "sail" ? "defence" : pc.kind;
}

/**
 * Discard `card` from the roller's hand and re-throw the same number of dice (the result is
 * shown again before casualties). Validated upstream: combat is in the `rolled` phase, the
 * actor is the responsible seat, and the card is in hand. Stays in the `rolled` phase.
 */
export function rerollPendingCombat(state: GameState, card: OperationCard): GameEvent[] {
  const pc = state.pendingCombat!;
  const player = state.players[pc.responsibleSeat];
  player.hand.splice(player.hand.indexOf(card), 1);
  player.discard.push(card);

  const rolls: number[] = [];
  let total = 0;
  for (let i = 0; i < pc.rolls!.length; i++) {
    const roll = rollDie(state.rngState, state.rules.diceFaces);
    state.rngState = roll.state;
    rolls.push(roll.value);
    total += roll.value;
  }
  pc.rolls = rolls;
  pc.total = total;
  return [
    { type: "cardDiscarded", seat: pc.responsibleSeat },
    { type: "diceRolled", seat: pc.responsibleSeat, purpose: combatPurpose(state), rolls, total }
  ];
}

/**
 * Apply the reviewed roll to the board and clear `pendingCombat`. Advance/Sail run the
 * defence-die conflict math (`conflictOutcome`) on the held attackers vs the defender
 * garrison; Bombard/Shell remove the rolled total of enemy units.
 */
export function applyPendingCombat(state: GameState): GameEvent[] {
  const pc = state.pendingCombat!;
  const rt = state.areas[pc.area]!;
  const events: GameEvent[] = [];

  if (pc.kind === "advance" || pc.kind === "sail") {
    const outcome = conflictOutcome(pc.rolls![0]!, pc.attackers!, pc.defenders!);

    state.players[pc.attacker].reserve[pc.unit] += outcome.attackerLosses;
    state.players[pc.defender].reserve[pc.unit] += outcome.defenderLosses;
    if (outcome.attackerLosses > 0)
      events.push({
        type: "unitsRemoved",
        seat: pc.attacker,
        area: pc.area,
        unit: pc.unit,
        count: outcome.attackerLosses
      });
    if (outcome.defenderLosses > 0)
      events.push({
        type: "unitsRemoved",
        seat: pc.defender,
        area: pc.area,
        unit: pc.unit,
        count: outcome.defenderLosses
      });

    if (outcome.attackersLeft > 0) {
      rt.owner = pc.attacker;
      rt.units[pc.unit] = outcome.attackersLeft;
      events.push({
        type: "areaCaptured",
        seat: pc.attacker,
        area: pc.area,
        previousOwner: pc.defender
      });
    } else if (outcome.defendersLeft > 0) {
      rt.units[pc.unit] = outcome.defendersLeft; // defender holds
    } else {
      rt.owner = null; // mutual annihilation
      rt.units[pc.unit] = 0;
    }
  } else {
    events.push(...removeUnits(state, pc.area, pc.unit, pc.total!));
  }

  state.pendingCombat = null;
  return events;
}
