/** Pure helpers for the combat dice reveal animation. The React hook that drives the tumble
 *  (see `useDiceReveal` in CombatPanel) is a thin wrapper around these so the reveal *decision*
 *  stays unit-testable without a DOM. */

/** A stable identity for a set of rolled faces, or null when nothing has been rolled yet.
 *  Used to detect the awaiting -> rolled transition (and reroll -> new faces). */
export function diceKey(values?: number[]): string | null {
  return values ? values.join(",") : null;
}

/** Whether the dice should tumble on this render. We only animate a roll we actually witness:
 *  never on the first observation (so a page loaded mid-combat shows the faces at rest), never
 *  before any dice exist, never under a reduced-motion preference, and only when the faces
 *  actually changed. */
export function shouldTumble(opts: {
  seenBefore: boolean;
  reducedMotion: boolean;
  prevKey: string | null;
  nextKey: string | null;
}): boolean {
  if (opts.nextKey === null) return false;
  if (!opts.seenBefore) return false;
  if (opts.reducedMotion) return false;
  return opts.prevKey !== opts.nextKey;
}

/** `count` cosmetic faces in 1-6, drawn from `rng` (defaults to Math.random). Shown flickering
 *  during the tumble before the real faces settle in. */
export function randomFaces(count: number, rng: () => number = Math.random): number[] {
  return Array.from({ length: count }, () => 1 + Math.floor(rng() * 6));
}
