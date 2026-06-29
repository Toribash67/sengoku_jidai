import { describe, it, expect } from "vitest";
import { el, escapeAttr } from "../src/svg.js";

describe("escapeAttr", () => {
  it("escapes the XML-significant characters", () => {
    expect(escapeAttr(`a&b<c>d"e`)).toBe("a&amp;b&lt;c&gt;d&quot;e");
  });
});

describe("el", () => {
  it("self-closes when there are no children", () => {
    expect(el("circle", { cx: 1, cy: 2, r: 3 })).toBe(`<circle cx="1" cy="2" r="3"/>`);
  });
  it("wraps children and skips undefined attrs", () => {
    expect(el("g", { id: "x", transform: undefined }, "<rect/>")).toBe(`<g id="x"><rect/></g>`);
  });
});
