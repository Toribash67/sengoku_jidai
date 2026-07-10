import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import type { MapDefinition } from "@sengoku-jidai/engine";
import { getMap } from "@sengoku-jidai/engine";
import { renderControl } from "./composite.js";
import { editMapPass, type EditDeps } from "./editPass.js";
import { mapSvgPath } from "./mapSources.js";
import { renderLandMask } from "./masks.js";
import type { MapProfile } from "./mapProfile.js";
import { toWebp } from "./postprocess.js";

/**
 * Filesystem-free pipeline core. Structure comes from `svgMarkup` (any board SVG with
 * `.tile` paths + a viewBox); a domain-warped land mask becomes a flat control, which a
 * multi-image edit model redraws in the style reference's hand-drawn look. Returns the
 * final webp bytes. The only file it reads is the packaged style reference.
 */
export async function generateTerrainWebp(
  deps: EditDeps,
  args: { svgMarkup: string; map: MapDefinition; profile: MapProfile }
): Promise<Buffer> {
  const { svgMarkup, map, profile } = args;
  const { base } = profile;
  const width = base.outputSize.width;
  const height = outputHeightForViewBox(svgMarkup, width);

  const landMask = await renderLandMask({
    svgMarkup,
    map,
    width,
    height,
    organicSigma: base.organicSigma,
    background: base.background,
    coastWarp: base.coastWarp
  });
  const control = await renderControl({
    landMask,
    landColor: base.landColor,
    seaColor: base.seaColor,
    width,
    height
  });
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
  return toWebp(edited, { width, height, quality: profile.webpQuality });
}

/**
 * Dev CLI path: resolve a committed board SVG + registered map by id, run the core, and
 * write every intermediate next to the final webp for inspection.
 */
export async function runMapPipeline(
  deps: EditDeps,
  args: { mapId: string; profile: MapProfile; outDir: string }
): Promise<{ outDir: string; webpPath: string }> {
  const { mapId, profile, outDir } = args;
  const map = getMap(mapId); // throws on unknown map id
  const svgMarkup = readFileSync(mapSvgPath(mapId), "utf8");
  mkdirSync(outDir, { recursive: true });
  const webp = await generateTerrainWebp(deps, { svgMarkup, map, profile });
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
