import type {
  Command,
  LegalMove,
  LegalPlacement,
  LegalStrike,
  OperationCard,
  PlayerGameView
} from "@sengoku-jidai/engine/client";

export type OrderTemplate =
  | {
      kind: "move";
      type: "advance" | "sail";
      spaceId: string;
      targetAreaId: string;
      sources: { areaId: string; max: number }[];
      card?: OperationCard;
      bonusMax?: number;
    }
  | {
      kind: "placement";
      type: "reinforce" | "embark";
      spaceId: string;
      unit: "troop" | "ship";
      targets: string[];
      limit: number;
      pool: number;
      reserve: number;
      card?: OperationCard;
    }
  | { kind: "fixed"; command: Command };

export interface Order {
  n: number;
  label: string;
  template: OrderTemplate;
}

export interface OrderArgs {
  from?: string;
  place?: string;
  bonus?: number;
}

/** A mistake in `play` arguments, caught locally — nothing is submitted. */
export class OrderArgError extends Error {}

const MOVE_VERB = { advance: "Advance into", sail: "Sail into" } as const;

/** Every order the viewer can give right now, numbered from 1. Empty when not on the clock. */
export function listOrders(view: PlayerGameView): Order[] {
  const drafts: { label: string; template: OrderTemplate }[] = [];
  const legal = view.legal;

  const decision = view.pendingDecision;
  if (decision && decision.seat === view.viewerSeat) {
    for (const choice of decision.choices) {
      drafts.push({
        label: `${decision.prompt} → ${choice.label}`,
        template: {
          kind: "fixed",
          command: { type: "choosePendingDecision", pendingId: decision.id, choice }
        }
      });
    }
  }

  const combat = view.pendingCombat;
  if (combat) {
    const where = `combat at ${combat.area}`;
    if (legal.canRollCombat) {
      drafts.push({
        label: `Roll the dice (${where})`,
        template: { kind: "fixed", command: { type: "combatRoll", pendingId: combat.id } }
      });
    }
    if (legal.canAmbush) {
      drafts.push({
        label: `Roll with Ambush — discard ambush for +2 defence dice (${where})`,
        template: {
          kind: "fixed",
          command: { type: "combatRoll", pendingId: combat.id, card: "ambush" }
        }
      });
    }
    if (legal.canRerollCombat) {
      for (const card of new Set(view.hand)) {
        drafts.push({
          label: `Reroll — discard ${card} (${where})`,
          template: { kind: "fixed", command: { type: "combatReroll", pendingId: combat.id, card } }
        });
      }
    }
    if (legal.canResolveCombat) {
      drafts.push({
        label: `Accept the roll and apply casualties (${where})`,
        template: { kind: "fixed", command: { type: "combatResolve", pendingId: combat.id } }
      });
    }
  }

  for (const move of legal.moves) drafts.push(moveDraft(move));
  for (const strike of legal.strikes) drafts.push(...strikeDrafts(strike));
  for (const placement of legal.placements) drafts.push(placementDraft(placement));
  for (const plan of legal.plans) {
    drafts.push({
      label: plan.initiative
        ? "Plan — draw 1 card and seize initiative next round"
        : "Plan — draw 2 cards",
      template: { kind: "fixed", command: { type: "plan", spaceId: plan.spaceId } }
    });
  }
  for (const play of legal.cardPlays) {
    for (const move of play.moves ?? []) drafts.push(moveDraft(move, play.card, play.bonusMax));
    for (const strike of play.strikes ?? []) drafts.push(...strikeDrafts(strike, play.card));
    for (const placement of play.placements ?? [])
      drafts.push(placementDraft(placement, play.card));
  }
  if (legal.canPass) {
    drafts.push({
      label: "Pass — spend one commander without acting (you keep your remaining turns)",
      template: { kind: "fixed", command: { type: "pass" } }
    });
  }

  return drafts.map((d, i) => ({ n: i + 1, ...d }));
}

function cardTag(card: OperationCard | undefined): string {
  return card ? `[card: ${card}] ` : "";
}

function moveDraft(move: LegalMove, card?: OperationCard, bonusMax?: number) {
  const sources = move.sources.map((s) => `${s.areaId} up to ${s.max}`).join(", ");
  const bonus =
    bonusMax !== undefined
      ? `; +up to ${bonusMax} reserve ${move.type === "advance" ? "troops" : "ships"}`
      : "";
  return {
    label: `${cardTag(card)}${MOVE_VERB[move.type]} ${move.targetAreaId} (sources: ${sources}${bonus})`,
    template: {
      kind: "move" as const,
      type: move.type,
      spaceId: move.spaceId,
      targetAreaId: move.targetAreaId,
      sources: move.sources,
      ...(card ? { card } : {}),
      ...(bonusMax !== undefined ? { bonusMax } : {})
    }
  };
}

function strikeDrafts(strike: LegalStrike, card?: OperationCard) {
  const verb = strike.type === "bombard" ? "Bombard" : "Shell";
  return strike.targets.map((target) => ({
    label: `${cardTag(card)}${verb} from ${strike.linkedAreaId} → ${target} (${strike.dice} dice)`,
    template: {
      kind: "fixed" as const,
      command: {
        type: strike.type,
        spaceId: strike.spaceId,
        targetAreaId: target,
        ...(card ? { card } : {})
      } as Command
    }
  }));
}

