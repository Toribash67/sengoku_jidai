import type { OperationCard } from "@sengoku-jidai/engine/client";
import { FORTRESS_CARDS, RIVERS_CARDS } from "@sengoku-jidai/engine/client";
import { describe, expect, it } from "vitest";
import { cardBackFor, cardImage, cardLabel } from "../../src/components/board/cardImages.js";

describe("card images", () => {
  it("resolves a truthy url for every card id in both decks", () => {
    for (const card of [...RIVERS_CARDS, ...FORTRESS_CARDS] as OperationCard[]) {
      expect(cardImage(card)).toBeTruthy();
    }
  });

  it("uses each deck's own back", () => {
    expect(cardBackFor("rivers")).toBeTruthy();
    expect(cardBackFor("fortress")).toBeTruthy();
    expect(cardBackFor("fortress")).not.toBe(cardBackFor("rivers"));
  });

  it("humanises card ids for labels", () => {
    expect(cardLabel("ground_assault")).toBe("Ground Assault");
    expect(cardLabel("ambush")).toBe("Ambush");
  });
});
