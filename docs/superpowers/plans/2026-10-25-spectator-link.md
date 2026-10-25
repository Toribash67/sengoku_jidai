# Spectator Link Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A per-game spectator link that shows friends a live, public-only, read-only view of a
game, with a live "N watching" count for the players.

**Architecture:** The engine gains a `spectatorView(state)` projection (both hands reduced to
counts, no decision, no legal actions, neutral prompt) and `spectatorEvents`. The server stores
one spectator token per game in a new table, serves read-only `/api/watch/:gameId…` routes
authenticated by that token (seat routes keep using `game_sessions` only, so the two token kinds
can never be confused), and keeps an in-memory presence tracker that players read through
`GET /api/games/:gameId/spectators`. The web app reuses the existing game screen with a
`spectating` flag on `LoadedGame`, hiding every control.

**Tech Stack:** TypeScript, Fastify, better-sqlite3, React, Vitest, Playwright, pnpm monorepo.

**Spec:** `docs/superpowers/specs/2026-10-25-spectator-link-design.md`

## Global Constraints

- Engine stays pure and deterministic; new client-facing engine exports go through
  `packages/engine/src/client.ts`.
- The server builds the spectator payload; a spectator never receives a `PlayerGameView` built
  for a seat.
- A spectator token never authenticates seat routes (view/commands/claim/chat POST/events/chat
  GET under `/api/games/…`), and a seat token never authenticates `/api/watch/…`.
- Presence window: **30 000 ms**. Player count poll: **15 000 ms**. Spectator view/chat poll:
  the existing **3 000 ms**.
- Spectator URL: `/g/:gameId/watch#<token>` (token in the fragment).
- Count copy: `👁 N watching` (hidden when N = 0). Spectator label copy: `Spectating`.
- New migration file `packages/server/migrations/009_spectator_links.sql`; never reset data.
- Use `corepack pnpm …`. Before filtered package tests, rebuild changed upstream packages
  (`corepack pnpm --filter @sengoku-jidai/shared --filter @sengoku-jidai/engine build`) —
  downstream packages consume `dist`.

## Review Focus

1. **A game created before this change** (no spectator row) → the first players' `/spectators`
   call lazily creates the token; the link appears. Test in Task 2.
2. **Spectator polls while red/black is mid-decision** (e.g. a pending `selectCombat` or
   `siegeAssault` for one seat) → view's `pendingDecision` is null and hands are empty. Test in
   Task 1.
3. **Spectator token used against `POST /api/games/:id/commands` or `/chat`** → 401, state
   untouched. Test in Task 2.
4. **Missing/garbage `x-spectator-client` header** → view still served, just not counted (no
   500, no unbounded map growth from a single bad client). Test in Task 2.
5. **Spectator opens the link to a finished game** → board and final result show; no polling
   loop errors. Covered by `shouldPoll` test in Task 3.

---

### Task 1: Engine spectator projection

**Files:**
- Modify: `packages/engine/src/view.ts` (add fields to `PlayerGameView`, add `spectatorView`,
  `spectatorEvents`, neutral prompt helper)
  (the root `index.ts` already re-exports `view.js`; `client.ts` needs no change — the new
  fields ride on the already-exported `PlayerGameView` type)
- Test: `packages/engine/test/spectatorView.test.ts`

**Interfaces:**
- Produces:
  - `PlayerGameView` gains two optional fields:
    `spectator?: true` and `handCounts?: Record<SeatId, number>` (both present only on
    spectator views).
  - `spectatorView(state: GameState): PlayerGameView` — same as `playerView(state, "red")`
    except: `viewerSeat: "red"` (nominal, used only for colours), `spectator: true`,
    `hand: []`, `opponentHandCount: state.players.black.hand.length`,
    `handCounts: { red, black }` from hand lengths, `pendingDecision: null`,
    `legal`: the summary with every list empty and every flag false (`activeSeat` copied),
    `prompt`: from `spectatorPrompt(state)`.
  - `spectatorEvents(events: GameEvent[]): PlayerGameEvent[]` — events visible to **both**
    seats (`playerEvents(e, "red")` ∩ visible to black); one choke point like `playerEvents`.
