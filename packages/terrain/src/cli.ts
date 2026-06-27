import { fal } from "@fal-ai/client";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { getMap } from "@sengoku-jidai/engine";
import { createFalBackend } from "./backend.js";
import { renderControlImage, tileColorMap } from "./controlImage.js";
import { mapSvgPath } from "./mapSources.js";
import { toWebp } from "./postprocess.js";
import { loadStyleProfile } from "./styleProfile.js";

const repoRoot = fileURLToPath(new URL("../../../", import.meta.url));

async function main(): Promise<void> {
  const mapId = process.argv[2];
  if (!mapId) {
    throw new Error("usage: pnpm --filter @sengoku-jidai/terrain gen <mapId>");
  }
  const key = process.env.FAL_KEY;
  if (!key) {
    throw new Error("FAL_KEY is not set (see .env.example)");
  }

  const map = getMap(mapId); // throws on unknown map id
  const svgMarkup = readFileSync(mapSvgPath(mapId), "utf8");
  const profilePath = fileURLToPath(new URL("../profiles/antique.json", import.meta.url));
  const profile = loadStyleProfile(profilePath);
  const styleReference = readFileSync(profile.styleReferencePath); // throws with a clear ENOENT if missing

  // Stage 1: control image (also saved for inspection).
  console.log(`[terrain] rendering control image for "${mapId}"…`);
  const control = await renderControlImage({
    svgMarkup,
    colors: tileColorMap(map),
    width: profile.outputSize.width,
    height: profile.outputSize.height
  });
  const artifactDir = `${repoRoot}terrain/${mapId}`;
  mkdirSync(artifactDir, { recursive: true });
  writeFileSync(`${artifactDir}/control.png`, control);

  // Stage 2: generate.
  console.log(`[terrain] generating terrain via ${profile.model}…`);
  fal.config({ credentials: key });
  const backend = createFalBackend({ fal, fetch });
  const generated = await backend.generate({ control, styleReference, profile });
  writeFileSync(`${artifactDir}/generated.png`, generated);

  // Stage 3: post-process + write the committed web asset.
  const webp = await toWebp(generated, {
    width: profile.outputSize.width,
    height: profile.outputSize.height,
    quality: profile.webpQuality
  });
  const assetPath = `${repoRoot}packages/web/src/assets/terrain/${mapId}.webp`;
  mkdirSync(dirname(assetPath), { recursive: true });
  writeFileSync(assetPath, webp);

  console.log(
    `[terrain] done:\n  control:   ${artifactDir}/control.png\n  generated: ${artifactDir}/generated.png\n  asset:     ${assetPath}`
  );
}

main().catch((err) => {
  console.error(`[terrain] ${err instanceof Error ? err.message : String(err)}`);
  process.exitCode = 1;
});
