import { createPlaceholderAreas, placeholderMapId } from "./maps/placeholderMap.js";
import type { GameMode, GameState, RulesConfig, SeatId } from "./types.js";

export interface CreateGameOptions {
  gameId: string;
  mode: GameMode;
  seed?: string;
  mapId?: string;
  rules?: Partial<RulesConfig>;
}

export const defaultRulesConfig: RulesConfig = {
  rulesetId: "general-orders-sengoku-jidai",
  rulesetVersion: "0.1.0-placeholder",
  rulesetHash: "placeholder"
};

export function createGame(options: CreateGameOptions): GameState {
  const rules = { ...defaultRulesConfig, ...options.rules };

  return {
    schemaVersion: 1,
    gameId: options.gameId,
    mode: options.mode,
    mapId: options.mapId ?? placeholderMapId,
    rules,
    status: "active",
    revision: 0,
    round: 1,
    activeSeat: "red",
    rngState: options.seed ?? "seed:0",
    players: {
      red: createPlayer("red"),
      black: createPlayer("black")
    },
    areas: createPlaceholderAreas(),
    pendingDecision: null
  };
}

function createPlayer(seat: SeatId) {
  return {
    id: seat,
    seat,
    honor: 0
  };
}
