import type { EvalWeights } from "../eval.js";

/** What the search models. Every item can be switched off so a series of matches can measure
 *  what it is worth (and drop any that costs more look-ahead depth than it earns). */
export interface Features {
  /** Battles branch over every dice total; false → one outcome at the rounded mean total. */
  diceDistribution: boolean;
  /** The opponent may answer an Advance with an Ambush they probably hold. */
  opponentAmbush: boolean;
  /** Either roller may discard cards to rethrow. */
  rerolls: boolean;
  /** Rethrows considered per battle inside the look-ahead. */
  rerollCap: number;
  /** Take Cover against a siege (Fortress). */
  takeCover: boolean;
  /** Ship Strike / Siege Assault follow-ups, for both sides. */
  followUps: boolean;
  /** The opponent's possible deploy-time cards, as probability-weighted threats. */
  opponentDeployThreats: boolean;
  /** How many battles along one line of look-ahead are expanded outcome by outcome; later ones
   *  follow their most likely outcome, with the rest folded in by static value. Expanding
   *  multiplies the tree by the number of outcomes: measured at equal depth it plays better, at
   *  equal time clearly worse (it loses a ply or two), hence 0. */
  fullBattles: number;
  /** Try remembered options first, so the others often need not be played out (search.ts,
   *  OrderMemo). Changes speed only, never the choice. */
  orderMemory: boolean;
  /** Search options that come late in the order one step shallower, and again in full only if
   *  they then look better than the earlier ones. Trades a little accuracy for depth. */
  reductions: boolean;
}

export const DEFAULT_FEATURES: Features = {
  diceDistribution: true,
  opponentAmbush: true,
  rerolls: true,
  rerollCap: 2,
  takeCover: true,
  followUps: true,
  opponentDeployThreats: true,
  fullBattles: 0,
  orderMemory: true,
  reductions: true
};

export interface ExpectiOptions {
  /** Fixed search depth in deployments: deterministic, no deadline. */
  depth?: number;
  /** Wall-clock budget per command (default 5000). Ignored when `depth` is set. */
  deadlineMs?: number;
  /** Ceiling for iterative deepening (default 20). */
  maxDepth?: number;
  weights?: EvalWeights;
  features?: Partial<Features>;
}
