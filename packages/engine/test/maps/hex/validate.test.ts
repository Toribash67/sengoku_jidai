import { describe, expect, it } from "vitest";
import { FIXTURE_HEX_MAP } from "../../../src/maps/hex/fixtures.js";
import type { HexMapSource } from "../../../src/maps/hex/source.js";
import { validateHexMap } from "../../../src/maps/hex/validate.js";

function clone(): HexMapSource {
  return structuredClone(FIXTURE_HEX_MAP);
}

describe("validateHexMap", () => {
  it("accepts the fixture map", () => {
    expect(() => validateHexMap(FIXTURE_HEX_MAP)).not.toThrow();
  });

  it("rejects an empty map", () => {
    expect(() => validateHexMap({ ...clone(), tiles: [] })).toThrow(/no tiles/);
  });

  it("rejects duplicate tile ids", () => {
    const m = clone();
    m.tiles[1]!.id = m.tiles[0]!.id;
    expect(() => validateHexMap(m)).toThrow(/duplicate tile id/);
  });

  it("rejects a hex shared by two tiles", () => {
    const m = clone();
    m.tiles[1]!.hexes[0] = { ...m.tiles[0]!.hexes[0]! };
    expect(() => validateHexMap(m)).toThrow(/in both/);
  });

  it("rejects a disconnected tile", () => {
    const m = clone();
    // Append a hex far away from this tile's existing hex(es).
    m.tiles[0]!.hexes.push({ q: 99, r: 99 });
    expect(() => validateHexMap(m)).toThrow(/not edge-connected/);
  });

  it("rejects a tile with no hexes", () => {
    const m = clone();
    m.tiles[0]!.hexes = [];
    expect(() => validateHexMap(m)).toThrow(/no hexes/);
  });

  it("rejects an hq on a sea tile", () => {
    const m = clone();
    const sea = m.tiles.find((t) => t.kind === "sea")!;
    sea.features.hq = "red";
    expect(() => validateHexMap(m)).toThrow(/must be land/);
  });

  it("rejects two hqs for the same seat", () => {
    const m = clone();
    const lands = m.tiles.filter((t) => t.kind === "land" && t.features.hq === undefined);
    lands[0]!.features.hq = "red";
    expect(() => validateHexMap(m)).toThrow(/more than one hq/);
  });

  it("rejects a port pointing at a non-sea tile", () => {
    const m = clone();
    const harbor = m.tiles.find((t) => t.features.harbor)!;
    const land = m.tiles.find((t) => t.kind === "land")!;
    harbor.ports = [land.id];
    expect(() => validateHexMap(m)).toThrow(/not sea/);
  });

  it("rejects ports on a non-harbor tile", () => {
    const m = clone();
    const plainLand = m.tiles.find((t) => t.kind === "land" && !t.features.harbor)!;
    const sea = m.tiles.find((t) => t.kind === "sea")!;
    plainLand.ports = [sea.id];
    expect(() => validateHexMap(m)).toThrow(/not a harbor/);
  });

  it("rejects a bonus slot referencing an unknown tile", () => {
    const m = clone();
    m.bonusSlots = ["nope"];
    expect(() => validateHexMap(m)).toThrow(/unknown tile/);
  });

  it("rejects starting deployment on an unknown tile", () => {
    const m = clone();
    m.startingDeployment = { nope: { seat: "red", troop: 1 } };
    expect(() => validateHexMap(m)).toThrow(/unknown tile/);
  });
});
