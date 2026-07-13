# Game-status HUD Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Surface the stakes of a game — a game-over overlay, an initiative marker, and a round clock — in the play UI.

**Architecture:** One additive engine field (`maxRounds` on the player view) feeds the round clock; everything else is web-only. Two pure helpers (reason text, seat display name) are unit-tested; the overlay and banner are presentational React wired into `App.tsx`, driven by view fields the engine already exposes (`status`, `winner`, `endReason`, `initiative`, `victoryPoints`) plus player names from `seatInfo`.

**Tech Stack:** TypeScript pnpm monorepo; engine (pure, Vitest); web (React 18 + Vite, Vitest, **no jsdom**); CSS in `packages/web/src/styles/app.css`.

## Global Constraints

- **No new npm dependencies.**
- **Web has no jsdom** — web tests are pure-logic only (no component render tests). Verify UI tasks with typecheck + build; visual/interaction correctness is checked by CI Browser Smoke + Martin's manual pass.
- **Run scripts with `corepack pnpm …`** (`pnpm` may not be on PATH).
- **Engine is consumed by web via built `dist`.** After changing `packages/engine`, run `corepack pnpm --filter @sengoku-jidai/engine build` before web typecheck/build will see the change.
- **Keep the scoreboard's `Round N` text in its own leaf element** so the existing e2e assertions `page.getByText("Round 1", { exact: true })` (`tests/e2e/hotseat.spec.ts`, `tests/e2e/map-editor.spec.ts`) keep passing.
- **Before pushing:** run the full gate (`typecheck`, `test`, `build`, `lint`) and `corepack pnpm exec prettier --check .` (tolerate local `.pnpm-store/` warnings; the CI Format Check is a separate job — do not let a formatting-only diff reach it).
- Commit messages end with the trailer: `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.

## File Structure

- `packages/engine/src/view.ts` — **modify.** Add `maxRounds: number` to the `PlayerGameView` interface and populate it in `playerView`.
- `packages/engine/test/view.test.ts` — **modify.** Assert `maxRounds`.
- `packages/web/src/components/board/gameOver.ts` — **create.** Pure helpers: `capitalizeSeat`, `endReasonText`, `seatDisplayName`. One responsibility: game-over display text.
- `packages/web/src/components/board/gameOver.test.ts` — **create.** Unit tests for the three helpers.
- `packages/web/src/components/GameOverOverlay.tsx` — **create.** Presentational full-screen end-of-game modal.
- `packages/web/src/App.tsx` — **modify.** Round-clock markup, initiative badge, `dismissedEndFor` state, terminal banner in the action-bar slot, render `GameOverOverlay`.
- `packages/web/src/styles/app.css` — **modify.** `.round-line`/`.round-total`, `.score-initiative`, `.visually-hidden`, `.game-over-*` overlay + banner styles.

---

### Task 1: Engine — `maxRounds` on the player view

**Files:**
- Modify: `packages/engine/src/view.ts` (interface ~line 154; `playerView` return ~line 213)
- Test: `packages/engine/test/view.test.ts`

**Interfaces:**
- Consumes: `state.rules.maxRounds` (a `number` on `RulesConfig`, default 4).
- Produces: `PlayerGameView.maxRounds: number`.

- [ ] **Step 1: Write the failing test**

Add this test inside the `describe("playerView (v2)", …)` block in `packages/engine/test/view.test.ts` (e.g. right after the `"projects schemaVersion 2 …"` test):

```ts
  it("exposes maxRounds from the ruleset", () => {
    const view = playerView(state, "red");
    expect(view.maxRounds).toBe(state.rules.maxRounds);
    expect(view.maxRounds).toBeGreaterThan(0);
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `corepack pnpm --filter @sengoku-jidai/engine exec vitest run test/view.test.ts`
Expected: FAIL — `view.maxRounds` is `undefined` (property does not exist on the type / is `undefined` at runtime).

- [ ] **Step 3: Add the field to the interface**

In `packages/engine/src/view.ts`, in the `PlayerGameView` interface, add `maxRounds` immediately after the `round: number;` line:

```ts
  round: number;
  /** The final round after which victory points are scored (from the ruleset). */
  maxRounds: number;
```

- [ ] **Step 4: Populate the field in `playerView`**

In the same file, in the object returned by `playerView`, add `maxRounds` immediately after `round: state.round,`:

```ts
    round: state.round,
    maxRounds: state.rules.maxRounds,
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `corepack pnpm --filter @sengoku-jidai/engine exec vitest run test/view.test.ts`
Expected: PASS (all tests in the file green).

- [ ] **Step 6: Rebuild the engine so downstream web tasks see the new field**

Run: `corepack pnpm --filter @sengoku-jidai/engine build`
Expected: builds with no errors (regenerates `packages/engine/dist`, including the updated `PlayerGameView` type declaration the web consumes).

- [ ] **Step 7: Commit**

```bash
git add packages/engine/src/view.ts packages/engine/test/view.test.ts
git commit -m "$(cat <<'EOF'
feat(engine): expose maxRounds on the player view

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: Web — pure game-over helpers

**Files:**
- Create: `packages/web/src/components/board/gameOver.ts`
- Test: `packages/web/src/components/board/gameOver.test.ts`

**Interfaces:**
- Consumes: `EndReason` and `SeatId` (type-only, from `@sengoku-jidai/engine/client`); `GameSeatInfo` (type-only, from `@sengoku-jidai/shared`).
- Produces:
  - `capitalizeSeat(seat: SeatId): string` — `"red" → "Red"`, `"black" → "Black"`.
  - `endReasonText(endReason: EndReason): string`.
  - `seatDisplayName(seat: SeatId, seatInfo: GameSeatInfo[]): string`.

- [ ] **Step 1: Write the failing test**

Create `packages/web/src/components/board/gameOver.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { GameSeatInfo } from "@sengoku-jidai/shared";
import { capitalizeSeat, endReasonText, seatDisplayName } from "./gameOver.js";

describe("capitalizeSeat", () => {
  it("title-cases each seat", () => {
    expect(capitalizeSeat("red")).toBe("Red");
    expect(capitalizeSeat("black")).toBe("Black");
  });
});

describe("endReasonText", () => {
  it("describes an HQ elimination", () => {
    expect(endReasonText("hqEliminated")).toBe("Captured the enemy headquarters");
  });
  it("describes a victory-point finish", () => {
    expect(endReasonText("victoryPoints")).toBe("Most supply points at the final round");
  });
});

describe("seatDisplayName", () => {
  const seatInfo: GameSeatInfo[] = [
    { seat: "red", name: "Nobunaga", status: "claimed" },
    { seat: "black", name: null, status: "open" }
  ];
  it("returns the seat's player name when set", () => {
    expect(seatDisplayName("red", seatInfo)).toBe("Nobunaga");
  });
  it("falls back to the capitalized seat when the name is null", () => {
    expect(seatDisplayName("black", seatInfo)).toBe("Black");
  });
  it("falls back when the seat is absent from seatInfo", () => {
    expect(seatDisplayName("red", [])).toBe("Red");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `corepack pnpm --filter @sengoku-jidai/web exec vitest run src/components/board/gameOver.test.ts`
Expected: FAIL — cannot resolve `./gameOver.js` (module does not exist yet).

- [ ] **Step 3: Write the implementation**

Create `packages/web/src/components/board/gameOver.ts`:

```ts
import type { EndReason, SeatId } from "@sengoku-jidai/engine/client";
import type { GameSeatInfo } from "@sengoku-jidai/shared";

/** Title-case a seat id for display ("red" -> "Red"). */
export function capitalizeSeat(seat: SeatId): string {
  return seat === "red" ? "Red" : "Black";
}

/** Human sentence for why a game ended, shown on the game-over overlay. */
export function endReasonText(endReason: EndReason): string {
  return endReason === "hqEliminated"
    ? "Captured the enemy headquarters"
    : "Most supply points at the final round";
}

/** Display name for a seat: the player's chosen name, or the capitalized seat if unnamed. */
export function seatDisplayName(seat: SeatId, seatInfo: GameSeatInfo[]): string {
  return seatInfo.find((s) => s.seat === seat)?.name ?? capitalizeSeat(seat);
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `corepack pnpm --filter @sengoku-jidai/web exec vitest run src/components/board/gameOver.test.ts`
Expected: PASS (7 assertions across 3 describes green).

- [ ] **Step 5: Commit**

```bash
git add packages/web/src/components/board/gameOver.ts packages/web/src/components/board/gameOver.test.ts
git commit -m "$(cat <<'EOF'
feat(web): pure helpers for game-over display text

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: Web — round clock in the scoreboard

**Files:**
- Modify: `packages/web/src/App.tsx` (scoreboard `.round-meta`, ~lines 812-815)
- Modify: `packages/web/src/styles/app.css` (near `.round-meta`, ~lines 197-216)

**Interfaces:**
- Consumes: `game.view.round` (existing) and `game.view.maxRounds` (Task 1).
- Produces: no exported symbols (markup + CSS only).

- [ ] **Step 1: Update the scoreboard markup**

In `packages/web/src/App.tsx`, replace the `.round-meta` block:

```tsx
          <span className="round-meta">
            <span className="round-no">Round {game.view.round}</span>
            <span className="phase-name">{phaseLabel(game.view.phase)}</span>
          </span>
```

with (wrap the round number and total in a horizontal `.round-line`, keeping `.round-no` as its own leaf so the e2e `getByText("Round 1", { exact: true })` still matches):

```tsx
          <span className="round-meta">
            <span className="round-line">
              <span className="round-no">Round {game.view.round}</span>
              <span className="round-total">/ {game.view.maxRounds}</span>
            </span>
            <span className="phase-name">{phaseLabel(game.view.phase)}</span>
          </span>
```

- [ ] **Step 2: Add the CSS**

In `packages/web/src/styles/app.css`, add after the existing `.round-meta .phase-name { … }` rule (~line 216):

```css
.round-meta .round-line {
  display: inline-flex;
  align-items: baseline;
  gap: 4px;
}

.round-meta .round-total {
  color: var(--sumi-soft);
  font-variant-numeric: tabular-nums;
}
```

- [ ] **Step 3: Typecheck the web package**

Run: `corepack pnpm --filter @sengoku-jidai/web typecheck`
Expected: PASS — `game.view.maxRounds` resolves (Task 1 added it and rebuilt the engine dist). If it errors with "Property 'maxRounds' does not exist", re-run `corepack pnpm --filter @sengoku-jidai/engine build` and retry.

- [ ] **Step 4: Prettier the changed files**

Run: `corepack pnpm exec prettier --check packages/web/src/App.tsx packages/web/src/styles/app.css`
Expected: both files pass (fix with `--write` if not, then re-check).

- [ ] **Step 5: Commit**

```bash
git add packages/web/src/App.tsx packages/web/src/styles/app.css
git commit -m "$(cat <<'EOF'
feat(web): show the round clock as "Round N / max"

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: Web — initiative marker in the scoreboard

**Files:**
- Modify: `packages/web/src/App.tsx` (add an `InitiativeBadge` component near the other file-scope helpers ~lines 1043+; place it in the two `.score` spans ~lines 797-811)
- Modify: `packages/web/src/styles/app.css` (near `.score-*` rules ~lines 179-195; add a `.visually-hidden` utility)

**Interfaces:**
- Consumes: `game.view.initiative` (existing `SeatId` on the view); `capitalizeSeat` (Task 2).
- Produces: a file-local `InitiativeBadge` component (not exported).

- [ ] **Step 1: Add the `InitiativeBadge` component and its import**

In `packages/web/src/App.tsx`, add `capitalizeSeat` to the existing import from `./components/board/gameOver.js`. If no such import exists yet, add:

```tsx
import { capitalizeSeat } from "./components/board/gameOver.js";
```

Then add this component definition near the other module-scope helpers at the bottom of the file (next to `phaseLabel`):

```tsx
/** A gold war-banner glyph marking the seat that holds initiative (first move next round +
 *  the final-VP tiebreak). The glyph is decorative; the label is read by screen readers. */
function InitiativeBadge({ side }: { side: SeatId }) {
  const label = `${capitalizeSeat(side)} holds initiative`;
  return (
    <span className="score-initiative" title={label}>
      <span aria-hidden="true">⚑</span>
      <span className="visually-hidden">{label}</span>
    </span>
  );
}
```

- [ ] **Step 2: Render the badge in each score span**

In the scoreboard, add the badge on the outer edge of the holder's side. For the red score, insert it as the **first** child (before `.score-side`):

```tsx
          <span className={`score score-red${game.view.activeSeat === "red" ? " is-active" : ""}`}>
            {game.view.initiative === "red" ? <InitiativeBadge side="red" /> : null}
            <span className="score-side">Red</span>
            <span className="score-marker" aria-hidden="true" />
            <span className="score-vp">{game.view.victoryPoints.red}</span>
          </span>
```

For the black score, insert it as the **last** child (after `.score-side`):

```tsx
          <span
            className={`score score-black${game.view.activeSeat === "black" ? " is-active" : ""}`}
          >
            <span className="score-vp">{game.view.victoryPoints.black}</span>
            <span className="score-marker" aria-hidden="true" />
            <span className="score-side">Black</span>
            {game.view.initiative === "black" ? <InitiativeBadge side="black" /> : null}
          </span>
```

- [ ] **Step 3: Add the CSS**

In `packages/web/src/styles/app.css`, add after the `.score.is-active .score-marker { … }` / `.score:not(.is-active)` rules (~line 195):

```css
.score-initiative {
  color: var(--kin);
  font-size: 1rem;
  line-height: 1;
}

.score-red .score-initiative {
  margin-right: 6px;
}

.score-black .score-initiative {
  margin-left: 6px;
}

/* Screen-reader-only text (no such utility existed before this feature). */
.visually-hidden {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0 0 0 0);
  white-space: nowrap;
  border: 0;
}
```

- [ ] **Step 4: Typecheck the web package**

Run: `corepack pnpm --filter @sengoku-jidai/web typecheck`
Expected: PASS.

- [ ] **Step 5: Prettier the changed files**

Run: `corepack pnpm exec prettier --check packages/web/src/App.tsx packages/web/src/styles/app.css`
Expected: pass (fix with `--write` if not).

- [ ] **Step 6: Commit**

```bash
git add packages/web/src/App.tsx packages/web/src/styles/app.css
git commit -m "$(cat <<'EOF'
feat(web): mark the initiative holder with a gold banner in the scoreboard

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: Web — game-over overlay + terminal banner

**Files:**
- Create: `packages/web/src/components/GameOverOverlay.tsx`
- Modify: `packages/web/src/App.tsx` (imports; `dismissedEndFor` state; a `winnerName` local; terminal banner in the board-column conditional chain ~lines 846-896; render `GameOverOverlay` beside the existing `CardPreview` at the end of the return ~lines 967-985)
- Modify: `packages/web/src/styles/app.css` (add `.game-over-*` rules)

**Interfaces:**
- Consumes: `endReasonText` (Task 2), `seatDisplayName` (Task 2); view fields `status`, `winner`, `endReason`, `victoryPoints`; `game.seatInfo`; `navigateTo` (existing import).
- Produces: `GameOverOverlay` component with props
  `{ winnerName: string; winnerSeat: SeatId; endReason: EndReason | null; redVp: number; blackVp: number; onNewGame: () => void; onDismiss: () => void; }`.

- [ ] **Step 1: Create the `GameOverOverlay` component**

Create `packages/web/src/components/GameOverOverlay.tsx`:

```tsx
import type { EndReason, SeatId } from "@sengoku-jidai/engine/client";
import { endReasonText } from "./board/gameOver.js";

interface GameOverOverlayProps {
  /** Winner's display name (player name, or the capitalized seat). */
  winnerName: string;
  /** Winner's seat, used to colour the headline. */
  winnerSeat: SeatId;
  /** Why the game ended; null only in the defensive case of a complete game with no reason. */
  endReason: EndReason | null;
  redVp: number;
  blackVp: number;
  onNewGame: () => void;
  onDismiss: () => void;
}

/** Full-screen end-of-game modal. Clicking the backdrop (or "View final board") dismisses it to
 *  reveal the final board; "New game" returns to the start screen. */
export function GameOverOverlay({
  winnerName,
  winnerSeat,
  endReason,
  redVp,
  blackVp,
  onNewGame,
  onDismiss
}: GameOverOverlayProps) {
  return (
    <div
      className="game-over-overlay"
      role="dialog"
      aria-modal="true"
      aria-label="Game over"
      onClick={onDismiss}
    >
      {/* Stop propagation so clicks on the card don't dismiss the overlay. */}
      <div className="game-over-card" onClick={(e) => e.stopPropagation()}>
        <p className="game-over-eyebrow">Game over</p>
        <h2 className={`game-over-winner game-over-winner-${winnerSeat}`}>
          <span aria-hidden="true">⚑</span> {winnerName} wins
        </h2>
        {endReason ? <p className="game-over-reason">{endReasonText(endReason)}</p> : null}
        <p className="game-over-score" aria-label={`Final score ${redVp} to ${blackVp}`}>
          <span className="game-over-score-red">{redVp}</span>
          <span className="game-over-score-dash" aria-hidden="true">
            &mdash;
          </span>
          <span className="game-over-score-black">{blackVp}</span>
        </p>
        <div className="game-over-actions">
          <button type="button" onClick={onNewGame}>
            New game
          </button>
          <button type="button" className="secondary-action" onClick={onDismiss}>
            View final board
          </button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Wire imports + state into `App.tsx`**

In `packages/web/src/App.tsx`, add the imports (place with the other component/helper imports):

```tsx
import { GameOverOverlay } from "./components/GameOverOverlay.js";
import { seatDisplayName } from "./components/board/gameOver.js";
```

(If Task 4 already imported `capitalizeSeat` from `./components/board/gameOver.js`, extend that one import to `{ capitalizeSeat, seatDisplayName }` instead of adding a second line.)

Add the dismiss state alongside the other `useState` hooks near the top of `App` (e.g. after the `error` state, ~line 94):

```tsx
  // The gameId whose game-over overlay has been dismissed (to view the final board). Keyed by
  // gameId so it auto-resets for a different game and survives the 3s poll replacing the view.
  const [dismissedEndFor, setDismissedEndFor] = useState<string | null>(null);
```

- [ ] **Step 3: Compute the winner name**

In `App.tsx`, after `const isViewerActive = …` (~line 748) and before the `return (`, add:

```tsx
  const winnerName = game.view.winner ? seatDisplayName(game.view.winner, game.seatInfo) : "";
```

- [ ] **Step 4: Add the terminal banner to the board-column conditional chain**

In `App.tsx`, extend the chain that currently renders `CombatPanel` / `PendingDecisionPanel` / `ActionBar`. Replace the final `) : (` before `<ActionBar` with the two terminal-state branches:

```tsx
          ) : game.view.status === "complete" ? (
            <div className="game-over-banner" role="status">
              <span className="game-over-banner-text">
                Game over &mdash; {winnerName} wins {game.view.victoryPoints.red}&ndash;
                {game.view.victoryPoints.black}
              </span>
              <button
                type="button"
                className="secondary-action"
                onClick={() => setDismissedEndFor(null)}
              >
                Show result
              </button>
            </div>
          ) : game.view.status === "abandoned" ? (
            <div className="game-over-banner" role="status">
              <span className="game-over-banner-text">Game abandoned</span>
            </div>
          ) : (
            <ActionBar
```

(Leave the existing `<ActionBar … />` and its closing `)}` unchanged after this.)

- [ ] **Step 5: Render the overlay beside `CardPreview`**

In `App.tsx`, immediately after the existing `{previewCard ? ( <CardPreview … /> ) : null}` block (~line 985) and before the closing `</main>`, add:

```tsx
      {game.view.status === "complete" &&
      game.view.winner &&
      dismissedEndFor !== game.gameId ? (
        <GameOverOverlay
          winnerName={winnerName}
          winnerSeat={game.view.winner}
          endReason={game.view.endReason}
          redVp={game.view.victoryPoints.red}
          blackVp={game.view.victoryPoints.black}
          onNewGame={() => navigateTo("/")}
          onDismiss={() => setDismissedEndFor(game.gameId)}
        />
      ) : null}
```

- [ ] **Step 6: Add the CSS**

In `packages/web/src/styles/app.css`, append these rules (e.g. after the card-preview overlay rules, ~line 699):

```css
/* End-of-game modal + the terminal banner that replaces the action bar once a game ends. */
.game-over-overlay {
  position: fixed;
  inset: 0;
  z-index: 60;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
  background: rgba(15, 20, 18, 0.72);
}

.game-over-card {
  width: min(92vw, 420px);
  padding: 28px;
  border-radius: 10px;
  background: var(--washi-raised);
  box-shadow: 0 20px 60px rgba(0, 0, 0, 0.45);
  text-align: center;
}

.game-over-eyebrow {
  margin: 0 0 6px;
  font-size: 0.8rem;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: var(--sumi-soft);
}

.game-over-winner {
  margin: 0 0 10px;
  font-family: var(--font-display);
  font-size: 1.8rem;
}

.game-over-winner span[aria-hidden] {
  color: var(--kin);
}

.game-over-winner-red {
  color: var(--shu);
}

.game-over-winner-black {
  color: var(--ai);
}

.game-over-reason {
  margin: 0 0 16px;
  color: var(--sumi-soft);
}

.game-over-score {
  display: flex;
  align-items: baseline;
  justify-content: center;
  gap: 12px;
  margin: 0 0 22px;
  font-family: var(--font-display);
  font-size: 2.2rem;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
}

.game-over-score-red {
  color: var(--shu);
}

.game-over-score-black {
  color: var(--ai);
}

.game-over-score-dash {
  color: var(--sumi-soft);
}

.game-over-actions {
  display: flex;
  justify-content: center;
  gap: 10px;
}

.game-over-banner {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 12px;
  padding: 12px 14px;
  border: 1px solid var(--hairline);
  border-radius: 6px;
  background: var(--washi-raised);
  min-height: 60px;
}

.game-over-banner-text {
  font-family: var(--font-display);
  font-weight: 700;
}

.game-over-banner button {
  margin-left: auto;
}
```

- [ ] **Step 7: Typecheck the web package**

Run: `corepack pnpm --filter @sengoku-jidai/web typecheck`
Expected: PASS.

- [ ] **Step 8: Build the web package (proves the new component compiles + bundles)**

Run: `corepack pnpm --filter @sengoku-jidai/web build`
Expected: Vite build succeeds with no errors.

- [ ] **Step 9: Prettier the changed files**

Run: `corepack pnpm exec prettier --check packages/web/src/App.tsx packages/web/src/components/GameOverOverlay.tsx packages/web/src/styles/app.css`
Expected: pass (fix with `--write` if not).

- [ ] **Step 10: Commit**

```bash
git add packages/web/src/App.tsx packages/web/src/components/GameOverOverlay.tsx packages/web/src/styles/app.css
git commit -m "$(cat <<'EOF'
feat(web): game-over overlay + terminal banner

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: Full gate + open the PR

**Files:** none (verification + PR only).

- [ ] **Step 1: Run the full gate from the repo root**

```bash
corepack pnpm typecheck && corepack pnpm test && corepack pnpm build && corepack pnpm lint
```
Expected: all green. (Root `typecheck`/`test` run `build:libs` first, so the engine field is rebuilt.)

- [ ] **Step 2: Prettier check the whole tree**

Run: `corepack pnpm exec prettier --check .`
Expected: no failures on tracked files (ignore any `.pnpm-store/` local-only warnings). Fix any real hits with `corepack pnpm exec prettier --write <path>` and re-run.

- [ ] **Step 3: Push and open the PR**

```bash
git push -u origin feat/game-status-hud
gh pr create --title "feat(web): game-status HUD — game-over overlay, initiative marker, round clock" --body "$(cat <<'EOF'
Surfaces the stakes of a game in the play UI:

- **Round clock** — scoreboard shows `Round N / max` (new additive `maxRounds` on the player view).
- **Initiative marker** — a gold ⚑ marks the initiative holder (first move next round + final-VP tiebreak), with a screen-reader label.
- **Game-over overlay + banner** — on game end, a dismissible modal shows the winner's name, why it ended, and the final score, with New game / View final board; a terminal banner in the action-bar slot reopens it. A "Game abandoned" strip replaces the old misleading idle text for abandoned games.

Engine change is additive (one view field); the rest is web-only. Pure helpers are unit-tested; web has no jsdom so the overlay/banner are verified by typecheck + build + CI Browser Smoke.

Spec: `docs/superpowers/specs/2026-07-13-game-status-hud-design.md`
Plan: `docs/superpowers/plans/2026-07-13-game-status-hud.md`

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 4: Watch CI to green**

Run: `gh pr checks --watch`
Expected: all checks pass (Format Check, lint, typecheck, unit tests, Browser Smoke Test, image build). Fix any failures and re-push. **Do not merge** — hand back to Martin for review + squash-merge (ask-before-merge).

---

## Self-Review

**1. Spec coverage:**
- Round clock (§1): Task 1 (engine field + test) + Task 3 (markup + CSS, keeps `Round N` leaf for e2e). ✓
- Initiative marker (§2): Task 4 (badge + `.score-initiative` + `.visually-hidden` + accessible label). ✓
- Game-over overlay + banner (§3): pure helpers Task 2; overlay + dismiss model + terminal banner (complete **and** abandoned) Task 5. ✓
- Dismiss model keyed on `gameId`, survives polling (§3): Task 5 Step 2/5. ✓
- Testing (engine `maxRounds` assertion; web pure-logic helper tests; no jsdom component tests; CI smoke): Tasks 1, 2, 6. ✓
- All seven "Files touched" from the spec appear across the tasks. ✓

**2. Placeholder scan:** No TBD/TODO/"handle edge cases"/"similar to". Every code step shows complete code; every command shows expected output. ✓

**3. Type consistency:**
- `capitalizeSeat`, `endReasonText`, `seatDisplayName` — same signatures where defined (Task 2) and consumed (Tasks 4, 5). ✓
- `GameOverOverlay` props declared in Task 5 Step 1 match the render call in Task 5 Step 5 (`winnerName`, `winnerSeat`, `endReason`, `redVp`, `blackVp`, `onNewGame`, `onDismiss`). ✓
- `maxRounds` produced in Task 1, consumed in Task 3. ✓
- `dismissedEndFor` / `setDismissedEndFor` named consistently across Task 5 steps. ✓
