/** A seeded PRNG for the AI search — kept entirely separate from the engine's game RNG. */
export interface AiRng {
  /** Next float in [0, 1). */
  next(): number;
}

/** mulberry32, matching the engine's generator family. */
export function createAiRng(seed: number): AiRng {
  let s = seed >>> 0;
  return {
    next(): number {
      s = (s + 0x6d2b79f5) | 0;
      let t = Math.imul(s ^ (s >>> 15), 1 | s);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    }
  };
}

/** FNV-1a hash of a string to a 32-bit seed (same scheme as the engine). */
export function seedFromString(s: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** Uniformly pick one element (caller guarantees non-empty). */
export function pick<T>(rng: AiRng, items: readonly T[]): T {
  return items[Math.floor(rng.next() * items.length)]!;
}

/** Fisher-Yates shuffle into a new array; input is not mutated. */
export function shuffle<T>(rng: AiRng, items: readonly T[]): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng.next() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}