- Neutral prompt copy (`spectatorPrompt(state: GameState): string`, not exported):
  - abandoned / complete: same strings as `buildPrompt`.
  - pending combat: `` `${Seat} is resolving combat.` ``
  - pending decision: `` `${Seat} is deciding.` ``
  - otherwise: `` `Round ${round}: ${Seat} is giving orders.` ``
  where `Seat` is `Red`/`Black`.

- [ ] **Step 1: Write the failing tests** in `packages/engine/test/spectatorView.test.ts`,
  building states the way `packages/engine/test/fortress.test.ts` / `view` tests do:
  - `"hides both hands and reports counts"`: given a state where both seats hold cards,
    `expect(v.hand).toEqual([])`, `expect(v.handCounts).toEqual({ red: <n>, black: <m> })`,
    `expect(v.spectator).toBe(true)`, and
    `expect(JSON.stringify(v)).not.toContain(<each card id in either hand>)` (pick a state
    whose hand card ids do not also appear elsewhere in the view, or assert on
    `v.hand`/`v.pendingDecision`/`v.legal.cardPlays` directly if ids collide).
  - `"never exposes either seat's pending decision"`: with `state.pendingDecision` set for
    red, then for black → `v.pendingDecision === null` both times, and `v.prompt` is
    `"Red is deciding."` / `"Black is deciding."`.
  - `"offers no legal actions"`: on red's deploy turn → `v.legal.canPass === false`,
    `v.legal.spaces.every(s => !s.legal)`, all lists empty, all `can*` false,
    `v.legal.siegeAssault === null`; prompt `"Round 1: Red is giving orders."`.
  - `"leaks no rng/deck state"`: `JSON.stringify(v)` contains neither `rngState` nor `deck`
    keys.
  - `"spectatorEvents keeps only events visible to both seats"`: a mixed event list → equals
    `playerEvents(list, "red").filter(e => playerEvents([e], "black").length === 1)`.
- [ ] **Step 2: Run** `corepack pnpm --filter @sengoku-jidai/engine exec vitest run test/spectatorView.test.ts`
  → FAIL (`spectatorView` not exported).
- [ ] **Step 3: Implement** in `view.ts` per the Interfaces block. Build the empty legal summary
  with a small `emptyLegal(activeSeat)` helper; reuse `playerView` and override fields.
- [ ] **Step 4: Run** the test file → PASS; then `corepack pnpm --filter @sengoku-jidai/engine test`
  → all pass (determinism anchor in `game.test.ts` must be unchanged — views are not part of it).
- [ ] **Step 5: Commit** `feat(engine): spectator view projection`.

---

### Task 2: Server — spectator tokens, presence, and routes

**Files:**
- Create: `packages/server/migrations/009_spectator_links.sql`
- Modify: `packages/server/src/persistence/database.ts` (append `"009_spectator_links.sql"`)
- Modify: `packages/server/src/persistence/repository.ts`
- Create: `packages/server/src/sessions/spectatorPresence.ts`
- Modify: `packages/server/src/api/routes.ts`
- Modify: `packages/shared/src/api.ts` (response types)
- Test: `packages/server/test/spectatorPresence.test.ts`, `packages/server/test/spectatorApi.test.ts`

**Interfaces:**
- Consumes: `spectatorView`, `spectatorEvents` from Task 1 (root `@sengoku-jidai/engine`).
- Migration:
  ```sql
  CREATE TABLE IF NOT EXISTS game_spectator_links (
    game_id TEXT PRIMARY KEY,
    token TEXT NOT NULL UNIQUE,
    created_at TEXT NOT NULL,
    FOREIGN KEY (game_id) REFERENCES games(id) ON DELETE CASCADE
  );
  ```
  (Raw token stored, matching `game_sessions.token`; it grants read-only public access.)
