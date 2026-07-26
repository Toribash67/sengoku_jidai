/** Pip layout for the commander tracker: one entry per commander, `true` for the first
 *  `remaining` (still to place / filled), `false` for the rest (placed or passed / dim). */
export function commanderPipFills(total: number, remaining: number): boolean[] {
  return Array.from({ length: Math.max(0, total) }, (_, i) => i < remaining);
}

/** Per-seat commander tracker for the HUD: a compact row of pips (filled = still to place,
 *  dim = placed/passed). Color is inherited from the enclosing seat block. */
export function CommanderPips({ total, remaining }: { total: number; remaining: number }) {
  return (
    <span
      className="commander-pips"
      aria-label={`${remaining} of ${total} commanders left to place`}
    >
      {commanderPipFills(total, remaining).map((filled, i) => (
        <span key={i} className={`commander-pip${filled ? "" : " is-used"}`} aria-hidden="true" />
      ))}
    </span>
  );
}
