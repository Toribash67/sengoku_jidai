export interface Axial {
  q: number;
  r: number;
}

export interface Cube {
  x: number;
  y: number;
  z: number;
}

export interface HexLayout {
  size: number;
  originX: number;
  originY: number;
}

export interface Pixel {
  x: number;
  y: number;
}

/** The six flat-top edge-neighbor directions (axial). Edge adjacency only — never corner. */
export const NEIGHBOR_DIRS: readonly Axial[] = [
  { q: 1, r: 0 },
  { q: 1, r: -1 },
  { q: 0, r: -1 },
  { q: -1, r: 0 },
  { q: -1, r: 1 },
  { q: 0, r: 1 }
];

export function axialKey(a: Axial): string {
  return `${a.q},${a.r}`;
}

export function axialToCube(a: Axial): Cube {
  const x = a.q;
  const z = a.r;
  return { x, y: -x - z, z };
}

export function cubeToAxial(c: Cube): Axial {
  return { q: c.x, r: c.z };
}

export function neighbors(a: Axial): Axial[] {
  return NEIGHBOR_DIRS.map((d) => ({ q: a.q + d.q, r: a.r + d.r }));
}

export function areNeighbors(a: Axial, b: Axial): boolean {
  return NEIGHBOR_DIRS.some((d) => a.q + d.q === b.q && a.r + d.r === b.r);
}

export function hexDistance(a: Axial, b: Axial): number {
  return (Math.abs(a.q - b.q) + Math.abs(a.q + a.r - b.q - b.r) + Math.abs(a.r - b.r)) / 2;
}

export function axialToPixel(a: Axial, layout: HexLayout): Pixel {
  return {
    x: layout.originX + layout.size * 1.5 * a.q,
    y: layout.originY + layout.size * Math.sqrt(3) * (a.r + a.q / 2)
  };
}

export function axialRound(a: Axial): Axial {
  const cube = axialToCube(a);
  let rx = Math.round(cube.x);
  let ry = Math.round(cube.y);
  let rz = Math.round(cube.z);
  const dx = Math.abs(rx - cube.x);
  const dy = Math.abs(ry - cube.y);
  const dz = Math.abs(rz - cube.z);
  if (dx > dy && dx > dz) {
    rx = -ry - rz;
  } else if (dy > dz) {
    ry = -rx - rz;
  } else {
    rz = -rx - ry;
  }
  // Normalize -0 to 0 to avoid surprising deep-equality failures.
  const result = cubeToAxial({ x: rx, y: ry, z: rz });
  return { q: result.q || 0, r: result.r || 0 };
}

export function pixelToAxial(p: Pixel, layout: HexLayout): Axial {
  const q = ((p.x - layout.originX) / layout.size) * (2 / 3);
  const r = (p.y - layout.originY) / (layout.size * Math.sqrt(3)) - q / 2;
  return axialRound({ q, r });
}
