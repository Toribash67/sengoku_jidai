import { describe, expect, it } from "vitest";
import { chatAlertTitle, shouldChatAlert } from "./chatAlert.js";

describe("shouldChatAlert", () => {
  it("alerts on a newer opponent message while hidden", () => {
    expect(shouldChatAlert(0, 4, true)).toBe(true);
    expect(shouldChatAlert(3, 4, true)).toBe(true);
  });

  it("does not alert while visible, on the initial load, or without a new message", () => {
    expect(shouldChatAlert(0, 4, false)).toBe(false);
    expect(shouldChatAlert(null, 4, true)).toBe(false);
    expect(shouldChatAlert(4, 4, true)).toBe(false);
    expect(shouldChatAlert(4, null, true)).toBe(false);
  });

  it("prefixes the base title", () => {
    expect(chatAlertTitle("Sengoku")).toBe("● New message — Sengoku");
  });
});
