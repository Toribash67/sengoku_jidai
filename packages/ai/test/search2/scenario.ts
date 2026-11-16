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
import { GreedyBot } from "../../src/bots/greedy.js";
import { onTheClock } from "../../src/onclock.js";
import { DEFAULT_WEIGHTS } from "../../src/eval.js";
import { DEFAULT_FEATURES, type Features } from "../../src/search2/features.js";
import { observe } from "../../src/search2/hidden.js";
import type { BattleCtx, Outcome } from "../../src/search2/battle.js";
import type { SearchCtx } from "../../src/search2/search.js";

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
  // Most valuable target first, so that holding it is worth more than a card.
  const byValue = Object.entries(map.areas).sort((a, b) => b[1].valueStars - a[1].valueStars);
  for (const [id, area] of byValue) {
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

/** Every state of a greedy-vs-greedy game from the opening of `seed`, up to `plies` commands,
 *  stopping before the game ends (greedy games can end by HQ elimination within a round). */
function greedyLine(seed: string, plies: number, rules?: RulesConfig): GameState[] {
  const greedy = new GreedyBot();
  let state = createInitialState({ gameId: seed, seed, ...(rules ? { rules } : {}) });
  const line = [state];
  for (let i = 0; i < plies; i++) {
    const seat = onTheClock(state);
    if (!seat) break;
    state = apply(state, seat, greedy.chooseCommand(state, seat));
    if (state.status !== "active") break;
    line.push(state);
  }
  return line;
}

/** The raw state after `plies` greedy commands from the opening of `seed` — or the last state
 *  before the game ended, if it ends sooner. Always an active game. */
export function stateAfterGreedyPlies(seed: string, plies: number, rules?: RulesConfig): GameState {
  return greedyLine(seed, plies, rules).at(-1)!;
}

/** Red holds Commandeer and embarks into two black-held seas at once, staging two battles.
 *  Returns the position and that command. */
export function commandeerTwoBattlesScenario(): { state: GameState; command: Command } {
  const s = fresh({ redHand: ["commandeer"] });
  const map = getMap(s.mapId);
  const spare = Object.entries(map.areas).find(
    ([id, a]) => a.kind === "sea" && s.areas[id]?.owner == null
  );
  if (!spare) throw new Error("scenario: no free sea");
  s.areas[spare[0]] = {
    ...s.areas[spare[0]]!,
    owner: "black",
    units: { troop: 0, ship: 1, siege: 0 }
  };
  const play = legalCommandsForState(s, "red").cardPlays.find((p) => p.card === "commandeer");
  for (const pl of play?.placements ?? []) {
    const enemySeas = pl.targets.filter((id) => s.areas[id]?.owner === "black");
    if (enemySeas.length < 2 || Math.min(pl.pool, pl.reserve) < 2) continue;
    return {
      state: s,
      command: {
        type: "embark",
        spaceId: pl.spaceId,
        placements: enemySeas.slice(0, 2).map((area) => ({ area, count: 1 })),
        card: "commandeer"
      }
    };
  }
  throw new Error("scenario: no two-battle Commandeer could be arranged");
}

/** A raw state on a clean deploy turn (nothing pending), reached by greedy play from `seed`.
 *  `viewer` is the seat NOT on the clock; the mover's hand is replaced by `enemyHand`. */
export function opponentToMove(
  seed: string,
  enemyHand: OperationCard[]
): { state: GameState; viewer: SeatId } {
  const clean = greedyLine(seed, 10).filter((st) => !st.pendingCombat && !st.pendingDecision);
  const state = structuredClone(clean.at(-1)!) as GameState;
  const mover = state.activeSeat;
  state.players[mover].hand = [...enemyHand];
  return { state, viewer: mover === "red" ? "black" : "red" };
}

/** A search context for calling searchValue directly at depth 1 on an opponent's deploy turn:
 *  no deadline, and that step counts as the immediate reply. */
export function ctxFor(viewer: SeatId, over: Partial<Features> = {}): SearchCtx {
  return { ...ctx(over, viewer), deadline: 0, threatDepth: 1, fullBattles: 1 };
}

/** `attackSetup`, arranged so that the Advance is red's only sensible attack: every other unit
 *  that could move is pinned (a tile's last unit cannot leave), and any other tile the attacking
 *  stack could reach is a black stronghold. What remains is attack, build up, plan or pass. */
export function attackChoiceScenario(o: ScenarioCards & { attackers: number; defenders: number }): {
  state: GameState;
  attack: Command;
} {
  const { state, attack } = attackSetup(o);
  if (attack.type !== "advance") throw new Error("scenario: expected an advance");
  const from = attack.moves[0]!.from;
  for (const move of legalCommandsForState(state, "red").moves) {
    if (move.spaceId === attack.spaceId) continue;
    const unit = move.type === "advance" ? "troop" : "ship";
    for (const source of move.sources) {
      if (source.areaId !== from) state.areas[source.areaId]!.units[unit] = 1;
    }
    if (move.sources.some((source) => source.areaId === from)) {
      state.areas[move.targetAreaId] = {
        ...state.areas[move.targetAreaId]!,
        owner: "black",
        units: { troop: 0, ship: 0, siege: 0, [unit]: unit === "troop" ? 5 : 3 }
      };
    }
  }
  return { state, attack };
}
