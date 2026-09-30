import { describe, expect, it } from "vitest";
import {
  playerView,
  resolveCommand,
  type PendingCombat,
  type PlayerGameView,
  type SeatId
} from "@sengoku-jidai/engine";
import {
  OrderArgError,
  buildCommand,
  formatOrder,
  listOrders,
  parseAllocation,
  type Order
} from "../src/orders.js";
import { activeView, emptyLegalView, openingState } from "./helpers.js";

/** Minimal legal args for an order: 1 unit from/into the first offered area. */
function minimalArgs(order: Order) {
  const t = order.template;
  if (t.kind === "move") return { from: `${t.sources[0]!.areaId}:1` };
  if (t.kind === "placement") return { place: `${t.targets[0]!}:1` };
  return {};
}

const combat: PendingCombat = {
  id: "pc-1",
  kind: "advance",
  attacker: "black",
  defender: "red",
  responsibleSeat: "red",
  phase: "awaiting-roll",
  area: "L7",
  unit: "troop",
  attackers: 3,
  defenders: 2
};

describe("listOrders", () => {
  it("numbers orders from 1 and ends with pass on a normal turn", () => {
    const orders = listOrders(activeView(openingState()));
    expect(orders.length).toBeGreaterThan(1);
    expect(orders.map((o) => o.n)).toEqual(orders.map((_, i) => i + 1));
    expect(orders.at(-1)!.template).toEqual({ kind: "fixed", command: { type: "pass" } });
  });

  it("is empty for the seat that is not on the clock", () => {
    const state = openingState();
    const other = state.activeSeat === "red" ? "black" : "red";
    expect(listOrders(playerView(state, other))).toEqual([]);
  });

  it("every order on the opening turn (with all 8 cards) builds a command the engine accepts", () => {
    const state = openingState("cp-all", [
      "ambush",
      "commandeer",
      "counterattack",
      "ground_assault",
      "mobilise",
      "river_assault",
      "ship_strike",
      "shore_strike"
    ]);
    const orders = listOrders(activeView(state));
    expect(orders.some((o) => o.label.includes("mobilise"))).toBe(true);
    for (const order of orders) {
      const command = buildCommand(order, minimalArgs(order));
      const result = resolveCommand(state, { seat: state.activeSeat }, command);
      expect(result.status, `${order.label} → ${JSON.stringify(command)}`).toBe("accepted");
    }
  });

  it("offers roll, ambush and nothing else while a defence roll is owed", () => {
    const base = emptyLegalView(openingState("cp", ["ambush", "mobilise"]));
    const view = {
      ...base,
      pendingCombat: combat,
      legal: { ...base.legal, canRollCombat: true, canAmbush: true }
    };
    const orders = listOrders(view);
    expect(orders.map((o) => buildCommand(o, {}))).toEqual([
      { type: "combatRoll", pendingId: "pc-1" },
      { type: "combatRoll", pendingId: "pc-1", card: "ambush" }
    ]);
  });

  it("offers one reroll per distinct card in hand, then resolve", () => {
    const base = emptyLegalView(openingState("cp", ["mobilise", "mobilise", "ambush"]));
    const view = {
      ...base,
      pendingCombat: { ...combat, phase: "rolled" as const, rolls: [3, 5], total: 8 },
      legal: { ...base.legal, canRerollCombat: true, canResolveCombat: true }
    };
    expect(view.hand).toEqual(["mobilise", "mobilise", "ambush"]);
    const commands = listOrders(view).map((o) => buildCommand(o, {}));
    expect(commands).toEqual([
      { type: "combatReroll", pendingId: "pc-1", card: "mobilise" },
      { type: "combatReroll", pendingId: "pc-1", card: "ambush" },
      { type: "combatResolve", pendingId: "pc-1" }
    ]);
  });

  it("names combat orders so they stay addressable as the numbering shifts", () => {
    const base = emptyLegalView(openingState("cp", ["ambush", "mobilise"]));
    const rolling = listOrders({
      ...base,
      pendingCombat: combat,
      legal: { ...base.legal, canRollCombat: true, canAmbush: true }
    });
    expect(rolling.map((o) => o.name)).toEqual(["roll", "ambush"]);
    const rolled = listOrders({
      ...base,
      pendingCombat: { ...combat, phase: "rolled" as const, rolls: [1], total: 1 },
      legal: { ...base.legal, canRerollCombat: true, canResolveCombat: true }
    });
    expect(rolled.map((o) => o.name)).toEqual(["reroll:ambush", "reroll:mobilise", "accept"]);
    expect(formatOrder(rolled.at(-1)!)).toMatch(/ 3\. Accept the roll .*→ play accept$/);
    expect(() => buildCommand(rolled.at(-1)!, { from: "L1:1" })).toThrow(/run `play accept`/);
  });

  it("turns a pending decision for this seat into one order per choice", () => {
    const base = emptyLegalView(openingState());
    const view = {
      ...base,
      pendingDecision: {
        id: "pd-1",
        seat: base.viewerSeat,
        prompt: "Ship Strike: shell again?",
        choices: [
          { id: "S3", label: "Shell S3" },
          { id: "decline", label: "Decline" }
        ],
        kind: "shipStrike" as const,
        spaceId: "shell-L4"
      }
    };
    const orders = listOrders(view);
    expect(orders.map((o) => o.label)).toEqual([
      "Ship Strike: shell again? → Shell S3",
      "Ship Strike: shell again? → Decline"
    ]);
    expect(buildCommand(orders[1]!, {})).toEqual({
      type: "choosePendingDecision",
      pendingId: "pd-1",
      choice: { id: "decline", label: "Decline" }
    });
  });

  it("ignores a pending decision that belongs to the opponent", () => {
    const base = emptyLegalView(openingState());
    const other: SeatId = base.viewerSeat === "red" ? "black" : "red";
    const view: PlayerGameView = {
      ...base,
      pendingDecision: { id: "pd-1", seat: other, prompt: "p", choices: [{ id: "x", label: "X" }] }
    };
    expect(listOrders(view)).toEqual([]);
  });

  it("lists one order per bombard/shell target", () => {
    const base = emptyLegalView(openingState());
    const view = {
      ...base,
      legal: {
        ...base.legal,
        strikes: [
          {
            spaceId: "bombard-S2",
            type: "bombard" as const,
            linkedAreaId: "S2",
            targets: ["L7", "L8"],
            dice: 3
          }
        ]
      }
    };
    const orders = listOrders(view);
    expect(orders.map((o) => o.label)).toEqual([
      "Bombard from S2 → L7 (3 dice)",
      "Bombard from S2 → L8 (3 dice)"
    ]);
    expect(buildCommand(orders[1]!, {})).toEqual({
      type: "bombard",
      spaceId: "bombard-S2",
      targetAreaId: "L8"
    });
  });

  it("labels plan draws and pass the way the engine resolves them", () => {
    const base = emptyLegalView(openingState());
    const view = {
      ...base,
      legal: {
        ...base.legal,
        canPass: true,
        plans: [
          { spaceId: "plan-a", initiative: true },
          { spaceId: "plan-b", initiative: false }
        ]
      }
    };
    expect(listOrders(view).map((o) => o.label)).toEqual([
      "Plan — draw 1 card and seize initiative next round",
      "Plan — draw 2 cards",
      "Pass — spend one commander without acting (you keep your remaining turns)"
    ]);
  });
});

