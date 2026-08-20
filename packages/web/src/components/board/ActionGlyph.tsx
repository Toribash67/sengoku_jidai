import type { SeatId } from "@sengoku-jidai/engine/client";
import { actionGlyphSpec, type ActionGlyphVerb } from "./actionGlyph.js";
import { SEAT_SOLID } from "./tileFill.js";

/** Support glyphs are drawn on the same square field as the order tokens so every
 *  button icon reads at one size. */
const SUPPORT_VIEWBOX = "-40 -40 80 80";

/** A five-point star at outer R≈28 / inner r≈12, centred on the origin. */
const STAR_PATH =
  "M0,-28 L7.05,-9.71 L26.63,-8.65 L11.41,3.71 L16.46,22.65 " +
  "L0,12 L-16.46,22.65 L-11.41,3.71 L-26.63,-8.65 L-7.05,-9.71 Z";

/**
 * The board glyph for an action-palette button. Order verbs render the exact board
 * token; placements render the piece they put down (tinted for the viewer's seat);
 * plan and pass get their own small marks. Decorative — the button caption names it.
 */
export function ActionGlyph({ verb, seat }: { verb: ActionGlyphVerb; seat: SeatId }) {
  const spec = actionGlyphSpec(verb);

  if (spec.kind === "order") {
    return (
      <svg
        className="action-glyph"
        viewBox={spec.viewBox}
        aria-hidden="true"
        dangerouslySetInnerHTML={{ __html: spec.inner }}
      />
    );
  }

  const seatColor = SEAT_SOLID[seat];
  return (
    <svg className="action-glyph" viewBox={SUPPORT_VIEWBOX} aria-hidden="true">
      {spec.kind === "unit" && spec.unit === "troop" && (
        <>
          <circle cx="0" cy="0" r="26" fill={seatColor} />
          <circle
            cx="0"
            cy="0"
            r="13"
            fill="none"
            stroke="rgba(255, 255, 255, 0.72)"
            strokeWidth="4"
          />
        </>
      )}
      {spec.kind === "unit" && spec.unit === "ship" && (
        <g fill={seatColor} stroke={seatColor}>
          <path d="M-28 4 Q0 9 28 4 L20 20 Q0 24 -20 20 Z" stroke="none" />
          <path d="M0 -26 L0 6" strokeWidth="3.5" strokeLinecap="round" />
          <path d="M2 -24 L2 2 L22 0 Z" stroke="none" />
        </g>
      )}
      {spec.kind === "plan" && <path d={STAR_PATH} fill="var(--kin)" />}
      {spec.kind === "pass" && (
        <g
          fill="none"
          stroke="currentColor"
          strokeWidth="6"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M-24 -14 L-4 0 L-24 14" />
          <path d="M-6 -14 L14 0 L-6 14" />
          <path d="M20 -15 L20 15" />
        </g>
      )}
    </svg>
  );
}
