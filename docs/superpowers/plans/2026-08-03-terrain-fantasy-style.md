# Fantasy terrain style — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a third selectable terrain style, "Fantasy (colour)", and generate it as a live terrain for the Small Testmap.

**Architecture:** Terrain styles are declared once in `TERRAIN_STYLES` (shared) and each id maps to a committed profile JSON in the terrain package; the generation pipeline reads the profile's control-image + edit-prompt + texture-ref swatch. This plan adds the `fantasy` id, a `fantasy.json` profile, a two-band texture-ref swatch, then runs one real generation and inserts the result as a `map_terrains` row into the live container DB.

**Tech Stack:** TypeScript, Zod, Vitest, pnpm workspaces, `fal-ai/gpt-image-1.5/edit`, ImageMagick, better-sqlite3, Docker.

## Global Constraints

- Terrain is client-side per-viewer preference only — NO engine / GameState / realtime / stateSchema changes.
- `TERRAIN_STYLES` in `packages/shared/src/api.ts` is the single source of truth for style id + label; nothing else hard-codes the id list.
- New style id: `fantasy`; UI label: `Fantasy (colour)`. `DEFAULT_TERRAIN_STYLE` stays `antique`.
- Control colours are fixed across styles: land `#2e7d32`, sea `#1565c0` (never appear in final output).
- Never hand the edit model a full-map reference — the texture-ref is a top-half-land / bottom-half-sea legend only; all land/sea placement comes from the control map.
- Fal credits are limited: offline-verify the control first; cap real generations at 1–2 (~$0.17 each).
- Small Testmap id: `fc5161b0-f889-41e6-ab32-9106276c86c7`. Source template: `/mnt/ssd_pool/ssd_set/terrain-gen/new_fantasy_terrain.PNG`.
- Full gate before push: `corepack pnpm typecheck && corepack pnpm test && corepack pnpm build && corepack pnpm lint && corepack pnpm exec prettier --check .` — run prettier LAST, immediately before push.

---

### Task 1: Register the `fantasy` style in shared

**Files:**
- Modify: `packages/shared/src/api.ts:123-126` (the `TERRAIN_STYLES` array)
- Test: `packages/shared/test/api.test.ts` (create if absent; else add a case)

**Interfaces:**
- Consumes: nothing.
- Produces: `TERRAIN_STYLES` now contains `{ id: "fantasy", label: "Fantasy (colour)" }`; `isTerrainStyleId("fantasy") === true`; `TerrainStyleId` union includes `"fantasy"`.

- [ ] **Step 1: Write the failing test**

