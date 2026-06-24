import type { PendingCombat } from "@sengoku-jidai/engine";
import { describe, expect, it } from "vitest";
import { describeCombat } from "../../src/components/board/CombatPanel.js";

function pending(overrides: Partial<PendingCombat>): PendingCombat {
  return {
    id: "combat-tile1",
    kind: "advance",
    attacker: "red",
    defender: "black",
    responsibleSeat: "black",
    phase: "awaiting-roll",
    area: "tile1",
    unit: "troop",
    ...overrides
  };
}

describe("describeCombat", () => {
  it("describes an advance/sail as a defender-rolled battle with one die", () => {
    const r = describeCombat(pending({ attackers: 3, defenders: 2 }), "Coastal land");
    expect(r.headline).toBe("Battle for Coastal land");
    expect(r.detail).toContain("3");
    expect(r.detail).toContain("2");
    expect(r.diceCount).toBe(1);
  });

  it("describes a bombard with the attacker's dice count", () => {
    const r = describeCombat(
      pending({ kind: "bombard", responsibleSeat: "red", dice: 2 }),
      "Inland"
    );
    expect(r.headline).toBe("Bombard on Inland");
    expect(r.diceCount).toBe(2);
  });

  it("describes a shell, pluralising dice correctly", () => {
    const r = describeCombat(
      pending({ kind: "shell", unit: "ship", responsibleSeat: "red", dice: 2 }),
      "Sea"
    );
    expect(r.headline).toBe("Shell on Sea");
    expect(r.detail).toContain("2 dice");
  });

  it("never leaks a raw tile id", () => {
    const r = describeCombat(pending({ attackers: 1, defenders: 1 }), "Red HQ");
    expect(`${r.headline} ${r.detail}`).not.toContain("tile");
  });
});
