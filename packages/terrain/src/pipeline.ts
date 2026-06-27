import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { getMap } from "@sengoku-jidai/engine";
import { renderControlImage, tileColorMap } from "./controlImage.js";
import { mapSvgPath } from "./mapSources.js";
import { loadStyleProfile, type StyleProfile } from "./styleProfile.js";

/** Repo root, relative to packages/terrain/src/. */
const repoRoot = fileURLToPath(new URL("../../../", import.meta.url));

/** Output directory for a map's terrain artifacts (control.png, generated.png). */
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
 * Render the land/sea control image for a map at the profile's output size. Needs only the
 * engine and the board SVG — no API key and no style reference — so it can be previewed
 * standalone before (or without) a full generation run.
 */
export async function renderMapControl(mapId: string, profile: StyleProfile): Promise<Buffer> {
  const map = getMap(mapId); // throws on unknown map id
  const svgMarkup = readFileSync(mapSvgPath(mapId), "utf8");
  return renderControlImage({
    svgMarkup,
    colors: tileColorMap(map),
    width: profile.outputSize.width,
    height: profile.outputSize.height
  });
}
