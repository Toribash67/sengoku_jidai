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