- `GameRepository` additions:
  - `spectatorTokenFor(gameId: string): string | null` — returns the existing token, else
    inserts one (`issueToken().token`) and returns it; null if the game doesn't exist.
  - `gameForSpectatorToken(token: string): string | null` — gameId or null.
  - `getSpectatorView(gameId: string): { revision: number; view: PlayerGameView; seatInfo: GameSeatInfo[] } | null`
  - `spectatorEventsWithRevisionsAfter(gameId: string, afterRevision: number): { events: PlayerGameEvent[]; revisions: number[] }`
    — same as `eventsWithRevisionsAfter` but filtered with `spectatorEvents`. Factor the shared
    row loop so the two differ only in the filter.
- `SpectatorPresence` (`spectatorPresence.ts`):
  ```ts
  export const PRESENCE_WINDOW_MS = 30_000;
  export class SpectatorPresence {
    constructor(private readonly now: () => number = Date.now) {}
    touch(gameId: string, clientId: string): void;
    count(gameId: string): number; // prunes expired entries for that game
  }
  ```
  `touch` also prunes the game's expired entries. Client ids are trusted only as opaque keys.
- `packages/shared/src/api.ts`:
  ```ts
  export interface SpectatorViewEnvelope<View = unknown> {
    gameId: string; revision: number; view: View; seatInfo: GameSeatInfo[];
  }
  export interface SpectatorsResponse { count: number; spectatorToken: string; }
  ```
- Routes (in `registerApiRoutes`; create one `SpectatorPresence` inside it):
  - `GET /api/games/:gameId/spectators` — seat-authenticated exactly like the existing game GET
    (401/403/404 the same) → `SpectatorsResponse` (`spectatorToken` from
    `spectatorTokenFor`, `count` from presence).
  - `GET /api/watch/:gameId` — `Authorization: Bearer <spectatorToken>`; resolve with
    `gameForSpectatorToken`; 401 `invalidSession` "A valid spectator link is required." if
    unknown; 403 `forbidden` if the token's game ≠ `:gameId`. If header `x-spectator-client`
    matches `/^[A-Za-z0-9_-]{8,64}$/`, `presence.touch(gameId, value)`. → `SpectatorViewEnvelope`.
  - `GET /api/watch/:gameId/events?after=N` — same auth (validate query with
    `eventQuerySchema`) → `{ events, revisions }` from `spectatorEventsWithRevisionsAfter`.
  - `GET /api/watch/:gameId/chat?after=N` — same auth (`chatQuerySchema`) →
    `{ messages: repository.chatAfter(...) }`.
  - Factor the spectator auth into one `authenticateSpectator(request, reply, gameId)` helper.
  - No POST route exists under `/api/watch`.

- [ ] **Step 1: Write failing presence tests** (`spectatorPresence.test.ts`, fake clock):
  two distinct client ids → `count === 2`; same id twice → `1`; advance clock by `30_001` →
  `0`; counts are per game (touch game A, `count("B") === 0`).
- [ ] **Step 2: Write failing API tests** (`spectatorApi.test.ts`, `buildApp(testConfig())` +
  `app.inject` like `chatApi.test.ts`):
  - `"players get a stable spectator token; an existing game without one gets it lazily"`:
    red and black both call `/spectators` → same token, `count: 0`; a second call → same token.
  - `"spectator reads view, events and chat"`: watch GET → 200, `view.spectator === true`,
    `view.hand` `[]`; events and chat GETs → 200 and match what a seat sees for public
    events/chat.
  - `"spectator token cannot act or read as a seat"`: spectator token on
    `GET /api/games/:id`, `POST …/commands`, `POST …/claim`, `POST …/chat`,
    `GET …/events`, `GET …/chat` → 401 each; game revision unchanged.
  - `"seat token cannot use watch routes"`: red token on `GET /api/watch/:id` → 401.
  - `"spectator token is bound to its game"`: token of game A on `/api/watch/<B>` → 403.
  - `"count reflects distinct spectator clients"`: two watch GETs with
    `x-spectator-client: aaaaaaaa1` / `bbbbbbbb2` → `/spectators` `count === 2`; a request with
    header `"x"` or none → still 200, count unchanged.
- [ ] **Step 3: Run** `corepack pnpm --filter @sengoku-jidai/shared --filter @sengoku-jidai/engine build && corepack pnpm --filter @sengoku-jidai/server exec vitest run test/spectatorPresence.test.ts test/spectatorApi.test.ts`
  → FAIL.
