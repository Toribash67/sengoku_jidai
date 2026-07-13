import { afterEach, describe, expect, it } from "vitest";
import { loadTerrainChoice, saveTerrainChoice } from "../../src/state/localGame.js";

// The web vitest env is node (no DOM), so provide a minimal in-memory localStorage.
if (typeof globalThis.localStorage === "undefined") {
  const store = new Map<string, string>();
  globalThis.localStorage = {
    getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
    clear: () => store.clear(),
    key: () => null,
    length: 0
  } as Storage;
}

afterEach(() => localStorage.clear());

describe("terrain choice persistence", () => {
  it("round-trips a choice per map", () => {
    saveTerrainChoice("m1", "abc");
    saveTerrainChoice("m2", "flat");
    expect(loadTerrainChoice("m1")).toBe("abc");
    expect(loadTerrainChoice("m2")).toBe("flat");
  });

  it("returns null for an unset map", () => {
    expect(loadTerrainChoice("nope")).toBeNull();
  });

  it("returns null and clears the key on corrupt JSON", () => {
    localStorage.setItem("sengoku-jidai.terrainChoice", "{not json");
    expect(loadTerrainChoice("m1")).toBeNull();
    expect(localStorage.getItem("sengoku-jidai.terrainChoice")).toBeNull();
  });
});
