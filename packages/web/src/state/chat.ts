import type { SeatId } from "@sengoku-jidai/engine/client";
import type { GameSeatInfo } from "@sengoku-jidai/shared";

/** Chat is only offered in online human-vs-human games: the other seat must be a human who has
 *  claimed it from their own device. A hotseat game keeps its second seat open (the creator
 *  "views as" it), and a vs-Computer game has an AI opponent — nobody to talk to in either. */
export function chatEnabled(seatInfo: readonly GameSeatInfo[], viewerSeat: SeatId): boolean {
  const opponent = seatInfo.find((s) => s.seat !== viewerSeat);
  return opponent?.controller === "human" && opponent.status === "claimed";
}
