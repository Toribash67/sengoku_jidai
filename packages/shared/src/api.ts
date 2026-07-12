import type { z } from "zod";
import type { commandSchema, gameModeSchema, hexMapSourceSchema, seatIdSchema } from "./schemas.js";

export type SeatId = z.infer<typeof seatIdSchema>;
export type GameMode = z.infer<typeof gameModeSchema>;
export type Command = z.infer<typeof commandSchema>;

export type SeatStatus = "open" | "claimed";

export interface GameSeatInfo {
  seat: SeatId;
  name: string | null;
  status: SeatStatus;
}

export interface PlayerGameViewEnvelope<View = unknown> {
  gameId: string;
  seat: SeatId;
  revision: number;
  view: View;
  seatInfo: GameSeatInfo[];
}

export interface SeatToken {
  seat: SeatId;
  token: string;
}

export interface CreateGameResponse<View = unknown> extends PlayerGameViewEnvelope<View> {
  seats: SeatToken[];
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

export type TerrainStatus = "none" | "pending" | "ready" | "failed";

export interface MapSummary {
  id: string;
  name: string;
  tileCount: number;
  builtin: boolean;
  /** ISO timestamp for library maps; null for built-ins (which live in code). */
  updatedAt: string | null;
}

export interface ListMapsResponse {
  maps: MapSummary[];
}

/** Max terrains a single map may hold (bounds fal cost + DB blob storage). Shared so the editor
 *  can disable "generate" at the cap using the same number the server enforces. */
export const MAX_TERRAINS_PER_MAP = 6;

/** One generated terrain belonging to a map. */
export interface TerrainInfo {
  id: string;
  name: string;
  styleId: TerrainStyleId;
  status: Exclude<TerrainStatus, "none">; // a stored terrain is always pending | ready | failed
  updatedAt: string;
}

export interface MapDetail {
  id: string;
  name: string;
  builtin: boolean;
  updatedAt: string | null;
  /** LEGACY: the primary (oldest) terrain's status, "none" if the map has no terrains. Kept for
   *  the current web app; removed in PR-C once the play view uses `terrains`. */
  terrain: TerrainStatus;
  /** All terrains for this map, oldest first. Empty for built-ins. */
  terrains: TerrainInfo[];
  source: z.infer<typeof hexMapSourceSchema>;
}

/** Selectable terrain generation styles (id + UI label). Single source of truth for the
 *  editor style dropdown (PR-B) and the generate API (PR-A). `antique` is the default. The
 *  terrain package maps each id to a committed profile JSON via `loadStyleProfile`. */
export const TERRAIN_STYLES = [
  { id: "antique", label: "Antique (colour)" },
  { id: "ink", label: "Ink (greyscale)" }
] as const;

export type TerrainStyleId = (typeof TERRAIN_STYLES)[number]["id"];

export const DEFAULT_TERRAIN_STYLE: TerrainStyleId = "antique";

export function isTerrainStyleId(value: string): value is TerrainStyleId {
  return TERRAIN_STYLES.some((s) => s.id === value);
}
