# Online multiplayer — Web (Phase 2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the single-browser hotseat web client into the lean named-seats + invite-link online client described in the approved spec, while keeping solo single-browser play working.

**Architecture:** A seat *is* a link: `/g/:gameId#<seatToken>` carries the game id in the path and the secret seat token in the URL **fragment** (never sent to the server). The create screen names you + picks a side, creates a `private_multiplayer` game, caches both seat tokens in `localStorage`, and shows a copyable invite link for the open seat. Opening an open seat's link prompts for a name and claims it. While it isn't the viewer's turn (or the opponent hasn't joined), the client polls the existing view/events endpoints. The creator holds both tokens, so the existing "view as" seat-switcher still drives both sides for solo play.

**Tech Stack:** React 19 + Vite + TypeScript (web), Vitest (unit), Playwright (e2e), Zod (shared schemas). No new runtime dependencies — routing is a ~40-line module over `history`/`popstate` (no router library).

## Global Constraints

- **No new tables, no DB migration, no engine logic change.** This is a web + shared-cleanup phase only. The server backend (Phase 1) is already merged and unchanged.
- **The seat token is the credential and travels in the URL fragment** (`#<token>`), never in the path or query — the fragment is not sent to the server.
- **New games use engine `mode: "private_multiplayer"`** (the engine treats `mode` as an inert field it only echoes in the view, so this is behaviourally identical to `hotseat`).
- **Display names:** 1–80 chars after trimming (matches `claimGameRequestSchema` / `createGameRequestSchema` in shared). The Create and Claim buttons stay disabled until the name is non-empty after trim.
- **Solo single-browser play must keep working:** the creator holds both seat tokens and can "view as" either side, including the still-`open` second seat, *without* being forced through the claim prompt.
- **`SeatId` is `"red" | "black"`; `SeatStatus` is `"open" | "claimed"`.** Seat ordering for display is always red then black.
- **Stable e2e hooks:** target seat buttons by `data-seat="red|black"` and the board by `data-testid="board"`; do not scrape visible text for control flow.
- Verification gate (run from repo root `/mnt/ssd_pool/martin/repos/sengoku_jidai`): `pnpm typecheck`, `pnpm test`, `pnpm build`, `pnpm lint`, `pnpm exec prettier --check .` (run `pnpm exec prettier --write` on touched files first). Cannot screenshot locally — rely on CI Browser Smoke Test + Playwright e2e.

---

## File Structure

- `packages/shared/src/schemas.ts` — remove dead `joinGameRequestSchema` + `JoinGameRequest`.
- `packages/shared/src/api.ts` — remove dead `JoinGameResponse`.
- `packages/web/src/state/route.ts` — **new.** Pure route parse/build helpers + `useRoute` hook + `navigateTo`.
- `packages/web/src/state/route.test.ts` — **new.** Unit tests for the pure helpers.
- `packages/web/src/state/localGame.ts` — rework: per-game seat-token cache (`mergeSeatTokens`, `loadSeatTokens`, `rememberSeatTokens`, `forgetGame`); keep panel-width helpers. Old single-game `StoredGame` API removed in the final task.
- `packages/web/src/state/localGame.test.ts` — **new.** Unit test for the pure `mergeSeatTokens`.
- `packages/web/src/client/api.ts` — add `createGame`, `claimSeat`, `fetchEvents`; `createHotseatGame` removed in the final task.
- `packages/web/src/client/api.test.ts` — **new.** Unit tests (stubbed `fetch`) for `createGame`/`claimSeat`.
- `packages/web/src/components/CreateGameScreen.tsx` — **new.** Name + side form.
- `packages/web/src/components/ClaimSeatPrompt.tsx` — **new.** Name form shown when opening an open seat link.
- `packages/web/src/components/PlayersPanel.tsx` — **new.** Both seats' names + "waiting to join", view-as switcher (held seats only), invite link + copy.
- `packages/web/src/state/polling.ts` — **new.** Pure `shouldPoll` predicate.
- `packages/web/src/state/polling.test.ts` — **new.** Unit tests for `shouldPoll`.
- `packages/web/src/App.tsx` — rewired: route-driven create/claim/game rendering, new load flow, new token handling, polling, PlayersPanel.
- `packages/web/src/styles/app.css` — styles for the new screens/panel (reusing existing Sengoku tokens).
- `tests/e2e/hotseat.spec.ts`, `movement.spec.ts`, `support-actions.spec.ts` — updated to the new create flow + `data-seat` hooks.

---

## Task 1: Remove dead join schema/types from shared

The `/join` route was replaced by `/claim` in Phase 1; `joinGameRequestSchema`, `JoinGameRequest`, and `JoinGameResponse` are now unreferenced outside `shared` itself (verified: no `server`/`web` references).

**Files:**
- Modify: `packages/shared/src/schemas.ts:105-108` (the `joinGameRequestSchema`) and `:132` (the `JoinGameRequest` type export)
- Modify: `packages/shared/src/api.ts:33-35` (the `JoinGameResponse` interface)
- Test: `packages/shared/test/schemas.test.ts` (existing — must still pass)

**Interfaces:**
- Consumes: nothing.
- Produces: nothing new. Removes exports `joinGameRequestSchema`, `JoinGameRequest`, `JoinGameResponse`.

- [ ] **Step 1: Confirm no external references remain**

Run: `grep -rn "joinGameRequestSchema\|JoinGameRequest\|JoinGameResponse" packages/server packages/web tests`
Expected: no matches (only `packages/shared/src` and build `dist` contain them).

- [ ] **Step 2: Remove `joinGameRequestSchema` and its type**

In `packages/shared/src/schemas.ts`, delete this block (currently lines 105–108):

```ts
export const joinGameRequestSchema = z.object({
  seat: seatIdSchema.optional(),
  displayName: z.string().trim().min(1).max(80).optional()
});
```

and delete this type export (currently line 132):

```ts
export type JoinGameRequest = z.infer<typeof joinGameRequestSchema>;
```

- [ ] **Step 3: Remove `JoinGameResponse`**

In `packages/shared/src/api.ts`, delete this interface (currently lines 33–35):

```ts
export interface JoinGameResponse<View = unknown> extends PlayerGameViewEnvelope<View> {
  token: string;
}
```

- [ ] **Step 4: Rebuild shared and run its tests**

Run: `cd /mnt/ssd_pool/martin/repos/sengoku_jidai && pnpm --filter @sengoku-jidai/shared run build && pnpm --filter @sengoku-jidai/shared test`
Expected: build succeeds (regenerates `dist` without the removed symbols); existing schema tests PASS.

- [ ] **Step 5: Typecheck the workspace**

Run: `pnpm typecheck`
Expected: PASS (server/web never used the removed symbols).

- [ ] **Step 6: Commit**

```bash
git add packages/shared/src/schemas.ts packages/shared/src/api.ts packages/shared/dist
git commit -m "refactor(shared): drop dead join schema/types replaced by claim"
```

---

## Task 2: Routing module (`state/route.ts`)

A tiny route layer over `history`/`popstate`. The token lives in the fragment so it never reaches the server.

