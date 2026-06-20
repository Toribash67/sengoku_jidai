import { rollDie } from "./rng.js";

export interface ConflictOutcome {
  rngState: string;
  defenceRoll: number;
  attackersLeft: number;
  defendersLeft: number;
  attackerLosses: number;
  defenderLosses: number;
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
  const defenceRemoved = Math.min(roll.value, attackers);
  let a = attackers - defenceRemoved;
  let d = defenders;
  let attrition = 0;
  if (a > 0) {
    attrition = Math.min(a, d);
    a -= attrition;
    d -= attrition;
  }
  return {
    rngState: roll.state,
    defenceRoll: roll.value,
    attackersLeft: a,
    defendersLeft: d,
    attackerLosses: defenceRemoved + attrition,
    defenderLosses: attrition
  };
}
