# Views / Serialization Implementation Plan (Plan 4)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Retire the placeholder engine contract and promote the schemaVersion-2 model to the public surface — real per-seat `PlayerGameView`, v2 serialization, the v2 `Command` union in `@sengoku-jidai/shared`, and migrated server + minimal read-only web — so the whole workspace typechecks, lints, builds, and all tests stay green.

**Architecture:** A coordinated, atomic contract swap in dependency order: **engine → shared → server → web**. The engine's `index.ts` is a single export surface (two `GameState`/`Command` cannot coexist), so the engine swap lands in one task; downstream packages are migrated package-by-package, each finishing green after `pnpm build:libs` republishes the engine/shared `dist`.

**Tech Stack:** TypeScript (ESM, NodeNext), pnpm workspaces, Vitest (unit), Zod (shared schemas), Fastify + better-sqlite3 (server), React + Vite (web), Playwright (e2e).

**Spec:** `docs/superpowers/specs/2026-06-21-views-serialization-design.md` (parent: `2026-06-16-engine-model-design.md` §10).

---

## File Structure

**Engine (`packages/engine/src/`)**

- `types.ts` — trimmed to primitives only (`JsonValue, SeatId, PlayerId, GameMode, GameStatus`).
- `serialization.ts` — rewritten for v2 (`serializeState`/`deserializeState`/`JsonGameState`).
- `view.ts` — rewritten for v2 (`PlayerGameView`, `PlayerAreaView`, `LegalCommandSummary`, `LegalSpace`, `PlayerGameEvent`, `playerView`, `legalCommandsForState`, `playerEvents`).
- `index.ts` — rewritten to `export *` the v2 surface.
- **Deleted:** `setup.ts`, `resolveCommand.ts`, `validateCommand.ts`.
- `packages/engine/test/` — delete `engine.test.ts`; add `view.test.ts`, `serialization.test.ts`; extend `index.test.ts`.

**Shared (`packages/shared/src/`)**

- `schemas.ts` — `commandSchema` becomes the v2 discriminated union.

**Server (`packages/server/src/`)**

- `persistence/repository.ts` — engine call sites migrated (`createInitialState`, new `resolveCommand` signature).
- `packages/server/test/server.test.ts` — exercises a real v2 command (`pass`).

**Web (`packages/web/src/`)**

- `components/board/Board.tsx` — read-only v2 area grid.
- `App.tsx` — read-only board + `pass` submit.
- `client/api.ts` — unchanged logic; types follow the v2 engine `Command`.
- `tests/e2e/hotseat.spec.ts` — minimal create/render/persist smoke.

---

## Task 1: Engine contract swap

This task is cohesive: the engine compiles green only once every sub-step is done, because `index.ts` and `types.ts` are mutually entangled with the placeholder files. Do all steps, then verify.

**Files:**

- Modify: `packages/engine/src/types.ts`
- Modify: `packages/engine/src/serialization.ts`
- Modify: `packages/engine/src/view.ts`
- Modify: `packages/engine/src/index.ts`
- Delete: `packages/engine/src/setup.ts`, `packages/engine/src/resolveCommand.ts`, `packages/engine/src/validateCommand.ts`
- Delete: `packages/engine/test/engine.test.ts`
- Create: `packages/engine/test/view.test.ts`, `packages/engine/test/serialization.test.ts`
- Modify: `packages/engine/test/index.test.ts`

- [ ] **Step 1: Trim `types.ts` to primitives**

Replace the entire contents of `packages/engine/src/types.ts` with:

```ts
export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

export type SeatId = "red" | "black";
export type PlayerId = SeatId;
export type GameMode = "hotseat" | "private_multiplayer" | "async_multiplayer";
export type GameStatus = "setup" | "active" | "complete" | "abandoned";
```

- [ ] **Step 2: Rewrite `serialization.ts` for v2**

Replace the entire contents of `packages/engine/src/serialization.ts` with:

```ts
import type { GameState } from "./state.js";

/** JSON-serializable form of a v2 game state (the state is already plain JSON). */
export type JsonGameState = GameState;

export function serializeState(state: GameState): JsonGameState {
  return JSON.parse(JSON.stringify(state)) as JsonGameState;
}

export function deserializeState(json: JsonGameState): GameState {
  if (json.schemaVersion !== 2) {
    throw new Error(`Unsupported game state schema version: ${String(json.schemaVersion)}`);
  }
  return JSON.parse(JSON.stringify(json)) as GameState;
}
```

