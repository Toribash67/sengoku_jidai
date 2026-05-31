import {
  createGameRequestSchema,
  eventQuerySchema,
  gameParamsSchema,
  joinGameRequestSchema,
  submitCommandRequestSchema
} from "@sengoku-jidai/shared";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { bearerToken, hashToken } from "../sessions/tokens.js";
import type { GameRepository, SessionRecord } from "../persistence/repository.js";

export function registerApiRoutes(app: FastifyInstance, repository: GameRepository): void {
  app.get("/healthz", async () => ({ ok: true }));

  app.post("/api/games", async (request, reply) => {
    const parsed = createGameRequestSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return sendError(reply, 400, "invalidRequest", "Request body is invalid.");
    }

    const game = repository.createGame(parsed.data.mode, parsed.data.seed);
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
      view: view.view
    });
  });

  app.post("/api/games/:gameId/join", async (request, reply) => {
    const params = gameParamsSchema.safeParse(request.params);
    const body = joinGameRequestSchema.safeParse(request.body ?? {});
    if (!params.success || !body.success) {
      return sendError(reply, 400, "invalidRequest", "Join request is invalid.");
    }

    return sendError(
      reply,
      501,
      "notImplemented",
      "Private multiplayer joining is not implemented yet."
    );
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
      events: repository.eventsAfter(params.data.gameId, query.data.after)
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
