import type { PlayerAreaView, SeatId } from "@sengoku-jidai/engine";
import { useEffect, useRef } from "react";
import rawMapSvg from "../../../../../assets/maps/rivers/board.svg?raw";
import { SEAT_SOLID, TILE_LAND_FILL, TILE_SEA_FILL, tileFill } from "./tileFill.js";
import { slotIdForSpace } from "./slotMapping.js";

export interface MapBoardProps {
  areas: PlayerAreaView[];
  activeSeat: SeatId;
  selectedAreaId: string | null;
  actionSpaces: Record<string, SeatId | null>;
  onSelectArea: (areaId: string) => void;
  legalTargetIds?: ReadonlySet<string>;
  sourceIds?: ReadonlySet<string>;
  onSourceClick?: (areaId: string) => void;
  /** Units staged from each area for the active move/placement; drawn as on-tile badges. */
  stagedCounts?: ReadonlyMap<string, number>;
  /** The source whose count the action-bar stepper adjusts; gets a solid (vs dashed) ring. */
  activeSourceId?: string | null;
  /** During advance/sail combat, the attacker's off-board units to show on the contested
   *  tile alongside the defender. */
  pendingAttack?: { area: string; seat: SeatId; unit: "troop" | "ship"; count: number } | null;
  /** Committed terrain background for the active map, painted behind all tiles. Null = flat fills. */
  terrainUrl?: string | null;
}

const SVG_NS = "http://www.w3.org/2000/svg";
const XLINK_NS = "http://www.w3.org/1999/xlink";

const OVERLAY_ID = "map-overlay";

const TERRAIN_LAYER_ID = "map-terrain";

/** `<image>` attributes that stretch the terrain across the full viewBox. The terrain webp is
 *  rendered at the viewBox aspect, so `preserveAspectRatio="none"` aligns it 1:1 with the tiles
 *  (no cropping of coastal edges). */
export function terrainImageAttrs(viewBox: {
  x: number;
  y: number;
  width: number;
  height: number;
}) {
  return {
    x: viewBox.x,
    y: viewBox.y,
    width: viewBox.width,
    height: viewBox.height,
    preserveAspectRatio: "none" as const
  };
}
/** Supply/control tints live in a group appended to each tile group (the map splits tiles
 *  into #tile-sea and #tile-land), so they paint just above their own tiles but below the
 *  map's feature art (HQ/harbour/star/bonus icons) and units. */
const SUPPLY_LAYER_CLASS = "map-supply";
const SEAT_MARK: Record<SeatId, string> = { red: "#7b1f1a", black: "#15181d" };

/** Shared tile geometry defs whose inline fill/stroke must be neutralized so each
 *  tile <use> can drive its own appearance. */
const TILE_GEOMETRY_DEFS = ["path9", "path9-2", "path9-2-2", "path9-5", "path9-5-0"];

/** Unit token defs in the SVG, keyed by seat. Armies are discs; ships are boats. */
const ARMY_DEF: Record<SeatId, string> = { red: "path77", black: "path77-5" };
const SHIP_DEF: Record<SeatId, string> = { red: "path1-7-5-4-2", black: "path1-7-5-4" };

/** Static example unit instances in the SVG; hidden so only live units render. */
const EXAMPLE_UNIT_IDS = ["red-army1", "black-army1", "red-ship1", "black-ship1"];

/** Max tokens drawn in a stack; larger counts still show this many, with the real total. */
const MAX_STACK_TOKENS = 5;

const STRIPE_PATTERNS = `
<pattern id="stripe-red" patternUnits="userSpaceOnUse" width="26" height="26" patternTransform="rotate(45)">
  <rect width="26" height="26" fill="#d5d3c4"/>
  <rect width="13" height="26" fill="#c0392b"/>
</pattern>
<pattern id="stripe-black" patternUnits="userSpaceOnUse" width="26" height="26" patternTransform="rotate(45)">
  <rect width="26" height="26" fill="#d5d3c4"/>
  <rect width="13" height="26" fill="#2f343c"/>
</pattern>
<pattern id="stripe-source" patternUnits="userSpaceOnUse" width="22" height="22" patternTransform="rotate(45)">
  <rect width="11" height="22" fill="#2f9e44"/>
</pattern>`;

/** Record each tile's authored fill (its inline override, else its geometry def's fill)
 *  on a data attribute, so unowned tiles can keep the colours from the SVG after the
 *  shared defs are neutralized. Must run BEFORE neutralizeTileDefs. */
