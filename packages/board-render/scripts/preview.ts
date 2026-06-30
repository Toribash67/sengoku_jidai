import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { compileHexMap, FIXTURE_HEX_MAP } from "@sengoku-jidai/engine";
import { assembleBoardSvg, buildScene } from "../src/index.js";

const here = dirname(fileURLToPath(import.meta.url));
const svg = assembleBoardSvg(buildScene(compileHexMap(FIXTURE_HEX_MAP)));
// Force the hex-grid layer visible in the preview so the fusion is inspectable.
const preview = svg.replace('class="hex-grid" style="display:none"', 'class="hex-grid"');
const out = resolve(here, "preview.svg");
writeFileSync(out, preview);
console.log("wrote", out);