- [ ] **Step 3: Rewrite `view.ts` for v2**

Replace the entire contents of `packages/engine/src/view.ts` with:

```ts
import { getMap } from "./maps/registry.js";
import { gameBoard } from "./board.js";
import { suppliedAreas } from "./supply.js";
import { victoryPoints } from "./scoring.js";
import { available } from "./legality.js";
import { buildActionSpaces } from "./actionSpaces.js";
import type { AreaKind } from "./maps/riversMap.js";
import type { EndReason, GameState, PendingDecision, Phase, UnitCounts } from "./state.js";
import type { GameMode, GameStatus, SeatId } from "./types.js";
import type { ActionType, BonusType } from "./rules.js";
import type { GameEvent } from "./commands.js";

/** Events as seen by a player. Identity in v1 (perfect information); the seam stays
 *  so future hidden-information redaction has a single choke point. */
export type PlayerGameEvent = GameEvent;

export interface PlayerAreaView {
  id: string;
  kind: AreaKind;
  owner: SeatId | null;
  units: UnitCounts;
  valueStars: 0 | 1 | 2;
  /** Seat that currently supplies this area (at most one at rest), else null. */
  suppliedBy: SeatId | null;
}

export interface LegalSpace {
  spaceId: string;
  type: ActionType;
  /** Linked board area for linked actions; null for support spaces. */
  areaId: string | null;
  /** Deployability flag only: the space is free and the viewer could deploy a
   *  commander here now. This is NOT a full per-action criteria check — a deployable
   *  space may still reject the specific action (e.g. no legal move exists). Richer
   *  per-action target enumeration is deferred to the interactive-UI phase. */
  legal: boolean;
}

export interface LegalCommandSummary {
  activeSeat: SeatId;
  spaces: LegalSpace[];
  canPass: boolean;
}

export interface PlayerGameView {
  schemaVersion: 2;
  gameId: string;
  mapId: string;
  mode: GameMode;
  status: GameStatus;
  round: number;
  phase: Phase;
  initiative: SeatId;
  activeSeat: SeatId;
  viewerSeat: SeatId;
  prompt: string;
  areas: PlayerAreaView[];
  bonuses: Record<string, BonusType>;
  actionSpaces: Record<string, SeatId | null>;
  victoryPoints: Record<SeatId, number>;
  pendingDecision: PendingDecision | null;
  winner: SeatId | null;
  endReason: EndReason | null;
  legal: LegalCommandSummary;
}

export function playerView(state: GameState, viewerSeat: SeatId): PlayerGameView {
  const map = getMap(state.mapId);
  const board = gameBoard(state);

  // Which seat supplies each area (at most one at rest).
  const suppliedBySeat: Record<string, SeatId> = {};
  for (const seat of ["red", "black"] as const) {
    for (const areaId of suppliedAreas(map, board, seat)) {
      suppliedBySeat[areaId] = seat;
    }
  }

  const areas: PlayerAreaView[] = Object.entries(state.areas).map(([id, runtime]) => {
    const mapArea = map.areas[id];
    return {
      id,
      kind: mapArea.kind,
      owner: runtime.owner,
      units: { ...runtime.units },
      valueStars: mapArea.valueStars,
      suppliedBy: suppliedBySeat[id] ?? null
    };
  });

  return {
    schemaVersion: 2,
    gameId: state.gameId,
    mapId: state.mapId,
    mode: state.mode,
    status: state.status,
    round: state.round,
    phase: state.phase,
    initiative: state.initiative,
    activeSeat: state.activeSeat,
    viewerSeat,
    prompt: buildPrompt(state, viewerSeat),
    areas,
    bonuses: { ...state.bonuses },
    actionSpaces: { ...state.actionSpaces },
    victoryPoints: {
      red: victoryPoints(map, board, "red"),
      black: victoryPoints(map, board, "black")
    },
    pendingDecision:
      state.pendingDecision && state.pendingDecision.seat === viewerSeat
        ? state.pendingDecision
        : null,
    winner: state.winner,
    endReason: state.endReason,
    legal: legalCommandsForState(state, viewerSeat)
  };
}

export function legalCommandsForState(state: GameState, seat: SeatId): LegalCommandSummary {
  const map = getMap(state.mapId);
  // Shared deployability gate for every space and for pass.
  const canDeploy =
    state.status === "active" &&
    state.phase === "deploy" &&
    state.activeSeat === seat &&
    state.pendingDecision === null &&
    available(state, seat) > 0;

  const spaces: LegalSpace[] = buildActionSpaces(map).map((space) => ({
    spaceId: space.id,
    type: space.type,
    areaId: space.areaId,
    legal: canDeploy && state.actionSpaces[space.id] === null
  }));

  return { activeSeat: state.activeSeat, spaces, canPass: canDeploy };
}

export function playerEvents(events: GameEvent[]): PlayerGameEvent[] {
  return events;
}

function buildPrompt(state: GameState, viewer: SeatId): string {
  if (state.status === "complete") {
    return state.winner ? `Game over — ${state.winner} wins.` : "Game over.";
  }
  if (state.pendingDecision) {
    return state.pendingDecision.seat === viewer
      ? state.pendingDecision.prompt
      : `Waiting for ${state.pendingDecision.seat}.`;
  }
  return state.activeSeat === viewer
    ? `Round ${state.round}: deploy a commander or pass.`
    : `Waiting for ${state.activeSeat}.`;
}
```

