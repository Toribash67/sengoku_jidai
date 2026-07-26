import { describe, it, expect } from "vitest";
import { editorReducer, initialEditorState } from "../../src/editor/reducer.js";
import { emptyDoc, docToSource } from "../../src/editor/doc.js";

const start = () => initialEditorState(emptyDoc());

describe("setCommandersPerRound", () => {
  it("sets an in-range value on the doc", () => {
    const s = editorReducer(start(), { type: "setCommandersPerRound", value: 6 });
    expect(s.doc.commandersPerRound).toBe(6);
  });

  it("clamps to 1..8 and floors to an integer", () => {
    expect(editorReducer(start(), { type: "setCommandersPerRound", value: 0 }).doc.commandersPerRound).toBe(1);
    expect(editorReducer(start(), { type: "setCommandersPerRound", value: 99 }).doc.commandersPerRound).toBe(8);
    expect(editorReducer(start(), { type: "setCommandersPerRound", value: 4.7 }).doc.commandersPerRound).toBe(4);
  });

  it("round-trips through docToSource", () => {
    const s = editorReducer(start(), { type: "setCommandersPerRound", value: 5 });
    expect(docToSource(s.doc).commandersPerRound).toBe(5);
  });
});
