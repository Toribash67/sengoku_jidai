# Engine Model Design — General Orders: Sengoku Jidai (Rivers)

- **Date:** 2026-06-16
- **Status:** Approved (design); pending implementation plan
- **Scope:** Replace the placeholder engine with the real **Rivers** ruleset model. Operation cards are deferred to a later phase; Fortress map, Siege action, fortifications, and siege weapons are out of scope.

## 1. Overview & Goals

Model the full **Rivers** game in `packages/engine` so a complete hotseat game is playable end to end, minus operation cards.

Key consequences of the chosen scope:

- **Operation cards deferred.** The interaction model is designed to host card reactions/rerolls later, but zero card effects ship in this phase.
- **Perfect information.** With no card hands and only one land-unit type (troops) and one water-unit type (ships) in Rivers, there are no hidden information and no cross-player mid-action choices. "Choose which units to remove" / simultaneous attrition reduce to arithmetic.
- **Randomness = dice + setup.** No `Math.random()` in rules; a seedable PRNG state lives in `GameState`.

The engine stays pure and deterministic; the server stays authoritative and calls `resolveCommand`; the web client renders a per-seat view. `RulesConfig` is the variance carrier so Fortress/Siege/cards are additive later, never forks in core code.

## 2. Architecture & Boundaries

Unchanged from `ARCHITECTURE.md`. This phase **removes the placeholder**: `claimArea`, `AreaState.strength`, `placeholderMap`, and the `claimArea`/`choosePendingDecision`-only command union are replaced.

**Static vs dynamic split.** `MapDefinition` (engine-owned) holds everything constant during a game: area kind, adjacency, HQs, value stars, harbors/ports, action-space layout, and bonus-slot areas. `GameState` holds only what changes. **Control and supply are always derived from unit positions, never stored** — eliminating a class of desync bugs.

## 3. Rules Summary (Rivers) — authoritative for implementation

- **Length:** 4 rounds. Each round: (1) Deploy commanders, (2) Recall commanders, (3) Advance round marker.
- **Commanders:** 5 per player (Rivers). Units: 25 troops (land only), 10 ships (water only). Locations: reserve ↔ board areas ↔ standby (commanders only, via pass).
- **Deploy phase:** Players alternate, starting from the round's initiative holder. Each turn, place one commander from reserve into an unoccupied action space and resolve its action, **or pass** (place a commander in standby; it is unavailable until next round). Every turn spends exactly one commander. Because both players hold 5 commanders and alternate, they exhaust simultaneously and the **non-initiative holder always makes the round's final move**.
- **Recall:** Return all deployed and standby commanders to reserve.
- **Advance round marker:** Initiative carries over unless changed by a Plan action during the round.
- **Control:** A player controls an area (land or water) if they have ≥1 unit in it.
- **Supply:** An area is in supply for a player if they control it **and** it connects to their HQ land area through an unbroken chain of areas they control (general adjacency; land, water, or mixed).
- **Adjacency:** Areas sharing a border are adjacent. Land and water areas that share a border **are** adjacent (required for Bombard/Shell/supply). Piers are a separate **ports** overlay (Embark placement + building a navy), not the only land↔water link.
- **Unit caps:** At the end of each action, reduce to ≤5 units per land area and ≤3 per water area; excess returns to reserve. Limits may be exceeded mid-action.
- **Cannot take the last unit** from an area when moving units out of it for an action.

### The 7 Rivers actions

**Linked actions** (commander deployed into an action space inside a land/water area):

1. **Advance** (linked land). Criteria: you do not control the linked land; you can move ≥1 land unit in. Move troops into it from land areas you supply that are adjacent to the linked land, and/or adjacent to a water area you supply that is itself adjacent to the linked land. Then resolve conflict if the area is enemy-controlled.
2. **Sail** (linked water). Criteria: you do not control the linked water; you can move ≥1 ship in. Move ships from water areas you supply, connected to the linked water by an unbroken chain of water areas you supply. Then resolve conflict.
3. **Bombard** (linked water). Criteria: you supply the linked water. Choose a target land area adjacent to it. Roll one die per ship in the linked water; opponent removes that many land units from the target (→ reserve).
4. **Shell** (linked land). Criteria: you supply the linked land. Choose a target water area adjacent to it. Roll two dice; opponent removes that many ships from the target (→ reserve).

**Support actions** (commander deployed onto the support board; not linked to a board area). Each has two spaces; a player may use **at most one of each type per round**:

5. **Reinforce.** Take N troops from reserve and place them in land areas you supply (N = 6 or 5 by space).
6. **Embark.** Take N ships from reserve and place them in water areas you supply and/or water areas adjacent to a supplied **port** that contain no enemy ships (N = 3 or 2 by space).
7. **Plan.** Draw N cards (no-op until the cards phase). If the space carries the initiative symbol, seize initiative for next round.

### Conflict (Advance/Sail into an enemy-controlled area)

1. **Defence:** Defender rolls one die; attacker removes that many of the moved-in attacking units.
2. **Attrition:** If attackers remain, both players simultaneously remove one unit at a time until one side has none.
3. Removed units go to their owner's reserve. The surviving side controls the area.