function captureAuthoredFills(svg: SVGSVGElement): void {
  for (const tile of svg.querySelectorAll<SVGUseElement>('use[id^="tile"]')) {
    if (!/^tile\d+$/.test(tile.id)) {
      continue;
    }
    let authored = tile.style.fill;
    if (!authored) {
      const def = tile.href.baseVal ? svg.querySelector<SVGElement>(tile.href.baseVal) : null;
      authored = def ? getComputedStyle(def).fill : "";
    }
    if (authored) {
      tile.dataset.authoredFill = authored;
    }
  }
}

/** One-time prep on the injected SVG: capture authored fills, neutralize tile-def styling
 *  (so per-tile fill/stroke wins), and inject stripe patterns. */
function prepareSvg(svg: SVGSVGElement): void {
  captureAuthoredFills(svg);
  for (const id of EXAMPLE_UNIT_IDS) {
    const example = svg.querySelector<SVGElement>(`#${CSS.escape(id)}`);
    if (example) {
      example.style.display = "none";
    }
  }
  for (const id of TILE_GEOMETRY_DEFS) {
    const def = svg.querySelector<SVGElement>(`#${CSS.escape(id)}`);
    if (def) {
      def.style.fill = "inherit";
      def.style.stroke = "inherit";
      def.style.strokeWidth = "inherit";
    }
  }
  const defs = svg.querySelector("defs");
  if (defs && !defs.querySelector("#stripe-red")) {
    const parsed = new DOMParser().parseFromString(
      `<svg xmlns="${SVG_NS}">${STRIPE_PATTERNS}</svg>`,
      "image/svg+xml"
    );
    for (const node of Array.from(parsed.documentElement.childNodes)) {
      defs.appendChild(svg.ownerDocument.importNode(node, true));
    }
  }
}

interface Point {
  x: number;
  y: number;
}

/** Matrix mapping an element's local user space to the SVG root user (viewBox) space,
 *  independent of the current on-screen scale. Composed from screen CTMs because
 *  `getCTM()` includes the viewBox→viewport scale in some engines (Blink), which would
 *  double-scale overlay coordinates (placed in viewBox space, then scaled again by the
 *  SVG) and break alignment — most visibly when the map is resized. */
function localToRoot(svg: SVGSVGElement, el: SVGGraphicsElement): DOMMatrix | null {
  const svgScreen = svg.getScreenCTM();
  const elScreen = el.getScreenCTM();
  if (!svgScreen || !elScreen) {
    return null;
  }
  return svgScreen.inverse().multiply(elScreen);
}

/** A point at fractional position (fx, fy) of an element's bbox, mapped into root space.
 *  (0.5, 0.5) is the centre; (0.5, 0.2) is near the top edge. */
function bboxPointInRoot(
  svg: SVGSVGElement,
  el: SVGGraphicsElement,
  fx: number,
  fy: number
): Point | null {
  const m = localToRoot(svg, el);
  if (!m) {
    return null;
  }
  const box = el.getBBox();
  const p = new DOMPoint(box.x + box.width * fx, box.y + box.height * fy).matrixTransform(m);
  return { x: p.x, y: p.y };
}

/** Centre of an element mapped into the root SVG (viewBox) coordinate space. */
function centerInRoot(svg: SVGSVGElement, el: SVGGraphicsElement): Point | null {
  return bboxPointInRoot(svg, el, 0.5, 0.5);
}

function makeText(label: string, at: Point): SVGTextElement {
  const text = document.createElementNS(SVG_NS, "text");
  text.setAttribute("x", String(at.x));
  text.setAttribute("y", String(at.y));
  text.setAttribute("class", "tile-units");
  text.textContent = label;
  return text;
}

function makeOccupancy(at: Point, color: string): SVGCircleElement {
  const circle = document.createElementNS(SVG_NS, "circle");
  circle.setAttribute("cx", String(at.x));
  circle.setAttribute("cy", String(at.y));
  circle.setAttribute("r", "16");
  circle.setAttribute("fill", color);
  circle.setAttribute("class", "slot-occupancy");
  return circle;
}

/** A staged-units badge (amber disc + count) drawn near the top of a tile during order
 *  composition, so the player sees how many units they have committed from each area
 *  without any tile id appearing in text. */
