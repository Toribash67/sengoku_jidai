import type { PlayerGameEvent, SeatId } from "@sengoku-jidai/engine/client";
import { cardLabel } from "./cardImages.js";

/** Resolvers the event labeller needs from the view: a seat's player name and a tile's human
 *  area label. Injected so `describeEvent` stays pure and unit-testable without a map or DOM. */
export interface EventLookup {
  seatName: (seat: SeatId) => string;
  areaName: (tileId: string) => string;
}

/** A piece of a log line: plain text, or a player name to render in that seat's colour. */
export type LogPart = string | { seat: SeatId; text: string };

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

/** A human-readable description of an event for the game log, split into parts so player names
 *  (not seat colours) can be coloured by seat; areas use their labels (not raw tile ids). */
export function describeEventParts(
  event: PlayerGameEvent,
  { seatName, areaName }: EventLookup
): LogPart[] {
  const who = (seat: SeatId): LogPart => ({ seat, text: seatName(seat) });
  switch (event.type) {
    case "commanderDeployed":
      return [who(event.seat), ` deployed a commander to ${areaName(event.spaceId)}`];
    case "passed":
      return [who(event.seat), " passed"];
    case "unitsMoved":
      return [
        who(event.seat),
        ` moved ${plural(event.count, event.unit)} — ${areaName(event.from)} → ${areaName(
          event.to
        )}`
      ];
    case "unitsPlaced":
      return [
        who(event.seat),
        ` placed ${plural(event.count, event.unit)} on ${areaName(event.area)}`
      ];
    case "unitsRemoved":
      return [
        who(event.seat),
        ` lost ${plural(event.count, event.unit)} at ${areaName(event.area)}`
      ];
    case "bonusApplied":
      return [who(event.seat), ` used a bonus at ${areaName(event.area)}`];
    case "diceRolled":
      return [
        who(event.seat),
        ` rolled [${event.rolls.join(", ")}] = ${event.total} (${event.purpose}${
          event.fort ? " +fort" : ""
        })`
      ];
    case "cardsDrawn":
      return [who(event.seat), ` drew ${plural(event.count, "card")}`];
    case "cardDiscarded":
      return [who(event.seat), " discarded a card to reroll"];
    case "cardPlayed":
      return [who(event.seat), ` played ${cardLabel(event.card)}`];
    case "areaCaptured": {
      const base: LogPart[] = [who(event.seat), ` captured ${areaName(event.area)}`];
      return event.previousOwner ? [...base, " from ", who(event.previousOwner)] : base;
    }
    case "capExceeded":
      return [
        `${plural(event.returned, event.unit)} returned from ${areaName(event.area)} (over cap)`
      ];
    case "turnAdvanced":
      return [who(event.activeSeat), "'s turn"];
    case "recalled":
      return [`Round ${event.round} — `, who(event.initiative), " has initiative"];
    case "initiativeSeized":
      return [who(event.seat), " seized the initiative"];
    case "gameEnded":
      return event.winner ? [who(event.winner), " won the game"] : ["The game ended in a draw"];
  }
}

/** A one-line, plain-text description of an event (the parts joined). */
export function describeEvent(event: PlayerGameEvent, lookup: EventLookup): string {
  return describeEventParts(event, lookup)
    .map((part) => (typeof part === "string" ? part : part.text))
    .join("");
}

/** The seat an event belongs to (colours its log stripe), or null for neutral events. */
export function eventSeat(event: PlayerGameEvent): SeatId | null {
  switch (event.type) {
    case "turnAdvanced":
      return event.activeSeat;
    case "recalled":
      return event.initiative;
    case "gameEnded":
      return event.winner ?? null;
    case "capExceeded":
      return event.owner;
    default:
      return event.seat;
  }
}
