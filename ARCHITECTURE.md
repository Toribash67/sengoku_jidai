# Architecture

## Goal

This project is a digital implementation of **General Orders: Sengoku Jidai**. The first milestone is a local, playable hotseat prototype with an architecture that can grow into async or live multiplayer without rewriting the rules engine or client/server boundary.

The implementation should keep three concerns separate:

- **Rules engine**: deterministic game state transitions.
- **Server**: authority, persistence, sessions, and realtime delivery.
- **Client**: rendering, interaction, previews, and local draft UI state.

The server is authoritative. The client may compute previews and legal hints, but accepted commands and persisted game state always come from the server.

The server persists the complete authoritative game state. Clients receive player-specific views of that state so hidden information such as hands, deck order, unrevealed cards, and private pending decisions are not exposed to the wrong seat.

Priority labels in this document:

- **MVP**: required for the first local playable prototype.
- **Soon**: should be added before serious private multiplayer or persistent hosted games.
- **Later**: useful hardening or product depth after the core loop is working.

## Project Shape

```txt
packages/
  engine/
    src/
      client.ts          # curated client-safe surface: @sengoku-jidai/engine/client
      types.ts, state.ts, rules.ts, commands.ts   # domain types + rules config
      game.ts, resolve.ts, validate.ts, view.ts   # setup, resolution, legality, projections
      ...                # further flat rule modules (conflict, supply, scoring, rng, cards, ...)
      maps/
        hex/             # hex map source format, validation, compiler
    test/
  board-render/          # pure SVG board scene builder (map data -> SVG strings)
    src/
    scripts/             # dev-only preview tooling
  terrain/               # AI terrain-image pipeline; built to dist and run by the server
    src/
    profiles/
  server/
    src/
      server.ts
      api/
      persistence/
      realtime/
      sessions/
    migrations/
    test/
  web/
    src/
      App.tsx
      components/
        board/
      client/
      state/
      styles/
    test/
  shared/
    src/
      api.ts
      schemas.ts
assets/
  maps/                  # board + card artwork per map
tests/
  e2e/
deploy/
  dockge/
    compose.yml
    README.md
  watchtower/
    compose.yml
    README.md
.github/
  workflows/
    web-container.yml
Dockerfile
package.json
pnpm-workspace.yaml
tsconfig.base.json
eslint.config.js
prettier.config.js
playwright.config.ts
.env.example
```

`packages/shared` is part of the MVP. It owns API schemas, HTTP payload types, WebSocket message types, and other client/server contract definitions. The engine owns game-domain types and rules; shared should not become a second rules package.

`packages/board-render` builds the board SVG scene from engine map data; it depends only on the engine and produces plain strings (no DOM, no React), so both the web client and dev tooling can use it. `packages/terrain` generates the antique-style terrain background images; it depends only on the engine. Both packages build to `dist` (like `engine` and `shared`) and are consumed by the server at runtime, which invokes `terrain` on demand to generate terrain for custom maps (gated behind `FAL_KEY` and an explicit author trigger).

## Technology Stack

- Language: TypeScript across engine, server, and web.
- Client: Vite, React, TypeScript.
- Server: Node.js, TypeScript, Fastify.
- Realtime: WebSocket as a **Soon** feature. Today the client uses HTTP view fetch, command submission, and interval polling while waiting on the opponent.
- Storage: SQLite for the first durable implementation; Postgres can replace it later behind the same persistence interface.
- Board rendering: SVG first. Move specific layers to Canvas only if SVG becomes a measurable bottleneck.
- Tests: fast unit tests for the engine, API/service tests for the server, Playwright for browser smoke/workflow tests.

## Chosen Tooling

**MVP**

- Package manager: `pnpm` workspaces.
- Client build/dev server: Vite.
- Client framework: React with TypeScript.
- Server framework: Fastify.
- Unit/integration test runner: Vitest.
- Browser test runner: Playwright.
- Server dev runner: `tsx`.
- Runtime schema validation: Zod.
- Database: SQLite.
- SQLite access: start with `better-sqlite3` plus a small repository layer. Add Kysely only if query complexity warrants it.
- Formatting and linting: Prettier plus ESLint.

