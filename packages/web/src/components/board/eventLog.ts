import type { PlayerGameEvent, SeatId } from "@sengoku-jidai/engine/client";
import { cardLabel } from "./cardImages.js";

/** Resolvers the event labeller needs from the view: a seat's player name and a tile's human
 *  area label. Injected so `describeEvent` stays pure and unit-testable without a map or DOM. */
export interface EventLookup {
  seatName: (seat: SeatId) => string;
  areaName: (tileId: string) => string;
}

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

/** A one-line, human-readable description of an event for the "Recent events" log: player names
 *  (not seat colours) and area labels (not raw tile ids). */
export function describeEvent(event: PlayerGameEvent, { seatName, areaName }: EventLookup): string {
  switch (event.type) {
    case "commanderDeployed":
      return `${seatName(event.seat)} deployed a commander to ${areaName(event.spaceId)}`;
    case "passed":
      return `${seatName(event.seat)} passed`;
    case "unitsMoved":
      return `${seatName(event.seat)} moved ${plural(event.count, event.unit)} — ${areaName(
        event.from
      )} → ${areaName(event.to)}`;
    case "unitsPlaced":
      return `${seatName(event.seat)} placed ${plural(event.count, event.unit)} on ${areaName(
        event.area
      )}`;
    case "unitsRemoved":
      return `${seatName(event.seat)} lost ${plural(event.count, event.unit)} at ${areaName(
        event.area
      )}`;
    case "bonusApplied":
      return `${seatName(event.seat)} used a bonus at ${areaName(event.area)}`;
    case "diceRolled":
      return `${seatName(event.seat)} rolled [${event.rolls.join(", ")}] = ${event.total} (${
        event.purpose
      })`;
    case "cardsDrawn":
      return `${seatName(event.seat)} drew ${plural(event.count, "card")}`;
    case "cardDiscarded":
      return `${seatName(event.seat)} discarded a card to reroll`;
    case "cardPlayed":
      return `${seatName(event.seat)} played ${cardLabel(event.card)}`;
    case "areaCaptured": {
      const base = `${seatName(event.seat)} captured ${areaName(event.area)}`;
      return event.previousOwner ? `${base} from ${seatName(event.previousOwner)}` : base;
    }
    case "capExceeded":
      return `${plural(event.returned, event.unit)} returned from ${areaName(event.area)} (over cap)`;
    case "turnAdvanced":
      return `${seatName(event.activeSeat)}'s turn`;
    case "recalled":
      return `Round ${event.round} — ${seatName(event.initiative)} has initiative`;
    case "initiativeSeized":
      return `${seatName(event.seat)} seized the initiative`;
    case "gameEnded":
      return event.winner ? `${seatName(event.winner)} won the game` : "The game ended in a draw";
  }
}
