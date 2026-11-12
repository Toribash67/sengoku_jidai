import type { Bot, Command, GameState, SeatId } from "../types.js";
import type { ExpectiOptions } from "../search2/features.js";
import { observe } from "../search2/hidden.js";
import { chooseCommand } from "../search2/search.js";

/** The dice- and card-aware bot. It is handed a full state like every Bot, but its first act is
 *  to reduce that to what its seat may know; nothing after that sees the original. Pass `depth`
 *  for reproducible tests, `deadlineMs` for a wall-clock budget. */
export class ExpectiBot implements Bot {
  constructor(private readonly opts: ExpectiOptions = {}) {}
  chooseCommand(state: GameState, seat: SeatId): Command {
    return chooseCommand(observe(state, seat), seat, this.opts);
  }
}
