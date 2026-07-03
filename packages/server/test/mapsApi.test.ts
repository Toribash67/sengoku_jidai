import { FIXTURE_HEX_MAP } from "@sengoku-jidai/engine";
import { describe, expect, it } from "vitest";
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
