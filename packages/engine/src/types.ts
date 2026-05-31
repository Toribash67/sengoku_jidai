export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

export type SeatId = "red" | "black";
export type PlayerId = SeatId;
export type GameMode = "hotseat" | "private_multiplayer" | "async_multiplayer";
export type GameStatus = "setup" | "active" | "complete" | "abandoned";

export interface RulesConfig {
  rulesetId: string;
  rulesetVersion: string;
  rulesetHash: string;
}

export interface AreaState {
  id: string;
  name: string;
  controller: SeatId | null;
  commander: SeatId | null;
  strength: number;
  adjacent: string[];
}

export interface PlayerState {
  id: PlayerId;
  seat: SeatId;
  honor: number;
}

export interface PendingDecision {
  id: string;
  seat: SeatId;
  prompt: string;
  choices: PendingChoice[];
}

export interface PendingChoice {
  id: string;
  label: string;
}

export interface GameState {
  schemaVersion: 1;
  gameId: string;
  mode: GameMode;
  mapId: string;
  rules: RulesConfig;
  status: GameStatus;
  revision: number;
  round: number;
  activeSeat: SeatId;
  rngState: string;
  players: Record<SeatId, PlayerState>;
  areas: Record<string, AreaState>;
  pendingDecision: PendingDecision | null;
}

export interface CommandActor {
  seat: SeatId;
  playerId: PlayerId;
}

export type Command =
  | { type: "claimArea"; areaId: string }
  | { type: "choosePendingDecision"; pendingId: string; choice: PendingChoice };

export type RejectionReason =
  | { code: "notActiveSeat"; message: string }
  | { code: "areaNotFound"; message: string }
  | { code: "pendingDecisionRequired"; message: string }
  | { code: "pendingDecisionNotFound"; message: string }
  | { code: "illegalChoice"; message: string };

export type GameEvent =
  | {
      type: "areaClaimed";
      seat: SeatId;
      areaId: string;
      previousController: SeatId | null;
      nextController: SeatId;
    }
  | {
      type: "pendingDecisionChosen";
      seat: SeatId;
      pendingId: string;
      choiceId: string;
    };

export type PlayerGameEvent = GameEvent;

export interface LegalCommandSummary {
  activeSeat: SeatId;
  commands: Command[];
}

export interface PlayerAreaView {
  id: string;
  name: string;
  controller: SeatId | null;
  commander: SeatId | null;
  strength: number;
  adjacent: string[];
}

export interface PlayerGameView {
  schemaVersion: 1;
  gameId: string;
  mapId: string;
  mode: GameMode;
  status: GameStatus;
  round: number;
  activeSeat: SeatId;
  viewerSeat: SeatId;
  prompt: string;
  areas: PlayerAreaView[];
  pendingDecision: PendingDecision | null;
  legal: LegalCommandSummary;
}

export interface SpectatorGameView extends Omit<PlayerGameView, "viewerSeat"> {
  viewerSeat: "spectator";
}

export type JsonGameState = GameState;

export type CommandResult =
  | {
      status: "accepted";
      nextState: GameState;
      events: GameEvent[];
    }
  | {
      status: "rejected";
      reason: RejectionReason;
      events?: GameEvent[];
    };
