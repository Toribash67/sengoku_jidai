import { describe, expect, it } from "vitest";
import { createInitialState } from "../src/game.js";
import type { GameState, OperationCard, UnitCounts } from "../src/state.js";
import { CATAPULTS_PER_PLAYER } from "../src/state.js";
import { fortressRuleset, riversRuleset } from "../src/rules.js";
import { buildActionSpaces } from "../src/actionSpaces.js";
import { FORTRESS_DECK } from "../src/cards.js";
import { riversMap } from "../src/maps/riversMap.js";
import { riversSource } from "../src/maps/riversSource.js";
import { compileHexMap } from "../src/maps/hex/compile.js";
import { registerMap } from "../src/maps/registry.js";
import { validateHexMap } from "../src/maps/hex/validate.js";
import { resolveCommand } from "../src/resolve.js";
import type { Command, CommandResult } from "../src/commands.js";
import { available } from "../src/legality.js";
import { legalCommandsForState } from "../src/view.js";
import { gameStateSchema } from "../src/stateSchema.js";

const units = (troop: number, siege = 0, ship = 0): UnitCounts => ({ troop, ship, siege });

/**
 * A Fortress game on the Rivers board with a fixed siege line: red holds its HQ (tile9) and
 * tile10; black holds tile6 (adjacent to tile10). Bonuses are cleared so they do not perturb
 * the dice arithmetic.
 */
function fortress(opts: { red?: OperationCard[]; black?: OperationCard[] } = {}): GameState {
  const s = createInitialState({ gameId: "g", seed: "seed-F", rules: fortressRuleset });
  s.initiative = "red";
  s.activeSeat = "red";
  s.bonuses = {};
  for (const id of Object.keys(s.areas)) s.areas[id] = { owner: null, units: units(0) };
  s.areas.tile9 = { owner: "red", units: units(3) };
  s.areas.tile10 = { owner: "red", units: units(4, 2) };
  s.areas.tile13 = { owner: "black", units: units(3) };
  s.areas.tile6 = { owner: "black", units: units(3, 1) };
  s.players.red.reserve = units(20, 3, 10);
  s.players.black.reserve = units(20, 4, 10);
  s.players.red.hand = [...(opts.red ?? [])];
  s.players.black.hand = [...(opts.black ?? [])];
  return s;
}

function accept(result: CommandResult): GameState {
  if (result.status !== "accepted") throw new Error(`rejected: ${result.reason.message}`);
  return result.nextState;
}

function run(state: GameState, seat: "red" | "black", command: Command): GameState {
  return accept(resolveCommand(state, { seat }, command));
}

/** Roll the paused combat, then force its total so the arithmetic is deterministic. */
function rollTo(state: GameState, total: number): GameState {
  const pc = state.pendingCombat!;
  const next = run(state, pc.responsibleSeat, { type: "combatRoll", pendingId: pc.id });
  next.pendingCombat!.total = total;
  return next;
}

const siege = (card?: OperationCard): Command => ({
  type: "siege",
  spaceId: "siege-tile10",
  targetAreaId: "tile6",
  ...(card ? { card } : {})
});

describe("fortress ruleset setup", () => {
  it("adds catapults to the pool and deals the fortress deck", () => {
    const s = createInitialState({ gameId: "g", seed: "x", rules: fortressRuleset });
    // 25 foot troops + 5 catapults (catapults count in `troop`), minus the starting garrison.
    const placed = Object.values(s.areas)
      .filter((a) => a.owner === "red")
      .reduce((n, a) => n + a.units.troop, 0);
    expect(s.players.red.reserve.siege).toBe(CATAPULTS_PER_PLAYER);
    expect(s.players.red.reserve.troop).toBe(25 + CATAPULTS_PER_PLAYER - placed);
    expect(s.deck).toHaveLength(27);
    expect([...s.deck].sort()).toEqual([...FORTRESS_DECK].sort());
    expect(s.deck).not.toContain("ship_strike");
    expect(s.deck).not.toContain("shore_strike");
    expect(gameStateSchema.safeParse(s).success).toBe(true);
  });

  it("gives every land a Siege space only under a Siege ruleset", () => {
    const lands = Object.values(riversMap.areas).filter((a) => a.kind === "land");
    const fortressSieges = buildActionSpaces(riversMap, fortressRuleset).filter(
      (s) => s.type === "siege"
    );
    expect(fortressSieges.map((s) => s.areaId).sort()).toEqual(lands.map((a) => a.id).sort());
    expect(buildActionSpaces(riversMap, riversRuleset).some((s) => s.type === "siege")).toBe(false);
    const rivers = createInitialState({ gameId: "g", seed: "x" });
    expect(Object.keys(rivers.actionSpaces).some((id) => id.startsWith("siege-"))).toBe(false);
    expect(rivers.players.red.reserve.siege).toBe(0);
  });

  it("uses the ruleset a map selects", () => {
    const source = { ...riversSource, id: "fortress-test-map", ruleset: "fortress" as const };
    registerMap(compileHexMap(source).definition);
    const s = createInitialState({ gameId: "g", seed: "x", mapId: "fortress-test-map" });
    expect(s.rules.rulesetId).toBe("fortress");
    expect(s.rules.bonusSet).toContain("armoury");
    expect(s.rules.bonusSet).not.toContain("hiddenBase");
    expect(riversRuleset.bonusSet).not.toContain("armoury");
    expect(s.actionSpaces["siege-tile10"]).toBeNull();
  });
});