describe("buildCommand for moves", () => {
  const base = emptyLegalView(openingState("cp", ["ground_assault", "counterattack"]));
  const move = {
    spaceId: "advance-L7",
    type: "advance" as const,
    targetAreaId: "L7",
    sources: [
      { areaId: "L3", max: 2 },
      { areaId: "L9", max: 1 }
    ]
  };
  const view = {
    ...base,
    legal: {
      ...base.legal,
      moves: [move],
      cardPlays: [
        { card: "ground_assault" as const, action: "advance" as const, moves: [move], bonusMax: 2 },
        { card: "counterattack" as const, action: "advance" as const, moves: [move] }
      ]
    }
  };
  const [plain, assault, counter] = listOrders(view);

  it("labels limits and usage", () => {
    expect(formatOrder(plain!)).toBe(
      " 1. Advance into L7 (sources: L3 up to 2, L9 up to 1)  → play 1 --from AREA:N[,AREA:N]"
    );
    expect(formatOrder(assault!)).toContain("[card: ground_assault]");
    expect(formatOrder(assault!)).toContain("--bonus 0-2");
  });

  it("builds advance moves in source order", () => {
    expect(buildCommand(plain!, { from: "L9:1,L3:2" })).toEqual({
      type: "advance",
      spaceId: "advance-L7",
      moves: [
        { from: "L3", count: 2 },
        { from: "L9", count: 1 }
      ]
    });
  });

  it("sums a repeated area and enforces its max", () => {
    expect(() => buildCommand(plain!, { from: "L3:1,L3:2" })).toThrow(/L3 allows at most 2/);
    expect(buildCommand(plain!, { from: "L3:1,L3:1" })).toMatchObject({
      moves: [{ from: "L3", count: 2 }]
    });
  });

  it("rejects missing, unknown, zero and malformed sources", () => {
    expect(() => buildCommand(plain!, {})).toThrow(/needs --from/);
    expect(() => buildCommand(plain!, { from: "L5:1" })).toThrow(
      /L5 is not a legal source for order 1/
    );
    expect(() => buildCommand(plain!, { from: "L3:0" })).toThrow(OrderArgError);
    expect(() => buildCommand(plain!, { from: "L3-2" })).toThrow(/AREA:COUNT/);
    expect(() => buildCommand(plain!, { from: "L3:1", place: "L3:1" })).toThrow(/--place/);
  });

  it("adds card and cardBonus (default 0) for assault cards, card only for counterattack", () => {
    expect(buildCommand(assault!, { from: "L3:1" })).toMatchObject({
      card: "ground_assault",
      cardBonus: 0
    });
    expect(buildCommand(assault!, { from: "L3:1", bonus: 2 })).toMatchObject({ cardBonus: 2 });
    expect(() => buildCommand(assault!, { from: "L3:1", bonus: 3 })).toThrow(/at most 2/);
    const c = buildCommand(counter!, { from: "L3:1" });
    expect(c).toMatchObject({ card: "counterattack" });
    expect(c).not.toHaveProperty("cardBonus");
    expect(() => buildCommand(counter!, { from: "L3:1", bonus: 1 })).toThrow(/--bonus/);
  });
});

