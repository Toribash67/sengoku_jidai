import type { Pixel, SeatId, BonusType } from "@sengoku-jidai/engine";
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
  | "glyph-bonus-barracks"
  | "glyph-bonus-warroom"
  | "glyph-bonus-pirate"
  | "glyph-bonus-shipyard"
  | "glyph-bonus-hidden"
  | "glyph-bonus-armoury"
  | "glyph-bonus-generic";

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
    `<path d="${SHIP_BLACK_D}" fill="${SEAT_FILL.black}" stroke="#000000" stroke-width="4"/>` +
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
// Bonus badge symbols — a washi disc carrying a placeholder mark (a sumi letter per
// bonus, or a dot for the generic slot marker). Final per-bonus art replaces the inner
// content later; the id↔bonus mapping (bonusTypeGlyph) stays fixed.
// ---------------------------------------------------------------------------
const BADGE_DISC = `<circle r="17" fill="#f4ecd8" stroke="#20242b" stroke-width="2.5"/>`;

function letterBadge(id: string, letter: string): string {
  return symbol(
    id,
    "-20 -20 40 40",
    40,
    40,
    BADGE_DISC +
      `<text x="0" y="1" text-anchor="middle" dominant-baseline="central" ` +
      `font-family="Georgia, 'Times New Roman', serif" font-size="22" font-weight="700" ` +
      `fill="#20242b">${letter}</text>`
  );
}

const BONUS_BARRACKS = letterBadge("glyph-bonus-barracks", "B");
const BONUS_WARROOM = letterBadge("glyph-bonus-warroom", "W");
const BONUS_PIRATE = letterBadge("glyph-bonus-pirate", "P");
const BONUS_SHIPYARD = letterBadge("glyph-bonus-shipyard", "S");
const BONUS_HIDDEN = letterBadge("glyph-bonus-hidden", "H");
const BONUS_ARMOURY = letterBadge("glyph-bonus-armoury", "A");

