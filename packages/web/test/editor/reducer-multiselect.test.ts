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
