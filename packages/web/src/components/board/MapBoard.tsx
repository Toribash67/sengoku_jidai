import type { PlayerAreaView, SeatId } from "@sengoku-jidai/engine";
import { useEffect, useRef } from "react";
import rawMapSvg from "../../../../../cloned_map.svg?raw";
import { TILE_LAND_FILL, TILE_SEA_FILL, tileFill } from "./tileFill.js";
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
}

const SVG_NS = "http://www.w3.org/2000/svg";
const XLINK_NS = "http://www.w3.org/1999/xlink";

const OVERLAY_ID = "map-overlay";
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

/** Centre of an element mapped into the root SVG (viewBox) coordinate space. */
function centerInRoot(svg: SVGSVGElement, el: SVGGraphicsElement): Point | null {
  const m = localToRoot(svg, el);
  if (!m) {
    return null;
  }
  const box = el.getBBox();
  const center = new DOMPoint(box.x + box.width / 2, box.y + box.height / 2).matrixTransform(m);
  return { x: center.x, y: center.y };
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
  outline.removeAttribute("id");
  outline.setAttribute("class", className);
  outline.setAttribute("transform", `matrix(${m.a} ${m.b} ${m.c} ${m.d} ${m.e} ${m.f})`);
  outline.style.fill = "none";
  return outline;
}

/** Filled clone of a tile tinted in the seat colour at 25% opacity, drawn in the
 *  overlay so the underlying map artwork shows through. */
function makeSupplyOverlay(
  svg: SVGSVGElement,
  tile: SVGGraphicsElement,
  seat: SeatId
): SVGElement | null {
  const m = localToRoot(svg, tile);
  if (!m) {
    return null;
  }
  const clone = tile.cloneNode(false) as SVGElement;
  clone.removeAttribute("id");
  clone.setAttribute("transform", `matrix(${m.a} ${m.b} ${m.c} ${m.d} ${m.e} ${m.f})`);
  clone.style.fill = SEAT_SOLID[seat];
  clone.style.fillOpacity = "0.25";
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

interface DecorateInput {
  areas: PlayerAreaView[];
  selectedAreaId: string | null;
  actionSpaces: Record<string, SeatId | null>;
  onSelectArea: (areaId: string) => void;
  legalTargetIds?: ReadonlySet<string>;
  sourceIds?: ReadonlySet<string>;
  onSourceClick?: (areaId: string) => void;
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
    onSourceClick
  }: DecorateInput
): void {
  const overlay = resetOverlay(svg);

  for (const area of areas) {
    const tile = svg.querySelector<SVGGraphicsElement>(`#${CSS.escape(area.id)}`);
    if (!tile) {
      throw new Error(`cloned_map.svg has no element for area "${area.id}"`);
    }
    // Supplied tiles keep their natural map colour; a translucent overlay provides the tint.
    // Unsupplied-owned tiles get the stripe pattern. Unowned tiles keep their authored colour.
    const isSupplied = area.owner !== null && area.suppliedBy === area.owner;
    tile.style.fill =
      area.owner === null || isSupplied
        ? (tile.dataset.authoredFill ?? (area.kind === "sea" ? TILE_SEA_FILL : TILE_LAND_FILL))
        : tileFill(area);
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
      const supplyOverlay = makeSupplyOverlay(svg, tile, area.owner);
      if (supplyOverlay) {
        overlay.appendChild(supplyOverlay);
      }
    }

    if (area.id === selectedAreaId) {
      const outline = makeSelectionOutline(svg, tile);
      if (outline) {
        overlay.appendChild(outline);
      }
    }
    if (isTarget) {
      const glow = makeOutline(svg, tile, "tile-legal-target");
      if (glow) {
        overlay.appendChild(glow);
      }
    }
    if (isSource) {
      const glow = makeOutline(svg, tile, "tile-source");
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
}

export function MapBoard({
  areas,
  activeSeat,
  selectedAreaId,
  actionSpaces,
  onSelectArea,
  legalTargetIds,
  sourceIds,
  onSourceClick
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
    }
  }, []);

  // Re-decorate whenever state changes.
  useEffect(() => {
    const svg = hostRef.current?.querySelector("svg");
    if (svg) {
      decorate(svg, {
        areas,
        selectedAreaId,
        actionSpaces,
        onSelectArea,
        legalTargetIds,
        sourceIds,
        onSourceClick
      });
    }
  }, [areas, selectedAreaId, actionSpaces, onSelectArea, legalTargetIds, sourceIds, onSourceClick]);

  return (
    <section className="board" data-testid="board" aria-label="Sengoku Jidai battlefield">
      <div className="map-host" ref={hostRef} />
      <p className="board-status">Active seat: {activeSeat}</p>
    </section>
  );
}
