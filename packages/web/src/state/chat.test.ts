import { describe, expect, it } from "vitest";
import type { GameSeatInfo } from "@sengoku-jidai/shared";
import { chatEnabled } from "./chat.js";

const seat = (
  s: "red" | "black",
  status: GameSeatInfo["status"],
  controller: GameSeatInfo["controller"] = "human"
): GameSeatInfo => ({ seat: s, name: null, status, controller });

describe("chatEnabled", () => {
  it("is on once a human opponent has claimed their seat", () => {
    expect(chatEnabled([seat("red", "claimed"), seat("black", "claimed")], "red")).toBe(true);
  });

  it("is off while the opponent seat is still open (hotseat or not yet joined)", () => {
    expect(chatEnabled([seat("red", "claimed"), seat("black", "open")], "red")).toBe(false);
  });

  it("is off against the computer", () => {
    expect(chatEnabled([seat("red", "claimed"), seat("black", "claimed", "ai")], "red")).toBe(
      false
    );
  });
});
