import type {
  LegalCommandSummary,
  LegalMove,
  LegalStrike,
  OperationCard
} from "@sengoku-jidai/engine";

/** A base order (or operation-card play) that has been "armed": the player picked a verb and
 *  now chooses one of its candidate tiles. A move arms advance/sail destinations; a strike arms
 *  bombard/shell enemy targets. `card`/`bonusMax` carry an operation card played as the
 *  commander deploys (set only for card plays). */
export type ArmedOrder =
  | {
      kind: "move";
      type: "advance" | "sail";
      moves: LegalMove[];
      card?: OperationCard;
      bonusMax?: number;
    }
  | {
      kind: "strike";
      type: "bombard" | "shell";
      strikes: LegalStrike[];
      card?: OperationCard;
    };

export type OrderVerb =
  | "advance"
  | "sail"
  | "bombard"
  | "shell"
  | "reinforce"
  | "embark"
  | "plan"
  | "pass";

export type VerbAvailability = Record<OrderVerb, boolean>;

export type ResolvedOrder =
  | { kind: "move"; move: LegalMove }
  | { kind: "strike"; strike: LegalStrike };

/** Which palette verbs have at least one legal candidate this turn. Drives greying. */
export function verbAvailability(legal: LegalCommandSummary): VerbAvailability {
  return {
    advance: legal.moves.some((m) => m.type === "advance"),
    sail: legal.moves.some((m) => m.type === "sail"),
    bombard: legal.strikes.some((s) => s.type === "bombard"),
    shell: legal.strikes.some((s) => s.type === "shell"),
    reinforce: legal.placements.some((p) => p.type === "reinforce"),
    embark: legal.placements.some((p) => p.type === "embark"),
    plan: legal.plans.length > 0,
    pass: legal.canPass
  };
}

/** Arm a move verb (advance/sail) from the base legal moves. Null when none are legal. */
export function armMove(legal: LegalCommandSummary, type: "advance" | "sail"): ArmedOrder | null {
  const moves = legal.moves.filter((m) => m.type === type);
  return moves.length > 0 ? { kind: "move", type, moves } : null;
}

/** Arm a strike verb (bombard/shell) from the base legal strikes. Null when none are legal. */
export function armStrike(legal: LegalCommandSummary, type: "bombard" | "shell"): ArmedOrder | null {
  const strikes = legal.strikes.filter((s) => s.type === type);
  return strikes.length > 0 ? { kind: "strike", type, strikes } : null;
}

/** Candidate tiles to glow for the armed order: move destinations or strike enemy targets. */
export function candidateTiles(armed: ArmedOrder): Set<string> {
  return armed.kind === "move"
    ? new Set(armed.moves.map((m) => m.targetAreaId))
    : new Set(armed.strikes.map((s) => s.linkedAreaId));
}

/** Resolve a clicked tile to its specific order, or null when the tile is not a candidate. */
export function resolveArmedTile(armed: ArmedOrder, areaId: string): ResolvedOrder | null {
  if (armed.kind === "move") {
    const move = armed.moves.find((m) => m.targetAreaId === areaId);
    return move ? { kind: "move", move } : null;
  }
  const strike = armed.strikes.find((s) => s.linkedAreaId === areaId);
  return strike ? { kind: "strike", strike } : null;
}
