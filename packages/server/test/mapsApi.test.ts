import { FIXTURE_HEX_MAP } from "@sengoku-jidai/engine";
import { RandomBot, createAiRng } from "@sengoku-jidai/ai";
import fastify from "fastify";
import { describe, expect, it } from "vitest";
import { registerApiRoutes } from "../src/api/routes.js";
import { buildApp } from "../src/app.js";
import type { ServerConfig } from "../src/config.js";
import { MapLibrary } from "../src/maps/library.js";
import { TerrainStore } from "../src/maps/terrainStore.js";
import { TerrainService } from "../src/maps/terrainService.js";
import { openDatabase, runMigrations } from "../src/persistence/database.js";
import { GameRepository } from "../src/persistence/repository.js";

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

function fixturePayload() {
  return structuredClone(FIXTURE_HEX_MAP);
}

describe("maps API", () => {
  it("uploads, lists, fetches, updates, and deletes a map", async () => {
    const app = buildApp(testConfig());

    const created = await app.inject({
      method: "POST",
      url: "/api/maps",
      payload: fixturePayload()
    });
    expect(created.statusCode).toBe(201);
    const map = created.json();
    expect(map.builtin).toBe(false);
    expect(map.source.tiles).toHaveLength(5);

    const listed = await app.inject({ method: "GET", url: "/api/maps" });
    expect(listed.statusCode).toBe(200);
    const { maps } = listed.json();
    expect(maps[0]).toMatchObject({ id: "rivers", builtin: true });
    expect(maps.some((m: { id: string }) => m.id === map.id)).toBe(true);

    const fetched = await app.inject({ method: "GET", url: `/api/maps/${map.id}` });
    expect(fetched.statusCode).toBe(200);
    expect(fetched.json().source.startingDeployment.A.troop).toBe(3);

    const updated = await app.inject({
      method: "PUT",
      url: `/api/maps/${map.id}`,
      payload: { ...fixturePayload(), name: "Renamed" }
    });
    expect(updated.statusCode).toBe(200);
    expect(updated.json().name).toBe("Renamed");

    const deleted = await app.inject({ method: "DELETE", url: `/api/maps/${map.id}` });
    expect(deleted.statusCode).toBe(204);
    const gone = await app.inject({ method: "GET", url: `/api/maps/${map.id}` });
    expect(gone.statusCode).toBe(404);
    expect(gone.json().error.code).toBe("mapNotFound");

    await app.close();
  });

  it("serves the built-in rivers map and protects it from writes", async () => {
    const app = buildApp(testConfig());

    const rivers = await app.inject({ method: "GET", url: "/api/maps/rivers" });
    expect(rivers.statusCode).toBe(200);
    expect(rivers.json().builtin).toBe(true);

    const put = await app.inject({
      method: "PUT",
      url: "/api/maps/rivers",
      payload: fixturePayload()
    });
    expect(put.statusCode).toBe(403);
    expect(put.json().error.code).toBe("builtinMap");

    const del = await app.inject({ method: "DELETE", url: "/api/maps/rivers" });
    expect(del.statusCode).toBe(403);

    await app.close();
  });

  it("rejects malformed and invalid map uploads with 400", async () => {
    const app = buildApp(testConfig());

    const malformed = await app.inject({
      method: "POST",
      url: "/api/maps",
      payload: { name: "nope" }
    });
    expect(malformed.statusCode).toBe(400);
    expect(malformed.json().error.code).toBe("invalidMap");

    const disconnected = fixturePayload();
    disconnected.tiles[0]!.hexes = [
      { q: 0, r: 0 },
      { q: 5, r: 5 }
    ];
    const invalid = await app.inject({
      method: "POST",
      url: "/api/maps",
      payload: disconnected
    });
    expect(invalid.statusCode).toBe(400);
    expect(invalid.json().error.message).toContain("not edge-connected");

    await app.close();
  });
});

describe("games on custom maps", () => {
  it("uploads a map, creates a game on it, and plays a command", async () => {
    const app = buildApp(testConfig());

    const uploaded = await app.inject({
      method: "POST",
      url: "/api/maps",
      payload: fixturePayload()
    });
    expect(uploaded.statusCode).toBe(201);
    const mapId = uploaded.json().id as string;

    const created = await app.inject({
      method: "POST",
      url: "/api/games",
      payload: { mode: "hotseat", seed: "custom-map-seed", mapId }
    });
    expect(created.statusCode).toBe(200);
    const game = created.json();
    expect(game.view.mapId).toBe(mapId);

    const activeSeat = game.view.activeSeat as "red" | "black";
    const token = game.seats.find((s: { seat: string }) => s.seat === activeSeat).token;
    const command = await app.inject({
      method: "POST",
      url: `/api/games/${game.gameId}/commands`,
      headers: { authorization: `Bearer ${token}` },
      payload: { baseRevision: 0, clientCommandId: "cmd-1", command: { type: "pass" } }
    });
    expect(command.statusCode).toBe(200);
    expect(command.json().revision).toBe(1);

    // The played map is now immutable.
    const put = await app.inject({
      method: "PUT",
      url: `/api/maps/${mapId}`,
      payload: fixturePayload()
    });
    expect(put.statusCode).toBe(409);
    expect(put.json().error.code).toBe("mapInUse");

    await app.close();
  });

  it("404s game creation on an unknown mapId without creating anything", async () => {
    const db = openDatabase(":memory:");
    runMigrations(db);
    const app = fastify({ logger: { level: "silent" } });
    const library = new MapLibrary(db);
    const terrainStore = new TerrainStore(db);
    const terrainService = new TerrainService({ library, store: terrainStore, falKey: undefined });
    registerApiRoutes(app, new GameRepository(db), library, terrainStore, terrainService);

    const created = await app.inject({
      method: "POST",
      url: "/api/games",
      payload: { mode: "hotseat", mapId: "no-such-map" }
    });
    expect(created.statusCode).toBe(404);
    expect(created.json().error.code).toBe("mapNotFound");

    const gameCount = db.prepare("SELECT COUNT(*) AS n FROM games").get() as { n: number };
    expect(gameCount.n).toBe(0);

    await app.close();
    db.close();
  });

  it("still creates rivers games when mapId is omitted (default path unchanged)", async () => {
    const app = buildApp(testConfig());
    const created = await app.inject({
      method: "POST",
      url: "/api/games",
      payload: { mode: "hotseat", seed: "rivers-default" }
    });
    expect(created.statusCode).toBe(200);
    expect(created.json().view.mapId).toBe("rivers");
    await app.close();
  });
});

describe("AI opponent at game creation", () => {
  it("POST /api/games with opponent:'ai' marks the non-creator seat as ai", async () => {
    const db = openDatabase(":memory:");
    runMigrations(db);
    const app = fastify({ logger: { level: "silent" } });
    const repository = new GameRepository(db);
    const library = new MapLibrary(db);
    const terrainStore = new TerrainStore(db);
    const terrainService = new TerrainService({ library, store: terrainStore, falKey: undefined });
    registerApiRoutes(
      app,
      repository,
      library,
      terrainStore,
      terrainService,
      undefined,
      () => new RandomBot(createAiRng(1))
    );

    const res = await app.inject({
      method: "POST",
      url: "/api/games",
      payload: { mode: "hotseat", opponent: "ai" }
    });
    expect(res.statusCode).toBe(200);
    const { gameId } = res.json();
    expect(repository.controllersOf(gameId)).toEqual({ red: "human", black: "ai" });

    await app.close();
    db.close();
  });
});
