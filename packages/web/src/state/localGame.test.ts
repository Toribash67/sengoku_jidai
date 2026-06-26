import { describe, expect, it } from "vitest";
import { mergeSeatTokens } from "./localGame.js";

describe("mergeSeatTokens", () => {
  it("adds a new seat's token", () => {
    expect(mergeSeatTokens([{ seat: "red", token: "r" }], [{ seat: "black", token: "b" }])).toEqual(
      [
        { seat: "red", token: "r" },
        { seat: "black", token: "b" }
      ]
    );
  });

  it("lets the incoming token win for an existing seat", () => {
    expect(
      mergeSeatTokens([{ seat: "red", token: "old" }], [{ seat: "red", token: "new" }])
    ).toEqual([{ seat: "red", token: "new" }]);
  });

  it("orders red before black regardless of input order", () => {
    const merged = mergeSeatTokens([{ seat: "black", token: "b" }], [{ seat: "red", token: "r" }]);
    expect(merged.map((s) => s.seat)).toEqual(["red", "black"]);
  });
});
