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

export function canMergeSelection(doc: EditorDoc, selection: string[]): boolean {
  if (selection.length < 2) {
    return false;
  }
  const tiles = selection.map((id) => doc.tiles.find((t) => t.id === id));
  if (tiles.some((t) => t === undefined)) {
    return false;
  }
  const kind = tiles[0]!.kind;
  if (tiles.some((t) => t!.kind !== kind)) {
    return false;
  }
  const union = tiles.flatMap((t) => t!.hexes);
  return connectedComponents(union).length === 1;
}

function dedupe(ids: string[]): string[] {
  return [...new Set(ids)];
}

function mergeSelection(doc: EditorDoc, selection: string[]): EditorDoc {
  if (!canMergeSelection(doc, selection)) {
    return doc;
  }
  const [survivorId, ...absorbedIds] = selection;
  const absorbed = new Set(absorbedIds);
  const mergedHexes = selection.flatMap((id) => doc.tiles.find((t) => t.id === id)!.hexes);

  const startingDeployment = { ...doc.startingDeployment };
  if (!startingDeployment[survivorId!]) {
    const donor = absorbedIds.find((id) => startingDeployment[id]);
    if (donor) {
      startingDeployment[survivorId!] = startingDeployment[donor]!;
    }
  }
  for (const id of absorbedIds) {
    delete startingDeployment[id];
  }

  const bonusSlots = dedupe(doc.bonusSlots.map((id) => (absorbed.has(id) ? survivorId! : id)));

  const tiles = doc.tiles
    .filter((t) => !absorbed.has(t.id))
    .map((t) => {
      const base = t.id === survivorId ? { ...t, hexes: mergedHexes } : t;
      if (!base.ports || !base.ports.some((p) => absorbed.has(p))) {
        return base;
      }
      return { ...base, ports: dedupe(base.ports.map((p) => (absorbed.has(p) ? survivorId! : p))) };
    });

  return { ...doc, tiles, startingDeployment, bonusSlots };
}

function setFeature(doc: EditorDoc, tileId: string, patch: FeaturePatch): EditorDoc {
  const tiles = doc.tiles.map((t) => {
    if (t.id !== tileId) {
      if (patch.hq && t.features.hq === patch.hq) {
        const { hq: _stolen, ...rest } = t.features;
        return { ...t, features: rest };
      }
      return t;
    }
    const features = { ...t.features };
    if ("hq" in patch) {
      if (patch.hq) {
        features.hq = patch.hq;
      } else {
        delete features.hq;
      }
    }
    if (patch.valueStars !== undefined) {
      if (patch.valueStars > 0) {
        features.valueStars = patch.valueStars;
      } else {
        delete features.valueStars;
      }
    }
    if (patch.harbor !== undefined) {
      if (patch.harbor) {
        features.harbor = true;
      } else {
        delete features.harbor;
      }
    }
    if (patch.shellable !== undefined) {
      if (patch.shellable) {
        features.shellable = true;
      } else {
        delete features.shellable;
      }
    }
    const next: HexTileSource = { ...t, features };
    if (patch.harbor === false) {
      delete next.ports;
    }
    return next;
  });
  return { ...doc, tiles };
}

function addPort(doc: EditorDoc, harborId: string, seaId: string): EditorDoc {
  const harbor = doc.tiles.find((t) => t.id === harborId);
  const target = doc.tiles.find((t) => t.id === seaId);
  if (!harbor?.features.harbor || target?.kind !== "sea" || harbor.ports?.includes(seaId)) {
    return doc;
  }
  const tiles = doc.tiles.map((t) =>
    t.id === harborId ? { ...t, ports: [...(t.ports ?? []), seaId] } : t
  );
  return { ...doc, tiles };
}

function removePort(doc: EditorDoc, harborId: string, seaId: string): EditorDoc {
  const tiles = doc.tiles.map((t) => {
    if (t.id !== harborId || !t.ports) {
      return t;
    }
    const ports = t.ports.filter((p) => p !== seaId);
    const next: HexTileSource = { ...t };
    if (ports.length > 0) {
      next.ports = ports;
    } else {
      delete next.ports;
    }
    return next;
  });
  return { ...doc, tiles };
}

function setDeployment(doc: EditorDoc, tileId: string, units: StartingUnits | null): EditorDoc {
  const startingDeployment = { ...doc.startingDeployment };
  const normalized = units
    ? {
        seat: units.seat,
        ...(units.troop && units.troop > 0 ? { troop: units.troop } : {}),
        ...(units.ship && units.ship > 0 ? { ship: units.ship } : {})
      }
    : null;
  if (!normalized || (normalized.troop === undefined && normalized.ship === undefined)) {
    delete startingDeployment[tileId];
  } else {
    startingDeployment[tileId] = normalized;
  }
  return { ...doc, startingDeployment };
}

function unmergeTile(doc: EditorDoc, tileId: string): EditorDoc {
  const tile = doc.tiles.find((t) => t.id === tileId);
  if (!tile || tile.hexes.length < 2) {
    return doc;
  }
  const centers = tile.hexes.map((h) => axialToPixel(h, doc.layout));
  const centroid = {
    x: centers.reduce((sum, p) => sum + p.x, 0) / centers.length,
    y: centers.reduce((sum, p) => sum + p.y, 0) / centers.length
  };
  let keeperIndex = 0;
  let best = Infinity;
  centers.forEach((p, i) => {
    const d = (p.x - centroid.x) ** 2 + (p.y - centroid.y) ** 2;
    if (d < best) {
      best = d;
      keeperIndex = i;
    }
  });
  let nextNumber = doc.nextTileNumber;
  const fresh: HexTileSource[] = tile.hexes
    .filter((_, i) => i !== keeperIndex)
    .map((hex) => ({ id: `t${nextNumber++}`, kind: tile.kind, hexes: [hex], features: {} }));
  const tiles = doc.tiles
    .map((t) => (t.id === tileId ? { ...t, hexes: [tile.hexes[keeperIndex]!] } : t))
    .concat(fresh);
  return { ...doc, tiles, nextTileNumber: nextNumber };
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
      if (state.portArming && state.selection[0]) {
        const target = state.doc.tiles.find((t) => t.id === action.tileId);
        if (target?.kind === "sea") {
          return withDoc(state, addPort(state.doc, state.selection[0], action.tileId), {
            portArming: false
          });
        }
        return { ...state, portArming: false };
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
    case "mergeSelection": {
      if (!canMergeSelection(state.doc, state.selection)) {
        return state;
      }
      return withDoc(state, mergeSelection(state.doc, state.selection), {
        selection: state.selection.slice(0, 1)
      });
    }
    case "unmergeTile":
      return withDoc(state, unmergeTile(state.doc, action.tileId));
    case "armPort":
      return { ...state, portArming: action.arming };
    case "removePort":
      return withDoc(state, removePort(state.doc, action.harborId, action.seaId));
    case "setFeature":
      return withDoc(state, setFeature(state.doc, action.tileId, action.patch));
    case "setDeployment":
      return withDoc(state, setDeployment(state.doc, action.tileId, action.units));
    case "toggleBonusSlot": {
      const bonusSlots = state.doc.bonusSlots.includes(action.tileId)
        ? state.doc.bonusSlots.filter((id) => id !== action.tileId)
        : [...state.doc.bonusSlots, action.tileId];
      return withDoc(state, { ...state.doc, bonusSlots });
    }
    case "setName":
      return withDoc(state, { ...state.doc, name: action.name });
    default:
      return state;
  }
}
