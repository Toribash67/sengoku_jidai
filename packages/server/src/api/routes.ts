import {
  claimGameRequestSchema,
  createGameRequestSchema,
  eventQuerySchema,
  gameParamsSchema,
  hexMapSourceSchema,
  mapParamsSchema,
  submitCommandRequestSchema
} from "@sengoku-jidai/shared";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { bearerToken, hashToken } from "../sessions/tokens.js";
import type { GameRepository, SessionRecord } from "../persistence/repository.js";
import type { MapLibrary, MapLibraryError } from "../maps/library.js";

const MAP_ERROR_STATUS: Record<MapLibraryError["code"], number> = {
  invalidMap: 400,
  builtinMap: 403,
  mapNotFound: 404,
  mapInUse: 409
};

export function registerApiRoutes(
  app: FastifyInstance,
  repository: GameRepository,
  mapLibrary: MapLibrary
): void {
  app.get("/healthz", async () => ({ ok: true }));

  app.get("/api/maps", async () => ({ maps: mapLibrary.list() }));

  app.get("/api/maps/:mapId", async (request, reply) => {
    const params = mapParamsSchema.safeParse(request.params);
    if (!params.success) {
      return sendError(reply, 400, "invalidRequest", "Map id is invalid.");
    }
    const map = mapLibrary.get(params.data.mapId);
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

  app.post("/api/games", async (request, reply) => {
    const parsed = createGameRequestSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return sendError(reply, 400, "invalidRequest", "Request body is invalid.");
    }

    if (parsed.data.mapId !== undefined && !mapLibrary.has(parsed.data.mapId)) {
      return sendError(reply, 404, "mapNotFound", "Map was not found.");
    }

    const game = repository.createGame(parsed.data.mode, parsed.data.seed, {
      creatorName: parsed.data.name,
      creatorSide: parsed.data.side,
      mapId: parsed.data.mapId
    });
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
    if (!result) {
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
}

function authenticate(request: FastifyRequest, repository: GameRepository): SessionRecord | null {
  const token = bearerToken(request.headers.authorization);
  if (!token) {
    return null;
  }
  return repository.getSession(hashToken(token));
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