Add to `packages/shared/test/api.test.ts` (create the file with this content if it doesn't exist):

```ts
import { describe, expect, it } from "vitest";
import { TERRAIN_STYLES, isTerrainStyleId, DEFAULT_TERRAIN_STYLE } from "../src/api.js";

describe("terrain styles", () => {
  it("exposes the fantasy style and keeps antique as default", () => {
    expect(TERRAIN_STYLES.map((s) => s.id)).toEqual(["antique", "ink", "fantasy"]);
    expect(TERRAIN_STYLES.find((s) => s.id === "fantasy")?.label).toBe("Fantasy (colour)");
    expect(isTerrainStyleId("fantasy")).toBe(true);
    expect(DEFAULT_TERRAIN_STYLE).toBe("antique");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `corepack pnpm --filter @sengoku-jidai/shared exec vitest run test/api.test.ts`
Expected: FAIL (fantasy id missing / label undefined).

- [ ] **Step 3: Implement**

In `packages/shared/src/api.ts`, extend the array:

```ts
export const TERRAIN_STYLES = [
  { id: "antique", label: "Antique (colour)" },
  { id: "ink", label: "Ink (greyscale)" },
  { id: "fantasy", label: "Fantasy (colour)" }
] as const;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `corepack pnpm --filter @sengoku-jidai/shared exec vitest run test/api.test.ts`
Expected: PASS.

- [ ] **Step 5: Rebuild shared (consumers read from dist)**

Run: `corepack pnpm --filter @sengoku-jidai/shared build`
Expected: exits 0. (Terrain/server/web consume `@sengoku-jidai/shared` via dist — see `cross-package-gotchas`.)

- [ ] **Step 6: Commit**

```bash
git add packages/shared/src/api.ts packages/shared/test/api.test.ts
git commit -m "feat(terrain): register the fantasy style id + label"
```

---

### Task 2: Build the Fantasy texture-ref swatch

**Files:**
- Create: `packages/terrain/assets/fantasy-texture-ref.png`

**Interfaces:**
- Consumes: nothing.
- Produces: a committed two-band PNG at `assets/fantasy-texture-ref.png` (top = land style, bottom = sea style), referenced by `fantasy.json` in Task 3.

- [ ] **Step 1: Inspect the source to pick crop regions**

The source `new_fantasy_terrain.PNG` is portrait (~1050×1500). Identify a clean **land** patch (green forest + little trees + hills, e.g. the upper-left forested area) and a clean **sea** patch (blue water with wave lines, e.g. the left/bottom ocean). Use ImageMagick to read dimensions first:

Run: `identify /mnt/ssd_pool/ssd_set/terrain-gen/new_fantasy_terrain.PNG`

- [ ] **Step 2: Crop land + sea patches and stack into a legend**

Crop a land swatch and a sea swatch (adjust the `WxH+X+Y` geometry to the regions from Step 1), normalize both to 1024 wide, and stack land-on-top / sea-on-bottom:

```bash
SRC=/mnt/ssd_pool/ssd_set/terrain-gen/new_fantasy_terrain.PNG
OUT=packages/terrain/assets/fantasy-texture-ref.png
# LAND: upper-left forest/hills region; SEA: an open-water region with wave lines.
convert "$SRC" -crop 520x520+120+300 +repage -resize 1024x /tmp/fan-land.png
convert "$SRC" -crop 300x420+0+760 +repage -resize 1024x /tmp/fan-sea.png
convert /tmp/fan-land.png /tmp/fan-sea.png -append "$OUT"
identify "$OUT"
```

- [ ] **Step 3: Eyeball the swatch**

Read `packages/terrain/assets/fantasy-texture-ref.png`. Confirm: top band is clearly colourful illustrated LAND (trees/hills/mountains, cream ground), bottom band is clearly blue SEA with visible wave/depth lines, and NO large recognisable landmass/island shape spans the whole image (it must read as texture, not a map). Re-crop in Step 2 if either band is ambiguous.

- [ ] **Step 4: Commit**

```bash
git add packages/terrain/assets/fantasy-texture-ref.png
git commit -m "feat(terrain): add fantasy texture-ref swatch"
```

---

### Task 3: Add the `fantasy.json` profile + wire the id→profile map

**Files:**
- Create: `packages/terrain/profiles/fantasy.json`
- Modify: `packages/terrain/src/mapProfile.ts:108-111` (`STYLE_PROFILE_FILES`)
- Test: `packages/terrain/test/fantasyProfile.test.ts`

**Interfaces:**
- Consumes: `assets/fantasy-texture-ref.png` (Task 2); `loadStyleProfile`, `loadMapProfile`, `MapProfileSchema` (existing, `packages/terrain/src/mapProfile.ts`).
- Produces: `loadStyleProfile("fantasy")` returns a validated `MapProfile` whose `edit.styleRef === "assets/fantasy-texture-ref.png"`.

- [ ] **Step 1: Write the failing test**

Create `packages/terrain/test/fantasyProfile.test.ts` (mirrors `inkProfile.test.ts`):

```ts
import { describe, expect, it } from "vitest";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { loadStyleProfile } from "../src/mapProfile.js";

describe("fantasy profile", () => {
  it("resolves via style id and points at a committed swatch", () => {
    const p = loadStyleProfile("fantasy");
    expect(p.edit.model).toBe("fal-ai/gpt-image-1.5/edit");
    expect(p.edit.styleRef).toBe("assets/fantasy-texture-ref.png");
    expect(p.edit.inputFidelity).toBe("high");
    expect(p.base.background).toBe("sea");
    expect(p.edit.prompt).toMatch(/fantasy/i);
    expect(p.fortPass.inpaintPrompt).toMatch(/castle/i);
    const swatch = fileURLToPath(new URL(`../${p.edit.styleRef}`, import.meta.url));
    expect(existsSync(swatch)).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `corepack pnpm --filter @sengoku-jidai/terrain exec vitest run test/fantasyProfile.test.ts`
Expected: FAIL — `unknown terrain style "fantasy"`.

- [ ] **Step 3: Create the profile JSON**

Create `packages/terrain/profiles/fantasy.json`:

```json
{
  "base": {
    "landColor": "#2e7d32",
    "seaColor": "#1565c0",
    "outputSize": { "width": 1024 },
    "organicSigma": 20,
    "background": "sea",
    "coastWarp": { "amplitude": 45, "scale": 0.006, "seed": 7 }
  },
  "edit": {
    "model": "fal-ai/gpt-image-1.5/edit",
    "styleRef": "assets/fantasy-texture-ref.png",
    "quality": "high",
    "inputFidelity": "high",
    "prompt": "You are given two images. The FIRST image is a control map: solid GREEN regions are LAND, solid BLUE regions are SEA water. The SECOND image is a TEXTURE LEGEND, not a map — its TOP HALF shows the LAND drawing style (a bright, playful hand-illustrated fantasy map on warm cream parchment: scattered clusters of tiny green pine and round trees, small rounded green grassy hills, little orange and tan ridge mountains, cheerful and colourful) and its BOTTOM HALF shows the SEA drawing style (bright teal-blue water with fine darker concentric wave and depth lines). Redraw the FIRST image as one bright, colourful, playful hand-drawn fantasy map: place LAND in every GREEN region and SEA in every BLUE region, keeping the same islands and landmasses in the SAME positions, sizes and overall shapes as the control. This is a flat overhead map filling the ENTIRE frame edge to edge — no horizon, no sky, no perspective, no empty margin. Draw every COASTLINE as a crisp clean inked line with a thin pale beach, like a hand-drawn fantasy map's hard shelf shore (NOT a soft blurry blend), and echo each coastline with three to five concentric depth-contour lines rippling out into the teal sea. Fill LAND (warm cream ground) with cheerful colourful line-art — scattered little tree clusters, small rounded green hills, little orange ridge mountains — denser inland, sparser near the coast. Keep SEA a bright teal-blue with the concentric depth ripples. IMPORTANT: do NOT copy any shapes, islands, coastlines, or composition from the texture legend — it supplies ONLY the two drawing styles; ALL land and sea placement comes from the control map. CRITICAL MAPPING: green control region becomes cream illustrated LAND, blue control region becomes teal SEA. Do not swap them. Flat top-down 2D map, no labels, no text, no border."
  },
  "fortPass": {
    "inpaintPrompt": "A tiny fantasy castle keep with stone walls and stacked colourful tiered roofs and little pennant flags, drawn in the EXACT same bright playful hand-illustrated map style as the surrounding little trees and hills: clean coloured line-art on warm cream parchment, cheerful and small, no photo-realism, no heavy black cartoon outline, no grey photographic shading. A small flat top-down map symbol that blends seamlessly into the colourful fantasy map."
  },
  "webpQuality": 82
}
```

- [ ] **Step 4: Wire the id → profile file**

In `packages/terrain/src/mapProfile.ts`, extend `STYLE_PROFILE_FILES`:

```ts
const STYLE_PROFILE_FILES: Record<string, string> = {
  antique: "map.json",
  ink: "ink.json",
  fantasy: "fantasy.json"
};
```

- [ ] **Step 5: Run test to verify it passes**

Run: `corepack pnpm --filter @sengoku-jidai/terrain exec vitest run test/fantasyProfile.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/terrain/profiles/fantasy.json packages/terrain/src/mapProfile.ts packages/terrain/test/fantasyProfile.test.ts
git commit -m "feat(terrain): add fantasy.json profile + id mapping"
```

---

### Task 4: Offline-verify the control, then run ONE real generation for the testmap

**Files:**
- Create (throwaway, deleted at end): `packages/terrain/test/_fantasyGen.test.ts`
- Output (scratchpad, not committed): the generated `fantasy.webp` for the testmap.

**Interfaces:**
- Consumes: `loadStyleProfile("fantasy")` (Task 3); `generateTerrainWebp` (`@sengoku-jidai/terrain`), `compileHexMap` (`@sengoku-jidai/engine`), `assembleBoardSvg`/`buildScene` (`@sengoku-jidai/board-render`), `createFalClient` — per the reusable recipe in the `multiple-terrains-initiative` memory.
- Produces: a validated `fantasy.webp` at a scratchpad path, consumed by Task 5.

- [ ] **Step 1: Rebuild upstream dist (recipe requires it)**

Run: `corepack pnpm --filter @sengoku-jidai/shared --filter @sengoku-jidai/engine --filter @sengoku-jidai/board-render --filter @sengoku-jidai/terrain build`
Expected: exits 0.

- [ ] **Step 2: Offline control check (fal-free)**

Confirm the control image for the testmap under the fantasy profile looks right (land/sea correct) BEFORE spending. Use the existing control CLI path:

Run: `corepack pnpm --filter @sengoku-jidai/terrain gen:map-control fc5161b0-f889-41e6-ab32-9106276c86c7 fantasy` (if `gen:map-control` requires a built-in name it won't resolve the testmap id — in that case skip to Step 3's vitest which builds the control in-process; the control colours/geometry are identical to antique/ink which are already verified for this map).
Expected: a `control.png` with green land / blue sea matching the testmap; OR fall through as noted.

- [ ] **Step 3: Write the throwaway real-gen test**

Get the FAL key and testmap source, then create `packages/terrain/test/_fantasyGen.test.ts` following the memory recipe (compile source → buildScene → assembleBoardSvg → `generateTerrainWebp(loadStyleProfile("fantasy"), …)` → write webp to a scratchpad path). Fetch the source from `http://127.0.0.1:18081/api/maps/fc5161b0-f889-41e6-ab32-9106276c86c7` (IPv4, not localhost). Model the test body on the existing `generateTerrainWebp.test.ts` structure for the exact `generateTerrainWebp` signature and `EditDeps`/`createFalClient` wiring.

- [ ] **Step 4: Run the real generation (1 gen, ~$0.17)**

```bash
CID=$(docker ps -q --filter name=sengoku | head -1)
FAL_KEY=$(docker exec "$CID" printenv FAL_KEY)
FAL_KEY="$FAL_KEY" corepack pnpm --filter @sengoku-jidai/terrain exec vitest run test/_fantasyGen.test.ts --testTimeout=180000
```
Expected: writes `fantasy.webp` to the scratchpad path. (Testmap has forts t31/t32 → the fort inpaint pass also runs, ~$0.05/fort via FLUX Fill.)

- [ ] **Step 5: Eyeball the composite on the board**

```bash
corepack pnpm --filter @sengoku-jidai/board-render exec tsx scripts/terrain-shot.ts \
  --map fc5161b0-f889-41e6-ab32-9106276c86c7 \
  --terrain-url <scratchpad>/fantasy.webp --out /tmp/fan.html
LD_LIBRARY_PATH=$HOME/.local/chromium-deps/lib node ~/.local/bin/svgshot.mjs /tmp/fan.html /tmp/fan.png
```
Read `/tmp/fan.png`. Confirm: land sits on the tiles (no big upward drift), colourful playful look, crisp coastlines, forts show small castles. If clearly wrong, reroll Step 4 ONCE (cap 2 total); if still wrong, STOP and report rather than burning credits.

- [ ] **Step 6: Delete the throwaway test (do NOT commit it)**

```bash
rm packages/terrain/test/_fantasyGen.test.ts
```

No commit in this task — its deliverable is the verified `fantasy.webp` in scratchpad, consumed by Task 5.

---

### Task 5: Insert the Fantasy terrain as a live row on the testmap

**Files:**
- None in-repo. Operates on the container DB `/data/sengoku.sqlite`.

**Interfaces:**
- Consumes: the verified `fantasy.webp` (Task 4); the `map_terrains` insert shape from `TerrainStore.create` (`packages/server/src/maps/terrainStore.ts:30-40`) but with `status='ready'` + `webp` set (mirroring `markReadyById`).
- Produces: a new `map_terrains` row (`map_id=fc5161b0…`, `name='Fantasy'`, `style_id='fantasy'`, `status='ready'`, `webp=<blob>`) so the in-game picker shows "Fantasy".

- [ ] **Step 1: Back up existing testmap terrain rows (rollback safety)**

```bash
CID=$(docker ps -q --filter name=sengoku | head -1)
docker exec "$CID" node -e "const db=require('/app/node_modules/better-sqlite3')('/data/sengoku.sqlite');console.log(JSON.stringify(db.prepare('SELECT id,map_id,name,style_id,status,length(webp) AS webp_len,created_at,updated_at FROM map_terrains WHERE map_id=?').all('fc5161b0-f889-41e6-ab32-9106276c86c7')))" \
  > /tmp/claude-3000/-mnt-ssd-pool-martin-repos-sengoku-jidai/212f3e99-4e1a-4418-acbe-26f69b44dd32/scratchpad/testmap-terrains-before.json
cat .../scratchpad/testmap-terrains-before.json
```
Expected: JSON listing the existing antique + ink rows (2 rows). Save it.

- [ ] **Step 2: Copy the webp into the container**

```bash
docker cp <scratchpad>/fantasy.webp "$CID":/tmp/fantasy.webp
```

- [ ] **Step 3: Insert the ready row**

Write an insert script mirroring `TerrainStore.create` + `markReadyById` (absolute better-sqlite3 path; `PRAGMA busy_timeout`), copy it in, and run it with cwd `/app`:

```js
// insert-fantasy.cjs
const Database = require("/app/node_modules/better-sqlite3");
const { readFileSync } = require("node:fs");
const { randomUUID } = require("node:crypto");
const db = new Database("/data/sengoku.sqlite");
db.pragma("busy_timeout = 5000");
const webp = readFileSync("/tmp/fantasy.webp");
const id = randomUUID();
const now = new Date().toISOString();
db.prepare(
  `INSERT INTO map_terrains (id, map_id, name, style_id, status, webp, error, created_at, updated_at)
   VALUES (@id, @mapId, 'Fantasy', 'fantasy', 'ready', @webp, NULL, @now, @now)`
).run({ id, mapId: "fc5161b0-f889-41e6-ab32-9106276c86c7", webp, now });
console.log("inserted", id, "bytes", webp.length);
```

```bash
docker cp insert-fantasy.cjs "$CID":/tmp/insert-fantasy.cjs
docker exec -w /app "$CID" node /tmp/insert-fantasy.cjs
```
Expected: prints `inserted <uuid> bytes <n>`.

- [ ] **Step 4: Verify the row is served**

```bash
curl -s http://127.0.0.1:18081/api/maps/fc5161b0-f889-41e6-ab32-9106276c86c7 | \
  node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const t=JSON.parse(s).terrains;console.log(t.map(x=>x.name+':'+x.style_id+':'+x.status))})"
```
Expected: list includes `Fantasy:fantasy:ready` alongside the existing antique + ink.

- [ ] **Step 5: Confirm the bytes match (served == generated)**

```bash
TID=<the uuid from Step 3>
curl -s "http://127.0.0.1:18081/api/maps/fc5161b0-f889-41e6-ab32-9106276c86c7/terrains/$TID.webp" -o /tmp/served-fantasy.webp
cmp <scratchpad>/fantasy.webp /tmp/served-fantasy.webp && echo "MATCH"
```
Expected: `MATCH`.

No repo commit in this task (DB-only). Record the new terrain id in the session notes for rollback.

---

### Task 6: Full gate + PR

**Files:**
- None new. Verifies the whole change set from Tasks 1–3 (Tasks 4–5 are ops, not in the repo).

- [ ] **Step 1: Run the full gate**

```bash
corepack pnpm typecheck && corepack pnpm test && corepack pnpm build && corepack pnpm lint
```
Expected: all green. Fix failures (common: e2e specs asserting old UI text, terrain typecheck includes test/ — see `fort-terrain-drawings` memory). Note the terrain package build re-emits dist consumed by tests, so build before the filtered terrain tests if re-running them.

- [ ] **Step 2: Prettier LAST**

Run: `corepack pnpm exec prettier --check .`
If it flags touched files: `corepack pnpm exec prettier --write <files>` then re-run `--check`.

- [ ] **Step 3: Push + open PR**

```bash
git push -u origin feat/terrain-fantasy-style
gh pr create --title "feat(terrain): Fantasy (colour) terrain style" --body "$(cat <<'EOF'
Adds a third selectable terrain style, **Fantasy (colour)** — a bright, playful
illustrated fantasy-cartography look — alongside antique and ink.

- `TERRAIN_STYLES` gains `{ id: "fantasy", label: "Fantasy (colour)" }` (single source of truth → editor dropdown + generate API + `TerrainStyleId`).
- `packages/terrain/profiles/fantasy.json` + `assets/fantasy-texture-ref.png` (two-band land/sea legend); id mapped in `STYLE_PROFILE_FILES`.
- Crisp inked coastlines; control-driven placement (no reference composition copied).
- Generated live for the Small Testmap and inserted as a ready `map_terrains` row (shows as "Fantasy" in the in-game picker).

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 4: Watch CI to green**

Run: `gh pr checks <n> --watch`
Expected: all green. Fix any failures and re-push.

- [ ] **Step 5: Ask before merging**

Report green + the eyeball PNG; ask Martin to merge (squash + delete branch). Do NOT self-merge.

---

## Self-Review

**Spec coverage:**
- Register style → Task 1. ✓
- id→profile map + profile JSON → Task 3. ✓
- Texture-ref swatch → Task 2. ✓
- Offline verify + 1 real gen + eyeball → Task 4. ✓
- Insert live DB row on testmap → Task 5. ✓
- TDD profile test / delivery gate / PR → Tasks 1, 3, 6. ✓
- Crisp inked coastline intent → encoded in `fantasy.json` prompt (Task 3). ✓

**Placeholder scan:** Task 4 Step 2/3 intentionally reference the in-process vitest recipe rather than re-pasting the full ~40-line throwaway test (it's a delete-after artifact modeled on the committed `generateTerrainWebp.test.ts`); every committed step has literal content. `<scratchpad>` / `<the uuid>` / `<n>` are runtime values, not plan placeholders.

**Type consistency:** `style_id`/`fantasy`, `styleRef === "assets/fantasy-texture-ref.png"`, and the `map_terrains` column list are identical across Tasks 3–5 and match `terrainStore.ts`. `loadStyleProfile` used consistently. ✓