**Soon**

- Structured logging through Fastify's logger.

**Later**

- Swap SQLite for Postgres behind the persistence interface if hosted usage outgrows SQLite.
- Add a richer query builder if raw SQL becomes error-prone.

## Developer Workflow

**MVP**

Expected root commands:

```txt
pnpm install
pnpm dev
pnpm dev:web
pnpm dev:server
pnpm test
pnpm test:e2e
pnpm typecheck
pnpm lint
pnpm format
pnpm db:reset
pnpm db:seed
```

`pnpm dev` should run the API server and Vite dev server together. In development, Vite serves the web app and proxies `/api` traffic, and later WebSocket traffic, to the Fastify server. In production, the Fastify server can serve the built `packages/web/dist` assets and the API from one process.

Playwright should start the app against a temporary database and deterministic test seed. E2E tests should not depend on manually running servers or existing local game state.

**Soon**

- Add `pnpm db:migrate`.
- Add `pnpm test:server` if server tests grow enough to justify a separate command.
- Add a deterministic dev-game seed route or script for manual UI testing.

## Configuration

**MVP**

Configuration should come from environment variables. Commit `.env.example`; do not commit real secrets.

Initial variables:

```txt
NODE_ENV=development | test | production
API_PORT=3000
WEB_PORT=18081
WEB_ORIGIN=http://localhost:18081
SQLITE_PATH=.data/sengoku.sqlite
SESSION_SECRET=development-only-change-me
LOG_LEVEL=info
```

In development, `API_PORT` and `WEB_PORT` are separate because Vite serves the web app and proxies API traffic to Fastify. In the production container, Fastify should serve the built web assets and API from one process; use container `PORT=80` there and map the NAS host port through Docker.

The server validates configuration at startup (Zod, `server/src/config.ts`) and fails fast with a clear error if required values are missing or malformed. In production it additionally refuses placeholder session secrets (any value containing `change-me`), so a stack deployed with the example value fails at boot instead of running with a known secret.

`FAL_KEY` is read at app runtime by the server (`server/src/config.ts`): it gates on-demand custom-map terrain generation, which is unavailable (503) when unset. `TERRAIN_OUT_DIR` remains dev-only, used only by the `terrain` package's CLI tooling.

**Soon**

- Separate dev/test/prod database paths.
- Ensure test-only APIs are registered only when `NODE_ENV=test`.
- Add allowed origins for hosted private multiplayer.

## Package Boundaries

Allowed imports:

```txt
engine       -> no app packages
shared       -> no app packages
board-render -> engine
terrain      -> engine
server       -> engine, shared, terrain, board-render
web          -> shared, board-render, @sengoku-jidai/engine/client
tests/e2e    -> public app/API only
```

The engine must not import server, web, persistence, React, DOM, HTTP, WebSocket, or Node APIs. The web must not import server-only modules or authoritative-state internals that are not safe for clients.

These boundaries are enforced by per-package `no-restricted-imports` rules in `eslint.config.js`, scoped to each package's `src/` (tests and scripts keep Node access for fixtures and tooling).

The engine publishes a curated client-safe surface as the `@sengoku-jidai/engine/client` subpath (`packages/engine/src/client.ts`): static map data and geometry, the public card list, the `Command` type, and the per-seat view/legality types — nothing that touches authoritative `GameState`, the RNG, deck order, or command resolution. The web may import the engine only through this subpath (lint-enforced); new client-visible engine exports are added there, never by relaxing the web lint rule. Server-side code uses the root engine export.

## Runtime Model

The core state transition is a pure engine call:

```ts
resolveCommand(previousState, actor, command) -> CommandResult

interface CommandActor {
  seat: SeatId;
}
```

The rules configuration is not a separate parameter: it is embedded in the state as `state.rules` (a `RulesConfig`), which keeps every input to a replay serialized inside the snapshot itself.

