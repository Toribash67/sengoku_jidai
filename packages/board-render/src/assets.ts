import type { Pixel, SeatId } from "@sengoku-jidai/engine";
import { el } from "./svg.js";

export type GlyphId =
  | "unit-army-red"
  | "unit-army-black"
  | "unit-ship-red"
  | "unit-ship-black"
  | "glyph-hq-red"
  | "glyph-hq-black"
  | "glyph-star"
  | "glyph-harbor"
  | "glyph-bonus-sun"
  | "glyph-bonus-moon"
  | "glyph-bonus-star";

const SEAT_FILL: Record<SeatId, string> = { red: "#c0392b", black: "#2f343c" };

// Each glyph def is a <symbol> whose content is pre-translated to (0,0) centre,
// with width/height set to a standard 40-unit square so <use> without explicit
// width/height still renders at 40×40 and ASSETS.place() can scale predictably.
// Geometry is extracted verbatim from assets/maps/rivers/board.svg defs; the
// inner translate() normalises board coordinates so the visual centre is (0,0).
function symbol(id: string, viewBox: string, w: number, h: number, inner: string): string {
  return el("symbol", { id, viewBox, width: w, height: h, overflow: "visible" }, inner);
}

// ---------------------------------------------------------------------------
// Army discs
// path77 (red) and path77-5 (black) in board.svg are both plain <circle r=33.6>
// discs. Represented faithfully as circles centred at (0,0) in a 40×40 symbol.
// ---------------------------------------------------------------------------
const ARMY_RED = symbol(
  "unit-army-red",
  "-20 -20 40 40",
  40,
  40,
  `<circle r="16" fill="${SEAT_FILL.red}" stroke="#000000" stroke-width="2"/>`
);

const ARMY_BLACK = symbol(
  "unit-army-black",
  "-20 -20 40 40",
  40,
  40,
  `<circle r="16" fill="${SEAT_FILL.black}" stroke="#000000" stroke-width="2"/>`
);

// ---------------------------------------------------------------------------
// Ships — path1-7-5-4-2 (red) and path1-7-5-4 (black) extracted verbatim.
// Bounding box: ~94 wide × ~48 tall; centre at (1190.376, -445.640) for red
// and (1298.931, -445.640) for black. translate() brings that to (0,0).
// Symbol set to 40×20 (roughly proportional) for a default size hint.
// ---------------------------------------------------------------------------
const SHIP_RED_D =
  "m 1155.4422,-438.53389 -0.104,2.58872 -0.114,0.001 -11.7232,0.1116" +
  " 10.0658,13.94894 73.8858,-0.70468 9.7982,-14.13842 -13.1624,0.1256" +
  " -1.3822,0.014 -0.05,-0.4073 -0.372,-7.8018 0.2232,-7.80283 0.7262,-6.73878" +
  " 0.1,-0.93384 0.504,-2.6619 0.9018,-4.75838 0.4814,-1.71724 -0.5542,0.0348" +
  " -0.8896,0.052 -0.6018,0.0348 -1.0472,0.0616 -0.08,0.01 -3.3234,0.52614" +
  " -3.339,0.86632 -3.2376,1.19344 -3.1026,1.5063 -2.946,1.80016 -2.7504,2.08422" +
  " -2.2866,2.1126 -0.2482,0.22722 -0.248,0.27882 v -0.50186 l 0.05,-1.13482" +
  " 0.9586,-8.9443 0.2182,-2.0225 2.0132,-10.59982 0.6876,-2.45756 -0.7952,0.0446" +
  " -2.1194,0.123 -1.5066,0.0878 -0.114,0.02 -4.7558,0.75524 -4.7696,1.24092" +
  " -0.128,0.0496 -4.4938,1.65544 -0.5368,0.26046 -3.8964,1.89138 -4.2036,2.5716" +
  " -3.9332,2.97684 -3.6202,3.34416 -3.2744,3.68314 -2.8968,3.9842 -2.4954,4.2523" +
  " -2.0668,4.47792 -1.6148,4.65639 -1.15,4.79266 z";

