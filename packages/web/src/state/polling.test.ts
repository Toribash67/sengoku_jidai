import { describe, expect, it } from "vitest";
import type { PlayerGameView } from "@sengoku-jidai/engine";
import type { GameSeatInfo } from "@sengoku-jidai/shared";
import { shouldPoll } from "./polling.js";

function view(over: Partial<PlayerGameView>): PlayerGameView {
  return {
    status: "active",
    activeSeat: "red",
    viewerSeat: "red",
    ...over
  } as PlayerGameView;
}

const bothClaimed: GameSeatInfo[] = [
  { seat: "red", name: "Oda", status: "claimed" },
  { seat: "black", name: "Tok", status: "claimed" }
];
const opponentOpen: GameSeatInfo[] = [
  { seat: "red", name: "Oda", status: "claimed" },
  { seat: "black", name: null, status: "open" }
];

describe("shouldPoll", () => {
  it("does not poll on your own turn once both seats are claimed", () => {
    expect(shouldPoll(view({ activeSeat: "red", viewerSeat: "red" }), bothClaimed)).toBe(false);
  });

  it("polls while it is the opponent's turn", () => {
    expect(shouldPoll(view({ activeSeat: "black", viewerSeat: "red" }), bothClaimed)).toBe(true);
  });

  it("polls while a seat is still open (waiting for the opponent to join)", () => {
    expect(shouldPoll(view({ activeSeat: "red", viewerSeat: "red" }), opponentOpen)).toBe(true);
  });

  it("never polls once the game is over", () => {
    expect(
      shouldPoll(view({ status: "complete", activeSeat: "black", viewerSeat: "red" }), bothClaimed)
    ).toBe(false);
  });
});