This is an internal engine boundary used by the server and tests. `previousState` is not part of the public API and is never supplied by the client. For real requests, the server loads the current authoritative state from persistence, derives `actor` from the authenticated session, and then calls the engine.

`CommandResult` is a discriminated union:

```ts
type CommandResult =
  | {
      status: "accepted";
      nextState: GameState;
      events: GameEvent[];
    }
  | {
      status: "rejected";
      reason: RejectionReason;
    };
```

Rejected commands do not produce a new state. If a command creates a pending decision, that pending decision belongs inside `nextState`, not beside it.

Events are deterministic outputs of accepted commands. They are used for UI logs, animation, debugging, and audit. The canonical replay source is the initial state plus the ordered accepted command records, including revision, seat/actor, command payload, and ruleset version. State snapshots are caches for fast loading and reconnects.

The engine must not read files, make network calls, access databases, or depend on wall-clock time. Randomness should be deterministic and represented through an RNG seed or RNG state carried in `GameState`.

## Engine

The engine owns all game rules and serializable game data structures.

Responsibilities:

- Define `GameState`, `PlayerState`, `AreaState`, `Command`, `GameEvent`, and `PendingDecision`.
- Define map/rules configuration data.
- Create initial game state from a selected map and seed.
- Validate whether a command is legal for the current state.
- Resolve commands into a new state and event list.
- Resolve deterministic randomness for dice and shuffled decks.
- Score the game and detect game end.
- Provide helper functions for legal action previews (embedded in each player view).
- Produce player-visible state projections (spectator projections are **Later**).

The engine should not know about:

- HTTP.
- WebSocket.
- Authentication.
- Database records.
- Browser layout.
- React components.

Public API:

```ts
createInitialState(options) -> GameState
resolveCommand(state, actor, command) -> CommandResult
legalCommandsForState(state, seat) -> LegalCommandSummary
playerView(state, seat) -> PlayerGameView      // embeds the seat's LegalCommandSummary as view.legal
playerEvents(events, viewer) -> PlayerGameEvent[]
serializeState(state) -> JsonGameState
deserializeState(json) -> GameState            // validates schema version AND shape (Zod)
```

The client does not compute legality itself: the server embeds the acting seat's `LegalCommandSummary` in every `PlayerGameView` (`view.legal`), so no view-input legality helper is needed. A `spectatorView` projection is a **Later** addition.

`playerEvents` projects engine events for one seat and is fail-closed: it filters through an exhaustive allowlist of public event types, so an event type added without an explicit visibility decision never reaches a client (adding a `GameEvent` variant is a compile error until it is classified there).

The exact area and rules representation can evolve. The important early constraint is that all engine inputs and outputs remain serializable and deterministic.

Commands are player intent per action space, plus the interactive-combat and pending-decision steps:

```ts
type Command =
  | { type: "advance" | "sail"; spaceId: string; moves: Move[]; card?: OperationCard }
  | { type: "bombard" | "shell"; spaceId: string; targetAreaId: string }
  | { type: "reinforce" | "embark"; spaceId: string; placements: Placement[] }
  | { type: "plan"; spaceId: string }
  | { type: "pass" }
  | { type: "combatRoll" | "combatReroll" | "combatResolve"; pendingId: string }
  | { type: "choosePendingDecision"; pendingId: string; choice: PendingChoice };
```

When `state.pendingDecision` or `state.pendingCombat` exists, the engine rejects unrelated commands: a paused combat accepts only its own `combatRoll`/`combatReroll`/`combatResolve` steps, and a pending decision accepts only `choosePendingDecision`.

Map ownership is split by responsibility. The engine owns gameplay topology: area ids, adjacency, action slots, setup, supply/scoring properties, and rule-relevant map facts. The web package owns visual layout: SVG coordinates, labels, hit targets, and responsive presentation. Visual geometry may reference engine area ids, but legal relationships must come from engine map data.

