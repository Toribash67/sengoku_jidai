import { axialToPixel } from "@sengoku-jidai/engine";
import type { Axial, HexLayout, Pixel } from "@sengoku-jidai/engine";

export interface Edge {
  a: Pixel;
  b: Pixel;
}

/** Quantize a point to a 0.01-unit grid so corners shared between hexes compare exactly
 *  equal (floating-point seam guard). */
const QUANT = 100;
function pkey(p: Pixel): string {
  return `${Math.round(p.x * QUANT)},${Math.round(p.y * QUANT)}`;
}
function edgeKey(a: Pixel, b: Pixel): string {
  const ka = pkey(a);
  const kb = pkey(b);
  return ka < kb ? `${ka}|${kb}` : `${kb}|${ka}`;
}

/** Flat-top hex corners (angles 60·i degrees), radius = size, centred on `center`. */
export function hexCorners(center: Pixel, size: number): Pixel[] {
  const pts: Pixel[] = [];
  for (let i = 0; i < 6; i += 1) {
    const angle = (Math.PI / 180) * 60 * i;
    pts.push({ x: center.x + size * Math.cos(angle), y: center.y + size * Math.sin(angle) });
  }
  return pts;
}

function tileEdges(hexes: Axial[], layout: HexLayout): Map<string, { edge: Edge; n: number }> {
  const counts = new Map<string, { edge: Edge; n: number }>();
  for (const h of hexes) {
    const corners = hexCorners(axialToPixel(h, layout), layout.size);
    for (let i = 0; i < 6; i += 1) {
      const a = corners[i]!;
      const b = corners[(i + 1) % 6]!;
      const k = edgeKey(a, b);
      const cur = counts.get(k);
      if (cur) {
        cur.n += 1;
      } else {
        counts.set(k, { edge: { a, b }, n: 1 });
      }
    }
  }
  return counts;
}

/** Every member-hex edge, deduped (shared edges collapse to one). For the grid layer. */
export function hexEdges(hexes: Axial[], layout: HexLayout): Edge[] {
  return [...tileEdges(hexes, layout).values()].map((e) => e.edge);
}

/** Trace boundary edges into closed rings by walking vertex-to-vertex. */
function traceRings(edges: Edge[]): Pixel[][] {
  const points = new Map<string, Pixel>();
  const adj = new Map<string, Set<string>>();
  const link = (p: Pixel, q: Pixel): void => {
    const kp = pkey(p);
    const kq = pkey(q);
    points.set(kp, p);
    points.set(kq, q);
    (adj.get(kp) ?? adj.set(kp, new Set()).get(kp)!).add(kq);
    (adj.get(kq) ?? adj.set(kq, new Set()).get(kq)!).add(kp);
  };
  for (const e of edges) {
    link(e.a, e.b);
  }

  const used = new Set<string>();
  const usedKey = (a: string, b: string): string => (a < b ? `${a}|${b}` : `${b}|${a}`);
  const rings: Pixel[][] = [];

  for (const startKey of adj.keys()) {
    for (const firstNext of adj.get(startKey)!) {
      if (used.has(usedKey(startKey, firstNext))) {
        continue;
      }
      const ring: Pixel[] = [points.get(startKey)!];
      let prev = startKey;
      let cur = firstNext;
      used.add(usedKey(prev, cur));
      let closed = true;
      while (cur !== startKey) {
        ring.push(points.get(cur)!);
        let moved = false;
        for (const nb of adj.get(cur)!) {
          if (nb === prev || used.has(usedKey(cur, nb))) {
            continue;
          }
          used.add(usedKey(cur, nb));
          prev = cur;
          cur = nb;
          moved = true;
          break;
        }
        if (!moved) {
          closed = false;
          break; // open chain — should not happen for a valid connected tile
        }
      }
      if (closed) {
        rings.push(ring);
      }
    }
  }
  return rings;
}

/** Fuse a connected hex set into its perimeter ring(s): boundary edges are those owned
 *  by exactly one member hex; internal (shared) edges are dropped. */
export function fuseTile(hexes: Axial[], layout: HexLayout): Pixel[][] {
  const boundary: Edge[] = [];
  for (const { edge, n } of tileEdges(hexes, layout).values()) {
    if (n === 1) {
      boundary.push(edge);
    }
  }
  return traceRings(boundary);
}
