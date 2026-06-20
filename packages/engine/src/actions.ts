import type { Command, GameEvent } from "./commands.js";
import type { GameState } from "./state.js";
import type { SeatId } from "./types.js";
import { getMap } from "./maps/registry.js";
import { actionSpaceMap } from "./actionSpaces.js";
import { suppliesBonus } from "./validate.js";
import { resolveConflict } from "./conflict.js";

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
    events.push({ type: "bonusApplied", seat, bonus: "barracks", area: bonusArea(state, "barracks")! });
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
    events.push({ type: "bonusApplied", seat, bonus: "warRoom", area: bonusArea(state, "warRoom")! });
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
    events.push({ type: "unitsMoved", seat, from: m.from, to: target, unit: "troop", count: m.count });
  }

  // Hidden Base: +1 troop from reserve at move-in (before conflict), if supplied and
  // reserve has a troop. Cannot apply on the advance that first gains the bonus area,
  // which is impossible here because you cannot advance into an area you supply.
  if (suppliesBonus(state, seat, "hiddenBase") && state.players[seat].reserve.troop > 0) {
    state.players[seat].reserve.troop -= 1;
    attackers += 1;
    events.push({ type: "bonusApplied", seat, bonus: "hiddenBase", area: bonusArea(state, "hiddenBase")! });
  }

  events.push(...resolveMoveIn(state, seat, target, "troop", attackers));
  return events;
}

/**
 * Shared move-in + conflict for Advance/Sail. `attackers` units of `unit` arrive in
 * `target`; resolve against any enemy garrison and set ownership.
 */
export function resolveMoveIn(
  state: GameState,
  seat: SeatId,
  target: string,
  unit: "troop" | "ship",
  attackers: number
): GameEvent[] {
  const rt = state.areas[target]!;
  const enemy: SeatId = seat === "red" ? "black" : "red";
  const events: GameEvent[] = [];

  if (rt.owner == null || rt.owner === seat) {
    rt.units[unit] += attackers;
    const previousOwner = rt.owner;
    rt.owner = seat;
    if (previousOwner !== seat) events.push({ type: "areaCaptured", seat, area: target, previousOwner });
    return events;
  }

  // Enemy-controlled: conflict.
  const defenders = rt.units[unit];
  const outcome = resolveConflict(state.rngState, state.rules.diceFaces, attackers, defenders);
  state.rngState = outcome.rngState;
  events.push({ type: "diceRolled", seat, purpose: "defence", rolls: [outcome.defenceRoll], total: outcome.defenceRoll });

  state.players[seat].reserve[unit] += outcome.attackerLosses;
  state.players[enemy].reserve[unit] += outcome.defenderLosses;
  if (outcome.attackerLosses > 0) events.push({ type: "unitsRemoved", seat, area: target, unit, count: outcome.attackerLosses });
  if (outcome.defenderLosses > 0) events.push({ type: "unitsRemoved", seat: enemy, area: target, unit, count: outcome.defenderLosses });

  if (outcome.attackersLeft > 0) {
    rt.owner = seat;
    rt.units[unit] = outcome.attackersLeft;
    events.push({ type: "areaCaptured", seat, area: target, previousOwner: enemy });
  } else if (outcome.defendersLeft > 0) {
    rt.units[unit] = outcome.defendersLeft; // defender holds
  } else {
    rt.owner = null; // mutual annihilation
    rt.units[unit] = 0;
  }
  return events;
}
