/**
 * Client-safe engine surface, published as `@sengoku-jidai/engine/client`.
 *
 * The web package must import the engine ONLY through this module (enforced by
 * ESLint). Everything here operates on `PlayerGameView` or static map/card data —
 * nothing exposes authoritative `GameState`, the RNG, deck order, or command
 * resolution. Server-side code keeps using the root `@sengoku-jidai/engine` export.
 */

// Static map data and geometry (topology and layout are public to both seats).
export { getMap, listMaps, registerMap } from "./maps/registry.js";
export { riversMap, riversMapId } from "./maps/riversMap.js";
export type { AreaKind, MapArea, MapDefinition, StartingUnits } from "./maps/riversMap.js";
export { riversSource } from "./maps/riversSource.js";
export { compileHexMap } from "./maps/hex/compile.js";
export type { CompiledMap, MapLayout } from "./maps/hex/compile.js";
export type { HexMapSource } from "./maps/hex/source.js";
export { validateHexMap } from "./maps/hex/validate.js";
export {
  axialKey,
  axialToPixel,
  neighbors,
  NEIGHBOR_DIRS,
  pixelToAxial
} from "./maps/hex/coords.js";
export type { Axial, HexLayout, Pixel } from "./maps/hex/coords.js";
export type { HexTileSource } from "./maps/hex/source.js";
export { riversRuleset } from "./rules.js";

// The public card list (identities in hands and the deck stay hidden; the set of
// cards that exists is open information).
export { RIVERS_CARDS, RIVERS_CARD_COPIES, RIVERS_DECK } from "./cards.js";

// Player intent and the per-seat projections the server sends to clients.
export type { Command } from "./commands.js";
export type { GameMode, GameStatus, PlayerId, SeatId } from "./types.js";
export type { ActionType, BonusType } from "./rules.js";
export type {
  EndReason,
  OperationCard,
  PendingChoice,
  PendingCombat,
  PendingDecision,
  Phase,
  UnitCounts,
  UnitType
} from "./state.js";
export type {
  LegalCardPlay,
  LegalCommandSummary,
  LegalMove,
  LegalPlacement,
  LegalPlan,
  LegalSpace,
  LegalStrike,
  PlayerAreaView,
  PlayerGameEvent,
  PlayerGameView
} from "./view.js";