Authoritative state must be plain JSON-compatible data: no `Date`, `Map`, `Set`, class instances, functions, `undefined`, or cyclic references. Every serialized state includes a `schemaVersion` (currently 3). `deserializeState` validates both the version and the full shape (a Zod schema in `stateSchema.ts`, compile-checked against the `GameState` type), so corrupted snapshots fail loudly at load. Once persisted games exist beyond local experimentation, state migrations should be explicit.

## Server

The server is the only component allowed to mutate authoritative game state.

Responsibilities:

- Serve built web assets in production deployments.
- Create games.
- Join or resume seats.
- Receive player commands.
- Check sessions, seat ownership, turn ownership, and state revision.
- Call the engine.
- Persist command attempts, events, and authoritative state snapshots.
- Broadcast state updates to connected clients.
- Expose current player views and event history for reconnects.

The server should avoid duplicating rules. It may reject commands for transport or authority reasons before calling the engine, but legality such as "can this action target this area" belongs in the engine.

Games should have an explicit mode:

```txt
game.mode = hotseat | private_multiplayer | async_multiplayer
```

For hotseat, one browser/session bundle may control both seats. For private multiplayer, each seat has a separate resume token. For async multiplayer, the same command, revision, and session model applies; notifications can be added later.

## Game Modes UX

**MVP**

Hotseat is the first target. The browser may hold both seat tokens for one game. The UI should show the active seat clearly and provide an explicit seat-switch control when both seats are available in the same browser.

`POST /api/games` returns a `seats` array containing resume tokens for both seats in every mode. For hotseat, the browser keeps both. For private multiplayer, the creator names themselves and picks a side at creation; their client keeps the creator token and turns the other seat's token into an invite link (`/g/:gameId#<token>` — the token rides in the URL fragment so it never reaches server logs). The invited player opens the link and `POST /claim` records their name and marks the seat claimed.

Hotseat seat switching should request a fresh `PlayerGameView` for the selected seat. Do not swap seats by revealing the authoritative state client-side.

The non-active seat can see a waiting state when it is not allowed to act. Pending decisions should show who can answer them and should be restored from the server after refresh or reconnect.

**Soon**

Private multiplayer uses the same game state and command API, but each browser normally holds one seat token. Opponent hands, deck order, and private events must remain hidden in the `PlayerGameView`.

If one browser holds multiple seat tokens, each seat view should still be fetched independently. This keeps hotseat behavior aligned with private multiplayer behavior.

**Later**

Async multiplayer can add notifications, "waiting for opponent" summaries, and last-action digests without changing the engine boundary.

Spectator and replay UX can build on `spectatorView`. Live spectators should receive redacted views unless the game rules or table settings explicitly allow open information. Completed-game replay can optionally reveal more information, but that should be an explicit product decision.

## Client

The client renders the board and manages user interaction.

Responsibilities:

- Render the current player-visible game view.
- Track local UI state: selected area, selected command slot, hovered target, open panels, draft command payloads.
- Show legal actions and previews using the server-provided player view and engine/shared helper functions.
- Submit commands with the current state revision.
- Render pending decisions, dice results, command cards, action logs, and game-end state.
- Reconnect to games and resync from the server.

The client should not store authoritative game state beyond the latest view received from the server. It should be able to discard local state and rebuild the visible board from a player view plus local UI defaults.

Client state should be split into:

- Authoritative view: latest server-provided player view and revision.
- Derived view model: computed legal targets, labels, highlights, and board overlays.
- Ephemeral UI state: selection, hover, drawer state, local drafts.
- Network state: pending command, rejected command, reconnecting, and stale flags.

The client should avoid copying engine-owned structures into editable React state. Components should render from selectors over the latest authoritative view plus ephemeral UI state.

The client renders legal actions from `view.legal`, the per-seat `LegalCommandSummary` the server embeds in every `PlayerGameView`. The server may keep hidden information in the authoritative state, but the client only receives data visible to that seat.

Main layout:

- Center: interactive battlefield.
- Top bar: game, round, active player, current prompt.
- Side panel: selected area, legal actions, player resources, hand/cards.
- Bottom or collapsible rail: event log and recent combat details.

