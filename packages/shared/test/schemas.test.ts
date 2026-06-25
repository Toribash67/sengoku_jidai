import { describe, expect, it } from "vitest";
import { claimGameRequestSchema, createGameRequestSchema } from "../src/schemas.js";

describe("createGameRequestSchema", () => {
  it("accepts an optional creator name and side", () => {
    const parsed = createGameRequestSchema.parse({ name: "  Kenshin  ", side: "black" });
    expect(parsed.name).toBe("Kenshin");
    expect(parsed.side).toBe("black");
  });

  it("still accepts a bare hotseat request (backward compatible)", () => {
    const parsed = createGameRequestSchema.parse({ mode: "hotseat" });
    expect(parsed.mode).toBe("hotseat");
    expect(parsed.name).toBeUndefined();
  });
});

describe("claimGameRequestSchema", () => {
  it("requires a 1–80 char name", () => {
    expect(claimGameRequestSchema.parse({ name: "Nobunaga" }).name).toBe("Nobunaga");
    expect(claimGameRequestSchema.safeParse({ name: "" }).success).toBe(false);
  });
});
