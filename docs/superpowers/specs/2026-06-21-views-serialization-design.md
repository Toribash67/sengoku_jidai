# Plan 4 Design — Views / Serialization (+ contract swap & consumer migration)

- **Date:** 2026-06-21
- **Status:** Approved (design); pending implementation plan
- **Parent spec:** `docs/superpowers/specs/2026-06-16-engine-model-design.md` (§10 Views & Determinism). This
  document records the **Plan 4 scope decisions** that refine §10 and the cross-package migration; it does
  not restate the whole engine design.

## 1. Goal

Retire the placeholder engine contract and promote the schemaVersion-2 model to the public surface:

- a real per-seat `PlayerGameView` + lean `legalCommandsForState`,
- v2 `serializeState`/`deserializeState`,
- the v2 `Command` union in `@sengoku-jidai/shared`,
- migrated **server** and a **minimal, read-only web** client,

so the entire workspace typechecks, lints, formats, builds, and all package tests stay green.

This is the last of the 4-plan engine rebuild. After it, no placeholder engine code remains and the v2 model
is the only public surface.

## 2. Scope Decisions (this plan)

1. **Web = minimal, compile-only.** Rewire the web client to the v2 contract with a **read-only** board
   (areas: `owner` + unit counts; `round`/`phase`/`initiative`/`activeSeat`; live VP tally) plus a basic
   command submitter (a `pass` button; area click is selection-only). The full interactive Rivers board
   (deploying commanders, composing advance/sail/bombard/shell/reinforce/embark/plan intents with previews)
   is deferred to a later phase, consistent with parent-spec §14.
2. **`legal` payload = lean.** `legalCommandsForState` surfaces deployable action spaces with a
   _deployability_ flag plus `canPass`, **not** full per-action target/move enumeration. The view contract is
   additive, so richer enumeration can be added later without breaking consumers. The engine's `legality.ts`
   primitives already exist; Plan 4 simply does not surface them all yet.
3. **Drop dead view helpers.** `spectatorView` and `legalCommandsForView` are unused (only self-referenced)
   and are removed rather than ported.

## 3. Sequencing (Approach A — coordinated swap)

The engine's `index.ts` is a single export surface; two `GameState`/`Command` cannot be exported at once, so
the swap is atomic at the index. One plan, ordered tasks: **engine → shared → server → web**, with
whole-workspace green as the final checkpoint. (Rejected alternatives: an additive `view2.ts`/`serialization2.ts`
shadow — same atomic index clash, extra churn; and a zod-first contract owned by `shared` — inverts the
current engine-owns-types layering, out of scope.)

## 4. Components

### 4.1 Engine view — `view.ts`

Rewrite against v2 `GameState`.

