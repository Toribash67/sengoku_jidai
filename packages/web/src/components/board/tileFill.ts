import type { PlayerAreaView, SeatId } from "@sengoku-jidai/engine";

/** Default tile colours for unowned areas, matching the original artwork palette. */
export const TILE_LAND_FILL = "#d5d3c4";
export const TILE_SEA_FILL = "#8cb2f2";

/** Solid fill for an area both controlled and in supply by the seat. */
export const SEAT_SOLID: Record<SeatId, string> = {
  red: "#c0392b",
  black: "#2f343c"
};

type TileFillInput = Pick<PlayerAreaView, "kind" | "owner" | "suppliedBy">;

/**
 * Fill string for a tile given its control and supply:
 * - controlled + supplied  -> solid seat colour
 * - controlled, not supplied -> striped seat pattern (`url(#stripe-<seat>)`)
 * - unowned -> kind default (land/sea)
 */
export function tileFill({ kind, owner, suppliedBy }: TileFillInput): string {
  if (owner === null) {
    return kind === "sea" ? TILE_SEA_FILL : TILE_LAND_FILL;
  }
  if (suppliedBy === owner) {
    return SEAT_SOLID[owner];
  }
  return `url(#stripe-${owner})`;
}