function makeStagedBadge(at: Point, count: number): SVGGElement {
  const group = document.createElementNS(SVG_NS, "g");
  group.setAttribute("class", "tile-staged-badge");
  const circle = document.createElementNS(SVG_NS, "circle");
  circle.setAttribute("cx", String(at.x));
  circle.setAttribute("cy", String(at.y));
  circle.setAttribute("r", "18");
  const text = makeText(String(count), at);
  text.setAttribute("class", "tile-units tile-staged-badge-text");
  group.appendChild(circle);
  group.appendChild(text);
  return group;
}

/** A `<use>` instance of a token def (army disc or ship). */
function makeToken(defId: string): SVGUseElement {
  const use = document.createElementNS(SVG_NS, "use");
  use.setAttributeNS(XLINK_NS, "xlink:href", `#${defId}`);
  use.setAttribute("href", `#${defId}`);
  return use;
}

/**
 * Draw a stack of unit tokens for one seat's units of a single type, anchored at a
 * tile-relative point. Successive tokens are offset up-and-right (the skewed-stack
 * look), centred on `anchor`; counts above MAX_STACK_TOKENS still draw that many. When
 * the count is 2+, the total is labelled on the topmost token. `anchor` is a sub-position
 * within the tile (currently the tile centre) so a second seat's stack can be offset here
 * later without overlapping.
 */
function renderUnitStack(overlay: SVGGElement, defId: string, count: number, anchor: Point): void {
  const visible = Math.min(count, MAX_STACK_TOKENS);
  if (visible <= 0) {
    return;
  }

  // Measure the token's native centre and size (overlay is unscaled root space).
  const probe = makeToken(defId);
  overlay.appendChild(probe);
  const box = probe.getBBox();
  overlay.removeChild(probe);
  const nativeCx = box.x + box.width / 2;
  const nativeCy = box.y + box.height / 2;
  const dx = box.width * 0.1;
  const dy = box.height * 0.1;
  const startX = -((visible - 1) * dx) / 2;
  const startY = ((visible - 1) * dy) / 2;

  let topCenter = anchor;
  for (let k = 0; k < visible; k += 1) {
    const offsetX = startX + k * dx;
    const offsetY = startY - k * dy;
    const token = makeToken(defId);
    token.setAttribute(
      "transform",
      `translate(${anchor.x - nativeCx + offsetX} ${anchor.y - nativeCy + offsetY})`
    );
    overlay.appendChild(token);
    topCenter = { x: anchor.x + offsetX, y: anchor.y + offsetY };
  }

  if (count >= 2) {
    overlay.appendChild(makeText(String(count), topCenter));
  }
}

/** A tile outline clone pinned to the tile's on-screen position via its local->root
 *  matrix (overlay is in root space), styled entirely by `className` (stroke colour and
 *  width live in CSS). Used for the target/source glow rings. */
function makeOutline(
  svg: SVGSVGElement,
  tile: SVGGraphicsElement,
  className: string
): SVGElement | null {
  const m = localToRoot(svg, tile);
  if (!m) {
    return null;
  }
  const outline = tile.cloneNode(false) as SVGElement;
  stripTileHooks(outline);
  outline.setAttribute("class", className);
  outline.setAttribute("transform", `matrix(${m.a} ${m.b} ${m.c} ${m.d} ${m.e} ${m.f})`);
  outline.style.fill = "none";
  return outline;
}

/** Strip a tile clone's id and the data-* hooks (selection/test markers) the source tile
 *  carries, so decoration clones never shadow the real tiles in a query or locator. */
function stripTileHooks(clone: SVGElement): void {
  clone.removeAttribute("id");
  clone.removeAttribute("data-source");
  clone.removeAttribute("data-legal-target");
  clone.removeAttribute("data-authored-fill");
}

/** Filled clone of a tile tinted in the seat colour at 40% opacity. It keeps the tile's
 *  own transform so it can live in the supply layer (a sibling of the tiles, sharing their
 *  coordinate space) and align without any matrix mapping. */
function makeSupplyTint(tile: SVGGraphicsElement, seat: SeatId): SVGElement {
  const clone = tile.cloneNode(false) as SVGElement;
  stripTileHooks(clone);
  clone.style.fill = SEAT_SOLID[seat];
  clone.style.opacity = "0.4";
  clone.style.stroke = "none";
  return clone;
}

/** Translucent amber fill clone marking a legal Advance/Sail/Strike (or card) target. A thin
 *  border ring alone gets lost on a dark enemy supply tint — which is exactly where card
 *  targets sit — so the whole tile is washed amber, painted in the overlay above the tint. */
