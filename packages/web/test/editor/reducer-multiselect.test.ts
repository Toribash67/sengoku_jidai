import { describe, expect, it } from "vitest";
import { emptyDoc } from "../../src/editor/doc.js";
import { editorReducer, initialEditorState } from "../../src/editor/reducer.js";

function twoTiles() {
  return initialEditorState({
    ...emptyDoc(),
    tiles: [
      { id: "t1", kind: "land", hexes: [{ q: 0, r: 0 }], features: {} },
      { id: "t2", kind: "land", hexes: [{ q: 1, r: 0 }], features: {} }
    ],
    nextTileNumber: 3
  });
}

describe("multi-select mode", () => {
  it("starts off and toggles via setMultiSelect", () => {
    let state = twoTiles();
    expect(state.multiSelect).toBe(false);
    state = editorReducer(state, { type: "setMultiSelect", enabled: true });
    expect(state.multiSelect).toBe(true);
    state = editorReducer(state, { type: "setMultiSelect", enabled: false });
    expect(state.multiSelect).toBe(false);
  });

  it("survives tool switches but resets on loadDoc", () => {
    let state = editorReducer(twoTiles(), { type: "setMultiSelect", enabled: true });
    state = editorReducer(state, { type: "setTool", tool: "land" });
    expect(state.multiSelect).toBe(true);
    state = editorReducer(state, { type: "loadDoc", doc: emptyDoc() });
    expect(state.multiSelect).toBe(false);
  });
});

describe("selectEpoch (mobile sheet re-open signal)", () => {
  it("bumps on every tile-selecting tap, even re-selecting the same tile", () => {
    let state = twoTiles();
    expect(state.selectEpoch).toBe(0);
    state = editorReducer(state, { type: "selectTile", tileId: "t1" });
    expect(state.selectEpoch).toBe(1);
    // Re-tapping the same tile leaves the selection unchanged but still bumps the epoch.
    state = editorReducer(state, { type: "selectTile", tileId: "t1" });
    expect(state.selection).toEqual(["t1"]);
    expect(state.selectEpoch).toBe(2);
  });
});
