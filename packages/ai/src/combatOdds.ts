/** Distribution of the SUM of `nDice` dice (each face equally likely), as distinct totals
 *  with probabilities that sum to 1. `nDice = 0` is a point mass at 0. Pure. */
export function rollTotalDistribution(
  faces: readonly number[],
  nDice: number
): { total: number; prob: number }[] {
  let dist = new Map<number, number>([[0, 1]]);
  for (let d = 0; d < nDice; d++) {
    const next = new Map<number, number>();
    for (const [total, p] of dist) {
      for (const face of faces) {
        const key = total + face;
        next.set(key, (next.get(key) ?? 0) + p / faces.length);
      }
    }
    dist = next;
  }
  return [...dist.entries()].map(([total, prob]) => ({ total, prob }));
}
