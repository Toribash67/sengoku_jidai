import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import { getMap } from "@sengoku-jidai/engine";
import { renderControl } from "./composite.js";
import { editMapPass, type EditDeps } from "./editPass.js";
import { mapSvgPath } from "./mapSources.js";
import { renderLandMask } from "./masks.js";
import type { MapProfile } from "./mapProfile.js";
import { toWebp } from "./postprocess.js";

/**
 * Run the map-background pipeline. Structure comes from the vector board SVG: a domain-warped
 * land mask is rendered as a flat green/blue control, then a multi-image edit model redraws
 * that control's land/sea layout in the style of a reference image — one cohesive antique map
 * with a natural drawn coastline. The output keeps the board's proportions so it aligns with
 * the UI. Every intermediate is written next to the final webp for inspection.
 */
export async function runMapPipeline(
  deps: EditDeps,
  args: { mapId: string; profile: MapProfile; outDir: string }
): Promise<{ outDir: string; webpPath: string }> {
  const { mapId, profile, outDir } = args;
  const { base } = profile;

  const map = getMap(mapId); // throws on unknown map id
  const svgMarkup = readFileSync(mapSvgPath(mapId), "utf8");

  // Keep the profile's target width; derive the height from the board viewBox so the
  // background lines up with the UI and the tiles are never distorted.
  const width = base.outputSize.width;
  const height = outputHeightForViewBox(svgMarkup, width);

  mkdirSync(outDir, { recursive: true });

  const landMask = await renderLandMask({
    svgMarkup,
    map,
    width,
    height,
    organicSigma: base.organicSigma,
    coastWarp: base.coastWarp
  });
  writeFileSync(join(outDir, "landMask.png"), landMask);

  const control = await renderControl({
    landMask,
    landColor: base.landColor,
    seaColor: base.seaColor,
    width,
    height
  });
  writeFileSync(join(outDir, "control.png"), control);

  // Conform the style reference to the board aspect (cover-crop) so the edit model emits the
  // control's proportions, not the style image's — keeps land/sea aligned with the tiles.
  const styleImage = await sharp(
    readFileSync(fileURLToPath(new URL(`../${profile.edit.styleRef}`, import.meta.url)))
  )
    .resize(width, height, { fit: "cover" })
    .jpeg()
    .toBuffer();

  const edited = await editMapPass(deps, {
    controlImage: control,
    styleImage,
    model: profile.edit.model,
    prompt: profile.edit.prompt,
    resolution: profile.edit.resolution,
    seed: profile.edit.seed
  });
  writeFileSync(join(outDir, "edited.png"), edited);

  const webp = await toWebp(edited, { width, height, quality: profile.webpQuality });
  const webpPath = join(outDir, "background.webp");
  writeFileSync(webpPath, webp);

  return { outDir, webpPath };
}

/** Height (px) for a target width that preserves the board SVG's viewBox aspect, so the
 *  rendered background lines up with the board in the UI and the tiles are never distorted. */
export function outputHeightForViewBox(svgMarkup: string, width: number): number {
  const vb = svgMarkup.match(/viewBox="([\d.\s-]+)"/i)?.[1];
  if (!vb) {
    throw new Error("outputHeightForViewBox: SVG has no viewBox");
  }
  const nums = vb.trim().split(/\s+/).map(Number);
  const vbWidth = nums[2];
  const vbHeight = nums[3];
  if (!vbWidth || !vbHeight) {
    throw new Error(`outputHeightForViewBox: bad viewBox "${vb}"`);
  }
  return Math.round((width * vbHeight) / vbWidth);
}
