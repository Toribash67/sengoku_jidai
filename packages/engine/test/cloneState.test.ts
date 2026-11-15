import { describe, expect, it } from "vitest";
import {
  createInitialState,
  fortressRuleset,
  resolveCommand,
  type GameState
} from "../src/index.js";

/** Every object reachable from `value`. */
function objects(value: unknown, into = new Set<object>()): Set<object> {
  if (value !== null && typeof value === "object" && !into.has(value)) {
    into.add(value);
    for (const v of Object.values(value)) objects(v, into);
  }
  return into;
}

const states = (): GameState[] => [
  createInitialState({ gameId: "clone", seed: "clone" }),
  createInitialState({ gameId: "clone", seed: "clone", rules: fortressRuleset })
];

describe("the state copy inside resolveCommand", () => {
  it("shares no object with the state it was given, and leaves that state untouched", () => {
    for (const state of states()) {
      const before = JSON.stringify(state);
      const r = resolveCommand(state, { seat: state.activeSeat }, { type: "pass" });
      if (r.status !== "accepted") throw new Error("pass rejected");
      const original = objects(state);
      for (const o of objects(r.nextState)) expect(original.has(o)).toBe(false);
      expect(JSON.stringify(state)).toBe(before);
    }
  });

  it("the tables it copies by shape have exactly the shape it assumes", () => {
    for (const state of states()) {
      for (const area of Object.values(state.areas)) {
        expect(Object.keys(area).sort()).toEqual(["owner", "units"]);
        expect(Object.keys(area.units).sort()).toEqual(["ship", "siege", "troop"]);
      }
      for (const owner of Object.values(state.actionSpaces)) {
        expect(owner === null || typeof owner === "string").toBe(true);
      }
    }
  });

  it("carries every area and action space over", () => {
    for (const state of states()) {
      const r = resolveCommand(state, { seat: state.activeSeat }, { type: "pass" });
      if (r.status !== "accepted") throw new Error("pass rejected");
      expect(Object.keys(r.nextState.areas)).toEqual(Object.keys(state.areas));
      expect(r.nextState.areas).toEqual(state.areas);
      expect(Object.keys(r.nextState.actionSpaces)).toEqual(Object.keys(state.actionSpaces));
    }
  });
});
