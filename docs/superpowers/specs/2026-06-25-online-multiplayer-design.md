# Online multiplayer: named seats + invite links — design

**Status:** approved (brainstorming) — pending implementation plan
**Date:** 2026-06-25

## Context

Today the game runs as **hotseat**: the server already persists everything in SQLite
(`games`, `game_seats`, `game_sessions`, `game_snapshots`, `game_events`,
`game_command_attempts`) and resolves every command server-side. `createGame` claims both seats,
issues a **per-seat bearer token** (stored hashed in `game_sessions`), and hands both tokens to a
single browser, which keeps them in `localStorage` and switches between seats. A
`/api/games/:id/join` route is stubbed (501), and the engine's `GameMode` already includes
`"private_multiplayer"`.

We want lightweight **online play against a friend**. Games are short (~30 min) with both players
present for the duration — so accounts, login, lobbies, history, and cross-device resume are
unnecessary weight. (An earlier draft of this spec proposed Google auth + accounts + a lobby;
that was deliberately dropped as overkill for this game.)

## Decisions (locked during brainstorming)

- **No accounts / no login.** Create a game, give yourself a display name, get a link to invite
  one opponent.
- **A seat *is* a link.** Each seat has an unguessable token carried in its URL; possessing the
  link controls that seat. Reopening your link restores your seat after a refresh, crash, or on
  another device. (Accepted tradeoff: your link is your seat — don't reshare it. Control is by
  possession, an honor system suited to a friendly game.)
- **Server-side game state stays.** The engine runs on the server, so authoritative state must
  live there — and already does. This work adds no persistence; it adds naming + the invite/claim
  flow on top of the existing seat-token model.
- **Live updates = polling.** Clients re-poll the existing revision/events endpoints every few
  seconds while waiting; no websockets/SSE (easy to add later).
- **Solo play stays single-browser.** Creating a game returns *both* seat links to the creator's
  browser, so the existing seat-switcher keeps working for playing both sides. Sending one link to
  a friend is how you go two-player.

## Model

A **game** has two seats (`red`, `black`), each with a secret **seat token** = the credential,
carried in a seat URL. A display name and a `status` (`open` | `claimed`) hang off each seat.

- **Create**: the creator submits a display name and chosen side (default Red). The server creates
  the game, sets that seat's name and `status = claimed`, leaves the other seat `open` (no name),
  and returns *both* seat tokens to the creator. The creator keeps their own link and sends the
  other (the **invite link**) to an opponent.
- **Claim**: opening the open seat's link shows the game; the visitor enters a display name, which
  sets that seat's name and `status = claimed`. The token in the link is the credential
  thereafter.
- **Play**: each request carries the seat token (Bearer header, as today). Whoever holds a link
  controls its seat; solo = the creator holds both.

No user identity exists, so "claimed" means "a name has been set," not a binding to an account.

## Data model

**No new tables; likely no migration.** `game_seats` already has `seat`, `status`,
`display_name`. We change how `createGame` populates them (creator seat `claimed` with the chosen
name; other seat `open`, name `NULL`) and add the claim step. `game_sessions` (the hashed seat
tokens) is **kept** — it is now the core credential. The OCC + `game_command_attempts` logic keyed
on `seat` is unchanged. New games are created with engine `mode: "private_multiplayer"`.

(`game_seats.player_id` is currently `NOT NULL` and set to the seat name; we keep populating it
with a stable per-seat id so no schema change is forced. If a migration proves cleaner during
implementation, it stays additive — dev `.data/*.sqlite` is disposable.)

## API

- `POST /api/games` — body `{ name, side? }` (default `side: "red"`). Creates the game; returns
  `{ gameId, yourSeat, seats: [{ seat, token, name, status }, …], revision, view }` — i.e. both
  seat tokens, so the web can build your seat URL and the invite URL, and show both names.
- `POST /api/games/:id/claim` — Bearer = the open seat's token; body `{ name }`. Sets the seat's
  `display_name` and `status = claimed` if still open; returns the view. (This replaces the 501
  `/join` stub.) Idempotent if the same token re-claims; rejects if a *different* name is already
  set on a claimed seat.
- `GET /api/games/:id` — Bearer seat token; returns `{ revision, view, seats: [{ seat, name,
  status }] }` so each player sees both display names and whether the opponent has joined.
- `POST /api/games/:id/commands`, `GET /api/games/:id/events` — unchanged logic, still seat-token
  authed.

Seat-name info travels in the **API envelope** (read from `game_seats`), not inside the engine
`PlayerGameView` — the engine stays unaware of DB display names.

## Web / client

- **Routing**: a seat URL (e.g. `/g/:gameId#<token>` or `/play/:token`) loads the game for that
  seat. On load: fetch the view with the token; if the seat is `open`, prompt for a display name
  and `claim`; otherwise go straight in.
- **Create screen**: enter your name, pick a side, Create → land in the game and show a
  **copyable invite link** for the open seat (until the opponent claims it).
- **In-game**: show both seats' names (and "waiting for opponent to join" while the invite seat is
  `open`); a **polling loop** refetches view/events every few seconds while it isn't your turn;
  the existing "view as" seat-switcher offers only the seats whose token this browser holds (both
  for the creator, one for the opponent).
- **Token storage**: read the seat token from the URL; cache the game's tokens in `localStorage`
  as a convenience for resume, but the link is the source of truth. Replace the current
  two-token-bootstrap in `state/localGame.ts`.

## Engine / shared

- **Engine**: unchanged (seat names are repository/envelope-level). New games use
  `mode: "private_multiplayer"`.
- **Shared**: extend `createGameRequestSchema` with `{ name, side? }`; flesh out
  `joinGameRequestSchema` into the claim request `{ name }`; extend the create/view response
  envelopes with the `seats` name/status array.

## Testing

- **Server**: create with name + side (names/status set correctly, both tokens returned); claim
  sets the open seat's name and flips status; re-claim idempotency + reject-on-name-conflict;
  view envelope includes both names; seat-token auth unchanged.
- **Web**: create form, the claim/name prompt when opening an unclaimed seat link, polling
  behaviour, invite-link display.
- **e2e smoke**: minimal change — create a game with a name, then play. Because the creator holds
  both seat tokens, the existing single-browser seat-switch flow and the `data-active-seat` hook
  still work; no second browser context needed.

## Delivery — phased PRs

Each phase is its own branch/PR through the usual gate (`typecheck`, `test`, `build`, `lint`,
`prettier --check`) + CI watch.

1. **Backend**: `createGame` takes name + side and returns both seats; the claim endpoint
   (replacing the `/join` stub); seat names/status in the view envelope; shared schema updates;
   server tests.
2. **Web**: seat-URL routing, the create screen (name + side) + copyable invite link, the
   claim/name prompt, both-names display + "waiting to join", and the polling loop; remove the old
   two-token bootstrap.

(Could ship as a single PR; split in two to keep each reviewable.)

## Out of scope (for now)

- Accounts, login, Google/OAuth, lobby, game history, cross-device identity.
- Websockets/SSE (polling instead).
- Hard enforcement of seat ownership (control is by link possession).
- Reclaiming a seat after losing the link (game is effectively abandoned — acceptable for short,
  both-present games).
- Cleanup/TTL of abandoned games.