describe("starting catapults", () => {
  const withDeployment = (ruleset: "rivers" | "fortress" | undefined, deployment: object) => ({
    ...riversSource,
    id: `catapult-start-${ruleset ?? "none"}`,
    ...(ruleset ? { ruleset } : {}),
    startingDeployment: { ...riversSource.startingDeployment, ...deployment }
  });

  it("places deployed catapults among the troops and takes them from the catapult reserve", () => {
    const source = withDeployment("fortress", { tile10: { seat: "red", troop: 3, siege: 2 } });
    registerMap(compileHexMap(source).definition);
    const s = createInitialState({ gameId: "g", seed: "x", mapId: source.id });
    expect(s.areas.tile10).toEqual({ owner: "red", units: units(3, 2) });
    expect(s.players.red.reserve.siege).toBe(CATAPULTS_PER_PLAYER - 2);
    expect(s.players.black.reserve.siege).toBe(CATAPULTS_PER_PLAYER);
  });

  it("rejects catapults on a map without Siege, beyond the troops, or over 5 per seat", () => {
    expect(() =>
      validateHexMap(withDeployment(undefined, { tile10: { seat: "red", troop: 3, siege: 1 } }))
    ).toThrow(/no Siege/);
    expect(() =>
      validateHexMap(withDeployment("fortress", { tile10: { seat: "red", troop: 1, siege: 2 } }))
    ).toThrow(/more catapults than troops/);
    expect(() =>
      validateHexMap(
        withDeployment("fortress", {
          tile10: { seat: "red", troop: 3, siege: 3 },
          tile1: { seat: "red", troop: 3, siege: 3 }
        })
      )
    ).toThrow(/max 5/);
  });
});

describe("reinforce with catapults", () => {
  const reinforce = (spaceId: string, count: number, siegeCount: number): Command => ({
    type: "reinforce",
    spaceId,
    placements: [{ area: "tile9", count, siege: siegeCount }]
  });

  it("lets the 6-space place two catapults and the 5-space one", () => {
    const a = run(fortress(), "red", reinforce("reinforce-a", 2, 2));
    expect(a.areas.tile9!.units).toEqual(units(5, 2));
    expect(a.players.red.reserve).toEqual(units(18, 1, 10));
    expect(resolveCommand(fortress(), { seat: "red" }, reinforce("reinforce-a", 3, 3)).status).toBe(
      "rejected"
    );
    expect(run(fortress(), "red", reinforce("reinforce-b", 2, 1)).areas.tile9!.units.siege).toBe(1);
    expect(resolveCommand(fortress(), { seat: "red" }, reinforce("reinforce-b", 2, 2)).status).toBe(
      "rejected"
    );
  });

  it("cannot place more catapults than the reserve holds, nor any under Rivers", () => {
    const s = fortress();
    s.players.red.reserve = units(20, 1, 10);
    expect(resolveCommand(s, { seat: "red" }, reinforce("reinforce-a", 2, 2)).status).toBe(
      "rejected"
    );
    const rivers = fortress();
    rivers.rules = riversRuleset;
    expect(resolveCommand(rivers, { seat: "red" }, reinforce("reinforce-a", 2, 1)).status).toBe(
      "rejected"
    );
  });

  it("offers the catapult allowance in the legal summary", () => {
    const legal = legalCommandsForState(fortress(), "red");
    const byId = Object.fromEntries(legal.placements.map((p) => [p.spaceId, p]));
    expect(byId["reinforce-a"]!.siegeMax).toBe(2);
    expect(byId["reinforce-b"]!.siegeMax).toBe(1);
  });
});

