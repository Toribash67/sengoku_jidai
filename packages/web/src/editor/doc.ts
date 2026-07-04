import type {
  HexLayout,
  HexMapSource,
  HexTileSource,
  StartingUnits
} from "@sengoku-jidai/engine/client";

/** Native board.svg scale: preview and play render 1:1 with Rivers art. */
export const EDITOR_LAYOUT: HexLayout = { size: 114, originX: 0, originY: 0 };

/** The editor's working document: a HexMapSource that may not be saved yet. */
export interface EditorDoc {
  id: string | null;
  name: string;
  layout: HexLayout;
  tiles: HexTileSource[];
  startingDeployment: Record<string, StartingUnits>;
  bonusSlots: string[];
  /** Monotonic counter behind generated tile ids (t1, t2, …). */
  nextTileNumber: number;
}

export function emptyDoc(): EditorDoc {
  return {
    id: null,
    name: "",
    layout: EDITOR_LAYOUT,
    tiles: [],
    startingDeployment: {},
    bonusSlots: [],
    nextTileNumber: 1
  };
}

export function docFromSource(source: HexMapSource, options: { asCopy: boolean }): EditorDoc {
  let max = 0;
  for (const tile of source.tiles) {
    const match = /^t(\d+)$/.exec(tile.id);
    if (match) {
      max = Math.max(max, Number(match[1]));
    }
  }
  return {
    id: options.asCopy ? null : source.id,
    name: options.asCopy ? `${source.name} (copy)` : source.name,
    layout: source.layout,
    tiles: source.tiles,
    startingDeployment: source.startingDeployment,
    bonusSlots: source.bonusSlots,
    nextTileNumber: max + 1
  };
}

export function docToSource(doc: EditorDoc, id?: string): HexMapSource {
  return {
    id: id ?? doc.id ?? "editor-draft",
    name: doc.name,
    layout: doc.layout,
    tiles: doc.tiles,
    startingDeployment: doc.startingDeployment,
    bonusSlots: doc.bonusSlots
  };
}
