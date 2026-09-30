import type { PlayerGameEvent, SeatId } from "@sengoku-jidai/engine/client";

function who(seat: SeatId, viewer: SeatId): string {
  return `${seat} (${seat === viewer ? "you" : "opponent"})`;
}

function units(count: number, unit: string): string {
  return `${count} ${unit}${count === 1 ? "" : "s"}`;
}

/** One human-readable line per engine event. */
export function formatEvent(event: PlayerGameEvent, viewer: SeatId): string {
  switch (event.type) {
    case "commanderDeployed":
      return `${who(event.seat, viewer)} deployed a commander to ${event.spaceId}`;
    case "passed":
      return `${who(event.seat, viewer)} passed`;
    case "unitsMoved":
      return `${who(event.seat, viewer)} moved ${units(event.count, event.unit)} ${event.from} → ${event.to}`;
    case "unitsPlaced":
      return `${who(event.seat, viewer)} placed ${units(event.count, event.unit)} in ${event.area}`;
    case "bonusApplied":
      return `${who(event.seat, viewer)} got the ${event.bonus} bonus at ${event.area}`;
    case "diceRolled":
      return `${who(event.seat, viewer)} rolled ${event.purpose}: ${event.rolls.join(", ")} = ${event.total}${event.fort ? " (fort)" : ""}`;
    case "cardsDrawn":
      return `${who(event.seat, viewer)} drew ${event.count} card${event.count === 1 ? "" : "s"}`;
    case "cardDiscarded":
      return `${who(event.seat, viewer)} discarded a card`;
    case "cardPlayed":
      return `${who(event.seat, viewer)} played ${event.card}`;
    case "unitsRemoved":
      return `${who(event.seat, viewer)} lost ${units(event.count, event.unit)} in ${event.area}`;
    case "areaCaptured":
      return `${who(event.seat, viewer)} captured ${event.area}${event.previousOwner ? ` from ${event.previousOwner}` : ""}`;
    case "capExceeded":
      return `${event.owner}: ${units(event.returned, event.unit)} over the cap in ${event.area} returned to reserve`;
    case "turnAdvanced":
      return `— ${event.activeSeat}${event.activeSeat === viewer ? " (you)" : " (opponent)"} to act —`;
    case "recalled":
      return `=== Recall: round ${event.round} begins, initiative ${event.initiative} ===`;
    case "initiativeSeized":
      return `${who(event.seat, viewer)} seized initiative for next round`;
    case "gameEnded":
      return `GAME ENDED — winner: ${event.winner ?? "none"} (${event.reason})`;
    default: {
      const unknown = event as { type: string };
      return `${unknown.type} ${JSON.stringify(unknown)}`;
    }
  }
}
