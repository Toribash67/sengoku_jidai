# Controllable Coastline Distortion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Lower the default map-background coastline distortion and add a `--amplitude` CLI override to `gen:map-control` so it can be swept without editing the profile JSON.

**Architecture:** The control image's coastline warp magnitude lives in `base.coastWarp.amplitude` (pixels). We drop its default from 160 to 30 (profile JSON + zod default), and add a pure `parseMapControlArgs` helper that parses an optional `--amplitude` flag; the `gen:map-control` CLI applies that override onto the profile before rendering.

**Tech Stack:** TypeScript (ESM, `.js` import specifiers), `node:util` `parseArgs`, zod, vitest.

## Global Constraints

- Package: `@sengoku-jidai/terrain`; source in `packages/terrain/src`, tests in `packages/terrain/test`.
- ESM: relative imports use `.js` specifiers (e.g. `./mapControlArgs.js`).
- `amplitude` is pixels at the control render width; must be a finite number `>= 0`; `0` disables the warp.
- `scale` and `seed` remain profile-only — do not add flags for them.
- No changes to `masks.ts` warp logic, the web app, or other CLIs.
- Verify with `pnpm --filter @sengoku-jidai/terrain test` and `pnpm --filter @sengoku-jidai/terrain typecheck`.

---

### Task 1: Lower the default amplitude (profile + schema)

**Files:**
- Modify: `packages/terrain/profiles/map.json:7`
- Modify: `packages/terrain/src/mapProfile.ts:15-20`

**Interfaces:**
- Consumes: nothing.
- Produces: profile default `base.coastWarp.amplitude === 30`.

- [ ] **Step 1: Lower the profile JSON value**

In `packages/terrain/profiles/map.json`, change line 7:

```json
    "coastWarp": { "amplitude": 30, "scale": 0.003, "seed": 7 }
```

- [ ] **Step 2: Lower the zod default and update the comment**

In `packages/terrain/src/mapProfile.ts`, update the `coastWarp` doc comment and default. Replace lines 15-20:

```ts
    /** Domain-warps the land/sea boundary through a smooth noise vector field so hex edges
     *  bend into natural, connected coastlines. `amplitude` is the max displacement in pixels
     *  (kept low so the background hugs the tile layout — the override flag on gen:map-control
     *  can raise it); `scale` is the noise base frequency (smaller = larger bays). amplitude 0
     *  disables. */
    coastWarp: z
      .object({
        amplitude: z.number().min(0).default(30),
```

- [ ] **Step 3: Verify typecheck passes**

Run: `pnpm --filter @sengoku-jidai/terrain typecheck`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add packages/terrain/profiles/map.json packages/terrain/src/mapProfile.ts
git commit -m "feat(terrain): lower default coastline warp amplitude 160 -> 30"
```

---

### Task 2: Pure `parseMapControlArgs` helper (TDD)

**Files:**
- Create: `packages/terrain/src/mapControlArgs.ts`
- Test: `packages/terrain/test/mapControlArgs.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `parseMapControlArgs(argv: string[]): { mapId: string; amplitude?: number }`
  where `argv` is `process.argv.slice(2)`. Throws `Error` on missing mapId, or on
  `--amplitude` that is non-numeric or `< 0`. `amplitude` is `undefined` when the flag
  is absent.

- [ ] **Step 1: Write the failing test**

Create `packages/terrain/test/mapControlArgs.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { parseMapControlArgs } from "../src/mapControlArgs.js";

describe("parseMapControlArgs", () => {
  it("returns the mapId with no amplitude when the flag is absent", () => {
    expect(parseMapControlArgs(["honshu"])).toEqual({ mapId: "honshu" });
  });

  it("parses a numeric --amplitude override", () => {
    expect(parseMapControlArgs(["honshu", "--amplitude", "80"])).toEqual({
      mapId: "honshu",
      amplitude: 80
    });
  });

  it("allows --amplitude 0 (disables warp)", () => {
    expect(parseMapControlArgs(["honshu", "--amplitude", "0"])).toEqual({
      mapId: "honshu",
      amplitude: 0
    });
  });

  it("throws when mapId is missing", () => {
    expect(() => parseMapControlArgs([])).toThrow(/usage/i);
    expect(() => parseMapControlArgs(["--amplitude", "30"])).toThrow(/usage/i);
  });

  it("throws on a non-numeric --amplitude", () => {
    expect(() => parseMapControlArgs(["honshu", "--amplitude", "foo"])).toThrow(
      /must be a number/i
    );
  });

  it("throws on a negative --amplitude (=-1 form; node:util needs = for dash values)", () => {
    expect(() => parseMapControlArgs(["honshu", "--amplitude=-1"])).toThrow(/must be a number/i);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @sengoku-jidai/terrain test mapControlArgs`
Expected: FAIL — cannot resolve `../src/mapControlArgs.js`.

- [ ] **Step 3: Implement the helper**

Create `packages/terrain/src/mapControlArgs.ts`:

