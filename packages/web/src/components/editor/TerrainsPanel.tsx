import { useEffect, useRef, useState } from "react";
import {
  DEFAULT_TERRAIN_STYLE,
  MAX_TERRAINS_PER_MAP,
  TERRAIN_STYLES,
  type TerrainInfo,
  type TerrainStyleId
} from "@sengoku-jidai/shared";
import {
  ApiError,
  createTerrain,
  deleteTerrain,
  fetchMap,
  renameTerrain
} from "../../client/api.js";
import { defaultSelection } from "../board/terrainImages.js";

/** Pure: is a generation in flight for this map? (one-at-a-time per map on the server) */
export function isGenerating(terrains: TerrainInfo[]): boolean {
  return terrains.some((terrain) => terrain.status === "pending");
}

/** Pure: whether "Generate" is enabled, and the disabled reason to show. Precedence:
 *  unavailable > generating > cap. */
export function canGenerate(args: {
  terrains: TerrainInfo[];
  unavailable: boolean;
}): { enabled: boolean; reason: string | null } {
  if (args.unavailable) {
    return { enabled: false, reason: "Terrain generation isn’t configured on the server." };
  }
  if (isGenerating(args.terrains)) {
    return { enabled: false, reason: "Generating…" };
  }
  if (args.terrains.length >= MAX_TERRAINS_PER_MAP) {
    return { enabled: false, reason: `Maximum ${MAX_TERRAINS_PER_MAP} terrains.` };
  }
  return { enabled: true, reason: null };
}

/** Pure: how a failed generate POST should affect panel state, by HTTP status. */
export function generateErrorEffect(
  status: number | null
): "unavailable" | "cap" | "inProgress" | "failed" {
  if (status === 503) {
    return "unavailable";
  }
  if (status === 422) {
    return "cap";
  }
  if (status === 409) {
    return "inProgress";
  }
  return "failed";
}

/** Pure: human label for a style id, falling back to the raw id. */
export function styleLabel(styleId: string): string {
  return TERRAIN_STYLES.find((style) => style.id === styleId)?.label ?? styleId;
}

