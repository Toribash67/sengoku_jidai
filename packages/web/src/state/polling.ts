import type { PlayerGameView } from "@sengoku-jidai/engine/client";
import type { GameSeatInfo } from "@sengoku-jidai/shared";
import { onClockSeat } from "./onClock.js";

/** Poll while the game is live AND either the opponent hasn't joined or the viewer isn't on
 *  the clock — i.e. when something can change without the viewer acting. "On the clock" counts
 *  combat rolls, so the attacker keeps polling while the opponent rolls the defence. */
export function shouldPoll(view: PlayerGameView, seatInfo: GameSeatInfo[]): boolean {
  if (view.status !== "active") {
    return false;
  }
  const opponentWaiting = seatInfo.some((s) => s.status === "open");
  const notViewersClock = onClockSeat(view) !== view.viewerSeat;
  return opponentWaiting || notViewersClock;
}
