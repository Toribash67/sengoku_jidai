import { describe, expect, it } from "vitest";
import { createInitialState, resolveCommand, legalCommandsForState } from "@sengoku-jidai/engine";
import { greedyCommand } from "../src/bots/greedy.js";
import { deployCandidates } from "../src/candidates.js";
import { onTheClock } from "../src/onclock.js";

/**
 * Spread reinforcement: when the reserve pool exceeds the top tile's free capacity, the AI
 * should be able to deploy the WHOLE pool across several tiles in one command, not bank the
 * leftover. Invariant: for every placement source on a clean deploy turn, some deployCandidates
 * candidate deploys min(placeable, total free capacity) units — the most the board can hold.
 */
describe("deployCandidates offers a full-pool spread placement", () => {
  it("some candidate per source deploys min(placeable, totalFree)", () => {
    let state = createInitialState({ gameId: "spread", seed: "repro-7" });
    const shortfalls: string[] = [];
    let spreadOpportunities = 0; // turns where placeable exceeds the single best tile's capacity

    for (let i = 0; i < 4000 && state.status === "active"; i++) {
      const seat = onTheClock(state);
      if (!seat) break;

      if (!state.pendingCombat && !state.pendingDecision && state.activeSeat === seat) {
        const legal = legalCommandsForState(state, seat);
        const cands = deployCandidates(state, seat);
        for (const pl of legal.placements ?? []) {
          const placeable = Math.min(pl.pool, pl.reserve);
          if (placeable <= 0 || pl.targets.length === 0) continue;
          const cap = pl.unit === "troop" ? 5 : 3;
          const frees = pl.targets
            .map((t) => cap - (state.areas[t]?.units[pl.unit] ?? 0))
            .filter((f) => f > 0);
          const totalFree = frees.reduce((s, f) => s + f, 0);
          const topFree = frees.length ? Math.max(...frees) : 0;
          const deployable = Math.min(placeable, totalFree);
          if (deployable <= 0) continue;
          if (placeable > topFree && totalFree > topFree) spreadOpportunities++;

          // Max total units any candidate for THIS source deploys.
          let maxPlaced = 0;
          for (const c of cands) {
            if (c.type !== pl.type) continue;
            if ((c as { spaceId?: string }).spaceId !== pl.spaceId) continue;
            const placements = (c as { placements?: { count: number }[] }).placements ?? [];
            maxPlaced = Math.max(
              maxPlaced,
              placements.reduce((s, p) => s + p.count, 0)
            );
          }
          if (maxPlaced < deployable) {
            if (shortfalls.length < 10)
              shortfalls.push(
                `round ${state.round} ${seat} ${pl.type}/${pl.spaceId}: maxPlaced=${maxPlaced} < deployable=${deployable} (placeable=${placeable}, topFree=${topFree})`
              );
          }
        }
      }

      const cmd = greedyCommand(state, seat);
      const r = resolveCommand(state, { seat }, cmd);
      if (r.status !== "accepted") throw new Error("illegal");
      state = r.nextState;
    }

    expect(spreadOpportunities, "no spread opportunity arose — test is vacuous").toBeGreaterThan(0);
    expect(shortfalls, shortfalls.join("\n")).toEqual([]);
  });
});
