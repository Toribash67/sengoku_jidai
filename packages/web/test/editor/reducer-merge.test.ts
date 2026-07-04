import { describe, expect, it } from "vitest";
import { emptyDoc } from "../../src/editor/doc.js";
import {
  canMergeSelection,
  editorReducer,
  initialEditorState,
  type EditorState
} from "../../src/editor/reducer.js";

/** t1=(0,0) land, t2=(1,0) land, t3=(0,1) sea, t4=(3,3) land (far away). */
function fourTiles(): EditorState {
  return initialEditorState({
    ...emptyDoc(),
    tiles: [
      { id: "t1", kind: "land", hexes: [{ q: 0, r: 0 }], features: { valueStars: 1 } },
      { id: "t2", kind: "land", hexes: [{ q: 1, r: 0 }], features: {} },
      { id: "t3", kind: "sea", hexes: [{ q: 0, r: 1 }], features: {} },
      { id: "t4", kind: "land", hexes: [{ q: 3, r: 3 }], features: {} }
    ],
    startingDeployment: { t2: { seat: "black", troop: 2 } },
    bonusSlots: ["t2"],
    nextTileNumber: 5
  });
}

describe("merge", () => {
  it("guards: needs 2+, same kind, edge-connected union", () => {
    const { doc } = fourTiles();
    expect(canMergeSelection(doc, ["t1"])).toBe(false);
    expect(canMergeSelection(doc, ["t1", "t3"])).toBe(false); // kinds differ
    expect(canMergeSelection(doc, ["t1", "t4"])).toBe(false); // disconnected
    expect(canMergeSelection(doc, ["t1", "t2"])).toBe(true);
  });

  it("merges into the primary: id, features, remapped references", () => {
    let state = fourTiles();
    state = { ...state, selection: ["t1", "t2"] };
    const next = editorReducer(state, { type: "mergeSelection" });
    expect(next.doc.tiles.map((t) => t.id)).toEqual(["t1", "t3", "t4"]);
    const merged = next.doc.tiles[0]!;
    expect(merged.hexes).toEqual([
      { q: 0, r: 0 },
      { q: 1, r: 0 }
    ]);
    expect(merged.features).toEqual({ valueStars: 1 }); // survivor's features
    // absorbed t2's deployment moved (survivor had none); bonus slot remapped + deduped
    expect(next.doc.startingDeployment).toEqual({ t1: { seat: "black", troop: 2 } });
    expect(next.doc.bonusSlots).toEqual(["t1"]);
    expect(next.selection).toEqual(["t1"]);
  });

  it("remaps inbound ports from an absorbed sea tile", () => {
    let state = initialEditorState({
      ...emptyDoc(),
      tiles: [
        { id: "s1", kind: "sea", hexes: [{ q: 0, r: 0 }], features: {} },
        { id: "s2", kind: "sea", hexes: [{ q: 1, r: 0 }], features: {} },
        {
          id: "h1",
          kind: "land",
          hexes: [{ q: 0, r: 1 }],
          features: { harbor: true },
          ports: ["s1", "s2"]
        }
      ],
      nextTileNumber: 1
    });
    state = { ...state, selection: ["s1", "s2"] };
    const next = editorReducer(state, { type: "mergeSelection" });
    expect(next.doc.tiles.find((t) => t.id === "h1")!.ports).toEqual(["s1"]);
  });

  it("unmerge explodes back to single-hex tiles; centroid hex keeps the identity", () => {
    let state = fourTiles();
    state = { ...state, selection: ["t1", "t2"] };
    state = editorReducer(state, { type: "mergeSelection" });
    const next = editorReducer(state, { type: "unmergeTile", tileId: "t1" });
    expect(next.doc.tiles).toHaveLength(4);
    const keeper = next.doc.tiles.find((t) => t.id === "t1")!;
    expect(keeper.hexes).toHaveLength(1);
    expect(keeper.features).toEqual({ valueStars: 1 });
    const fresh = next.doc.tiles.filter((t) => /^t[56]$/.test(t.id));
    expect(fresh).toHaveLength(1);
    expect(fresh[0]!.features).toEqual({});
  });
});
