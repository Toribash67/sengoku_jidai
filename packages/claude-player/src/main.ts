import { parseArgs } from "node:util";
import { EXIT, runJoin, runPlay, runSay, runStatus, runWait, type Ctx } from "./commands.js";
import { defaultSessionPath } from "./session.js";

export const USAGE = `Usage: sengoku <command> [--session <path>]
  join <invite-link> [--name Claude]   claim the seat and show the board
  status                               board + numbered orders
  play <n|name> [--from A:N,...] [--place A:N,...] [--bonus K]
                                       combat orders also have names: roll, ambush, reroll:<card>, accept
  wait [--timeout 540]                 block until it is your turn (exit 3: still waiting)
  say "<text>"                         post to the game chat
Exit codes: 0 ok/your turn · 1 local error · 2 game over · 3 still waiting · 4 rejected/stale · 5 bad token · 6 opponent chatted (wait only)`;

export async function main(
  argv: string[],
  io: Omit<Ctx, "sessionPath">,
  env: NodeJS.ProcessEnv = process.env
): Promise<number> {
  let parsed;
  try {
    parsed = parseArgs({
      args: argv,
      allowPositionals: true,
      options: {
        session: { type: "string" },
        name: { type: "string" },
        from: { type: "string" },
        place: { type: "string" },
        bonus: { type: "string" },
        timeout: { type: "string" }
      }
    });
  } catch (e) {
    io.err(`${(e as Error).message}\n${USAGE}`);
    return EXIT.local;
  }
  const { values, positionals } = parsed;
  const ctx: Ctx = { ...io, sessionPath: values.session ?? defaultSessionPath(env) };
  const [command, arg] = positionals;

  switch (command) {
    case "join":
      if (!arg) break;
      return runJoin(ctx, arg, values.name ?? "Claude");
    case "status":
      return runStatus(ctx);
    case "play": {
      const ref = arg !== undefined && /^\d+$/.test(arg) ? Number(arg) : arg;
      const bonus = values.bonus === undefined ? undefined : Number(values.bonus);
      if (!ref || (bonus !== undefined && !Number.isInteger(bonus))) {
        io.err("play needs an order number or name (and an integer --bonus if given).");
        return EXIT.local;
      }
      return runPlay(ctx, ref, { from: values.from, place: values.place, bonus });
    }
    case "wait": {
      const timeoutSec = Number(values.timeout ?? 540);
      if (!Number.isFinite(timeoutSec) || timeoutSec < 0) {
        io.err("--timeout must be a number of seconds.");
        return EXIT.local;
      }
      // Stay under Claude Code's 10-minute Bash limit.
      return runWait(ctx, { timeoutSec: Math.min(timeoutSec, 590), intervalMs: 2000 });
    }
    case "say":
      if (!arg) break;
      return runSay(ctx, positionals.slice(1).join(" "));
  }
  io.err(USAGE);
  return EXIT.local;
}
