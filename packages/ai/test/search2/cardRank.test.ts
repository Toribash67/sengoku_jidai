import { describe, expect, it } from "vitest";
import { deckFor } from "@sengoku-jidai/engine";
import { HIDDEN } from "../../src/search2/hidden.js";
import { CARD_KEEP_RANK, cardToSpend } from "../../src/search2/cardRank.js";

describe("cardToSpend", () => {
  it("spends the least useful card and keeps Ambush", () => {
    expect(cardToSpend(["ambush", "mobilise", "commandeer"])).toBe("mobilise");
    expect(cardToSpend(["ambush", HIDDEN])).toBe(HIDDEN);
    expect(cardToSpend(["ambush"])).toBe("ambush");
    expect(cardToSpend([])).toBeNull();
  });

  it("keeps the first-seen card on a tie", () => {
    expect(cardToSpend(["shore_strike", "mobilise"])).toBe("shore_strike");
  });

  it("ranks every card of both decks", () => {
    for (const c of [...deckFor("rivers"), ...deckFor("fortress")]) {
      expect(CARD_KEEP_RANK[c]).toBeGreaterThan(0);
    }
  });
});