const SHIP_BLACK_D =
  "m 1263.9975,-438.53389 -0.104,2.58872 -0.114,0.001 -11.7232,0.1116" +
  " 10.0658,13.94894 73.8858,-0.70468 9.7982,-14.13842 -13.1624,0.1256" +
  " -1.3822,0.014 -0.05,-0.4073 -0.372,-7.8018 0.2232,-7.80283 0.7262,-6.73878" +
  " 0.1,-0.93384 0.504,-2.6619 0.9018,-4.75838 0.4814,-1.71724 -0.5542,0.0348" +
  " -0.8896,0.052 -0.6018,0.0348 -1.0472,0.0616 -0.08,0.01 -3.3234,0.52614" +
  " -3.339,0.86632 -3.2376,1.19344 -3.1026,1.5063 -2.946,1.80016 -2.7504,2.08422" +
  " -2.2866,2.1126 -0.2482,0.22722 -0.248,0.27882 v -0.50186 l 0.05,-1.13482" +
  " 0.9586,-8.9443 0.2182,-2.0225 2.0132,-10.59982 0.6876,-2.45756 -0.7952,0.0446" +
  " -2.1194,0.123 -1.5066,0.0878 -0.114,0.02 -4.7558,0.75524 -4.7696,1.24092" +
  " -0.128,0.0496 -4.4938,1.65544 -0.5368,0.26046 -3.8964,1.89138 -4.2036,2.5716" +
  " -3.9332,2.97684 -3.6202,3.34416 -3.2744,3.68314 -2.8968,3.9842 -2.4954,4.2523" +
  " -2.0668,4.47792 -1.6148,4.65639 -1.15,4.79266 z";

const SHIP_RED = symbol(
  "unit-ship-red",
  "-20 -10 40 20",
  40,
  20,
  `<g transform="scale(0.4267) translate(-1190.376 445.640)">` +
    `<path d="${SHIP_RED_D}" fill="${SEAT_FILL.red}" stroke="#000000" stroke-width="4"/>` +
    `</g>`
);

const SHIP_BLACK = symbol(
  "unit-ship-black",
  "-20 -10 40 20",
  40,
  20,
  `<g transform="scale(0.4267) translate(-1298.931 445.640)">` +
    `<path d="${SHIP_BLACK_D}" fill="${SEAT_FILL.black}" stroke="#fffefe" stroke-width="4"/>` +
    `</g>`
);

// ---------------------------------------------------------------------------
// HQ bases — path9-5-0-3 (black, #000 stroke) and path9-5-0-3-6 (red, #e02d2d stroke).
// Both are regular hexagon outlines; bounding box 227.9 × 197.4.
// Scale 40/227.9 ≈ 0.1755 maps to a 40-unit-wide symbol.
// Black HQ centre: (660.542, -699.311); Red HQ centre: (1002.477, -896.765).
// ---------------------------------------------------------------------------
const HQ_BLACK_D =
  "m 717.5294,-600.60641 -113.97415,-10e-6 -56.98708,-98.70453" +
  " 56.98709,-98.70454 h 113.97415 l 56.98711,98.70454 z";

const HQ_BLACK = symbol(
  "glyph-hq-black",
  "-20 -17 40 34",
  40,
  34,
  `<g transform="scale(0.1755) translate(-660.542 699.311)">` +
    `<path d="${HQ_BLACK_D}" style="fill:none;stroke:#000000;stroke-width:8;stroke-linecap:butt;stroke-linejoin:miter;stroke-dasharray:none"/>` +
    `</g>`
);

const HQ_RED_D =
  "m 1059.4636,-798.05997 -113.97408,-10e-6 -56.98708,-98.70453" +
  " 56.98709,-98.70454 h 113.97407 l 56.9872,98.70454 z";

const HQ_RED = symbol(
  "glyph-hq-red",
  "-20 -17 40 34",
  40,
  34,
  `<g transform="scale(0.1755) translate(-1002.477 896.765)">` +
    `<path d="${HQ_RED_D}" style="fill:none;stroke:#e02d2d;stroke-width:8;stroke-linecap:butt;stroke-linejoin:miter;stroke-dasharray:none"/>` +
    `</g>`
);

