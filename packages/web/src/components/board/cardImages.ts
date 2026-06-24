import type { OperationCard } from "@sengoku-jidai/engine";
import ambush from "../../assets/cards/ambush.webp";
import commandeer from "../../assets/cards/commandeer.webp";
import counterattack from "../../assets/cards/counterattack.webp";
import groundAssault from "../../assets/cards/ground_assault.webp";
import mobilise from "../../assets/cards/mobilise.webp";
import riverAssault from "../../assets/cards/river_assault.webp";
import shipStrike from "../../assets/cards/ship_strike.webp";
import shoreStrike from "../../assets/cards/shore_strike.webp";
import cardBackUrl from "../../assets/cards/rivers_back.webp";

/**
 * Card-face artwork URL by card id. These are web-sized WebP copies (≈110KB, 500px wide) of
 * the full-resolution scans in `cards/rivers/` — regenerate with:
 *   pnpm dlx sharp-cli --input "cards/rivers/*.png" \
 *     --output packages/web/src/assets/cards --format webp resize 500
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
