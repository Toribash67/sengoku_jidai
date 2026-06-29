import { describe, expect, it } from "vitest";
import { parseMapControlArgs } from "../src/mapControlArgs.js";

describe("parseMapControlArgs", () => {
  it("returns the mapId with no amplitude when the flag is absent", () => {
    expect(parseMapControlArgs(["honshu"])).toEqual({ mapId: "honshu" });
  });

  it("parses a numeric --amplitude override", () => {
    expect(parseMapControlArgs(["honshu", "--amplitude", "80"])).toEqual({
      mapId: "honshu",
      amplitude: 80
    });
  });

  it("allows --amplitude 0 (disables warp)", () => {
    expect(parseMapControlArgs(["honshu", "--amplitude", "0"])).toEqual({
      mapId: "honshu",
      amplitude: 0
    });
  });

  it("throws when mapId is missing", () => {
    expect(() => parseMapControlArgs([])).toThrow(/usage/i);
    expect(() => parseMapControlArgs(["--amplitude", "30"])).toThrow(/usage/i);
  });

  it("throws on a non-numeric --amplitude", () => {
    expect(() => parseMapControlArgs(["honshu", "--amplitude", "foo"])).toThrow(
      /must be a number/i
    );
  });

  it("throws on a negative --amplitude (=-1 form; node:util needs = for dash values)", () => {
    expect(() => parseMapControlArgs(["honshu", "--amplitude=-1"])).toThrow(/must be a number/i);
  });
});
