import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { getMap } from "@sengoku-jidai/engine";
import { renderBaseImage, tileColorMap } from "./controlImage.js";
import { mapSvgPath } from "./mapSources.js";
import { loadStyleProfile, type StyleProfile } from "./styleProfile.js";

/** Repo root, relative to packages/terrain/src/. */
const repoRoot = fileURLToPath(new URL("../../../", import.meta.url));

/** Output directory for a map's terrain artifacts (base.png, generated.png). */
export function artifactDir(mapId: string): string {
  return `${repoRoot}terrain/${mapId}`;
}

/** Committed web asset path (the bundled webp) for a map. */
export function webAssetPath(mapId: string): string {
  return `${repoRoot}packages/web/src/assets/terrain/${mapId}.webp`;
}

/** Load the committed, shared style profile (one style for all maps). */
export function loadDefaultProfile(): StyleProfile {
  return loadStyleProfile(fileURLToPath(new URL("../profiles/antique.json", import.meta.url)));
}

/**
 * Render the colour base (land/sea regions + organic coastlines) for a map at the profile's
 * output size. Needs only the engine and the board SVG — no API key — so it can be previewed
 * standalone before a full generation run.
 */
export async function renderMapBase(
  mapId: string,
  opts: Pick<StyleProfile, "landColor" | "seaColor" | "blurSigma" | "outputSize">
): Promise<Buffer> {
  const map = getMap(mapId); // throws on unknown map id
  const svgMarkup = readFileSync(mapSvgPath(mapId), "utf8");
  return renderBaseImage({
    svgMarkup,
    colors: tileColorMap(map, opts.landColor, opts.seaColor),
    backgroundColor: opts.landColor,
    width: opts.outputSize.width,
    height: opts.outputSize.height,
    blurSigma: opts.blurSigma
  });
}

/** Output directory for a map's matrix candidates (per-candidate PNGs + contact-sheet.png). */
export function candidatesDir(mapId: string): string {
  return `${artifactDir(mapId)}/candidates`;
}
