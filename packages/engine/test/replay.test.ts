import { describe, expect, it } from "vitest";
import { createInitialState } from "../src/game.js";
import { resolveCommand } from "../src/resolve.js";
import type { Command, CommandActor } from "../src/commands.js";

type Step = { actor: CommandActor; command: Command };

function play(seed: string, steps: Step[]) {
  let s = createInitialState({ gameId: "g", seed });
  for (const step of steps) {
    const r = resolveCommand(s, step.actor, step.command);
    if (r.status !== "accepted") throw new Error(`rejected: ${r.reason.code}`);
    s = r.nextState;
  }
  return s;
}

describe("replay equivalence", () => {
  it("seed + ordered commands replays identically", () => {
    const initiative = createInitialState({ gameId: "g", seed: "seed-A" }).initiative;
    const opp = initiative === "red" ? "black" : "red";
    const steps: Step[] = [
      { actor: { seat: initiative }, command: { type: "pass" } },
      { actor: { seat: opp }, command: { type: "plan", spaceId: "plan-b" } },
      { actor: { seat: initiative }, command: { type: "pass" } },
      { actor: { seat: opp }, command: { type: "pass" } }
    ];
    const a = play("seed-A", steps);
    const b = play("seed-A", steps);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it("survives a JSON round-trip mid-game (no class instances / functions in state)", () => {
    const s = createInitialState({ gameId: "g", seed: "seed-A" });
    const r = resolveCommand(s, { seat: s.initiative }, { type: "pass" });
    if (r.status !== "accepted") throw new Error("rejected");
    const roundTripped = JSON.parse(JSON.stringify(r.nextState));
    expect(roundTripped).toEqual(r.nextState);
  });
});
