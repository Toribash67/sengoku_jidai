# Admin panel — design

**Date:** 2026-07-13
**Status:** approved, pending implementation plan

## Goal

Give the operator a password-gated `/admin` page that lists every game, shows each
game's metadata and seat info, exposes retrievable invite links (for games created
after this ships), and lets the operator delete a game outright.

## Constraints discovered

- The server stores only a **hash** of each seat token (`game_sessions.token_hash`).
  The raw token is returned once at game creation and otherwise lives only in the
  invite URL fragment (`/g/<gameId>#<token>`). Therefore invite links for games that
  **already exist** cannot be recovered from the database.
- There is no user-account or auth system today; seat access is by secret token.
- Single Fastify + better-sqlite3 server, single instance, live in production.
- `games` rows cascade (`ON DELETE CASCADE`) to `game_seats`, `game_sessions`,
  `game_snapshots`, `game_events`, and `game_command_attempts`.

## Decisions

1. **Auth:** password-gated with a single shared `ADMIN_PASSWORD` env var, compared
   directly (plaintext string compare) on each admin request. No accounts, no signed
   session tokens.
2. **Invite links:** store raw seat tokens **going forward**. Games created after the
   migration have recoverable links; older games show "link unavailable". No reissue.
3. **Delete:** hard delete (cascade). No soft archive.

## Server changes

### Migration `005_admin_tokens.sql`

```sql
ALTER TABLE game_sessions ADD COLUMN token TEXT;
```

Nullable — NULL for sessions created before this migration. Register it in the
migrations array in `persistence/database.ts`. In `GameRepository.createGame`, write
the raw `token.token` into this new column alongside the existing `token_hash`.

### Config (`config.ts`)

Add `adminPassword: z.string().optional()` sourced from `ADMIN_PASSWORD`. When unset,
the admin API is disabled (returns 503). Existing deploys are unaffected until the var
is set.

### Repository methods

- `listGamesForAdmin(): AdminGameSummary[]` — one entry per game
  (`id`, `mode`, `status`, `mapId`, `revision`, `createdAt`, `updatedAt`) each with its
  seats `[{ seat, name, status, token | null }]`, joining the non-revoked session per
  seat to obtain the raw token.
- `deleteGame(gameId): boolean` — `DELETE FROM games WHERE id = ?`; FK cascade removes
  the rest. Returns whether a row was deleted.

### Routes (`api/routes.ts`)

`registerApiRoutes` gains a `config` parameter (passed from `app.ts`). A `requireAdmin`
guard runs before each admin handler:

- `adminPassword` unset → 503 `adminDisabled`
- missing or incorrect bearer token → 401 `invalidAdmin` (direct string compare)

Endpoints:

- `GET /api/admin/games` → `{ games: AdminGameSummary[] }`. Returns **all** games
  (ongoing and finished) so either can be cleaned up; `status` distinguishes them.
- `DELETE /api/admin/games/:gameId` → 204, or 404 `gameNotFound` if unknown.

## Shared package

Add `AdminGameSummary` and `AdminSeatSummary` types to `@sengoku-jidai/shared` so web
and server share the API contract (matching the repo's cross-package type-sync
convention). Raw tokens are returned in these payloads — only ever to an authenticated
admin.

## Web changes

- `state/route.ts`: new `{ kind: "admin" }` route matching `/^\/admin\/?$/`. The
  password is entered in a form, never carried in the URL.
- `client/admin.ts`: `fetchAdminGames(password)` and `deleteAdminGame(password, gameId)`,
  each sending `Authorization: Bearer <password>`.
- `components/AdminScreen.tsx`: password prompt; password held in `sessionStorage`
  (survives refresh within the tab, cleared on 401). On auth, renders each game with
  metadata, per-seat name/status, a **Copy invite link** button (built with the existing
  `inviteUrl(window.location.origin, gameId, token)`, or "link unavailable" when the
  token is NULL), and a **Delete** button behind a confirm.
- `App.tsx`: render `AdminScreen` when `route.kind === "admin"`. Styles in `app.css`.

## Error handling

- 401 → re-prompt with an error message; clear stored password.
- 503 → "admin not configured on this server".
- delete 404 → refresh the list.
- Network errors → surfaced inline.

## Testing

- `server/test/adminApi.test.ts` (via `app.inject`): 401 on missing/wrong password,
  503 when `adminPassword` unset, 200 list includes a freshly created game with
  recoverable seat tokens, delete → 204 and the game is absent from a follow-up list
  with snapshots cascaded away, 404 on an unknown id.
- `server/test/config.test.ts`: `ADMIN_PASSWORD` is parsed into `adminPassword`.
- web `state/route.test.ts`: `/admin` parses to `{ kind: "admin" }`.
- web `client/admin.test.ts`: request shape (bearer header, URL).

## Deploy

Document `ADMIN_PASSWORD` and add an example (commented) entry to
`deploy/dockge/compose.yml`. It is optional; absence keeps admin disabled. The password
is sent as a bearer on each call, so the deployment must terminate TLS in front of the
container.

## Out of scope (YAGNI)

No board/state viewing, no editing of games, no token reissue for old games, no
pagination.
