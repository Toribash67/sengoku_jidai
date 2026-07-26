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

/** Offset each ring of a fused tile outline outward (away from that ring's own centroid)
 *  by `distance` world units. Edges are shifted along their outward normal and re-intersected
 *  at the corners. Used to draw a parallel line hugging a tile edge (the harbor dash). Rings
 *  with fewer than 3 points are returned unchanged. Concave corners at a small `distance`
 *  behave well; this is not a general-purpose robust polygon offset. */
export function offsetRingsOutward(rings: Pixel[][], distance: number): Pixel[][] {
  return rings.map((ring) => offsetRing(ring, distance));
}

function offsetRing(ring: Pixel[], d: number): Pixel[] {
  const n = ring.length;
  if (n < 3) return ring;
  let cx = 0;
  let cy = 0;
  for (const p of ring) {
    cx += p.x;
    cy += p.y;
  }
  cx /= n;
  cy /= n;
  // Each edge shifted outward along its normal, kept as an anchor point + direction vector.
  const lines = ring.map((a, i) => {
    const b = ring[(i + 1) % n]!;
    let nx = -(b.y - a.y);
    let ny = b.x - a.x;
    const len = Math.hypot(nx, ny) || 1;
    nx /= len;
    ny /= len;
    const mx = (a.x + b.x) / 2;
    const my = (a.y + b.y) / 2;
    const away = (mx + nx - cx) ** 2 + (my + ny - cy) ** 2 > (mx - cx) ** 2 + (my - cy) ** 2;
    const sign = away ? 1 : -1;
    return { px: a.x + nx * d * sign, py: a.y + ny * d * sign, dx: b.x - a.x, dy: b.y - a.y };
  });
  const out: Pixel[] = [];
  for (let i = 0; i < n; i++) {
    const l1 = lines[(i - 1 + n) % n]!;
    const l2 = lines[i]!;
    const den = l1.dx * l2.dy - l1.dy * l2.dx;
    if (Math.abs(den) < 1e-9) {
      out.push({ x: l2.px, y: l2.py });
      continue;
    }
    const t = ((l2.px - l1.px) * l2.dy - (l2.py - l1.py) * l2.dx) / den;
    out.push({ x: l1.px + l1.dx * t, y: l1.py + l1.dy * t });
  }
  return out;
}