- [ ] **Step 4: Delete the placeholder source files**

```bash
git rm packages/engine/src/setup.ts packages/engine/src/resolveCommand.ts packages/engine/src/validateCommand.ts
```

- [ ] **Step 5: Rewrite `index.ts` to the v2 surface**

Replace the entire contents of `packages/engine/src/index.ts` with:

```ts
export * from "./types.js";
export * from "./rules.js";
export * from "./state.js";
export * from "./game.js";
export * from "./commands.js";
export * from "./resolve.js";
export * from "./view.js";
export * from "./serialization.js";
export * from "./maps/riversMap.js";
export * from "./maps/registry.js";
export * from "./rng.js";
export * from "./supply.js";
export * from "./scoring.js";
```

- [ ] **Step 6: Delete the placeholder engine test**

```bash
git rm packages/engine/test/engine.test.ts
```

- [ ] **Step 7: Add `serialization.test.ts`**

Create `packages/engine/test/serialization.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { createInitialState, deserializeState, serializeState } from "../src/index.js";

describe("v2 serialization", () => {
  it("round-trips a state through serialize -> deserialize", () => {
    const state = createInitialState({ gameId: "g1", seed: "fixed" });
    const restored = deserializeState(serializeState(state));
    expect(restored).toEqual(state);
    expect(restored.schemaVersion).toBe(2);
  });

  it("rejects an unsupported schema version", () => {
    const state = createInitialState({ gameId: "g1", seed: "fixed" });
    const bad = { ...serializeState(state), schemaVersion: 1 } as unknown as ReturnType<
      typeof serializeState
    >;
    expect(() => deserializeState(bad)).toThrow(/schema version/i);
  });
});
```

- [ ] **Step 8: Add `view.test.ts`**

Create `packages/engine/test/view.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { createInitialState, legalCommandsForState, playerView } from "../src/index.js";

describe("playerView (v2)", () => {
  const state = createInitialState({ gameId: "g1", seed: "fixed" });

  it("projects schemaVersion 2 with the viewer seat", () => {
    const view = playerView(state, "red");
    expect(view.schemaVersion).toBe(2);
    expect(view.viewerSeat).toBe("red");
    expect(view.round).toBe(1);
    expect(view.phase).toBe("deploy");
  });

  it("exposes the red HQ (tile9) garrison via owner + units", () => {
    const view = playerView(state, "red");
    const hq = view.areas.find((area) => area.id === "tile9");
    expect(hq).toBeDefined();
    expect(hq?.owner).toBe("red");
    expect(hq?.units.troop).toBe(3);
    expect(hq?.kind).toBe("land");
  });

  it("computes a victory-point tally for both seats", () => {
    const view = playerView(state, "red");
    expect(typeof view.victoryPoints.red).toBe("number");
    expect(typeof view.victoryPoints.black).toBe("number");
  });

  it("redacts a pending decision from the non-owning seat", () => {
    const pending = {
      ...state,
      pendingDecision: { id: "p1", seat: "red" as const, prompt: "choose", choices: [] }
    };
    expect(playerView(pending, "red").pendingDecision?.id).toBe("p1");
    expect(playerView(pending, "black").pendingDecision).toBeNull();
  });

  it("marks free spaces deployable for the active seat and not for the other", () => {
    const active = state.activeSeat;
    const other = active === "red" ? "black" : "red";
    const activeLegal = legalCommandsForState(state, active);
    expect(activeLegal.canPass).toBe(true);
    expect(activeLegal.spaces.some((s) => s.legal)).toBe(true);

    const otherLegal = legalCommandsForState(state, other);
    expect(otherLegal.canPass).toBe(false);
    expect(otherLegal.spaces.every((s) => !s.legal)).toBe(true);
  });
});
```