- [ ] **Step 4: Implement** migration, repository methods, presence, shared types, routes.
- [ ] **Step 5: Run** the two files → PASS; then `corepack pnpm --filter @sengoku-jidai/server test`
  → all pass.
- [ ] **Step 6: Commit** `feat(server): spectator links, read-only watch API, presence count`.

---

### Task 3: Web — route, API client, polling rule

**Files:**
- Modify: `packages/web/src/state/route.ts`, `packages/web/src/state/route.test.ts`
- Modify: `packages/web/src/client/api.ts`
- Modify: `packages/web/src/state/polling.ts`, `packages/web/src/state/polling.test.ts`

**Interfaces:**
- Consumes: shared `SpectatorViewEnvelope`, `SpectatorsResponse` (Task 2).
- Produces:
  - `Route` gains `{ kind: "spectate"; gameId: string; token: string }`, parsed from
    `/^\/g\/([^/]+)\/watch\/?$/` (checked **before** `GAME_PATH`; token from the hash like seats).
  - `spectateUrl(origin: string, gameId: string, token: string): string` →
    `` `${origin}/g/${encodeURIComponent(gameId)}/watch#${token}` ``.
  - `api.ts`: `fetchSpectatorView(gameId, token, clientId): Promise<SpectatorViewEnvelope<PlayerGameView>>`
    (sends `x-spectator-client: clientId`), `fetchSpectatorEvents(gameId, token, after)`,
    `fetchSpectatorChat(gameId, token, after)` (same return shapes as `fetchEvents` /
    `fetchChat`), `fetchSpectators(gameId, seatToken): Promise<SpectatorsResponse>`.
    Spectator client id: export `createSpectatorClientId(): string` producing 32 hex/url-safe
    chars (reuse the `createClientCommandId` randomness; must match the server regex).
  - `shouldPoll(view, seatInfo)`: when `view.spectator` is true, return
    `view.status === "active"` (a spectator is never on the clock).

- [ ] **Step 1: Write failing tests:** `route.test.ts` — `/g/abc/watch` with hash `#tok` →
  `{ kind: "spectate", gameId: "abc", token: "tok" }`; `/g/abc` still parses as `game`;
  `spectateUrl("https://x", "a b", "t") === "https://x/g/a%20b/watch#t"`.
  `polling.test.ts` — spectator view active on red's turn → `true`; complete → `false`.
  `api.test.ts` (existing file) — `createSpectatorClientId()` matches `/^[A-Za-z0-9_-]{8,64}$/`.
