import type { OperationCard } from "@sengoku-jidai/engine/client";
import ambush from "../../assets/rivers/cards/ambush.webp";
import commandeer from "../../assets/rivers/cards/commandeer.webp";
import counterattack from "../../assets/rivers/cards/counterattack.webp";
import groundAssault from "../../assets/rivers/cards/ground_assault.webp";
import mobilise from "../../assets/rivers/cards/mobilise.webp";
import riverAssault from "../../assets/rivers/cards/river_assault.webp";
import shipStrike from "../../assets/rivers/cards/ship_strike.webp";
import shoreStrike from "../../assets/rivers/cards/shore_strike.webp";
import riversBackUrl from "../../assets/rivers/cards/rivers_back.webp";
import siegeAssault from "../../assets/fortress/cards/siege_assault.webp";
import takeCover from "../../assets/fortress/cards/take_cover.webp";
import volley from "../../assets/fortress/cards/volley.webp";
import fortressBackUrl from "../../assets/fortress/cards/fortress_back.webp";

/**
 * Card-face artwork URL by card id. These are web-sized WebP copies (1000px wide, ≈0.5MB) of
 * the full-resolution scans in `assets/maps/<deck>/cards/` — regenerate them with:
 *   pnpm dlx sharp-cli --input "assets/maps/rivers/cards/*.png" \
 *     --output packages/web/src/assets/rivers/cards --format webp resize 1000
 * (and likewise for `fortress`). The Fortress deck's six shared kinds are byte-identical scans
 * of the Rivers ones, so only its three new faces and its back are copied to `fortress/`.
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
  shore_strike: shoreStrike,
  siege_assault: siegeAssault,
  take_cover: takeCover,
  volley
};

export function cardImage(card: OperationCard): string {
  return CARD_IMAGE[card];
}

/** The face-down back for a game's deck (by `rulesetId`), used for opponent (hidden) cards. */
export function cardBackFor(rulesetId: string): string {
  return rulesetId === "fortress" ? fortressBackUrl : riversBackUrl;
}

/** Human label for a card id (e.g. "ground_assault" -> "Ground Assault"). */
export function cardLabel(card: OperationCard): string {
  return card
    .split("_")
    .map((w) => w[0]!.toUpperCase() + w.slice(1))
    .join(" ");
}