function makeTargetHighlight(svg: SVGSVGElement, tile: SVGGraphicsElement): SVGElement | null {
  const m = localToRoot(svg, tile);
  if (!m) {
    return null;
  }
  const clone = tile.cloneNode(false) as SVGElement;
  stripTileHooks(clone);
  clone.setAttribute("transform", `matrix(${m.a} ${m.b} ${m.c} ${m.d} ${m.e} ${m.f})`);
  clone.style.fill = "#f0b429";
  clone.style.opacity = "0.32";
  clone.style.stroke = "none";
  return clone;
}

/** Striped fill clone marking a tile as an eligible source/target during order
 *  composition; the diagonal stripes read clearly over any underlying tile colour. */
function makeSourceHighlight(svg: SVGSVGElement, tile: SVGGraphicsElement): SVGElement | null {
  const m = localToRoot(svg, tile);
  if (!m) {
    return null;
  }
  const clone = tile.cloneNode(false) as SVGElement;
  stripTileHooks(clone);
  clone.setAttribute("transform", `matrix(${m.a} ${m.b} ${m.c} ${m.d} ${m.e} ${m.f})`);
  clone.style.fill = "url(#stripe-source)";
  clone.style.opacity = "0.55";
  clone.style.stroke = "none";
  return clone;
}

/** Selection outline for a tile, drawn in the overlay so it paints above every
 *  other tile and decoration (SVG paints in document order, and the source tile
 *  sits beneath the later order/feature groups). Clones the tile geometry and pins
 *  it to the tile's position via its CTM, since the overlay is in root space. */
function makeSelectionOutline(svg: SVGSVGElement, tile: SVGGraphicsElement): SVGElement | null {
  const outline = makeOutline(svg, tile, "tile-selected");
  if (outline) {
    outline.style.stroke = "#f0b429";
    outline.style.strokeWidth = "8";
  }
  return outline;
}

/** Insert (or update/remove) the terrain background as the first child of the SVG, so it paints
 *  beneath every tile and overlay. */
function applyTerrain(svg: SVGSVGElement, terrainUrl: string | null | undefined): void {
  const existing = svg.querySelector<SVGImageElement>(`#${TERRAIN_LAYER_ID}`);
  if (!terrainUrl) {
    existing?.remove();
    return;
  }
  const image = existing ?? document.createElementNS(SVG_NS, "image");
  if (!existing) {
    image.setAttribute("id", TERRAIN_LAYER_ID);
    image.setAttribute("pointer-events", "none");
    svg.insertBefore(image, svg.firstChild);
  } else if (svg.firstChild !== image) {
    // Keep terrain as the bottom layer even if something was prepended since.
    svg.insertBefore(image, svg.firstChild);
  }
  const attrs = terrainImageAttrs(svg.viewBox.baseVal);
  image.setAttribute("x", String(attrs.x));
  image.setAttribute("y", String(attrs.y));
  image.setAttribute("width", String(attrs.width));
  image.setAttribute("height", String(attrs.height));
  image.setAttribute("preserveAspectRatio", attrs.preserveAspectRatio);
  image.setAttribute("href", terrainUrl);
  image.setAttributeNS(XLINK_NS, "xlink:href", terrainUrl);
}

/** Get (creating if needed) the top-level overlay group, emptied for a fresh pass. */
function resetOverlay(svg: SVGSVGElement): SVGGElement {
  let overlay = svg.querySelector<SVGGElement>(`#${OVERLAY_ID}`);
  if (!overlay) {
    overlay = document.createElementNS(SVG_NS, "g");
    overlay.setAttribute("id", OVERLAY_ID);
    overlay.setAttribute("pointer-events", "none");
    svg.appendChild(overlay);
  }
  overlay.replaceChildren();
  return overlay;
}

/** Empty every supply-tint group for a fresh pass (one exists per tile group). */
function clearSupplyLayers(svg: SVGSVGElement): void {
  for (const layer of svg.querySelectorAll<SVGGElement>(`g.${SUPPLY_LAYER_CLASS}`)) {
    layer.replaceChildren();
  }
}

/** Get (creating if needed) the supply-tint group for a tile, appended as the last child of
 *  that tile's own parent group so the tint paints directly above its tiles but below the
 *  later order/feature/unit layers. Keyed per parent because the map splits tiles into
 *  #tile-sea and #tile-land. */
