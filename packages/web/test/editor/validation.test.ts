import { describe, expect, it } from "vitest";
import { riversSource } from "@sengoku-jidai/engine/client";
import { docFromSource, emptyDoc } from "../../src/editor/doc.js";
import { validationMessage } from "../../src/editor/validation.js";

describe("validationMessage", () => {
  it("passes a known-good map", () => {
    expect(validationMessage(docFromSource(riversSource, { asCopy: true }))).toBeNull();
  });

  it("surfaces the engine's message for an empty map", () => {
    expect(validationMessage(emptyDoc())).toBe("map has no tiles");
  });
});
