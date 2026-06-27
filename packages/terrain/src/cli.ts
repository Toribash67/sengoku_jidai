import { fal } from "@fal-ai/client";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { createFalBackend } from "./backend.js";
import { artifactDir, loadDefaultProfile, renderMapControl, webAssetPath } from "./pipeline.js";
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
  const styleReference = readFileSync(profile.styleReferencePath); // clear ENOENT if missing

  // Stage 1: control image (also saved for inspection).
  console.log(`[terrain] rendering control image for "${mapId}"…`);
  const control = await renderMapControl(mapId, profile);
  const outDir = artifactDir(mapId);
  mkdirSync(outDir, { recursive: true });
  writeFileSync(`${outDir}/control.png`, control);

  // Stage 2: generate.
  console.log(`[terrain] generating terrain via ${profile.model}…`);
  fal.config({ credentials: key });
  const backend = createFalBackend({ fal, fetch });
  const generated = await backend.generate({ control, styleReference, profile });
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
    `[terrain] done:\n  control:   ${outDir}/control.png\n  generated: ${outDir}/generated.png\n  asset:     ${assetPath}`
  );
}

main().catch((err) => {
  console.error(`[terrain] ${err instanceof Error ? err.message : String(err)}`);
  process.exitCode = 1;
});
