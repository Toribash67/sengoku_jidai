import { ASSETS } from "./assets.js";
import type { BoardScene, SceneTile } from "./scene.js";
import type { Pixel, SeatId } from "@sengoku-jidai/engine";
import { hexCorners } from "./outline.js";
import { el } from "./svg.js";

/** HQ-base outline colour per seat (matches board.svg basered/baseblack strokes). */
const HQ_STROKE: Record<SeatId, string> = { red: "#e02d2d", black: "#000000" };

/** A flat-top hexagon outline centred on `c`, sized to `radius` (a fraction of the tile hex).
 *  HQ base and harbor markers are tile-sized concentric hex outlines in board.svg, not small
 *  icons — so they are drawn from the hex geometry rather than a 40-unit glyph symbol. */
function hexOutline(
  c: Pixel,
  radius: number,
  opts: { stroke: string; width: number; dash?: string; cls: string }
): string {
  const pts = hexCorners(c, radius);
  const d = "M" + pts.map((p) => `${p.x.toFixed(2)},${p.y.toFixed(2)}`).join("L") + "Z";
  return el("path", {
    d,
    fill: "none",
    stroke: opts.stroke,
    "stroke-width": opts.width,
    ...(opts.dash ? { "stroke-dasharray": opts.dash } : {}),
    class: opts.cls
  });
}

const SVG_NS = "http://www.w3.org/2000/svg";
const XLINK_NS = "http://www.w3.org/1999/xlink";

function ringPath(rings: Pixel[][]): string {
  return rings
    .map((ring) => {
      const [first, ...rest] = ring;
      const move = `M${first!.x.toFixed(2)},${first!.y.toFixed(2)}`;
      const lines = rest.map((p) => `L${p.x.toFixed(2)},${p.y.toFixed(2)}`).join("");
      return `${move}${lines}Z`;
    })
    .join(" ");
}

function tilePath(tile: SceneTile): string {
  return el("path", {
    id: tile.id,
    class: "tile",
    d: ringPath(tile.rings),
    "data-authored-fill": tile.authoredFill,
    style: `fill:${tile.authoredFill}`
  });
}

function featureGlyphs(tile: SceneTile, hexSize: number): string {
  const out: string[] = [];
  // HQ base + harbor are tile-sized concentric hex outlines (board.svg basered/baseblack + g46),
  // not 40-unit icons. HQ is the outer coloured ring; harbor is an inner dashed ring, so both
  // read clearly when a tile has both (tile9, tile13).
  if (tile.features.hq) {
    out.push(
      hexOutline(tile.centroid, hexSize * 0.88, {
        stroke: HQ_STROKE[tile.features.hq],
        width: 8,
        cls: "hq-base"
      })
    );
  }
  if (tile.features.harbor) {
    out.push(
      hexOutline(tile.centroid, hexSize * 0.72, {
        stroke: "#000000",
        width: 5,
        dash: "16 10",
        cls: "harbor"
      })
    );
  }
  if (tile.features.valueStars > 0 && tile.glyphAnchors.stars) {
    out.push(ASSETS.place("glyph-star", tile.glyphAnchors.stars, 1.4));
  }
  if (tile.bonusGlyph && tile.glyphAnchors.bonus) {
    out.push(ASSETS.place(tile.bonusGlyph, tile.glyphAnchors.bonus, 1.4));
  }
  for (const port of tile.ports) {
    out.push(
      el("line", {
        x1: port.from.x.toFixed(2),
        y1: port.from.y.toFixed(2),
        x2: port.toPoint.x.toFixed(2),
        y2: port.toPoint.y.toFixed(2),
        class: "pier",
        stroke: "#4a3620",
        "stroke-width": 8,
        "stroke-linecap": "round",
        "stroke-dasharray": "18 12"
      })
    );
  }
  return out.join("");
}

function slotAnchors(tile: SceneTile): string {
  return Object.entries(tile.slots)
    .map(([id, at]) =>
      el("circle", { id, cx: at.x.toFixed(2), cy: at.y.toFixed(2), r: 0, class: "order-slot" })
    )
    .join("");
}

export function assembleBoardSvg(scene: BoardScene): string {
  const { x, y, width, height } = scene.viewBox;
  const sea = scene.tiles.filter((t) => t.kind === "sea");
  const land = scene.tiles.filter((t) => t.kind === "land");

  const defs = el("defs", {}, ASSETS.defs);
  const seaGroup = el("g", { id: "tile-sea" }, sea.map(tilePath).join(""));
  const landGroup = el("g", { id: "tile-land" }, land.map(tilePath).join(""));
  const grid = el(
    "g",
    { class: "hex-grid", style: "display:none" },
    scene.hexGrid
      .map((e) =>
        el("line", {
          x1: e.a.x.toFixed(2),
          y1: e.a.y.toFixed(2),
          x2: e.b.x.toFixed(2),
          y2: e.b.y.toFixed(2),
          stroke: "#0003",
          "stroke-width": 1
        })
      )
      .join("")
  );
  const features = el(
    "g",
    { id: "features" },
    scene.tiles.map((t) => featureGlyphs(t, scene.hexSize)).join("")
  );
  const slots = el("g", { id: "order-slots" }, scene.tiles.map(slotAnchors).join(""));

  return el(
    "svg",
    {
      xmlns: SVG_NS,
      "xmlns:xlink": XLINK_NS,
      viewBox: `${x.toFixed(2)} ${y.toFixed(2)} ${width.toFixed(2)} ${height.toFixed(2)}`
    },
    `${defs}${seaGroup}${landGroup}${grid}${features}${slots}`
  );
}
