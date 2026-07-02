import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { riversSource } from "../../src/maps/riversSource.js";
import { compileHexMap } from "../../src/maps/hex/compile.js";
import { validateHexMap } from "../../src/maps/hex/validate.js";

// Read the frozen oracle via fs so the test does not depend on JSON-import config.
const snapshot = JSON.parse(
  readFileSync(fileURLToPath(new URL("./riversMap.snapshot.json", import.meta.url)), "utf8")
);

describe("riversSource compiles to the canonical Rivers topology", () => {
  it("passes hex-map validation", () => {
    expect(() => validateHexMap(riversSource)).not.toThrow();
  });

  it("compiles to areas deep-equal to the frozen snapshot", () => {
    const { definition } = compileHexMap(riversSource);
    expect(definition.areas).toEqual(snapshot);
  });

  it("preserves id, name, bonus slots, and starting deployment", () => {
    const { definition } = compileHexMap(riversSource);
    expect(definition.id).toBe("rivers");
    expect(definition.name).toBe("Rivers");
    expect(definition.bonusSlots).toEqual(["tile2", "tile4", "tile20"]);
    // Lock all 10 deployment entries verbatim (ship tiles called out; a typo in any
    // troop count would otherwise slip through — deployment is a determinism input).
    expect(definition.startingDeployment).toEqual(riversSource.startingDeployment);
    expect(definition.startingDeployment?.tile14).toEqual({ seat: "red", ship: 3 });
    expect(definition.startingDeployment?.tile18).toEqual({ seat: "black", ship: 3 });
  });
});
