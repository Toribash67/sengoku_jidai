import { z } from "zod";
import type { GameState } from "./state.js";

/**
 * Runtime shape validation for persisted v3 snapshots (ARCHITECTURE.md: "Persisted JSON
 * blobs should be validated when loaded from storage"). The schema constant is typed as
 * `z.ZodType<GameState>`, so a `GameState` field added or retyped without updating this
 * file fails compilation. Enum literals (cards, kinds, phases) are duplicated from their
 * type unions — the compiler catches typos and extras there, but not omissions.
 */

const seatIdSchema = z.enum(["red", "black"]);
const unitCountsSchema = z.object({
  troop: z.number().int(),
  ship: z.number().int(),
  siege: z.number().int()
});

const operationCardSchema = z.enum([
  "ambush",
  "commandeer",
  "counterattack",
  "ground_assault",
  "mobilise",
  "river_assault",
  "ship_strike",
  "shore_strike"
]);

const actionTypeSchema = z.enum([
  "advance",
  "sail",
  "bombard",
  "shell",
  "siege",
  "reinforce",
  "embark",
  "plan"
]);

const bonusTypeSchema = z.enum([
  "barracks",
  "warRoom",
  "pirateHaven",
  "shipyard",
  "hiddenBase",
  "armoury"
]);

const rulesConfigSchema = z.object({
  rulesetId: z.string(),
  rulesetVersion: z.string(),
  rulesetHash: z.string(),
  commandersPerPlayer: z.number().int(),
  maxRounds: z.number().int(),
  diceFaces: z.array(z.number()),
  enabledActions: z.array(actionTypeSchema),
  bonusSet: z.array(bonusTypeSchema),
  fortifications: z.boolean(),
  cards: z.boolean()
});

const pendingChoiceSchema = z.object({
  id: z.string(),
  label: z.string()
});

const pendingDecisionSchema = z.object({
  id: z.string(),
  seat: seatIdSchema,
  prompt: z.string(),
  choices: z.array(pendingChoiceSchema),
  kind: z.enum(["shipStrike", "selectCombat"]).optional(),
  spaceId: z.string().optional()
});

const pendingCombatSchema = z.object({
  id: z.string(),
  kind: z.enum(["advance", "sail", "bombard", "shell"]),
  attacker: seatIdSchema,
  defender: seatIdSchema,
  responsibleSeat: seatIdSchema,
  phase: z.enum(["awaiting-roll", "rolled"]),
  area: z.string(),
  spaceId: z.string().optional(),
  unit: z.enum(["troop", "ship"]),
  attackers: z.number().int().optional(),
  defenders: z.number().int().optional(),
  dice: z.number().int().optional(),
  rolls: z.array(z.number()).optional(),
  total: z.number().optional()
});

const playerStateSchema = z.object({
  seat: seatIdSchema,
  reserve: unitCountsSchema,
  commanders: z.object({
    total: z.number().int(),
    standby: z.number().int(),
    counterattacks: z.number().int()
  }),
  hand: z.array(operationCardSchema),
  passed: z.boolean()
});

const areaRuntimeSchema = z.object({
  owner: seatIdSchema.nullable(),
  units: unitCountsSchema
});

export const gameStateSchema: z.ZodType<GameState> = z.object({
  schemaVersion: z.literal(3),
  gameId: z.string(),
  mapId: z.string(),
  rules: rulesConfigSchema,
  mode: z.enum(["hotseat", "private_multiplayer", "async_multiplayer"]),
  status: z.enum(["setup", "active", "complete", "abandoned"]),

  round: z.number().int(),
  phase: z.enum(["deploy", "recall"]),
  initiative: seatIdSchema,
  activeSeat: seatIdSchema,

  rngState: z.string(),

  players: z.object({
    red: playerStateSchema,
    black: playerStateSchema
  }),
  deck: z.array(operationCardSchema),
  discard: z.array(operationCardSchema),
  areas: z.record(z.string(), areaRuntimeSchema),
  actionSpaces: z.record(z.string(), seatIdSchema.nullable()),
  bonuses: z.record(z.string(), bonusTypeSchema),

  revision: z.number().int(),

  pendingDecision: pendingDecisionSchema.nullable(),
  pendingCombat: pendingCombatSchema.nullable(),
  combatQueue: z.array(pendingCombatSchema),
  winner: seatIdSchema.nullable(),
  endReason: z.enum(["hqEliminated", "victoryPoints"]).nullable()
});
