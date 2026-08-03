import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import type { MapDefinition } from "@sengoku-jidai/engine";
import { getMap } from "@sengoku-jidai/engine";
import { renderControl } from "./composite.js";
import { editMapPass, type EditDeps } from "./editPass.js";
import { fortMarkerOverlay } from "./fortMarkerOverlay.js";
import { fortMarkers, type FortScene } from "./fortMarkers.js";
import { mapStructureScene } from "./mapSources.js";
import { renderLandMask } from "./masks.js";
import type { MapProfile } from "./mapProfile.js";
import { toWebp } from "./postprocess.js";
import { planGptImageAspect } from "./gptImageAspect.js";

/**
 * Pad a width×height control PNG into the fixed gpt-image size, run one edit pass, and crop
 * the padding back off, returning a content-sized (`plan.contentW`×`plan.contentH`) PNG —
 * callers resize that to the final width×height (`fortMarkerOverlay` and `toWebp` both do this).
 * Shared by the base terrain pass and the fort pass so both use identical letterbox/crop
 * geometry. `styleImage` is the optional aesthetic reference (null for the fort pass, which
 * restyles from the already-styled base image via the prompt).
 */
async function padEditCrop(
  deps: EditDeps,
  args: {
    control: Buffer;
    styleImage: Buffer | null;
    width: number;
    height: number;
    prompt: string;
    edit: MapProfile["edit"];
    seaColor: string;
  }
): Promise<Buffer> {
  const { control, styleImage, width, height, prompt, edit, seaColor } = args;
  const plan = planGptImageAspect(width, height);
  // Letterbox the control into the fixed gpt-image size; margins are sea (discarded after crop).
  const paddedControl = await sharp(control)
    .resize(plan.contentW, plan.contentH, { fit: "fill" })
    .extend({
      top: plan.padTop,
      bottom: plan.padBottom,
      left: plan.padLeft,
      right: plan.padRight,
      background: seaColor
    })
    .png()
    .toBuffer();
  const edited = await editMapPass(deps, {
    controlImage: paddedControl,
    styleImage,
    model: edit.model,
    prompt,
    imageSize: plan.imageSize,
    quality: edit.quality,
    inputFidelity: edit.inputFidelity
  });
  // Crop the padding back off (model returns targetW×targetH), then size to the board.
  return sharp(edited)
    .resize(plan.targetW, plan.targetH, { fit: "fill" })
    .extract({ left: plan.padLeft, top: plan.padTop, width: plan.contentW, height: plan.contentH })
    .png()
    .toBuffer();
}

/**
 * Filesystem-free pipeline core. Structure comes from `svgMarkup` (any board SVG with
 * `.tile` paths + a viewBox); a domain-warped land mask becomes a flat control, which a
 * multi-image edit model redraws in the style reference's hand-drawn look. Returns the
 * final webp bytes. The only file it reads is the packaged style reference. When `scene` is
 * supplied and has at least one fort tile, a second edit pass draws a castle at each fort.
 */
export async function generateTerrainWebp(
  deps: EditDeps,
  args: { svgMarkup: string; map: MapDefinition; profile: MapProfile; scene?: FortScene }
): Promise<Buffer> {
  const { svgMarkup, map, profile, scene } = args;
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

  let styleImage: Buffer | null = null;
  if (profile.edit.styleRef) {
    const plan = planGptImageAspect(width, height);
    styleImage = await sharp(
      readFileSync(fileURLToPath(new URL(`../${profile.edit.styleRef}`, import.meta.url)))
    )
      .resize(plan.contentW, plan.contentH, { fit: "cover" })
      .jpeg()
      .toBuffer();
  }

  let terrain = await padEditCrop(deps, {
    control,
    styleImage,
    width,
    height,
    prompt: profile.edit.prompt,
    edit: profile.edit,
    seaColor: base.seaColor
  });

  // Fort pass: draw a castle at each fort tile. Only when the caller supplied the scene and it
  // has at least one fort — otherwise this is byte-for-byte the pre-fort behaviour.
  const markers = scene ? fortMarkers(scene, width, profile.fortPass.markerRadiusFactor) : [];
  if (markers.length > 0) {
    const overlaid = await fortMarkerOverlay({
      base: terrain,
      width,
      height,
      markers,
      color: profile.fortPass.markerColor
    });
    terrain = await padEditCrop(deps, {
      control: overlaid,
      styleImage: null,
      width,
      height,
      prompt: profile.fortPass.prompt,
      edit: profile.edit,
      seaColor: base.seaColor
    });
  }

  return toWebp(terrain, { width, height, quality: profile.webpQuality });
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
  const { svgMarkup, scene } = mapStructureScene(mapId); // live geometry + fort positions
  mkdirSync(outDir, { recursive: true });
  const webp = await generateTerrainWebp(deps, { svgMarkup, map, profile, scene });
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
