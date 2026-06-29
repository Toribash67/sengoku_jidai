# Hex Map Data Model + Geometry + Adjacency Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a flat-top hex authoring format plus a compiler that derives the engine's existing `MapDefinition` (with auto-derived adjacency) and a separate `MapLayout`, and make starting deployment map-driven.

**Architecture:** New pure module `packages/engine/src/maps/hex/` (coordinate math, authoring types, validator, compiler) with zero changes to runtime rules code except one backward-compatible field. The compiler emits the *existing* `MapDefinition` shape so legality/supply/scoring stay untouched. Tests mirror the invariants `riversMap.test.ts` already enforces.

**Tech Stack:** TypeScript (ESM, `.js` import specifiers), Vitest. Package `@sengoku-jidai/engine`.

## Global Constraints

- Flat-top hexagons; axial `(q, r)` coordinates; edge-adjacency only (six neighbors), never corner-touch.
- Engine stays pure and deterministic: no `Math.random`, no `Date`; adjacency lists sorted; object keys follow tile insertion order.
- Imports use explicit `.js` specifiers (ESM/NodeNext), e.g. `import { axialKey } from "./coords.js"`.
- Two seats only: `SeatId = "red" | "black"` (from `packages/engine/src/types.ts`).
- The compiler emits the **existing** `MapDefinition`/`MapArea` shape from `packages/engine/src/maps/riversMap.ts`; do not change those shapes except the one additive field in Task 4.
- Tests live under `packages/engine/test/...` mirroring `src` (existing convention, e.g. `packages/engine/test/maps/riversMap.test.ts`).
- Run a single engine test file with: `cd packages/engine && pnpm exec vitest run <path>`. Run the whole engine suite with: `pnpm --filter @sengoku-jidai/engine test`.

---

### Task 1: Hex coordinate math (`coords.ts`)

**Files:**
- Create: `packages/engine/src/maps/hex/coords.ts`
- Test: `packages/engine/test/maps/hex/coords.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `interface Axial { q: number; r: number }`
  - `interface Cube { x: number; y: number; z: number }`
  - `interface HexLayout { size: number; originX: number; originY: number }`
  - `interface Pixel { x: number; y: number }`
  - `const NEIGHBOR_DIRS: readonly Axial[]` (six flat-top directions)
  - `axialKey(a: Axial): string` → `"q,r"`
  - `axialToCube(a: Axial): Cube`, `cubeToAxial(c: Cube): Axial`
  - `neighbors(a: Axial): Axial[]`, `areNeighbors(a: Axial, b: Axial): boolean`
  - `hexDistance(a: Axial, b: Axial): number`
  - `axialToPixel(a: Axial, layout: HexLayout): Pixel`, `pixelToAxial(p: Pixel, layout: HexLayout): Axial`
  - `axialRound(a: Axial): Axial`

- [ ] **Step 1: Write the failing test**

Create `packages/engine/test/maps/hex/coords.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  areNeighbors,
  axialKey,
  axialRound,
  axialToCube,
  axialToPixel,
  cubeToAxial,
  hexDistance,
  neighbors,
  NEIGHBOR_DIRS,
  pixelToAxial
} from "../../../src/maps/hex/coords.js";