- [ ] **Step 9: Extend `index.test.ts`**

Replace the entire contents of `packages/engine/test/index.test.ts` with:

```ts
import { describe, expect, it } from "vitest";
import * as engine from "../src/index.js";

describe("engine package exports", () => {
  it("exposes the v2 setup surface", () => {
    expect(typeof engine.createInitialState).toBe("function");
    expect(typeof engine.zeroUnits).toBe("function");
    expect(engine.RIVERS_UNIT_POOL).toEqual({ troop: 25, ship: 10, siege: 0 });
    expect(engine.HQ_STARTING_TROOPS).toBe(3);
  });

  it("createInitialState produces a schemaVersion-2 state via the index", () => {
    const s = engine.createInitialState({ gameId: "g", seed: "s" });
    expect(s.schemaVersion).toBe(2);
  });

  it("exposes the v2 view, command, and serialization surface", () => {
    expect(typeof engine.playerView).toBe("function");
    expect(typeof engine.legalCommandsForState).toBe("function");
    expect(typeof engine.playerEvents).toBe("function");
    expect(typeof engine.resolveCommand).toBe("function");
    expect(typeof engine.serializeState).toBe("function");
    expect(typeof engine.deserializeState).toBe("function");
  });

  it("no longer exposes placeholder symbols", () => {
    const surface = engine as Record<string, unknown>;
    expect(surface.createGame).toBeUndefined();
    expect(surface.spectatorView).toBeUndefined();
    expect(surface.legalCommandsForView).toBeUndefined();
  });
});
```

- [ ] **Step 10: Run the engine test suite**

Run: `pnpm --filter @sengoku-jidai/engine test`
Expected: PASS — all engine suites green (the new `view`/`serialization` suites included; no `placeholder engine` suite).

- [ ] **Step 11: Run the engine typecheck**

Run: `pnpm --filter @sengoku-jidai/engine typecheck`
Expected: PASS — no errors. If a duplicate-export error (TS2308) appears, it means a re-exported module name clashes; reconcile by narrowing that module's `export *` to explicit `export type` lines. (None are expected: `registry.ts` imports `MapDefinition` as type-only and does not re-export it.)

- [ ] **Step 12: Commit**

```bash
git add packages/engine
git commit -m "feat(engine): promote v2 view/serialization and switch the public surface

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 2: Shared v2 command schema

**Files:**

- Modify: `packages/shared/src/schemas.ts`

- [ ] **Step 1: Replace `commandSchema` with the v2 union**

In `packages/shared/src/schemas.ts`, add the move/placement schemas just above `commandSchema` and replace the `commandSchema` declaration. The new region (from `pendingChoiceSchema` through `commandSchema`) reads:

```ts
export const pendingChoiceSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1)
});

const moveSchema = z.object({
  from: z.string().min(1),
  count: z.number().int().positive()
});

const placementSchema = z.object({
  area: z.string().min(1),
  count: z.number().int().positive()
});