function supplyLayerFor(tile: SVGGraphicsElement): SVGGElement | null {
  const parent = tile.parentElement;
  if (!parent) {
    return null;
  }
  let layer = parent.querySelector<SVGGElement>(`:scope > g.${SUPPLY_LAYER_CLASS}`);
  if (!layer) {
    layer = document.createElementNS(SVG_NS, "g");
    layer.setAttribute("class", SUPPLY_LAYER_CLASS);
    layer.setAttribute("pointer-events", "none");
    parent.appendChild(layer);
  }
  return layer;
}

interface DecorateInput {
  areas: PlayerAreaView[];
  selectedAreaId: string | null;
  actionSpaces: Record<string, SeatId | null>;
  onSelectArea: (areaId: string) => void;
  legalTargetIds?: ReadonlySet<string>;
  sourceIds?: ReadonlySet<string>;
  onSourceClick?: (areaId: string) => void;
  stagedCounts?: ReadonlyMap<string, number>;
  activeSourceId?: string | null;
  pendingAttack?: { area: string; seat: SeatId; unit: "troop" | "ship"; count: number } | null;
  hasTerrain?: boolean;
}

/** Apply per-tile fill, selection stroke, and click handler. */
function decorate(
  svg: SVGSVGElement,
  {
    areas,
    selectedAreaId,
    actionSpaces,
    onSelectArea,
    legalTargetIds,
    sourceIds,
    onSourceClick,
    stagedCounts,
    activeSourceId,
    pendingAttack,
    hasTerrain
  }: DecorateInput
): void {
  const overlay = resetOverlay(svg);
  clearSupplyLayers(svg);
  let selectedTile: SVGGraphicsElement | null = null;

  // Pass 1: tile fills + supply tints. The tints go in the low supply layer; the source
  // stripes, outlines, units, and badges go in the top overlay so they always paint above.
  for (const area of areas) {
    const tile = svg.querySelector<SVGGraphicsElement>(`#${CSS.escape(area.id)}`);
    if (!tile) {
      throw new Error(`board.svg has no element for area "${area.id}"`);
    }
    // Supplied tiles keep their natural map colour; a translucent overlay provides the tint.
    // Unsupplied-owned tiles get the stripe pattern. Unowned tiles keep their authored colour.
    const isSupplied = area.owner !== null && area.suppliedBy === area.owner;
    if (area.owner === null || isSupplied) {
      // With terrain behind the board, let it show through unowned/supplied tiles (the
      // hex stroke grid still paints on top); otherwise keep the authored flat fill.
      tile.style.fill = hasTerrain
        ? "transparent"
        : (tile.dataset.authoredFill ?? (area.kind === "sea" ? TILE_SEA_FILL : TILE_LAND_FILL));
    } else {
      tile.style.fill = tileFill(area);
    }
    tile.style.stroke = "#000000";
    tile.style.strokeWidth = "5";
    tile.style.cursor = "pointer";

    const isTarget = legalTargetIds?.has(area.id) ?? false;
    const isSource = sourceIds?.has(area.id) ?? false;
    if (isTarget) {
      tile.dataset.legalTarget = "true";
    } else {
      delete tile.dataset.legalTarget;
    }
    if (isSource) {
      tile.dataset.source = "true";
    } else {
      delete tile.dataset.source;
    }
    tile.onclick = () => {
      onSelectArea(area.id);
      if (isSource) {
        onSourceClick?.(area.id);
      }
    };

    if (isSupplied && area.owner !== null) {
      supplyLayerFor(tile)?.appendChild(makeSupplyTint(tile, area.owner));
    }

    // Eligible sources/targets get a striped highlight, painted over any supply tint.
    if (isSource) {
      const stripes = makeSourceHighlight(svg, tile);
      if (stripes) {
        overlay.appendChild(stripes);
      }
    }
  }

  // Pass 2: selection outlines, glow rings, unit stacks — always above supply overlays.
  for (const area of areas) {
    const tile = svg.querySelector<SVGGraphicsElement>(`#${CSS.escape(area.id)}`);
    if (!tile) {
      continue;
    }
    const isTarget = legalTargetIds?.has(area.id) ?? false;
    const isSource = sourceIds?.has(area.id) ?? false;

    if (area.id === selectedAreaId) {
      selectedTile = tile;
    }
    if (isTarget) {
      // Amber wash first, then the dashed ring on top — so the target reads clearly even over
      // an enemy supply tint (the usual case when playing a card).
      const fill = makeTargetHighlight(svg, tile);
      if (fill) {
        overlay.appendChild(fill);
      }
      const glow = makeOutline(svg, tile, "tile-legal-target");
      if (glow) {
        overlay.appendChild(glow);
      }
    }
    if (isSource) {
      const ringClass =
        area.id === activeSourceId ? "tile-source tile-source-active" : "tile-source";
      const glow = makeOutline(svg, tile, ringClass);
      if (glow) {
        overlay.appendChild(glow);
      }
    }

    // Unit stacks for the controlling seat. Armies and ships never share a region, so
    // each area shows at most one stack today; `center` is the anchor a future second
    // seat's stack would offset from.
    if (area.owner && area.units.troop + area.units.ship > 0) {
      const center = centerInRoot(svg, tile);
      if (center) {
        if (area.units.troop > 0) {
          renderUnitStack(overlay, ARMY_DEF[area.owner], area.units.troop, center);
        }
        if (area.units.ship > 0) {
          renderUnitStack(overlay, SHIP_DEF[area.owner], area.units.ship, center);
        }
      }
    }

    // During advance/sail combat, show the attacker's incoming stack on the contested tile
    // (held off-board in pendingCombat), anchored above the defender's garrison so both
    // sides are visible.
    if (pendingAttack && pendingAttack.area === area.id && pendingAttack.count > 0) {
      const anchor = bboxPointInRoot(svg, tile, 0.5, 0.26);
      if (anchor) {
        const def =
          pendingAttack.unit === "troop"
            ? ARMY_DEF[pendingAttack.seat]
            : SHIP_DEF[pendingAttack.seat];
        renderUnitStack(overlay, def, pendingAttack.count, anchor);
      }
    }

    // Staged-units badge near the top of the tile during composition (above the stack).
    const staged = stagedCounts?.get(area.id) ?? 0;
    if (staged > 0) {
      const badgeAt = bboxPointInRoot(svg, tile, 0.5, 0.2);
      if (badgeAt) {
        overlay.appendChild(makeStagedBadge(badgeAt, staged));
      }
    }
  }

  for (const [spaceId, occupant] of Object.entries(actionSpaces)) {
    if (!occupant) {
      continue;
    }
    const slotId = slotIdForSpace(spaceId);
    if (!slotId) {
      continue;
    }
    const slot = svg.querySelector<SVGGraphicsElement>(`#${CSS.escape(slotId)}`);
    if (!slot) {
      continue;
    }
    const center = centerInRoot(svg, slot);
    if (center) {
      overlay.appendChild(makeOccupancy(center, SEAT_MARK[occupant]));
    }
  }

  // Selection outline is appended last so it paints above every other overlay element
  // (supply tints, glow rings, unit stacks, occupancy marks). Appending it mid-pass let
  // later tiles' units and the occupancy marks cover it for some selections.
  if (selectedTile) {
    const outline = makeSelectionOutline(svg, selectedTile);
    if (outline) {
      overlay.appendChild(outline);
    }
  }
}

