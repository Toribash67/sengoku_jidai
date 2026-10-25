# Spectator link — design

Date: 2026-10-25 · Branch: `spectator-link`

## Intent

Let friends watch a live online game between two other people. A player copies a spectator link
from the Players panel and shares it; anyone who opens it sees the game as it happens, but only
what is public. Spectators are passive: they cannot act, cannot post in chat, and cannot learn
anything that would let them tip off one side. Players can see how many people are watching.

## Goals

- One spectator link per game, valid for the whole game (including after it ends).
- The link sits in the Players panel next to (below) the seat invite box and is visible to both
  players **for the whole game** — unlike the invite box, which disappears once the opponent
  joins.
- Spectators see **public information only**: board, units, bonuses, action spaces, VP,
  commanders, the event log, dice results, and the chat. Never either player's hand contents or
  any face-down / not-yet-revealed order information.
- Spectators can **read** chat but not post (no input box; the server rejects posts too).
- Players see a live **spectator count** ("👁 2 watching") in the Players panel. Hidden when 0.
- The spectator page updates as the game progresses, the same way a player's page does now
  (polling).

## Non-goals

- Spectator names, a list of who is watching, or spectator chat.
- Revoking or rotating the spectator link.
- Listing public games / discovering games without a link.
- Websockets, or any change to the existing game/chat polling (the one addition is the light
  spectator-count poll below).
- An admin-panel copy of the spectator link (cheap to add later; not required).

## Anti-goals (would be a failure even if it "works")

- Any hidden information reaching the spectator client — hand contents, deck/discard order,
  `rngState` (future dice), or the content of a seat's own `pendingDecision`. (The engine has no
  face-down orders; deployment and `cardPlayed` are public by design.) The server must produce the spectator payload; the client must
  not receive a player view and hide parts of it.
- A spectator token that can submit commands, claim a seat, post chat, or read a seat's view.
- Spectator traffic able to change game state or revision in any way.

## Constraints (from the repo)

- Server is authoritative; clients send intent only (`AGENTS.md`).
- `packages/engine` stays pure/deterministic. The spectator projection belongs in the engine next
  to `playerView` (`packages/engine/src/view.ts`); new client-facing exports go through
  `engine/src/client.ts`.
- Existing seat tokens live in `game_sessions` (hash plus, since migration 005, the raw `token`),
  which has a foreign key to `game_seats(game_id, seat)`; spectator tokens are not seats, so they
  need their own storage (new migration `009_…sql`). Never reset production data.
- Seat tokens ride in the URL fragment (`/g/:gameId#token`) so they never hit server logs; the
  spectator link should keep that property.

## Decided

- **Who/what:** friends watching a game between two others; public info only; read-only chat;
  spectator count shown to players; link next to the seat invite links. (Martin.)
- **Count semantics (my call, Martin agreed):** a spectator "is watching" if their tab polled
  within roughly the last 30 s. Each tab counts once (a per-tab random client id sent with the
  spectator's requests). Kept **in memory** on the server, so a restart resets it to 0 until
  spectators poll again. Not persisted.
- **Count refresh (Martin):** the count must stay live even on the player's own turn and in
  vs-Computer / hotseat games. Players' existing polls stop on their own turn (`shouldPoll` in
  `packages/web/src/state/polling.ts`) and chat polling only runs in online human-vs-human games,
  so add a light, always-on poll (~every 15 s, while the game page is open and the game is
  active) that fetches only the count. Endpoint shape is the builder's call.
- **Spectator screen (my call, Martin agreed):** same board, event log and chat as players; a
  "Spectating" label instead of seat controls; no action bar, no hand, no interactive controls;
  prompt line describes whose turn it is from a neutral perspective (e.g. "Black is giving
  orders").
- **Availability (my call, Martin agreed):** every game gets a spectator link, including games vs
  the computer and hotseat games.

## Left to the builder

- **URL shape.** Must be distinguishable from a seat link client-side and keep the token in the
  fragment, e.g. `/g/:gameId/watch#token` (new route kind `spectate`).
- **Token storage.** The link must be retrievable by either player at any time. Suggested: a `game_spectator_links` table (game_id PK, token
  stored so the server can return the full link to authenticated players, created lazily or at
  game creation; backfill/lazy-create for existing games). Storing the raw spectator token is
  acceptable — it grants read-only public access, which is the point of sharing it. Builder may
  pick hash+recompute alternatives if cleaner.
- **How players receive the link.** E.g. add `spectatorToken` (or the full path) to the
  authenticated `GET /api/games/:gameId` response for seat holders.
- **Spectator API.** Read-only endpoints authenticated by the spectator token (Bearer, like
  seats): game view, events-after-revision, chat-after. They must reject command / claim / chat
  POST. Whether these are new routes or the existing ones branching on token type is the
  builder's call, as long as a seat token and a spectator token can never be confused.
- **Spectator view shape.** An engine function (e.g. `spectatorView(state)`) built from the same
  pieces as `playerView` with both hands reduced to counts, no legal-command summary, a neutral
  prompt, and the event log filtered to what both players could see (the existing public
  classification of `GameEvent`s, see `playerEvents`). Whether it reuses `PlayerGameView` with a
  null/absent `viewerSeat` or is a separate type is the builder's call; keep the web board
  rendering shared rather than forking components.
- **Count plumbing.** Where the in-memory tracker lives in `packages/server`, and the exact
  count endpoint (see Count refresh above).
- **Copy, layout, CSS** of the spectator box and count, following the existing invite box.

## Verification expectations

- Engine unit tests: the spectator view contains no hand contents for
  either seat, no deck order, no `rngState`, and no seat's `pendingDecision` content (e.g. during
  card-choice and combat decisions).
- Server tests: spectator token reads view/events/chat; is rejected for commands, claim, chat
  post, and for another game; seat tokens are unaffected; count rises with distinct client ids
  and expires after the window.
- Playwright: open a game, copy the spectator link, open it in a second context, see the board
  and chat read-only, and see the count on the player's screen.
- Full gate per `AGENTS.md`.
