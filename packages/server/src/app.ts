import cors from "@fastify/cors";
import fastify from "fastify";
import fastifyStatic from "@fastify/static";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import type { Command, GameState } from "@sengoku-jidai/engine";
import type { SeatId } from "@sengoku-jidai/shared";
import { registerApiRoutes } from "./api/routes.js";
import type { ServerConfig } from "./config.js";
import { MapLibrary } from "./maps/library.js";
import { readRiversInkSeed, seedRivers } from "./maps/seedRivers.js";
import { TerrainStore } from "./maps/terrainStore.js";
import { TerrainService } from "./maps/terrainService.js";
import { openDatabase, runMigrations } from "./persistence/database.js";
import { GameRepository } from "./persistence/repository.js";

export interface BuildAppOptions {
  aiPickCommandFor?: (gameId: string) => (seat: SeatId, state: GameState) => Promise<Command>;
}

export function buildApp(config: ServerConfig, opts?: BuildAppOptions) {
  const app = fastify({
    logger: {
      level: config.logLevel
    }
  });
  const db = openDatabase(config.sqlitePath);
  runMigrations(db);
  const repository = new GameRepository(db);
  const mapLibrary = new MapLibrary(db);
  mapLibrary.loadAll(app.log);
  const terrainStore = new TerrainStore(db);
  terrainStore.resetInterrupted();
  seedRivers({ library: mapLibrary, store: terrainStore }, readRiversInkSeed(), app.log);
  const terrainService = new TerrainService({
    library: mapLibrary,
    store: terrainStore,
    falKey: config.falKey
  });

  app.register(cors, {
    origin: config.nodeEnv === "production" ? false : config.webOrigin
  });

  registerApiRoutes(
    app,
    repository,
    mapLibrary,
    terrainStore,
    terrainService,
    config.adminPassword,
    opts?.aiPickCommandFor
  );

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
