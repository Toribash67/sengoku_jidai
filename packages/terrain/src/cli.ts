import { fal } from "@fal-ai/client";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { createFalBackend } from "./backend.js";
import { artifactDir, loadDefaultProfile, renderMapBase, webAssetPath } from "./pipeline.js";
import { toWebp } from "./postprocess.js";

async function main(): Promise<void> {
  const mapId = process.argv[2];
  if (!mapId) {
    throw new Error("usage: pnpm --filter @sengoku-jidai/terrain gen <mapId>");
  }
  const key = process.env.FAL_KEY;
  if (!key) {
    throw new Error("FAL_KEY is not set (see .env.example)");
  }

  const profile = loadDefaultProfile();

  // Stage 1: colour base (land/sea regions + organic coastlines), also saved for inspection.
  console.log(`[terrain] rendering colour base for "${mapId}"…`);
  const base = await renderMapBase(mapId, profile);
  const outDir = artifactDir(mapId);
  mkdirSync(outDir, { recursive: true });
  writeFileSync(`${outDir}/base.png`, base);

  // Stage 2: image-to-image generation.
  console.log(`[terrain] generating terrain via ${profile.model}…`);
  fal.config({ credentials: key });
  const backend = createFalBackend({ fal, fetch });
  const generated = await backend.generate({ base, profile });
  writeFileSync(`${outDir}/generated.png`, generated);

  // Stage 3: post-process + write the committed web asset.
  const webp = await toWebp(generated, {
    width: profile.outputSize.width,
    height: profile.outputSize.height,
    quality: profile.webpQuality
  });
  const assetPath = webAssetPath(mapId);
  mkdirSync(dirname(assetPath), { recursive: true });
  writeFileSync(assetPath, webp);

  console.log(
    `[terrain] done:\n  base:      ${outDir}/base.png\n  generated: ${outDir}/generated.png\n  asset:     ${assetPath}`
  );
}

main().catch((err) => {
  console.error(`[terrain] ${err instanceof Error ? err.message : String(err)}`);
  process.exitCode = 1;
});
