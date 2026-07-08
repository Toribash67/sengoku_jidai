import type { Dispatch } from "react";
import type { EditorAction, EditorState, Tool } from "../../editor/reducer.js";

const TOOLS: { tool: Tool; label: string; ariaLabel: string; glyph: string }[] = [
  { tool: "select", label: "Select", ariaLabel: "Select tool", glyph: "⌖" },
  { tool: "land", label: "Land", ariaLabel: "Paint land", glyph: "⬢" },
  { tool: "sea", label: "Sea", ariaLabel: "Paint sea", glyph: "⬢" },
  { tool: "erase", label: "Erase", ariaLabel: "Erase", glyph: "⌫" }
];

interface EditorToolbarProps {
  state: EditorState;
  dispatch: Dispatch<EditorAction>;
  onZoomIn: () => void;
  onZoomOut: () => void;
}

export function EditorToolbar({ state, dispatch, onZoomIn, onZoomOut }: EditorToolbarProps) {
  return (
    <div className="editor-dock" role="toolbar" aria-label="Editor tools">
      <div className="dock-group">
        {TOOLS.map(({ tool, label, ariaLabel, glyph }) => (
          <button
            key={tool}
            type="button"
            aria-label={ariaLabel}
            aria-pressed={state.tool === tool}
            className={`dock-button${state.tool === tool ? " is-active" : ""}`}
            onClick={() => dispatch({ type: "setTool", tool })}
          >
            <span className={`dock-glyph is-${tool}`} aria-hidden="true">
              {glyph}
            </span>
            <span className="dock-label">{label}</span>
          </button>
        ))}
        <button
          type="button"
          aria-label="Multi-select"
          aria-pressed={state.multiSelect}
          disabled={state.tool !== "select"}
          className={`dock-button${state.multiSelect ? " is-active" : ""}`}
          onClick={() => dispatch({ type: "setMultiSelect", enabled: !state.multiSelect })}
        >
          <span className="dock-glyph" aria-hidden="true">
            ⧉
          </span>
          <span className="dock-label">Multi</span>
        </button>
      </div>
      <div className="dock-group">
        <button
          type="button"
          aria-label="Undo"
          className="dock-button"
          disabled={state.past.length === 0}
          onClick={() => dispatch({ type: "undo" })}
        >
          <span className="dock-glyph" aria-hidden="true">
            ↶
          </span>
          <span className="dock-label">Undo</span>
        </button>
        <button
          type="button"
          aria-label="Redo"
          className="dock-button"
          disabled={state.future.length === 0}
          onClick={() => dispatch({ type: "redo" })}
        >
          <span className="dock-glyph" aria-hidden="true">
            ↷
          </span>
          <span className="dock-label">Redo</span>
        </button>
      </div>
      <div className="dock-group">
        <button type="button" aria-label="Zoom out" className="dock-button" onClick={onZoomOut}>
          <span className="dock-glyph" aria-hidden="true">
            −
          </span>
          <span className="dock-label">Out</span>
        </button>
        <button type="button" aria-label="Zoom in" className="dock-button" onClick={onZoomIn}>
          <span className="dock-glyph" aria-hidden="true">
            +
          </span>
          <span className="dock-label">In</span>
        </button>
      </div>
    </div>
  );
}
