# Movement Orders in the UI — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a player issue **Advance** and **Sail** orders from the interactive SVG board, instead of only `pass`.

**Architecture:** One additive engine change surfaces legal movement options (target + sources + per-source max) on the existing `legal` payload; the web adds a target-first composition flow (map glow + a panel order-composer) that builds and submits `advance`/`sail` commands through the existing `submitCommand` transport. Engine logic stays the single source of truth — the web never re-derives legality.

**Tech Stack:** TypeScript, React (web), Vitest (engine unit tests), Playwright (e2e), pnpm workspace.

**Spec:** `docs/superpowers/specs/2026-06-21-movement-orders-ui-design.md`

**Conventions:** engine tests live in `packages/engine/test/`; engine unit tests are TDD. The web has no unit-test harness in this repo — front-end tasks are verified by typecheck/build incrementally and by the Playwright acceptance test in Task 7 (matches the existing e2e-smoke pattern). The map-overlay coordinate rule (`getScreenCTM`, never `getCTM()`) documented in `MapBoard.tsx` must be respected for any overlay drawing.

---

## Task 1: Engine — enumerate legal movement options on the `legal` payload

**Files:**
- Modify: `packages/engine/src/view.ts`
- Test: `packages/engine/test/view.test.ts`

- [ ] **Step 1: Write the failing tests**

Add these tests inside the existing `describe("playerView (v2)", () => { ... })` block in `packages/engine/test/view.test.ts` (the `state` const is already defined there as `createInitialState({ gameId: "g1", seed: "fixed" })`):

```ts
  it("enumerates advance/sail moves for the active seat with max = units - 1", () => {
    // seed "fixed": active = red; HQ tile9 has 3 troops; navy tile14 has 2 ships.
    expect(state.activeSeat).toBe("red");
    const summary = legalCommandsForState(state, state.activeSeat);

    expect(summary.moves.some((m) => m.type === "advance")).toBe(true);
    expect(summary.moves.some((m) => m.type === "sail")).toBe(true);

    // tile9 (3 troops) feeds an advance into adjacent tile1, capped at 2.
    expect(summary.moves.find((m) => m.targetAreaId === "tile1")).toMatchObject({
      spaceId: "advance-tile1",
      type: "advance",
      sources: [{ areaId: "tile9", max: 2 }]
    });

    // tile14 (2 ships) feeds a sail into adjacent tile15, capped at 1.
    expect(summary.moves.find((m) => m.targetAreaId === "tile15")).toMatchObject({
      spaceId: "sail-tile15",
      type: "sail",
      sources: [{ areaId: "tile14", max: 1 }]
    });
  });

  it("never lists a movement target the seat already controls", () => {
    const summary = legalCommandsForState(state, state.activeSeat);
    for (const move of summary.moves) {
      expect(state.areas[move.targetAreaId]!.owner).not.toBe(state.activeSeat);
    }
  });

  it("gives the non-active seat no moves", () => {
    const other = state.activeSeat === "red" ? "black" : "red";
    expect(legalCommandsForState(state, other).moves).toEqual([]);
  });

  it("excludes a source that has only one unit (cannot move the last unit)", () => {
    const drained = structuredClone(state);
    drained.areas.tile9!.units.troop = 1;
    const sources = legalCommandsForState(drained, "red").moves.flatMap((m) =>
      m.sources.map((s) => s.areaId)
    );
    expect(sources).not.toContain("tile9");
  });

  it("excludes a movement target whose action space is already occupied", () => {
    const occupied = structuredClone(state);
    occupied.actionSpaces["advance-tile1"] = "red";
    const summary = legalCommandsForState(occupied, "red");
    expect(summary.moves.find((m) => m.spaceId === "advance-tile1")).toBeUndefined();
  });

  it("returns no moves outside the deploy phase", () => {
    const recall = structuredClone(state);
    recall.phase = "recall";
    expect(legalCommandsForState(recall, "red").moves).toEqual([]);
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `corepack pnpm --filter @sengoku-jidai/engine test`
Expected: FAIL — `summary.moves` is `undefined` (property does not exist yet), e.g. `TypeError: Cannot read properties of undefined (reading 'some')`.

- [ ] **Step 3: Implement the `moves` enumeration in `view.ts`**

In `packages/engine/src/view.ts`, change the legality import (currently `import { available } from "./legality.js";`) to:

```ts
import { advanceSources, available, sailReachable } from "./legality.js";
```

Add this interface immediately after the `LegalSpace` interface:

```ts
export interface LegalMove {
  /** Linked action space to deploy into: "advance-<land>" | "sail-<sea>". */
  spaceId: string;
  type: "advance" | "sail";
  /** Linked land (advance) or sea (sail) the units move INTO. */
  targetAreaId: string;
  /** Legal source areas; `max` is the units there minus one (a source keeps one unit). */
  sources: { areaId: string; max: number }[];
}
```

Add `moves` to the `LegalCommandSummary` interface:

```ts
export interface LegalCommandSummary {
  activeSeat: SeatId;
  spaces: LegalSpace[];
  canPass: boolean;
  moves: LegalMove[];
}
```

Replace the body of `legalCommandsForState` and append the helper. The function becomes:

```ts
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

  return {
    activeSeat: state.activeSeat,
    spaces,
    canPass: canDeploy,
    moves: canDeploy ? enumerateMoves(state, seat) : []
  };
}

