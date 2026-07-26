import {
  ASSETS,
  NATIVE_HEX_SIZE,
  PIER_ART_LENGTH,
  pierArt,
  star1Art,
  star2Art,
  type OrderKind
} from "./assets.js";
import type { BoardScene, SceneTile } from "./scene.js";
import type { Pixel } from "@sengoku-jidai/engine";
import { offsetRingsOutward } from "./outline.js";
import { el } from "./svg.js";

const SVG_NS = "http://www.w3.org/2000/svg";
const XLINK_NS = "http://www.w3.org/1999/xlink";

/** Bonus badge diameter as a fraction of hex size (~1.47× the old apparent size, hex-relative).
 *  Independent of the equal-valued anchor-offset factor in scene.ts (the match is coincidental —
 *  badge size and corner-anchor position are free to diverge). */
const BONUS_BADGE_FRACTION = 0.72;

// Feature-outline stroke widths, in native (board.svg) units — scaled by hexSize/NATIVE_HEX_SIZE
// at draw time. HQ mirrors board.svg path9-5-0-3 (width 8); harbor mirrors g46 (solid 5 outer +
// dashed 8.09 inner). The dash rides ~0.72× its own width outside the solid line, hugging it.
const HQ_STROKE_W = 8;
const HARBOR_SOLID_W = 5;
const HARBOR_DASH_W = 8.09188;
const HARBOR_DASH_ARRAY = [4.04592, 1.61836];
const HARBOR_DASH_OFFSET = HARBOR_DASH_W * 0.72;

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

/** Place a pier stub on one sea-facing hex edge of a harbour tile. `edge` is the edge
 *  midpoint, `dir` the outward (land→sea) unit vector; the stub starts at the edge and
 *  extends into the water. */
function placePier(edge: Pixel, dir: Pixel, hexSize: number): string {
  const s = hexSize / NATIVE_HEX_SIZE;
  // Shift the origin-centred art out by half its (scaled) length so it starts at the edge
  // and extends into the water rather than straddling the edge.
  const half = (PIER_ART_LENGTH * s) / 2;
  const mx = edge.x + dir.x * half;
  const my = edge.y + dir.y * half;
  // The art is drawn vertical (90°); rotate so its long axis aligns with the outward dir.
  const angle = (Math.atan2(dir.y, dir.x) * 180) / Math.PI - 90;
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
  const s = hexSize / NATIVE_HEX_SIZE;
  // HQ + harbour markers are strokes of the tile's real fused outline (tile.rings) so they fit
  // single- and multi-hex tiles alike. Drawn in the non-interactive #features group.
  if (tile.features.hq) {
    const stroke = tile.features.hq === "red" ? "#e02d2d" : "#000000";
    out.push(
      el("path", {
        d: ringPath(tile.rings),
        class: "hq-outline",
        style: `fill:none;stroke:${stroke};stroke-width:${(HQ_STROKE_W * s).toFixed(2)};stroke-linejoin:round`
      })
    );
  }
  if (tile.features.harbor) {
    const dashRings = offsetRingsOutward(tile.rings, HARBOR_DASH_OFFSET * s);
    const dashArray = HARBOR_DASH_ARRAY.map((v) => (v * s).toFixed(3)).join(",");
    out.push(
      el("path", {
        d: ringPath(tile.rings),
        class: "harbor-outline",
        style: `fill:none;stroke:#000000;stroke-width:${(HARBOR_SOLID_W * s).toFixed(2)};stroke-linejoin:round`
      }),
      el("path", {
        d: ringPath(dashRings),
        class: "harbor-outline-dash",
        style: `fill:none;stroke:#000000;stroke-width:${(HARBOR_DASH_W * s).toFixed(2)};stroke-linejoin:round;stroke-dasharray:${dashArray}`
      })
    );
  }
  if (tile.features.valueStars > 0 && tile.glyphAnchors.stars) {
    const art = tile.features.valueStars === 2 ? star2Art() : star1Art();
    out.push(placeNative(art, tile.glyphAnchors.stars, hexSize));
  }
  if (tile.bonusGlyph && tile.glyphAnchors.bonus) {
    const badgeScale = (hexSize * BONUS_BADGE_FRACTION) / 40;
    out.push(
      ASSETS.place(tile.bonusGlyph, tile.glyphAnchors.bonus, badgeScale, {
        class: "bonus-marker",
        "data-area": tile.id
      })
    );
  }
  for (const port of tile.ports) {
    out.push(placePier(port.edge, port.dir, hexSize));
  }
  return out.join("");
}

function slotAnchors(tile: SceneTile, hexSize: number): string {
  const s = hexSize / NATIVE_HEX_SIZE;
  return Object.entries(tile.slots)
    .map(([id, at]) => {
      const kind = id.slice(0, id.indexOf("-")) as OrderKind;
      // The visible token (native-scale board.svg art) plus the invisible anchor circle the
      // web positions occupancy dots on — kept separate so the dot lands on the token's hex
      // centre, not the bbox centre skewed by the icon overflowing the token. board.svg
      // authors the token defs upside down and places every order group inside
      // rotate(180,...), so each token spins 180° about its own centre.
      const art = el("use", {
        href: `#order-art-${kind}`,
        "xlink:href": `#order-art-${kind}`,
        transform: `translate(${at.x.toFixed(2)} ${at.y.toFixed(2)}) scale(${s}) rotate(180)`
      });
      const anchor = el("circle", {
        id,
        cx: at.x.toFixed(2),
        cy: at.y.toFixed(2),
        r: 0,
        class: "order-slot"
      });
      return art + anchor;
    })
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
  const slots = el(
    "g",
    { id: "order-slots", "pointer-events": "none" },
    scene.tiles.map((t) => slotAnchors(t, scene.hexSize)).join("")
  );

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
