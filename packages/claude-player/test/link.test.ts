import { describe, expect, it } from "vitest";
import { LinkError, parseInviteLink } from "../src/link.js";

describe("parseInviteLink", () => {
  it("parses a prod invite link", () => {
    expect(parseInviteLink("https://sengoku.example.com/g/abc-123#tok_secret")).toEqual({
      baseUrl: "https://sengoku.example.com",
      gameId: "abc-123",
      token: "tok_secret"
    });
  });

  it("tolerates whitespace, quotes, angle brackets and a trailing slash", () => {
    for (const raw of [
      "  https://h.example/g/abc/#tok \n",
      '"https://h.example/g/abc#tok"',
      "'https://h.example/g/abc#tok'",
      "<https://h.example/g/abc#tok>"
    ]) {
      expect(parseInviteLink(raw)).toEqual({
        baseUrl: "https://h.example",
        gameId: "abc",
        token: "tok"
      });
    }
  });

  it("keeps a local host and port, and decodes the id", () => {
    expect(parseInviteLink("http://localhost:5173/g/a%20b#t")).toEqual({
      baseUrl: "http://localhost:5173",
      gameId: "a b",
      token: "t"
    });
  });

  it("keeps a path prefix in the base url", () => {
    expect(parseInviteLink("https://h.example/sengoku/g/abc#t").baseUrl).toBe(
      "https://h.example/sengoku"
    );
  });

  it("rejects a link without a token", () => {
    expect(() => parseInviteLink("https://h.example/g/abc")).toThrow(LinkError);
    expect(() => parseInviteLink("https://h.example/g/abc")).toThrow(/seat token/);
  });

  it("rejects non-invite urls and garbage", () => {
    expect(() => parseInviteLink("https://h.example/maps#t")).toThrow(LinkError);
    expect(() => parseInviteLink("not a url")).toThrow(LinkError);
  });
});
