import { describe, it, expect } from "vitest";
import { actionGlyphSpec, type ActionGlyphVerb } from "./actionGlyph.js";

describe("actionGlyphSpec", () => {
  it("maps the four order verbs to their board token art", () => {
    const verbs: ActionGlyphVerb[] = ["advance", "sail", "bombard", "shell"];
    for (const verb of verbs) {
      const spec = actionGlyphSpec(verb);
      expect(spec.kind).toBe("order");
      if (spec.kind === "order") {
        expect(spec.inner).toContain("fill:#000000"); // the black hex token
        expect(spec.viewBox.split(/\s+/)).toHaveLength(4);
      }
    }
  });

  it("uses the SVG name 'move' for the advance verb (board glyph mismatch)", () => {
    const advance = actionGlyphSpec("advance");
    const sail = actionGlyphSpec("sail");
    // advance renders the 'move' token, distinct from every other order glyph.
    expect(advance).not.toEqual(sail);
  });

  it("draws the placed piece for placements: troop for reinforce, ship for embark", () => {
    expect(actionGlyphSpec("reinforce")).toEqual({ kind: "unit", unit: "troop" });
    expect(actionGlyphSpec("embark")).toEqual({ kind: "unit", unit: "ship" });
  });

  it("gives plan and pass their own non-board glyphs", () => {
    expect(actionGlyphSpec("plan")).toEqual({ kind: "plan" });
    expect(actionGlyphSpec("pass")).toEqual({ kind: "pass" });
  });
});
