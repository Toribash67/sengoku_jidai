import { compileHexMap, registerMap, type HexMapSource } from "@sengoku-jidai/engine";

/**
 * A second map for testing the bots away from Rivers, where the scoring weights were fitted.
 * A disc of 37 single-hex tiles with a river of five sea tiles across the middle, an HQ at each
 * end of it, and everything mirrored through the centre so neither side is favoured.
 */
const key = (q: number, r: number) => `${q},${r}`;
const pairs = (cells: [number, number][]) =>
  new Set(cells.flatMap(([q, r]) => [key(q, r), key(-q, -r)]));

const TWO_STARS = pairs([[1, -2]]);
const ONE_STAR = pairs([
  [-1, -1],
  [2, -3],
  [0, -3],
  [1, 0],
  [0, 0]
]);
const HARBORS = pairs([
  [-2, 1],
  [-1, -1]
]);
const SHELLABLE = pairs([
  [0, -1],
  [-1, 1]
]);
const BONUS = pairs([
  [1, -2],
  [-2, 2]
]);

function source(): HexMapSource {
  const tiles: HexMapSource["tiles"] = [];
  for (let q = -3; q <= 3; q++) {
    for (let r = Math.max(-3, -q - 3); r <= Math.min(3, -q + 3); r++) {
      const k = key(q, r);
      const hq = k === key(-3, 0) ? "red" : k === key(3, 0) ? "black" : undefined;
      const sea = r === 0 && !hq;
      tiles.push({
        id: `h${q}_${r}`,
        kind: sea ? "sea" : "land",
        hexes: [{ q, r }],
        features: {
          ...(hq ? { hq } : {}),
          ...(TWO_STARS.has(k) ? { valueStars: 2 } : ONE_STAR.has(k) ? { valueStars: 1 } : {}),
          ...(HARBORS.has(k) || hq ? { harbor: true } : {}),
          ...(SHELLABLE.has(k) ? { shellable: true } : {})
        }
      });
    }
  }
  return {
    id: "river-disc",
    name: "River Disc",
    layout: { size: 114, originX: 0, originY: 0 },
    tiles,
    startingDeployment: {
      "h-3_0": { seat: "red", troop: 3 },
      "h-2_0": { seat: "red", ship: 1 },
      h3_0: { seat: "black", troop: 3 },
      h2_0: { seat: "black", ship: 1 }
    },
    bonusSlots: tiles.filter((t) => BONUS.has(key(t.hexes[0]!.q, t.hexes[0]!.r))).map((t) => t.id)
  };
}

/** Register the test map and return its id. */
export function registerTestMap(): string {
  const { definition } = compileHexMap(source());
  registerMap(definition);
  return definition.id;
}
