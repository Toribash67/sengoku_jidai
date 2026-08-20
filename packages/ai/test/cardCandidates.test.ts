import { describe, expect, it } from "vitest";
import {
  createInitialState,
  legalCommandsForState,
  resolveCommand,
  type Command,
  type OperationCard
} from "@sengoku-jidai/engine";
import { deployCandidates } from "../src/candidates.js";
import { alphaBetaCommand } from "../src/bots/alphabeta.js";
import { greedyCommand } from "../src/bots/greedy.js";
import { onTheClock } from "../src/onclock.js";

const cardOf = (c: Command): OperationCard | undefined =>
  "card" in c ? (c.card as OperationCard | undefined) : undefined;

/** A deployable opening state with `cards` forced into `seat`'s hand. */
function withHand(seed: string, cards: OperationCard[]) {
  const base = createInitialState({ gameId: "cardplay", seed });
  const seat = base.activeSeat;
  const state = {
    ...base,
    players: {
      ...base.players,
      [seat]: { ...base.players[seat], hand: cards }
    }
  } as typeof base;
  return { state, seat };
}

describe("deployCandidates offers deploy-time card plays", () => {
  it("offers a mobilise reinforce when the seat holds mobilise", () => {
    const { state, seat } = withHand("cp-1", ["mobilise"]);
    // Guard: the engine must actually surface mobilise here, else the test is vacuous.
    const legal = legalCommandsForState(state, seat);
    expect(legal.cardPlays.some((p) => p.card === "mobilise")).toBe(true);

    const cands = deployCandidates(state, seat);
    expect(cands.some((c) => cardOf(c) === "mobilise")).toBe(true);
  });

  // Comprehensive invariant across mid-game states: whenever the engine reports a card as
  // playable now, deployCandidates must offer at least one command that plays it. We inject a
  // full hand at each clean deploy turn (on a copy) so every card type gets exercised as the
  // board opens up; the real game is progressed with greedy (unmodified) for determinism.
  it("offers every card the engine reports playable, across a driven game", () => {
    const ALL: OperationCard[] = [
      "mobilise",
      "commandeer",
      "ground_assault",
      "river_assault",
      "shore_strike",
      "counterattack"
    ];
    let state = createInitialState({ gameId: "cardplay-drive", seed: "repro-7" });
    const exercised = new Set<OperationCard>();
    const missing: string[] = [];

    for (let i = 0; i < 4000 && state.status === "active"; i++) {
      const seat = onTheClock(state);
      if (!seat) break;

      if (!state.pendingCombat && !state.pendingDecision && state.activeSeat === seat) {
        const injected = {
          ...state,
          players: { ...state.players, [seat]: { ...state.players[seat], hand: [...ALL] } }
        } as typeof state;
        const legal = legalCommandsForState(injected, seat);
        const cands = deployCandidates(injected, seat);
        for (const play of legal.cardPlays) {
          exercised.add(play.card);
          const offered = cands.filter((c) => cardOf(c) === play.card);
          if (offered.length === 0) {
            missing.push(`round ${state.round} ${seat}: ${play.card} playable but not offered`);
          }
          // ground/river assault must spend the reserve bonus (bonusMax), else the card is wasted.
          if ((play.card === "ground_assault" || play.card === "river_assault") && play.bonusMax) {
            const anyBonus = offered.some(
              (c) => "cardBonus" in c && (c as { cardBonus?: number }).cardBonus === play.bonusMax
            );
            if (!anyBonus)
              missing.push(`round ${state.round} ${seat}: ${play.card} offered without cardBonus`);
          }
        }
      }

      const cmd = greedyCommand(state, seat);
      const r = resolveCommand(state, { seat }, cmd);
      if (r.status !== "accepted") throw new Error(`illegal ${JSON.stringify(cmd)}`);
      state = r.nextState;
    }

    expect(missing, missing.slice(0, 10).join("\n")).toEqual([]);
    // Non-vacuous: the drive must have surfaced a variety of card types (advance/sail/bombard
    // only become legal mid-game), not just the opening reinforce.
    const kinds = ALL.filter((c) => exercised.has(c));
    expect(kinds.length, `only exercised: ${kinds.join(", ")}`).toBeGreaterThanOrEqual(4);
  });

  // Card play must not introduce nondeterminism: candidate generation is a pure function of state,
  // so the search stays reproducible even with a full hand widening the tree.
  it("search stays deterministic with a full hand in play", () => {
    const { state, seat } = withHand("cp-det", [
      "mobilise",
      "commandeer",
      "ground_assault",
      "river_assault",
      "shore_strike",
      "counterattack"
    ]);
    const a = alphaBetaCommand(state, seat, { depth: 2 });
    const b = alphaBetaCommand(state, seat, { depth: 2 });
    expect(a).toEqual(b);
  });
});
