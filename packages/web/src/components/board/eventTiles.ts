import type { PlayerGameEvent } from "@sengoku-jidai/engine/client";

/** The tile id(s) a single event touched, or [] for non-spatial events (dice, cards, pass,
 *  turn/round/initiative bookkeeping, game end). The switch is exhaustive over the event union
 *  so a future spatial event is a compile error to forget here. */
function tilesOf(event: PlayerGameEvent): string[] {
  switch (event.type) {
    case "commanderDeployed":
      return [event.spaceId];
    case "unitsMoved":
      return [event.from, event.to];
    case "unitsPlaced":
    case "bonusApplied":
    case "unitsRemoved":
    case "areaCaptured":
    case "capExceeded":
      return [event.area];
    case "passed":
    case "diceRolled":
    case "cardsDrawn":
    case "cardDiscarded":
    case "cardPlayed":
    case "turnAdvanced":
    case "recalled":
    case "initiativeSeized":
    case "gameEnded":
      return [];
  }
}

/** The de-duplicated, first-seen-ordered set of tile ids an event batch changed — the tiles to
 *  pulse when a poll picks up the opponent's turn. */
export function affectedTileIds(events: PlayerGameEvent[]): string[] {
  const seen = new Set<string>();
  for (const event of events) {
    for (const id of tilesOf(event)) {
      seen.add(id);
    }
  }
  return [...seen];
}