/** Movement targets the seat can deploy into now, each with its legal sources and the
 *  max units each source can spare (units there - 1; a source must keep one unit). */
function enumerateMoves(state: GameState, seat: SeatId): LegalMove[] {
  const map = getMap(state.mapId);
  const board = gameBoard(state);
  const moves: LegalMove[] = [];
  for (const space of buildActionSpaces(map)) {
    if (space.type !== "advance" && space.type !== "sail") continue;
    if (state.actionSpaces[space.id] !== null) continue;
    if (!state.rules.enabledActions.includes(space.type)) continue;
    const target = space.areaId!;
    if (state.areas[target]?.owner === seat) continue;
    const unit = space.type === "advance" ? "troop" : "ship";
    const reachable =
      space.type === "advance"
        ? advanceSources(map, board, seat, target)
        : sailReachable(map, board, seat, target);
    const sources = [...reachable]
      .map((areaId) => ({ areaId, max: (state.areas[areaId]?.units[unit] ?? 0) - 1 }))
      .filter((s) => s.max >= 1);
    if (sources.length > 0) {
      moves.push({ spaceId: space.id, type: space.type, targetAreaId: target, sources });
    }
  }
  return moves;
}
```

(`gameBoard` and `buildActionSpaces` are already imported in `view.ts`.)

- [ ] **Step 4: Run the tests to verify they pass**

Run: `corepack pnpm --filter @sengoku-jidai/engine test`
Expected: PASS — all engine tests green (existing + the 6 new cases).

- [ ] **Step 5: Commit**

```bash
git add packages/engine/src/view.ts packages/engine/test/view.test.ts
git commit -m "feat(engine): enumerate legal advance/sail moves on the legal payload"
```

---

## Task 2: Web — target/source highlighting in `MapBoard`

**Files:**
- Modify: `packages/web/src/components/board/MapBoard.tsx`

- [ ] **Step 1: Add the new props to `MapBoardProps`**

In `packages/web/src/components/board/MapBoard.tsx`, extend the interface:

```ts
export interface MapBoardProps {
  areas: PlayerAreaView[];
  activeSeat: SeatId;
  selectedAreaId: string | null;
  actionSpaces: Record<string, SeatId | null>;
  onSelectArea: (areaId: string) => void;
  legalTargetIds?: ReadonlySet<string>;
  sourceIds?: ReadonlySet<string>;
  onSourceClick?: (areaId: string) => void;
}
```

- [ ] **Step 2: Add a CSS-styled outline helper**

Add this function just above `makeSelectionOutline`:

```ts
/** A tile outline clone pinned to the tile's on-screen position via its local->root
 *  matrix (overlay is in root space), styled entirely by `className` (stroke colour and
 *  width live in CSS). Used for the target/source glow rings. */
