import type { GameState, Command, SeatId } from "@sengoku-jidai/engine";

export type { GameState, Command, SeatId };

/** The single method every bot implements. */
export interface Bot {
  chooseCommand(state: GameState, seat: SeatId): Command;
}

/** The opposing seat. */
export function other(seat: SeatId): SeatId {
  return seat === "red" ? "black" : "red";
}
