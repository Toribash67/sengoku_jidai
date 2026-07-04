import type { MapDetail } from "@sengoku-jidai/shared";
import { createMap, updateMap } from "../client/api.js";
import { docToSource, type EditorDoc } from "./doc.js";

/** Persist the doc: POST for never-saved docs (server assigns the real id), PUT otherwise. */
export async function persistDoc(doc: EditorDoc): Promise<MapDetail> {
  const name = doc.name.trim();
  if (name.length === 0) {
    throw new Error("Name your map before saving.");
  }
  const named = { ...doc, name };
  if (doc.id === null) {
    return createMap(docToSource(named, "new-map"));
  }
  return updateMap(doc.id, docToSource(named));
}