describe("hex coords", () => {
  it("has six distinct edge neighbor directions", () => {
    expect(NEIGHBOR_DIRS).toHaveLength(6);
    const keys = new Set(NEIGHBOR_DIRS.map(axialKey));
    expect(keys.size).toBe(6);
    expect(keys.has("0,0")).toBe(false);
  });

  it("computes the six neighbors of the origin", () => {
    const got = new Set(neighbors({ q: 0, r: 0 }).map(axialKey));
    expect(got).toEqual(new Set(["1,0", "1,-1", "0,-1", "-1,0", "-1,1", "0,1"]));
  });

  it("areNeighbors is true for edge neighbors and false for self and corner-touch", () => {
    expect(areNeighbors({ q: 0, r: 0 }, { q: 1, r: 0 })).toBe(true);
    expect(areNeighbors({ q: 0, r: 0 }, { q: 0, r: 0 })).toBe(false);
    // (0,0) and (1,1) share only a corner, not an edge.
    expect(areNeighbors({ q: 0, r: 0 }, { q: 1, r: 1 })).toBe(false);
  });

  it("round-trips axial <-> cube", () => {
    const a = { q: 2, r: -3 };
    expect(cubeToAxial(axialToCube(a))).toEqual(a);
  });

  it("measures hex distance", () => {
    expect(hexDistance({ q: 0, r: 0 }, { q: 0, r: 0 })).toBe(0);
    expect(hexDistance({ q: 0, r: 0 }, { q: 1, r: 0 })).toBe(1);
    expect(hexDistance({ q: 0, r: 0 }, { q: 2, r: -1 })).toBe(2);
  });

  it("round-trips pixel <-> axial for flat-top layout", () => {
    const layout = { size: 114, originX: 0, originY: 0 };
    for (const a of [{ q: 0, r: 0 }, { q: 3, r: -2 }, { q: -1, r: 4 }]) {
      expect(pixelToAxial(axialToPixel(a, layout), layout)).toEqual(a);
    }
  });

  it("places origin hex at the layout origin", () => {
    expect(axialToPixel({ q: 0, r: 0 }, { size: 10, originX: 5, originY: 7 })).toEqual({
      x: 5,
      y: 7
    });
  });

  it("axialRound snaps fractional coordinates to the nearest hex", () => {
    expect(axialRound({ q: 0.2, r: -0.1 })).toEqual({ q: 0, r: 0 });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/engine && pnpm exec vitest run test/maps/hex/coords.test.ts`
Expected: FAIL — cannot resolve `../../../src/maps/hex/coords.js`.

- [ ] **Step 3: Write minimal implementation**

Create `packages/engine/src/maps/hex/coords.ts`:

```ts
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
  return (
    (Math.abs(a.q - b.q) + Math.abs(a.q + a.r - b.q - b.r) + Math.abs(a.r - b.r)) / 2
  );
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
  return cubeToAxial({ x: rx, y: ry, z: rz });
}

export function pixelToAxial(p: Pixel, layout: HexLayout): Axial {
  const q = ((p.x - layout.originX) / layout.size) * (2 / 3);
  const r = (p.y - layout.originY) / (layout.size * Math.sqrt(3)) - q / 2;
  return axialRound({ q, r });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/engine && pnpm exec vitest run test/maps/hex/coords.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/engine/src/maps/hex/coords.ts packages/engine/test/maps/hex/coords.test.ts
git commit -m "feat(maps): flat-top hex coordinate math"
```

---

### Task 2: Authoring format types, fixture, and validator (`source.ts`, `fixtures.ts`, `validate.ts`)

**Files:**
- Create: `packages/engine/src/maps/hex/source.ts`
- Create: `packages/engine/src/maps/hex/fixtures.ts`
- Create: `packages/engine/src/maps/hex/validate.ts`
- Test: `packages/engine/test/maps/hex/validate.test.ts`

**Interfaces:**
- Consumes: `Axial`, `axialKey`, `areNeighbors`, `NEIGHBOR_DIRS` from `coords.js`; `SeatId` from `../../types.js`; `StartingUnits` from `../riversMap.js` (added in Task 4 — for Tasks 2–3, define it locally in `source.ts` as shown, then Task 4 moves the canonical copy to `riversMap.ts` and `source.ts` re-imports it).
- Produces:
  - `source.ts`: `interface HexTileSource`, `interface HexMapSource`, `interface StartingUnits` (interim home), exported.
  - `fixtures.ts`: `const FIXTURE_HEX_MAP: HexMapSource`.
  - `validate.ts`: `validateHexMap(source: HexMapSource): void` (throws on any structural error).

- [ ] **Step 1: Write the failing test**

Create `packages/engine/test/maps/hex/validate.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { FIXTURE_HEX_MAP } from "../../../src/maps/hex/fixtures.js";
import type { HexMapSource } from "../../../src/maps/hex/source.js";
import { validateHexMap } from "../../../src/maps/hex/validate.js";

function clone(): HexMapSource {
  return structuredClone(FIXTURE_HEX_MAP);
}

describe("validateHexMap", () => {
  it("accepts the fixture map", () => {
    expect(() => validateHexMap(FIXTURE_HEX_MAP)).not.toThrow();
  });

  it("rejects an empty map", () => {
    expect(() => validateHexMap({ ...clone(), tiles: [] })).toThrow(/no tiles/);
  });

  it("rejects duplicate tile ids", () => {
    const m = clone();
    m.tiles[1]!.id = m.tiles[0]!.id;
    expect(() => validateHexMap(m)).toThrow(/duplicate tile id/);
  });

  it("rejects a hex shared by two tiles", () => {
    const m = clone();
    m.tiles[1]!.hexes[0] = { ...m.tiles[0]!.hexes[0]! };
    expect(() => validateHexMap(m)).toThrow(/in both/);
  });

  it("rejects a disconnected tile", () => {
    const m = clone();
    // Append a hex far away from this tile's existing hex(es).
    m.tiles[0]!.hexes.push({ q: 99, r: 99 });
    expect(() => validateHexMap(m)).toThrow(/not edge-connected/);
  });

  it("rejects a tile with no hexes", () => {
    const m = clone();
    m.tiles[0]!.hexes = [];
    expect(() => validateHexMap(m)).toThrow(/no hexes/);
  });

  it("rejects an hq on a sea tile", () => {
    const m = clone();
    const sea = m.tiles.find((t) => t.kind === "sea")!;
    sea.features.hq = "red";
    expect(() => validateHexMap(m)).toThrow(/must be land/);
  });

  it("rejects two hqs for the same seat", () => {
    const m = clone();
    const lands = m.tiles.filter((t) => t.kind === "land" && t.features.hq === undefined);
    lands[0]!.features.hq = "red";
    expect(() => validateHexMap(m)).toThrow(/more than one hq/);
  });

  it("rejects a port pointing at a non-sea tile", () => {
    const m = clone();
    const harbor = m.tiles.find((t) => t.features.harbor)!;
    const land = m.tiles.find((t) => t.kind === "land")!;
    harbor.ports = [land.id];
    expect(() => validateHexMap(m)).toThrow(/not sea/);
  });

  it("rejects ports on a non-harbor tile", () => {
    const m = clone();
    const plainLand = m.tiles.find((t) => t.kind === "land" && !t.features.harbor)!;
    const sea = m.tiles.find((t) => t.kind === "sea")!;
    plainLand.ports = [sea.id];
    expect(() => validateHexMap(m)).toThrow(/not a harbor/);
  });

  it("rejects a bonus slot referencing an unknown tile", () => {
    const m = clone();
    m.bonusSlots = ["nope"];
    expect(() => validateHexMap(m)).toThrow(/unknown tile/);
  });

  it("rejects starting deployment on an unknown tile", () => {
    const m = clone();
    m.startingDeployment = { nope: { seat: "red", troop: 1 } };
    expect(() => validateHexMap(m)).toThrow(/unknown tile/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/engine && pnpm exec vitest run test/maps/hex/validate.test.ts`
Expected: FAIL — cannot resolve `fixtures.js` / `source.js` / `validate.js`.

- [ ] **Step 3a: Create the authoring types**

Create `packages/engine/src/maps/hex/source.ts`:

```ts
import type { SeatId } from "../../types.js";
import type { Axial, HexLayout } from "./coords.js";

/**
 * Map-driven starting unit placement for a tile. Interim home: Task 4 moves the
 * canonical declaration to `riversMap.ts` (next to `MapDefinition`) and this file
 * re-imports it, so engine setup and the authoring format share one shape.
 */
export interface StartingUnits {
  seat: SeatId;
  troop?: number;
  ship?: number;
}

/** One game tile: a connected set of same-kind hexes plus its feature flags. */
export interface HexTileSource {
  /** Unique within the map. */
  id: string;
  /** Every member hex inherits this. */
  kind: "land" | "sea";
  /** Connected, non-empty, disjoint from other tiles' hexes. */
  hexes: Axial[];
  features: {
    /** HQ owner if this tile is a faction headquarters. */
    hq?: SeatId;
    valueStars?: 0 | 1 | 2;
    /** Can build/launch ships (a port endpoint). */
    harbor?: boolean;
    /** Coastal land targetable by Shell. */
    shellable?: boolean;
  };
  /** Sea tile ids reachable from this harbor via a pier. Not movement edges. */
  ports?: string[];
}

/** The hex authoring format. Compiled to a runtime `MapDefinition` by `compileHexMap`. */
export interface HexMapSource {
  id: string;
  name: string;
  /** Flat-top layout for the renderer/editor; the engine ignores it. */
  layout: HexLayout;
  tiles: HexTileSource[];
  /** Map-driven starting unit placement, keyed by tile id. */
  startingDeployment: Record<string, StartingUnits>;
  /** Tile ids that receive a random bonus at setup. */
  bonusSlots: string[];
}
```

- [ ] **Step 3b: Create the fixture map**

Create `packages/engine/src/maps/hex/fixtures.ts`. This is a deliberately small map exercising every compiler/validator path. Adjacency (hand-verified, edge-only): A↔{B,C,D}, B↔{A,C,E}, C↔{A,B,D}, D↔{A,C}, E↔{B}.

```ts
import type { HexMapSource } from "./source.js";

/**
 * A tiny synthetic flat-top hex map for tests (NOT Rivers). Five tiles:
 *   A  land, red HQ            hexes (0,0)
 *   B  land, 1 star, shellable hexes (1,0),(1,-1)   (a 2-hex tile)
 *   C  sea, 1 star             hexes (0,1)
 *   D  land, harbor -> port C  hexes (-1,1)
 *   E  land, black HQ          hexes (2,-1)
 *
 * Hand-verified edge adjacency (axial neighbors only):
 *   A(0,0)   borders B,C,D
 *   B(1,0/1,-1) borders A,C,E
 *   C(0,1)   borders A,B,D
 *   D(-1,1)  borders A,C
 *   E(2,-1)  borders B
 */
export const FIXTURE_HEX_MAP: HexMapSource = {
  id: "fixture",
  name: "Fixture",
  layout: { size: 114, originX: 0, originY: 0 },
  tiles: [
    { id: "A", kind: "land", hexes: [{ q: 0, r: 0 }], features: { hq: "red" } },
    {
      id: "B",
      kind: "land",
      hexes: [
        { q: 1, r: 0 },
        { q: 1, r: -1 }
      ],
      features: { valueStars: 1, shellable: true }
    },
    { id: "C", kind: "sea", hexes: [{ q: 0, r: 1 }], features: { valueStars: 1 } },
    {
      id: "D",
      kind: "land",
      hexes: [{ q: -1, r: 1 }],
      features: { harbor: true },
      ports: ["C"]
    },
    { id: "E", kind: "land", hexes: [{ q: 2, r: -1 }], features: { hq: "black" } }
  ],
  startingDeployment: {
    A: { seat: "red", troop: 3 },
    C: { seat: "red", ship: 1 },
    E: { seat: "black", troop: 3 }
  },
  bonusSlots: ["B"]
};
```

- [ ] **Step 3c: Create the validator**

Create `packages/engine/src/maps/hex/validate.ts`:

```ts
import type { SeatId } from "../../types.js";
import { areNeighbors, axialKey } from "./coords.js";
import type { Axial } from "./coords.js";
import type { HexMapSource } from "./source.js";

const SEATS: readonly SeatId[] = ["red", "black"];

/** Fail-fast structural validation. Throws on the first error found. */
export function validateHexMap(source: HexMapSource): void {
  const { tiles } = source;
  if (tiles.length === 0) {
    throw new Error("map has no tiles");
  }

  const ids = new Set<string>();
  const owner = new Map<string, string>(); // axialKey -> tileId
  for (const t of tiles) {
    if (ids.has(t.id)) {
      throw new Error(`duplicate tile id: ${t.id}`);
    }
    ids.add(t.id);
    if (t.hexes.length === 0) {
      throw new Error(`tile ${t.id} has no hexes`);
    }
    for (const h of t.hexes) {
      const k = axialKey(h);
      const existing = owner.get(k);
      if (existing) {
        throw new Error(`hex ${k} is in both ${existing} and ${t.id}`);
      }
      owner.set(k, t.id);
    }
    if (!isConnected(t.hexes)) {
      throw new Error(`tile ${t.id} is not edge-connected`);
    }
  }

  const hqBySeat = new Map<SeatId, string>();
  for (const t of tiles) {
    const hq = t.features.hq;
    if (hq === undefined) {
      continue;
    }
    if (!SEATS.includes(hq)) {
      throw new Error(`tile ${t.id} has unknown hq seat: ${String(hq)}`);
    }
    if (t.kind !== "land") {
      throw new Error(`hq tile ${t.id} must be land`);
    }
    if (hqBySeat.has(hq)) {
      throw new Error(`seat ${hq} has more than one hq`);
    }
    hqBySeat.set(hq, t.id);
  }

  for (const t of tiles) {
    if (!t.ports || t.ports.length === 0) {
      continue;
    }
    if (!t.features.harbor) {
      throw new Error(`tile ${t.id} has ports but is not a harbor`);
    }
    for (const id of t.ports) {
      const target = tiles.find((x) => x.id === id);
      if (!target) {
        throw new Error(`tile ${t.id} port references unknown tile ${id}`);
      }
      if (target.kind !== "sea") {
        throw new Error(`tile ${t.id} port ${id} is not sea`);
      }
    }
  }

  for (const id of source.bonusSlots) {
    if (!ids.has(id)) {
      throw new Error(`bonus slot references unknown tile ${id}`);
    }
  }
  for (const [id, units] of Object.entries(source.startingDeployment)) {
    if (!ids.has(id)) {
      throw new Error(`startingDeployment references unknown tile ${id}`);
    }
    if (!SEATS.includes(units.seat)) {
      throw new Error(`startingDeployment ${id} has unknown seat ${String(units.seat)}`);
    }
  }
}

/** True if the hexes form a single edge-connected component. */
function isConnected(hexes: Axial[]): boolean {
  if (hexes.length <= 1) {
    return true;
  }
  const seen = new Set<string>([axialKey(hexes[0]!)]);
  const stack: Axial[] = [hexes[0]!];
  while (stack.length > 0) {
    const cur = stack.pop()!;
    for (const h of hexes) {
      const k = axialKey(h);
      if (!seen.has(k) && areNeighbors(cur, h)) {
        seen.add(k);
        stack.push(h);
      }
    }
  }
  return seen.size === hexes.length;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/engine && pnpm exec vitest run test/maps/hex/validate.test.ts`
Expected: PASS (12 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/engine/src/maps/hex/source.ts packages/engine/src/maps/hex/fixtures.ts packages/engine/src/maps/hex/validate.ts packages/engine/test/maps/hex/validate.test.ts
git commit -m "feat(maps): hex authoring format, fixture, and validator"
```

---

### Task 3: The compiler (`compile.ts`)

**Files:**
- Create: `packages/engine/src/maps/hex/compile.ts`
- Test: `packages/engine/test/maps/hex/compile.test.ts`

**Interfaces:**
- Consumes: `HexMapSource` from `source.js`; `Axial`, `axialKey`, `axialToPixel`, `NEIGHBOR_DIRS` from `coords.js`; `validateHexMap` from `validate.js`; `MapArea`, `MapDefinition` from `../riversMap.js`.
- Produces:
  - `interface MapLayout { size: number; origin: { x: number; y: number }; tiles: Record<string, { hexes: Axial[] }>; bounds: { minX: number; minY: number; maxX: number; maxY: number } }`
  - `interface CompiledMap { definition: MapDefinition; layout: MapLayout }`
  - `compileHexMap(source: HexMapSource): CompiledMap`

> Note: in Task 3, `MapDefinition` does not yet have `startingDeployment`. Build `definition` WITHOUT that field here; Task 4 adds the field to `MapDefinition` and the line that populates it. The compile test in this task therefore does not assert on `definition.startingDeployment`.

- [ ] **Step 1: Write the failing test**

Create `packages/engine/test/maps/hex/compile.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { compileHexMap } from "../../../src/maps/hex/compile.js";
import { FIXTURE_HEX_MAP } from "../../../src/maps/hex/fixtures.js";
import type { HexMapSource } from "../../../src/maps/hex/source.js";

describe("compileHexMap", () => {
  const { definition, layout } = compileHexMap(FIXTURE_HEX_MAP);
  const areas = Object.values(definition.areas);

  it("emits one area per tile, carrying features", () => {
    expect(areas).toHaveLength(5);
    expect(definition.areas.A!.hq).toBe("red");
    expect(definition.areas.E!.hq).toBe("black");
    expect(definition.areas.B!.valueStars).toBe(1);
    expect(definition.areas.B!.shellable).toBe(true);
    expect(definition.areas.D!.harbor).toBe(true);
    expect(definition.areas.D!.ports).toEqual(["C"]);
    expect(definition.areas.A!.hq).not.toBeUndefined();
    expect(definition.areas.C!.hq).toBeNull();
  });

  it("derives adjacency from shared hex edges (sorted)", () => {
    expect(definition.areas.A!.adjacent).toEqual(["B", "C", "D"]);
    expect(definition.areas.B!.adjacent).toEqual(["A", "C", "E"]);
    expect(definition.areas.C!.adjacent).toEqual(["A", "B", "D"]);
    expect(definition.areas.D!.adjacent).toEqual(["A", "C"]);
    expect(definition.areas.E!.adjacent).toEqual(["B"]);
  });

  it("produces a mixed land<->sea edge (A land touches C sea)", () => {
    expect(definition.areas.A!.kind).toBe("land");
    expect(definition.areas.C!.kind).toBe("sea");
    expect(definition.areas.A!.adjacent).toContain("C");
    expect(definition.areas.C!.adjacent).toContain("A");
  });

  it("does NOT make corner-only touching tiles adjacent", () => {
    // Two single-hex tiles that share only a corner: (0,0) and (1,1).
    const cornerMap: HexMapSource = {
      id: "corner",
      name: "Corner",
      layout: { size: 1, originX: 0, originY: 0 },
      tiles: [
        { id: "X", kind: "land", hexes: [{ q: 0, r: 0 }], features: {} },
        { id: "Y", kind: "land", hexes: [{ q: 1, r: 1 }], features: {} }
      ],
      startingDeployment: {},
      bonusSlots: []
    };
    const compiled = compileHexMap(cornerMap);
    expect(compiled.definition.areas.X!.adjacent).toEqual([]);
    expect(compiled.definition.areas.Y!.adjacent).toEqual([]);
  });

  it("has symmetric adjacency with no dangling refs", () => {
    for (const a of areas) {
      for (const id of [...a.adjacent, ...a.ports]) {
        expect(definition.areas[id], `${a.id} -> ${id}`).toBeDefined();
      }
      for (const id of a.adjacent) {
        expect(definition.areas[id]!.adjacent, `${a.id} <-> ${id}`).toContain(a.id);
      }
    }
  });

  it("keeps every shellable land bordering a sea and every sea bordering a land", () => {
    for (const a of areas) {
      if (a.shellable) {
        expect(a.adjacent.some((id) => definition.areas[id]!.kind === "sea")).toBe(true);
      }
      if (a.kind === "sea") {
        expect(a.adjacent.some((id) => definition.areas[id]!.kind === "land")).toBe(true);
      }
    }
  });

  it("carries id, name, and bonus slots", () => {
    expect(definition.id).toBe("fixture");
    expect(definition.name).toBe("Fixture");
    expect(definition.bonusSlots).toEqual(["B"]);
  });

  it("builds a layout with per-tile hexes and pixel bounds", () => {
    expect(layout.size).toBe(114);
    expect(layout.tiles.B!.hexes).toHaveLength(2);
    expect(layout.bounds.maxX).toBeGreaterThan(layout.bounds.minX);
    expect(layout.bounds.maxY).toBeGreaterThan(layout.bounds.minY);
  });

  it("is deterministic", () => {
    const a = compileHexMap(FIXTURE_HEX_MAP);
    const b = compileHexMap(FIXTURE_HEX_MAP);
    expect(JSON.stringify(a.definition)).toEqual(JSON.stringify(b.definition));
  });

  it("validates before compiling (throws on a bad map)", () => {
    expect(() =>
      compileHexMap({ ...structuredClone(FIXTURE_HEX_MAP), tiles: [] })
    ).toThrow(/no tiles/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/engine && pnpm exec vitest run test/maps/hex/compile.test.ts`
Expected: FAIL — cannot resolve `compile.js`.

- [ ] **Step 3: Write minimal implementation**

Create `packages/engine/src/maps/hex/compile.ts`:

```ts
import type { MapArea, MapDefinition } from "../riversMap.js";
import { axialKey, axialToPixel, NEIGHBOR_DIRS } from "./coords.js";
import type { Axial } from "./coords.js";
import type { HexMapSource } from "./source.js";
import { validateHexMap } from "./validate.js";

export interface MapLayout {
  size: number;
  origin: { x: number; y: number };
  tiles: Record<string, { hexes: Axial[] }>;
  bounds: { minX: number; minY: number; maxX: number; maxY: number };
}

export interface CompiledMap {
  definition: MapDefinition;
  layout: MapLayout;
}

/** Compile a hex authoring source into the runtime `MapDefinition` (with adjacency
 *  auto-derived from shared hex edges) plus a separate `MapLayout` for the renderer. */
export function compileHexMap(source: HexMapSource): CompiledMap {
  validateHexMap(source);

  const adjacency = deriveAdjacency(source);
  const areas: Record<string, MapArea> = {};
  for (const t of source.tiles) {
    areas[t.id] = {
      id: t.id,
      kind: t.kind,
      hq: t.features.hq ?? null,
      valueStars: t.features.valueStars ?? 0,
      harbor: t.features.harbor ?? false,
      shellable: t.features.shellable ?? false,
      adjacent: [...(adjacency.get(t.id) ?? [])].sort(),
      ports: [...(t.ports ?? [])].sort()
    };
  }

  const definition: MapDefinition = {
    id: source.id,
    name: source.name,
    areas,
    bonusSlots: [...source.bonusSlots]
  };

  return { definition, layout: buildLayout(source) };
}

/** tileId -> set of adjacent tileIds, symmetric by construction. */
function deriveAdjacency(source: HexMapSource): Map<string, Set<string>> {
  const owner = new Map<string, string>(); // axialKey -> tileId
  for (const t of source.tiles) {
    for (const h of t.hexes) {
      owner.set(axialKey(h), t.id);
    }
  }
  const adj = new Map<string, Set<string>>();
  for (const t of source.tiles) {
    adj.set(t.id, new Set());
  }
  for (const t of source.tiles) {
    for (const h of t.hexes) {
      for (const d of NEIGHBOR_DIRS) {
        const ownerId = owner.get(axialKey({ q: h.q + d.q, r: h.r + d.r }));
        if (ownerId && ownerId !== t.id) {
          adj.get(t.id)!.add(ownerId);
          adj.get(ownerId)!.add(t.id);
        }
      }
    }
  }
  return adj;
}

function buildLayout(source: HexMapSource): MapLayout {
  const layout = source.layout;
  const tiles: Record<string, { hexes: Axial[] }> = {};
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const t of source.tiles) {
    tiles[t.id] = { hexes: t.hexes.map((h) => ({ q: h.q, r: h.r })) };
    for (const h of t.hexes) {
      const p = axialToPixel(h, layout);
      minX = Math.min(minX, p.x - layout.size);
      maxX = Math.max(maxX, p.x + layout.size);
      minY = Math.min(minY, p.y - layout.size);
      maxY = Math.max(maxY, p.y + layout.size);
    }
  }
  return {
    size: layout.size,
    origin: { x: layout.originX, y: layout.originY },
    tiles,
    bounds: { minX, minY, maxX, maxY }
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/engine && pnpm exec vitest run test/maps/hex/compile.test.ts`
Expected: PASS (10 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/engine/src/maps/hex/compile.ts packages/engine/test/maps/hex/compile.test.ts
git commit -m "feat(maps): compile hex source to MapDefinition + layout"
```

---

### Task 4: Map-driven starting deployment + public exports

**Files:**
- Modify: `packages/engine/src/maps/riversMap.ts` (add `StartingUnits`, add `startingDeployment` field to `MapDefinition`)
- Modify: `packages/engine/src/maps/hex/source.ts` (re-import `StartingUnits` instead of declaring it)
- Modify: `packages/engine/src/maps/hex/compile.ts` (populate `definition.startingDeployment`)
- Modify: `packages/engine/src/maps/registry.ts` (add `registerMap`)
- Modify: `packages/engine/src/game.ts` (prefer `map.startingDeployment`, fall back to `RIVERS_STARTING_UNITS`)
- Modify: `packages/engine/src/index.ts` (export the hex module's public API)
- Test: `packages/engine/test/maps/hex/deployment.test.ts`

**Interfaces:**
- Consumes: `compileHexMap` (Task 3), `FIXTURE_HEX_MAP` (Task 2), `createInitialState`/`getMap`/`registerMap`.
- Produces:
  - `riversMap.ts`: `export interface StartingUnits { seat: SeatId; troop?: number; ship?: number }`; `MapDefinition.startingDeployment?: Record<string, StartingUnits>`.
  - `registry.ts`: `registerMap(definition: MapDefinition): void`.
  - `index.ts` re-exports: `compileHexMap`, `validateHexMap`, the hex types, `FIXTURE_HEX_MAP`.

- [ ] **Step 1: Write the failing test**

Create `packages/engine/test/maps/hex/deployment.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { compileHexMap } from "../../../src/maps/hex/compile.js";
import { FIXTURE_HEX_MAP } from "../../../src/maps/hex/fixtures.js";
import { createInitialState } from "../../../src/game.js";
import { registerMap } from "../../../src/maps/registry.js";

describe("map-driven starting deployment", () => {
  it("createInitialState deploys units from the map's startingDeployment", () => {
    const { definition } = compileHexMap(FIXTURE_HEX_MAP);
    registerMap(definition);

    const state = createInitialState({ gameId: "g1", seed: "seed", mapId: definition.id });

    // A: red HQ with 3 troops; C: sea with red ship; E: black HQ with 3 troops.
    expect(state.areas.A!.owner).toBe("red");
    expect(state.areas.A!.units.troop).toBe(3);
    expect(state.areas.C!.owner).toBe("red");
    expect(state.areas.C!.units.ship).toBe(1);
    expect(state.areas.E!.owner).toBe("black");
    expect(state.areas.E!.units.troop).toBe(3);
    // D has no deployment and no hq -> unowned, empty.
    expect(state.areas.D!.owner).toBeNull();
    expect(state.areas.D!.units.troop).toBe(0);
  });

  it("leaves the Rivers map (no startingDeployment) on the hardcoded fallback", () => {
    const state = createInitialState({ gameId: "g2", seed: "seed", mapId: "rivers" });
    // tile9 is the Rivers red HQ with 3 starting troops (RIVERS_STARTING_UNITS).
    expect(state.areas.tile9!.owner).toBe("red");
    expect(state.areas.tile9!.units.troop).toBe(3);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/engine && pnpm exec vitest run test/maps/hex/deployment.test.ts`
Expected: FAIL — `registerMap` is not exported / `startingDeployment` not consumed.

- [ ] **Step 3a: Add `StartingUnits` + `startingDeployment` to the runtime map**

In `packages/engine/src/maps/riversMap.ts`, add after the `MapArea` interface and extend `MapDefinition`:

```ts
/** Map-driven starting unit placement for a tile (seat + counts). */
export interface StartingUnits {
  seat: SeatId;
  troop?: number;
  ship?: number;
}
```

Then add this field inside the `MapDefinition` interface (alongside `bonusSlots`):

```ts
  /**
   * Optional map-driven starting deployment, keyed by area id. When present,
   * `createInitialState` uses it instead of the hardcoded Rivers fallback.
   */
  startingDeployment?: Record<string, StartingUnits>;
```

- [ ] **Step 3b: Re-home `StartingUnits` in the authoring format**

In `packages/engine/src/maps/hex/source.ts`, delete the local `StartingUnits` interface and import the canonical one. Replace the existing `import type { SeatId } ...` / type block top with:

```ts
import type { SeatId } from "../../types.js";
import type { Axial, HexLayout } from "./coords.js";
import type { StartingUnits } from "../riversMap.js";

export type { StartingUnits };
```

(`SeatId` is still used by `HexTileSource.features.hq`. The `export type { StartingUnits }` keeps `source.js` as a valid import site for it.)

- [ ] **Step 3c: Populate `startingDeployment` in the compiler**

In `packages/engine/src/maps/hex/compile.ts`, update the `definition` object literal to include the field:

```ts
  const definition: MapDefinition = {
    id: source.id,
    name: source.name,
    areas,
    bonusSlots: [...source.bonusSlots],
    startingDeployment: { ...source.startingDeployment }
  };
```

- [ ] **Step 3d: Add `registerMap` to the registry**

In `packages/engine/src/maps/registry.ts`, add (the `maps` record is already module-scoped):

```ts
/** Register (or replace) a map at runtime — used by tests and, later, the server's
 *  dynamic map library. Additive: does not affect the built-in maps unless ids collide. */
export function registerMap(definition: MapDefinition): void {
  maps[definition.id] = definition;
}
```

- [ ] **Step 3e: Consume `startingDeployment` in setup**

In `packages/engine/src/game.ts`, change the deployment lookup. Replace:

```ts
    const start = RIVERS_STARTING_UNITS[area.id];
```

with:

```ts
    const start = (map.startingDeployment ?? RIVERS_STARTING_UNITS)[area.id];
```

- [ ] **Step 3f: Export the hex module**

In `packages/engine/src/index.ts`, add after the existing `maps/*` exports:

```ts
export * from "./maps/hex/coords.js";
export * from "./maps/hex/source.js";
export * from "./maps/hex/validate.js";
export * from "./maps/hex/compile.js";
export * from "./maps/hex/fixtures.js";
```

- [ ] **Step 4: Run the new test, then the full engine suite**

Run: `cd packages/engine && pnpm exec vitest run test/maps/hex/deployment.test.ts`
Expected: PASS (2 tests).

Run: `pnpm --filter @sengoku-jidai/engine test`
Expected: PASS — all engine tests green (incl. `riversMap.test.ts`, unchanged).

Run: `pnpm --filter @sengoku-jidai/engine typecheck`
Expected: no type errors.

- [ ] **Step 5: Commit**

```bash
git add packages/engine/src/maps/riversMap.ts packages/engine/src/maps/hex/source.ts packages/engine/src/maps/hex/compile.ts packages/engine/src/maps/registry.ts packages/engine/src/game.ts packages/engine/src/index.ts packages/engine/test/maps/hex/deployment.test.ts
git commit -m "feat(maps): map-driven starting deployment + hex module exports"
```

---

## Self-Review

**Spec coverage:**
- §2 geometry/coords → Task 1. ✓
- §3 authoring format types → Task 2 (source.ts). ✓
- §4 compiler (`CompiledMap`, adjacency derivation, `MapLayout`, bounds) → Task 3. ✓
- §5 validation (every listed rule) → Task 2 (validate.ts + tests for each rule). ✓ (HQ-count, disjoint hexes, connectivity, port endpoint, harbor-without-ports note, bonus/deployment refs, seats.)
- §6 map-driven starting deployment → Task 4. ✓
- §7 file layout (`coords/source/compile/validate/fixtures` + tests) → Tasks 1–4. ✓
- §8 testing (corner-touch non-adjacency, mixed edge, symmetry, determinism, invariants mirror, fixture) → Tasks 1–4. ✓
- §10 done criteria (exports, startingDeployment + fallback, all tests green, no render/editor/server code) → Task 4 Step 4. ✓

**Note on one §5 rule:** the spec lists "the owning tile is marked harbor (throw)". Implemented as the `tile ${id} has ports but is not a harbor` check in `validate.ts`, tested by "rejects ports on a non-harbor tile". The reverse ("harbor without ports") is intentionally NOT enforced here (a harbor with zero ports is structurally valid in the authoring format; Rivers' own test asserts harbor⇒ports for *that* map, not as a universal invariant). This is a deliberate, documented narrowing of spec §5.

**Placeholder scan:** none — every code step contains complete code; every run step has an exact command and expected result.

**Type consistency:** `Axial`, `HexLayout`, `axialKey`, `areNeighbors`, `NEIGHBOR_DIRS`, `axialToPixel` are defined in Task 1 and consumed with identical names in Tasks 2–3. `HexMapSource`/`HexTileSource`/`StartingUnits` defined in Task 2, consumed in Tasks 3–4. `compileHexMap`/`CompiledMap`/`MapLayout` defined in Task 3, consumed in Task 4. `MapDefinition`/`MapArea` referenced from `riversMap.ts` throughout. `registerMap` defined and consumed in Task 4. Consistent. ✓

**Interim-type handling:** Task 2 declares `StartingUnits` locally; Task 4 Step 3a/3b moves the canonical copy to `riversMap.ts` and re-exports it from `source.ts`. The intermediate states (after Task 2, after Task 3) both compile, because `source.ts` is self-contained until Task 4 rewires it. ✓
