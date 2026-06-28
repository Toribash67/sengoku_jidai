import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { getMap } from "@sengoku-jidai/engine";
import { renderControl } from "./composite.js";
import { renderLandMask } from "./masks.js";
import { mapControlPath, mapSvgPath } from "./mapSources.js";
import { loadMapProfile } from "./mapProfile.js";
import { outputHeightForViewBox } from "./mapPipeline.js";

/**
 * Render the flat land/sea control image for a map and write it to a committed asset. This is
 * the deterministic input the edit model receives — fal-free (no API key, no cost), so the
 * control is always readily available in the repo and regenerable when the warp/profile changes.
 */
async function main(): Promise<void> {
  const mapId = process.argv[2];
  if (!mapId) {
    throw new Error("usage: pnpm --filter @sengoku-jidai/terrain gen:map-control <mapId>");
  }
  const profile = loadMapProfile(fileURLToPath(new URL("../profiles/map.json", import.meta.url)));
  const { base } = profile;
  const svgMarkup = readFileSync(mapSvgPath(mapId), "utf8");
  const width = base.outputSize.width;
  const height = outputHeightForViewBox(svgMarkup, width);

  const landMask = await renderLandMask({
    svgMarkup,
    map: getMap(mapId),
    width,
    height,
    organicSigma: base.organicSigma,
    coastWarp: base.coastWarp
  });
  const control = await renderControl({
    landMask,
    landColor: base.landColor,
    seaColor: base.seaColor,
    width,
    height
  });

  const outPath = mapControlPath(mapId);
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, control);
  console.log(`[terrain] control written: ${outPath}`);
}

main().catch((err) => {
  console.error(`[terrain] ${err instanceof Error ? err.message : String(err)}`);
  process.exitCode = 1;
});
