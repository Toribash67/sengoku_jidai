import type { Command, GameEvent } from "./commands.js";
import type { GameState } from "./state.js";
import type { SeatId } from "./types.js";
import { getMap } from "./maps/registry.js";
import { actionSpaceMap } from "./actionSpaces.js";
import { suppliesBonus } from "./validate.js";

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

/** Area id currently holding a given bonus, if any. */
function bonusArea(state: GameState, bonus: string): string | undefined {
  return Object.entries(state.bonuses).find(([, b]) => b === bonus)?.[0];
}
