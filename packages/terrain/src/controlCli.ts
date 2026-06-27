import { mkdirSync, writeFileSync } from "node:fs";
import { artifactDir, loadDefaultProfile, renderMapControl } from "./pipeline.js";

/**
 * Render ONLY the land/sea control image for a map and write it to `terrain/<mapId>/control.png`,
 * so you can preview the SVG-derived coastline mask without an API key or a generation run.
 */
async function main(): Promise<void> {
  const mapId = process.argv[2];
  if (!mapId) {
    throw new Error("usage: pnpm --filter @sengoku-jidai/terrain gen:control <mapId>");
  }

  const profile = loadDefaultProfile();
  console.log(`[terrain] rendering control image for "${mapId}"…`);
  const control = await renderMapControl(mapId, profile);

  const outDir = artifactDir(mapId);
  mkdirSync(outDir, { recursive: true });
  const outPath = `${outDir}/control.png`;
  writeFileSync(outPath, control);
  console.log(`[terrain] control image written: ${outPath}`);
}

main().catch((err) => {
  console.error(`[terrain] ${err instanceof Error ? err.message : String(err)}`);
  process.exitCode = 1;
});
