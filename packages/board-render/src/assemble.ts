import { ASSETS, NATIVE_HEX_SIZE, harborArt, hqBaseArt, pierArt } from "./assets.js";
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

/** Place native-scale feature art centred on a tile centroid. Native art is authored at
 *  NATIVE_HEX_SIZE, so it is scaled to the map's hex size — 1:1 on a size-114 map. */
function placeNative(art: string, centroid: Pixel, hexSize: number): string {
  const s = hexSize / NATIVE_HEX_SIZE;
  return el(
    "g",
    { transform: `translate(${centroid.x.toFixed(2)} ${centroid.y.toFixed(2)}) scale(${s})` },
    art
  );
}

/** Place a pier stub on the edge between a harbour tile and one of its sea neighbours,
 *  rotated to point from land into the water. `from` is the tile centroid, `to` the sea's. */
function placePier(from: Pixel, to: Pixel, hexSize: number): string {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const len = Math.hypot(dx, dy) || 1;
  // Sit the stub on the shared edge (one apothem out from the centre along the land→sea line).
  const apothem = (hexSize * Math.sqrt(3)) / 2;
  const mx = from.x + (dx / len) * apothem;
  const my = from.y + (dy / len) * apothem;
  // The art is drawn vertical (90°); rotate so its long axis aligns with the land→sea direction.
  const angle = (Math.atan2(dy, dx) * 180) / Math.PI - 90;
  const s = hexSize / NATIVE_HEX_SIZE;
  return el(
    "g",
    {
      transform: `translate(${mx.toFixed(2)} ${my.toFixed(2)}) rotate(${angle.toFixed(2)}) scale(${s})`
    },
    pierArt()
  );
}

function featureGlyphs(tile: SceneTile, hexSize: number): string {
  const out: string[] = [];
  // HQ base + harbour are the artist's tile-sized hex outlines (board.svg path9-5-0-3/-6 + g46),
  // drawn verbatim at native scale so they line up with the tile edge (both appear on tile9/tile13).
  if (tile.features.hq) {
    out.push(placeNative(hqBaseArt(tile.features.hq), tile.centroid, hexSize));
  }
  if (tile.features.harbor) {
    out.push(placeNative(harborArt(), tile.centroid, hexSize));
  }
  if (tile.features.valueStars > 0 && tile.glyphAnchors.stars) {
    out.push(ASSETS.place("glyph-star", tile.glyphAnchors.stars, 1.4));
  }
  if (tile.bonusGlyph && tile.glyphAnchors.bonus) {
    out.push(ASSETS.place(tile.bonusGlyph, tile.glyphAnchors.bonus, 1.4));
  }
  for (const port of tile.ports) {
    out.push(placePier(port.from, port.toPoint, hexSize));
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
  // Features are purely decorative and must never intercept tile clicks — piers/HQ rings can
  // overlap a tile's centre (its Playwright/click hit-point), which would swallow the click.
  const features = el(
    "g",
    { id: "features", "pointer-events": "none" },
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