describe("siege", () => {
  it("rolls one die per catapult and removes foot troops before catapults", () => {
    let s = run(fortress(), "red", siege());
    expect(s.pendingCombat).toMatchObject({ kind: "siege", dice: 2, responsibleSeat: "red" });
    s = rollTo(s, 2);
    s = run(s, "red", { type: "combatResolve", pendingId: s.pendingCombat!.id });
    // tile6 had 3 units (1 catapult): two foot troops die, the catapult survives.
    expect(s.areas.tile6!.units).toEqual(units(1, 1));
    expect(s.players.black.reserve).toEqual(units(22, 4, 10));
    expect(s.pendingCombat).toBeNull();
    expect(s.activeSeat).toBe("black");
  });

  it("returns lost catapults to the catapult reserve", () => {
    let s = rollTo(run(fortress(), "red", siege()), 3);
    s = run(s, "red", { type: "combatResolve", pendingId: s.pendingCombat!.id });
    expect(s.areas.tile6).toEqual({ owner: null, units: units(0) });
    expect(s.players.black.reserve).toEqual(units(23, 5, 10));
  });

  it("needs a catapult in the linked land and an adjacent enemy land", () => {
    const s = fortress();
    s.areas.tile10!.units = units(4, 0);
    expect(resolveCommand(s, { seat: "red" }, siege()).status).toBe("rejected");
    expect(
      resolveCommand(
        fortress(),
        { seat: "red" },
        { type: "siege", spaceId: "siege-tile10", targetAreaId: "tile13" }
      ).status
    ).toBe("rejected");
  });

  it("adds a die for Armoury and two for Volley", () => {
    const s = fortress({ red: ["volley"] });
    s.bonuses = { tile9: "armoury" };
    const next = run(s, "red", siege("volley"));
    expect(next.pendingCombat!.dice).toBe(5);
    expect(next.players.red.hand).toEqual([]);
    const legal = legalCommandsForState(s, "red");
    expect(legal.strikes.find((x) => x.spaceId === "siege-tile10")!.dice).toBe(3);
    expect(legal.cardPlays.find((p) => p.card === "volley")!.strikes![0]!.dice).toBe(5);
  });

  it("is not playable with Volley on a Bombard, nor Shore Strike on a Siege", () => {
    expect(
      resolveCommand(fortress({ red: ["shore_strike"] }), { seat: "red" }, siege("shore_strike"))
        .status
    ).toBe("rejected");
  });
});

describe("take cover", () => {
  it("lets a defender holding cards answer after the attacker accepts the roll", () => {
    let s = rollTo(run(fortress({ black: ["take_cover"] }), "red", siege()), 3);
    s = run(s, "red", { type: "combatResolve", pendingId: s.pendingCombat!.id });
    expect(s.pendingCombat).toMatchObject({ phase: "awaiting-cover", responsibleSeat: "black" });
    expect(legalCommandsForState(s, "black")).toMatchObject({
      canTakeCover: true,
      canResolveCombat: true,
      canRerollCombat: false
    });
    // The attacker can no longer act on it.
    expect(
      resolveCommand(s, { seat: "red" }, { type: "combatResolve", pendingId: "combat-tile6" })
        .status
    ).toBe("rejected");
    s = run(s, "black", {
      type: "combatResolve",
      pendingId: s.pendingCombat!.id,
      card: "take_cover"
    });
    // 3 damage − 2 ignored = 1 foot troop lost.
    expect(s.areas.tile6!.units).toEqual(units(2, 1));
    expect(s.players.black.hand).toEqual([]);
    expect(s.discard).toContain("take_cover");
    expect(s.activeSeat).toBe("black");
  });

  it("pauses for any held card (hiding which), and the defender may decline", () => {
    let s = rollTo(run(fortress({ black: ["mobilise"] }), "red", siege()), 2);
    s = run(s, "red", { type: "combatResolve", pendingId: s.pendingCombat!.id });
    expect(s.pendingCombat!.phase).toBe("awaiting-cover");
    expect(legalCommandsForState(s, "black").canTakeCover).toBe(false);
    expect(
      resolveCommand(
        s,
        { seat: "black" },
        { type: "combatResolve", pendingId: s.pendingCombat!.id, card: "take_cover" }
      ).status
    ).toBe("rejected");
    s = run(s, "black", { type: "combatResolve", pendingId: s.pendingCombat!.id });
    expect(s.areas.tile6!.units).toEqual(units(1, 1));
  });

  it("skips the pause for an empty hand or a roll of zero", () => {
    let s = rollTo(run(fortress(), "red", siege()), 1);
    s = run(s, "red", { type: "combatResolve", pendingId: s.pendingCombat!.id });
    expect(s.pendingCombat).toBeNull();
    let z = rollTo(run(fortress({ black: ["take_cover"] }), "red", siege()), 0);
    z = run(z, "red", { type: "combatResolve", pendingId: z.pendingCombat!.id });
    expect(z.pendingCombat).toBeNull();
  });
});