// ---------------------------------------------------------------------------
// Star badge — g64 in board.svg: black circle (r≈25.3) + pink 5-pointed star.
// Circle centre: (1297.843, -635.729). translate(-1297.843 635.729) centres it.
// Scale 40/(2*25.3) ≈ 0.79 maps to a 40-unit-diameter symbol.
// ---------------------------------------------------------------------------
const STAR_PATH_D =
  "m 1270.455,-714.08688 c 8.0859,0 16.314,28.5965 22.8557,33.34929" +
  " 6.5417,4.7528 36.2812,3.74142 38.7799,11.43161 2.4987,7.69018" +
  " -22.1556,24.35241 -24.6543,32.0426 -2.4987,7.69018 7.6532,35.66161" +
  " 1.1116,40.41441 -6.5417,4.75279 -30.007,-13.54588 -38.0929,-13.54588" +
  " -8.086,0 -31.5513,18.29867 -38.0929,13.54587 -6.5417,-4.75279" +
  " 3.6102,-32.72422 1.1115,-40.4144 -2.4987,-7.69019 -27.1529,-24.35242" +
  " -24.6543,-32.0426 2.4987,-7.69019 32.2383,-6.67881 38.7799,-11.43161" +
  " 6.5417,-4.75279 14.7698,-33.34929 22.8558,-33.34929 z";

const STAR = symbol(
  "glyph-star",
  "-20 -20 40 40",
  40,
  40,
  `<g transform="scale(0.79) translate(-1297.843 635.729)">` +
    `<circle cx="1297.8433" cy="-635.729" r="25.298941" style="fill:#000000;stroke:#ffffff;stroke-width:2"/>` +
    `<g transform="translate(36.771176,10.01285)">` +
    `<path d="${STAR_PATH_D}" transform="matrix(0.30500519,0,0,0.30500519,873.57673,-447.29887)" style="fill:#ce3485;stroke:#ffffff;stroke-width:4.91795"/>` +
    `</g>` +
    `</g>`
);

// ---------------------------------------------------------------------------
// Harbor — g46 in board.svg: two concentric hex outlines (solid + dashed).
// Group transform: translate(-641.037,-197.531).
// Outer hex centre in group-local space: (1301.579, -304.371).
// After group transform: world centre (660.542, -501.902).
// To normalise: apply group transform first, then translate to world centre.
// Combined single translate: (-641.037 + -660.542, -197.531 + 501.902) = (-1301.579, 304.371).
// Scale 40/227.9 ≈ 0.1755 same as HQ to produce a 40-unit symbol.
// ---------------------------------------------------------------------------
const HARBOR_OUTER_D =
  "m 1358.5662,-205.66592 -113.9742,-1e-5 -56.987,-98.70453" +
  " 56.987,-98.70454 h 113.9742 l 56.9871,98.70454 z";

const HARBOR_INNER_D =
  "m 1354.9313,-212.15432 -106.5451,-10e-6 -53.2723,-92.26012" +
  " 53.2723,-92.26014 h 106.5451 l 53.2723,92.26014 z";

const HARBOR = symbol(
  "glyph-harbor",
  "-20 -17 40 34",
  40,
  34,
  `<g transform="scale(0.1755) translate(-1301.579 304.371)">` +
    `<path d="${HARBOR_OUTER_D}" style="fill:none;stroke:#000000;stroke-width:5;stroke-linecap:butt;stroke-linejoin:miter;stroke-dasharray:none"/>` +
    `<path d="${HARBOR_INNER_D}" style="fill:none;stroke:#000000;stroke-width:8.09188;stroke-linecap:butt;stroke-linejoin:miter;stroke-dasharray:4.04592,1.61836"/>` +
    `</g>`
);

// ---------------------------------------------------------------------------
// Bonus-slot glyphs — g73 (sun), g74 (moon), g75 (star) from board.svg.
// Each group consists of a black pointer-triangle (path73-*) plus an icon overlay.
// Bounding box for all three: width ≈36.051, height ≈124.886 (triangle dominates).
// Centres: g73=(1458.119,-462.144), g74=(1548.556,-469.113), g75=(1599.500,-484.679).
// Scale 40/124.886 ≈ 0.3203 maps to a 40-unit-tall symbol; overflow:visible shows full art.
// Transform order: scale(s) translate(-cx -cy) — same as STAR/HARBOR.
// ---------------------------------------------------------------------------

