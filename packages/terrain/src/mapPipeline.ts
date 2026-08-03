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
import { fortFillMask, fortMaskImage } from "./fortMaskImage.js";
import { inpaintPass } from "./inpaintPass.js";
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
    mask?: Buffer | null;
    width: number;
    height: number;
    prompt: string;
    edit: MapProfile["edit"];
    seaColor: string;
  }
): Promise<Buffer> {
  const { control, styleImage, mask, width, height, prompt, edit, seaColor } = args;
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
  // Letterbox the mask through the SAME geometry so it aligns with the padded control; the added
  // margins are opaque (kept), so gpt-image never edits the letterbox border.
  const paddedMask = mask
    ? await sharp(mask)
        .resize(plan.contentW, plan.contentH, { fit: "fill" })
        .extend({
          top: plan.padTop,
          bottom: plan.padBottom,
          left: plan.padLeft,
          right: plan.padRight,
          background: { r: 0, g: 0, b: 0, alpha: 1 }
        })
        .png()
        .toBuffer()
    : null;
  const edited = await editMapPass(deps, {
    controlImage: paddedControl,
    styleImage,
    maskImage: paddedMask,
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
 * Draw a castle at each fort tile on an already-styled terrain image, using a masked edit pass.
 * A bright marker is overlaid at each fort (where/what to draw) AND a mask restricts the edit to
 * the fort tile regions (transparent discs = editable), so the rest of the terrain is protected.
 * Returns a width×height PNG. If the scene has no fort tiles, the base is returned unchanged
 * (resized to width×height). Exported so the base pipeline and the "add forts to an existing
 * terrain" path share one implementation.
 *
 * `maskInvert` flips the mask polarity; it exists because fal's exact mask convention is verified
 * empirically rather than from a published schema. Default `false` = the gpt-image convention
 * (transparent pixels are the editable region).
 */
export async function applyFortPass(
  deps: EditDeps,
  args: {
    base: Buffer;
    width: number;
    height: number;
    profile: MapProfile;
    scene: FortScene;
    maskInvert?: boolean;
  }
): Promise<Buffer> {
  const { base, width, height, profile, scene, maskInvert = false } = args;
  const { fortPass, edit } = profile;
  const markers = fortMarkers(scene, width, fortPass.markerRadiusFactor);
  if (markers.length === 0) {
    return sharp(base).resize(width, height, { fit: "fill" }).png().toBuffer();
  }
  const overlaid = await fortMarkerOverlay({
    base,
    width,
    height,
    markers,
    color: fortPass.markerColor
  });
  const maskDiscs = fortMarkers(scene, width, fortPass.maskRadiusFactor);
  const mask = await fortMaskImage({ width, height, discs: maskDiscs, invert: maskInvert });
  const edited = await padEditCrop(deps, {
    control: overlaid,
    styleImage: null,
    mask,
    width,
    height,
    prompt: fortPass.prompt,
    edit,
    seaColor: profile.base.seaColor
  });
  return sharp(edited).resize(width, height, { fit: "fill" }).png().toBuffer();
}

/**
 * Draw a castle at each fort tile using a TRUE-inpainting model (e.g. `fal-ai/flux-pro/v1/fill`)
 * instead of gpt-image's soft mask. A white-disc mask (`fortFillMask`) marks each fort tile as the
 * inpaint region; the model regenerates only those discs and preserves every other pixel exactly,
 * so a castle cannot leak onto non-fort tiles. No magenta marker is needed — the mask defines the
 * region and the prompt defines the content. Returns a width×height PNG. No fort tiles → the base
 * is returned unchanged. The mask disc uses `fortPass.maskRadiusFactor` (tile-sized, room for the
 * keep).
 *
 * Each fort is inpainted in its OWN pass (single-disc mask, chained onto the previous result): a
 * single call over a multi-disc mask with a singular prompt unreliably fills only one disc with a
 * castle and the others with plain terrain. Per-disc guarantees one castle per fort. Cost is one
 * model call per fort tile.
 */
export async function applyInpaintFortPass(
  deps: EditDeps,
  args: {
    base: Buffer;
    width: number;
    height: number;
    profile: MapProfile;
    scene: FortScene;
    model: string;
    prompt: string;
  }
): Promise<Buffer> {
  const { base, width, height, profile, scene, model, prompt } = args;
  const discs = fortMarkers(scene, width, profile.fortPass.maskRadiusFactor);
  let image = await sharp(base).resize(width, height, { fit: "fill" }).png().toBuffer();
  for (const disc of discs) {
    const mask = await fortFillMask({ width, height, discs: [disc] });
    const edited = await inpaintPass(deps, { image, mask, model, prompt });
    image = await sharp(edited).resize(width, height, { fit: "fill" }).png().toBuffer();
  }
  return image;
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
  // has at least one fort — otherwise this is byte-for-byte the pre-fort behaviour. "inpaint"
  // (default) uses a true hard-mask model that preserves every non-fort pixel; "marker" uses the
  // base gpt-image model with a magenta marker overlay.
  const hasForts = scene
    ? fortMarkers(scene, width, profile.fortPass.markerRadiusFactor).length > 0
    : false;
  if (scene && hasForts) {
    terrain =
      profile.fortPass.method === "inpaint"
        ? await applyInpaintFortPass(deps, {
            base: terrain,
            width,
            height,
            profile,
            scene,
            model: profile.fortPass.model,
            prompt: profile.fortPass.inpaintPrompt
          })
        : await applyFortPass(deps, { base: terrain, width, height, profile, scene });
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