export const commandSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("advance"), spaceId: z.string().min(1), moves: z.array(moveSchema) }),
  z.object({ type: z.literal("sail"), spaceId: z.string().min(1), moves: z.array(moveSchema) }),
  z.object({
    type: z.literal("bombard"),
    spaceId: z.string().min(1),
    targetAreaId: z.string().min(1)
  }),
  z.object({
    type: z.literal("shell"),
    spaceId: z.string().min(1),
    targetAreaId: z.string().min(1)
  }),
  z.object({
    type: z.literal("reinforce"),
    spaceId: z.string().min(1),
    placements: z.array(placementSchema)
  }),
  z.object({
    type: z.literal("embark"),
    spaceId: z.string().min(1),
    placements: z.array(placementSchema)
  }),
  z.object({ type: z.literal("plan"), spaceId: z.string().min(1) }),
  z.object({ type: z.literal("pass") }),
  z.object({
    type: z.literal("choosePendingDecision"),
    pendingId: z.string().min(1),
    choice: pendingChoiceSchema
  })
]);
```

(The `pendingChoiceSchema` already exists — keep a single copy; only `moveSchema`, `placementSchema`, and the `commandSchema` body change.)

- [ ] **Step 2: Typecheck shared**

Run: `pnpm --filter @sengoku-jidai/shared typecheck`
Expected: PASS — `CommandDto` now infers the v2 union; no errors.

- [ ] **Step 3: Build the libs (republish engine + shared `dist`)**

Run: `pnpm build:libs`
Expected: PASS — engine and shared compile to `dist/`.

- [ ] **Step 4: Commit**

```bash
git add packages/shared
git commit -m "feat(shared): replace command schema with the v2 command union

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 3: Server migration

**Files:**

- Modify: `packages/server/src/persistence/repository.ts`
- Modify: `packages/server/test/server.test.ts`

- [ ] **Step 1: Swap the engine import**

In `packages/server/src/persistence/repository.ts`, change the import block (currently lines 1–15) so `createGame` becomes `createInitialState`:

```ts
import {
  createInitialState,
  deserializeState,
  playerEvents,
  playerView,
  resolveCommand,
  serializeState,
  type Command,
  type GameEvent,
  type GameMode,
  type GameState,
  type PlayerGameEvent,
  type PlayerGameView,
  type SeatId
} from "@sengoku-jidai/engine";
```

- [ ] **Step 2: Build the v2 initial state with a guaranteed seed**

In the `createGame(mode: GameMode, seed?: string)` method, replace the line:

```ts
const state = createGame({ gameId, mode, seed });
```

with (note: v2 `createInitialState` requires `seed`, so generate one when absent):

```ts
const state = createInitialState({ gameId, mode, seed: seed ?? randomUUID() });
```

- [ ] **Step 3: Update the `resolveCommand` call to the v2 signature**

In `submitCommand`, replace the call (currently lines 204–209):

```ts
const result = resolveCommand(
  state,
  { seat: session.seat, playerId: session.seat },
  command,
  state.rules
);
```

with (v2 `CommandActor` is `{ seat }`; there is no `rules` parameter):

```ts
const result = resolveCommand(state, { seat: session.seat }, command);
```

- [ ] **Step 4: Update the server test to a real v2 command**

Replace the body of the `it("creates a hotseat game and accepts a command", ...)` test in `packages/server/test/server.test.ts` with one that passes as the active seat (initiative is seed-dependent):

```ts
it("creates a hotseat game and accepts a command", async () => {
  const app = buildApp(testConfig());

  const created = await app.inject({
    method: "POST",
    url: "/api/games",
    payload: { mode: "hotseat", seed: "test" }
  });
  expect(created.statusCode).toBe(200);
  const body = created.json();
  expect(body.revision).toBe(0);

  const activeSeat = body.view.activeSeat as "red" | "black";
  const token = body.seats.find((seat: { seat: string }) => seat.seat === activeSeat).token;

  const command = await app.inject({
    method: "POST",
    url: `/api/games/${body.gameId}/commands`,
    headers: {
      authorization: `Bearer ${token}`
    },
    payload: {
      baseRevision: 0,
      clientCommandId: "test-command-1",
      command: { type: "pass" }
    }
  });

  expect(command.statusCode).toBe(200);
  expect(command.json().revision).toBe(1);
  await app.close();
});
```

- [ ] **Step 5: Typecheck the workspace and run the server test**

Run: `pnpm typecheck`
Expected: PASS — `pnpm typecheck` runs `build:libs` first, then typechecks every package. The server compiles against the v2 engine surface (`CommandDto` is assignable to the engine `Command`).

Run: `pnpm --filter @sengoku-jidai/server test`
Expected: PASS — the hotseat-create-and-pass test is green.

- [ ] **Step 6: Commit**

