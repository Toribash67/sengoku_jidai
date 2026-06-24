import type { SeatId } from "./types.js";
import type { GameState, OperationCard, PendingChoice, UnitType } from "./state.js";
import type { BonusType } from "./rules.js";

/** Who is issuing the command. */
export interface CommandActor {
  seat: SeatId;
}

export type Move = { from: string; count: number };
export type Placement = { area: string; count: number };

export type Command =
  | { type: "advance"; spaceId: string; moves: Move[] }
  | { type: "sail"; spaceId: string; moves: Move[] }
  | { type: "bombard"; spaceId: string; targetAreaId: string }
  | { type: "shell"; spaceId: string; targetAreaId: string }
  | { type: "reinforce"; spaceId: string; placements: Placement[] }
  | { type: "embark"; spaceId: string; placements: Placement[] }
  | { type: "plan"; spaceId: string }
  | { type: "pass" }
  | { type: "combatRoll"; pendingId: string }
  | { type: "combatReroll"; pendingId: string; card: OperationCard }
  | { type: "combatResolve"; pendingId: string }
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
  | { type: "unitsMoved"; seat: SeatId; from: string; to: string; unit: UnitType; count: number }
  | { type: "unitsPlaced"; seat: SeatId; area: string; unit: UnitType; count: number }
  | { type: "bonusApplied"; seat: SeatId; bonus: BonusType; area: string }
  | { type: "diceRolled"; seat: SeatId; purpose: string; rolls: number[]; total: number }
  | { type: "cardsDrawn"; seat: SeatId; count: number }
  | { type: "cardDiscarded"; seat: SeatId }
  | { type: "unitsRemoved"; seat: SeatId; area: string; unit: UnitType; count: number }
  | { type: "areaCaptured"; seat: SeatId; area: string; previousOwner: SeatId | null }
  | { type: "capExceeded"; area: string; unit: UnitType; returned: number; owner: SeatId }
  | { type: "turnAdvanced"; activeSeat: SeatId }
  | { type: "recalled"; round: number; initiative: SeatId }
  | { type: "initiativeSeized"; seat: SeatId }
  | { type: "gameEnded"; winner: SeatId | null; reason: "hqEliminated" | "victoryPoints" };

export type CommandResult =
  | { status: "accepted"; nextState: GameState; events: GameEvent[] }
  | { status: "rejected"; reason: RejectionReason };