(In Rivers all removal choices are arithmetic because units are homogeneous per area kind.)

### Area bonuses

Five Rivers bonuses (Armoury is excluded — it only aids Siege). **3 of the 5** are drawn at random during setup and assigned to fixed bonus-slot areas. A player who **supplies** a bonus area gains its ability while they supply it. Bonuses carry **no** VP.

- **Barracks:** Reinforce places +2 extra troops.
- **War Room:** Plan draws +1 card (no-op until cards).
- **Pirate Haven:** Bombard rolls +1 die.
- **Shipyard:** After Sail move-in (before conflict), add +1 ship to the linked water from reserve.
- **Hidden Base:** After Advance move-in (before conflict), add +1 troop to the linked land from reserve. Not applied during the Advance that gains control of the bonus area.

### Victory / game end

- **Immediate loss:** If a player ever has zero units in their HQ land area (red = tile9, black = tile13), they lose immediately. This is the primary win condition.
- **End of round 4 (secondary):** The player with the most victory points (board stars) on areas **they supply** wins. Ties go to the initiative holder.

## 4. State Model

```ts
type SeatId = "red" | "black";
type UnitType = "troop" | "ship" | "siege"; // siege always 0 in Rivers
type UnitCounts = Record<UnitType, number>;
type BonusType = "barracks" | "warRoom" | "pirateHaven" | "shipyard" | "hiddenBase";

interface GameState {
  schemaVersion: 2;
  gameId: string;
  mapId: string; // "rivers"
  rules: RulesConfig;
  mode: GameMode;
  status: "setup" | "active" | "complete" | "abandoned";

  round: number; // 1..rules.maxRounds
  phase: "deploy" | "recall";
  initiative: SeatId; // deploys first this round; VP tiebreak
  activeSeat: SeatId; // whose turn within deploy

  rngState: string; // seedable PRNG state (dice + setup)

  players: Record<SeatId, PlayerState>;
  areas: Record<string, AreaRuntime>; // dynamic per area
  actionSpaces: Record<string, SeatId | null>; // spaceId -> occupying seat
  bonuses: Record<string, BonusType>; // bonus-slot areaId -> assigned bonus (3 entries)

  pendingDecision: PendingDecision | null; // retained; unused by actions in v1
  winner: SeatId | null;
  endReason: "hqEliminated" | "victoryPoints" | null;
}

interface PlayerState {
  seat: SeatId;
  reserve: UnitCounts;
  commanders: { total: number; standby: number }; // deployed = number of spaces this seat occupies
  hand: OperationCard[]; // empty until cards phase
  passed: boolean; // passed this round
}

// At rest, an area is single-owner: moving into an enemy area triggers a conflict
// that empties one side. Transient both-sides states exist only inside resolveCommand.
interface AreaRuntime {
  owner: SeatId | null; // null = empty; this IS "control"
  units: UnitCounts;
}
```

`RulesConfig` gains the variance knobs the engine reads instead of hard-coding: `commandersPerPlayer` (5), `maxRounds` (4), `diceFaces` (`[0,1,1,1,1,2]`), enabled actions (Rivers omits Siege), the bonus set, and `fortifications`/`cards` flags (both off in Rivers).

## 5. Setup & Randomness

`createGame(options)` builds initial state deterministically from a seed:

1. Seed a small JSON-serializable PRNG (mulberry32/splitmix-style) → `rngState`. All later draws read and advance this state, so the game replays from `seed + ordered commands`.
2. Place starting units from map setup data (per-area troop/ship symbols per faction).
3. Shuffle the 5 bonus types via the PRNG, take 3, assign them to the 3 fixed bonus-slot areas → `bonuses`.
4. PRNG picks the starting initiative holder.
5. `round: 1`, `phase: "deploy"`, `status: "active"`, `activeSeat = initiative`; each `reserve` = full pool minus units placed in step 2; `commanders.total = 5`.

**RNG discipline.** Each draw emits a labeled `randomDraw` event (`purpose`, `beforeRngState`, `afterRngState`, `outcome`) for auditability and exact replay.

## 6. Commands & Deployment Criteria

```ts
type Command =
  | { type: "advance"; spaceId: string; moves: { from: string; count: number }[] }
  | { type: "sail"; spaceId: string; moves: { from: string; count: number }[] }
  | { type: "bombard"; spaceId: string; targetAreaId: string }
  | { type: "shell"; spaceId: string; targetAreaId: string }
  | { type: "reinforce"; spaceId: string; placements: { area: string; count: number }[] }
  | { type: "embark"; spaceId: string; placements: { area: string; count: number }[] }
  | { type: "plan"; spaceId: string }
  | { type: "pass" }
  | { type: "choosePendingDecision"; pendingId: string; choice: PendingChoice }; // future cards
```

Each action command implicitly deploys a commander into `spaceId`; `pass` deploys into standby.

Common criteria: actor's turn, `phase = deploy`, `status = active`, space exists and is the right type and unoccupied. Per-action criteria mirror Section 3 (control/supply gates, adjacency, source/placement legality, "can't take last unit", totals ≤ the space's N). Reinforce/Embark/Plan enforce "at most one of the two same-type spaces per round" by checking sibling-space occupancy by the same seat (no extra state).

