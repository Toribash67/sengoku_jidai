import { fal } from "@fal-ai/client";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { loadMapProfile } from "./mapProfile.js";
import { runMapPipeline } from "./mapPipeline.js";

async function main(): Promise<void> {
  const mapId = process.argv[2];
  if (!mapId) {
    throw new Error("usage: pnpm --filter @sengoku-jidai/terrain gen:map <mapId>");
  }
  const key = process.env.FAL_KEY;
  if (!key) {
    throw new Error("FAL_KEY is not set (see .env.example)");
  }
  const baseOut =
    process.env.TERRAIN_OUT_DIR ??
    fileURLToPath(new URL(`../../../terrain/${mapId}`, import.meta.url));
  const outDir = process.env.TERRAIN_OUT_DIR ? join(baseOut, mapId) : baseOut;

  const profile = loadMapProfile(fileURLToPath(new URL("../profiles/map.json", import.meta.url)));

  console.log(`[terrain] map pipeline for "${mapId}" → ${outDir}`);
  fal.config({ credentials: key });
  const { webpPath } = await runMapPipeline({ fal, fetch }, { mapId, profile, outDir });
  console.log(`[terrain] done. final: ${webpPath}\n  intermediates in: ${outDir}`);
}

main().catch((err) => {
  console.error(`[terrain] ${err instanceof Error ? err.message : String(err)}`);
  process.exitCode = 1;
});