describe("buildCommand for placements", () => {
  const base = emptyLegalView(openingState());
  const view = {
    ...base,
    legal: {
      ...base.legal,
      placements: [
        {
          spaceId: "reinforce-a",
          type: "reinforce" as const,
          unit: "troop" as const,
          targets: ["L3", "L9", "L12"],
          pool: 3,
          reserve: 2
        }
      ]
    }
  };
  const [reinforce] = listOrders(view);

  it("limits the total to min(pool, reserve)", () => {
    expect(reinforce!.template).toMatchObject({ kind: "placement", limit: 2 });
    expect(buildCommand(reinforce!, { place: "L3:1,L12:1" })).toEqual({
      type: "reinforce",
      spaceId: "reinforce-a",
      placements: [
        { area: "L3", count: 1 },
        { area: "L12", count: 1 }
      ]
    });
    expect(() => buildCommand(reinforce!, { place: "L3:2,L9:1" })).toThrow(/places at most 2/);
    expect(() => buildCommand(reinforce!, { place: "L4:1" })).toThrow(/L4 is not a legal target/);
    expect(() => buildCommand(reinforce!, {})).toThrow(/needs --place/);
  });
});

describe("parseAllocation", () => {
  it("parses and sums", () => {
    expect([...parseAllocation(" L3:2, L9:1 ,L3:1")]).toEqual([
      ["L3", 3],
      ["L9", 1]
    ]);
  });
  it("rejects empty input", () => {
    expect(() => parseAllocation(" , ")).toThrow(OrderArgError);
  });
});
