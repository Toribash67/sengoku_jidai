#!/usr/bin/env node
import { main } from "./main.js";

// A reader that stops early (e.g. `| head`) closes the pipe; the command itself already ran, so
// drop further output instead of crashing with EPIPE.
process.stdout.on("error", (e: NodeJS.ErrnoException) => {
  if (e.code !== "EPIPE") throw e;
});

const code = await main(process.argv.slice(2), {
  out: (line) => process.stdout.write(`${line}\n`),
  err: (line) => process.stderr.write(`${line}\n`)
});
process.exitCode = code;
