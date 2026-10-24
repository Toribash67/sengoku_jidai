import { describe, expect, it } from "vitest";
import { editorReducer, initialEditorState } from "../../src/editor/reducer.js";
import { emptyDoc, type EditorDoc } from "../../src/editor/doc.js";

const existing = (): EditorDoc => ({
  ...emptyDoc(),
  id: "m1",
  tiles: [{ id: "t1", kind: "land", hexes: [{ q: 0, r: 0 }], features: {} }],
  nextTileNumber: 2
});

describe("default editor tool", () => {
  it("opens an existing map on Select and a new, empty map on Land", () => {
    expect(initialEditorState(existing()).tool).toBe("select");
    expect(initialEditorState(emptyDoc()).tool).toBe("land");
  });

  it("resets the tool when a doc is opened, but keeps it across a save's reload", () => {
    const painting = editorReducer(initialEditorState(emptyDoc()), {
      type: "setTool",
      tool: "sea"
    });
    expect(editorReducer(painting, { type: "loadDoc", doc: existing() }).tool).toBe("select");
    expect(editorReducer(painting, { type: "loadDoc", doc: existing(), keepTool: true }).tool).toBe(
      "sea"
    );
  });
});

describe("catapult deployment", () => {
  it("keeps catapults among the troops and turns them into troops when leaving Fortress", () => {
    let state = initialEditorState(existing());
    state = editorReducer(state, { type: "setRuleset", ruleset: "fortress" });
    state = editorReducer(state, {
      type: "setDeployment",
      tileId: "t1",
      units: { seat: "red", troop: 2, siege: 5 }
    });
    // Catapults never exceed the troops they are counted among.
    expect(state.doc.startingDeployment.t1).toEqual({ seat: "red", troop: 2, siege: 2 });
    state = editorReducer(state, { type: "setRuleset", ruleset: "rivers" });
    expect(state.doc.ruleset).toBeUndefined();
    expect(state.doc.startingDeployment.t1).toEqual({ seat: "red", troop: 2 });
  });
});
