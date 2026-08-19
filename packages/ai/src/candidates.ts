import {
  getMap,
  legalCommandsForState,
  type Command,
  type GameState,
  type LegalMove,
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

  // Reinforce / Embark: place into targets that actually have free capacity. A tile at its
  // stacking cap (land 5 / water 3, see engine resolve.ts) returns the excess to reserve — so
  // dumping onto the highest-value tile when it is full is a no-op that ties with pass, and the
  // bot passes instead of strengthening the board. Offer the best few free-capacity targets by
  // tile value (count clamped to what fits) so the search can commit where it helps.
  for (const pl of legal.placements) {
    const placeable = Math.min(pl.pool, pl.reserve);
    if (placeable <= 0 || pl.targets.length === 0) continue;
    const cap = pl.unit === "troop" ? 5 : 3;
    const withRoom = pl.targets
      .map((area) => ({ area, free: cap - (state.areas[area]?.units[pl.unit] ?? 0) }))
      .filter((t) => t.free > 0)
      .sort((a, b) => (map.areas[b.area]?.valueStars ?? 0) - (map.areas[a.area]?.valueStars ?? 0));
    for (const { area, free } of withRoom.slice(0, PLACEMENT_TARGETS)) {
      out.push({
        type: pl.type,
        spaceId: pl.spaceId,
        placements: [{ area, count: Math.min(placeable, free) }]
      });
    }
    // Spread: fill the top free-capacity tiles to cap in value order until the pool is exhausted,
    // so the whole reserve pool deploys in one command instead of banking the overflow (each tile
    // caps at land 5 / water 3). Added only when it spans >1 tile — otherwise it duplicates the
    // single-target candidate above.
    const spread: { area: string; count: number }[] = [];
    let remaining = placeable;
    for (const { area, free } of withRoom) {
      if (remaining <= 0) break;
      const count = Math.min(remaining, free);
      spread.push({ area, count });
      remaining -= count;
    }
    if (spread.length > 1) out.push({ type: pl.type, spaceId: pl.spaceId, placements: spread });
  }

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

  // De-duplicate by structural signature (archetypes can coincide).
  const seen = new Set<string>();
  return out.filter((c) => {
    const k = JSON.stringify(c);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

function moveArchetypes(state: GameState, seat: SeatId, mv: LegalMove): Command[] {
  const sources = mv.sources.filter((s) => s.max > 0);
  if (sources.length === 0) return [];
  const unit = mv.type === "advance" ? "troop" : "ship";
  const tgt = state.areas[mv.targetAreaId];
  const defenders = tgt && tgt.owner !== seat ? tgt.units[unit] : 0;

  const commands: Command[] = [];
  const build = (moves: { from: string; count: number }[]): Command | null => {
    const nonzero = moves.filter((m) => m.count > 0);
    const total = nonzero.reduce((n, m) => n + m.count, 0);
    if (total < 1) return null;
    return { type: mv.type, spaceId: mv.spaceId, moves: nonzero };
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
