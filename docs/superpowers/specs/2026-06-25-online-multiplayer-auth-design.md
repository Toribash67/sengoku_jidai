# Online multiplayer: Google auth, game lifecycle, invites — design

**Status:** approved (brainstorming) — pending implementation plan
**Date:** 2026-06-25

## Context

Today the game runs as **hotseat**: the server already persists everything in SQLite
(`games`, `game_seats`, `game_sessions`, `game_snapshots`, `game_events`,
`game_command_attempts`), but seats are **anonymous** — `createGame` claims both seats with
`player_id = "red"/"black"`, issues two bearer tokens, and hands both to a single browser, which
stores them in `localStorage` and switches between seats. There is no concept of a user account.
A `/api/games/:id/join` route is stubbed (501), and the engine's `GameMode` already includes
`"private_multiplayer"`.

We want real **online play**: log in with Google, create a game, invite a friend by link, and
play from separate devices — while still being able to play both sides yourself. Persistence
already exists, so this work is about **identity, game lifecycle, and invites**, not building
storage from scratch.

## Decisions (locked during brainstorming)

- **Login-gated, with solo control.** Login is required for everything. A logged-in user can
  drive *both* seats of a game they own (until an opponent joins), and can also invite an
  opponent. There is no separate anonymous hotseat path.
- **Invites = single-use shareable link.** Creating a game yields a link with an unguessable
  code; anyone it's sent to logs in and claims the one open seat. The link is single-use
  (consumed on claim) and revocable.
- **Live updates = polling.** Clients re-poll the existing revision/events endpoints every few
  seconds while waiting; no websockets/SSE for now (easy to upgrade later).
- **Post-login home = full My Games lobby.** Lists active, waiting-for-opponent, and finished
  games with status, plus create/resume/copy-link actions.
- **Auth mechanism = cookie session + `@fastify/oauth2`.** Server-side sessions in SQLite, signed
  HttpOnly cookie. Replaces the anonymous bearer seat-token model. (Rejected: a full auth
  framework — overkill; stateless JWT — weak revocation, token in JS-readable storage.)

## Model

A **user** is a Google account. A **game** has an owner (creator) and two seats. At creation the
owner takes one seat (Red by default, their choice) and the other seat is **open**. The owner has
**solo control** of any open seat, so they can play both sides until someone joins. A single-use
invite link lets another logged-in user claim the open seat; once claimed, the owner loses
control of it. New games use the engine mode `"private_multiplayer"`.

The anonymous bearer-seat-token model is **retired**: identity comes from the session cookie and
seat control is derived server-side from the user↔seat binding.

## Data model — migration `002`

- **`users`** — `id`, `google_sub` (UNIQUE), `email`, `display_name`, `avatar_url`, `created_at`,
  `last_login_at`.
- **`auth_sessions`** — `id`, `user_id` (FK→users), `cookie_hash` (UNIQUE), `created_at`,
  `expires_at`, `revoked_at`. Server-side session store for the HttpOnly cookie; revocable.
- **`games`** — add `owner_user_id` (FK→users).
- **`game_seats`** — replace `player_id` with nullable `player_user_id` (FK→users) + `status`
  (`open` | `claimed`). Owner's seat starts `claimed`; the other starts `open`.
- **`game_invites`** — `code` (UNIQUE, unguessable), `game_id`, `seat`, `created_by` (FK→users),
  `created_at`, `consumed_at`, `revoked_at`. Single-use, revocable.
- **Retire `game_sessions`** (seat bearer tokens). The OCC + `game_command_attempts` logic keyed
  on `seat` is unchanged.

Dev `.data/*.sqlite` is disposable, so the migration can reshape `game_seats` freely.

## Auth flow & endpoints

Dependencies: `@fastify/oauth2` (Google OIDC redirect/callback/token exchange) and
`@fastify/cookie` (signed cookies, using the existing `sessionSecret` from config).

- `GET /api/auth/google` → redirect to Google consent.
- `GET /api/auth/google/callback` → exchange code, read the Google profile, upsert the user,
  create an `auth_session`, set a signed HttpOnly cookie (`SameSite=Lax`, `Secure` in prod),
  redirect into the web app.
- `POST /api/auth/logout` → revoke the session row, clear the cookie.
- `GET /api/auth/me` → the current user, or 401.
- **`POST /api/auth/dev-login`** — enabled only when `NODE_ENV !== "production"`. Logs in a fake
  user by email with no Google round-trip, so local dev and Playwright CI work without real
  credentials. This is how the e2e smoke tests authenticate.

