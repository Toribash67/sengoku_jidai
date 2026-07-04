import type { Axial, HexTileSource, SeatId, StartingUnits } from "@sengoku-jidai/engine/client";
import { axialKey, axialToPixel, neighbors } from "@sengoku-jidai/engine/client";
import type { EditorDoc } from "./doc.js";

export type Tool = "select" | "land" | "sea" | "erase";

export interface EditorState {
  doc: EditorDoc;
  tool: Tool;
  /** Selected tile ids; [0] is the primary (inspector subject, merge survivor). */
  selection: string[];
  /** True while "Add port" waits for a sea-tile click (applies to selection[0]). */
  portArming: boolean;
  past: EditorDoc[];
  future: EditorDoc[];
}

export type FeaturePatch = {
  hq?: SeatId | null;
  valueStars?: 0 | 1 | 2;
  harbor?: boolean;
  shellable?: boolean;
};

export type EditorAction =
  | { type: "setTool"; tool: Tool }
  | { type: "paintHex"; kind: "land" | "sea"; hex: Axial }
  | { type: "eraseHex"; hex: Axial }
  | { type: "selectTile"; tileId: string | null; additive?: boolean }
  | { type: "mergeSelection" }
  | { type: "unmergeTile"; tileId: string }
  | { type: "setFeature"; tileId: string; patch: FeaturePatch }
  | { type: "armPort"; arming: boolean }
  | { type: "removePort"; harborId: string; seaId: string }
  | { type: "setDeployment"; tileId: string; units: StartingUnits | null }
  | { type: "toggleBonusSlot"; tileId: string }
  | { type: "setName"; name: string }
  | { type: "undo" }
  | { type: "redo" }
  | { type: "loadDoc"; doc: EditorDoc };

const HISTORY_LIMIT = 100;

export function initialEditorState(doc: EditorDoc): EditorState {
  return { doc, tool: "land", selection: [], portArming: false, past: [], future: [] };
}

export function tileAt(doc: EditorDoc, hex: Axial): HexTileSource | undefined {
  const key = axialKey(hex);
  return doc.tiles.find((t) => t.hexes.some((h) => axialKey(h) === key));
}

/** Edge-connected components, discovery order = first-hex order in the input. */
export function connectedComponents(hexes: Axial[]): Axial[][] {
  const remaining = new Map(hexes.map((h) => [axialKey(h), h] as const));
  const components: Axial[][] = [];
  for (const hex of hexes) {
    const key = axialKey(hex);
    if (!remaining.has(key)) {
      continue;
    }
    remaining.delete(key);
    const component: Axial[] = [];
    const stack = [hex];
    while (stack.length > 0) {
      const current = stack.pop()!;
      component.push(current);
      for (const n of neighbors(current)) {
        const nKey = axialKey(n);
        const found = remaining.get(nKey);
        if (found) {
          remaining.delete(nKey);
          stack.push(found);
        }
      }
    }
    components.push(component);
  }
  return components;
}

/** Drop tiles and scrub every reference to them (ports, deployment, bonus slots). */
function dropTiles(doc: EditorDoc, ids: string[]): EditorDoc {
  const removed = new Set(ids);
  const tiles = doc.tiles
    .filter((t) => !removed.has(t.id))
    .map((t) => {
      if (!t.ports || !t.ports.some((p) => removed.has(p))) {
        return t;
      }
      const ports = t.ports.filter((p) => !removed.has(p));
      const next: HexTileSource = { ...t };
      if (ports.length > 0) {
        next.ports = ports;
      } else {
        delete next.ports;
      }
      return next;
    });
  const startingDeployment = Object.fromEntries(
    Object.entries(doc.startingDeployment).filter(([id]) => !removed.has(id))
  );
  const bonusSlots = doc.bonusSlots.filter((id) => !removed.has(id));
  return { ...doc, tiles, startingDeployment, bonusSlots };
}

/** Remove one hex from a tile: delete a 1-hex tile, else split the remainder into
 *  connected components — the largest (ties: discovery order) keeps id/features/ports. */
