export * from "./types.js";
export * from "./setup.js";
export * from "./resolveCommand.js";
export * from "./validateCommand.js";
export * from "./view.js";
export * from "./serialization.js";
export * from "./maps/riversMap.js";
export * from "./maps/registry.js";
export * from "./rng.js";
export * from "./supply.js";
export * from "./scoring.js";
// rules.js re-exported explicitly: its `RulesConfig` would otherwise clash (TS2308)
// with the placeholder `RulesConfig` still exported from types.js. Plan 2 deletes
// the placeholder and switches this to `export * from "./rules.js"`.
export { riversRuleset } from "./rules.js";
export type { ActionType, BonusType } from "./rules.js";

// Plan 2 — schemaVersion-2 model and setup. Exported explicitly to avoid clashing
// with the placeholder `GameState`/`PlayerState`/`createGame` still exported above.
// GameState/PlayerState from state.js are intentionally NOT re-exported yet; Plan 3
// deletes the placeholder and promotes the v2 model to the public surface.
export { createInitialState } from "./game.js";
export type { GameSetupOptions } from "./game.js";
export { zeroUnits, RIVERS_UNIT_POOL, HQ_STARTING_TROOPS } from "./state.js";
export type {
  UnitType,
  UnitCounts,
  Phase,
  EndReason,
  AreaRuntime,
  OperationCard
} from "./state.js";
