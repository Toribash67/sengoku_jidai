import { orderGlyphArt, type OrderKind } from "@sengoku-jidai/board-render";

/** Every verb the idle action palette can show a button for. */
export type ActionGlyphVerb =
  | "advance"
  | "sail"
  | "bombard"
  | "shell"
  | "reinforce"
  | "embark"
  | "plan"
  | "pass";

/** Order verbs that own a board token. `advance` draws the SVG token named `move`. */
const ORDER_KIND: Partial<Record<ActionGlyphVerb, OrderKind>> = {
  advance: "move",
  sail: "sail",
  bombard: "bombard",
  shell: "shell"
};

/**
 * What glyph an action button should draw:
 * - `order`  — the exact board token art, so the button mirrors the tile.
 * - `unit`   — the piece a placement puts down (troop disc / ship), tinted per seat.
 * - `plan`/`pass` — support actions with no board token; their own small glyphs.
 */
export type ActionGlyphSpec =
  | { kind: "order"; viewBox: string; inner: string }
  | { kind: "unit"; unit: "troop" | "ship" }
  | { kind: "plan" }
  | { kind: "pass" };

export function actionGlyphSpec(verb: ActionGlyphVerb): ActionGlyphSpec {
  const orderKind = ORDER_KIND[verb];
  if (orderKind) {
    return { kind: "order", ...orderGlyphArt(orderKind) };
  }
  if (verb === "reinforce") {
    return { kind: "unit", unit: "troop" };
  }
  if (verb === "embark") {
    return { kind: "unit", unit: "ship" };
  }
  if (verb === "plan") {
    return { kind: "plan" };
  }
  return { kind: "pass" };
}
