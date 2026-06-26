import { describe, expect, it } from "vitest";
import { gameUrl, inviteUrl, parseRoute } from "./route.js";

describe("parseRoute", () => {
  it("returns the create route for /", () => {
    expect(parseRoute({ pathname: "/", hash: "" })).toEqual({ kind: "create" });
  });

  it("parses a game route with the token from the fragment", () => {
    expect(parseRoute({ pathname: "/g/abc-123", hash: "#tok_secret" })).toEqual({
      kind: "game",
      gameId: "abc-123",
      token: "tok_secret"
    });
  });

  it("tolerates a trailing slash and a missing fragment", () => {
    expect(parseRoute({ pathname: "/g/abc-123/", hash: "" })).toEqual({
      kind: "game",
      gameId: "abc-123",
      token: ""
    });
  });

  it("decodes an encoded game id", () => {
    const route = parseRoute({ pathname: "/g/a%2Fb", hash: "#t" });
    expect(route.kind).toBe("game");
    if (route.kind === "game") {
      expect(route.gameId).toBe("a/b");
    }
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