export function MapBoard({
  areas,
  activeSeat,
  selectedAreaId,
  actionSpaces,
  onSelectArea,
  legalTargetIds,
  sourceIds,
  onSourceClick,
  stagedCounts,
  activeSourceId,
  pendingAttack,
  terrainUrl
}: MapBoardProps) {
  const hostRef = useRef<HTMLDivElement>(null);

  // Inject + prep once.
  useEffect(() => {
    const host = hostRef.current;
    if (!host) {
      return;
    }
    host.innerHTML = rawMapSvg;
    const svg = host.querySelector("svg");
    if (svg) {
      prepareSvg(svg);
      applyTerrain(svg, terrainUrl);
    }
  }, [terrainUrl]);

  // Re-decorate whenever state changes.
  useEffect(() => {
    const svg = hostRef.current?.querySelector("svg");
    if (svg) {
      applyTerrain(svg, terrainUrl);
      decorate(svg, {
        areas,
        selectedAreaId,
        actionSpaces,
        onSelectArea,
        legalTargetIds,
        sourceIds,
        onSourceClick,
        stagedCounts,
        activeSourceId,
        pendingAttack,
        hasTerrain: terrainUrl != null
      });
    }
  }, [
    areas,
    selectedAreaId,
    actionSpaces,
    onSelectArea,
    legalTargetIds,
    sourceIds,
    onSourceClick,
    stagedCounts,
    activeSourceId,
    pendingAttack,
    terrainUrl
  ]);

  return (
    <section className="board" data-testid="board" aria-label="Sengoku Jidai battlefield">
      <div className="map-host" ref={hostRef} />
      <p className="board-status">Active seat: {activeSeat}</p>
    </section>
  );
}
