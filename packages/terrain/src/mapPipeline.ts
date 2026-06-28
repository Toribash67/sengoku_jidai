import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { getMap } from "@sengoku-jidai/engine";
import { compositeMap, harmonize } from "./composite.js";
import { mapSvgPath } from "./mapSources.js";
import { renderMasks } from "./masks.js";
import type { MapProfile } from "./mapProfile.js";
import { toWebp } from "./postprocess.js";
import { generateTexture, type TextureDeps } from "./texture.js";

/**
 * Run the mask-composite map pipeline: structure comes from the vector SVG (renderMasks),
 * texture from two parallel text-to-image calls, then deterministic clip + harmonize. Writes
 * every intermediate next to the final webp for inspection.
 */
export async function runMapPipeline(
  deps: TextureDeps,
  args: { mapId: string; profile: MapProfile; outDir: string }
): Promise<{ outDir: string; webpPath: string }> {
  const { mapId, profile, outDir } = args;
  const { base } = profile;
  const { width, height } = base.outputSize;

  const map = getMap(mapId); // throws on unknown map id
  const svgMarkup = readFileSync(mapSvgPath(mapId), "utf8");

  mkdirSync(outDir, { recursive: true });

  const masks = await renderMasks({
    svgMarkup,
    map,
    width,
    height,
    organicSigma: base.organicSigma,
    inkColor: base.inkColor,
    strokeWidth: base.strokeWidth
  });
  writeFileSync(join(outDir, "landMask.png"), masks.landMask);
  writeFileSync(join(outDir, "coastStroke.png"), masks.coastStroke);

  const texArgs = (region: { prompt: string; seed: number }) => ({
    model: base.model,
    prompt: region.prompt,
    seed: region.seed,
    width,
    height,
    guidanceScale: profile.guidanceScale,
    numInferenceSteps: profile.numInferenceSteps
  });
  const [landTexture, seaTexture] = await Promise.all([
    generateTexture(deps, texArgs(profile.land)),
    generateTexture(deps, texArgs(profile.sea))
  ]);
  writeFileSync(join(outDir, "land.png"), landTexture);
  writeFileSync(join(outDir, "sea.png"), seaTexture);

  const composited = await compositeMap({
    landTexture,
    seaTexture,
    landMask: masks.landMask,
    coastStroke: masks.coastStroke,
    width,
    height
  });
  writeFileSync(join(outDir, "composite.png"), composited);

  const aged = await harmonize(composited, profile.harmonize);
  const webp = await toWebp(aged, { width, height, quality: profile.webpQuality });
  const webpPath = join(outDir, "background.webp");
  writeFileSync(webpPath, webp);

  return { outDir, webpPath };
}