describe("siege assault", () => {
  function afterSiege(total: number): GameState {
    let s = rollTo(run(fortress({ red: ["siege_assault"] }), "red", siege()), total);
    s = run(s, "red", { type: "combatResolve", pendingId: s.pendingCombat!.id });
    return s;
  }

  it("offers an Advance into the sieged land after the siege", () => {
    const s = afterSiege(2);
    expect(s.pendingDecision).toMatchObject({ kind: "siegeAssault", spaceId: "advance-tile6" });
    expect(s.activeSeat).toBe("red");
    const offer = legalCommandsForState(s, "red").siegeAssault!;
    expect(offer.targetAreaId).toBe("tile6");
    expect(offer.sources).toContainEqual({ areaId: "tile10", max: 3, siegeMax: 2 });
    expect(legalCommandsForState(s, "black").siegeAssault).toBeNull();
  });

  it("advances without deploying a commander or occupying the space", () => {
    const s = afterSiege(3); // tile6 emptied → the assault captures it peacefully
    const before = available(s, "red");
    const next = run(s, "red", {
      type: "advance",
      spaceId: "advance-tile6",
      moves: [{ from: "tile10", count: 3, siege: 1 }],
      card: "siege_assault"
    });
    expect(next.areas.tile6).toEqual({ owner: "red", units: units(3, 1) });
    expect(next.areas.tile10!.units).toEqual(units(1, 1));
    expect(next.actionSpaces["advance-tile6"]).toBeNull();
    expect(next.pendingDecision).toBeNull();
    expect(next.players.red.hand).toEqual([]);
    // The siege spent one commander; the assault spent none.
    expect(available(next, "red")).toBe(before);
    expect(next.activeSeat).toBe("black");
  });

  it("fights through a surviving garrison, losing catapults last", () => {
    const s = afterSiege(1); // tile6 keeps 2 units (1 catapult)
    let next = run(s, "red", {
      type: "advance",
      spaceId: "advance-tile6",
      moves: [{ from: "tile10", count: 3, siege: 2 }],
      card: "siege_assault"
    });
    expect(next.pendingCombat).toMatchObject({ kind: "advance", attackers: 3, attackerSiege: 2 });
    next = rollTo(next, 0);
    next = run(next, "black", { type: "combatResolve", pendingId: next.pendingCombat!.id });
    // 3 attackers vs 2 defenders, no defence pips: 1 attacker (a catapult) survives.
    expect(next.areas.tile6).toEqual({ owner: "red", units: units(1, 1) });
    expect(next.players.red.reserve.siege).toBe(3 + 1);
    expect(next.players.black.reserve.siege).toBe(4 + 1);
  });

  it("can be declined, and is never playable as a normal deploy", () => {
    const s = afterSiege(2);
    const declined = run(s, "red", {
      type: "choosePendingDecision",
      pendingId: s.pendingDecision!.id,
      choice: { id: "decline", label: "Decline" }
    });
    expect(declined.pendingDecision).toBeNull();
    expect(declined.activeSeat).toBe("black");
    expect(declined.players.red.hand).toEqual(["siege_assault"]);

    expect(
      resolveCommand(
        fortress({ red: ["siege_assault"] }),
        { seat: "red" },
        {
          type: "advance",
          spaceId: "advance-tile6",
          moves: [{ from: "tile10", count: 1 }],
          card: "siege_assault"
        }
      ).status
    ).toBe("rejected");
  });

  it("is not offered without the card", () => {
    let s = rollTo(run(fortress(), "red", siege()), 1);
    s = run(s, "red", { type: "combatResolve", pendingId: s.pendingCombat!.id });
    expect(s.pendingDecision).toBeNull();
  });
});

describe("catapults move and stack as troops", () => {
  it("advance carries catapults and rejects more than the source holds", () => {
    const s = fortress();
    s.areas.tile1 = { owner: null, units: units(0) };
    const next = run(s, "red", {
      type: "advance",
      spaceId: "advance-tile1",
      moves: [{ from: "tile10", count: 2, siege: 2 }]
    });
    expect(next.areas.tile1).toEqual({ owner: "red", units: units(2, 2) });
    expect(
      resolveCommand(
        fortress(),
        { seat: "red" },
        {
          type: "advance",
          spaceId: "advance-tile1",
          moves: [{ from: "tile9", count: 1, siege: 1 }]
        }
      ).status
    ).toBe("rejected");
  });

  it("the land cap returns foot troops before catapults", () => {
    const s = fortress();
    s.areas.tile9!.units = units(5, 0);
    s.areas.tile1 = { owner: null, units: units(0) };
    // Move 3 (2 catapults) from tile10 into tile9's neighbour, then reinforce over the cap.
    const next = run(s, "red", {
      type: "reinforce",
      spaceId: "reinforce-a",
      placements: [{ area: "tile10", count: 3, siege: 2 }]
    });
    // tile10: 4 (2 catapults) + 3 (2 catapults) = 7 → capped to 5, keeping all 4 catapults.
    expect(next.areas.tile10!.units).toEqual(units(5, 4));
    expect(next.players.red.reserve).toEqual(units(19, 1, 10));
  });
});