// Generic "a bonus sits here" marker for contexts with no assigned bonus (map editor,
// static previews): the same washi disc with a small filled sumi dot.
const BONUS_GENERIC = symbol(
  "glyph-bonus-generic",
  "-20 -20 40 40",
  40,
  40,
  BADGE_DISC + `<circle r="6" fill="#20242b"/>`
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

// ---------------------------------------------------------------------------
// Order-symbol tokens — defs g1-9 (move), g1-5 (sail), g1-7 (bombard) and
// g1-0 (shell) from board.svg, extracted verbatim (internal ids stripped so the
// groups can live in our defs). Each token is the artist's quarter-scale black
// hex (radius ≈28.4 at native size) plus a white icon. The wrapper translate
// centres the BLACK HEX (not the overflowing icon) at (0,0), so assemble.ts can
// seat the token on a tile edge; centres computed from the nested matrices.
// ---------------------------------------------------------------------------
export type OrderKind = "move" | "sail" | "bombard" | "shell";

/** Native circumradius of the token's black hex (path width 189.646 × inner matrix
 *  1.1965682 × outer 0.25, halved). scene.ts nests tokens so this corner-to-centre
 *  distance lands the token's outer vertex exactly on the region's vertex. */
export const ORDER_TOKEN_RADIUS = 28.3653;

const ORDER_ART_CENTER: Record<OrderKind, Pixel> = {
  move: { x: 490.0928, y: -403.1972 },
  sail: { x: 532.6411, y: -378.6319 },
  bombard: { x: 575.1895, y: -403.1972 },
  shell: { x: 532.6411, y: -427.7625 }
};

const ORDER_ART_INNER: Record<OrderKind, string> = {
  move:
    `<g transform="matrix(0.25,0,0,0.25,413.45016,-482.31317)"><path style="fill:#000000;fill-opacity:1;fill-rule:evenodd;stroke:none" d="M 63.45577,37.504402 16.044226,119.62361 h -94.82309 l -47.411546,-82.119208 47.411546,-82.119204 h 94.82309 z" transform="matrix(1.1965682,0,0,1.1965682,344.10362,271.58746)" />` +
    `<path style="fill:#ffffff;fill-opacity:1;fill-rule:evenodd;stroke:none" d="m 254.1223,272.01653 92.45714,42.33805 7.09449,-21.51231 15.10438,53.09421 -54.00961,13.04469 16.70636,-15.79095 -88.79547,-50.5768 65.22348,19.68147 z" /></g>`,
  sail:
    `<g transform="matrix(0.25,0,0,0.25,429.79821,-391.8676)"><path style="fill:#000000;fill-opacity:1;fill-rule:evenodd;stroke:none" d="M 63.45577,37.504402 16.044226,119.62361 h -94.82309 l -47.411546,-82.119208 47.411546,-82.119204 h 94.82309 z" transform="matrix(1.1965682,0,0,1.1965682,448.90485,8.0664157)" />` +
    `<g transform="translate(337.185,-9.2053158)" style="fill:#e8e8e8;fill-opacity:1;stroke:none"><path style="fill:#e8e8e8;fill-opacity:1;fill-rule:evenodd;stroke:none" d="M 102.66053,86.30254 140.73518,81.507954 125.78736,46.253648 123.24905,61.765543 23.690893,8.1789988 65.149953,40.048891 15.511894,21.716652 113.94191,77.277437 Z" />` +
    `<path style="fill:#e8e8e8;fill-opacity:1;stroke:none" d="m 79.661062,87.168312 1.115845,-1.765854 0.08116,0.04583 8.230888,4.648006 -1.405139,-13.797671 -51.874633,-29.293751 -12.541043,5.922224 9.241245,5.21856 0.970143,0.547839 -0.128069,0.305313 -2.883709,5.598532 -3.3031,5.357348 -3.223729,4.412536 -0.446738,0.611492 -1.425249,1.65533 -2.547792,2.959104 -1.027982,1.005212 0.399829,0.200626 0.642019,0.322244 0.43462,0.218103 0.755887,0.379305 0.06037,0.02377 2.532655,0.972396 2.680612,0.741124 2.74159,0.471734 2.773953,0.199204 2.782437,-0.06946 2.760876,-0.346432 2.44821,-0.55335 0.26346,-0.0596 0.285775,-0.09483 -0.212534,0.34453 -0.480563,0.779025 -4.274986,5.858941 -0.966688,1.324859 -5.678815,6.589721 -1.47088,1.438768 0.573746,0.288172 1.529508,0.768398 1.087681,0.54634 0.08563,0.0328 3.625114,1.38985 3.830771,1.0564 0.110783,0.0192 3.805273,0.65576 0.479707,0.0345 3.483092,0.2501 3.972086,-0.10084 3.94619,-0.4931 3.875796,-0.87572 3.771215,-1.25167 3.628737,-1.61422 3.456776,-1.96311 3.248371,-2.293453 3.004894,-2.60023 2.734845,-2.882967 z" /></g></g>`,
  bombard:
    `<g transform="matrix(0.25,0,0,0.25,556.26682,-416.49418)"><path style="fill:#000000;fill-opacity:1;fill-rule:evenodd;stroke:none" d="M 63.45577,37.504402 16.044226,119.62361 h -94.82309 l -47.411546,-82.119208 47.411546,-82.119204 h 94.82309 z" transform="matrix(1.1965682,0,0,1.1965682,113.22384,8.3114902)" />` +
    `<circle style="fill:#ffffff;fill-opacity:1;stroke:none" cx="74.302063" cy="23.713425" r="22.922977" />` +
    `<path style="fill:#000000;fill-opacity:0;stroke:none" d="m 37.544044,24.880909 -16.62438,5.591837 18.58908,3.778268 z" />` +
    `<path style="fill:#fefefe;fill-opacity:1;fill-rule:evenodd;stroke:none" d="M 110.95703,27.751953 A 36.509426,36.509426 0 0 1 74.646484,60.447266 36.509426,36.509426 0 0 1 41.320312,38.845703 L 40,39.056641 21.103516,57.638672 C 51.970288,55.433903 51.96875,55.75 51.96875,55.75 L 39.371094,79.6875 62.994141,60.789062 v 55.748048 l 22.046875,-0.31445 0.945312,-55.119144 8.818359,14.173828 -0.945312,-16.064453 29.292965,11.96875 -17.32421,-25.826172 26.77343,-6.615235 -21.41797,-11.023437 z" /></g>`,
  shell:
    `<g transform="matrix(0.25,0,0,0.25,343.75917,-539.89396)"><path style="fill:#000000;fill-opacity:1;fill-rule:evenodd;stroke:none" d="M 63.45577,37.504402 16.044226,119.62361 h -94.82309 l -47.411546,-82.119208 47.411546,-82.119204 h 94.82309 z" transform="matrix(1.1965682,0,0,1.1965682,793.06103,403.64939)" />` +
    `<path style="fill:#ffffff;fill-opacity:1;stroke:none" d="m 784.47759,405.09844 0.0834,-2.0872 0.0932,-9.4e-4 9.45215,-0.0901 -8.11571,-11.24657 -59.57163,0.56819 -7.89975,11.39932 10.61243,-0.10121 1.11409,-0.0106 0.0417,0.32845 0.3019,6.29032 -0.1819,6.29115 -0.58556,5.43323 -0.0811,0.75295 -0.40664,2.14618 -0.7269,3.83655 -0.38765,1.38453 0.44658,-0.0262 0.71712,-0.0419 0.48544,-0.0284 0.84427,-0.0494 0.0642,-0.01 2.67955,-0.4242 2.69203,-0.69848 2.61015,-0.96226 2.50192,-1.21446 2.37491,-1.45141 2.21778,-1.68045 1.84354,-1.70332 0.19836,-0.18335 0.20009,-0.22498 -0.0118,0.40463 -0.0267,0.91493 -0.77278,7.21149 -0.17475,1.63071 -1.62313,8.54627 -0.55444,1.98145 0.64096,-0.0373 1.70879,-0.0993 1.21513,-0.0707 0.0905,-0.0144 3.83438,-0.60891 3.84574,-1.00052 0.10554,-0.0388 3.62334,-1.33473 0.43269,-0.20998 3.14149,-1.52495 3.38951,-2.07338 3.17096,-2.40013 2.91867,-2.69629 2.64014,-2.96959 2.33547,-3.21232 2.01209,-3.42849 1.66645,-3.61037 1.3022,-3.75432 0.92696,-3.86414 z" />` +
    `<path style="fill:#ffffff;fill-opacity:1;fill-rule:evenodd;stroke:none" d="m 703.07999,417.98455 7.99334,1.66528 -14.32139,29.97499 25.64527,-6.32805 -13.65527,24.97915 22.31471,-6.66111 -1.66528,13.98833 20.31638,-11.98999 0.33306,43.2972 -30.30804,0.33306 -31.97332,-62.61442 z" />` +
    `<path style="fill:#ffffff;fill-opacity:1;fill-rule:evenodd;stroke:none" d="m 774.68691,507.24341 17.98499,0.66611 34.30471,-60.61609 -8.65944,-13.98833 -25.31221,4.32972 16.31971,28.30971 -27.31054,-10.99082 2.33139,17.31888 -10.32472,-8.32639 z" />` +
    `<path style="fill:#ffffff;fill-opacity:1;fill-rule:evenodd;stroke:none" d="m 795.33635,420.31594 19.65027,11.32389 -7.66028,-13.32222 z" /></g>`
};

const ORDER_DEFS = (Object.keys(ORDER_ART_INNER) as OrderKind[])
  .map((kind) => {
    const c = ORDER_ART_CENTER[kind];
    return el(
      "g",
      { id: `order-art-${kind}`, transform: `translate(${-c.x} ${-c.y})` },
      ORDER_ART_INNER[kind]
    );
  })
  .join("\n");

const SYMBOLS = [
  ARMY_RED,
  ARMY_BLACK,
  SHIP_RED,
  SHIP_BLACK,
  HQ_BLACK,
  HQ_RED,
  STAR,
  HARBOR,
  BONUS_BARRACKS,
  BONUS_WARROOM,
  BONUS_PIRATE,
  BONUS_SHIPYARD,
  BONUS_HIDDEN,
  BONUS_ARMOURY,
  BONUS_GENERIC
].join("\n");

export const ASSETS = {
  defs: `${SYMBOLS}\n${ORDER_DEFS}\n${STRIPE_PATTERNS}`,
  place(glyph: GlyphId, at: Pixel, scale = 1, attrs: Record<string, string> = {}): string {
    // Each glyph symbol is a 40×40 viewport (viewBox "-20 -20 40 40") whose art is
    // centred at content (0,0) → viewport centre (20,20). The trailing translate(-20 -20)
    // moves that centre onto `at`, so the glyph is centred on its anchor instead of
    // offset down-right by half the (scaled) viewport.
    const transform = `translate(${at.x} ${at.y}) scale(${scale}) translate(-20 -20)`;
    return el("use", { href: `#${glyph}`, "xlink:href": `#${glyph}`, transform, ...attrs });
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

const BONUS_TYPE_GLYPHS: Record<BonusType, GlyphId> = {
  barracks: "glyph-bonus-barracks",
  warRoom: "glyph-bonus-warroom",
  pirateHaven: "glyph-bonus-pirate",
  shipyard: "glyph-bonus-shipyard",
  hiddenBase: "glyph-bonus-hidden",
  armoury: "glyph-bonus-armoury"
};

/** The badge glyph for a specific assigned bonus. */
export function bonusTypeGlyph(bonus: BonusType): GlyphId {
  return BONUS_TYPE_GLYPHS[bonus];
}

// ===========================================================================
// Native-scale feature art
//
// board.svg is authored on the same flat-top hex grid the procedural renderer
// uses (hex radius NATIVE_HEX_SIZE = 114), so piers are the artist's own paths
// rendered VERBATIM at native size — not the 40-unit icon <symbol>s above
// (those stay as a general icon library). Each helper returns art pre-translated
// so its geometric centre is (0,0); assemble.ts places it with
// translate(centroid) scale(hexSize / NATIVE_HEX_SIZE), so on a size-114 map
// (Rivers) the scale is 1 — the feature matches its tile exactly.
// ===========================================================================

/** The hex radius board.svg was authored at; native art is drawn 1:1 at this size. */
export const NATIVE_HEX_SIZE = 114;

// Geometric centres of the verbatim paths above, in their own path coordinates.
const PIER_ART_CENTER: Pixel = { x: 664.81867, y: -385.63547 }; // path49

// path49 — a short thick dashed dock stub, drawn vertical (along ±y).
const PIER_D = "m 664.81866,-403.19715 2e-5,35.12336 z";

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

/** Native length of the pier stub (path49), so assemble.ts can seat it starting at the tile edge. */
export const PIER_ART_LENGTH = 35.12336;

// Value-star badges. board.svg draws the 1-star as a circle badge (g64) and the
// 2-star as an elongated pill with two stars (g63). Both share STAR_PATH_D and
// are rendered verbatim at native scale, pre-centred at (0,0) on the badge.
const STAR_BADGE = `<g transform="translate(36.771176,10.01285)"><path d="${STAR_PATH_D}" transform="matrix(0.30500519,0,0,0.30500519,873.57673,-447.29887)" style="fill:#ce3485;stroke:#ffffff;stroke-width:4.91795"/></g>`;

/** 1-star badge — board.svg g64 (black circle + one star), centred on the circle. */
export function star1Art(): string {
  return el(
    "g",
    { transform: "translate(-1297.8433 635.729)", class: "star" },
    `<circle cx="1297.8433" cy="-635.729" r="25.298941" style="fill:#000000;stroke:#ffffff;stroke-width:2"/>` +
      STAR_BADGE
  );
}

/** 2-star badge — board.svg g63 (tilted black pill + two stars), centred on the pill. */
export function star2Art(): string {
  const inner =
    `<ellipse cx="1063.4695" cy="-885.24939" rx="37.737999" ry="25.06002" transform="rotate(15)" style="fill:#000000;stroke:#ffffff;stroke-width:2"/>` +
    `<g transform="rotate(45,1178.7099,-624.84933)"><path d="${STAR_PATH_D}" transform="matrix(0.30500519,0,0,0.30500519,873.57673,-447.29887)" style="fill:#ce3485;stroke:#ffffff;stroke-width:4.91795"/></g>` +
    `<g transform="rotate(45,1182.2796,-610.47442)"><path d="${STAR_PATH_D}" transform="matrix(0.30500519,0,0,0.30500519,873.57673,-447.29887)" style="fill:#ce3485;stroke:#ffffff;stroke-width:4.91795"/></g>`;
  return el(
    "g",
    { transform: "translate(-1294.143 561.608)", class: "star" },
    el("g", { transform: "rotate(-45,1297.2825,-616.34605)" }, inner)
  );
}
