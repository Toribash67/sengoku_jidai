import { mkdirSync, writeFileSync } from "node:fs";
import { artifactDir, loadDefaultProfile, renderMapBase } from "./pipeline.js";

/**
 * Render ONLY the colour base for a map and write it to `terrain/<mapId>/base.png`, so you can
 * preview the land/sea regions + coastlines that condition generation — no API key or paid run.
 */
async function main(): Promise<void> {
  const mapId = process.argv[2];
  if (!mapId) {
    throw new Error("usage: pnpm --filter @sengoku-jidai/terrain gen:base <mapId>");
  }

  const profile = loadDefaultProfile();
  console.log(`[terrain] rendering colour base for "${mapId}"…`);
  const base = await renderMapBase(mapId, profile);

  const outDir = artifactDir(mapId);
  mkdirSync(outDir, { recursive: true });
  const outPath = `${outDir}/base.png`;
  writeFileSync(outPath, base);
  console.log(`[terrain] base image written: ${outPath}`);
}

main().catch((err) => {
  console.error(`[terrain] ${err instanceof Error ? err.message : String(err)}`);
  process.exitCode = 1;
});
