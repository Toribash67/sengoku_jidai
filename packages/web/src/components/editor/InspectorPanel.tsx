import type { Dispatch } from "react";
import type { SeatId } from "@sengoku-jidai/engine/client";
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

  if (selection.length > 1) {
    return (
      <aside className="editor-inspector">
        <h2>{selection.length} tiles selected</h2>
        <button
          type="button"
          className="primary-action"
          disabled={!canMergeSelection(doc, selection)}
          onClick={() => dispatch({ type: "mergeSelection" })}
        >
          Merge tiles
        </button>
        <p className="muted">Merging requires the same kind and touching edges.</p>
      </aside>
    );
  }

  if (!primary) {
    const hqSeats = doc.tiles.filter((t) => t.features.hq).map((t) => t.features.hq);
    return (
      <aside className="editor-inspector">
        <h2>Map</h2>
        <ul className="editor-tally">
          <li>{doc.tiles.length} tiles</li>
          <li>Red HQ: {hqSeats.includes("red") ? "placed" : "missing"}</li>
          <li>Black HQ: {hqSeats.includes("black") ? "placed" : "missing"}</li>
          <li>
            Bonus slots: {doc.bonusSlots.length} of {riversRuleset.bonusSet.length}
          </li>
        </ul>
        <p className="muted">Click a tile to edit it; shift-click to select several.</p>
      </aside>
    );
  }

  const tileId = primary.id;
  const deployment = doc.startingDeployment[tileId];
  const isLand = primary.kind === "land";

  return (
    <aside className="editor-inspector">
      <h2>
        {isLand ? "Land tile" : "Sea tile"} · {primary.hexes.length}{" "}
        {primary.hexes.length === 1 ? "hex" : "hexes"}
      </h2>

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
    </aside>
  );
}
