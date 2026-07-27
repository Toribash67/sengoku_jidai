import { describe, expect, it } from "vitest";
import { emptyDoc } from "../../src/editor/doc.js";
import { editorReducer, initialEditorState, type EditorState } from "../../src/editor/reducer.js";

function board(): EditorState {
  return initialEditorState({
    ...emptyDoc(),
    tiles: [
      { id: "t1", kind: "land", hexes: [{ q: 0, r: 0 }], features: {} },
      { id: "t2", kind: "land", hexes: [{ q: 1, r: 0 }], features: {} },
      { id: "s1", kind: "sea", hexes: [{ q: 0, r: 1 }], features: {} }
    ],
    nextTileNumber: 3
  });
}

describe("tile attributes", () => {
  it("assigning an HQ seat steals it from the previous holder", () => {
    let state = board();
    state = editorReducer(state, { type: "setFeature", tileId: "t1", patch: { hq: "red" } });
    state = editorReducer(state, { type: "setFeature", tileId: "t2", patch: { hq: "red" } });
    expect(state.doc.tiles.find((t) => t.id === "t1")!.features.hq).toBeUndefined();
    expect(state.doc.tiles.find((t) => t.id === "t2")!.features.hq).toBe("red");
    state = editorReducer(state, { type: "setFeature", tileId: "t2", patch: { hq: null } });
    expect(state.doc.tiles.find((t) => t.id === "t2")!.features.hq).toBeUndefined();
  });

  it("keeps features normalized: false/0 disappear", () => {
    let state = board();
    state = editorReducer(state, { type: "setFeature", tileId: "t1", patch: { harbor: true } });
    state = editorReducer(state, {
      type: "setFeature",
      tileId: "t1",
      patch: { valueStars: 2, shellable: true }
    });
    state = editorReducer(state, {
      type: "setFeature",
      tileId: "t1",
      patch: { valueStars: 0, shellable: false, harbor: false }
    });
    const t1 = state.doc.tiles.find((t) => t.id === "t1")!;
    expect(t1.features).toEqual({});
  });

  it("fort sets and clears like the other boolean features", () => {
    let state = board();
    state = editorReducer(state, { type: "setFeature", tileId: "t1", patch: { fort: true } });
    expect(state.doc.tiles.find((t) => t.id === "t1")!.features.fort).toBe(true);
    state = editorReducer(state, { type: "setFeature", tileId: "t1", patch: { fort: false } });
    expect(state.doc.tiles.find((t) => t.id === "t1")!.features).toEqual({});
  });

  it("deployment sets, normalizes zeros away, and clears", () => {
    let state = board();
    state = editorReducer(state, {
      type: "setDeployment",
      tileId: "t1",
      units: { seat: "red", troop: 3, ship: 0 }
    });
    expect(state.doc.startingDeployment).toEqual({ t1: { seat: "red", troop: 3 } });
    state = editorReducer(state, {
      type: "setDeployment",
      tileId: "t1",
      units: { seat: "red", troop: 0 }
    });
    expect(state.doc.startingDeployment).toEqual({});
    state = editorReducer(state, { type: "setDeployment", tileId: "t1", units: null });
    expect(state.doc.startingDeployment).toEqual({});
  });

  it("bonus slots toggle and name updates", () => {
    let state = board();
    state = editorReducer(state, { type: "toggleBonusSlot", tileId: "t1" });
    expect(state.doc.bonusSlots).toEqual(["t1"]);
    state = editorReducer(state, { type: "toggleBonusSlot", tileId: "t1" });
    expect(state.doc.bonusSlots).toEqual([]);
    state = editorReducer(state, { type: "setName", name: "My Map" });
    expect(state.doc.name).toBe("My Map");
  });
});
