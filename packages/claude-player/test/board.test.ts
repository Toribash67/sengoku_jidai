import { describe, expect, it } from "vitest";
import { getMap } from "@sengoku-jidai/engine";
import { CARD_TEXT, gameOverLine, renderBoard } from "../src/board.js";
import { listOrders } from "../src/orders.js";
import { activeView, openingState } from "./helpers.js";

describe("renderBoard", () => {
  const state = openingState("board", ["mobilise"]);
  const view = activeView(state);
  const map = getMap(state.mapId);
  const text = renderBoard(view, map, listOrders(view));

  it("has a header naming the viewer, round, clock, VP and hand", () => {
    expect(text).toContain(`You are ${view.viewerSeat.toUpperCase()}`);
    expect(text).toContain(`Round ${view.round}/${view.maxRounds}`);
    expect(text).toContain("On the clock: you");
    expect(text).toMatch(/VP: red \d+ · black \d+/);
    expect(text).toContain(`mobilise — ${CARD_TEXT.mobilise}`);
  });

  it("lists every area once with owner, units and adjacency", () => {
    for (const area of view.areas) {
      const lines = text.split("\n").filter((l) => l.startsWith(`${area.id} `));
      expect(lines, area.id).toHaveLength(1);
      expect(lines[0]).toContain(`adj: ${map.areas[area.id]!.adjacent.join(", ")}`);
    }
  });

  it("ends with the numbered orders", () => {
    expect(text).toContain("Your orders:");
    expect(text).toMatch(/\n 1\. /);
  });

  it("says when it is not your turn", () => {
    const quiet = renderBoard(view, map, []);
    expect(quiet).toContain("Not your turn — the opponent is on the clock.");
  });

  it("matches the Rivers opening snapshot", () => {
    expect(text).toMatchSnapshot();
  });

  it("describes a finished game", () => {
    const over = {
      ...view,
      status: "complete" as const,
      winner: "red" as const,
      endReason: "victoryPoints" as const
    };
    expect(gameOverLine(over)).toMatch(
      /^GAME OVER — winner: red \(victoryPoints\) — VP red \d+ · black \d+$/
    );
    expect(renderBoard(over, map, [])).toContain("GAME OVER");
  });
});
