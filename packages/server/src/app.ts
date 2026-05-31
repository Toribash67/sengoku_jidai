import cors from "@fastify/cors";
import fastify from "fastify";
import fastifyStatic from "@fastify/static";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { registerApiRoutes } from "./api/routes.js";
import type { ServerConfig } from "./config.js";
import { openDatabase, runMigrations } from "./persistence/database.js";
import { GameRepository } from "./persistence/repository.js";

export function buildApp(config: ServerConfig) {
  const app = fastify({
    logger: {
      level: config.logLevel
    }
  });
  const db = openDatabase(config.sqlitePath);
  runMigrations(db);
  const repository = new GameRepository(db);

  app.register(cors, {
    origin: config.nodeEnv === "production" ? false : config.webOrigin
  });

  registerApiRoutes(app, repository);

  if (config.nodeEnv === "production") {
    const webDistPath = resolve(process.cwd(), "packages/web/dist");
    if (existsSync(webDistPath)) {
      app.register(fastifyStatic, {
        root: webDistPath,
        wildcard: false
      });
      app.setNotFoundHandler((request, reply) => {
        if (request.raw.url?.startsWith("/api/")) {
          return reply.status(404).send({
            error: {
              code: "notFound",
              message: "API route was not found.",
              requestId: request.id
            }
          });
        }
        return reply.sendFile("index.html");
      });
    }
  }

  app.addHook("onClose", async () => {
    db.close();
  });

  return app;
}
