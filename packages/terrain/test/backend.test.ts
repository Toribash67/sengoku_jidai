import { describe, expect, it } from "vitest";
import { firstImageUrl } from "../src/backend.js";

describe("firstImageUrl", () => {
  it("returns the first image url from a fal result payload", () => {
    expect(
      firstImageUrl({ images: [{ url: "https://out/a.png" }, { url: "https://out/b.png" }] })
    ).toBe("https://out/a.png");
  });

  it("throws when the payload has no image url", () => {
    expect(() => firstImageUrl({ images: [] })).toThrow(/no image url/i);
    expect(() => firstImageUrl({})).toThrow(/no image url/i);
  });
});
