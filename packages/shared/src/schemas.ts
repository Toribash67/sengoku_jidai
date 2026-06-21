import { z } from "zod";

export const seatIdSchema = z.enum(["red", "black"]);
export const gameModeSchema = z.enum(["hotseat", "private_multiplayer", "async_multiplayer"]);

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

export const commandSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("advance"), spaceId: z.string().min(1), moves: z.array(moveSchema) }),
  z.object({ type: z.literal("sail"), spaceId: z.string().min(1), moves: z.array(moveSchema) }),
  z.object({
    type: z.literal("bombard"),
    spaceId: z.string().min(1),
    targetAreaId: z.string().min(1)
  }),
  z.object({
    type: z.literal("shell"),
    spaceId: z.string().min(1),
    targetAreaId: z.string().min(1)
  }),
  z.object({
    type: z.literal("reinforce"),
    spaceId: z.string().min(1),
    placements: z.array(placementSchema)
  }),
  z.object({
    type: z.literal("embark"),
    spaceId: z.string().min(1),
    placements: z.array(placementSchema)
  }),
  z.object({ type: z.literal("plan"), spaceId: z.string().min(1) }),
  z.object({ type: z.literal("pass") }),
  z.object({
    type: z.literal("choosePendingDecision"),
    pendingId: z.string().min(1),
    choice: pendingChoiceSchema
  })
]);

export const createGameRequestSchema = z.object({
  mode: gameModeSchema.default("hotseat"),
  seed: z.string().optional()
});

export const joinGameRequestSchema = z.object({
  seat: seatIdSchema.optional(),
  displayName: z.string().trim().min(1).max(80).optional()
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
export type JoinGameRequest = z.infer<typeof joinGameRequestSchema>;
export type SubmitCommandRequest = z.infer<typeof submitCommandRequestSchema>;