```bash
git add packages/server
git commit -m "feat(server): migrate persistence to the v2 engine surface

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 4: Web minimal read-only client

**Files:**

- Modify: `packages/web/src/components/board/Board.tsx`
- Modify: `packages/web/src/App.tsx`
- Modify: `tests/e2e/hotseat.spec.ts`

- [ ] **Step 1: Rewrite `Board.tsx` as a read-only v2 area grid**

Replace the entire contents of `packages/web/src/components/board/Board.tsx` with:

```tsx
import type { PlayerAreaView, SeatId } from "@sengoku-jidai/engine";

interface BoardProps {
  areas: PlayerAreaView[];
  activeSeat: SeatId;
  selectedAreaId: string | null;
  onSelectArea: (areaId: string) => void;
}

export function Board({ areas, activeSeat, selectedAreaId, onSelectArea }: BoardProps) {
  return (
    <section className="board" data-testid="board" aria-label="Sengoku Jidai battlefield">
      <ul className="area-grid">
        {areas.map((area) => {
          const selected = selectedAreaId === area.id;
          const ownerClass = area.owner ? `area-${area.owner}` : "area-neutral";
          return (
            <li key={area.id}>
              <button
                type="button"
                className={`area-card ${ownerClass} ${selected ? "area-selected" : ""}`}
                data-testid={`area-${area.id}`}
                aria-pressed={selected}
                onClick={() => onSelectArea(area.id)}
              >
                <span className="area-card-id">{area.id}</span>
                <span className="area-card-kind">{area.kind}</span>
                <span className="area-card-owner">{area.owner ?? "unclaimed"}</span>
                <span className="area-card-units">
                  {area.units.troop}t / {area.units.ship}s
                </span>
                {area.valueStars > 0 ? (
                  <span className="area-card-stars">{"★".repeat(area.valueStars)}</span>
                ) : null}
              </button>
            </li>
          );
        })}
      </ul>
      <p className="board-status">Active seat: {activeSeat}</p>
    </section>
  );
}
```

- [ ] **Step 2: Rewrite `App.tsx` for the v2 view + pass submit**

Replace the entire contents of `packages/web/src/App.tsx` with:

```tsx
import type {
  PlayerAreaView,
  PlayerGameEvent,
  PlayerGameView,
  SeatId
} from "@sengoku-jidai/engine";
import { useEffect, useMemo, useState } from "react";
import { Board } from "./components/board/Board.js";
import { ApiError, createHotseatGame, fetchGameView, submitCommand } from "./client/api.js";
import {
  clearStoredGame,
  loadStoredGame,
  saveStoredGame,
  type StoredGame
} from "./state/localGame.js";

interface LoadedGame extends StoredGame {
  revision: number;
  view: PlayerGameView;
}

