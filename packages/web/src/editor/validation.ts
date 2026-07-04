import { validateHexMap } from "@sengoku-jidai/engine/client";
import { docToSource, type EditorDoc } from "./doc.js";

/** Null when the doc passes the engine's structural validation, else its message.
 *  Client-side UX only — the server re-runs the authoritative pipeline on save. */
export function validationMessage(doc: EditorDoc): string | null {
  try {
    validateHexMap(docToSource(doc));
    return null;
  } catch (caught) {
    return caught instanceof Error ? caught.message : String(caught);
  }
}
