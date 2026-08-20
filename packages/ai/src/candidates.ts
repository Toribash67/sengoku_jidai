import {
  getMap,
  legalCommandsForState,
  type Command,
  type GameState,
  type LegalMove,
  type LegalPlacement,
  type MapDefinition,
  type OperationCard,
  type SeatId
} from "@sengoku-jidai/engine";

/** Concrete, engine-legal deploy commands for `seat` right now (empty if not its clean
 *  deploy turn). Canonical archetypes only — see the spec §6.
 *
 *  advance/sail: all-in, strongest-single, minimum-viable
 *
 *  How many candidate archetypes we keep per move space. Widening this trades speed for
 *  coverage — a deliberate cap, not an accident. */

/** How many free-capacity reinforce/embark targets (best by tile value) to offer per source. */
const PLACEMENT_TARGETS = 3;

export function deployCandidates(state: GameState, seat: SeatId): Command[] {
  const legal = legalCommandsForState(state, seat);
  if (legal.activeSeat !== seat || !legal.canPass) {
    // canPass is the shared deployability gate; if it is false the seat cannot deploy now.
    return [];
  }
  const map = getMap(state.mapId);
  const out: Command[] = [];

  // Pass is always available when deployable.
  out.push({ type: "pass" });

  // Plans.
  for (const p of legal.plans) out.push({ type: "plan", spaceId: p.spaceId });

  // Reinforce / Embark: place into targets that actually have free capacity (see the helper).
  for (const pl of legal.placements) out.push(...placementCandidates(state, seat, map, pl));

  // Bombard / Shell: one candidate per enemy target.
  for (const st of legal.strikes) {
    for (const target of st.targets) {
      if (st.type === "bombard")
        out.push({ type: "bombard", spaceId: st.spaceId, targetAreaId: target });
      else out.push({ type: "shell", spaceId: st.spaceId, targetAreaId: target });
    }
  }

  // Advance / Sail: archetype allocations over the legal sources.
  for (const mv of legal.moves) out.push(...moveArchetypes(state, seat, mv));

  // Deploy-time operation cards: attach each currently-playable card to the actions it modifies,
  // reusing the SAME archetypes as the no-card variants. `cardPlays` already carries the
  // card-modified options (extra reinforce/embark pool, enemy-sea embark targets, +2 bombard dice,
  // bonus reserve units on a move). The eval's `card` term prices the opportunity cost of spending
  // a card, so the search itself decides when a play is worth it. Combat-time cards (ambush,
  // ship_strike, reroll) are out of scope here — they live in the combat-response policy.
  for (const play of legal.cardPlays) {
    if (play.action === "reinforce" || play.action === "embark") {
      for (const pl of play.placements ?? [])
        out.push(...placementCandidates(state, seat, map, pl, play.card));
    } else if (play.action === "advance" || play.action === "sail") {
      // ground/river_assault add up to `bonusMax` reserve units to the move-in — the card's whole
      // benefit, so always spend the max. counterattack has no bonus (bonusMax undefined).
      const cardBonus = play.bonusMax && play.bonusMax > 0 ? play.bonusMax : undefined;
      for (const mv of play.moves ?? [])
        out.push(...moveArchetypes(state, seat, mv, play.card, cardBonus));
    } else if (play.action === "bombard") {
      for (const st of play.strikes ?? [])
        for (const target of st.targets)
          out.push({
            type: "bombard",
            spaceId: st.spaceId,
            targetAreaId: target,
            card: play.card
          });
    }
  }

  // De-duplicate by structural signature (archetypes can coincide).
  const seen = new Set<string>();
  return out.filter((c) => {
    const k = JSON.stringify(c);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

/** Reinforce/Embark candidates for one placement: the best few free-capacity targets by tile
 *  value, plus a spread that fills them to cap until the pool is spent. A tile at its stacking cap
 *  (land 5 / water 3) returns the excess to reserve, so dumping onto a full tile is a no-op that
 *  ties with pass — hence the free-capacity filter. A contested (enemy-owned) target is an attack:
 *  it always counts as having room, so a Commandeer embark into a defended sea is still offered.
 *  `card`, when given, is attached to every candidate (mobilise / commandeer). */
function placementCandidates(
  state: GameState,
  seat: SeatId,
  map: MapDefinition,
  pl: LegalPlacement,
  card?: OperationCard
): Command[] {
  const out: Command[] = [];
  const placeable = Math.min(pl.pool, pl.reserve);
  if (placeable <= 0 || pl.targets.length === 0) return out;
  const cap = pl.unit === "troop" ? 5 : 3;
  const freeOf = (area: string): number => {
    const occ = state.areas[area];
    if (occ && occ.owner && occ.owner !== seat) return cap; // contested target: full commitment
    return cap - (occ?.units[pl.unit] ?? 0);
  };
  const withRoom = pl.targets
    .map((area) => ({ area, free: freeOf(area) }))
    .filter((t) => t.free > 0)
    .sort((a, b) => (map.areas[b.area]?.valueStars ?? 0) - (map.areas[a.area]?.valueStars ?? 0));
  const withCard = card ? { card } : {};
  for (const { area, free } of withRoom.slice(0, PLACEMENT_TARGETS)) {
    out.push({
      type: pl.type,
      spaceId: pl.spaceId,
      placements: [{ area, count: Math.min(placeable, free) }],
      ...withCard
    });
  }
  // Spread across the top free-capacity tiles until the pool is spent (>1 tile only, else it
  // duplicates the single-target candidate above).
  const spread: { area: string; count: number }[] = [];
  let remaining = placeable;
  for (const { area, free } of withRoom) {
    if (remaining <= 0) break;
    const count = Math.min(remaining, free);
    spread.push({ area, count });
    remaining -= count;
  }
  if (spread.length > 1)
    out.push({ type: pl.type, spaceId: pl.spaceId, placements: spread, ...withCard });
  return out;
}

function moveArchetypes(
  state: GameState,
  seat: SeatId,
  mv: LegalMove,
  card?: OperationCard,
  cardBonus?: number
): Command[] {
  const sources = mv.sources.filter((s) => s.max > 0);
  if (sources.length === 0) return [];
  const unit = mv.type === "advance" ? "troop" : "ship";
  const tgt = state.areas[mv.targetAreaId];
  const defenders = tgt && tgt.owner !== seat ? tgt.units[unit] : 0;

  const extra = { ...(card ? { card } : {}), ...(cardBonus !== undefined ? { cardBonus } : {}) };
  const commands: Command[] = [];
  const build = (moves: { from: string; count: number }[]): Command | null => {
    const nonzero = moves.filter((m) => m.count > 0);
    const total = nonzero.reduce((n, m) => n + m.count, 0);
    if (total < 1) return null;
    return { type: mv.type, spaceId: mv.spaceId, moves: nonzero, ...extra };
  };

  // All-in: every source contributes its max.
  const allIn = build(sources.map((s) => ({ from: s.areaId, count: s.max })));
  if (allIn) commands.push(allIn);

  // Solo from each source at its max. Attacking from a weaker source can beat pulling from the
  // strongest one: eval rewards per-tile presence concavely, so draining your strongest stack to
  // attack is a real cost the search should be free to avoid by spending a lesser tile instead.
  // (Diagnostic 2026-08-19: solo-from-a-non-strongest-source was 100% of the advance
  // candidate-generation gap.) De-duplication below collapses the overlap with all-in/min-viable.
  for (const s of sources) {
    const solo = build([{ from: s.areaId, count: s.max }]);
    if (solo) commands.push(solo);
  }

  // Minimum viable: attackers = defenders + 1, greedily from the biggest sources.
  let need = defenders + 1;
  const minMoves: { from: string; count: number }[] = [];
  for (const s of [...sources].sort((a, b) => b.max - a.max)) {
    if (need <= 0) break;
    const take = Math.min(need, s.max);
    minMoves.push({ from: s.areaId, count: take });
    need -= take;
  }
  const minViable = build(minMoves);
  if (minViable) commands.push(minViable);

  return commands;
}
