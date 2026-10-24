import type { SeatId } from "./types.js";
import type { GameState, OperationCard, PendingChoice, UnitType } from "./state.js";
import type { BonusType } from "./rules.js";

/** Who is issuing the command. */
export interface CommandActor {
  seat: SeatId;
}

/** `siege` (Fortress): how many of the `count` land units are catapults (default 0). */
export type Move = { from: string; count: number; siege?: number };
export type Placement = { area: string; count: number; siege?: number };

export type Command =
  // `card` (optional) is an operation card played as the commander deploys — it modifies the
  // action (extra pool/dice, opponent-area placement, or counterattack occupancy) and is
  // discarded. `cardBonus` (advance/sail) is the 0–2 reserve units a ground/river-assault card
  // adds to the linked area. A Siege Assault follow-up is an `advance` on the offered space
  // carrying the `siege_assault` card (no commander deployed).
  | { type: "advance"; spaceId: string; moves: Move[]; card?: OperationCard; cardBonus?: number }
  | { type: "sail"; spaceId: string; moves: Move[]; card?: OperationCard; cardBonus?: number }
  | { type: "bombard"; spaceId: string; targetAreaId: string; card?: OperationCard }
  | { type: "shell"; spaceId: string; targetAreaId: string }
  | { type: "siege"; spaceId: string; targetAreaId: string; card?: OperationCard }
  | { type: "reinforce"; spaceId: string; placements: Placement[]; card?: OperationCard }
  | { type: "embark"; spaceId: string; placements: Placement[]; card?: OperationCard }
  | { type: "plan"; spaceId: string }
  | { type: "pass" }
  | { type: "combatRoll"; pendingId: string; card?: OperationCard }
  | { type: "combatReroll"; pendingId: string; card: OperationCard }
  // `card` is only Take Cover, played by a siege's defender in the `awaiting-cover` phase.
  | { type: "combatResolve"; pendingId: string; card?: OperationCard }
  | { type: "choosePendingDecision"; pendingId: string; choice: PendingChoice };

export type RejectionReason =
  | { code: "notActiveSeat"; message: string }
  | { code: "wrongPhase"; message: string }
  | { code: "gameNotActive"; message: string }
  | { code: "spaceNotFound"; message: string }
  | { code: "spaceWrongType"; message: string }
  | { code: "spaceOccupied"; message: string }
  | { code: "actionDisabled"; message: string }
  | { code: "supportTypeUsed"; message: string }
  | { code: "criteriaNotMet"; message: string }
  | { code: "illegalMove"; message: string }
  | { code: "illegalPlacement"; message: string }
  | { code: "illegalTarget"; message: string }
  | { code: "insufficientReserve"; message: string }
  | { code: "illegalChoice"; message: string }
  | { code: "pendingDecisionRequired"; message: string }
  | { code: "pendingDecisionNotFound"; message: string }
  | { code: "noCommanders"; message: string };

export type GameEvent =
  | { type: "commanderDeployed"; seat: SeatId; spaceId: string }
  | { type: "passed"; seat: SeatId }
  // `siege` (land units only, omitted when 0): how many of `count` are catapults.
  | {
      type: "unitsMoved";
      seat: SeatId;
      from: string;
      to: string;
      unit: UnitType;
      count: number;
      siege?: number;
    }
  | {
      type: "unitsPlaced";
      seat: SeatId;
      area: string;
      unit: UnitType;
      count: number;
      siege?: number;
    }
  | { type: "bonusApplied"; seat: SeatId; bonus: BonusType; area: string }
  | {
      type: "diceRolled";
      seat: SeatId;
      purpose: string;
      rolls: number[];
      total: number;
      fort?: boolean;
    }
  | { type: "cardsDrawn"; seat: SeatId; count: number }
  | { type: "cardDiscarded"; seat: SeatId }
  | { type: "cardPlayed"; seat: SeatId; card: OperationCard }
  | {
      type: "unitsRemoved";
      seat: SeatId;
      area: string;
      unit: UnitType;
      count: number;
      siege?: number;
    }
  | { type: "areaCaptured"; seat: SeatId; area: string; previousOwner: SeatId | null }
  | {
      type: "capExceeded";
      area: string;
      unit: UnitType;
      returned: number;
      owner: SeatId;
      siege?: number;
    }
  | { type: "turnAdvanced"; activeSeat: SeatId }
  | { type: "recalled"; round: number; initiative: SeatId }
  | { type: "initiativeSeized"; seat: SeatId }
  | { type: "gameEnded"; winner: SeatId | null; reason: "hqEliminated" | "victoryPoints" };

export type CommandResult =
  | { status: "accepted"; nextState: GameState; events: GameEvent[] }
  | { status: "rejected"; reason: RejectionReason };
