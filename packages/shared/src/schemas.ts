import { z } from "zod";

export const seatIdSchema = z.enum(["red", "black"]);
export const gameModeSchema = z.enum(["hotseat", "private_multiplayer", "async_multiplayer"]);

/** The Rivers operation-card ids (must match the engine's OperationCard union). */
export const operationCardSchema = z.enum([
  "ambush",
  "commandeer",
  "counterattack",
  "ground_assault",
  "mobilise",
  "river_assault",
  "ship_strike",
  "shore_strike"
]);

export const pendingChoiceSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1)
});

const moveSchema = z.object({
  from: z.string().min(1),
  count: z.number().int().positive()
});

const placementSchema = z.object({
  area: z.string().min(1),
  count: z.number().int().positive()
});

/** Optional operation card played as a commander deploys (modifies the action, then discarded). */
const cardBonusSchema = z.number().int().min(0).max(2);

export const commandSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("advance"),
    spaceId: z.string().min(1),
    moves: z.array(moveSchema),
    card: operationCardSchema.optional(),
    cardBonus: cardBonusSchema.optional()
  }),
  z.object({
    type: z.literal("sail"),
    spaceId: z.string().min(1),
    moves: z.array(moveSchema),
    card: operationCardSchema.optional(),
    cardBonus: cardBonusSchema.optional()
  }),
  z.object({
    type: z.literal("bombard"),
    spaceId: z.string().min(1),
    targetAreaId: z.string().min(1),
    card: operationCardSchema.optional()
  }),
  z.object({
    type: z.literal("shell"),
    spaceId: z.string().min(1),
    targetAreaId: z.string().min(1)
  }),
  z.object({
    type: z.literal("reinforce"),
    spaceId: z.string().min(1),
    placements: z.array(placementSchema),
    card: operationCardSchema.optional()
  }),
  z.object({
    type: z.literal("embark"),
    spaceId: z.string().min(1),
    placements: z.array(placementSchema),
    card: operationCardSchema.optional()
  }),
  z.object({ type: z.literal("plan"), spaceId: z.string().min(1) }),
  z.object({ type: z.literal("pass") }),
  z.object({
    type: z.literal("combatRoll"),
    pendingId: z.string().min(1),
    card: operationCardSchema.optional()
  }),
  z.object({
    type: z.literal("combatReroll"),
    pendingId: z.string().min(1),
    card: operationCardSchema
  }),
  z.object({ type: z.literal("combatResolve"), pendingId: z.string().min(1) }),
  z.object({
    type: z.literal("choosePendingDecision"),
    pendingId: z.string().min(1),
    choice: pendingChoiceSchema
  })
]);

/** Axial hex coordinate (mirrors engine `Axial`). */
export const axialSchema = z.object({ q: z.number().int(), r: z.number().int() });

/** Flat-top hex layout (mirrors engine `HexLayout`). */
export const hexLayoutSchema = z.object({
  size: z.number().positive(),
  originX: z.number(),
  originY: z.number()
});

export const hexTileFeaturesSchema = z.object({
  hq: seatIdSchema.optional(),
  valueStars: z.union([z.literal(0), z.literal(1), z.literal(2)]).optional(),
  harbor: z.boolean().optional(),
  shellable: z.boolean().optional(),
  fort: z.boolean().optional()
});

export const hexTileSourceSchema = z.object({
  id: z.string().min(1),
  kind: z.enum(["land", "sea"]),
  hexes: z.array(axialSchema).min(1),
  features: hexTileFeaturesSchema
});

export const startingUnitsSchema = z.object({
  seat: seatIdSchema,
  troop: z.number().int().nonnegative().optional(),
  ship: z.number().int().nonnegative().optional()
});

/**
 * Wire mirror of the engine's `HexMapSource` (packages/engine/src/maps/hex/source.ts).
 * Must match that interface exactly; the server carries a compile-time drift guard
 * (see packages/server/src/maps/library.ts).
 */
export const hexMapSourceSchema = z.object({
  id: z.string().min(1),
  name: z.string().trim().min(1).max(120),
  layout: hexLayoutSchema,
  tiles: z.array(hexTileSourceSchema).min(1),
  startingDeployment: z.record(startingUnitsSchema),
  bonusSlots: z.array(z.string().min(1)),
  commandersPerRound: z.number().int().min(1).max(8).optional()
});

export const mapParamsSchema = z.object({
  mapId: z.string().min(1)
});

export const createGameRequestSchema = z.object({
  mode: gameModeSchema.default("hotseat"),
  seed: z.string().optional(),
  name: z.string().trim().min(1).max(80).optional(),
  side: seatIdSchema.optional(),
  mapId: z.string().min(1).optional()
});

export const claimGameRequestSchema = z.object({
  name: z.string().trim().min(1).max(80)
});

export const submitCommandRequestSchema = z.object({
  baseRevision: z.number().int().nonnegative(),
  clientCommandId: z.string().min(1).max(120),
  command: commandSchema
});

export const eventQuerySchema = z.object({
  after: z.coerce.number().int().nonnegative().default(0)
});

export const gameParamsSchema = z.object({
  gameId: z.string().min(1)
});

export const authHeaderSchema = z.object({
  authorization: z.string().optional()
});

export type SeatIdDto = z.infer<typeof seatIdSchema>;
export type GameModeDto = z.infer<typeof gameModeSchema>;
export type CommandDto = z.infer<typeof commandSchema>;
export type CreateGameRequest = z.infer<typeof createGameRequestSchema>;
export type SubmitCommandRequest = z.infer<typeof submitCommandRequestSchema>;
export type ClaimGameRequest = z.infer<typeof claimGameRequestSchema>;
export type HexMapSourceDto = z.infer<typeof hexMapSourceSchema>;