export function TerrainsPanel({
  mapId,
  terrains,
  selectedTerrainId,
  onSelect,
  onTerrainsChange
}: {
  mapId: string;
  terrains: TerrainInfo[];
  selectedTerrainId: string | null;
  onSelect: (id: string | null) => void;
  onTerrainsChange: (terrains: TerrainInfo[]) => void;
}) {
  const [style, setStyle] = useState<TerrainStyleId>(DEFAULT_TERRAIN_STYLE);
  const [unavailable, setUnavailable] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [confirmingDeleteId, setConfirmingDeleteId] = useState<string | null>(null);

  // Poll while a generation is in flight. The effect re-runs whenever `terrains` changes: each
  // poll updates `terrains` via onTerrainsChange, which reschedules the next poll; when nothing is
  // pending the effect returns early and polling stops. onTerrainsChange must be stable
  // (EditorScreen wraps it in useCallback).
  useEffect(() => {
    if (!isGenerating(terrains)) {
      return;
    }
    const run = { cancelled: false };
    const timer = window.setTimeout(() => {
      void fetchMap(mapId)
        .then((detail) => {
          if (!run.cancelled) {
            onTerrainsChange(detail.terrains);
          }
        })
        .catch(() => {
          /* transient error: stop polling, leave state as-is */
        });
    }, 1500);
    return () => {
      run.cancelled = true;
      window.clearTimeout(timer);
    };
  }, [terrains, mapId, onTerrainsChange]);

  async function refetch(): Promise<TerrainInfo[] | null> {
    try {
      const detail = await fetchMap(mapId);
      onTerrainsChange(detail.terrains);
      return detail.terrains;
    } catch {
      return null;
    }
  }

  function applyGenerateError(err: unknown): void {
    const status = err instanceof ApiError ? err.status : null;
    switch (generateErrorEffect(status)) {
      case "unavailable":
        setUnavailable(true);
        break;
      case "cap":
      case "inProgress":
        void refetch(); // list will reflect the cap / the in-flight generation (polling resumes)
        break;
      case "failed":
        setError("Generation failed — try again.");
        break;
    }
  }

  async function handleGenerate(): Promise<void> {
    setError(null);
    setBusy(true);
    try {
      const { id } = await createTerrain(mapId, style);
      onSelect(id); // auto-select: preview reveals it once it turns ready
      await refetch();
    } catch (err) {
      applyGenerateError(err);
    } finally {
      setBusy(false);
    }
  }

  async function handleRetry(terrain: TerrainInfo): Promise<void> {
    setError(null);
    setBusy(true);
    try {
      await deleteTerrain(mapId, terrain.id);
      const { id } = await createTerrain(mapId, terrain.styleId);
      onSelect(id);
      await refetch();
    } catch (err) {
      applyGenerateError(err);
      await refetch();
    } finally {
      setBusy(false);
    }
  }

  const renameHandledRef = useRef(false);

  function startRename(terrain: TerrainInfo): void {
    renameHandledRef.current = false;
    setEditingId(terrain.id);
    setEditName(terrain.name);
  }

  // Commit (Enter/blur) or cancel (Escape) the in-progress rename. Both paths funnel through here;
  // renameHandledRef ensures only the first wins, so the browser's blur-on-unmount (fired when the
  // input is replaced by the button) cannot re-commit after Enter or override an Escape.
  async function finishRename(commit: boolean): Promise<void> {
    if (renameHandledRef.current) {
      return;
    }
    renameHandledRef.current = true;
    const id = editingId;
    setEditingId(null);
    if (!commit || id === null) {
      return;
    }
    const name = editName.trim();
    const current = terrains.find((terrain) => terrain.id === id);
    if (name.length === 0 || !current || name === current.name) {
      return; // empty or unchanged: no-op
    }
    onTerrainsChange(terrains.map((terrain) => (terrain.id === id ? { ...terrain, name } : terrain)));
    try {
      await renameTerrain(mapId, id, name);
    } catch {
      setError("Rename failed.");
      await refetch();
    }
  }

  async function confirmDelete(id: string): Promise<void> {
    setConfirmingDeleteId(null);
    setBusy(true);
    try {
      await deleteTerrain(mapId, id);
    } catch (err) {
      if (!(err instanceof ApiError && err.status === 404)) {
        setError("Delete failed.");
      }
    }
    const next = await refetch();
    if (next && selectedTerrainId === id) {
      onSelect(defaultSelection(next));
    }
    setBusy(false);
  }

  const gen = canGenerate({ terrains, unavailable });

  return (
    <div className="editor-terrains">
      <div className="terrains-head">
        <span className="terrains-title">Terrains</span>
        <select
          aria-label="Terrain style"
          value={style}
          disabled={busy}
          onChange={(event) => setStyle(event.target.value as TerrainStyleId)}
        >
          {TERRAIN_STYLES.map((option) => (
            <option key={option.id} value={option.id}>
              {option.label}
            </option>
          ))}
        </select>
        <button type="button" onClick={() => void handleGenerate()} disabled={!gen.enabled || busy}>
          + Generate
        </button>
        {gen.reason ? <span className="muted">{gen.reason}</span> : null}
      </div>

      <ul className="terrains-list">
        <li className="terrain-row">
          <label className="terrain-select">
            <input
              type="radio"
              name="terrain-preview"
              checked={selectedTerrainId === null}
              onChange={() => onSelect(null)}
            />
            <span>Flat (no terrain)</span>
          </label>
        </li>
        {terrains.map((terrain) => {
          const ready = terrain.status === "ready";
          return (
            <li key={terrain.id} className="terrain-row">
              <input
                type="radio"
                name="terrain-preview"
                aria-label={`Preview ${terrain.name}`}
                checked={selectedTerrainId === terrain.id}
                disabled={!ready}
                onChange={() => onSelect(terrain.id)}
              />
              {editingId === terrain.id ? (
                <input
                  className="terrain-name-edit"
                  aria-label="Terrain name"
                  value={editName}
                  maxLength={40}
                  autoFocus
                  onChange={(event) => setEditName(event.target.value)}
                  onBlur={() => void finishRename(true)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      void finishRename(true);
                    } else if (event.key === "Escape") {
                      void finishRename(false);
                    }
                  }}
                />
              ) : (
                <button type="button" className="terrain-name" onClick={() => startRename(terrain)}>
                  {terrain.name}
                </button>
              )}
              <span className="terrain-style muted">{styleLabel(terrain.styleId)}</span>
              <span className={`terrain-badge is-${terrain.status}`}>{terrain.status}</span>
              {terrain.status === "failed" ? (
                <button type="button" onClick={() => void handleRetry(terrain)} disabled={busy}>
                  Retry
                </button>
              ) : null}
              {confirmingDeleteId === terrain.id ? (
                <span className="terrain-confirm">
                  <span>Delete this terrain?</span>
                  <button type="button" onClick={() => void confirmDelete(terrain.id)} disabled={busy}>
                    Delete
                  </button>
                  <button type="button" onClick={() => setConfirmingDeleteId(null)}>
                    Cancel
                  </button>
                </span>
              ) : (
                <button
                  type="button"
                  className="terrain-delete"
                  aria-label={`Delete ${terrain.name}`}
                  onClick={() => setConfirmingDeleteId(terrain.id)}
                  disabled={busy}
                >
                  🗑
                </button>
              )}
            </li>
          );
        })}
      </ul>
      {error ? <span className="muted">{error}</span> : null}
    </div>
  );
}