// g73 = SUN: black triangle + sunburst crosshair (g70 with matrix transform)
const BONUS_SUN = symbol(
  "glyph-bonus-sun",
  "-20 -20 40 40",
  40,
  40,
  `<g transform="scale(0.3203) translate(-1458.119 462.144)">` +
    `<path style="display:inline;fill:#000000;fill-opacity:1;fill-rule:evenodd;stroke:#000000;stroke-width:5.061;stroke-linecap:butt;stroke-linejoin:miter;stroke-miterlimit:4;stroke-dasharray:none;stroke-dashoffset:0.1;stroke-opacity:1;paint-order:normal" d="m 1440.0936,-399.70138 v -124.88597 l 36.0514,62.44298 z" id="path73-7" />` +
    `<g id="g70" transform="matrix(0.55253622,0,0,0.55253622,627.34293,-42.737156)" style="display:inline;fill:#ffffff;fill-opacity:1">` +
    `<circle style="fill:#ffffff;fill-opacity:1;fill-rule:evenodd;stroke:none;stroke-width:3.36476;stroke-linecap:butt;stroke-linejoin:miter;stroke-miterlimit:4;stroke-dasharray:none;stroke-dashoffset:0.1;stroke-opacity:1;paint-order:normal" id="path68" cx="1500.6144" cy="-759.05829" r="18.427582" />` +
    `<rect style="fill:#ffffff;fill-opacity:1;fill-rule:evenodd;stroke:none;stroke-width:4;stroke-linecap:butt;stroke-linejoin:miter;stroke-miterlimit:4;stroke-dasharray:none;stroke-dashoffset:0.1;stroke-opacity:1;paint-order:normal" id="rect70" width="60.964928" height="7.3106251" x="1470.132" y="-762.71362" />` +
    `<rect style="display:inline;fill:#ffffff;fill-opacity:1;fill-rule:evenodd;stroke:none;stroke-width:4;stroke-linecap:butt;stroke-linejoin:miter;stroke-miterlimit:4;stroke-dasharray:none;stroke-dashoffset:0.1;stroke-opacity:1;paint-order:normal" id="rect70-5" width="60.964928" height="7.3106251" x="493.87686" y="-1601.4852" transform="rotate(45)" />` +
    `<rect style="display:inline;fill:#ffffff;fill-opacity:1;fill-rule:evenodd;stroke:none;stroke-width:4;stroke-linecap:butt;stroke-linejoin:miter;stroke-miterlimit:4;stroke-dasharray:none;stroke-dashoffset:0.1;stroke-opacity:1;paint-order:normal" id="rect70-6" width="60.964928" height="7.3106251" x="-789.54077" y="-1504.2698" transform="rotate(90)" />` +
    `<rect style="display:inline;fill:#ffffff;fill-opacity:1;fill-rule:evenodd;stroke:none;stroke-width:4;stroke-linecap:butt;stroke-linejoin:miter;stroke-miterlimit:4;stroke-dasharray:none;stroke-dashoffset:0.1;stroke-opacity:1;paint-order:normal" id="rect70-3" width="60.964928" height="7.3106251" x="-1628.3124" y="-528.01465" transform="rotate(135)" />` +
    `</g>` +
    `</g>`
);

// g74 = MOON: black triangle + crescent (g71)
const BONUS_MOON = symbol(
  "glyph-bonus-moon",
  "-20 -20 40 40",
  40,
  40,
  `<g transform="scale(0.3203) translate(-1548.556 469.113)">` +
    `<path style="display:inline;fill:#000000;fill-opacity:1;fill-rule:evenodd;stroke:#000000;stroke-width:5.061;stroke-linecap:butt;stroke-linejoin:miter;stroke-miterlimit:4;stroke-dasharray:none;stroke-dashoffset:0.1;stroke-opacity:1;paint-order:normal" d="m 1530.5305,-406.67006 v -124.88597 l 36.0514,62.44298 z" id="path73-8" />` +
    `<g id="g71" style="display:inline">` +
    `<path d="m 1545.6847,-484.26723 a 15.154405,15.154405 0 0 0 -15.1542,15.15419 15.154405,15.154405 0 0 0 15.1542,15.15419 15.154405,15.154405 0 0 0 12.4695,-6.54079 11.043303,11.043303 0 0 1 -6.9109,2.43067 11.043303,11.043303 0 0 1 -11.0442,-11.04407 11.043303,11.043303 0 0 1 11.0442,-11.04273 11.043303,11.043303 0 0 1 6.9109,2.42933 15.154405,15.154405 0 0 0 -12.4695,-6.54079 z" style="fill:#ffffff;fill-opacity:1;fill-rule:evenodd;stroke-width:2.7671;stroke-dashoffset:0.1" id="path70" />` +
    `</g>` +
    `</g>`
);

