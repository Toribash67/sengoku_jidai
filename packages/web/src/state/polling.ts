import type { PlayerGameView } from "@sengoku-jidai/engine";
import type { GameSeatInfo } from "@sengoku-jidai/shared";

/** Poll while the game is live AND either the opponent hasn't joined or it isn't the
 *  viewer's turn — i.e. when something can change without the viewer acting. */
export function shouldPoll(view: PlayerGameView, seatInfo: GameSeatInfo[]): boolean {
  if (view.status !== "active") {
    return false;
  }
  const opponentWaiting = seatInfo.some((s) => s.status === "open");
  const notViewersTurn = view.activeSeat !== view.viewerSeat;
  return opponentWaiting || notViewersTurn;
}
