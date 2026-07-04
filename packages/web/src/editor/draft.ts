import type { EditorDoc } from "./doc.js";

export interface DraftStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface SavedDraft {
  doc: EditorDoc;
  savedAt: string;
}

function draftKey(id: string | null): string {
  return `editor-draft:${id ?? "new"}`;
}

export function saveDraft(doc: EditorDoc, store: DraftStore = window.localStorage): void {
  store.setItem(draftKey(doc.id), JSON.stringify({ doc, savedAt: new Date().toISOString() }));
}

export function loadDraft(
  id: string | null,
  store: DraftStore = window.localStorage
): SavedDraft | null {
  const raw = store.getItem(draftKey(id));
  if (!raw) {
    return null;
  }
  try {
    const parsed = JSON.parse(raw) as SavedDraft;
    if (!parsed || !Array.isArray(parsed.doc?.tiles) || typeof parsed.savedAt !== "string") {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function clearDraft(id: string | null, store: DraftStore = window.localStorage): void {
  store.removeItem(draftKey(id));
}