function removeHex(doc: EditorDoc, tileId: string, hex: Axial): EditorDoc {
  const tile = doc.tiles.find((t) => t.id === tileId)!;
  if (tile.hexes.length === 1) {
    return dropTiles(doc, [tileId]);
  }
  const key = axialKey(hex);
  const remaining = tile.hexes.filter((h) => axialKey(h) !== key);
  const components = connectedComponents(remaining).sort((a, b) => b.length - a.length);
  const [surviving, ...rest] = components;
  let nextNumber = doc.nextTileNumber;
  const fresh: HexTileSource[] = rest.map((hexes) => ({
    id: `t${nextNumber++}`,
    kind: tile.kind,
    hexes,
    features: {}
  }));
  const tiles = doc.tiles
    .map((t) => (t.id === tileId ? { ...t, hexes: surviving! } : t))
    .concat(fresh);
  return { ...doc, tiles, nextTileNumber: nextNumber };
}

function paintHex(doc: EditorDoc, kind: "land" | "sea", hex: Axial): EditorDoc {
  const owner = tileAt(doc, hex);
  if (owner && owner.kind === kind) {
    return doc;
  }
  const cleared = owner ? removeHex(doc, owner.id, hex) : doc;
  const tile: HexTileSource = {
    id: `t${cleared.nextTileNumber}`,
    kind,
    hexes: [hex],
    features: {}
  };
  return {
    ...cleared,
    tiles: [...cleared.tiles, tile],
    nextTileNumber: cleared.nextTileNumber + 1
  };
}

function eraseHex(doc: EditorDoc, hex: Axial): EditorDoc {
  const owner = tileAt(doc, hex);
  return owner ? removeHex(doc, owner.id, hex) : doc;
}

/** Keep selection/portArming meaningful after any doc change. */
function normalize(state: EditorState): EditorState {
  const ids = new Set(state.doc.tiles.map((t) => t.id));
  const selection = state.selection.filter((id) => ids.has(id));
  const primary = state.doc.tiles.find((t) => t.id === selection[0]);
  const portArming = state.portArming && primary?.features.harbor === true;
  if (selection.length === state.selection.length && portArming === state.portArming) {
    return state;
  }
  return { ...state, selection, portArming };
}

/** Record history and swap in a new doc (no-op when the doc is unchanged). */
function withDoc(state: EditorState, doc: EditorDoc, extra?: Partial<EditorState>): EditorState {
  if (doc === state.doc) {
    return extra ? normalize({ ...state, ...extra }) : state;
  }
  return normalize({
    ...state,
    ...extra,
    doc,
    past: [...state.past, state.doc].slice(-HISTORY_LIMIT),
    future: []
  });
}

export function editorReducer(state: EditorState, action: EditorAction): EditorState {
  switch (action.type) {
    case "setTool":
      return { ...state, tool: action.tool, portArming: false };
    case "loadDoc":
      return initialEditorState(action.doc);
    case "paintHex":
      return withDoc(state, paintHex(state.doc, action.kind, action.hex));
    case "eraseHex":
      return withDoc(state, eraseHex(state.doc, action.hex));
    case "selectTile": {
      if (action.tileId === null) {
        return { ...state, selection: [], portArming: false };
      }
      const selection = action.additive
        ? state.selection.includes(action.tileId)
          ? state.selection.filter((id) => id !== action.tileId)
          : [...state.selection, action.tileId]
        : [action.tileId];
      return normalize({ ...state, selection });
    }
    case "undo": {
      const previous = state.past[state.past.length - 1];
      if (!previous) {
        return state;
      }
      return normalize({
        ...state,
        doc: previous,
        past: state.past.slice(0, -1),
        future: [state.doc, ...state.future]
      });
    }
    case "redo": {
      const [next, ...future] = state.future;
      if (!next) {
        return state;
      }
      return normalize({ ...state, doc: next, past: [...state.past, state.doc], future });
    }
    default:
      // Remaining actions land in Tasks 8–9.
      return state;
  }
}

// axialToPixel is unused until Task 8 wires up preview rendering; keep the import alive.
void axialToPixel;
