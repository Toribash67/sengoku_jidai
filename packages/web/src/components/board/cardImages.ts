import type { OperationCard } from "@sengoku-jidai/engine";
import ambush from "../../../../../cards/rivers/ambush.png?url";
import commandeer from "../../../../../cards/rivers/commandeer.png?url";
import counterattack from "../../../../../cards/rivers/counterattack.png?url";
import groundAssault from "../../../../../cards/rivers/ground_assault.png?url";
import mobilise from "../../../../../cards/rivers/mobilise.png?url";
import riverAssault from "../../../../../cards/rivers/river_assault.png?url";
import shipStrike from "../../../../../cards/rivers/ship_strike.png?url";
import shoreStrike from "../../../../../cards/rivers/shore_strike.png?url";
import cardBackUrl from "../../../../../cards/rivers/rivers_back.png?url";

/** Card-face artwork URL by card id. Vite emits each PNG to dist and the browser fetches it
 *  only when the <img> renders, so the JS bundle stays small. */
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
