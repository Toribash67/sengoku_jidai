import type {
  MapDefinition,
  OperationCard,
  PlayerAreaView,
  PlayerGameView,
  SeatId,
  UnitCounts
} from "@sengoku-jidai/engine/client";
import { formatOrder, type Order } from "./orders.js";

/** One-line effect of each operation card. Any card may also be discarded to reroll combat dice. */
export const CARD_TEXT: Record<OperationCard, string> = {
  ambush: "when defending a land Advance, discard before the roll for +2 defence dice",
  commandeer: "Embark with +1 ship and may land ships in enemy-held seas (sea battles follow)",
  counterattack: "Advance via an Advance space the opponent's commander already holds",
  ground_assault: "Advance, and up to 2 reserve troops join the move-in",
  mobilise: "Reinforce with +2 to the space's pool",
  river_assault: "Sail, and up to 2 reserve ships join the move-in",
  ship_strike: "after your Shell resolves, you may take a second Shell from the same space",
  shore_strike: "Bombard with +2 dice"
};

function seatLabel(seat: SeatId, viewer: SeatId): string {
  return seat === viewer ? "you" : `opponent (${seat})`;
}

function unitText(u: UnitCounts): string {
  const parts: string[] = [];
  if (u.troop) parts.push(`${u.troop} troop${u.troop === 1 ? "" : "s"}`);
  if (u.ship) parts.push(`${u.ship} ship${u.ship === 1 ? "" : "s"}`);
  if (u.siege) parts.push(`${u.siege} siege`);
  return parts.length ? parts.join(" ") : "empty";
}

function areaLine(area: PlayerAreaView, view: PlayerGameView, map: MapDefinition): string {
  const def = map.areas[area.id];
  const tags = [area.id, area.kind];
  if (area.valueStars) tags.push(`★${area.valueStars}`);
  if (def?.hq) tags.push(`HQ:${def.hq}`);
  if (def?.fort) tags.push("fort");
  if (def?.harbor) tags.push("harbor");
  const bonus = view.bonuses[area.id];
  if (bonus) tags.push(`bonus:${bonus}`);
  return [
    tags.join(" "),
    area.owner ? `${area.owner}${area.owner === view.viewerSeat ? " (you)" : ""}` : "neutral",
    unitText(area.units),
    `supply: ${area.suppliedBy ?? "-"}`,
    `adj: ${(def?.adjacent ?? []).join(", ")}`
  ].join(" | ");
}

/** Who has to act now: a combat roller or decision seat outranks the turn holder (web: onClockSeat). */
export function clockSeat(view: PlayerGameView): SeatId {
  return view.pendingCombat?.responsibleSeat ?? view.pendingDecision?.seat ?? view.activeSeat;
}

export function gameOverLine(view: PlayerGameView): string {
  return `GAME OVER — winner: ${view.winner ?? "none"} (${view.endReason ?? "?"}) — VP red ${view.victoryPoints.red} · black ${view.victoryPoints.black}`;
}

/** The whole position as compact text, ending with the numbered orders. */
export function renderBoard(view: PlayerGameView, map: MapDefinition, orders: Order[]): string {
  const me = view.viewerSeat;
  const other: SeatId = me === "red" ? "black" : "red";
  const out: string[] = [];

  out.push(
    `You are ${me.toUpperCase()}. Round ${view.round}/${view.maxRounds} · ${view.phase} phase · initiative: ${seatLabel(view.initiative, me)} · On the clock: ${seatLabel(clockSeat(view), me)}`
  );
  out.push(`VP: red ${view.victoryPoints.red} · black ${view.victoryPoints.black}`);
  out.push(
    `Commanders left: you ${view.commandersRemaining[me]}/${view.commandersTotal[me]} · opponent ${view.commandersRemaining[other]}/${view.commandersTotal[other]}`
  );
  out.push(
    view.hand.length
      ? `Your hand:\n${view.hand.map((c) => `  - ${c} — ${CARD_TEXT[c]}`).join("\n")}`
      : "Your hand: (empty)"
  );
  out.push(`Opponent hand: ${view.opponentHandCount} card(s)`);
  out.push("");
  out.push("Areas (id kind [★stars HQ fort harbor bonus] | owner | units | supply | adjacent):");
  for (const kind of ["land", "sea"] as const) {
    for (const area of view.areas.filter((a) => a.kind === kind))
      out.push(areaLine(area, view, map));
  }

  const combats = [view.pendingCombat, ...view.combatQueue].filter((c) => c !== null);
  if (combats.length) {
    out.push("");
    for (const c of combats) {
      const dice =
        c.phase === "rolled" ? `rolled ${c.rolls?.join(", ")} = ${c.total}` : "dice not yet rolled";
      const sides =
        c.attackers !== undefined
          ? ` — ${c.attackers} attacking vs ${c.defenders ?? 0} defending`
          : "";
      out.push(
        `Combat (${c.kind}) at ${c.area}: ${c.attacker} attacks ${c.defender}${sides}; ${seatLabel(c.responsibleSeat, me)} rolls; ${dice}`
      );
    }
  }
  if (view.pendingDecision) {
    out.push(
      `Pending decision for ${seatLabel(view.pendingDecision.seat, me)}: ${view.pendingDecision.prompt}`
    );
  }

  out.push("");
  if (view.status === "complete" || view.status === "abandoned") {
    out.push(gameOverLine(view));
  } else if (orders.length) {
    out.push("Your orders:");
    for (const order of orders) out.push(formatOrder(order));
  } else {
    out.push("Not your turn — the opponent is on the clock.");
  }
  return out.join("\n");
}