// g75 = STAR: black triangle + 5-pointed star (g72 with translate + inner matrix)
const BONUS_STAR = symbol(
  "glyph-bonus-star",
  "-20 -20 40 40",
  40,
  40,
  `<g transform="scale(0.3203) translate(-1599.500 484.679)">` +
    `<path style="fill:#000000;fill-opacity:1;fill-rule:evenodd;stroke:#000000;stroke-width:5.061;stroke-linecap:butt;stroke-linejoin:miter;stroke-miterlimit:4;stroke-dasharray:none;stroke-dashoffset:0.1;stroke-opacity:1;paint-order:normal" d="m 1581.4742,-422.23606 v -124.88597 l 36.0514,62.44298 z" id="path73" />` +
    `<g id="g72" transform="translate(173.04385,126.55382)" style="display:inline;fill:#ffffff;fill-opacity:1">` +
    `<path style="fill:#ffffff;fill-opacity:1;fill-rule:evenodd;stroke:none;stroke-width:4;stroke-linecap:butt;stroke-linejoin:miter;stroke-miterlimit:4;stroke-dasharray:none;stroke-dashoffset:0.1;stroke-opacity:1;paint-order:normal" id="path67" d="m 1500.6144,-676.3158 4.815,13.85223 14.6622,0.2988 -11.6863,8.85994 4.2467,14.0369 -12.0376,-8.37649 -12.0376,8.37649 4.2467,-14.0369 -11.6863,-8.85994 14.6621,-0.2988 z" transform="matrix(0.82636572,0,0,0.82636572,184.3431,-69.959397)" />` +
    `</g>` +
    `</g>`
);

// ---------------------------------------------------------------------------
// Stripe patterns (duplicated from web tileFill.ts / board render usage)
// ---------------------------------------------------------------------------
const STRIPE_PATTERNS = [
  `<pattern id="stripe-red" patternUnits="userSpaceOnUse" width="26" height="26" patternTransform="rotate(45)">` +
    `<rect width="26" height="26" fill="#d5d3c4"/>` +
    `<rect width="13" height="26" fill="#c0392b"/>` +
    `</pattern>`,
  `<pattern id="stripe-black" patternUnits="userSpaceOnUse" width="26" height="26" patternTransform="rotate(45)">` +
    `<rect width="26" height="26" fill="#d5d3c4"/>` +
    `<rect width="13" height="26" fill="#2f343c"/>` +
    `</pattern>`,
  `<pattern id="stripe-source" patternUnits="userSpaceOnUse" width="22" height="22" patternTransform="rotate(45)">` +
    `<rect width="11" height="22" fill="#2f9e44"/>` +
    `</pattern>`
].join("\n");

const SYMBOLS = [
  ARMY_RED,
  ARMY_BLACK,
  SHIP_RED,
  SHIP_BLACK,
  HQ_BLACK,
  HQ_RED,
  STAR,
  HARBOR,
  BONUS_SUN,
  BONUS_MOON,
  BONUS_STAR
].join("\n");

export const ASSETS = {
  defs: `${SYMBOLS}\n${STRIPE_PATTERNS}`,
  place(glyph: GlyphId, at: Pixel, scale = 1): string {
    // Each glyph symbol is a 40×40 viewport (viewBox "-20 -20 40 40") whose art is
    // centred at content (0,0) → viewport centre (20,20). The trailing translate(-20 -20)
    // moves that centre onto `at`, so the glyph is centred on its anchor instead of
    // offset down-right by half the (scaled) viewport.
    const transform = `translate(${at.x} ${at.y}) scale(${scale}) translate(-20 -20)`;
    return el("use", { href: `#${glyph}`, "xlink:href": `#${glyph}`, transform });
  }
};

export function armyGlyph(seat: SeatId): GlyphId {
  return seat === "red" ? "unit-army-red" : "unit-army-black";
}

