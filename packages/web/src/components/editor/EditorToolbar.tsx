import type { Dispatch } from "react";
import type { EditorAction, EditorState, Tool } from "../../editor/reducer.js";

const TOOLS: { tool: Tool; label: string }[] = [
  { tool: "select", label: "Select tool" },
  { tool: "land", label: "Paint land" },
  { tool: "sea", label: "Paint sea" },
  { tool: "erase", label: "Erase" }
];

export function EditorToolbar({
  state,
  dispatch
}: {
  state: EditorState;
  dispatch: Dispatch<EditorAction>;
}) {
  return (
    <div className="editor-toolbar" role="toolbar" aria-label="Editor tools">
      {TOOLS.map(({ tool, label }) => (
        <button
          key={tool}
          type="button"
          aria-pressed={state.tool === tool}
          className={state.tool === tool ? "is-active" : ""}
          onClick={() => dispatch({ type: "setTool", tool })}
        >
          {label}
        </button>
      ))}
      <hr />
      <button
        type="button"
        disabled={state.past.length === 0}
        onClick={() => dispatch({ type: "undo" })}
      >
        Undo
      </button>
      <button
        type="button"
        disabled={state.future.length === 0}
        onClick={() => dispatch({ type: "redo" })}
      >
        Redo
      </button>
    </div>
  );
}
