import type { z } from "zod";
import type { commandSchema, gameModeSchema, seatIdSchema } from "./schemas.js";

export type SeatId = z.infer<typeof seatIdSchema>;
export type GameMode = z.infer<typeof gameModeSchema>;
export type Command = z.infer<typeof commandSchema>;

export interface PlayerGameViewEnvelope<View = unknown> {
  gameId: string;
  seat: SeatId;
  revision: number;
  view: View;
}

export interface SeatToken {
  seat: SeatId;
  token: string;
}

export interface CreateGameResponse<View = unknown> extends PlayerGameViewEnvelope<View> {
  seats: SeatToken[];
}

export interface JoinGameResponse<View = unknown> extends PlayerGameViewEnvelope<View> {
  token: string;
}

export interface SubmitCommandResponse<View = unknown, Event = unknown> {
  accepted: boolean;
  revision: number;
  view?: View;
  events?: Event[];
  error?: ApiErrorBody["error"];
}

export interface ApiErrorBody {
  error: {
    code: string;
    message: string;
    requestId: string;
  };
}

export type ServerMessage<View = unknown, Event = unknown> =
  | { type: "view"; gameId: string; revision: number; view: View }
  | { type: "events"; gameId: string; fromRevision: number; toRevision: number; events: Event[] }
  | { type: "commandRejected"; gameId: string; reason: string; latestRevision: number }
  | { type: "presence"; gameId: string; players: PresenceState[] };

export interface PresenceState {
  seat: SeatId;
  connected: boolean;
}
