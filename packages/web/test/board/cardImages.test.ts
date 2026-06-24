import type { OperationCard } from "@sengoku-jidai/engine";
import { RIVERS_CARDS } from "@sengoku-jidai/engine";
import { describe, expect, it } from "vitest";
import { cardBack, cardImage, cardLabel } from "../../src/components/board/cardImages.js";

describe("card images", () => {
  it("resolves a truthy url for every card id", () => {
    for (const card of RIVERS_CARDS as OperationCard[]) {
      expect(cardImage(card)).toBeTruthy();
    }
    expect(cardBack).toBeTruthy();
  });

  it("humanises card ids for labels", () => {
    expect(cardLabel("ground_assault")).toBe("Ground Assault");
    expect(cardLabel("ambush")).toBe("Ambush");
  });
});
