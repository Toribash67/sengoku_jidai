import { describe, expect, it } from "vitest";
import {
  createInitialState,
  fortressRuleset,
  resolveCommand,
  type Command,
  type GameEvent,
  type GameState,
  type OperationCard
} from "@sengoku-jidai/engine";
import { combatResponse } from "../src/heuristics.js";
import { createAiRng } from "../src/rng.js";
import { RandomBot } from "../src/bots/random.js";
import { GreedyBot } from "../src/bots/greedy.js";
import { runMatch } from "../src/match.js";

/** Tally the Fortress-specific play seen across a match's events. */
function tally() {
  const seen = { siegeRolls: 0, catapultsPlaced: 0, fortressCards: 0 };
  const onEvents = (events: GameEvent[]) => {
    for (const e of events) {
      if (e.type === "diceRolled" && e.purpose === "siege") seen.siegeRolls += 1;
      if (e.type === "unitsPlaced" && e.siege) seen.catapultsPlaced += e.siege;
      if (
        e.type === "cardPlayed" &&
        (e.card === "volley" || e.card === "take_cover" || e.card === "siege_assault")
      )
        seen.fortressCards += 1;
    }
  };
  return { seen, onEvents };
}

describe("bots under the Fortress ruleset", () => {
  it("RandomBot plays legal Fortress games to the end", () => {
    const { seen, onEvents } = tally();
    for (let i = 0; i < 6; i++) {
      const r = runMatch(new RandomBot(createAiRng(i)), new RandomBot(createAiRng(100 + i)), {
        seed: `fortress-random-${i}`,
        rules: fortressRuleset,
        onEvents
      });
      expect(r.endReason).not.toBeNull();
    }
    expect(seen.catapultsPlaced).toBeGreaterThan(0);
  });

  it("GreedyBot places catapults and sieges with them", () => {
    const { seen, onEvents } = tally();
    for (let i = 0; i < 4; i++) {
      const r = runMatch(new GreedyBot(), new GreedyBot(), {
        seed: `fortress-greedy-${i}`,
        rules: fortressRuleset,
        onEvents
      });
      expect(r.endReason).not.toBeNull();
    }
    expect(seen.catapultsPlaced).toBeGreaterThan(0);
    expect(seen.siegeRolls).toBeGreaterThan(0);
  });
});

/** Red sieges black's tile6 from tile10 (2 catapults); roll forced to `total`, attacker accepts. */
function siegedState(total: number, hands: { red?: OperationCard[]; black?: OperationCard[] }) {
  let s = createInitialState({ gameId: "g", seed: "ai-fortress", rules: fortressRuleset });
  s.initiative = "red";
  s.activeSeat = "red";
  s.bonuses = {};
  for (const id of Object.keys(s.areas))
    s.areas[id] = { owner: null, units: { troop: 0, ship: 0, siege: 0 } };
  s.areas.tile9 = { owner: "red", units: { troop: 3, ship: 0, siege: 0 } };
  s.areas.tile10 = { owner: "red", units: { troop: 5, ship: 0, siege: 2 } };
  s.areas.tile13 = { owner: "black", units: { troop: 3, ship: 0, siege: 0 } };
  s.areas.tile6 = { owner: "black", units: { troop: 3, ship: 0, siege: 0 } };
  s.players.red.hand = [...(hands.red ?? [])];
  s.players.black.hand = [...(hands.black ?? [])];
  const step = (state: GameState, seat: "red" | "black", c: Command): GameState => {
    const r = resolveCommand(state, { seat }, c);
    if (r.status !== "accepted") throw new Error(r.reason.message);
    return r.nextState;
  };
  s = step(s, "red", { type: "siege", spaceId: "siege-tile10", targetAreaId: "tile6" });
  s = step(s, "red", { type: "combatRoll", pendingId: s.pendingCombat!.id });
  s.pendingCombat!.total = total;
  return step(s, "red", { type: "combatResolve", pendingId: s.pendingCombat!.id });
}

describe("combatResponse under the Fortress ruleset", () => {
  it("takes cover when the siege would otherwise empty the area", () => {
    // 3 damage on 3 defenders loses the area; covered, only 1 troop is lost.
    const s = siegedState(3, { black: ["take_cover"] });
    expect(s.pendingCombat?.phase).toBe("awaiting-cover");
    const cmd = combatResponse(s, "black");
    expect(cmd).toEqual({
      type: "combatResolve",
      pendingId: s.pendingCombat!.id,
      card: "take_cover"
    });
  });

  it("accepts the damage when holding no Take Cover", () => {
    const s = siegedState(2, { black: ["mobilise"] });
    expect(combatResponse(s, "black")).toEqual({
      type: "combatResolve",
      pendingId: s.pendingCombat!.id
    });
  });

  it("answers a Siege Assault offer with a legal command, assaulting an emptied area", () => {
    const s = siegedState(3, { red: ["siege_assault"] });
    expect(s.pendingDecision?.kind).toBe("siegeAssault");
    const cmd = combatResponse(s, "red")!;
    expect(cmd).toMatchObject({ type: "advance", card: "siege_assault", spaceId: "advance-tile6" });
    expect(resolveCommand(s, { seat: "red" }, cmd).status).toBe("accepted");
  });
});
