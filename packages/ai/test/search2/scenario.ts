import {
  createInitialState,
  getMap,
  legalCommandsForState,
  resolveCommand,
  type Command,
  type GameState,
  type OperationCard,
  type RulesConfig
} from "@sengoku-jidai/engine";
import type { SeatId } from "../../src/types.js";
import { DEFAULT_WEIGHTS } from "../../src/eval.js";
import { DEFAULT_FEATURES, type Features } from "../../src/search2/features.js";
import { observe } from "../../src/search2/hidden.js";
import type { BattleCtx, Outcome } from "../../src/search2/battle.js";

export interface ScenarioCards {
  redHand?: OperationCard[];
  blackHand?: OperationCard[];
  discard?: OperationCard[];
  ruleset?: RulesConfig;
}

/** A fresh game with red to deploy and the given hands / discard pile. */
function fresh(o: ScenarioCards): GameState {
  const s = createInitialState({
    gameId: "scenario",
    seed: "scenario",
    ...(o.ruleset ? { rules: o.ruleset } : {})
  });
  s.activeSeat = "red";
  s.initiative = "red";
  s.players.red.hand = [...(o.redHand ?? [])];
  s.players.black.hand = [...(o.blackHand ?? [])];
  s.discard = [...(o.discard ?? [])];
  return s;
}

function apply(state: GameState, seat: SeatId, cmd: Command): GameState {
  const r = resolveCommand(state, { seat }, cmd);
  if (r.status !== "accepted") {
    throw new Error(`scenario command rejected: ${r.reason.code} — ${r.reason.message}`);
  }
  return r.nextState;
}

/** Red's most valuable opening Advance, rewritten so `attackers` troops can move from a single
 *  source into a black-held land with `defenders` troops. Returns the position before the attack
 *  and the attack itself. */
export function attackSetup(o: ScenarioCards & { attackers: number; defenders: number }): {
  state: GameState;
  attack: Command;
} {
  const s = fresh(o);
  const map = getMap(s.mapId);
  const stars = (id: string) => map.areas[id]?.valueStars ?? 0;
  const move = legalCommandsForState(s, "red")
    .moves.filter((m) => m.type === "advance")
    .sort((a, b) => stars(b.targetAreaId) - stars(a.targetAreaId))[0];
  if (!move) throw new Error("scenario: no opening advance");
  const from = move.sources[0]!.areaId;
  s.areas[move.targetAreaId] = {
    ...s.areas[move.targetAreaId]!,
    owner: "black",
    units: { troop: o.defenders, ship: 0, siege: 0 }
  };
  s.areas[from]!.units.troop = o.attackers + 1;
  return {
    state: s,
    attack: { type: "advance", spaceId: move.spaceId, moves: [{ from, count: o.attackers }] }
  };
}

/** A raw (un-observed) state paused on red's Advance of `attackers` into `defenders`. With
 *  `rolled`, the defence dice are already showing (phase `rolled`). */
export function advanceScenarioRaw(
  o: ScenarioCards & { attackers: number; defenders: number; rolled?: number[] }
): GameState {
  const { state, attack } = attackSetup(o);
  const s = apply(state, "red", attack);
  if (!s.pendingCombat) throw new Error("scenario: the advance did not start a combat");
  if (o.rolled) {
    s.pendingCombat = {
      ...s.pendingCombat,
      phase: "rolled",
      rolls: [...o.rolled],
      total: o.rolled.reduce((a, b) => a + b, 0)
    };
  }
  return s;
}

/** `advanceScenarioRaw`, as `viewer` (default: the attacker, red) is entitled to see it. */
export function advanceScenario(
  o: ScenarioCards & { attackers: number; defenders: number; rolled?: number[]; viewer?: SeatId }
): GameState {
  return observe(advanceScenarioRaw(o), o.viewer ?? "red");
}

/** A raw state paused on red's first legal strike of `type` against a black area holding
 *  `defenders` units. Found by trying each area as the target until the engine offers the strike
 *  (red's lands get a catapult each so a siege has something to fire). The target may be one of
 *  red's own opening areas, handed to black. */
export function strikeScenarioRaw(
  o: ScenarioCards & { type: "bombard" | "shell" | "siege"; defenders: number }
): GameState {
  const base = fresh(o);
  const map = getMap(base.mapId);
  const unit = o.type === "shell" ? "ship" : "troop";
  for (const [id, area] of Object.entries(map.areas)) {
    if (area.hq) continue;
    if ((area.kind === "sea") !== (unit === "ship")) continue;
    const s = structuredClone(base) as GameState;
    s.areas[id] = {
      ...s.areas[id]!,
      owner: "black",
      units: { troop: 0, ship: 0, siege: 0, [unit]: o.defenders }
    };
    if (o.type === "siege") {
      for (const rt of Object.values(s.areas)) {
        if (rt.owner === "red" && rt.units.troop > 0) rt.units.siege = 1;
      }
    }
    const strike = legalCommandsForState(s, "red").strikes.find(
      (st) => st.type === o.type && st.targets.includes(id)
    );
    if (!strike) continue;
    const next = apply(s, "red", { type: o.type, spaceId: strike.spaceId, targetAreaId: id });
    if (next.pendingCombat) return next;
  }
  throw new Error(`scenario: no legal ${o.type} could be arranged`);
}

export function strikeScenario(
  o: ScenarioCards & {
    type: "bombard" | "shell" | "siege";
    defenders: number;
    viewer?: SeatId;
  }
): GameState {
  return observe(strikeScenarioRaw(o), o.viewer ?? "red");
}

export function ctx(over: Partial<Features> = {}, viewer: SeatId = "red"): BattleCtx {
  return { viewer, weights: DEFAULT_WEIGHTS, features: { ...DEFAULT_FEATURES, ...over } };
}

/** Probability that red ends up owning `area`. */
export function captureProb(outs: Outcome[], area: string): number {
  return outs.filter((o) => o.state.areas[area]!.owner === "red").reduce((p, o) => p + o.prob, 0);
}

export const noneAbsent: ReadonlySet<OperationCard> = new Set<OperationCard>();
