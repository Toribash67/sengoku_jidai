import type { PlayerAreaView, SeatId } from "@sengoku-jidai/engine";
import { useEffect, useRef } from "react";
import rawMapSvg from "../../../../../cloned_map.svg?raw";
import { tileFill } from "./tileFill.js";
import { slotIdForSpace } from "./slotMapping.js";

export interface MapBoardProps {
  areas: PlayerAreaView[];
  activeSeat: SeatId;
  selectedAreaId: string | null;
  actionSpaces: Record<string, SeatId | null>;
  onSelectArea: (areaId: string) => void;
}

const SVG_NS = "http://www.w3.org/2000/svg";

const OVERLAY_ID = "map-overlay";
const SEAT_MARK: Record<SeatId, string> = { red: "#7b1f1a", black: "#15181d" };

/** Shared tile geometry defs whose inline fill/stroke must be neutralized so each
 *  tile <use> can drive its own appearance. */
const TILE_GEOMETRY_DEFS = ["path9", "path9-2", "path9-2-2", "path9-5", "path9-5-0"];

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

/** Selection outline for a tile, drawn in the overlay so it paints above every
 *  other tile and decoration (SVG paints in document order, and the source tile
 *  sits beneath the later order/feature groups). Clones the tile geometry and pins
 *  it to the tile's position via its CTM, since the overlay is in root space. */
function makeSelectionOutline(svg: SVGSVGElement, tile: SVGGraphicsElement): SVGElement | null {
  const m = localToRoot(svg, tile);
  if (!m) {
    return null;
  }
  const outline = tile.cloneNode(false) as SVGElement;
  outline.removeAttribute("id");
  outline.setAttribute("class", "tile-selected");
  outline.setAttribute("transform", `matrix(${m.a} ${m.b} ${m.c} ${m.d} ${m.e} ${m.f})`);
  outline.style.fill = "none";
  outline.style.stroke = "#f0b429";
  outline.style.strokeWidth = "8";
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
}

/** Apply per-tile fill, selection stroke, and click handler. */
function decorate(
  svg: SVGSVGElement,
  { areas, selectedAreaId, actionSpaces, onSelectArea }: DecorateInput
): void {
  const overlay = resetOverlay(svg);

  for (const area of areas) {
    const tile = svg.querySelector<SVGGraphicsElement>(`#${CSS.escape(area.id)}`);
    if (!tile) {
      throw new Error(`cloned_map.svg has no element for area "${area.id}"`);
    }
    // Owned tiles get the seat tint/stripe; unowned tiles keep their authored colour.
    tile.style.fill =
      area.owner === null ? (tile.dataset.authoredFill ?? tileFill(area)) : tileFill(area);
    tile.style.stroke = "#000000";
    tile.style.strokeWidth = "5";
    tile.style.cursor = "pointer";
    tile.onclick = () => onSelectArea(area.id);

    if (area.id === selectedAreaId) {
      const outline = makeSelectionOutline(svg, tile);
      if (outline) {
        overlay.appendChild(outline);
      }
    }

    if (area.units.troop + area.units.ship > 0) {
      const center = centerInRoot(svg, tile);
      if (center) {
        overlay.appendChild(makeText(`${area.units.troop}t·${area.units.ship}s`, center));
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
  onSelectArea
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
      decorate(svg, { areas, selectedAreaId, actionSpaces, onSelectArea });
    }
  }, [areas, selectedAreaId, actionSpaces, onSelectArea]);

  return (
    <section className="board" data-testid="board" aria-label="Sengoku Jidai battlefield">
      <div className="map-host" ref={hostRef} />
      <p className="board-status">Active seat: {activeSeat}</p>
    </section>
  );
}