**Files:**
- Create: `packages/web/src/state/route.ts`
- Test: `packages/web/src/state/route.test.ts`

**Interfaces:**
- Consumes: `SeatId` from `@sengoku-jidai/engine` (not needed here, omit).
- Produces:
  - `type Route = { kind: "create" } | { kind: "game"; gameId: string; token: string }`
  - `parseRoute(loc: { pathname: string; hash: string }): Route` (pure)
  - `gameUrl(gameId: string, token: string): string` → `"/g/<enc>#<token>"` (pure)
  - `inviteUrl(origin: string, gameId: string, token: string): string` → `"<origin>/g/<enc>#<token>"` (pure)
  - `navigateTo(path: string): void` — pushState + dispatch `popstate`
  - `useRoute(): Route` — React hook tracking `popstate`

- [ ] **Step 1: Write the failing test**

Create `packages/web/src/state/route.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { gameUrl, inviteUrl, parseRoute } from "./route.js";

describe("parseRoute", () => {
  it("returns the create route for /", () => {
    expect(parseRoute({ pathname: "/", hash: "" })).toEqual({ kind: "create" });
  });

  it("parses a game route with the token from the fragment", () => {
    expect(parseRoute({ pathname: "/g/abc-123", hash: "#tok_secret" })).toEqual({
      kind: "game",
      gameId: "abc-123",
      token: "tok_secret"
    });
  });

  it("tolerates a trailing slash and a missing fragment", () => {
    expect(parseRoute({ pathname: "/g/abc-123/", hash: "" })).toEqual({
      kind: "game",
      gameId: "abc-123",
      token: ""
    });
  });

  it("decodes an encoded game id", () => {
    expect(parseRoute({ pathname: "/g/a%2Fb", hash: "#t" }).gameId).toBe("a/b");
  });
});

describe("url builders", () => {
  it("builds a game url with the token in the fragment", () => {
    expect(gameUrl("abc 1", "tok")).toBe("/g/abc%201#tok");
  });

  it("builds an absolute invite url from an origin", () => {
    expect(inviteUrl("https://host:8080", "g1", "tok")).toBe("https://host:8080/g/g1#tok");
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @sengoku-jidai/web test`
Expected: FAIL — `route.js` does not exist.

- [ ] **Step 3: Implement the module**

Create `packages/web/src/state/route.ts`:

```ts
import { useEffect, useState } from "react";

export type Route = { kind: "create" } | { kind: "game"; gameId: string; token: string };

const GAME_PATH = /^\/g\/([^/]+)\/?$/;

/** Parse a location into a route. The seat token rides in the URL fragment so it
 *  never reaches the server. Pure — takes the location parts as an argument. */
export function parseRoute(loc: { pathname: string; hash: string }): Route {
  const match = GAME_PATH.exec(loc.pathname);
  if (!match) {
    return { kind: "create" };
  }
  const token = loc.hash.startsWith("#") ? loc.hash.slice(1) : "";
  return { kind: "game", gameId: decodeURIComponent(match[1]!), token };
}

/** Relative seat URL: game id in the path, secret token in the fragment. */
export function gameUrl(gameId: string, token: string): string {
  return `/g/${encodeURIComponent(gameId)}#${token}`;
}

/** Absolute seat URL for sharing, built from an origin (e.g. window.location.origin). */
export function inviteUrl(origin: string, gameId: string, token: string): string {
  return `${origin}${gameUrl(gameId, token)}`;
}

/** Client-side navigation: push the path, then notify listeners (pushState does not
 *  fire popstate). */
export function navigateTo(path: string): void {
  window.history.pushState(null, "", path);
  window.dispatchEvent(new PopStateEvent("popstate"));
}

