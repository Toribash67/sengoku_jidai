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

  // Reinforce / Embark: fill the placeable pool into the single highest-value target.
  for (const pl of legal.placements) {
    const placeable = Math.min(pl.pool, pl.reserve);
    if (placeable <= 0 || pl.targets.length === 0) continue;
    const target = [...pl.targets].sort(
      (a, b) => (map.areas[b]?.valueStars ?? 0) - (map.areas[a]?.valueStars ?? 0)
    )[0]!;
    out.push({
      type: pl.type,
      spaceId: pl.spaceId,
      placements: [{ area: target, count: placeable }]
    });
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

  // Strongest single source.
  const strongest = [...sources].sort((a, b) => b.max - a.max)[0]!;
  const single = build([{ from: strongest.areaId, count: strongest.max }]);
  if (single) commands.push(single);

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
