import {
  claimGameRequestSchema,
  createGameRequestSchema,
  eventQuerySchema,
  gameParamsSchema,
  hexMapSourceSchema,
  isTerrainStyleId,
  mapParamsSchema,
  MAX_TERRAINS_PER_MAP,
  submitCommandRequestSchema
} from "@sengoku-jidai/shared";
import type { SeatId } from "@sengoku-jidai/shared";
import { z } from "zod";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { runIsmctsInWorker } from "@sengoku-jidai/ai";
import type { Command, GameState } from "@sengoku-jidai/engine";
import { bearerToken, hashToken } from "../sessions/tokens.js";
import type { GameRepository, SessionRecord } from "../persistence/repository.js";
import type { MapLibrary, MapLibraryError } from "../maps/library.js";
import type { TerrainStore } from "../maps/terrainStore.js";
import type { TerrainService } from "../maps/terrainService.js";
import { driveAiTurns } from "../ai/aiDriver.js";
import { withRetry } from "../ai/withRetry.js";

const MAP_ERROR_STATUS: Record<MapLibraryError["code"], number> = {
  invalidMap: 400,
  builtinMap: 403,
  mapNotFound: 404,
  mapInUse: 409
};

export function registerApiRoutes(
  app: FastifyInstance,
  repository: GameRepository,
  mapLibrary: MapLibrary,
  terrainStore: TerrainStore,
  terrainService: TerrainService,
  adminPassword?: string,
  aiPickCommandFor: (gameId: string) => (seat: SeatId, state: GameState) => Promise<Command> = (
      gameId
    ) =>
    (seat, state) =>
      withRetry(() => runIsmctsInWorker(state, seat, { deadlineMs: 1500, seed: gameId }), {
        attempts: 3,
        delayMs: 50
      })
): void {
  const driveAiSoon = (gameId: string) =>
    setImmediate(() => {
      driveAiTurns(
        {
          controllersOf: (id) => repository.controllersOf(id),
          currentState: (id) => repository.currentState(id),
          applyAiCommand: (id, seat, cmd) => repository.applyAiCommand(id, seat, cmd)
        },
        gameId,
        aiPickCommandFor(gameId)
      ).catch((err) => app.log.error({ err, gameId }, "AI driver failed"));
    });

  app.get("/healthz", async () => ({ ok: true }));

  app.get("/api/maps", async () => ({ maps: mapLibrary.list() }));

  app.get("/api/maps/:mapId", async (request, reply) => {
    const params = mapParamsSchema.safeParse(request.params);
    if (!params.success) {
      return sendError(reply, 400, "invalidRequest", "Map id is invalid.");
    }
    const map = mapLibrary.get(params.data.mapId, (id) => terrainStore.list(id));
    if (!map) {
      return sendError(reply, 404, "mapNotFound", "Map was not found.");
    }
    return reply.send(map);
  });

  app.post("/api/maps", async (request, reply) => {
    const body = hexMapSourceSchema.safeParse(request.body ?? {});
    if (!body.success) {
      return sendError(reply, 400, "invalidMap", "Map source is malformed.");
    }
    const result = mapLibrary.create(body.data);
    if (!result.ok) {
      return sendError(
        reply,
        MAP_ERROR_STATUS[result.error.code],
        result.error.code,
        result.error.message
      );
    }
    return reply.status(201).send(result.value);
  });

  app.put("/api/maps/:mapId", async (request, reply) => {
    const params = mapParamsSchema.safeParse(request.params);
    const body = hexMapSourceSchema.safeParse(request.body ?? {});
    if (!params.success) {
      return sendError(reply, 400, "invalidRequest", "Map id is invalid.");
    }
    if (!body.success) {
      return sendError(reply, 400, "invalidMap", "Map source is malformed.");
    }
    const result = mapLibrary.update(params.data.mapId, body.data);
    if (!result.ok) {
      return sendError(
        reply,
        MAP_ERROR_STATUS[result.error.code],
        result.error.code,
        result.error.message
      );
    }
    return reply.send(result.value);
  });

  app.delete("/api/maps/:mapId", async (request, reply) => {
    const params = mapParamsSchema.safeParse(request.params);
    if (!params.success) {
      return sendError(reply, 400, "invalidRequest", "Map id is invalid.");
    }
    const result = mapLibrary.delete(params.data.mapId);
    if (!result.ok) {
      return sendError(
        reply,
        MAP_ERROR_STATUS[result.error.code],
        result.error.code,
        result.error.message
      );
    }
    return reply.status(204).send();
  });

  // --- Many-terrains endpoints. Each terrain is addressed by its surrogate id. ---

  const terrainParamsSchema = z.object({
    mapId: z.string().min(1),
    terrainId: z.string().min(1)
  });

  app.post("/api/maps/:mapId/terrains", async (request, reply) => {
    const params = mapParamsSchema.safeParse(request.params);
    if (!params.success) {
      return sendError(reply, 400, "invalidRequest", "Map id is invalid.");
    }
    const body = z.object({ styleId: z.string().optional() }).safeParse(request.body ?? {});
    if (!body.success) {
      return sendError(reply, 400, "invalidRequest", "Request body is invalid.");
    }
    const styleId = body.data.styleId ?? "antique";
    if (!isTerrainStyleId(styleId)) {
      return sendError(reply, 400, "invalidStyle", "Unknown terrain style.");
    }
    if (!terrainService.available()) {
      return sendError(reply, 503, "terrainUnavailable", "Terrain generation is not configured.");
    }
    const detail = mapLibrary.get(params.data.mapId);
    if (!detail) {
      return sendError(reply, 404, "mapNotFound", "Map was not found.");
    }
    if (detail.builtin) {
      return sendError(reply, 403, "builtinMap", "Built-in maps cannot generate terrain.");
    }
    if (terrainService.isGenerating(params.data.mapId)) {
      return sendError(reply, 409, "terrainInProgress", "Terrain is already generating.");
    }
    if (terrainStore.countForMap(params.data.mapId) >= MAX_TERRAINS_PER_MAP) {
      return sendError(
        reply,
        422,
        "terrainCap",
        `A map may have at most ${MAX_TERRAINS_PER_MAP} terrains.`
      );
    }
    const id = terrainService.generate(params.data.mapId, styleId);
    return reply.status(202).send({ id });
  });

  app.patch("/api/maps/:mapId/terrains/:terrainId", async (request, reply) => {
    const params = terrainParamsSchema.safeParse(request.params);
    if (!params.success) {
      return sendError(reply, 400, "invalidRequest", "Invalid ids.");
    }
    const body = z.object({ name: z.string().trim().min(1).max(40) }).safeParse(request.body ?? {});
    if (!body.success) {
      return sendError(reply, 400, "invalidRequest", "Name must be 1–40 characters.");
    }
    if (!terrainStore.rename(params.data.terrainId, body.data.name)) {
      return sendError(reply, 404, "terrainNotFound", "Terrain was not found.");
    }
    return reply.status(200).send({ ok: true });
  });

  app.delete("/api/maps/:mapId/terrains/:terrainId", async (request, reply) => {
    const params = terrainParamsSchema.safeParse(request.params);
    if (!params.success) {
      return sendError(reply, 400, "invalidRequest", "Invalid ids.");
    }
    if (!terrainStore.remove(params.data.terrainId)) {
      return sendError(reply, 404, "terrainNotFound", "Terrain was not found.");
    }
    return reply.status(204).send();
  });

  app.get("/api/maps/:mapId/terrains/:terrainId.webp", async (request, reply) => {
    const params = terrainParamsSchema.safeParse(request.params);
    if (!params.success) {
      return sendError(reply, 400, "invalidRequest", "Invalid ids.");
    }
    const webp = terrainStore.webpById(params.data.terrainId);
    if (!webp) {
      return sendError(reply, 404, "terrainNotFound", "No terrain for this id.");
    }
    const updatedAt = terrainStore.updatedAtById(params.data.terrainId) ?? "";
    return reply
      .header("Content-Type", "image/webp")
      .header("Cache-Control", "public, max-age=60")
      .header("ETag", `"${params.data.terrainId}-${updatedAt}"`)
      .send(webp);
  });

  app.get("/api/maps/:mapId/terrains/:terrainId/candidates/:idx.webp", async (request, reply) => {
    const params = z
      .object({
        mapId: z.string().min(1),
        terrainId: z.string().min(1),
        idx: z.coerce.number().int().min(0).max(1)
      })
      .safeParse(request.params);
    if (!params.success) {
      return sendError(reply, 400, "invalidRequest", "Invalid ids.");
    }
    const terrain = terrainStore.get(params.data.terrainId);
    if (!terrain || terrain.status !== "choosing") {
      return sendError(reply, 404, "terrainNotFound", "No candidate for this id.");
    }
    const webp = terrainStore.candidateWebp(params.data.terrainId, params.data.idx);
    if (!webp) {
      return sendError(reply, 404, "terrainNotFound", "No candidate for this id.");
    }
    return reply
      .header("Content-Type", "image/webp")
      .header("Cache-Control", "public, max-age=60")
      .header("ETag", `"${params.data.terrainId}-${params.data.idx}-${terrain.updatedAt}"`)
      .send(webp);
  });

  app.post("/api/maps/:mapId/terrains/:terrainId/choose", async (request, reply) => {
    const params = terrainParamsSchema.safeParse(request.params);
    if (!params.success) {
      return sendError(reply, 400, "invalidRequest", "Invalid ids.");
    }
    const body = z.object({ index: z.number().int().min(0).max(1) }).safeParse(request.body ?? {});
    if (!body.success) {
      return sendError(reply, 400, "invalidRequest", "index must be 0 or 1.");
    }
    const terrain = terrainStore.get(params.data.terrainId);
    if (!terrain) {
      return sendError(reply, 404, "terrainNotFound", "Terrain was not found.");
    }
    if (terrain.status !== "choosing") {
      return sendError(reply, 409, "terrainNotChoosing", "This terrain is not awaiting a choice.");
    }
    if (terrainService.isGenerating(params.data.mapId)) {
      return sendError(reply, 409, "terrainInProgress", "Terrain is busy.");
    }
    terrainService.choose(params.data.mapId, params.data.terrainId, body.data.index);
    return reply.status(202).send({ id: params.data.terrainId });
  });

  app.post("/api/maps/:mapId/terrains/:terrainId/regenerate", async (request, reply) => {
    const params = terrainParamsSchema.safeParse(request.params);
    if (!params.success) {
      return sendError(reply, 400, "invalidRequest", "Invalid ids.");
    }
    if (!terrainService.available()) {
      return sendError(reply, 503, "terrainUnavailable", "Terrain generation is not configured.");
    }
    const terrain = terrainStore.get(params.data.terrainId);
    if (!terrain) {
      return sendError(reply, 404, "terrainNotFound", "Terrain was not found.");
    }
    if (terrain.status !== "choosing") {
      return sendError(reply, 409, "terrainNotChoosing", "This terrain is not awaiting a choice.");
    }
    if (terrainService.isGenerating(params.data.mapId)) {
      return sendError(reply, 409, "terrainInProgress", "Terrain is busy.");
    }
    terrainService.regenerate(params.data.mapId, params.data.terrainId);
    return reply.status(202).send({ id: params.data.terrainId });
  });

  app.post("/api/games", async (request, reply) => {
    const parsed = createGameRequestSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return sendError(reply, 400, "invalidRequest", "Request body is invalid.");
    }

    if (parsed.data.mapId !== undefined && !mapLibrary.has(parsed.data.mapId)) {
      return sendError(reply, 404, "mapNotFound", "Map was not found.");
    }

    const creatorSide: SeatId = parsed.data.side ?? "red";
    const aiSeats: SeatId[] =
      parsed.data.opponent === "ai" ? [creatorSide === "red" ? "black" : "red"] : [];

    const game = repository.createGame(parsed.data.mode, parsed.data.seed, {
      creatorName: parsed.data.name,
      creatorSide: parsed.data.side,
      mapId: parsed.data.mapId,
      aiSeats
    });

    if (Object.values(repository.controllersOf(game.gameId)).includes("ai")) {
      driveAiSoon(game.gameId);
    }

    return reply.send(game);
  });

  app.get("/api/games/:gameId", async (request, reply) => {
    const params = gameParamsSchema.safeParse(request.params);
    if (!params.success) {
      return sendError(reply, 400, "invalidRequest", "Game id is invalid.");
    }

    const session = authenticate(request, repository);
    if (!session) {
      return sendError(reply, 401, "invalidSession", "A valid seat token is required.");
    }
    if (session.gameId !== params.data.gameId) {
      return sendError(reply, 403, "forbidden", "That seat token does not belong to this game.");
    }

    const view = repository.getPlayerView(params.data.gameId, session.seat);
    if (!view) {
      return sendError(reply, 404, "gameNotFound", "Game was not found.");
    }

    return reply.send({
      gameId: params.data.gameId,
      seat: session.seat,
      revision: view.revision,
      view: view.view,
      seatInfo: view.seatInfo
    });
  });

  app.post("/api/games/:gameId/claim", async (request, reply) => {
    const params = gameParamsSchema.safeParse(request.params);
    const body = claimGameRequestSchema.safeParse(request.body ?? {});
    if (!params.success || !body.success) {
      return sendError(reply, 400, "invalidRequest", "Claim request is invalid.");
    }

    const session = authenticate(request, repository);
    if (!session) {
      return sendError(reply, 401, "invalidSession", "A valid seat token is required.");
    }
    if (session.gameId !== params.data.gameId) {
      return sendError(reply, 403, "forbidden", "That seat token does not belong to this game.");
    }

    const result = repository.claimSeat(params.data.gameId, session.seat, body.data.name);
    if (!result.ok) {
      if (result.reason === "aiSeat") {
        return sendError(reply, 409, "seatNotClaimable", "That seat is computer-controlled.");
      }
      return sendError(reply, 404, "gameNotFound", "Game was not found.");
    }

    return reply.send({
      gameId: params.data.gameId,
      seat: session.seat,
      revision: result.revision,
      view: result.view,
      seatInfo: result.seatInfo
    });
  });

  app.post("/api/games/:gameId/commands", async (request, reply) => {
    const params = gameParamsSchema.safeParse(request.params);
    const body = submitCommandRequestSchema.safeParse(request.body ?? {});
    if (!params.success || !body.success) {
      return sendError(reply, 400, "invalidRequest", "Command request is invalid.");
    }

    const session = authenticate(request, repository);
    if (!session) {
      return sendError(reply, 401, "invalidSession", "A valid seat token is required.");
    }
    if (session.gameId !== params.data.gameId) {
      return sendError(reply, 403, "forbidden", "That seat token does not belong to this game.");
    }

    const result = repository.submitCommand(
      params.data.gameId,
      session,
      body.data.baseRevision,
      body.data.clientCommandId,
      body.data.command
    );

    if (result.error) {
      return reply.status(result.httpStatus).send({
        accepted: result.status === "accepted",
        revision: result.revision,
        view: result.view,
        events: result.events,
        error: withRequestId(request, result.error)
      });
    }

    if (result.status === "accepted") {
      driveAiSoon(params.data.gameId);
    }

    return reply.status(result.httpStatus).send({
      accepted: true,
      revision: result.revision,
      view: result.view,
      events: result.events
    });
  });

  app.get("/api/games/:gameId/events", async (request, reply) => {
    const params = gameParamsSchema.safeParse(request.params);
    const query = eventQuerySchema.safeParse(request.query);
    if (!params.success || !query.success) {
      return sendError(reply, 400, "invalidRequest", "Events request is invalid.");
    }

    const session = authenticate(request, repository);
    if (!session) {
      return sendError(reply, 401, "invalidSession", "A valid seat token is required.");
    }
    if (session.gameId !== params.data.gameId) {
      return sendError(reply, 403, "forbidden", "That seat token does not belong to this game.");
    }

    return reply.send({
      events: repository.eventsAfter(params.data.gameId, session.seat, query.data.after)
    });
  });

  app.get("/api/admin/games", async (request, reply) => {
    if (!requireAdmin(request, reply, adminPassword)) {
      return reply;
    }
    return reply
      .header("cache-control", "no-store")
      .send({ games: repository.listGamesForAdmin() });
  });

  app.delete("/api/admin/games/:gameId", async (request, reply) => {
    if (!requireAdmin(request, reply, adminPassword)) {
      return reply;
    }
    const params = gameParamsSchema.safeParse(request.params);
    if (!params.success) {
      return sendError(reply, 400, "invalidRequest", "Game id is invalid.");
    }
    if (!repository.deleteGame(params.data.gameId)) {
      return sendError(reply, 404, "gameNotFound", "Game was not found.");
    }
    return reply.status(204).send();
  });
}

function authenticate(request: FastifyRequest, repository: GameRepository): SessionRecord | null {
  const token = bearerToken(request.headers.authorization);
  if (!token) {
    return null;
  }
  return repository.getSession(hashToken(token));
}

function requireAdmin(
  request: FastifyRequest,
  reply: FastifyReply,
  adminPassword: string | undefined
): boolean {
  if (!adminPassword) {
    sendError(reply, 503, "adminDisabled", "Admin API is not configured.");
    return false;
  }
  const token = bearerToken(request.headers.authorization);
  if (!token || token !== adminPassword) {
    sendError(reply, 401, "invalidAdmin", "Admin password is invalid.");
    return false;
  }
  return true;
}

function sendError(reply: FastifyReply, status: number, code: string, message: string) {
  return reply.status(status).send({
    error: {
      code,
      message,
      requestId: reply.request.id
    }
  });
}

function withRequestId(request: FastifyRequest, error: { code: string; message: string }) {
  return {
    ...error,
    requestId: request.id
  };
}