```ts
import { parseArgs } from "node:util";

const USAGE =
  "usage: pnpm --filter @sengoku-jidai/terrain gen:map-control <mapId> [--amplitude <px>]";

/**
 * Parse the gen:map-control CLI args. `argv` is `process.argv.slice(2)`. Returns the
 * required mapId and an optional coastWarp amplitude override (pixels, >= 0; 0 disables
 * the warp). Throws with a clear message on a missing mapId or an invalid amplitude.
 * Note: a dash-leading value must use the `--amplitude=-1` form — `node:util` parseArgs
 * rejects the space form `--amplitude -1` as ambiguous before our validation runs.
 */
export function parseMapControlArgs(argv: string[]): { mapId: string; amplitude?: number } {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: { amplitude: { type: "string" } }
  });

  const mapId = positionals[0];
  if (!mapId) {
    throw new Error(USAGE);
  }

  if (values.amplitude === undefined) {
    return { mapId };
  }

  const amplitude = Number(values.amplitude);
  if (!Number.isFinite(amplitude) || amplitude < 0) {
    throw new Error(`--amplitude must be a number >= 0 (got "${values.amplitude}")`);
  }
  return { mapId, amplitude };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @sengoku-jidai/terrain test mapControlArgs`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/terrain/src/mapControlArgs.ts packages/terrain/test/mapControlArgs.test.ts
git commit -m "feat(terrain): parseMapControlArgs helper for --amplitude override"
```

---

### Task 3: Wire the override into the CLI

**Files:**
- Modify: `packages/terrain/src/mapControlCli.ts:16-34`

**Interfaces:**
- Consumes: `parseMapControlArgs` from Task 2 (`{ mapId, amplitude? }`); profile
  `base.coastWarp` from `loadMapProfile`.
- Produces: control render that uses the overridden amplitude when `--amplitude` is given.

- [ ] **Step 1: Replace argv parsing and apply the override**

In `packages/terrain/src/mapControlCli.ts`, add the import alongside the existing imports:

```ts
import { parseMapControlArgs } from "./mapControlArgs.js";
```

Then replace the start of `main()` (the `const mapId = process.argv[2]` block through the
`renderLandMask` call) with:

```ts
  const { mapId, amplitude } = parseMapControlArgs(process.argv.slice(2));
  const profile = loadMapProfile(fileURLToPath(new URL("../profiles/map.json", import.meta.url)));
  const { base } = profile;
  const svgMarkup = readFileSync(mapSvgPath(mapId), "utf8");
  const width = base.outputSize.width;
  const height = outputHeightForViewBox(svgMarkup, width);

  const coastWarp = { ...base.coastWarp, amplitude: amplitude ?? base.coastWarp.amplitude };
  console.log(
    `[terrain] coastWarp amplitude: ${coastWarp.amplitude} ${
      amplitude === undefined ? "(profile)" : "(override)"
    }`
  );

  const landMask = await renderLandMask({
    svgMarkup,
    map: getMap(mapId),
    width,
    height,
    organicSigma: base.organicSigma,
    coastWarp
  });
```

- [ ] **Step 2: Verify typecheck passes**

Run: `pnpm --filter @sengoku-jidai/terrain typecheck`
Expected: no errors. (Confirm the old `process.argv[2]` usage-throw block is gone — the
mapId check now lives in `parseMapControlArgs`.)

- [ ] **Step 3: Smoke-test the CLI override and validation**

Run (replace `<mapId>` with a real map id from `packages/terrain/assets/controls` or
`getMap` registry — e.g. inspect `packages/terrain/src/mapSources.ts`):

```bash
pnpm --filter @sengoku-jidai/terrain gen:map-control <mapId>
pnpm --filter @sengoku-jidai/terrain gen:map-control <mapId> --amplitude 80
pnpm --filter @sengoku-jidai/terrain gen:map-control <mapId> --amplitude=-1
```

Expected: first logs `coastWarp amplitude: 30 (profile)` and writes the control; second
logs `coastWarp amplitude: 80 (override)`; third exits non-zero with
`--amplitude must be a number >= 0`. (A dash-leading value needs the `=` form — the space
form `--amplitude -1` is rejected by `node:util` with an "ambiguous argument" message.)

- [ ] **Step 4: Commit**

```bash
git add packages/terrain/src/mapControlCli.ts
git commit -m "feat(terrain): --amplitude override on gen:map-control"
```

---

### Task 4: Final verification

**Files:** none (verification only).

- [ ] **Step 1: Run the terrain test suite**

Run: `pnpm --filter @sengoku-jidai/terrain test`
Expected: PASS, including `mapControlArgs.test.ts`.

- [ ] **Step 2: Run typecheck**

Run: `pnpm --filter @sengoku-jidai/terrain typecheck`
Expected: no errors.

- [ ] **Step 3: Confirm the working tree is clean**

Run: `git status --short`
Expected: empty (all changes committed across Tasks 1-3).
