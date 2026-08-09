import type { Bot, GameState, Command, SeatId } from "../types.js";
import type { AiRng } from "../rng.js";
import { pick } from "../rng.js";
import { resolvePending } from "../heuristics.js";
import { deployCandidates } from "../candidates.js";

/** Uniform-random baseline. Resolves pending combat/decisions via heuristics, otherwise
 *  picks uniformly among the canonical deploy candidates. */
export class RandomBot implements Bot {
  constructor(private readonly rng: AiRng) {}

  chooseCommand(state: GameState, seat: SeatId): Command {
    const pending = resolvePending(state, seat);
    if (pending) return pending;
    const candidates = deployCandidates(state, seat);
    if (candidates.length === 0) return { type: "pass" };
    return pick(this.rng, candidates);
  }
}