Rejections use the discriminated `RejectionReason` pattern already in the engine.

## 7. Resolution Pipeline (approach C)

The engine runs each command through fixed steps; bracketed windows are no-ops in v1 and are exactly where cards plug in later:

```
validate → deployCommander → moveIn/placeUnits → [reactionWindow] → rollDice
→ [rerollWindow] → applyRemovals → attrition → updateOwners → applyAreaBonuses
→ enforceCaps(land ≤ 5, water ≤ 3; excess → reserve) → advanceTurn → checkGameEnd
```

- **Conflict** runs in `applyRemovals` + `attrition` per Section 3.
- **Area bonuses** apply at their specific step if the actor supplies the bonus area (Hidden Base / Shipyard add units at move-in; Barracks adds to Reinforce N; Pirate Haven adds a Bombard die).
- **Caps** enforced at end of every action.

## 8. Turn & Round Flow

Within a round, turns strictly alternate from the round's initiative holder; `advanceTurn` toggles `activeSeat` and no opponent-availability check is needed. When all commanders are spent (both players at zero available), the engine **automatically** runs recall (deployed + standby → reserve, clear `actionSpaces`, reset `passed`) and advances the round (initiative carries over unless a Plan seized it), or ends the game after round 4. The only back-to-back same-player moves occur across a round boundary when the round's final (non-initiative) mover seized initiative via Plan.

## 9. Supply, Control, Scoring & Game End

- **Control:** `area.owner === seat`.
- **Supply(seat, area):** `control(seat, area)` AND a path of areas controlled by `seat` connects `area` to `seat`'s HQ land area, via general adjacency. Implemented as a graph search seeded at the HQ.
- **Scoring:** `VP(seat) = Σ area.valueStars over areas where supply(seat, area)`.
- **Game end:** After every action, if a seat's HQ area holds zero of its units → that seat loses (`endReason: "hqEliminated"`). After round 4's recall → higher supplied-VP wins, ties to initiative (`endReason: "victoryPoints"`). Set `status = "complete"`, `winner`.

## 10. Views & Determinism

- `playerView(state, seat)` returns the full board to both seats (perfect information in v1), keeping the per-seat function + envelope so hidden hands/deck redact later. It carries areas (owner + units), bonus assignments, action-space occupancy, round/phase/initiative/activeSeat, live VP tallies, `winner`/`endReason`, and a prompt.
- `legalCommandsForState` returns **deployable spaces** (by type, currently-legal flag) and target options — not fully enumerated intents. The client composes intent with preview helpers; the engine validates on submit.
- `schemaVersion: 2`; `serializeState`/`deserializeState` validate shape + version. Tests assert serialize round-trips and that `seed + ordered commands` replays identically.

## 11. Ruleset / Map Variance Seam

`RulesConfig` carries the knobs (Section 4). **Fortress** = a new `MapDefinition` + a ruleset enabling Siege, fortifications, Armoury, and 6 commanders. **Cards** = flip the ruleset flag and fill the reaction/reroll windows + `pendingDecision` flow. No core rewrites.

## 12. Testing Strategy

Engine unit tests (fast, deterministic): setup determinism; each action's legal and illegal paths; conflict arithmetic; supply derivation; scoring; both game-end conditions; cap enforcement; RNG stability; `serialize∘deserialize` round-trip; replay equivalence. **Golden tests encoding the rulebook's worked examples** (Advance, Sail, Bombard, Shell, Conflict, Example Turn). Map invariants (already present) extended for the adjacency/ports/action-space data. Server/API and Playwright tests follow in their own phases.

## 13. Data Dependencies / TODOs

Objective board facts to gather (SVG extraction or from the map author; sensible placeholders otherwise):

1. **General adjacency graph** — re-derive (replaces the current `landAdjacent`/`seaAdjacent` split). Confirm by eye against a rendered map.
2. **Action-space layout** — from the `move/sail/bombard/shell-*` SVG overlays (one Advance per land area, Sail + Bombard per sea area, Shell on coastal land {10,12,19,21}).
3. **The 3 bonus-slot areas** — likely from the board scan or the author.
4. **Starting unit positions** — per-area setup symbols; from the board scan or the author.
5. **Support-space N values** and which Plan space carries the initiative symbol.

### Map module correction

`riversMap.ts` currently splits `landAdjacent`/`seaAdjacent` and treats piers as the only land↔sea link. Replace with a single `adjacent: string[]` (general border adjacency, all kinds) plus `ports: string[]` on harbor land areas. Update `riversMap.test.ts` invariants accordingly.

## 14. Out of Scope (deferred)

- Operation cards (24 effects) and the hand/deck/discard, reaction/reroll windows.
- Fortress map, Siege action, fortifications, siege weapons, Armoury.
- The "insufficient units" rule (pulling units from controlled areas to complete an action); v1 caps placements at reserve.
- WebSocket realtime; server/UI wiring beyond what later phases cover.
