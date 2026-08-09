import { describe, expect, it } from "vitest";
import { RandomBot, createAiRng } from "@sengoku-jidai/ai";
import { buildApp } from "../src/app.js";
import type { ServerConfig } from "../src/config.js";

function testConfig(): ServerConfig {
  return {
    nodeEnv: "test",
    host: "127.0.0.1",
    port: 0,
    webOrigin: "http://localhost:18081",
    sqlitePath: ":memory:",
    sessionSecret: "test-session-secret",
    logLevel: "silent"
  };
}

/** Yield to the event loop once — long enough for the server's `setImmediate`-scheduled
 *  `driveAiTurns` fire-and-forget call to run to completion (it's synchronous once started). */
const tick = () => new Promise<void>((resolve) => setImmediate(resolve));

describe("AI game (end-to-end auto-drive)", () => {
  it("plays a full human-vs-AI game to completion via the HTTP surface", async () => {
    // Inject a fast, deterministic bot for the AI seat so the whole game resolves in
    // milliseconds — no ISMCTS search needed to prove the HTTP wiring works.
    const app = buildApp(testConfig(), { aiBotFor: () => new RandomBot(createAiRng(1)) });

    const created = await app.inject({
      method: "POST",
      url: "/api/games",
      payload: { mode: "hotseat", opponent: "ai" }
    });
    expect(created.statusCode).toBe(200);
    const createdBody = created.json();
    const gameId: string = createdBody.gameId;
    // Creator defaults to red (no `side` in the request); black is the AI seat.
    const redToken: string = createdBody.seats.find(
      (seat: { seat: string }) => seat.seat === "red"
    ).token;

    // The AI may hold initiative and move first — let that opening burst run before polling.
    await tick();

    const getView = async () => {
      const res = await app.inject({
        method: "GET",
        url: `/api/games/${gameId}`,
        headers: { authorization: `Bearer ${redToken}` }
      });
      expect(res.statusCode).toBe(200);
      return res.json();
    };

    let clientCommandSeq = 0;
    // Submit a red command, retrying once against a fresh revision if the AI driver managed
    // to advance the game between our GET and this POST (shouldn't happen in-process, but the
    // server's stale-revision contract makes this cheap to honor defensively).
    const submitRedCommand = async (
      command: Record<string, unknown>,
      startRevision: number
    ): Promise<void> => {
      let baseRevision = startRevision;
      for (let attempt = 0; attempt < 5; attempt++) {
        clientCommandSeq += 1;
        const res = await app.inject({
          method: "POST",
          url: `/api/games/${gameId}/commands`,
          headers: { authorization: `Bearer ${redToken}` },
          payload: {
            baseRevision,
            clientCommandId: `human-${clientCommandSeq}`,
            command
          }
        });
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const body: any = res.json();
        if (res.statusCode === 200) {
          humanCommands += 1;
          return;
        }
        if (res.statusCode === 409 && body?.error?.code === "staleRevision") {
          baseRevision = body.revision;
          continue;
        }
        throw new Error(
          `Unexpected response submitting ${JSON.stringify(command)}: ${res.statusCode} ${JSON.stringify(body)}`
        );
      }
      throw new Error(`submitRedCommand: exceeded retry attempts for ${JSON.stringify(command)}`);
    };

    let humanCommands = 0;
    let finalStatus = "";
    let finalRevision = createdBody.revision as number;

    // Human policy: pass on every deploy turn (always legal when it's red's deploy turn), and
    // otherwise answer any combat roll/resolve step where red is the responsible seat — e.g.
    // when the AI (black) advances into a red-held area, red is the DEFENDER and must roll
    // (see engine/src/actions.ts `resolveMoveIn` — `responsibleSeat: rt.owner`). Passing alone
    // cannot progress past that; the view's `legal` flags tell us exactly what red may do next.
    const MAX_ITERATIONS = 300;
    for (let i = 0; i < MAX_ITERATIONS; i++) {
      const body = await getView();
      finalRevision = body.revision;
      finalStatus = body.view.status;
      if (finalStatus === "complete") break;

      let command: Record<string, unknown> | null = null;
      if (body.view.legal.canRollCombat) {
        command = { type: "combatRoll", pendingId: body.view.pendingCombat.id };
      } else if (body.view.legal.canResolveCombat) {
        command = { type: "combatResolve", pendingId: body.view.pendingCombat.id };
      } else if (body.view.legal.canPass) {
        command = { type: "pass" };
      }

      if (command) {
        await submitRedCommand(command, body.revision);
      }

      // Let the fire-and-forget AI driver run (whether it was just scheduled by our command,
      // or is still working through a multi-step turn from earlier).
      await tick();
    }

    expect(finalStatus).toBe("complete");

    // The AI moved: every accepted command (human or AI) bumps revision by exactly 1, so a
    // final revision exceeding the human's own command count proves the AI contributed moves.
    expect(finalRevision).toBeGreaterThan(humanCommands);

    const eventsRes = await app.inject({
      method: "GET",
      url: `/api/games/${gameId}/events`,
      headers: { authorization: `Bearer ${redToken}` }
    });
    expect(eventsRes.statusCode).toBe(200);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const events: any[] = eventsRes.json().events;
    expect(events.some((e) => e.seat === "black")).toBe(true);

    await app.close();
  });
});
