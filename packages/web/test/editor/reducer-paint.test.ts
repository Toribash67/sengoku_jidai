import { describe, expect, it } from "vitest";
import { emptyDoc } from "../../src/editor/doc.js";
import {
  editorReducer,
  initialEditorState,
  tileAt,
  type EditorAction,
  type EditorState
} from "../../src/editor/reducer.js";

function run(actions: EditorAction[], from?: EditorState): EditorState {
  return actions.reduce(editorReducer, from ?? initialEditorState(emptyDoc()));
}

describe("painting", () => {
  it("paints a hex as its own new tile with generated ids", () => {
    const state = run([
      { type: "paintHex", kind: "land", hex: { q: 0, r: 0 } },
      { type: "paintHex", kind: "sea", hex: { q: 1, r: 0 } }
    ]);
    expect(state.doc.tiles).toHaveLength(2);
    expect(state.doc.tiles[0]).toEqual({
      id: "t1",
      kind: "land",
      hexes: [{ q: 0, r: 0 }],
      features: {}
    });
    expect(state.doc.tiles[1]!.id).toBe("t2");
    expect(state.doc.tiles[1]!.kind).toBe("sea");
  });

  it("is a no-op when painting the same kind over a hex", () => {
    const one = run([{ type: "paintHex", kind: "land", hex: { q: 0, r: 0 } }]);
    const two = editorReducer(one, { type: "paintHex", kind: "land", hex: { q: 0, r: 0 } });
    expect(two).toBe(one);
  });

  it("re-kinds a hex into a fresh tile and drops the old tile's references", () => {
    let state = run([{ type: "paintHex", kind: "sea", hex: { q: 0, r: 0 } }]);
    // reference the sea tile from a fake harbor's ports and bonusSlots/deployment
    state = {
      ...state,
      doc: {
        ...state.doc,
        tiles: [
          ...state.doc.tiles,
          {
            id: "t9",
            kind: "land",
            hexes: [{ q: 5, r: 5 }],
            features: { harbor: true },
            ports: ["t1"]
          }
        ],
        startingDeployment: { t1: { seat: "red", ship: 1 } },
        bonusSlots: ["t1"]
      }
    };
    const next = editorReducer(state, { type: "paintHex", kind: "land", hex: { q: 0, r: 0 } });
    const ids = next.doc.tiles.map((t) => t.id);
    expect(ids).not.toContain("t1");
    expect(tileAt(next.doc, { q: 0, r: 0 })!.kind).toBe("land");
    expect(next.doc.tiles.find((t) => t.id === "t9")!.ports).toBeUndefined();
    expect(next.doc.startingDeployment).toEqual({});
    expect(next.doc.bonusSlots).toEqual([]);
  });

  it("erase splits a disconnected remainder; the largest piece keeps id and features", () => {
    // Build a 3-in-a-row land tile by hand (merge arrives in Task 8).
    const base = initialEditorState({
      ...emptyDoc(),
      tiles: [
        {
          id: "t1",
          kind: "land",
          hexes: [
            { q: 0, r: 0 },
            { q: 1, r: 0 },
            { q: 2, r: 0 },
            { q: 3, r: 0 }
          ],
          features: { valueStars: 1 }
        }
      ],
      nextTileNumber: 2
    });
    const next = editorReducer(base, { type: "eraseHex", hex: { q: 2, r: 0 } });
    expect(next.doc.tiles).toHaveLength(2);
    const survivor = next.doc.tiles.find((t) => t.id === "t1")!;
    expect(survivor.hexes).toEqual([
      { q: 0, r: 0 },
      { q: 1, r: 0 }
    ]);
    expect(survivor.features).toEqual({ valueStars: 1 });
    const split = next.doc.tiles.find((t) => t.id === "t2")!;
    expect(split.hexes).toEqual([{ q: 3, r: 0 }]);
    expect(split.features).toEqual({});
  });

  it("split tie: equal-size components — discovery order decides the survivor", () => {
    // 3-in-a-row tile; erasing the middle hex leaves two 1-hex components.
    const base = initialEditorState({
      ...emptyDoc(),
      tiles: [
        {
          id: "t1",
          kind: "land",
          hexes: [
            { q: 0, r: 0 },
            { q: 1, r: 0 },
            { q: 2, r: 0 }
          ],
          features: { valueStars: 1 }
        }
      ],
      nextTileNumber: 2
    });
    const next = editorReducer(base, { type: "eraseHex", hex: { q: 1, r: 0 } });
    expect(next.doc.tiles).toHaveLength(2);
    const survivor = next.doc.tiles.find((t) => t.id === "t1")!;
    expect(survivor.hexes).toEqual([{ q: 0, r: 0 }]); // first-discovered component wins
    expect(survivor.features).toEqual({ valueStars: 1 });
    const fresh = next.doc.tiles.find((t) => t.id === "t2")!;
    expect(fresh.hexes).toEqual([{ q: 2, r: 0 }]);
    expect(fresh.features).toEqual({});
  });

  it("undo/redo round-trips the doc", () => {
    const one = run([{ type: "paintHex", kind: "land", hex: { q: 0, r: 0 } }]);
    const undone = editorReducer(one, { type: "undo" });
    expect(undone.doc.tiles).toHaveLength(0);
    const redone = editorReducer(undone, { type: "redo" });
    expect(redone.doc).toEqual(one.doc);
  });

  it("prunes selection when undo removes the selected tile", () => {
    let state = run([{ type: "paintHex", kind: "land", hex: { q: 0, r: 0 } }]);
    state = editorReducer(state, { type: "selectTile", tileId: "t1" });
    expect(state.selection).toEqual(["t1"]);
    const undone = editorReducer(state, { type: "undo" });
    expect(undone.selection).toEqual([]);
  });
});
