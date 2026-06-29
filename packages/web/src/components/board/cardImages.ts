import type { OperationCard } from "@sengoku-jidai/engine";
import ambush from "../../assets/rivers/cards/ambush.webp";
import commandeer from "../../assets/rivers/cards/commandeer.webp";
import counterattack from "../../assets/rivers/cards/counterattack.webp";
import groundAssault from "../../assets/rivers/cards/ground_assault.webp";
import mobilise from "../../assets/rivers/cards/mobilise.webp";
import riverAssault from "../../assets/rivers/cards/river_assault.webp";
import shipStrike from "../../assets/rivers/cards/ship_strike.webp";
import shoreStrike from "../../assets/rivers/cards/shore_strike.webp";
import cardBackUrl from "../../assets/rivers/cards/rivers_back.webp";

/**
 * Card-face artwork URL by card id. These are web-sized WebP copies (1000px wide, ≈0.5MB) of
 * the full-resolution scans in `assets/maps/rivers/cards/` — regenerate the fronts with:
 *   pnpm dlx sharp-cli --input "assets/maps/rivers/cards/*.png" \
 *     --output packages/web/src/assets/rivers/cards --format webp resize 1000
 * The back scan is landscape, so rotate it upright first (two passes — rotate then resize):
 *   pnpm dlx sharp-cli --input assets/maps/rivers/cards/rivers_back.png --output <tmp> --format png rotate 270
 *   pnpm dlx sharp-cli --input <tmp>/rivers_back.png \
 *     --output packages/web/src/assets/rivers/cards --format webp resize 1000
 * Vite emits each to dist and the browser fetches it only when the <img> renders.
 */
const CARD_IMAGE: Record<OperationCard, string> = {
  ambush,
  commandeer,
  counterattack,
  ground_assault: groundAssault,
  mobilise,
  river_assault: riverAssault,
  ship_strike: shipStrike,
  shore_strike: shoreStrike
};

export function cardImage(card: OperationCard): string {
  return CARD_IMAGE[card];
}

/** Shared face-down back, used for opponent (hidden) cards. */
export const cardBack = cardBackUrl;

/** Human label for a card id (e.g. "ground_assault" -> "Ground Assault"). */
export function cardLabel(card: OperationCard): string {
  return card
    .split("_")
    .map((w) => w[0]!.toUpperCase() + w.slice(1))
    .join(" ");
}
