import { useEffect, useState } from "react";
import type { MapSummary } from "@sengoku-jidai/shared";
import { apiErrorMessage, deleteMap, listMaps } from "../client/api.js";
import { createUrl, editorUrl, navigateTo } from "../state/route.js";

export function MapLibraryScreen() {
  const [maps, setMaps] = useState<MapSummary[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  async function load() {
    setLoadError(null);
    try {
      const response = await listMaps();
      setMaps(response.maps);
    } catch (caught) {
      setLoadError(apiErrorMessage(caught));
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function handleDelete(map: MapSummary) {
    if (!window.confirm(`Delete "${map.name}"? This cannot be undone.`)) {
      return;
    }
    setActionError(null);
    try {
      await deleteMap(map.id);
      await load();
    } catch (caught) {
      setActionError(apiErrorMessage(caught));
    }
  }

  return (
    <main className="app-shell app-empty">
      <section className="start-panel map-library" aria-label="Map library">
        <header className="map-library-header">
          <h1>Map library</h1>
          <button
            type="button"
            className="primary-action"
            onClick={() => navigateTo(editorUrl(null))}
          >
            New map
          </button>
          <button type="button" className="secondary-action" onClick={() => navigateTo("/")}>
            Back to game
          </button>
        </header>
        {actionError ? <p className="error-text">{actionError}</p> : null}
        {loadError ? (
          <>
            <p className="error-text">{loadError}</p>
            <button type="button" className="secondary-action" onClick={() => void load()}>
              Retry
            </button>
          </>
        ) : maps === null ? (
          <p className="muted">Loading maps…</p>
        ) : (
          <ul className="map-list">
            {maps.map((map) => (
              <li key={map.id} className="map-row">
                <div className="map-row-info">
                  <strong>{map.name}</strong>
                  <span className="muted">
                    {map.tileCount} tiles
                    {map.builtin ? " · built-in" : ""}
                    {map.updatedAt ? ` · ${new Date(map.updatedAt).toLocaleDateString()}` : ""}
                  </span>
                </div>
                <div className="map-row-actions">
                  <button
                    type="button"
                    className="primary-action"
                    onClick={() => navigateTo(createUrl(map.id))}
                  >
                    New game
                  </button>
                  {!map.builtin ? (
                    <button
                      type="button"
                      className="secondary-action"
                      onClick={() => navigateTo(editorUrl(map.id))}
                    >
                      Edit
                    </button>
                  ) : null}
                  {!map.builtin ? (
                    <button
                      type="button"
                      className="secondary-action"
                      onClick={() => void handleDelete(map)}
                    >
                      Delete
                    </button>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