Desktop can use a fixed side panel. Mobile/tablet can use an overlay or drawer for the side panel. The initial target should be desktop/tablet, because the board is spatial and benefits from screen area.

Board rendering should use a stable logical coordinate system independent of screen size. SVG layers should be separated by purpose:

- Base board geometry.
- Area ownership/control.
- Units, commanders, and markers.
- Legal-action highlights and supply overlays.
- Interaction layer for pointer targets.
- Labels/tooltips.

Hit targets should be based on area ids, not DOM position. Components should receive board geometry from map/view data and game contents from the current player view.

## Communication

The communication model is HTTP view fetch plus command submission. While it is not the viewer's turn (or a seat is still open), the client polls the view on an interval (`web/src/state/polling.ts`); WebSocket push remains a **Soon** replacement for that polling. HTTP view fetch and WebSocket updates should feed the same client reconciliation path.

HTTP API:

```txt
POST /api/games
GET  /api/games/:gameId
POST /api/games/:gameId/claim
POST /api/games/:gameId/commands
GET  /api/games/:gameId/events?after=:revision
GET  /healthz
```

`POST /claim` is authenticated by the seat token like every other route: the invited player opens the invite link (which carries their seat token), and `/claim` records their display name and marks the seat claimed. There is no separate join handshake that mints tokens.

Soon WebSocket endpoint:

```txt
GET /api/games/:gameId/stream
```

Command submissions should include the revision the client believes it is acting on:

```ts
interface SubmitCommandRequest {
  baseRevision: number;
  clientCommandId: string;
  command: Command;
}
```

The public API accepts player intent, not game state. Clients must not send `GameState`, `nextState`, actor identity, dice outcomes, or hidden-information claims. The server derives `gameId` from the route, loads the authoritative state for that game, derives the acting seat/player from the authenticated session token, and passes that state and actor to the engine separately from the client-submitted command.

If `baseRevision` is stale, the server rejects the command and returns or broadcasts the latest player view. This keeps multiple tabs, reconnects, and simultaneous clients from applying commands to different versions of the game.

Typical command flow:

1. Client renders its player view at revision `N`.
2. Player drafts and submits a command with `baseRevision: N`.
3. Server validates the session and derives the actor.
4. Server loads the authoritative state snapshot for the game.
5. Server checks that the stored game revision still equals `baseRevision`.
6. Server calls `resolveCommand(state, actor, command)`.
7. Server persists the accepted command attempt, events, and new state snapshot at revision `N + 1`.
8. Server replies to the submitting client with an updated player view or projected events.
9. Server broadcasts the new player view or event bundle to connected clients.
10. Clients replace their authoritative view and clear invalid local drafts.

Command submission should be transactional:

1. Start a database transaction.
2. Load the game row and current revision.
3. Return the original result if `(game_id, seat, client_command_id)` was already recorded, whether accepted or rejected.
4. Reject if `current_revision !== baseRevision`.
5. Load or verify the authoritative state snapshot for `baseRevision`.
6. Call the engine with `resolveCommand(state, actor, command)`.
7. Insert the command attempt, events, and state snapshot for `revision = baseRevision + 1` if accepted.
8. Update `games.current_revision` with a compare-and-swap condition such as `WHERE current_revision = baseRevision`.
9. Commit.
10. Broadcast only after commit.

Minimal response contracts:

- `POST /api/games` returns a `PlayerGameViewEnvelope` plus both seats' resume tokens and seat info.
- `GET /api/games/:gameId` returns a `PlayerGameViewEnvelope` plus seat info.
- `POST /api/games/:gameId/claim` returns a `PlayerGameViewEnvelope` plus seat info.
- `POST /api/games/:gameId/commands` returns `{ accepted, revision, view, events }`, where client-facing views are `PlayerGameView` values and events are per-seat `PlayerGameEvent[]`.
- Stale revision returns `409 Conflict`.
- Invalid session returns `401 Unauthorized`.
- Wrong seat or wrong game returns `403 Forbidden`.
- Engine-rejected illegal command returns `422 Unprocessable Entity`.