function placementDraft(placement: LegalPlacement, card?: OperationCard) {
  const limit = Math.min(placement.pool, placement.reserve);
  const verb = placement.type === "reinforce" ? "Reinforce" : "Embark";
  const units = placement.unit === "troop" ? "troops" : "ships";
  return {
    label: `${cardTag(card)}${verb}: place up to ${limit} ${units} (pool ${placement.pool}, reserve ${placement.reserve}) into ${placement.targets.join(", ")}`,
    template: {
      kind: "placement" as const,
      type: placement.type,
      spaceId: placement.spaceId,
      unit: placement.unit,
      targets: placement.targets,
      limit,
      pool: placement.pool,
      reserve: placement.reserve,
      ...(card ? { card } : {})
    }
  };
}

/** One order line with its usage hint, e.g. ` 4. Advance into L7 (…)  → play 4 --from AREA:N`. */
export function formatOrder(order: Order): string {
  const t = order.template;
  let usage = `play ${order.n}`;
  if (t.kind === "move") {
    usage += " --from AREA:N[,AREA:N]";
    if (t.bonusMax !== undefined) usage += ` [--bonus 0-${t.bonusMax}]`;
  } else if (t.kind === "placement") {
    usage += " --place AREA:N[,AREA:N]";
  }
  return `${String(order.n).padStart(2)}. ${order.label}  → ${usage}`;
}

/** Parse `A:2,B:1` into area → count (repeated areas sum). */
export function parseAllocation(raw: string): Map<string, number> {
  const out = new Map<string, number>();
  for (const part of raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)) {
    const m = /^([^:\s]+):(\d+)$/.exec(part);
    if (!m) throw new OrderArgError(`Can't read "${part}" — use AREA:COUNT, e.g. L3:2.`);
    const count = Number(m[2]);
    if (count < 1) throw new OrderArgError(`Counts must be at least 1 ("${part}").`);
    out.set(m[1]!, (out.get(m[1]!) ?? 0) + count);
  }
  if (out.size === 0) throw new OrderArgError("Give at least one AREA:COUNT.");
  return out;
}

/** Validate `args` against the order's limits and build the engine command. */
export function buildCommand(order: Order, args: OrderArgs): Command {
  const t = order.template;
  const n = order.n;
  if (t.kind === "fixed") {
    if (args.from !== undefined || args.place !== undefined || args.bonus !== undefined) {
      throw new OrderArgError(`Order ${n} takes no arguments — run \`play ${n}\`.`);
    }
    return t.command;
  }

  if (t.kind === "move") {
    if (args.place !== undefined)
      throw new OrderArgError(`Order ${n} is a move: use --from, not --place.`);
    if (args.from === undefined)
      throw new OrderArgError(`Order ${n} needs --from AREA:N[,AREA:N].`);
    const wanted = parseAllocation(args.from);
    for (const [area, count] of wanted) {
      const source = t.sources.find((s) => s.areaId === area);
      if (!source) throw new OrderArgError(`${area} is not a legal source for order ${n}.`);
      if (count > source.max) throw new OrderArgError(`${area} allows at most ${source.max}.`);
    }
    const moves = t.sources
      .filter((s) => wanted.has(s.areaId))
      .map((s) => ({ from: s.areaId, count: wanted.get(s.areaId)! }));
    if (args.bonus !== undefined) {
      if (t.bonusMax === undefined) throw new OrderArgError(`Order ${n} takes no --bonus.`);
      if (!Number.isInteger(args.bonus) || args.bonus < 0 || args.bonus > t.bonusMax) {
        throw new OrderArgError(`--bonus for order ${n} must be 0 to at most ${t.bonusMax}.`);
      }
    }
    // Mirrors the web's buildCommand: assault cards always carry cardBonus; counterattack only the card.
    const cardFields = t.card
      ? { card: t.card, ...(t.bonusMax !== undefined ? { cardBonus: args.bonus ?? 0 } : {}) }
      : {};
    return { type: t.type, spaceId: t.spaceId, moves, ...cardFields } as Command;
  }

  if (args.from !== undefined)
    throw new OrderArgError(`Order ${n} is a placement: use --place, not --from.`);
  if (args.bonus !== undefined) throw new OrderArgError(`Order ${n} takes no --bonus.`);
  if (args.place === undefined)
    throw new OrderArgError(`Order ${n} needs --place AREA:N[,AREA:N].`);
  const wanted = parseAllocation(args.place);
  let total = 0;
  for (const [area, count] of wanted) {
    if (!t.targets.includes(area))
      throw new OrderArgError(`${area} is not a legal target for order ${n}.`);
    total += count;
  }
  if (total > t.limit) throw new OrderArgError(`Order ${n} places at most ${t.limit} in total.`);
  const placements = t.targets
    .filter((a) => wanted.has(a))
    .map((area) => ({ area, count: wanted.get(area)! }));
  return {
    type: t.type,
    spaceId: t.spaceId,
    placements,
    ...(t.card ? { card: t.card } : {})
  } as Command;
}
