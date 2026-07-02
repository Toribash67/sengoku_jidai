import { ASSETS, hqGlyph } from "./assets.js";
import type { BoardScene, SceneTile } from "./scene.js";
import type { Pixel } from "@sengoku-jidai/engine";
import { el } from "./svg.js";

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

function featureGlyphs(tile: SceneTile): string {
  const out: string[] = [];
  if (tile.features.hq && tile.glyphAnchors.hq) {
    out.push(ASSETS.place(hqGlyph(tile.features.hq), tile.glyphAnchors.hq));
  }
  if (tile.features.valueStars > 0 && tile.glyphAnchors.stars) {
    out.push(ASSETS.place("glyph-star", tile.glyphAnchors.stars));
  }
  if (tile.features.harbor && tile.glyphAnchors.harbor) {
    out.push(ASSETS.place("glyph-harbor", tile.glyphAnchors.harbor));
  }
  if (tile.bonusGlyph && tile.glyphAnchors.bonus) {
    out.push(ASSETS.place(tile.bonusGlyph, tile.glyphAnchors.bonus));
  }
  for (const port of tile.ports) {
    out.push(
      el("line", {
        x1: port.from.x.toFixed(2),
        y1: port.from.y.toFixed(2),
        x2: port.toPoint.x.toFixed(2),
        y2: port.toPoint.y.toFixed(2),
        class: "pier",
        stroke: "#5a4632",
        "stroke-width": 4,
        "stroke-dasharray": "8 6"
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
  const features = el("g", { id: "features" }, scene.tiles.map(featureGlyphs).join(""));
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
