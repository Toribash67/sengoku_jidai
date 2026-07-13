import { describe, expect, it } from "vitest";
import { createUrl, editorUrl, gameUrl, inviteUrl, mapsUrl, parseRoute } from "./route.js";

describe("parseRoute", () => {
  it("returns the create route for /", () => {
    expect(parseRoute({ pathname: "/", hash: "", search: "" })).toEqual({
      kind: "create",
      map: null
    });
  });

  it("parses a game route with the token from the fragment", () => {
    expect(parseRoute({ pathname: "/g/abc-123", hash: "#tok_secret", search: "" })).toEqual({
      kind: "game",
      gameId: "abc-123",
      token: "tok_secret"
    });
  });

  it("tolerates a trailing slash and a missing fragment", () => {
    expect(parseRoute({ pathname: "/g/abc-123/", hash: "", search: "" })).toEqual({
      kind: "game",
      gameId: "abc-123",
      token: ""
    });
  });

  it("decodes an encoded game id", () => {
    const route = parseRoute({ pathname: "/g/a%2Fb", hash: "#t", search: "" });
    expect(route.kind).toBe("game");
    if (route.kind === "game") {
      expect(route.gameId).toBe("a/b");
    }
  });

  it("parses the admin route", () => {
    expect(parseRoute({ pathname: "/admin", hash: "", search: "" })).toEqual({ kind: "admin" });
  });

  it("tolerates a trailing slash on the admin route", () => {
    expect(parseRoute({ pathname: "/admin/", hash: "", search: "" })).toEqual({ kind: "admin" });
  });
});

describe("SP5 routes", () => {
  it("parses /maps", () => {
    expect(parseRoute({ pathname: "/maps", hash: "", search: "" })).toEqual({ kind: "maps" });
    expect(parseRoute({ pathname: "/maps/", hash: "", search: "" })).toEqual({ kind: "maps" });
  });

  it("parses the editor routes", () => {
    expect(parseRoute({ pathname: "/maps/new", hash: "", search: "" })).toEqual({
      kind: "editor",
      mapId: null
    });
    expect(parseRoute({ pathname: "/maps/abc-123/edit", hash: "", search: "" })).toEqual({
      kind: "editor",
      mapId: "abc-123"
    });
  });

  it("parses the create route's map preselect", () => {
    expect(parseRoute({ pathname: "/", hash: "", search: "?map=abc" })).toEqual({
      kind: "create",
      map: "abc"
    });
    expect(parseRoute({ pathname: "/", hash: "", search: "" })).toEqual({
      kind: "create",
      map: null
    });
  });

  it("builds urls", () => {
    expect(mapsUrl()).toBe("/maps");
    expect(editorUrl(null)).toBe("/maps/new");
    expect(editorUrl("a b")).toBe("/maps/a%20b/edit");
    expect(createUrl()).toBe("/");
    expect(createUrl("a b")).toBe("/?map=a%20b");
  });
});

describe("url builders", () => {
  it("builds a game url with the token in the fragment", () => {
    expect(gameUrl("abc 1", "tok")).toBe("/g/abc%201#tok");
  });

  it("builds an absolute invite url from an origin", () => {
    expect(inviteUrl("https://host:8080", "g1", "tok")).toBe("https://host:8080/g/g1#tok");
  });
});