/** Track the current route, re-rendering on back/forward and navigateTo. */
export function useRoute(): Route {
  const [route, setRoute] = useState<Route>(() => parseRoute(window.location));
  useEffect(() => {
    const handler = () => setRoute(parseRoute(window.location));
    window.addEventListener("popstate", handler);
    return () => window.removeEventListener("popstate", handler);
  }, []);
  return route;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter @sengoku-jidai/web test`
Expected: PASS (all `route` tests green).

- [ ] **Step 5: Commit**

```bash
git add packages/web/src/state/route.ts packages/web/src/state/route.test.ts
git commit -m "feat(web): add seat-URL routing helpers"
```

---

## Task 3: Per-game seat-token cache (`state/localGame.ts`)

The URL is the source of truth; `localStorage` is a convenience cache so the creator (who holds both tokens) can resume both seats, and so reopening a link recovers the other seat's token. Keyed by game id. Panel-width helpers are unchanged.

**Files:**
- Modify: `packages/web/src/state/localGame.ts`
- Test: `packages/web/src/state/localGame.test.ts` (new)

**Interfaces:**
- Consumes: `SeatToken` from `@sengoku-jidai/shared` (`{ seat: SeatId; token: string }`).
- Produces:
  - `mergeSeatTokens(existing: SeatToken[], incoming: SeatToken[]): SeatToken[]` (pure; incoming wins per seat; red-before-black order)
  - `loadSeatTokens(gameId: string): SeatToken[]`
  - `rememberSeatTokens(gameId: string, seats: SeatToken[]): void`
  - `forgetGame(gameId: string): void`
  - unchanged: `loadPanelWidth(): number | null`, `savePanelWidth(width: number): void`
- The old `StoredGame`, `loadStoredGame`, `saveStoredGame`, `clearStoredGame` stay for now (App still imports them); they are removed in Task 8 after App migrates.

- [ ] **Step 1: Write the failing test**

Create `packages/web/src/state/localGame.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { mergeSeatTokens } from "./localGame.js";

describe("mergeSeatTokens", () => {
  it("adds a new seat's token", () => {
    expect(mergeSeatTokens([{ seat: "red", token: "r" }], [{ seat: "black", token: "b" }])).toEqual(
      [
        { seat: "red", token: "r" },
        { seat: "black", token: "b" }
      ]
    );
  });

  it("lets the incoming token win for an existing seat", () => {
    expect(
      mergeSeatTokens([{ seat: "red", token: "old" }], [{ seat: "red", token: "new" }])
    ).toEqual([{ seat: "red", token: "new" }]);
  });

  it("orders red before black regardless of input order", () => {
    const merged = mergeSeatTokens(
      [{ seat: "black", token: "b" }],
      [{ seat: "red", token: "r" }]
    );
    expect(merged.map((s) => s.seat)).toEqual(["red", "black"]);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @sengoku-jidai/web test`
Expected: FAIL — `mergeSeatTokens` is not exported.

- [ ] **Step 3: Implement the cache**

Edit `packages/web/src/state/localGame.ts`. Replace the file's top section (the `import`, `storageKey`, `StoredGame`, `loadStoredGame`, `saveStoredGame`, `clearStoredGame` — currently lines 1–31) with the following, then KEEP the existing `panelWidthKey`/`loadPanelWidth`/`savePanelWidth` block below it unchanged:

```ts
import type { SeatId, SeatToken } from "@sengoku-jidai/shared";

// --- Legacy single-game storage (still used by App until the routing rewire lands) ---
const storageKey = "sengoku-jidai.hotseat";

export interface StoredGame {
  gameId: string;
  activeSeat: string;
  seats: SeatToken[];
}

export function loadStoredGame(): StoredGame | null {
  const raw = localStorage.getItem(storageKey);
  if (!raw) {
    return null;
  }
  try {
    return JSON.parse(raw) as StoredGame;
  } catch {
    localStorage.removeItem(storageKey);
    return null;
  }
}

export function saveStoredGame(game: StoredGame): void {
  localStorage.setItem(storageKey, JSON.stringify(game));
}

export function clearStoredGame(): void {
  localStorage.removeItem(storageKey);
}

// --- Per-game seat-token cache (the link is the source of truth; this is convenience) ---
const seatsKey = "sengoku-jidai.games";

const seatOrder: Record<SeatId, number> = { red: 0, black: 1 };

type SeatStore = Record<string, SeatToken[]>;

function readSeatStore(): SeatStore {
  const raw = localStorage.getItem(seatsKey);
  if (!raw) {
    return {};
  }
  try {
    return JSON.parse(raw) as SeatStore;
  } catch {
    localStorage.removeItem(seatsKey);
    return {};
  }
}

function writeSeatStore(store: SeatStore): void {
  localStorage.setItem(seatsKey, JSON.stringify(store));
}

/** Merge incoming seat tokens over existing ones (incoming wins per seat), red before black. */
export function mergeSeatTokens(existing: SeatToken[], incoming: SeatToken[]): SeatToken[] {
  const bySeat = new Map<SeatId, SeatToken>();
  for (const token of existing) {
    bySeat.set(token.seat, token);
  }
  for (const token of incoming) {
    bySeat.set(token.seat, token);
  }
  return [...bySeat.values()].sort((a, b) => seatOrder[a.seat] - seatOrder[b.seat]);
}

export function loadSeatTokens(gameId: string): SeatToken[] {
  return readSeatStore()[gameId] ?? [];
}

export function rememberSeatTokens(gameId: string, seats: SeatToken[]): void {
  const store = readSeatStore();
  store[gameId] = mergeSeatTokens(store[gameId] ?? [], seats);
  writeSeatStore(store);
}

export function forgetGame(gameId: string): void {
  const store = readSeatStore();
  delete store[gameId];
  writeSeatStore(store);
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter @sengoku-jidai/web test`
Expected: PASS (`mergeSeatTokens` tests green; `route` tests still green).

- [ ] **Step 5: Typecheck**

Run: `pnpm typecheck`
Expected: PASS (App still imports the legacy `StoredGame`/`loadStoredGame`/`saveStoredGame`/`clearStoredGame`, all retained).

- [ ] **Step 6: Commit**

```bash
git add packages/web/src/state/localGame.ts packages/web/src/state/localGame.test.ts
git commit -m "feat(web): add per-game seat-token cache"
```

---

## Task 4: API client — create / claim / events

Thin `fetch` wrappers matching the Phase 1 endpoints. `createGame` sends `mode: "private_multiplayer"`. `createHotseatGame` is retained until Task 8 (App still uses it).

**Files:**
- Modify: `packages/web/src/client/api.ts`
- Test: `packages/web/src/client/api.test.ts` (new)

**Interfaces:**
- Consumes: `SeatId`, `PlayerGameView`, `PlayerGameEvent` (engine); `CreateGameResponse`, `PlayerGameViewEnvelope` (shared).
- Produces:
  - `createGame(input: { name: string; side: SeatId }): Promise<CreateGameResponse<PlayerGameView>>`
  - `claimSeat(gameId: string, token: string, name: string): Promise<PlayerGameViewEnvelope<PlayerGameView>>`
  - `fetchEvents(gameId: string, token: string, after: number): Promise<{ events: PlayerGameEvent[] }>`
  - unchanged: `fetchGameView`, `submitCommand`, `ApiError`, `createHotseatGame` (removed in Task 8)

- [ ] **Step 1: Write the failing test**

Create `packages/web/src/client/api.test.ts`:

```ts
import { afterEach, describe, expect, it, vi } from "vitest";
import { claimSeat, createGame } from "./api.js";

function stubFetch(body: unknown) {
  const fetchMock = vi.fn(async () => ({
    ok: true,
    status: 200,
    json: async () => body
  }));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("createGame", () => {
  it("POSTs a private_multiplayer game with the name and side", async () => {
    const fetchMock = stubFetch({ gameId: "g1" });
    await createGame({ name: "Oda", side: "black" });

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("/api/games");
    expect(init!.method).toBe("POST");
    expect(JSON.parse(init!.body as string)).toEqual({
      mode: "private_multiplayer",
      name: "Oda",
      side: "black"
    });
  });
});

describe("claimSeat", () => {
  it("POSTs the name with a bearer token to the claim endpoint", async () => {
    const fetchMock = stubFetch({ gameId: "g1", seat: "black" });
    await claimSeat("g1", "tok", "Tokugawa");

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("/api/games/g1/claim");
    expect(init!.method).toBe("POST");
    expect(new Headers(init!.headers).get("authorization")).toBe("Bearer tok");
    expect(JSON.parse(init!.body as string)).toEqual({ name: "Tokugawa" });
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @sengoku-jidai/web test`
Expected: FAIL — `createGame`/`claimSeat` are not exported.

- [ ] **Step 3: Implement the new wrappers**

In `packages/web/src/client/api.ts`:

Update the import on line 6 to add `SeatId`:

```ts
import type { Command, PlayerGameEvent, PlayerGameView, SeatId } from "@sengoku-jidai/engine";
```

Add `PlayerGameViewEnvelope` to the shared import (lines 1–5):

```ts
import type {
  CreateGameResponse,
  PlayerGameViewEnvelope,
  SubmitCommandResponse
} from "@sengoku-jidai/shared";
```

Then add these functions (keep `createHotseatGame` as-is for now):

```ts
export async function createGame(input: {
  name: string;
  side: SeatId;
}): Promise<CreateGameResponse<PlayerGameView>> {
  return request("/api/games", {
    method: "POST",
    body: JSON.stringify({ mode: "private_multiplayer", name: input.name, side: input.side })
  });
}

export async function claimSeat(
  gameId: string,
  token: string,
  name: string
): Promise<PlayerGameViewEnvelope<PlayerGameView>> {
  return request(`/api/games/${gameId}/claim`, {
    method: "POST",
    headers: authHeaders(token),
    body: JSON.stringify({ name })
  });
}

export async function fetchEvents(
  gameId: string,
  token: string,
  after: number
): Promise<{ events: PlayerGameEvent[] }> {
  return request(`/api/games/${gameId}/events?after=${after}`, {
    headers: authHeaders(token)
  });
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter @sengoku-jidai/web test`
Expected: PASS (`api` tests green; earlier tests still green).

- [ ] **Step 5: Commit**

```bash
git add packages/web/src/client/api.ts packages/web/src/client/api.test.ts
git commit -m "feat(web): add create/claim/events API client calls"
```

---

## Task 5: Routing shell — create screen, seat load, claim prompt

The centerpiece. App becomes route-driven: `/` shows the create screen; `/g/:gameId#<token>` loads that seat; if the seat is `open` *and reached via the URL token* (the invited opponent), show the claim prompt; otherwise play. Solo play is preserved because "view as" switches change `game.token` (not `route.token`), so the creator can play the still-open second seat without a claim prompt.

**Files:**
- Create: `packages/web/src/components/CreateGameScreen.tsx`
- Create: `packages/web/src/components/ClaimSeatPrompt.tsx`
- Modify: `packages/web/src/App.tsx`
- Modify: `packages/web/src/styles/app.css`
- Modify: `tests/e2e/hotseat.spec.ts`, `tests/e2e/movement.spec.ts`, `tests/e2e/support-actions.spec.ts`

**Interfaces:**
- Consumes: `useRoute`, `navigateTo`, `gameUrl` (route); `createGame`, `claimSeat`, `fetchGameView`, `submitCommand`, `ApiError` (api); `loadSeatTokens`, `rememberSeatTokens`, `forgetGame`, `loadPanelWidth`, `savePanelWidth` (localGame); `SeatId`, `PlayerGameView` (engine); `SeatToken`, `GameSeatInfo` (shared).
- Produces:
  - `CreateGameScreen` props: `{ busy: boolean; error: string | null; onCreate: (name: string, side: SeatId) => void }`
  - `ClaimSeatPrompt` props: `{ seatInfo: GameSeatInfo[]; viewerSeat: SeatId; busy: boolean; error: string | null; onClaim: (name: string) => void }`
  - App `LoadedGame` shape: `{ gameId: string; token: string; heldSeats: SeatToken[]; revision: number; view: PlayerGameView; seatInfo: GameSeatInfo[] }`

- [ ] **Step 1: Create the CreateGameScreen component**

Create `packages/web/src/components/CreateGameScreen.tsx`:

```tsx
import { useState, type FormEvent } from "react";
import type { SeatId } from "@sengoku-jidai/engine";

interface CreateGameScreenProps {
  busy: boolean;
  error: string | null;
  onCreate: (name: string, side: SeatId) => void;
}

const SIDES: { id: SeatId; label: string }[] = [
  { id: "red", label: "Red" },
  { id: "black", label: "Black" }
];

export function CreateGameScreen({ busy, error, onCreate }: CreateGameScreenProps) {
  const [name, setName] = useState("");
  const [side, setSide] = useState<SeatId>("red");
  const trimmed = name.trim();

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (trimmed.length === 0 || busy) {
      return;
    }
    onCreate(trimmed, side);
  }

  return (
    <main className="app-shell app-empty">
      <section className="start-panel create-screen" aria-label="Create game">
        <h1>General Orders: Sengoku Jidai</h1>
        <form className="create-form" onSubmit={handleSubmit}>
          <label className="field">
            <span>Your name</span>
            <input
              type="text"
              value={name}
              maxLength={80}
              autoFocus
              placeholder="e.g. Nobunaga"
              onChange={(event) => setName(event.target.value)}
            />
          </label>

          <fieldset className="side-toggle">
            <legend>Your side</legend>
            {SIDES.map((option) => (
              <button
                key={option.id}
                type="button"
                data-side={option.id}
                aria-pressed={side === option.id}
                className={side === option.id ? "is-active" : ""}
                onClick={() => setSide(option.id)}
              >
                {option.label}
              </button>
            ))}
          </fieldset>

          <button type="submit" className="primary-action" disabled={busy || trimmed.length === 0}>
            {busy ? "Creating…" : "Create game"}
          </button>
        </form>
        {error ? <p className="error-text">{error}</p> : null}
      </section>
    </main>
  );
}
```

- [ ] **Step 2: Create the ClaimSeatPrompt component**

Create `packages/web/src/components/ClaimSeatPrompt.tsx`:

```tsx
import { useState, type FormEvent } from "react";
import type { SeatId } from "@sengoku-jidai/engine";
import type { GameSeatInfo } from "@sengoku-jidai/shared";

interface ClaimSeatPromptProps {
  seatInfo: GameSeatInfo[];
  viewerSeat: SeatId;
  busy: boolean;
  error: string | null;
  onClaim: (name: string) => void;
}

const sideLabel: Record<SeatId, string> = { red: "Red", black: "Black" };

export function ClaimSeatPrompt({
  seatInfo,
  viewerSeat,
  busy,
  error,
  onClaim
}: ClaimSeatPromptProps) {
  const [name, setName] = useState("");
  const trimmed = name.trim();
  const host = seatInfo.find((s) => s.seat !== viewerSeat && s.name);

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (trimmed.length === 0 || busy) {
      return;
    }
    onClaim(trimmed);
  }

  return (
    <main className="app-shell app-empty">
      <section className="start-panel claim-screen" aria-label="Join game">
        <h1>Join the battle</h1>
        <p className="claim-intro">
          {host ? `${host.name} invited you to play ` : "You've been invited to play "}
          <strong data-seat={viewerSeat}>{sideLabel[viewerSeat]}</strong>.
        </p>
        <form className="create-form" onSubmit={handleSubmit}>
          <label className="field">
            <span>Your name</span>
            <input
              type="text"
              value={name}
              maxLength={80}
              autoFocus
              placeholder="e.g. Tokugawa"
              onChange={(event) => setName(event.target.value)}
            />
          </label>
          <button type="submit" className="primary-action" disabled={busy || trimmed.length === 0}>
            {busy ? "Joining…" : "Join game"}
          </button>
        </form>
        {error ? <p className="error-text">{error}</p> : null}
      </section>
    </main>
  );
}
```

- [ ] **Step 3: Rewire App imports and the loaded-game shape**

In `packages/web/src/App.tsx`:

Add `SeatToken`/`GameSeatInfo` to a shared type import (add near the engine import at the top of the file):

```ts
import type { GameSeatInfo, SeatToken } from "@sengoku-jidai/shared";
```

Replace the api import (currently line 30):

```ts
import { ApiError, claimSeat, createGame, fetchGameView, submitCommand } from "./client/api.js";
```

Replace the localGame import (currently lines 31–38):

```ts
import {
  forgetGame,
  loadPanelWidth,
  loadSeatTokens,
  rememberSeatTokens,
  savePanelWidth
} from "./state/localGame.js";
```

Add the routing + screen imports immediately after it:

```ts
import { gameUrl, navigateTo, useRoute } from "./state/route.js";
import { CreateGameScreen } from "./components/CreateGameScreen.js";
import { ClaimSeatPrompt } from "./components/ClaimSeatPrompt.js";
```

Replace the `LoadedGame` interface (currently lines 44–47):

```ts
interface LoadedGame {
  gameId: string;
  token: string;
  heldSeats: SeatToken[];
  revision: number;
  view: PlayerGameView;
  seatInfo: GameSeatInfo[];
}
```

- [ ] **Step 4: Replace the bootstrap effect with a route-driven loader**

In `App()`, add the route + a ref near the other hooks (e.g. just after the `const [game, setGame] = useState<LoadedGame | null>(null);` line):

```ts
const route = useRoute();
const loadedKeyRef = useRef<string | null>(null);
```

Replace the old localStorage bootstrap effect (currently lines 96–115, the `useEffect` that calls `loadStoredGame()`) with:

```ts
// Load the seat named by the current /g/:id#token route. Keyed on the route only, so a
// "view as" switch (which changes game.token but not the URL) does not trigger a reload.
useEffect(() => {
  if (route.kind !== "game") {
    loadedKeyRef.current = null;
    setGame(null);
    return;
  }
  const { gameId, token } = route;
  const key = `${gameId}#${token}`;
  if (loadedKeyRef.current === key) {
    return;
  }
  loadedKeyRef.current = key;

  if (!token) {
    setError("This game link is missing its seat token.");
    return;
  }

  let cancelled = false;
  setBusy(true);
  setError(null);
  void fetchGameView(gameId, token)
    .then((envelope) => {
      if (cancelled) {
        return;
      }
      rememberSeatTokens(gameId, [{ seat: envelope.seat, token }]);
      setGame({
        gameId,
        token,
        heldSeats: loadSeatTokens(gameId),
        revision: envelope.revision,
        view: envelope.view,
        seatInfo: envelope.seatInfo
      });
      setSelectedAreaId(null);
      setComposer(null);
      setPlayingCard(null);
      setEvents([]);
    })
    .catch((caught) => {
      if (!cancelled) {
        setError(errorMessage(caught));
      }
    })
    .finally(() => {
      if (!cancelled) {
        setBusy(false);
      }
    });
  return () => {
    cancelled = true;
  };
}, [route]);
```

- [ ] **Step 5: Replace create + switch + claim handlers**

Replace `handleCreateGame` (currently lines 192–213) with:

```ts
async function handleCreate(name: string, side: SeatId) {
  setBusy(true);
  setError(null);
  try {
    const created = await createGame({ name, side });
    rememberSeatTokens(created.gameId, created.seats);
    const myToken = created.seats.find((s) => s.seat === created.seat)!.token;
    loadedKeyRef.current = `${created.gameId}#${myToken}`;
    setGame({
      gameId: created.gameId,
      token: myToken,
      heldSeats: created.seats,
      revision: created.revision,
      view: created.view,
      seatInfo: created.seatInfo
    });
    setSelectedAreaId(null);
    setComposer(null);
    setPlayingCard(null);
    setEvents([]);
    navigateTo(gameUrl(created.gameId, myToken));
  } catch (caught) {
    setError(errorMessage(caught));
  } finally {
    setBusy(false);
  }
}

async function handleClaim(name: string) {
  if (!game) {
    return;
  }
  setBusy(true);
  setError(null);
  try {
    const envelope = await claimSeat(game.gameId, game.token, name);
    setGame({ ...game, revision: envelope.revision, view: envelope.view, seatInfo: envelope.seatInfo });
  } catch (caught) {
    setError(errorMessage(caught));
  } finally {
    setBusy(false);
  }
}
```

Replace `handleSwitchSeat` (currently lines 215–238) with:

```ts
async function handleSwitchSeat(seat: SeatId) {
  if (!game) {
    return;
  }
  const token = game.heldSeats.find((held) => held.seat === seat)?.token;
  if (!token) {
    return;
  }
  setBusy(true);
  setError(null);
  try {
    const envelope = await fetchGameView(game.gameId, token);
    setGame({
      ...game,
      token,
      revision: envelope.revision,
      view: envelope.view,
      seatInfo: envelope.seatInfo
    });
    setSelectedAreaId(null);
    setComposer(null);
    setPlayingCard(null);
  } catch (caught) {
    setError(errorMessage(caught));
  } finally {
    setBusy(false);
  }
}
```

- [ ] **Step 6: Point the four command handlers at `game.token`**

In `handleConfirmOrder`, `handlePass`, `submitCombat`, and `submitDecision`, replace the seat-token lookup (each currently does
`const token = game.seats.find((seat) => seat.seat === game.activeSeat)?.token; if (!token) { setError("Missing seat token."); return; }`)
with the single line:

```ts
const token = game.token;
```

(There are four occurrences — one per handler. `game.token` is always present, so the guard is no longer needed.)

- [ ] **Step 7: Replace the no-game branch with route-driven rendering**

Replace the `if (!game) { ... }` start-screen block (currently lines 505–517) with:

```tsx
if (route.kind === "create") {
  return <CreateGameScreen busy={busy} error={error} onCreate={handleCreate} />;
}

if (!game) {
  return (
    <main className="app-shell app-empty">
      <section className="start-panel" aria-label="Loading game">
        <p className="muted">{busy ? "Loading game…" : (error ?? "Game not found.")}</p>
        <button type="button" className="secondary-action" onClick={() => navigateTo("/")}>
          New game
        </button>
        {error && !busy ? <p className="error-text">{error}</p> : null}
      </section>
    </main>
  );
}

const viewerSeatInfo = game.seatInfo.find((s) => s.seat === game.view.viewerSeat);
// Only the *invited* opponent (the one who opened the open seat's link) claims it. A creator
// "viewing as" the still-open second seat changes game.token, not route.token, so they play it.
if (
  route.kind === "game" &&
  route.token === game.token &&
  viewerSeatInfo?.status === "open"
) {
  return (
    <ClaimSeatPrompt
      seatInfo={game.seatInfo}
      viewerSeat={game.view.viewerSeat}
      busy={busy}
      error={error}
      onClaim={handleClaim}
    />
  );
}
```

- [ ] **Step 8: Fix the viewer-active check and the seat-switcher**

Replace the `isViewerActive` line (currently line 519):

```ts
const isViewerActive = game.view.activeSeat === game.view.viewerSeat;
```

Replace the seat-switcher block (currently lines 659–672) — keep `data-seat` for stable hooks, iterate held tokens, label by name when known:

```tsx
<div className="seat-switcher" role="group" aria-label="View as">
  {game.heldSeats.map((held) => {
    const info = game.seatInfo.find((s) => s.seat === held.seat);
    return (
      <button
        key={held.seat}
        type="button"
        data-seat={held.seat}
        className={held.seat === game.view.viewerSeat ? "is-active" : ""}
        onClick={() => handleSwitchSeat(held.seat)}
        disabled={busy}
      >
        {info?.name ?? held.seat}
      </button>
    );
  })}
</div>
```

- [ ] **Step 9: Update the "Clear local game" button**

Replace its `onClick` (currently lines 709–712) with:

```tsx
onClick={() => {
  forgetGame(game.gameId);
  navigateTo("/");
}}
```

- [ ] **Step 10: Add styles for the new screens**

Append to `packages/web/src/styles/app.css` (uses the existing Sengoku tokens):

```css
/* Create / claim screens */
.create-form {
  display: flex;
  flex-direction: column;
  gap: 1rem;
  width: 100%;
  max-width: 22rem;
  text-align: left;
}
.create-form .field {
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
  font-family: var(--font-display, inherit);
}
.create-form .field input {
  padding: 0.6rem 0.7rem;
  border: 1px solid var(--hairline);
  border-radius: 6px;
  background: var(--washi-raised);
  color: var(--sumi);
  font-size: 1rem;
}
.create-form .field input:focus-visible {
  outline: 2px solid var(--kin);
  outline-offset: 1px;
}
.side-toggle {
  display: flex;
  gap: 0.5rem;
  border: 0;
  padding: 0;
  margin: 0;
}
.side-toggle legend {
  margin-bottom: 0.35rem;
  color: var(--sumi-soft);
}
.side-toggle button {
  flex: 1;
  padding: 0.5rem 0;
  border: 1px solid var(--hairline);
  border-radius: 6px;
  background: var(--washi-raised);
  color: var(--sumi-soft);
  cursor: pointer;
}
.side-toggle button[data-side="red"].is-active {
  background: var(--shu);
  border-color: var(--shu);
  color: var(--washi-raised);
}
.side-toggle button[data-side="black"].is-active {
  background: var(--ai);
  border-color: var(--ai);
  color: var(--washi-raised);
}
.primary-action {
  padding: 0.65rem 1rem;
  border: 0;
  border-radius: 6px;
  background: var(--sumi);
  color: var(--washi-raised);
  font-size: 1rem;
  cursor: pointer;
}
.primary-action:disabled {
  opacity: 0.5;
  cursor: default;
}
.claim-intro {
  color: var(--sumi-soft);
  max-width: 22rem;
}
.claim-intro strong[data-seat="red"] {
  color: var(--shu);
}
.claim-intro strong[data-seat="black"] {
  color: var(--ai);
}
```

(If the `--font-display` token is not defined in this file, drop that one line — the other tokens `--hairline`, `--washi-raised`, `--sumi`, `--sumi-soft`, `--shu`, `--ai`, `--kin` are defined on `:root`.)

- [ ] **Step 11: Update the e2e create flow**

In `tests/e2e/hotseat.spec.ts`, replace the create line
`await page.getByRole("button", { name: "New hotseat game" }).click();`
with:

```ts
await page.getByLabel("Your name").fill("Oda");
await page.getByRole("button", { name: "Create game" }).click();
```

In `tests/e2e/movement.spec.ts` and `tests/e2e/support-actions.spec.ts`, apply the same replacement, and change the seat-switch click from a text/role lookup to the stable `data-seat` hook. Where the spec currently does
`await page.getByRole("button", { name: actor!, exact: true }).click();`
replace it with:

```ts
await page.locator(`[data-seat="${actor}"]`).click();
```

(`actor` is still read from `await page.locator(".app-shell").getAttribute("data-active-seat")`. The creator "Oda" holds both seat tokens, so both `data-seat` buttons are present and switching to the open second seat plays it without a claim prompt.)

- [ ] **Step 12: Run the gate and e2e**

Run: `cd /mnt/ssd_pool/martin/repos/sengoku_jidai && pnpm exec prettier --write packages/web tests/e2e && pnpm typecheck && pnpm --filter @sengoku-jidai/web test && pnpm build && pnpm lint`
Expected: all PASS.

Run: `pnpm test:e2e`
Expected: the three specs PASS (create → board renders; movement order resolves; support action resolves). If a local browser is unavailable, note it — CI runs the Browser Smoke Test + Playwright.

- [ ] **Step 13: Commit**

```bash
git add packages/web/src/App.tsx packages/web/src/components/CreateGameScreen.tsx packages/web/src/components/ClaimSeatPrompt.tsx packages/web/src/styles/app.css tests/e2e
git commit -m "feat(web): seat-URL routing with create screen and claim prompt"
```

---

## Task 6: Players panel — both names, waiting state, view-as, invite link

Replace the bare seat-switcher with a panel that shows both seats' names (or "waiting to join"), limits "view as" to held seats, and surfaces a copyable invite link while the open seat's token is held (the creator).

**Files:**
- Create: `packages/web/src/components/PlayersPanel.tsx`
- Modify: `packages/web/src/App.tsx` (compute `inviteLink`, render `<PlayersPanel/>` in place of the inline seat-switcher)
- Modify: `packages/web/src/styles/app.css`

**Interfaces:**
- Consumes: `inviteUrl` (route); `handleSwitchSeat` (App); `SeatId` (engine); `GameSeatInfo` (shared).
- Produces:
  - `PlayersPanel` props: `{ seatInfo: GameSeatInfo[]; heldSeats: SeatId[]; viewerSeat: SeatId; activeSeat: SeatId; inviteLink: string | null; busy: boolean; onSwitchSeat: (seat: SeatId) => void }`

- [ ] **Step 1: Create the PlayersPanel component**

Create `packages/web/src/components/PlayersPanel.tsx`:

```tsx
import { useState } from "react";
import type { SeatId } from "@sengoku-jidai/engine";
import type { GameSeatInfo } from "@sengoku-jidai/shared";

interface PlayersPanelProps {
  seatInfo: GameSeatInfo[];
  heldSeats: SeatId[];
  viewerSeat: SeatId;
  activeSeat: SeatId;
  inviteLink: string | null;
  busy: boolean;
  onSwitchSeat: (seat: SeatId) => void;
}

const sideLabel: Record<SeatId, string> = { red: "Red", black: "Black" };
const seatOrder: SeatId[] = ["red", "black"];

export function PlayersPanel({
  seatInfo,
  heldSeats,
  viewerSeat,
  activeSeat,
  inviteLink,
  busy,
  onSwitchSeat
}: PlayersPanelProps) {
  const [copied, setCopied] = useState(false);
  const ordered = seatOrder
    .map((seat) => seatInfo.find((s) => s.seat === seat))
    .filter((s): s is GameSeatInfo => Boolean(s));

  async function handleCopy() {
    if (!inviteLink) {
      return;
    }
    try {
      await navigator.clipboard.writeText(inviteLink);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  }

  return (
    <div className="players-panel" aria-label="Players">
      <ul className="player-list">
        {ordered.map((seat) => {
          const held = heldSeats.includes(seat.seat);
          const isViewer = seat.seat === viewerSeat;
          const isActive = seat.seat === activeSeat;
          const label = seat.name ?? (seat.status === "open" ? "Waiting to join…" : sideLabel[seat.seat]);
          return (
            <li key={seat.seat} className={`player-row${isActive ? " is-turn" : ""}`}>
              {held ? (
                <button
                  type="button"
                  data-seat={seat.seat}
                  className={`player-pill${isViewer ? " is-active" : ""}`}
                  onClick={() => onSwitchSeat(seat.seat)}
                  disabled={busy || isViewer}
                  aria-pressed={isViewer}
                >
                  <span className="player-side" data-seat={seat.seat}>
                    {sideLabel[seat.seat]}
                  </span>
                  <span className="player-name">{label}</span>
                </button>
              ) : (
                <span className="player-pill is-readonly" data-seat={seat.seat}>
                  <span className="player-side" data-seat={seat.seat}>
                    {sideLabel[seat.seat]}
                  </span>
                  <span className={`player-name${seat.status === "open" ? " is-open" : ""}`}>
                    {label}
                  </span>
                </span>
              )}
            </li>
          );
        })}
      </ul>

      {inviteLink ? (
        <div className="invite-box">
          <p className="invite-hint">Share this link to invite your opponent:</p>
          <div className="invite-row">
            <input type="text" readOnly value={inviteLink} aria-label="Invite link" />
            <button type="button" className="secondary-action" onClick={handleCopy}>
              {copied ? "Copied!" : "Copy"}
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
```

- [ ] **Step 2: Wire it into App**

In `packages/web/src/App.tsx`, add the `inviteUrl` import to the route import line:

```ts
import { gameUrl, inviteUrl, navigateTo, useRoute } from "./state/route.js";
import { PlayersPanel } from "./components/PlayersPanel.js";
```

Just before the `return (` of the main game render (after the `mapActiveSourceId` definition, ~line 543), compute the invite link:

```ts
const openSeat = game.seatInfo.find((s) => s.status === "open");
const openSeatToken = openSeat
  ? game.heldSeats.find((held) => held.seat === openSeat.seat)?.token
  : undefined;
const inviteLink = openSeatToken
  ? inviteUrl(window.location.origin, game.gameId, openSeatToken)
  : null;
```

Replace the seat-switcher `<div className="seat-switcher" ...>…</div>` block (the one added in Task 5, Step 8) with:

```tsx
<PlayersPanel
  seatInfo={game.seatInfo}
  heldSeats={game.heldSeats.map((held) => held.seat)}
  viewerSeat={game.view.viewerSeat}
  activeSeat={game.view.activeSeat}
  inviteLink={inviteLink}
  busy={busy}
  onSwitchSeat={handleSwitchSeat}
/>
```

- [ ] **Step 3: Add styles**

Append to `packages/web/src/styles/app.css`:

```css
/* Players panel */
.players-panel {
  display: flex;
  flex-direction: column;
  gap: 0.6rem;
}
.player-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
}
.player-pill {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  width: 100%;
  padding: 0.45rem 0.6rem;
  border: 1px solid var(--hairline);
  border-radius: 6px;
  background: var(--washi-raised);
  color: var(--sumi);
  text-align: left;
  cursor: pointer;
}
.player-pill.is-readonly {
  cursor: default;
}
.player-pill:disabled {
  cursor: default;
}
.player-row.is-turn .player-pill {
  border-color: var(--kin);
  box-shadow: inset 0 0 0 1px var(--kin);
}
.player-pill .player-side {
  font-family: var(--font-display, inherit);
  font-weight: 700;
}
.player-pill .player-side[data-seat="red"] {
  color: var(--shu);
}
.player-pill .player-side[data-seat="black"] {
  color: var(--ai);
}
.player-pill.is-active[data-seat="red"] {
  background: var(--shu);
  border-color: var(--shu);
}
.player-pill.is-active[data-seat="black"] {
  background: var(--ai);
  border-color: var(--ai);
}
.player-pill.is-active,
.player-pill.is-active .player-side {
  color: var(--washi-raised);
}
.player-name.is-open {
  color: var(--sumi-soft);
  font-style: italic;
}
.invite-box {
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
}
.invite-hint {
  margin: 0;
  font-size: 0.85rem;
  color: var(--sumi-soft);
}
.invite-row {
  display: flex;
  gap: 0.4rem;
}
.invite-row input {
  flex: 1;
  min-width: 0;
  padding: 0.4rem 0.5rem;
  border: 1px solid var(--hairline);
  border-radius: 6px;
  background: var(--washi);
  color: var(--sumi-soft);
  font-size: 0.8rem;
}
```

(Drop the `var(--font-display, …)` fallback line only if it causes a lint issue — the fallback makes it safe regardless.)

- [ ] **Step 4: Extend the hotseat e2e to assert both seats + invite link**

In `tests/e2e/hotseat.spec.ts`, after the board is visible, add:

```ts
// Creator's own seat shows their name; the open seat shows the waiting state + invite link.
await expect(page.getByText("Oda")).toBeVisible();
await expect(page.getByText("Waiting to join…")).toBeVisible();
await expect(page.getByLabel("Invite link")).toBeVisible();
```

- [ ] **Step 5: Run the gate + e2e**

Run: `cd /mnt/ssd_pool/martin/repos/sengoku_jidai && pnpm exec prettier --write packages/web tests/e2e && pnpm typecheck && pnpm --filter @sengoku-jidai/web test && pnpm build && pnpm lint`
Expected: PASS.

Run: `pnpm test:e2e`
Expected: PASS (hotseat now also asserts names + invite link).

- [ ] **Step 6: Commit**

```bash
git add packages/web/src/App.tsx packages/web/src/components/PlayersPanel.tsx packages/web/src/styles/app.css tests/e2e/hotseat.spec.ts
git commit -m "feat(web): players panel with names, invite link, and view-as switcher"
```

---

## Task 7: Polling loop

While it isn't the viewer's turn — or the opponent hasn't joined yet — refetch the view + new events every few seconds so the board, scoreboard, and seat names stay current and the turn handoff is automatic. Pause while a command is in flight (`busy`) to avoid clobbering an optimistic update.

**Files:**
- Create: `packages/web/src/state/polling.ts`
- Create: `packages/web/src/state/polling.test.ts`
- Modify: `packages/web/src/App.tsx`

**Interfaces:**
- Consumes: `PlayerGameView` (engine); `GameSeatInfo` (shared); `fetchGameView`, `fetchEvents` (api).
- Produces: `shouldPoll(view: PlayerGameView, seatInfo: GameSeatInfo[]): boolean` (pure).

- [ ] **Step 1: Write the failing test**

Create `packages/web/src/state/polling.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { PlayerGameView } from "@sengoku-jidai/engine";
import type { GameSeatInfo } from "@sengoku-jidai/shared";
import { shouldPoll } from "./polling.js";

function view(over: Partial<PlayerGameView>): PlayerGameView {
  return {
    status: "active",
    activeSeat: "red",
    viewerSeat: "red",
    ...over
  } as PlayerGameView;
}

const bothClaimed: GameSeatInfo[] = [
  { seat: "red", name: "Oda", status: "claimed" },
  { seat: "black", name: "Tok", status: "claimed" }
];
const opponentOpen: GameSeatInfo[] = [
  { seat: "red", name: "Oda", status: "claimed" },
  { seat: "black", name: null, status: "open" }
];

describe("shouldPoll", () => {
  it("does not poll on your own turn once both seats are claimed", () => {
    expect(shouldPoll(view({ activeSeat: "red", viewerSeat: "red" }), bothClaimed)).toBe(false);
  });

  it("polls while it is the opponent's turn", () => {
    expect(shouldPoll(view({ activeSeat: "black", viewerSeat: "red" }), bothClaimed)).toBe(true);
  });

  it("polls while a seat is still open (waiting for the opponent to join)", () => {
    expect(shouldPoll(view({ activeSeat: "red", viewerSeat: "red" }), opponentOpen)).toBe(true);
  });

  it("never polls once the game is over", () => {
    expect(shouldPoll(view({ status: "complete", activeSeat: "black", viewerSeat: "red" }), bothClaimed)).toBe(false);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @sengoku-jidai/web test`
Expected: FAIL — `polling.js` does not exist.

- [ ] **Step 3: Implement the predicate**

Create `packages/web/src/state/polling.ts`:

```ts
import type { PlayerGameView } from "@sengoku-jidai/engine";
import type { GameSeatInfo } from "@sengoku-jidai/shared";

/** Poll while the game is live AND either the opponent hasn't joined or it isn't the
 *  viewer's turn — i.e. when something can change without the viewer acting. */
export function shouldPoll(view: PlayerGameView, seatInfo: GameSeatInfo[]): boolean {
  if (view.status !== "active") {
    return false;
  }
  const opponentWaiting = seatInfo.some((s) => s.status === "open");
  const notViewersTurn = view.activeSeat !== view.viewerSeat;
  return opponentWaiting || notViewersTurn;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter @sengoku-jidai/web test`
Expected: PASS.

- [ ] **Step 5: Wire the polling effect into App**

In `packages/web/src/App.tsx`, add to the api import:

```ts
import { ApiError, claimSeat, createGame, fetchEvents, fetchGameView, submitCommand } from "./client/api.js";
```

and add the polling import:

```ts
import { shouldPoll } from "./state/polling.js";
```

Add this effect alongside the other effects in `App()` (after the route loader effect). It re-reads the latest game via a ref so the interval callback is never stale:

```ts
const gameRef = useRef<LoadedGame | null>(null);
useEffect(() => {
  gameRef.current = game;
}, [game]);

useEffect(() => {
  if (!game || busy) {
    return;
  }
  if (!shouldPoll(game.view, game.seatInfo)) {
    return;
  }
  const interval = window.setInterval(() => {
    const current = gameRef.current;
    if (!current) {
      return;
    }
    void fetchGameView(current.gameId, current.token)
      .then(async (envelope) => {
        if (gameRef.current?.token !== current.token) {
          return; // seat switched mid-poll; drop this result
        }
        let newEvents: PlayerGameEvent[] = [];
        if (envelope.revision > current.revision) {
          newEvents = (await fetchEvents(current.gameId, current.token, current.revision)).events;
        }
        setGame((prev) =>
          prev && prev.token === current.token
            ? { ...prev, revision: envelope.revision, view: envelope.view, seatInfo: envelope.seatInfo }
            : prev
        );
        if (newEvents.length > 0) {
          setEvents((previous) => [...newEvents.reverse(), ...previous].slice(0, 8));
        }
      })
      .catch(() => {
        // transient poll failure: ignore and let the next tick retry
      });
  }, 3000);
  return () => window.clearInterval(interval);
}, [game, busy]);
```

(`PlayerGameEvent` is already imported at the top of `App.tsx`.)

- [ ] **Step 6: Run the gate**

Run: `cd /mnt/ssd_pool/martin/repos/sengoku_jidai && pnpm exec prettier --write packages/web && pnpm typecheck && pnpm --filter @sengoku-jidai/web test && pnpm build && pnpm lint`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/web/src/state/polling.ts packages/web/src/state/polling.test.ts packages/web/src/App.tsx
git commit -m "feat(web): poll for opponent moves and join while waiting"
```

---

## Task 8: Remove the now-dead hotseat bootstrap code

App no longer uses the legacy single-game storage or `createHotseatGame`. Remove them now that nothing references them.

**Files:**
- Modify: `packages/web/src/state/localGame.ts` (drop `storageKey`, `StoredGame`, `loadStoredGame`, `saveStoredGame`, `clearStoredGame`)
- Modify: `packages/web/src/client/api.ts` (drop `createHotseatGame`)

**Interfaces:**
- Consumes: nothing.
- Produces: nothing new (removals only).

- [ ] **Step 1: Confirm nothing references the legacy symbols**

Run: `grep -rn "createHotseatGame\|loadStoredGame\|saveStoredGame\|clearStoredGame\|StoredGame" packages/web/src`
Expected: no matches (App migrated to the new APIs in Tasks 5–7).

- [ ] **Step 2: Remove the legacy storage block**

In `packages/web/src/state/localGame.ts`, delete the "Legacy single-game storage" block added in Task 3 (the `storageKey` const, `StoredGame` interface, and the `loadStoredGame`/`saveStoredGame`/`clearStoredGame` functions). Keep the per-game seat-token cache and the panel-width helpers.

- [ ] **Step 3: Remove `createHotseatGame`**

In `packages/web/src/client/api.ts`, delete the `createHotseatGame` function (currently lines 8–13).

- [ ] **Step 4: Run the full gate + e2e**

Run: `cd /mnt/ssd_pool/martin/repos/sengoku_jidai && pnpm exec prettier --write packages/web && pnpm typecheck && pnpm --filter @sengoku-jidai/web test && pnpm build && pnpm lint && pnpm exec prettier --check .`
Expected: all PASS.

Run: `pnpm test:e2e`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/web/src/state/localGame.ts packages/web/src/client/api.ts
git commit -m "refactor(web): drop dead hotseat bootstrap after routing rewire"
```

---

## Self-Review

**1. Spec coverage** (`docs/superpowers/specs/2026-06-25-online-multiplayer-design.md`):
- Routing `/g/:gameId#<token>`, token in fragment → Task 2 (`route.ts`), Task 5 (loader). ✅
- Create screen (name + side) → land in game + copyable invite link → Task 5 (`CreateGameScreen`, `handleCreate`), Task 6 (`PlayersPanel` invite). ✅
- Claim/name prompt on opening an open seat link → Task 5 (`ClaimSeatPrompt`, `needsClaim` gate). ✅
- Both seats' names + "waiting for opponent to join" → Task 6 (`PlayersPanel`). ✅
- Polling loop while not your turn → Task 7 (`shouldPoll` + effect). ✅
- "View as" limited to held seats → Task 5/6 (`heldSeats`). ✅
- Token storage replaces two-token bootstrap → Task 3 (cache), Task 8 (remove legacy). ✅
- New games use `private_multiplayer` → Task 4 (`createGame`). ✅
- Remove dead `joinGameRequestSchema`/`JoinGameRequest` → Task 1 (also `JoinGameResponse`). ✅
- e2e smoke: create with a name, then play (single browser) → Task 5/6 spec updates. ✅
- Optional negative-path claim test / unreachable-404 comment → **intentionally omitted**: Phase 1's server tests already cover claim auth (401/403) and the 404 path; this phase is web-only. Noted here rather than silently dropped.

**2. Placeholder scan:** No TBD/TODO/"handle edge cases"/"similar to" — every code step carries complete code.

**3. Type consistency:** `LoadedGame` ({ gameId, token, heldSeats, revision, view, seatInfo }) is used identically across Tasks 5–7. Viewer seat is always `game.view.viewerSeat`; the submit token is always `game.token`; held seats are `SeatToken[]` in App and mapped to `SeatId[]` only at the `PlayersPanel` boundary. `shouldPoll(view, seatInfo)` signature matches its test and call site. `createGame`/`claimSeat`/`fetchEvents` signatures match their tests and App call sites.

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-06-25-online-multiplayer-web.md`. I recommend **Subagent-Driven execution** (fresh implementer per task, review between tasks) on a new branch `feat/online-mp-web` off `main`, ending in a PR watched through CI, asking before merge.
