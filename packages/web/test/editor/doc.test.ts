import { describe, expect, it } from "vitest";
import { riversSource } from "@sengoku-jidai/engine/client";
import { docFromSource, docToSource, emptyDoc } from "../../src/editor/doc.js";

describe("editor doc", () => {
  it("starts empty with tile numbering at 1", () => {
    const doc = emptyDoc();
    expect(doc.id).toBeNull();
    expect(doc.tiles).toEqual([]);
    expect(doc.nextTileNumber).toBe(1);
  });

  it("round-trips a source", () => {
    const doc = docFromSource(riversSource, { asCopy: false });
    const source = docToSource(doc);
    expect(source.id).toBe(riversSource.id);
    expect(source.tiles).toEqual(riversSource.tiles);
    expect(source.startingDeployment).toEqual(riversSource.startingDeployment);
    expect(source.bonusSlots).toEqual(riversSource.bonusSlots);
  });

  it("loads as copy with a null id and (copy) name", () => {
    const doc = docFromSource(riversSource, { asCopy: true });
    expect(doc.id).toBeNull();
    expect(doc.name).toBe(`${riversSource.name} (copy)`);
    expect(docToSource(doc).id).toBe("editor-draft");
    expect(docToSource(doc, "srv").id).toBe("srv");
  });

  it("continues generated ids past existing t<N> ids", () => {
    const doc = docFromSource(
      {
        ...riversSource,
        tiles: [
          { id: "t7", kind: "land", hexes: [{ q: 0, r: 0 }], features: {} },
          { id: "other", kind: "sea", hexes: [{ q: 1, r: 0 }], features: {} }
        ],
        startingDeployment: {},
        bonusSlots: []
      },
      { asCopy: false }
    );
    expect(doc.nextTileNumber).toBe(8);
  });
});