export function shipGlyph(seat: SeatId): GlyphId {
  return seat === "red" ? "unit-ship-red" : "unit-ship-black";
}

export function hqGlyph(seat: SeatId): GlyphId {
  return seat === "red" ? "glyph-hq-red" : "glyph-hq-black";
}

const BONUS_GLYPHS: GlyphId[] = ["glyph-bonus-sun", "glyph-bonus-moon", "glyph-bonus-star"];

/** Cosmetic bonus marker for the Nth bonus slot (cycles for maps with >3 slots).
 *  The real bonus is drawn randomly at setup; the icon is flavour only. */
export function bonusGlyph(index: number): GlyphId {
  return BONUS_GLYPHS[index % BONUS_GLYPHS.length]!;
}

// ===========================================================================
// Native-scale feature art
//
// board.svg is authored on the same flat-top hex grid the procedural renderer
// uses (hex radius NATIVE_HEX_SIZE = 114), so HQ bases, harbours and piers are
// the artist's own paths rendered VERBATIM at native size — not the 40-unit
// icon <symbol>s above (those stay as a general icon library). Each helper
// returns art pre-translated so its geometric centre is (0,0); assemble.ts
// places it with translate(centroid) scale(hexSize / NATIVE_HEX_SIZE), so on a
// size-114 map (Rivers) the scale is 1 — the feature matches its tile exactly.
// ===========================================================================

/** The hex radius board.svg was authored at; native art is drawn 1:1 at this size. */
export const NATIVE_HEX_SIZE = 114;

// Geometric centres of the verbatim paths above, in their own path coordinates.
const HQ_ART_CENTER: Record<SeatId, Pixel> = {
  black: { x: 660.542, y: -699.311 }, // path9-5-0-3
  red: { x: 1002.477, y: -896.765 } // path9-5-0-3-6
};
const HARBOR_ART_CENTER: Pixel = { x: 1301.579, y: -304.371 }; // g46 outer/inner hexes
const PIER_ART_CENTER: Pixel = { x: 664.81867, y: -385.63547 }; // path49

// path49 — a short thick dashed dock stub, drawn vertical (along ±y).
const PIER_D = "m 664.81866,-403.19715 2e-5,35.12336 z";

/** HQ base: the tile-sized coloured hex outline (board.svg path9-5-0-3 / -6). */
export function hqBaseArt(seat: SeatId): string {
  const d = seat === "red" ? HQ_RED_D : HQ_BLACK_D;
  const stroke = seat === "red" ? "#e02d2d" : "#000000";
  const c = HQ_ART_CENTER[seat];
  return el("path", {
    d,
    transform: `translate(${-c.x} ${-c.y})`,
    class: "hq-base",
    style: `fill:none;stroke:${stroke};stroke-width:8;stroke-linecap:butt;stroke-linejoin:miter`
  });
}

/** Harbour: two concentric hex outlines, solid outer + dashed inner (board.svg g46). */
export function harborArt(): string {
  const c = HARBOR_ART_CENTER;
  return el(
    "g",
    { transform: `translate(${-c.x} ${-c.y})`, class: "harbor" },
    el("path", {
      d: HARBOR_OUTER_D,
      style: "fill:none;stroke:#000000;stroke-width:5;stroke-linecap:butt;stroke-linejoin:miter"
    }) +
      el("path", {
        d: HARBOR_INNER_D,
        style:
          "fill:none;stroke:#000000;stroke-width:8.09188;stroke-linecap:butt;stroke-linejoin:miter;stroke-dasharray:4.04592,1.61836;stroke-dashoffset:0"
      })
  );
}

/** Pier: a dock stub (board.svg path49), centred at (0,0) and drawn vertical.
 *  assemble.ts rotates it to point from the harbour tile toward the sea. */
export function pierArt(): string {
  const c = PIER_ART_CENTER;
  return el("path", {
    d: PIER_D,
    transform: `translate(${-c.x} ${-c.y})`,
    class: "pier",
    style:
      "fill:#000000;stroke:#000000;stroke-width:21.4469;stroke-linecap:butt;stroke-linejoin:bevel;stroke-miterlimit:4;stroke-dasharray:2.14469,1.28682;stroke-dashoffset:2.14469"
  });
}