- **`PlayerGameView`** (`schemaVersion: 2`) carries: `gameId, mapId, mode, status, round, phase, initiative,
activeSeat, viewerSeat, prompt`; `areas: PlayerAreaView[]`; `bonuses: Record<areaId, BonusType>`;
  `actionSpaces: Record<spaceId, SeatId | null>`; `victoryPoints: Record<SeatId, number>`; `winner`,
  `endReason`; `pendingDecision` (present only when it is the viewer's); `legal`.
- **`PlayerAreaView`** = `{ id, kind, owner: SeatId | null, units: UnitCounts, valueStars: number,
suppliedBy: SeatId | null }`. `suppliedBy` is derived per render via `suppliedAreas(map, gameBoard(state), seat)`
  for each seat (an area is supplied by at most one seat at rest).
- **`victoryPoints`** tally computed via `victoryPoints(map, gameBoard(state), seat)` for both seats.
- **`legalCommandsForState(state, seat): LegalCommandSummary`** — lean:
  `{ activeSeat, spaces: { spaceId, type, areaId, legal }[], canPass }`. `legal` is a **deployability** flag:
  space unoccupied ∧ `seat === activeSeat` ∧ `phase === "deploy"` ∧ `status === "active"` ∧ the seat has an
  available commander (`available()` > 0). It is explicitly **not** a full per-action criteria check; a comment
  documents this so callers do not treat `legal: true` as "this action is guaranteed to be accepted." `canPass`
  uses the same turn/phase/availability gate.
- **`playerView(state, seat): PlayerGameView`**.
- **`playerEvents(events): GameEvent[]`** kept as the redaction-seam passthrough (the server calls it), with
  `export type PlayerGameEvent = GameEvent;` alongside it (server + web import `PlayerGameEvent`).
- **Types now owned by `view.ts`** (moved off the deleted placeholder `types.ts` model): `PlayerGameView`,
  `PlayerAreaView`, `LegalCommandSummary`, `PlayerGameEvent`.
- **Removed:** `spectatorView`, `legalCommandsForView`.

### 4.2 Engine serialization — `serialization.ts`

`serializeState(state): JsonGameState` and `deserializeState(json): GameState`, with a `schemaVersion !== 2`
guard that throws. `JsonGameState = GameState` (the v2 state is already JSON-serializable). Round-trip and
`seed + ordered commands` replay equivalence stay test-pinned.

### 4.3 Engine types / index cleanup

- **Trim `types.ts` to primitives only:** `JsonValue, SeatId, PlayerId, GameMode, GameStatus` (imported by
  `state.ts`/`commands.ts`). Remove every placeholder model type (`AreaState`, placeholder `RulesConfig`,
  placeholder `PlayerState`/`GameState`/`Command`/`RejectionReason`/`GameEvent`, `PendingDecision`,
  `PendingChoice`, `LegalCommandSummary`, `PlayerGameView`, `SpectatorGameView`, `CommandResult`,
  `JsonGameState`, `CommandActor`, `PlayerAreaView`, `PlayerGameEvent`). The view/legal/json types are
  (re)defined in `view.ts`/`serialization.ts`; the command/event/result types already live in `commands.ts`.
- **Delete** dead placeholder source files: `setup.ts`, `resolveCommand.ts`, `validateCommand.ts`.
- **Rewrite `index.ts`** to `export *` from: `rules, types, state, game, commands, resolve, view,
serialization, maps/riversMap, maps/registry, rng, supply, scoring`. The explicit-re-export workarounds
  (added to dodge placeholder clashes) are removed. Verify no duplicate-export error (TS2308).

### 4.4 Shared contract — `schemas.ts` + `api.ts`

- Replace `commandSchema` with the v2 discriminated union over `type`, mirroring `commands.ts`:
  - `advance` / `sail`: `spaceId`, `moves: { from, count }[]`
  - `bombard` / `shell`: `spaceId`, `targetAreaId`
  - `reinforce` / `embark`: `spaceId`, `placements: { area, count }[]`
  - `plan`: `spaceId`
  - `pass`: (no fields)
  - `choosePendingDecision`: `pendingId`, `choice` (`pendingChoiceSchema`)
- `createGameRequestSchema` (`mode`+`seed`), `submitCommandRequestSchema`, and the rest are unchanged.
- `api.ts` envelope types (`PlayerGameViewEnvelope<View>`, `CreateGameResponse`, `SubmitCommandResponse`,
  `ServerMessage`, …) are already generic over `View`/`Event` — unchanged; consumers parameterize them with
  the engine's `PlayerGameView`/`GameEvent`.

### 4.5 Server — `repository.ts`

- `createGame(...)` → `createInitialState(...)`. `seed` is **required** in v2, so generate one
  (`randomUUID()`) when the caller passes none.
- `resolveCommand(state, { seat }, command)` — drop the 4th `rules` argument **and** the `playerId` field
  (v2 `CommandActor` is `{ seat }`).
- `serializeState`/`deserializeState` are now v2. `state.rules.{rulesetId,rulesetVersion,rulesetHash}` and
  `state.revision` still exist in v2, so the `games`/`game_snapshots` inserts are untouched. The dev DB is
  reset (no schema-1 snapshots to migrate); there is no production data.
- View/event types on `CreatedGame`, `CommandSubmission`, and `getPlayerView` become the v2
  `PlayerGameView`/`GameEvent`.

### 4.6 Web — minimal, read-only

- `App.tsx` / `Board.tsx`: render the v2 view — areas with `owner` + unit counts, `round`/`phase`/
  `initiative`/`activeSeat`, and the `victoryPoints` tally. Replace the `claimArea` submit with `pass`;
  area click is selection-only (or dropped). The `PlayerAreaView` import points at the new v2 type.
- `client/api.ts`: `Command` is the v2 union; `submitCommand` sends v2 commands. `state/localGame.ts`
  (`SeatToken`) is unaffected.

## 5. Tests

- **Rewrite** `engine.test.ts` (placeholder `createGame`/`claimArea`/schema-1) — fold its intent into v2
  coverage.
- **Add** `view.test.ts`: `playerView` shape, per-seat `pendingDecision` redaction, lean `legal`
  deployability flags + `canPass`, and the VP tally.
- **Add** `serialization.test.ts`: v2 round-trip and the `schemaVersion !== 2` version guard.
- **Extend** `index.test.ts`: assert the new exports exist **and** the placeholder symbols (`createGame`,
  `claimArea`) are gone.
- `replay.test.ts` / `resolve.test.ts` already pin v2 behavior — adjust only where they touched the old
  serialize surface.
- **Server** tests updated for the v2 view/command shapes. **Web** has no tests today and none are added
  (minimal scope).

## 6. Verification Gate

Whole-workspace `typecheck`, `lint`, `format` (prettier), `build`, and every package's tests green; `pnpm dev`
renders the real v2 state.

## 7. Out of Scope (deferred to later phases)

- The full interactive Rivers web UI (commander deployment, intent composition with previews, per-action
  target enumeration in `legal`).
- WebSocket realtime (the hub stays a noop stub).
- Operation cards, Fortress/Siege — already deferred by the parent spec.