- [ ] **Step 2: Run** `corepack pnpm --filter @sengoku-jidai/engine --filter @sengoku-jidai/shared build && corepack pnpm --filter @sengoku-jidai/web exec vitest run src/state test/` (or the web package's test command) → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat(web): spectate route, watch API client, spectator polling rule`.

---

### Task 4: Web — spectator screen, link box, live count

**Files:**
- Modify: `packages/web/src/App.tsx`
- Modify: `packages/web/src/components/PlayersPanel.tsx`
- Modify: the stylesheet that holds `.invite-box` (find with `grep -rn "invite-box" packages/web/src/styles`)
- Test: `tests/e2e/spectator.spec.ts`

**Interfaces:**
- Consumes: everything from Task 3.
- `LoadedGame` gains `spectating: boolean` (and `spectatorClientId?: string`, created once per
  load with `createSpectatorClientId()`).
- `PlayersPanel` gains props `spectating: boolean`, `spectatorLink: string | null`,
  `spectatorCount: number`.

Behaviour to implement in `App.tsx`:
- Route load effect: handle `route.kind === "spectate"` like `"game"` but fetch with
  `fetchSpectatorView`, load history/chat with the spectator fetchers, do **not** call
  `rememberSeatTokens`, set `heldSeats: []`, `spectating: true`. Missing token message:
  "This spectator link is missing its token."
- Game poll and chat poll: choose seat vs spectator fetchers by `current.spectating`. Chat poll
  condition stays `chatEnabled(seatInfo, view.viewerSeat)` (works for spectators: both seats
  are claimed humans in an online game).
- Players' spectator poll (new effect): when `game && !game.spectating`, call
  `fetchSpectators(gameId, token)` immediately, then every 15 000 ms while
  `view.status === "active"`; store `{ count, link: spectateUrl(origin, gameId, spectatorToken) }`
  in state; ignore failures (keep last value). Re-key on `gameId`/`token`.
- When `game.spectating`:
  - skip `ClaimSeatPrompt`; `useTurnAlert(false)`; `useChatAlert` for all chat is fine but must
    not crash — pass `null` to it.
  - Top bar prompt shows `view.prompt` (already neutral).
  - Replace the `ActionBar` branch with `<div className="spectating-banner" role="status">Spectating</div>`
    (status/complete/abandoned banners and the read-only `CombatPanel` still render; its
    `can*` flags are all false).
  - Replace `<Hand>` with a line `Cards in hand: Red {handCounts.red} · Black {handCounts.black}`.
  - `GameLog`: pass `chatEnabled={false}` so no input renders, while chat lines still appear;
    pass `viewerSeat="red"` (no "mine" styling issue: spectator has no messages).
  - Hide "Clear local game".
  - `GameOverOverlay` still shows.
- `PlayersPanel`: when `spectating`, render all pills read-only (already true with
  `heldSeats=[]`), no invite box, no spectator box. Otherwise, below the invite box, render
  (when `spectatorLink`):
  ```
  <div className="invite-box spectator-box">
    <p className="invite-hint">Share this link so friends can watch:</p>
    <div className="invite-row">
      <input readOnly value={spectatorLink} aria-label="Spectator link" />
      <button type="button" className="secondary-action" onClick={…}>Copy</button>   // "Copied!" for 2s
    </div>
  </div>
  ```
  and, when `spectatorCount > 0`, `<p className="spectator-count" aria-label="Spectators">👁 {spectatorCount} watching</p>`.
  Generalise the existing copy/"Copied!" logic so both boxes share it (one `copiedKey` state
  rather than a second timer).

- [ ] **Step 1: Write the failing e2e** `tests/e2e/spectator.spec.ts` modelled on
  `tests/e2e/chat.spec.ts`:
  - host creates a named game; guest joins via `Invite link` in a second context; guest posts
    chat "Hello watchers".
  - host reads `getByLabel("Spectator link")`, opens it in a third context `watcher`.
  - watcher: board visible; `getByText("Spectating")` visible; `getByLabel("Chat message")`
    count 0; game log contains "Hello watchers" (timeout 15 s); no element with
    `getByRole("button", { name: "Pass" })`.
  - host: `getByLabel("Spectators")` has text `👁 1 watching` within 20 s
    (`expect.poll`/`toHaveText` with `timeout: 20_000`).
  - Run locally per memory `no-local-browser-verification` (temp port, not 18081) or rely on CI.
- [ ] **Step 2: Run** `corepack pnpm test:e2e -- spectator` → FAIL.
- [ ] **Step 3: Implement** the App/PlayersPanel/CSS changes above. CSS: `.spectating-banner`
  reuses `.game-over-banner` look; `.spectator-count` is a small muted line. Must fit phone
  width.
- [ ] **Step 4: Run** the e2e → PASS; also `corepack pnpm test:e2e -- chat hotseat` (existing
  invite flows unaffected).
- [ ] **Step 5: Commit** `feat(web): spectator screen, spectator link box and live count`.

---

### Task 5: Gate, PR, CI

- [ ] **Step 1:** `corepack pnpm typecheck && corepack pnpm test && corepack pnpm lint && corepack pnpm build`, then
  `corepack pnpm exec prettier --write` on touched files and `corepack pnpm exec prettier --check .` last.
  (No server SPA change needed: `app.ts`'s not-found handler already serves `index.html` for
  every non-`/api/` path, including `/g/:id/watch`.)
- [ ] **Step 2:** Push `spectator-link`, open PR (body ends with the Claude Code line), watch
  `gh pr checks <n> --watch`, fix failures. Ask Martin before merging.
