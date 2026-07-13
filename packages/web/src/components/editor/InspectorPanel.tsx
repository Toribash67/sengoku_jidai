import { useEffect, useState, type Dispatch, type ReactNode } from "react";
import type { HexTileSource, SeatId } from "@sengoku-jidai/engine/client";
import { riversRuleset } from "@sengoku-jidai/engine/client";
import { canMergeSelection, type EditorAction, type EditorState } from "../../editor/reducer.js";

export function InspectorPanel({
  state,
  dispatch
}: {
  state: EditorState;
  dispatch: Dispatch<EditorAction>;
}) {
  const { doc, selection } = state;
  const primary = doc.tiles.find((t) => t.id === selection[0]);
  // On phones the panel is a bottom sheet, collapsed by default; selecting opens it.
  // On desktop the toggle and the collapsed state are inert (CSS ignores them).
  const [collapsed, setCollapsed] = useState(true);
  // Re-open on every tile-selecting tap — keyed on selectEpoch (bumps even when re-tapping the
  // same tile), not on the selection contents, so a manually-collapsed sheet reopens on re-tap.
  useEffect(() => {
    if (selection.length > 0) {
      setCollapsed(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.selectEpoch]);

  const title =
    selection.length > 1
      ? `${selection.length} tiles selected`
      : primary
        ? `${primary.kind === "land" ? "Land tile" : "Sea tile"} · ${primary.hexes.length} ${
            primary.hexes.length === 1 ? "hex" : "hexes"
          }`
        : `Map · ${doc.tiles.length} ${doc.tiles.length === 1 ? "tile" : "tiles"}`;

  return (
    <aside className={`editor-inspector${collapsed ? " is-collapsed" : ""}`}>
      <div className="inspector-header" onClick={() => setCollapsed((c) => !c)}>
        <h2>{title}</h2>
        <button
          type="button"
          className="inspector-toggle"
          aria-expanded={!collapsed}
          aria-label={collapsed ? "Expand inspector" : "Collapse inspector"}
          onClick={(event) => {
            event.stopPropagation();
            setCollapsed((c) => !c);
          }}
        >
          {collapsed ? "▲" : "▼"}
        </button>
      </div>
      <div className="inspector-body">
        {selection.length > 1 ? (
          <MultiBody state={state} dispatch={dispatch} />
        ) : primary ? (
          <TileBody primary={primary} state={state} dispatch={dispatch} />
        ) : (
          <SummaryBody state={state} />
        )}
      </div>
    </aside>
  );
}

function MultiBody({
  state,
  dispatch
}: {
  state: EditorState;
  dispatch: Dispatch<EditorAction>;
}): ReactNode {
  const { doc, selection } = state;
  return (
    <>
      <button
        type="button"
        className="primary-action"
        disabled={!canMergeSelection(doc, selection)}
        onClick={() => dispatch({ type: "mergeSelection" })}
      >
        Merge tiles
      </button>
      <p className="muted">Merging requires the same kind and touching edges.</p>
    </>
  );
}

function SummaryBody({ state }: { state: EditorState }): ReactNode {
  const { doc } = state;
  const hqSeats = doc.tiles.filter((t) => t.features.hq).map((t) => t.features.hq);
  return (
    <>
      <ul className="editor-tally">
        <li>{doc.tiles.length} tiles</li>
        <li>Red HQ: {hqSeats.includes("red") ? "placed" : "missing"}</li>
        <li>Black HQ: {hqSeats.includes("black") ? "placed" : "missing"}</li>
        <li>
          Bonus slots: {doc.bonusSlots.length} of {riversRuleset.bonusSet.length}
        </li>
      </ul>
      <p className="muted">Tap a tile to edit it; use Multi to select several.</p>
    </>
  );
}

function TileBody({
  primary,
  state,
  dispatch
}: {
  primary: HexTileSource;
  state: EditorState;
  dispatch: Dispatch<EditorAction>;
}): ReactNode {
  const { doc } = state;
  const tileId = primary.id;
  const deployment = doc.startingDeployment[tileId];
  const isLand = primary.kind === "land";

  return (
    <>
      {isLand ? (
        <>
          <label className="field">
            <span>HQ owner</span>
            <select
              value={primary.features.hq ?? "none"}
              onChange={(event) =>
                dispatch({
                  type: "setFeature",
                  tileId,
                  patch: {
                    hq: event.target.value === "none" ? null : (event.target.value as SeatId)
                  }
                })
              }
            >
              <option value="none">None</option>
              <option value="red">Red</option>
              <option value="black">Black</option>
            </select>
          </label>
          <label className="field">
            <span>Value stars</span>
            <select
              value={primary.features.valueStars ?? 0}
              onChange={(event) =>
                dispatch({
                  type: "setFeature",
                  tileId,
                  patch: { valueStars: Number(event.target.value) as 0 | 1 | 2 }
                })
              }
            >
              <option value={0}>None</option>
              <option value={1}>★</option>
              <option value={2}>★★</option>
            </select>
          </label>
          <label className="check">
            <input
              type="checkbox"
              checked={primary.features.shellable === true}
              onChange={(event) =>
                dispatch({ type: "setFeature", tileId, patch: { shellable: event.target.checked } })
              }
            />
            <span>Shellable</span>
          </label>
        </>
      ) : null}

      <label className="check">
        <input
          type="checkbox"
          checked={primary.features.harbor === true}
          onChange={(event) =>
            dispatch({ type: "setFeature", tileId, patch: { harbor: event.target.checked } })
          }
        />
        <span>Harbor</span>
      </label>

      {primary.features.harbor ? (
        <div className="editor-ports-list">
          <h3>Ports</h3>
          {(primary.ports ?? []).map((seaId) => (
            <div key={seaId} className="editor-port-row">
              <span>{seaId}</span>
              <button
                type="button"
                onClick={() => dispatch({ type: "removePort", harborId: tileId, seaId })}
              >
                Remove
              </button>
            </div>
          ))}
          <button
            type="button"
            aria-pressed={state.portArming}
            onClick={() => dispatch({ type: "armPort", arming: !state.portArming })}
          >
            Add port
          </button>
          {state.portArming ? <p className="muted">Click a sea tile on the map…</p> : null}
        </div>
      ) : null}

      <label className="check">
        <input
          type="checkbox"
          checked={doc.bonusSlots.includes(tileId)}
          onChange={() => dispatch({ type: "toggleBonusSlot", tileId })}
        />
        <span>Bonus slot</span>
      </label>

      <h3>Starting deployment</h3>
      <label className="field">
        <span>Deployment seat</span>
        <select
          value={deployment?.seat ?? "none"}
          onChange={(event) => {
            const value = event.target.value;
            if (value === "none") {
              dispatch({ type: "setDeployment", tileId, units: null });
            } else {
              const seat = value as SeatId;
              dispatch({
                type: "setDeployment",
                tileId,
                units: deployment
                  ? { ...deployment, seat }
                  : { seat, ...(isLand ? { troop: 1 } : { ship: 1 }) }
              });
            }
          }}
        >
          <option value="none">None</option>
          <option value="red">Red</option>
          <option value="black">Black</option>
        </select>
      </label>
      {deployment ? (
        <>
          {isLand ? (
            <label className="field">
              <span>Troops</span>
              <input
                type="number"
                min={0}
                max={20}
                value={deployment.troop ?? 0}
                onChange={(event) =>
                  dispatch({
                    type: "setDeployment",
                    tileId,
                    units: { ...deployment, troop: Math.max(0, Number(event.target.value) || 0) }
                  })
                }
              />
            </label>
          ) : (
            <label className="field">
              <span>Ships</span>
              <input
                type="number"
                min={0}
                max={20}
                value={deployment.ship ?? 0}
                onChange={(event) =>
                  dispatch({
                    type: "setDeployment",
                    tileId,
                    units: { ...deployment, ship: Math.max(0, Number(event.target.value) || 0) }
                  })
                }
              />
            </label>
          )}
        </>
      ) : null}

      {primary.hexes.length > 1 ? (
        <button
          type="button"
          className="secondary-action"
          onClick={() => dispatch({ type: "unmergeTile", tileId })}
        >
          Unmerge tile
        </button>
      ) : null}
    </>
  );
}
