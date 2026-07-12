import { readFileSync, writeFileSync } from "node:fs";
import { compileHexMap } from "@sengoku-jidai/engine";
import { assembleBoardSvg, buildScene, injectTerrainBackground } from "../src/index.js";

interface Args {
  map?: string;
  terrainUrl?: string;
  out?: string;
  base: string;
}

function parseArgs(argv: string[]): Args {
  const args: Args = { base: "http://localhost:18081" };
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    if (flag === "--map") args.map = argv[++i];
    else if (flag === "--terrain-url") args.terrainUrl = argv[++i];
    else if (flag === "--out") args.out = argv[++i];
    else if (flag === "--base") args.base = argv[++i];
  }
  return args;
}

/** A terrain webp reference — either an http(s) URL to fetch or a local file path — as a data URI. */
async function loadTerrainDataUri(ref: string): Promise<string> {
  const bytes = /^https?:\/\//.test(ref)
    ? await fetch(ref).then((res) => {
        if (!res.ok) throw new Error(`terrain fetch ${ref} -> ${res.status}`);
        return res.arrayBuffer().then((b) => Buffer.from(b));
      })
    : readFileSync(ref);
  return `data:image/webp;base64,${bytes.toString("base64")}`;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (!args.map || !args.out) {
    console.error(
      "usage: tsx scripts/terrain-shot.ts --map <id> [--terrain-url <url|path>] --out <file.html> [--base <url>]"
    );
    process.exit(1);
  }
  const res = await fetch(`${args.base}/api/maps/${encodeURIComponent(args.map)}`);
  if (!res.ok) {
    console.error(`map fetch ${args.map} -> ${res.status}`);
    process.exit(1);
  }
  const detail = (await res.json()) as { source: Parameters<typeof compileHexMap>[0] };
  const svg = assembleBoardSvg(buildScene(compileHexMap(detail.source)));
  const url = args.terrainUrl ? await loadTerrainDataUri(args.terrainUrl) : null;
  const composited = injectTerrainBackground(svg, url);
  const html = `<!doctype html><html><body style="margin:0">${composited}</body></html>`;
  writeFileSync(args.out, html);
  console.log("wrote", args.out);
  console.log(
    "render to PNG with:",
    `LD_LIBRARY_PATH=$HOME/.local/chromium-deps/lib node ~/.local/bin/svgshot.mjs ${args.out} ${args.out.replace(/\.html$/, ".png")}`
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
