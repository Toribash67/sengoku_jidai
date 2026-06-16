/** Custom dice faces for General Orders: 0,1,1,1,1,2 pips. */
export const DEFAULT_DICE_FACES = [0, 1, 1, 1, 1, 2] as const;

/** FNV-1a hash of a seed string to a 32-bit unsigned int. */
function hashSeed(seed: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** Create the initial serializable RNG state for a seed. */
export function createRngState(seed: string): string {
  return String(hashSeed(seed));
}

/**
 * mulberry32 step. Returns the next float in [0,1) and the advanced state.
 * State is the 32-bit counter, serialized as a decimal string for JSON safety.
 */
export function nextFloat(state: string): { value: number; state: string } {
  let a = (Number(state) + 0x6d2b79f5) | 0;
  const advanced = a >>> 0;
  let t = Math.imul(a ^ (a >>> 15), 1 | a);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  const value = ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  return { value, state: String(advanced) };
}

/** Roll a die from the given faces. */
export function rollDie(
  state: string,
  faces: readonly number[]
): { value: number; state: string } {
  const r = nextFloat(state);
  const index = Math.floor(r.value * faces.length);
  return { value: faces[index]!, state: r.state };
}

/** Fisher-Yates shuffle. Does not mutate the input array. */
export function shuffle<T>(state: string, items: readonly T[]): { value: T[]; state: string } {
  const out = [...items];
  let s = state;
  for (let i = out.length - 1; i > 0; i--) {
    const r = nextFloat(s);
    s = r.state;
    const j = Math.floor(r.value * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return { value: out, state: s };
}
