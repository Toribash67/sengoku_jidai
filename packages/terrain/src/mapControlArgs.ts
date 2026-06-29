import { parseArgs } from "node:util";

const USAGE =
  "usage: pnpm --filter @sengoku-jidai/terrain gen:map-control <mapId> [--amplitude <px>]";

/**
 * Parse the gen:map-control CLI args. `argv` is `process.argv.slice(2)`. Returns the
 * required mapId and an optional coastWarp amplitude override (pixels, >= 0; 0 disables
 * the warp). Throws with a clear message on a missing mapId or an invalid amplitude.
 * Note: a dash-leading value must use the `--amplitude=-1` form — `node:util` parseArgs
 * rejects the space form `--amplitude -1` as ambiguous before our validation runs.
 */
export function parseMapControlArgs(argv: string[]): { mapId: string; amplitude?: number } {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: { amplitude: { type: "string" } }
  });

  const mapId = positionals[0];
  if (!mapId) {
    throw new Error(USAGE);
  }

  if (values.amplitude === undefined) {
    return { mapId };
  }

  const amplitude = Number(values.amplitude);
  if (!Number.isFinite(amplitude) || amplitude < 0) {
    throw new Error(`--amplitude must be a number >= 0 (got "${values.amplitude}")`);
  }
  return { mapId, amplitude };
}