export function App() {
  const [game, setGame] = useState<LoadedGame | null>(null);
  const [selectedAreaId, setSelectedAreaId] = useState<string | null>(null);
  const [events, setEvents] = useState<PlayerGameEvent[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const stored = loadStoredGame();
    if (!stored) {
      return;
    }

    const token = stored.seats.find((seat) => seat.seat === stored.activeSeat)?.token;
    if (!token) {
      clearStoredGame();
      return;
    }

    void fetchGameView(stored.gameId, token)
      .then((envelope) => {
        setGame({ ...stored, revision: envelope.revision, view: envelope.view });
      })
      .catch(() => {
        clearStoredGame();
      });
  }, []);

  const selectedArea = useMemo(
    () => game?.view.areas.find((area) => area.id === selectedAreaId) ?? null,
    [game?.view.areas, selectedAreaId]
  );

  async function handleCreateGame() {
    setBusy(true);
    setError(null);
    try {
      const created = await createHotseatGame();
      const stored: StoredGame = {
        gameId: created.gameId,
        activeSeat: created.seat,
        seats: created.seats
      };
      saveStoredGame(stored);
      setGame({ ...stored, revision: created.revision, view: created.view });
      setSelectedAreaId(null);
      setEvents([]);
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusy(false);
    }
  }

  async function handleSwitchSeat(seat: SeatId) {
    if (!game) {
      return;
    }
    const token = game.seats.find((seatToken) => seatToken.seat === seat)?.token;
    if (!token) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const envelope = await fetchGameView(game.gameId, token);
      const stored = { gameId: game.gameId, activeSeat: seat, seats: game.seats };
      saveStoredGame(stored);
      setGame({ ...stored, revision: envelope.revision, view: envelope.view });
      setSelectedAreaId(null);
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusy(false);
    }
  }

  async function handlePass() {
    if (!game) {
      return;
    }
    const token = game.seats.find((seat) => seat.seat === game.activeSeat)?.token;
    if (!token) {
      setError("Missing seat token.");
      return;
    }

    setBusy(true);
    setError(null);
    try {
      const response = await submitCommand(game.gameId, token, game.revision, { type: "pass" });
      if (response.view) {
        setGame({ ...game, revision: response.revision, view: response.view });
      }
      setEvents((previous) => [...(response.events ?? []), ...previous].slice(0, 8));
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusy(false);
    }
  }

  if (!game) {
    return (
      <main className="app-shell app-empty">
        <section className="start-panel" aria-label="Start game">
          <h1>General Orders: Sengoku Jidai</h1>
          <button type="button" onClick={handleCreateGame} disabled={busy}>
            {busy ? "Creating..." : "New hotseat game"}
          </button>
          {error ? <p className="error-text">{error}</p> : null}
        </section>
      </main>
    );
  }

  const isViewerActive = game.view.activeSeat === game.activeSeat;

  return (
    <main className="app-shell">
      <header className="top-bar">
        <div>
          <h1>General Orders: Sengoku Jidai</h1>
          <p>{game.view.prompt}</p>
        </div>
        <div className="top-stats" aria-label="Game status">
          <span>Round {game.view.round}</span>
          <span>{game.view.phase}</span>
          <span>Revision {game.revision}</span>
          <span>{game.view.activeSeat} to act</span>
          <span>
            VP {game.view.victoryPoints.red}–{game.view.victoryPoints.black}
          </span>
        </div>
      </header>

      <section className="game-layout">
        <Board
          areas={game.view.areas}
          activeSeat={game.view.activeSeat}
          selectedAreaId={selectedAreaId}
          onSelectArea={setSelectedAreaId}
        />

        <aside className="side-panel" aria-label="Command panel">
          <div className="seat-switcher" role="group" aria-label="Seat">
            {game.seats.map((seat) => (
              <button
                key={seat.seat}
                type="button"
                className={seat.seat === game.activeSeat ? "is-active" : ""}
                onClick={() => handleSwitchSeat(seat.seat)}
                disabled={busy}
              >
                {seat.seat}
              </button>
            ))}
          </div>

          <section className="panel-section">
            <h2>{selectedArea ? selectedArea.id : "Select an area"}</h2>
            {selectedArea ? (
              <dl className="area-details">
                <div>
                  <dt>Owner</dt>
                  <dd>{selectedArea.owner ?? "none"}</dd>
                </div>
                <div>
                  <dt>Units</dt>
                  <dd>
                    {selectedArea.units.troop} troops, {selectedArea.units.ship} ships
                  </dd>
                </div>
                <div>
                  <dt>Value</dt>
                  <dd>{selectedArea.valueStars} stars</dd>
                </div>
                <div>
                  <dt>Supplied by</dt>
                  <dd>{selectedArea.suppliedBy ?? "none"}</dd>
                </div>
              </dl>
            ) : (
              <p className="muted">Area details appear here. Interactive commands come later.</p>
            )}
            <button
              type="button"
              onClick={handlePass}
              disabled={busy || !isViewerActive || !game.view.legal.canPass}
            >
              Pass
            </button>
          </section>

          <section className="panel-section">
            <h2>Recent events</h2>
            {events.length === 0 ? (
              <p className="muted">No commands submitted yet.</p>
            ) : (
              <ol className="event-log">
                {events.map((event, index) => (
                  <li key={`${event.type}-${index}`}>{eventLabel(event)}</li>
                ))}
              </ol>
            )}
          </section>

          <button
            type="button"
            className="secondary-action"
            onClick={() => {
              clearStoredGame();
              setGame(null);
            }}
          >
            Clear local game
          </button>

          {error ? <p className="error-text">{error}</p> : null}
        </aside>
      </section>
    </main>
  );
}

function eventLabel(event: PlayerGameEvent): string {
  if ("seat" in event && typeof event.seat === "string") {
    return `${event.seat}: ${event.type}`;
  }
  return event.type;
}

