import type { Command, GameEvent } from "./commands.js";
import type { GameState } from "./state.js";
import type { SeatId } from "./types.js";
import { getMap } from "./maps/registry.js";
import { actionSpaceMap } from "./actionSpaces.js";
import { suppliesBonus } from "./validate.js";
import { resolveConflict } from "./conflict.js";
import { rollDie } from "./rng.js";

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
  placements: { area: string; count: number }[]
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
  return events;
}

/** Plan: no-op draw in v1; the initiative Plan space seizes next-round initiative. */
export function applyPlan(state: GameState, seat: SeatId, spaceId: string): GameEvent[] {
  const map = getMap(state.mapId);
  const space = actionSpaceMap(map)[spaceId]!;
  const events: GameEvent[] = [];
  if (space.initiative) {
    state.initiative = seat;
    events.push({ type: "initiativeSeized", seat });
  }
  if (suppliesBonus(state, seat, "warRoom")) {
    events.push({
      type: "bonusApplied",
      seat,
      bonus: "warRoom",
      area: bonusArea(state, "warRoom")!
    });
  }
  return events;
}

/** Embark: place ships from reserve into supplied/port-adjacent water (validated upstream). */
export function applyEmbark(
  state: GameState,
  seat: SeatId,
  placements: { area: string; count: number }[]
): GameEvent[] {
  const events: GameEvent[] = [];
  for (const p of placements) {
    const rt = state.areas[p.area]!;
    rt.units.ship += p.count;
    rt.owner = seat;
    state.players[seat].reserve.ship -= p.count;
    events.push({ type: "unitsPlaced", seat, area: p.area, unit: "ship", count: p.count });
  }
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
  moves: { from: string; count: number }[]
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

  events.push(...resolveMoveIn(state, seat, "advance", target, "troop", attackers));
  return events;
}

/** Sail: move ships into the linked water (validated upstream), apply Shipyard, resolve conflict. */
export function applySail(
  state: GameState,
  seat: SeatId,
  spaceId: string,
  moves: { from: string; count: number }[]
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

  events.push(...resolveMoveIn(state, seat, "sail", target, "ship", attackers));
  return events;
}

const enemyOf = (seat: SeatId): SeatId => (seat === "red" ? "black" : "red");

/** Bombard: stage an attacker dice roll — one die per ship in the linked water (+1 for
 *  Pirate Haven). The roll is triggered later by the attacker via combatRoll. */
export function applyBombard(
  state: GameState,
  seat: SeatId,
  spaceId: string,
  targetAreaId: string
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
  state.pendingCombat = {
    id: `combat-${targetAreaId}`,
    kind: "bombard",
    attacker: seat,
    defender: enemyOf(seat),
    responsibleSeat: seat,
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
    area: target,
    unit,
    attackers,
    defenders: rt.units[unit]
  };
  return events;
}

/**
 * Resolve the paused combat once its roll is triggered. Advance/Sail run the defence-die
 * conflict (`resolveConflict`) on the held attackers vs the defender garrison; Bombard/Shell
 * roll the attacker's dice and remove enemy units. Clears `pendingCombat`.
 */
export function resolvePendingCombat(state: GameState): GameEvent[] {
  const pc = state.pendingCombat!;
  const rt = state.areas[pc.area]!;
  const events: GameEvent[] = [];

  if (pc.kind === "advance" || pc.kind === "sail") {
    const outcome = resolveConflict(
      state.rngState,
      state.rules.diceFaces,
      pc.attackers!,
      pc.defenders!
    );
    state.rngState = outcome.rngState;
    events.push({
      type: "diceRolled",
      seat: pc.responsibleSeat,
      purpose: "defence",
      rolls: [outcome.defenceRoll],
      total: outcome.defenceRoll
    });

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
    const rolls: number[] = [];
    let total = 0;
    for (let i = 0; i < pc.dice!; i++) {
      const roll = rollDie(state.rngState, state.rules.diceFaces);
      state.rngState = roll.state;
      rolls.push(roll.value);
      total += roll.value;
    }
    events.push({ type: "diceRolled", seat: pc.responsibleSeat, purpose: pc.kind, rolls, total });
    events.push(...removeUnits(state, pc.area, pc.unit, total));
  }

  state.pendingCombat = null;
  return events;
}