function makeOutline(
  svg: SVGSVGElement,
  tile: SVGGraphicsElement,
  className: string
): SVGElement | null {
  const m = localToRoot(svg, tile);
  if (!m) {
    return null;
  }
  const outline = tile.cloneNode(false) as SVGElement;
  outline.removeAttribute("id");
  outline.setAttribute("class", className);
  outline.setAttribute("transform", `matrix(${m.a} ${m.b} ${m.c} ${m.d} ${m.e} ${m.f})`);
  outline.style.fill = "none";
  return outline;
}
```

- [ ] **Step 3: Thread the props through `DecorateInput` and `decorate`**

Extend `DecorateInput`:

```ts
interface DecorateInput {
  areas: PlayerAreaView[];
  selectedAreaId: string | null;
  actionSpaces: Record<string, SeatId | null>;
  onSelectArea: (areaId: string) => void;
  legalTargetIds?: ReadonlySet<string>;
  sourceIds?: ReadonlySet<string>;
  onSourceClick?: (areaId: string) => void;
}
```

Change the `decorate` signature destructuring to:

```ts
function decorate(
  svg: SVGSVGElement,
  {
    areas,
    selectedAreaId,
    actionSpaces,
    onSelectArea,
    legalTargetIds,
    sourceIds,
    onSourceClick
  }: DecorateInput
): void {
```

Inside the `for (const area of areas)` loop, replace the existing click-handler line
(`tile.onclick = () => onSelectArea(area.id);`) and the selection block with:

```ts
    const isTarget = legalTargetIds?.has(area.id) ?? false;
    const isSource = sourceIds?.has(area.id) ?? false;
    if (isTarget) {
      tile.dataset.legalTarget = "true";
    } else {
      delete tile.dataset.legalTarget;
    }
    if (isSource) {
      tile.dataset.source = "true";
    } else {
      delete tile.dataset.source;
    }
    tile.onclick = () => {
      onSelectArea(area.id);
      if (sourceIds?.has(area.id)) {
        onSourceClick?.(area.id);
      }
    };

    if (area.id === selectedAreaId) {
      const outline = makeSelectionOutline(svg, tile);
      if (outline) {
        overlay.appendChild(outline);
      }
    }
    if (isTarget) {
      const glow = makeOutline(svg, tile, "tile-legal-target");
      if (glow) {
        overlay.appendChild(glow);
      }
    }
    if (isSource) {
      const glow = makeOutline(svg, tile, "tile-source");
      if (glow) {
        overlay.appendChild(glow);
      }
    }
```

- [ ] **Step 4: Pass the new props through the component + effect deps**

Update the `MapBoard` function signature destructuring:

```ts
export function MapBoard({
  areas,
  activeSeat,
  selectedAreaId,
  actionSpaces,
  onSelectArea,
  legalTargetIds,
  sourceIds,
  onSourceClick
}: MapBoardProps) {
```

Update the re-decorate effect to pass and depend on them:

```ts
  // Re-decorate whenever state changes.
  useEffect(() => {
    const svg = hostRef.current?.querySelector("svg");
    if (svg) {
      decorate(svg, {
        areas,
        selectedAreaId,
        actionSpaces,
        onSelectArea,
        legalTargetIds,
        sourceIds,
        onSourceClick
      });
    }
  }, [areas, selectedAreaId, actionSpaces, onSelectArea, legalTargetIds, sourceIds, onSourceClick]);
```

- [ ] **Step 5: Verify it typechecks/builds**

Run: `corepack pnpm --filter @sengoku-jidai/web typecheck`
Expected: PASS (no type errors). The new props are optional, so existing call sites still compile.

- [ ] **Step 6: Commit**

```bash
git add packages/web/src/components/board/MapBoard.tsx
git commit -m "feat(web): target/source glow + data hooks in MapBoard"
```

---

## Task 3: Web — the `OrderComposer` panel component

**Files:**
- Create: `packages/web/src/components/board/OrderComposer.tsx`

- [ ] **Step 1: Create the component**

Create `packages/web/src/components/board/OrderComposer.tsx`:

```tsx
export interface ComposerState {
  spaceId: string;
  type: "advance" | "sail";
  targetAreaId: string;
  sources: { areaId: string; max: number }[];
  counts: Record<string, number>;
}

interface OrderComposerProps {
  composer: ComposerState;
  busy: boolean;
  onAdjust: (areaId: string, delta: number) => void;
  onConfirm: () => void;
  onCancel: () => void;
}

const VERB: Record<ComposerState["type"], string> = { advance: "Advance", sail: "Sail" };
const UNIT: Record<ComposerState["type"], string> = { advance: "troops", sail: "ships" };

export function OrderComposer({ composer, busy, onAdjust, onConfirm, onCancel }: OrderComposerProps) {
  const total = composer.sources.reduce(
    (sum, source) => sum + (composer.counts[source.areaId] ?? 0),
    0
  );

  return (
    <div className="order-composer">
      <h2>
        {VERB[composer.type]} into {composer.targetAreaId}
      </h2>
      <p className="muted">Choose how many {UNIT[composer.type]} to move (each source keeps one).</p>
      <ul className="source-list">
        {composer.sources.map((source) => {
          const count = composer.counts[source.areaId] ?? 0;
          return (
            <li key={source.areaId} data-source-row={source.areaId}>
              <span className="source-name">{source.areaId}</span>
              <span className="stepper">
                <button
                  type="button"
                  onClick={() => onAdjust(source.areaId, -1)}
                  disabled={busy || count <= 0}
                  aria-label={`Fewer from ${source.areaId}`}
                >
                  &minus;
                </button>
                <span className="stepper-count">{count}</span>
                <button
                  type="button"
                  onClick={() => onAdjust(source.areaId, 1)}
                  disabled={busy || count >= source.max}
                  aria-label={`More from ${source.areaId}`}
                >
                  +
                </button>
              </span>
              <span className="source-max">/ {source.max}</span>
            </li>
          );
        })}
      </ul>
      <p className="composer-total">
        Moving {total} {UNIT[composer.type]}
      </p>
      <div className="composer-actions">
        <button type="button" onClick={onConfirm} disabled={busy || total < 1}>
          Confirm {VERB[composer.type]}
        </button>
        <button type="button" className="secondary-action" onClick={onCancel} disabled={busy}>
          Cancel
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verify it typechecks**

Run: `corepack pnpm --filter @sengoku-jidai/web typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add packages/web/src/components/board/OrderComposer.tsx
git commit -m "feat(web): add OrderComposer panel component"
```

---

## Task 4: Web — "Advance/Sail into X" call-to-action in `AreaDetails`

**Files:**
- Modify: `packages/web/src/components/board/AreaDetails.tsx`

- [ ] **Step 1: Add the `LegalMove` import and the `onStartOrder` prop**

In `packages/web/src/components/board/AreaDetails.tsx`, change the import line to add `LegalMove`:

```ts
import type { LegalMove, MapArea, PlayerAreaView, PlayerGameView } from "@sengoku-jidai/engine";
```

Extend the props interface:

```ts
interface AreaDetailsProps {
  area: PlayerAreaView;
  mapArea: MapArea;
  view: PlayerGameView;
  onStartOrder?: (move: LegalMove) => void;
}
```

- [ ] **Step 2: Render the CTA when the selected area is a legal movement target**

Update the component signature to destructure `onStartOrder`:

```ts
export function AreaDetails({ area, mapArea, view, onStartOrder }: AreaDetailsProps) {
```

Just below the existing `const actions = ...` block, add:

```ts
  const move = view.legal.moves.find((candidate) => candidate.targetAreaId === area.id) ?? null;
```

Then, immediately before the closing `</>` of the returned fragment, add the CTA:

```tsx
      {move && onStartOrder ? (
        <button type="button" className="start-order" onClick={() => onStartOrder(move)}>
          {move.type === "advance" ? "Advance" : "Sail"} into {move.targetAreaId}
        </button>
      ) : null}
```

- [ ] **Step 3: Verify it typechecks**

Run: `corepack pnpm --filter @sengoku-jidai/web typecheck`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add packages/web/src/components/board/AreaDetails.tsx
git commit -m "feat(web): add advance/sail call-to-action to AreaDetails"
```

---

## Task 5: Web — order-composition state machine in `App`

**Files:**
- Modify: `packages/web/src/App.tsx`

- [ ] **Step 1: Add imports for the composer + LegalMove**

In `packages/web/src/App.tsx`, change the engine type import to add `LegalMove`:

```ts
import type { LegalMove, PlayerGameEvent, PlayerGameView, SeatId } from "@sengoku-jidai/engine";
```

Add an import for the composer component and its state type (place beside the other board-component imports):

```ts
import { OrderComposer, type ComposerState } from "./components/board/OrderComposer.js";
```

- [ ] **Step 2: Add composer state and derived highlight sets**

Add the composer state next to the other `useState` hooks (e.g. after `selectedAreaId`):

```ts
  const [composer, setComposer] = useState<ComposerState | null>(null);
```

Add these memoised sets after the existing `selectedMapArea` memo:

```ts
  const legalTargetIds = useMemo(
    () => new Set(composer ? [] : (game?.view.legal.moves ?? []).map((m) => m.targetAreaId)),
    [composer, game?.view.legal.moves]
  );
  const sourceIds = useMemo(
    () => new Set(composer ? composer.sources.map((s) => s.areaId) : []),
    [composer]
  );
```

- [ ] **Step 3: Add the order handlers**

Add these functions inside the component (e.g. just before `handlePass`):

```ts
  function startOrder(move: LegalMove) {
    setComposer({
      spaceId: move.spaceId,
      type: move.type,
      targetAreaId: move.targetAreaId,
      sources: move.sources.map((s) => ({ areaId: s.areaId, max: s.max })),
      counts: {}
    });
  }

  function adjustSource(areaId: string, delta: number) {
    setComposer((prev) => {
      if (!prev) {
        return prev;
      }
      const source = prev.sources.find((s) => s.areaId === areaId);
      if (!source) {
        return prev;
      }
      const next = Math.min(Math.max((prev.counts[areaId] ?? 0) + delta, 0), source.max);
      return { ...prev, counts: { ...prev.counts, [areaId]: next } };
    });
  }

  async function handleConfirmOrder() {
    if (!game || !composer) {
      return;
    }
    const token = game.seats.find((seat) => seat.seat === game.activeSeat)?.token;
    if (!token) {
      setError("Missing seat token.");
      return;
    }
    const moves = composer.sources
      .map((s) => ({ from: s.areaId, count: composer.counts[s.areaId] ?? 0 }))
      .filter((m) => m.count > 0);
    if (moves.length === 0) {
      return;
    }

    setBusy(true);
    setError(null);
    try {
      const response = await submitCommand(game.gameId, token, game.revision, {
        type: composer.type,
        spaceId: composer.spaceId,
        moves
      });
      if (response.view) {
        setGame({ ...game, revision: response.revision, view: response.view });
      }
      setEvents((previous) => [...(response.events ?? []), ...previous].slice(0, 8));
      setComposer(null);
      setSelectedAreaId(null);
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusy(false);
    }
  }
```

- [ ] **Step 4: Reset the composer on game create / seat switch**

In `handleCreateGame`, after `setSelectedAreaId(null);` add:

```ts
      setComposer(null);
```

In `handleSwitchSeat`, after `setSelectedAreaId(null);` add:

```ts
      setComposer(null);
```

- [ ] **Step 5: Wire the highlight props into `MapBoard`**

Replace the `<MapBoard ... />` element with:

```tsx
        <MapBoard
          areas={game.view.areas}
          activeSeat={game.view.activeSeat}
          selectedAreaId={selectedAreaId}
          actionSpaces={game.view.actionSpaces}
          onSelectArea={setSelectedAreaId}
          legalTargetIds={legalTargetIds}
          sourceIds={sourceIds}
          onSourceClick={(areaId) => adjustSource(areaId, 1)}
        />
```

- [ ] **Step 6: Show the composer (or area details + pass) in the panel**

Replace the existing `<section className="panel-section">` block that holds the area heading, `AreaDetails`, and the Pass button with:

```tsx
          <section className="panel-section">
            {composer ? (
              <OrderComposer
                composer={composer}
                busy={busy}
                onAdjust={adjustSource}
                onConfirm={handleConfirmOrder}
                onCancel={() => setComposer(null)}
              />
            ) : (
              <>
                <h2>{selectedArea ? selectedArea.id : "Select an area"}</h2>
                {selectedArea && selectedMapArea ? (
                  <AreaDetails
                    area={selectedArea}
                    mapArea={selectedMapArea}
                    view={game.view}
                    onStartOrder={isViewerActive ? startOrder : undefined}
                  />
                ) : (
                  <p className="muted">Select an area to see its details.</p>
                )}
                <button
                  type="button"
                  onClick={handlePass}
                  disabled={busy || !isViewerActive || !game.view.legal.canPass}
                >
                  Pass
                </button>
              </>
            )}
          </section>
```

- [ ] **Step 7: Verify it typechecks and builds**

Run: `corepack pnpm --filter @sengoku-jidai/web typecheck && corepack pnpm --filter @sengoku-jidai/web build`
Expected: PASS — clean typecheck and a successful Vite build.

- [ ] **Step 8: Commit**

```bash
git add packages/web/src/App.tsx
git commit -m "feat(web): order-composition flow for advance/sail"
```

---

## Task 6: Web — styles for glow rings and the order composer

**Files:**
- Modify: `packages/web/src/styles/app.css`

- [ ] **Step 1: Append the styles**

Append to the end of `packages/web/src/styles/app.css`:

```css
.tile-legal-target {
  fill: none;
  stroke: #f0b429;
  stroke-width: 6px;
  stroke-dasharray: 14 10;
  animation: glow-pulse 1.4s ease-in-out infinite;
}

.tile-source {
  fill: none;
  stroke: #2f9e44;
  stroke-width: 6px;
  stroke-dasharray: 14 10;
  animation: glow-pulse 1.4s ease-in-out infinite;
}

@keyframes glow-pulse {
  0%,
  100% {
    opacity: 0.55;
  }
  50% {
    opacity: 1;
  }
}

.start-order {
  margin-top: 12px;
  width: 100%;
}

.order-composer .source-list {
  list-style: none;
  margin: 12px 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.order-composer .source-list li {
  display: flex;
  align-items: center;
  gap: 10px;
}

.order-composer .source-name {
  flex: 1;
  font-weight: 600;
}

.order-composer .source-max {
  color: #8a8577;
  font-variant-numeric: tabular-nums;
}

.stepper {
  display: inline-flex;
  align-items: center;
  gap: 8px;
}

.stepper button {
  width: 28px;
  height: 28px;
  padding: 0;
  line-height: 1;
}

.stepper-count {
  min-width: 1.5ch;
  text-align: center;
  font-variant-numeric: tabular-nums;
}

.composer-total {
  font-weight: 600;
}

.composer-actions {
  display: flex;
  gap: 8px;
}
```

- [ ] **Step 2: Verify the build still succeeds**

Run: `corepack pnpm --filter @sengoku-jidai/web build`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add packages/web/src/styles/app.css
git commit -m "style(web): glow rings and order-composer styling"
```

---

## Task 7: E2E — advance flow acceptance test

**Files:**
- Create: `tests/e2e/movement.spec.ts`

- [ ] **Step 1: Write the e2e test**

Create `tests/e2e/movement.spec.ts`:

```ts
import { expect, test } from "@playwright/test";

test("issues a movement order from the board and resolves it", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "New hotseat game" }).click();
  await expect(page.getByTestId("board")).toBeVisible();

  // Switch the view to whichever seat has initiative this game.
  const actText = await page.locator(".top-stats span", { hasText: "to act" }).textContent();
  const actor = actText?.trim().split(" ")[0];
  expect(actor === "red" || actor === "black").toBe(true);
  await page.getByRole("button", { name: actor!, exact: true }).click();

  // A legal movement target glows; select the first one.
  const target = page.locator("[data-legal-target='true']").first();
  await expect(target).toBeVisible();
  await target.click();

  // Start the linked Advance/Sail order from the detail panel.
  await page.getByRole("button", { name: /into / }).click();

  // A legal source glows; click it to stage one unit, then confirm.
  const source = page.locator("[data-source='true']").first();
  await expect(source).toBeVisible();
  await source.click();
  await page.getByRole("button", { name: /^Confirm/ }).click();

  // The order resolved: a unit-move event is logged.
  await expect(page.getByText(/unitsMoved/)).toBeVisible();
});
```

- [ ] **Step 2: Run the e2e test**

Run: `corepack pnpm test:e2e`
Expected: PASS — both the existing hotseat smoke and the new movement test pass. (Playwright's configured `webServer` builds libs and starts server+web; first run may take longer.)

- [ ] **Step 3: Commit**

```bash
git add tests/e2e/movement.spec.ts
git commit -m "test(e2e): advance/sail movement flow"
```

---

## Task 8: Full-workspace verification

**Files:** none (verification only)

- [ ] **Step 1: Typecheck, lint, format, build, unit tests**

Run:
```bash
corepack pnpm typecheck && corepack pnpm lint && corepack pnpm format && corepack pnpm build && corepack pnpm test
```
Expected: all PASS. `format` rewrites nothing meaningful (or only the files we touched, already formatted).

- [ ] **Step 2: Re-run e2e end to end**

Run: `corepack pnpm test:e2e`
Expected: PASS.

- [ ] **Step 3: Commit any formatting changes (if `format` modified files)**

```bash
git add -A
git commit -m "chore: formatting" || echo "nothing to format"
```

---

## Self-review notes (spec coverage)

- Spec §1 (engine enrich) → Task 1.
- Spec §2 (composition flow: idle/composing/submitting, OrderComposer, AreaDetails CTA) → Tasks 3, 4, 5.
- Spec §3 (map highlighting, overlay matrix rule) → Task 2 (+ CSS in Task 6).
- Spec §4 (errors via existing `errorMessage`/`error` slot; testing: engine enumeration unit tests + advance e2e) → Task 1 tests, Task 7. Rejection messages surface through the existing `errorMessage()` path (server returns `{ error: { message } }` with the validator's human-readable text), so no separate code→message map is needed.
- Locked decisions: source-click bumps +1 (Task 2 `onSourceClick` + Task 5 wiring); no auto seat-switch (unchanged); green source / gold target glow (Task 6).
