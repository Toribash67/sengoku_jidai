import { rollDie } from "./rng.js";

export interface ConflictOutcome {
  rngState: string;
  defenceRoll: number;
  attackersLeft: number;
  defendersLeft: number;
  attackerLosses: number;
  defenderLosses: number;
}

/** Casualties of a conflict given an already-thrown defence roll (pure, no RNG):
 *  (1) the defence roll removes that many attackers; (2) any remaining attackers and
 *  defenders trade one-for-one until a side empties. */
export function conflictOutcome(
  defenceRoll: number,
  attackers: number,
  defenders: number
): Omit<ConflictOutcome, "rngState" | "defenceRoll"> {
  const defenceRemoved = Math.min(defenceRoll, attackers);
  let a = attackers - defenceRemoved;
  let d = defenders;
  let attrition = 0;
  if (a > 0) {
    attrition = Math.min(a, d);
    a -= attrition;
    d -= attrition;
  }
  return {
    attackersLeft: a,
    defendersLeft: d,
    attackerLosses: defenceRemoved + attrition,
    defenderLosses: attrition
  };
}

/** The expected (mean) total of `count` dice with the given `faces`, rounded to the nearest
 *  integer. The AI search resolves combat to this central-tendency total instead of a real
 *  seeded roll, so it values an attack by its expectation and cannot "peek" at the outcome the
 *  live `rngState` will actually produce. Pure — never touches RNG. */
export function expectedRollTotal(faces: readonly number[], count: number): number {
  if (count <= 0 || faces.length === 0) return 0;
  const mean = faces.reduce((a, f) => a + f, 0) / faces.length;
  return Math.round(count * mean);
}

/**
 * Section 3 conflict, pure: (1) defender rolls one die; attacker removes that many
 * attacking units. (2) If attackers remain, both sides remove one unit at a time
 * simultaneously until one side has none (= remove min of the two from each).
 */
export function resolveConflict(
  rngState: string,
  faces: readonly number[],
  attackers: number,
  defenders: number
): ConflictOutcome {
  const roll = rollDie(rngState, faces);
  return {
    rngState: roll.state,
    defenceRoll: roll.value,
    ...conflictOutcome(roll.value, attackers, defenders)
  };
}
