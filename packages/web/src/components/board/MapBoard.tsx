import type { PlayerAreaView, SeatId } from "@sengoku-jidai/engine";
import { useEffect, useRef } from "react";
import rawMapSvg from "../../../../../cloned_map.svg?raw";
import { tileFill } from "./tileFill.js";

export interface MapBoardProps {
  areas: PlayerAreaView[];
  activeSeat: SeatId;
  selectedAreaId: string | null;
  actionSpaces: Record<string, SeatId | null>;
  onSelectArea: (areaId: string) => void;
}

const SVG_NS = "http://www.w3.org/2000/svg";

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

/** One-time prep on the injected SVG: neutralize tile-def styling and inject stripe patterns. */
function prepareSvg(svg: SVGSVGElement): void {
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

interface DecorateInput {
  areas: PlayerAreaView[];
  selectedAreaId: string | null;
  onSelectArea: (areaId: string) => void;
}

/** Apply per-tile fill, selection stroke, and click handler. */
function decorate(svg: SVGSVGElement, { areas, selectedAreaId, onSelectArea }: DecorateInput): void {
  for (const area of areas) {
    const tile = svg.querySelector<SVGGraphicsElement>(`#${CSS.escape(area.id)}`);
    if (!tile) {
      throw new Error(`cloned_map.svg has no element for area "${area.id}"`);
    }
    tile.style.fill = tileFill(area);
    const selected = area.id === selectedAreaId;
    tile.style.stroke = selected ? "#f0b429" : "#000000";
    tile.style.strokeWidth = selected ? "8" : "5";
    tile.style.cursor = "pointer";
    tile.onclick = () => onSelectArea(area.id);
  }
}

export function MapBoard({ areas, activeSeat, selectedAreaId, onSelectArea }: MapBoardProps) {
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
      decorate(svg, { areas, selectedAreaId, onSelectArea });
    }
  }, [areas, selectedAreaId, onSelectArea]);

  return (
    <section className="board" data-testid="board" aria-label="Sengoku Jidai battlefield">
      <div className="map-host" ref={hostRef} />
      <p className="board-status">Active seat: {activeSeat}</p>
    </section>
  );
}
