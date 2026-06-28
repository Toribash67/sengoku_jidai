import { fal } from "@fal-ai/client";
import { mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { renderMapBase, candidatesDir } from "./pipeline.js";
import { loadMatrixConfig } from "./matrixProfile.js";
import { generateCandidate } from "./matrixBackend.js";
import { buildContactSheet } from "./contactSheet.js";

async function main(): Promise<void> {
  const mapId = process.argv[2];
  if (!mapId) {
    throw new Error("usage: pnpm --filter @sengoku-jidai/terrain gen:matrix <mapId>");
  }
  const key = process.env.FAL_KEY;
  if (!key) {
    throw new Error("FAL_KEY is not set (see .env.example)");
  }

  const config = loadMatrixConfig(
    fileURLToPath(new URL("../profiles/matrix.json", import.meta.url))
  );
  const outDir = candidatesDir(mapId);
  mkdirSync(outDir, { recursive: true });

  console.log(`[matrix] rendering colour base for "${mapId}"…`);
  const base = await renderMapBase(mapId, config.base);
  writeFileSync(`${outDir}/_base.png`, base);

  fal.config({ credentials: key });
  const baseUrl = await fal.storage.upload(new Blob([new Uint8Array(base)], { type: "image/png" }));

  const cells: { label: string; image: Buffer | null }[] = [];
  for (const candidate of config.candidates) {
    try {
      console.log(`[matrix] ${candidate.label} — ${candidate.method} via ${candidate.model}…`);
      const png = await generateCandidate({ fal, fetch }, { candidate, baseUrl });
      writeFileSync(`${outDir}/${candidate.label}.png`, png);
      cells.push({ label: candidate.label, image: png });
    } catch (err) {
      console.error(
        `[matrix] ${candidate.label} FAILED: ${err instanceof Error ? err.message : String(err)}`
      );
      cells.push({ label: `${candidate.label} (failed)`, image: null });
    }
  }

  const cellWidth = 320;
  const cellHeight = Math.round(
    cellWidth * (config.base.outputSize.height / config.base.outputSize.width)
  );
  const sheet = await buildContactSheet(cells, {
    columns: config.columns,
    cellWidth,
    cellHeight,
    captionHeight: 28
  });
  writeFileSync(`${outDir}/contact-sheet.png`, sheet);

  const ok = cells.filter((c) => c.image).length;
  console.log(
    `[matrix] done: ${ok}/${cells.length} candidates ok\n  sheet: ${outDir}/contact-sheet.png`
  );
}

main().catch((err) => {
  console.error(`[matrix] ${err instanceof Error ? err.message : String(err)}`);
  process.exitCode = 1;
});
