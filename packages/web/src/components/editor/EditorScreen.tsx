import { useEffect, useMemo, useReducer, useRef, useState } from "react";
import type { HexMapSource } from "@sengoku-jidai/engine/client";
import { apiErrorMessage, fetchMap } from "../../client/api.js";
import { docFromSource, emptyDoc } from "../../editor/doc.js";
import { clearDraft, loadDraft, saveDraft, type SavedDraft } from "../../editor/draft.js";
import { editorReducer, initialEditorState } from "../../editor/reducer.js";
import { persistDoc } from "../../editor/save.js";
import { validationMessage } from "../../editor/validation.js";
import { createUrl, editorUrl, mapsUrl, navigateTo } from "../../state/route.js";
import { EditorCanvas } from "./EditorCanvas.js";
import { EditorToolbar } from "./EditorToolbar.js";
import { InspectorPanel } from "./InspectorPanel.js";

export function EditorScreen({ mapId }: { mapId: string | null }) {
  const [state, dispatch] = useReducer(editorReducer, emptyDoc(), initialEditorState);
  const [loading, setLoading] = useState(mapId !== null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [pendingDraft, setPendingDraft] = useState<SavedDraft | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [savedId, setSavedId] = useState<string | null>(null);
  const draftTimer = useRef<number | null>(null);

  // Load the map (or offer a draft for /maps/new).
  useEffect(() => {
    let cancelled = false;
    setSavedId(null);
    setSaveError(null);
    if (mapId === null) {
      dispatch({ type: "loadDoc", doc: emptyDoc() });
      setPendingDraft(loadDraft(null));
      setLoading(false);
      return;
    }
    setLoading(true);
    setLoadError(null);
    fetchMap(mapId)
      .then((detail) => {
        if (cancelled) {
          return;
        }
        dispatch({
          type: "loadDoc",
          doc: docFromSource(detail.source as HexMapSource, { asCopy: detail.builtin })
        });
        const draft = loadDraft(detail.builtin ? null : mapId);
        if (draft && (!detail.updatedAt || draft.savedAt > detail.updatedAt)) {
          setPendingDraft(draft);
        }
        setLoading(false);
      })
      .catch((caught) => {
        if (!cancelled) {
          setLoadError(apiErrorMessage(caught));
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [mapId]);

  // Debounced draft autosave (paused while a restore decision is pending).
  useEffect(() => {
    if (loading || pendingDraft) {
      return;
    }
    if (draftTimer.current !== null) {
      window.clearTimeout(draftTimer.current);
    }
    draftTimer.current = window.setTimeout(() => saveDraft(state.doc), 500);
    return () => {
      if (draftTimer.current !== null) {
        window.clearTimeout(draftTimer.current);
      }
    };
  }, [state.doc, loading, pendingDraft]);

  const problem = useMemo(() => validationMessage(state.doc), [state.doc]);

  async function handleSave() {
    setSaving(true);
    setSaveError(null);
    setSavedId(null);
    setPendingDraft(null);
    try {
      const previousId = state.doc.id;
      const detail = await persistDoc(state.doc);
      clearDraft(previousId);
      setSavedId(detail.id);
      if (previousId === null) {
        dispatch({
          type: "loadDoc",
          doc: docFromSource(detail.source as HexMapSource, { asCopy: false })
        });
        // Rebind the URL without navigateTo: a popstate would re-run the load
        // effect, which refetches and clears the "Saved" toast.
        window.history.replaceState(null, "", editorUrl(detail.id));
      }
    } catch (caught) {
      setSaveError(apiErrorMessage(caught));
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <main className="app-shell app-empty">
        <p className="muted">Loading map…</p>
      </main>
    );
  }
  if (loadError) {
    return (
      <main className="app-shell app-empty">
        <section className="start-panel" aria-label="Map editor">
          <p className="error-text">{loadError}</p>
          <button type="button" className="secondary-action" onClick={() => navigateTo(mapsUrl())}>
            Back to library
          </button>
        </section>
      </main>
    );
  }

  return (
    <main className="editor-shell">
      <header className="editor-header">
        <button type="button" className="secondary-action" onClick={() => navigateTo(mapsUrl())}>
          Back to library
        </button>
        <label className="field editor-name">
          <span>Map name</span>
          <input
            type="text"
            value={state.doc.name}
            maxLength={80}
            placeholder="e.g. Twin Rivers"
            onChange={(event) => dispatch({ type: "setName", name: event.target.value })}
          />
        </label>
        <span className={problem ? "editor-status is-invalid" : "editor-status is-valid"}>
          {problem ?? "Map is valid"}
        </span>
        <button
          type="button"
          className="primary-action"
          disabled={saving}
          onClick={() => void handleSave()}
        >
          {saving ? "Saving…" : "Save map"}
        </button>
      </header>

      {pendingDraft ? (
        <div className="editor-banner">
          <span>Unsaved draft from {new Date(pendingDraft.savedAt).toLocaleString()}.</span>
          <button
            type="button"
            onClick={() => {
              dispatch({ type: "loadDoc", doc: pendingDraft.doc });
              setPendingDraft(null);
            }}
          >
            Restore draft
          </button>
          <button
            type="button"
            onClick={() => {
              clearDraft(pendingDraft.doc.id);
              setPendingDraft(null);
            }}
          >
            Discard draft
          </button>
        </div>
      ) : null}
      {saveError ? <p className="error-text editor-save-error">{saveError}</p> : null}
      {savedId ? (
        <div className="editor-toast">
          <span>Saved.</span>
          <button type="button" onClick={() => navigateTo(mapsUrl())}>
            Back to library
          </button>
          <button type="button" onClick={() => navigateTo(createUrl(savedId))}>
            New game on this map
          </button>
        </div>
      ) : null}

      <div className="editor-body">
        <EditorToolbar state={state} dispatch={dispatch} />
        <EditorCanvas state={state} dispatch={dispatch} />
        <InspectorPanel state={state} dispatch={dispatch} />
      </div>
    </main>
  );
}