Cookies are same-origin in both dev (Vite proxies `/api` → server) and prod (Fastify serves the
web `dist`), so no CORS/`SameSite=None` complexity.

## Authorization

- `requireUser` middleware: cookie → `auth_session` → user, else 401.
- **View** a game (`GET /api/games/:id`, `…/events`): allowed if the user is a participant — the
  owner or a claimed-seat user.
- **Act on a seat** (`…/commands`): allowed iff the user is bound to that seat, **or** the seat is
  `open` and the user is the owner (solo control). Turn order remains engine-enforced.
- Requests no longer carry a seat token; the cookie identifies the user and the route/body names
  the seat being acted on.

## Game lifecycle & invite endpoints

- `POST /api/games` — create a game; owner picks a side (default Red); the other seat is `open`;
  mint an invite code; return the game + invite link.
- `GET /api/games` — **lobby list** of the user's games: opponent display name (or "open"), whose
  turn it is, status (your turn / waiting for join / their turn / finished), and the user's role.
- `GET /api/games/:id` — player view, as the seat(s) the user controls.
- `POST /api/games/:id/join` (body `{ code }`) — if the code is valid and unconsumed and the seat
  is `open`, bind the user to the seat and consume the code.
- `POST /api/games/:id/invite/regenerate` and `…/revoke` — owner re-issues or kills the link
  (small; powers the "open" lobby card). 
- `POST /api/games/:id/commands` and `GET /api/games/:id/events` — unchanged logic, now under
  cookie + seat authorization.

## Web / client changes

- **Auth context**: on load, `GET /api/auth/me`; if 401 show a **Login screen** ("Sign in with
  Google"). All `fetch` calls use `credentials: "include"`.
- **My Games lobby** (post-login home): the game list + "New game" + per-game
  Resume / Copy invite link / View.
- **Create flow**: pick a side → receive the game + an invite link to copy.
- **Join page** (`/join/:code`): logged-in → claim the seat → enter the game; logged-out → log in,
  then resume the join.
- **In-game**: the seat-switcher becomes a "view as" control showing only the seats the user
  controls (both when solo, one once an opponent joins). A **polling loop** refetches the
  view/events every few seconds while it is not the user's turn.
- **Remove** the `localStorage` seat-token model (`state/localGame.ts`).

## Engine / shared

- **Engine**: essentially unchanged — lobby data is repository-level, not engine-level. New games
  use `mode: "private_multiplayer"`.
- **Shared**: new zod schemas for `auth/me`, the game-summary list, create-game (with chosen
  side), and join requests. The existing `joinGameRequestSchema` stub is fleshed out.

## Testing

- **Server**: auth callback with a mocked Google token exchange; authorization rules (seat
  binding, solo control of open seats, non-participant denied); invite single-use + revoke; lobby
  listing.
- **Web**: auth-context states, lobby rendering, join flow.
- **e2e smoke**: login is now required — the specs call **dev-login** before creating/playing,
  replacing today's no-auth `createHotseatGame` path. The active-seat hook (`data-active-seat`)
  and other DOM hooks stay.

## Config & setup

New env vars: `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `OAUTH_REDIRECT_BASE`, plus cookie
flags. A **`SETUP.md`** documents the Google Cloud Console steps (create an OAuth 2.0 Web client,
authorized redirect URI `…/api/auth/google/callback`). Without credentials, **dev-login** keeps
the app and CI fully runnable.

## Delivery — phased PRs

Each phase is its own branch/PR through the usual gate (`typecheck`, `test`, `build`, `lint`,
`prettier --check`) + CI watch, with the design's decisions as the contract.

1. **Auth foundation** — `users` / `auth_sessions` tables, `@fastify/cookie` + `@fastify/oauth2`
   Google login, `/me`, `/logout`, dev-login; web auth context + login screen.
2. **Identity migration** — `owner_user_id` + user-bound seats (`status` open/claimed), retire
   seat tokens, move create/view/commands to cookie + seat authorization, implement solo control.
3. **Invites + join** — `game_invites` table, create returns a link, join page + endpoint,
   revoke/regenerate.
4. **Lobby + polling** — My Games list endpoint + UI, the in-game polling loop, "view as" seat
   control.

## Out of scope (for now)

- Websockets/SSE (polling instead).
- Email-restricted invites (open shareable link only).
- Spectators / non-participant viewing.
- Matchmaking, ranking, friends lists.
- Production deployment specifics beyond env-configurability + the setup doc.