function errorMessage(caught: unknown): string {
  if (caught instanceof ApiError) {
    const body = caught.body as { error?: { message?: string } };
    return body.error?.message ?? caught.message;
  }
  if (caught instanceof Error) {
    return caught.message;
  }
  return "Unexpected error.";
}
```

(`PlayerAreaView` stays imported — `selectedArea` is typed from it via `view.areas`. `client/api.ts` needs no change: it already imports `Command`, `PlayerGameEvent`, `PlayerGameView` from the engine, which now resolve to the v2 types.)

- [ ] **Step 3: Update the e2e smoke to the read-only flow**

Replace the entire contents of `tests/e2e/hotseat.spec.ts` with (the active seat is seed-dependent, so the smoke verifies create + render + persistence, not a turn-specific command):

```ts
import { expect, test } from "@playwright/test";

test("creates a hotseat game, renders the board, and restores after refresh", async ({ page }) => {
  await page.goto("/");

  await page.getByRole("button", { name: "New hotseat game" }).click();
  await expect(page.getByTestId("board")).toBeVisible();
  await expect(page.getByText("Round 1")).toBeVisible();

  await page.reload();
  await expect(page.getByTestId("board")).toBeVisible();
  await expect(page.getByText("Round 1")).toBeVisible();
});
```

- [ ] **Step 4: Typecheck and build the web package**

Run: `pnpm --filter @sengoku-jidai/web typecheck`
Expected: PASS — no errors against the v2 engine types.

Run: `pnpm --filter @sengoku-jidai/web build`
Expected: PASS — `tsc` + `vite build` succeed.

- [ ] **Step 5: Commit**

```bash
git add packages/web tests/e2e/hotseat.spec.ts
git commit -m "feat(web): render the v2 read-only board and submit pass

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 5: Whole-workspace verification

**Files:** none (verification + optional style fixups only).

- [ ] **Step 1: Format**

Run: `pnpm format`
Expected: prettier rewrites any unformatted files (no-op if already clean).

- [ ] **Step 2: Lint**

Run: `pnpm lint`
Expected: PASS — no eslint errors.

- [ ] **Step 3: Typecheck the whole workspace**

Run: `pnpm typecheck`
Expected: PASS — every package typechecks against the v2 surface.

- [ ] **Step 4: Build the whole workspace**

Run: `pnpm build`
Expected: PASS — engine, shared, server, and web all build.

- [ ] **Step 5: Run all unit/integration tests**

Run: `pnpm test`
Expected: PASS — engine (v2 suites), server, shared, web all green.

- [ ] **Step 6: Manual smoke (optional but recommended)**

Run: `pnpm dev`
Open the printed web URL, click **New hotseat game**, and confirm the board renders real Rivers areas (tile ids, owner, unit counts), the header shows Round 1 / phase / VP, and **Pass** advances the revision when viewing the active seat. Stop with Ctrl-C.

- [ ] **Step 7: Commit any format/lint fixups**

```bash
git add -A
git commit -m "chore: workspace lint/format after the v2 contract swap

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>" || echo "nothing to commit"
```

- [ ] **Step 8: Update the roadmap memory**

Mark Plan 4 done in `/Users/martin/.claude/projects/-Users-martin-repos-sengoku-jidai/memory/engine-rebuild-roadmap.md`: the placeholder engine is fully removed, the v2 model is the public surface, shared carries the v2 command union, server + minimal read-only web are migrated, and the full interactive Rivers UI + WebSocket realtime remain deferred to a later phase.

---

## Notes for the implementer

- **DRY/YAGNI:** `spectatorView` and `legalCommandsForView` are intentionally dropped (unused). Do not re-add them.
- **Lean `legal`:** `LegalSpace.legal` is a _deployability_ flag (free space + viewer can deploy), not a per-action criteria check. Keep the documenting comment; do not enumerate per-action targets in this plan — that is a later phase.
- **No production data:** the dev SQLite DB is disposable. If a stale schema-1 snapshot ever errors on load, `pnpm db:reset` clears it.
- **Whole-workspace commands republish dist:** `pnpm typecheck`, `pnpm test`, and `pnpm build` run `build:libs` first, so downstream packages always see the latest engine/shared `dist`.

```

```
