# General Orders: Sengoku Jidai

A digital implementation of the board game **General Orders: Sengoku Jidai** — a
two-player game of armies, navies, and operation cards fought across a hex map of
land and sea. It runs as a web app with an authoritative server, supporting local
hotseat and online (named-seat / invite-link) play.

This is a TypeScript **pnpm monorepo**. The rules engine is pure and deterministic;
the server is authoritative; the client renders and submits player intent only.

## Repository layout

| Package                                | Responsibility                                                                                                              |
| -------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| [`packages/engine`](packages/engine)   | Pure, deterministic game rules. No HTTP, DB, DOM, React, filesystem, or wall-clock time. JSON-compatible state.             |
| [`packages/shared`](packages/shared)   | API schemas and client/server contracts.                                                                                    |
| [`packages/server`](packages/server)   | Authority, persistence (SQLite), sessions, REST API, realtime delivery.                                                     |
| [`packages/web`](packages/web)         | Rendering, interaction, local draft UI state, client API calls.                                                             |
| [`packages/terrain`](packages/terrain) | **Dev-only** offline pipeline that generates antique-style terrain background images for the board. Not shipped in the app. |

The server persists the complete authoritative game state and sends each client a
player-specific **view**, so hidden information (hands, deck order, pending decisions)
never reaches the wrong seat. See [`ARCHITECTURE.md`](ARCHITECTURE.md) for the full
design and [`AGENTS.md`](AGENTS.md) for contributor guidelines.

## Prerequisites

- **Node.js >= 22**
- **pnpm 9.15.2** via Corepack (run scripts as `corepack pnpm …`; `pnpm` may not be
  directly on your PATH)

```bash
corepack enable
corepack pnpm install
```

## Running locally

```bash
corepack pnpm dev
```

This builds the libraries and runs the **server** (API on port `3000`) and **web**
client (on port **`18081`**) together. Open <http://localhost:18081>.

To run them separately:

```bash
corepack pnpm dev:server   # API only
corepack pnpm dev:web       # web client only (proxies /api to the server)
```

## Common scripts

| Command                    | What it does                                   |
| -------------------------- | ---------------------------------------------- |
| `corepack pnpm dev`        | Build libs, then run server + web concurrently |
| `corepack pnpm build`      | Build all packages                             |
| `corepack pnpm build:libs` | Build just the engine + shared libraries       |
| `corepack pnpm test`       | Run all unit/integration tests (Vitest)        |
| `corepack pnpm test:e2e`   | Run Playwright end-to-end / browser tests      |
| `corepack pnpm typecheck`  | Type-check every package                       |
| `corepack pnpm lint`       | ESLint                                         |
| `corepack pnpm format`     | Prettier `--write`                             |
| `corepack pnpm db:reset`   | Reset the local development SQLite database    |
| `corepack pnpm db:seed`    | Seed the local development database            |

> Never reset or delete production/persistent SQLite data — only the development/test
> reset scripts are safe.

## Checks before committing

Run the narrowest useful checks; for broad changes:

```bash
corepack pnpm typecheck
corepack pnpm test
corepack pnpm lint
corepack pnpm exec prettier --check .
corepack pnpm build
```

CI (`.github/workflows/web-container.yml`) runs Format, Lint, Typecheck, Unit + API
tests, a Production Build, a Browser Smoke Test, and the container image build.

## Terrain backgrounds

The board can render a faded, antique-style **terrain background** behind the SVG
vectors. Its coastlines follow the map's hex land/sea data: a land/sea **control** image
is rendered from the board SVG, then a hosted multi-image **edit** model (control + style
reference → restyled map) redraws it in an antique hand-drawn style while preserving the
regions. This is an **offline, dev-only** step: the generated image is committed as a
static asset, so the running app and CI never call any image API. Until an asset is
committed, the board renders with flat tile fills as before.

The pipeline lives in [`packages/terrain`](packages/terrain) — see its
[README](packages/terrain/README.md) for full details and style tuning.

### Preview the land/sea control (no API key, no cost)

The control is the green-land / blue-sea image (with organic, domain-warped coastlines)
that conditions generation. Render it on its own to tune the coastline:

```bash
corepack pnpm build:libs
corepack pnpm --filter @sengoku-jidai/terrain gen:map-control rivers
# sweep the coastline distortion without editing the profile:
corepack pnpm --filter @sengoku-jidai/terrain gen:map-control rivers --amplitude 60
```

This writes `terrain/rivers/control.png` (git-ignored scratch) — handy to sanity-check a
map's land/sea layout before spending a generation.

### Generate a terrain background (full pipeline)

This calls the hosted **fal.ai** edit model, so it needs an API key:

```bash
export FAL_KEY=...   # or put it in the git-ignored .env (see .env.example)
corepack pnpm build:libs
corepack pnpm --filter @sengoku-jidai/terrain gen:map rivers
```

It builds the control from the board SVG, sends it with the shared style reference
(`packages/terrain/assets/style-ref.jpeg`) to the edit model, and writes intermediates plus
`background.webp` to the scratch dir. Promote the result by copying it to
`packages/web/src/assets/<mapId>/background.webp` and committing it — the web board picks it
up automatically (Vite globs `src/assets/*/background.webp`).

The art style is controlled by one shared profile
([`packages/terrain/profiles/map.json`](packages/terrain/profiles/map.json)), so every map
looks consistent; adding a future map needs an `SVG_BY_MAP` entry and a generation run.

## Deployment

Production deploys through **GHCR → Dockge → Watchtower**. The Docker image serves on
container port `80`, and the Dockge stack keeps `/data` mounted so SQLite state
survives image updates. See [`deploy/`](deploy) for the compose stacks and notes.

```bash
docker build -t sengoku-jidai-web:test .   # validate the image when Docker is available
```
