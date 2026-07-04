import { describe, expect, it } from "vitest";
import { emptyDoc } from "../../src/editor/doc.js";
import { clearDraft, loadDraft, saveDraft, type DraftStore } from "../../src/editor/draft.js";

function fakeStore(): DraftStore & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => void data.set(k, v),
    removeItem: (k) => void data.delete(k)
  };
}

describe("drafts", () => {
  it("round-trips under the id key, 'new' for unsaved docs", () => {
    const store = fakeStore();
    const doc = { ...emptyDoc(), name: "WIP" };
    saveDraft(doc, store);
    expect(store.data.has("editor-draft:new")).toBe(true);
    const loaded = loadDraft(null, store);
    expect(loaded?.doc.name).toBe("WIP");
    expect(typeof loaded?.savedAt).toBe("string");
    clearDraft(null, store);
    expect(loadDraft(null, store)).toBeNull();
  });

  it("uses the map id as key once saved", () => {
    const store = fakeStore();
    saveDraft({ ...emptyDoc(), id: "abc" }, store);
    expect(loadDraft("abc", store)).not.toBeNull();
    expect(loadDraft(null, store)).toBeNull();
  });

  it("tolerates corrupt payloads", () => {
    const store = fakeStore();
    store.setItem("editor-draft:new", "{nope");
    expect(loadDraft(null, store)).toBeNull();
  });
});