Client-facing views should use an explicit envelope:

```ts
interface PlayerGameViewEnvelope {
  gameId: string;
  seat: SeatId;
  revision: number;
  view: PlayerGameView;
}
```

Command responses should expose the result of server-side resolution, not ask the client to compute state:

```ts
interface SubmitCommandResponse {
  accepted: boolean;
  revision: number;
  view?: PlayerGameView;
  events?: PlayerGameEvent[];
  error?: {
    code: string;
    message: string;
    requestId: string;
  };
}
```

All request bodies, route params, query params, and WebSocket messages should be validated with Zod before reaching application logic. Persisted JSON blobs should be validated when loaded from storage, especially snapshots and event payloads.

Standard error envelope:

```ts
{
  error: {
    code: string;
    message: string;
    requestId: string;
  };
}
```

User-facing error messages should be safe and concise. Detailed diagnostics belong in structured logs, not API responses.

## Persistence

SQLite is sufficient for the first implementation. Keep persistence behind a small repository layer so tests can use temporary SQLite databases and production can later move to Postgres.

Persist:

- Games.
- Seats/players.
- Sessions or resume tokens.
- Command attempts.
- Engine events.
- State snapshots.
- Current game revision.

Do not persist:

- Hovered area.
- Selected area.
- Open panels.
- Incomplete local command drafts.
- Client-only display preferences unless user accounts are added later.

Suggested tables:

```txt
games
  id
  map_id
  mode
  ruleset_id
  ruleset_version
  ruleset_hash
  status
  current_revision
  created_at
  updated_at

game_seats
  game_id
  seat
  player_id
  status
  display_name
  claimed_at
  last_seen_at

game_sessions
  id
  token_hash
  game_id
  seat
  created_at
  last_seen_at
  revoked_at

game_snapshots
  game_id
  revision
  state_json
  created_at

game_command_attempts
  id
  game_id
  seat
  client_command_id
  base_revision
  accepted_revision
  command_json
  result_status
  rejection_code
  created_at

game_events
  game_id
  revision
  sequence
  event_type
  event_json
  created_at
```

Recommended uniqueness constraints:

```txt
game_snapshots unique(game_id, revision)
game_command_attempts unique(game_id, seat, client_command_id)
game_command_attempts unique(game_id, accepted_revision) where accepted_revision is not null
game_events unique(game_id, revision, sequence)
```

Terminology:

- `seat`: game-side role such as `red`, `black`, or `spectator`.
- `player_id`: stable engine player id; for this game it will usually match the seat.
- `session`: browser-held credential proving control of a seat.
- `user_id`: future account identity, not needed for the first implementation.

`game_snapshots.state_json` stores authoritative `GameState`, not a client-facing `PlayerGameView`.

For the prototype, storing a full state snapshot after every accepted command is acceptable. The game is small and this greatly simplifies reconnects, debugging, and Playwright setup. If storage becomes a concern, keep every command/event and state snapshot every N revisions.

Rejected commands do not advance the game revision. Engine-rejected commands may be stored for audit/debugging with `result_status = rejected`, `base_revision`, and no `accepted_revision`; malformed transport requests can remain request logs only. Accepted commands must always have an `accepted_revision`.

Status values:

```txt
game.status = setup | active | complete | abandoned
game_seats.status = open | claimed        (abandoned is reserved for later)
game_command_attempts.result_status = accepted | rejected
```

## Schema Migrations

**MVP**

Database migrations should be committed SQL files:

```txt
packages/server/migrations/
  001_initial.sql
```

SQLite and `001_initial.sql` are part of the initial scaffold. The server should track applied migrations in a schema table. On startup, it should either apply pending migrations in development/test or fail clearly if the database schema is incompatible.

Development and test databases may be reset. Production databases must not be reset by application startup.

**Soon**

- Server refuses to run against a newer schema than it supports.
- Migrations must preserve active games once the app is used beyond local experimentation.
- Add a backup before migration step for hosted deployments.

## Deployment

**MVP**

Deployment should mirror the sibling Diplomacy project:

- Build a single Docker image from `main`.
- Publish the image to GHCR from GitHub Actions.
- Run the image on the TrueNAS machine through Dockge.
- Opt the container into the existing label-gated Watchtower setup.
- Expose the app on NAS host port `18081`, mapped to container port `80`.
- Expose `GET /healthz` for Dockge, Watchtower, and reverse-proxy diagnostics.

Expected image:

```txt
ghcr.io/toribash67/sengoku-jidai-web:latest
```

If the GitHub owner or repository naming changes, the workflow should still derive the GHCR owner from `GITHUB_REPOSITORY_OWNER`; the image package name should remain stable for the Dockge stack.

Expected Dockge service:

```yaml
services:
  sengoku-jidai-web:
    image: ghcr.io/toribash67/sengoku-jidai-web:latest
    container_name: sengoku-jidai-web
    restart: unless-stopped
    labels:
      com.centurylinklabs.watchtower.enable: "true"
    environment:
      NODE_ENV: production
      HOST: 0.0.0.0
      PORT: "80"
      SQLITE_PATH: /data/sengoku.sqlite
      SESSION_SECRET: change-me
      LOG_LEVEL: info
    ports:
      - "18081:80"
    volumes:
      - sengoku-jidai-data:/data
    healthcheck:
      test: ["CMD", "wget", "-qO-", "http://127.0.0.1/healthz"]
      interval: 30s
      timeout: 5s
      retries: 3

volumes:
  sengoku-jidai-data:
```

The container should use `HOST=0.0.0.0`, `PORT=80`, and store the SQLite database under `/data/sengoku.sqlite` so game state survives container replacement. The `18081:80` mapping intentionally mirrors the sibling Diplomacy deployment style; revisit the container port only if the image is later changed to run as a non-root user.

Expected GitHub Actions flow:

1. Push to `main`.
2. Workflow builds the Docker image.
3. Workflow publishes both `latest` and `${github.sha}` tags to GHCR.
4. Watchtower sees the new `latest` image.
5. Watchtower pulls it and restarts the Dockge-managed container.

The Dockge README should explain first setup, GHCR login if the package is private, the `18081:80` port mapping, the persistent `/data` volume, and how Watchtower picks up updates. Watchtower updates must preserve the `/data` volume.

**Soon**

- Enable SQLite WAL mode for hosted SQLite.
- Document backup and restore for the `/data` volume before relying on hosted persistent games.

**Later**

- Add a reverse proxy and TLS if exposing the app outside the LAN.
- Add deployment rollback notes using SHA-tagged GHCR images.

## Realtime Messages

Prefer small, versioned message shapes.

```ts
type ServerMessage =
  | { type: "view"; gameId: string; revision: number; view: PlayerGameView }
  | { type: "events"; gameId: string; fromRevision: number; toRevision: number; events: PlayerGameEvent[] }
  | { type: "commandRejected"; gameId: string; reason: string; latestRevision: number }
  | { type: "presence"; gameId: string; players: PresenceState[] };
```

The client can initially process only `view` and `commandRejected`. Add event-only rendering once the UI needs smoother animations or richer logs. Event bundles sent to clients must be projected per seat just like views; this is implemented — every client-bound event path (command responses, duplicate-command replays, `GET /events`) goes through the engine's fail-closed `playerEvents(events, viewer)` filter.

Client reconciliation rules:

- Ignore `view` messages with `revision <= currentRevision`.
- Apply `view` only if it advances or intentionally replaces local state.
- Ignore `events` messages with `toRevision <= currentRevision`.
- Apply `events` only when `fromRevision === currentRevision + 1`; otherwise fetch `GET /api/games/:gameId`.
- Use `commandRejected.latestRevision` only to decide whether to refetch.
- `presence` messages do not affect game revision.
- Clear or revalidate local drafts whenever the authoritative revision changes.
- Treat WebSocket as a delivery optimization; HTTP view fetch remains the recovery path.

WebSocket behavior:

- WebSocket connections authenticate with the same resume token as HTTP requests.
- The client provides its `lastSeenRevision` when connecting.
- The server sends events if it can fill the revision gap.
- The server sends a view if the client is too far behind or the gap is unavailable.
- Every event bundle includes ordered revisions and event sequence numbers.
- Use ping/pong or heartbeat messages for presence and stale connection cleanup.
- WebSocket is subscription-only initially; commands still go over HTTP unless there is a clear reason to change that.

## Sessions And Seats

Sessions are lightweight and anonymous:

- Creating a game returns the game id plus resume tokens for both seats.
- In private multiplayer, the second seat's token is shared as an invite link and the invited
  player claims the seat (names it) with `POST /claim` using that token.
- The browser stores its token locally; the invite token travels in the URL fragment.
- The server hashes tokens before storing them (`game_sessions.token_hash`).

This supports local hotseat and private-link multiplayer without requiring accounts. User accounts can be added later without changing the engine.

## Randomness

Randomness must be reproducible.

The engine state should contain enough RNG information to replay accepted commands and produce the same dice/card results. Do not call `Math.random()` inside rules code. Use a stable, seedable PRNG with explicit state, not platform-dependent randomness.

Possible approaches:

- Store a seed plus draw count.
- Store explicit RNG state.
- Store generated random outcomes as part of accepted command events.

The simplest robust approach is to keep RNG state in `GameState` and also record the generated outcomes in `GameEvent` for debugging.

Random draws should be labeled engine operations:

```ts
interface RandomEvent {
  type: "randomDraw";
  purpose: "combatDie" | "deckShuffle" | "cardDraw";
  beforeRngState: string;
  afterRngState: string;
  outcome: JsonValue;
}
```

## Test Strategy

Engine tests:

- Fast, deterministic, and comprehensive.
- Cover rules, state transitions, scoring, command validation, map validation, and RNG behavior.
- Should not require server or browser.
- Verify that initial seed plus ordered accepted command records, including actors, replay to the same final state.
- Verify that `serializeState(deserializeState(state))` round-trips exactly.
- Verify that random outcomes are stable across test runs.
- Verify that `legalCommandsForState` and `resolveCommand` agree: every legal command resolves and illegal commands reject.
- Verify map invariants: valid adjacency, valid setup, valid slots, and no dangling ids.
- Include golden tests for important rule examples once exact rules are encoded.

Server tests:

- Cover API contracts, revision conflicts, persistence, session ownership, and reconnect behavior.
- Use a temporary SQLite database.

Playwright tests:

- Cover browser-level smoke and user workflows.
- Verify the app loads, creates a game, renders the board, selects areas, submits a command, updates the log/state, and survives refresh/reconnect.
- Do not use Playwright for exhaustive rule edge cases.
- Use stable selectors such as roles, labels, and `data-testid` for board areas and controls.
- Use test-only deterministic game setup under `NODE_ENV=test` so tests can create known states without clicking through long setup flows.

Recommended first E2E flow:

1. Open the app.
2. Create a hotseat game.
3. Confirm the board is visible.
4. Select an area.
5. Confirm the action panel updates.
6. Submit a simple legal command.
7. Confirm the revision and event log update.
8. Refresh the page.
9. Confirm the same game state is restored.

## Development Milestones

1. Scaffold TypeScript monorepo and build/test scripts. — **done**
2. Add engine types, placeholder map, and fake command resolution. — **done**
3. Add SQLite-backed server game creation, command submission, migrations, and state snapshots. — **done**
4. Add React client that creates a game and renders a placeholder board from a player view. — **done**
5. Add Playwright smoke test for create/select/submit/refresh. — **done**
6. Replace fake command resolution with first real rules. — **done** (full Rivers rules incl. interactive combat)
7. Add WebSocket updates. — **open** (HTTP polling is the interim)
8. Add cards, pending decisions, and richer animations/logs. — **partial** (cards drawn/discard-to-reroll and pending decisions work; card abilities are the next rules task)

This order proved the application plumbing before committing to exact board geometry or complete rules modeling.
