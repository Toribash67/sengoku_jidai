import { describe, expect, it } from "vitest";
import { alertTitle, shouldAlert } from "./turnAlert.js";

describe("shouldAlert", () => {
  it("alerts when it just became the viewer's turn and the tab is hidden", () => {
    expect(shouldAlert(false, true, true)).toBe(true);
  });

  it("does not alert when the tab is visible", () => {
    expect(shouldAlert(false, true, false)).toBe(false);
  });

  it("does not alert when it was already the viewer's turn", () => {
    expect(shouldAlert(true, true, true)).toBe(false);
  });

  it("does not alert when the turn passes away from the viewer", () => {
    expect(shouldAlert(true, false, true)).toBe(false);
  });

  it("does not alert when it stays the opponent's turn", () => {
    expect(shouldAlert(false, false, true)).toBe(false);
  });
});

describe("alertTitle", () => {
  it("prefixes the base title with an attention marker", () => {
    expect(alertTitle("General Orders: Sengoku Jidai")).toBe(
      "● Your move — General Orders: Sengoku Jidai"
    );
  });
});
