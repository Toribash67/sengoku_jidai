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
vectors. Its coastlines follow the map's hex land/sea data, because the image is
generated (via a hosted SDXL + ControlNet model) conditioned on a 2-tone **control
image** rendered straight from the board SVG. This is an **offline, dev-only** step:
the generated image is committed as a static asset, so the running app and CI never
call any image API. Until an asset is committed, the board renders with flat tile
fills as before.

The pipeline lives in [`packages/terrain`](packages/terrain) — see its
[README](packages/terrain/README.md) for full details and style tuning.

### Preview the control image (no API key, no cost)

The control image is the exact land/sea mask the terrain's coastline follows. Render
it on its own:

```bash
corepack pnpm build:libs
corepack pnpm --filter @sengoku-jidai/terrain gen:control rivers
```

This writes **`terrain/rivers/control.png`** (repo root). Open it to inspect the
coastline — land is white, sea (and everything outside the tiles) is black.

### Generate a terrain background (full pipeline)

This calls the hosted **fal.ai** API, so it needs an API key and a curated style
reference image (one-time setup):

1. Set `FAL_KEY` in your environment or the git-ignored `.env` (see `.env.example`).
2. Add a style reference image at `packages/terrain/profiles/antique-reference.png`
   (curated art fed to the model via IP-Adapter — see
   [`packages/terrain/profiles/README.md`](packages/terrain/profiles/README.md)).

Then:

```bash
corepack pnpm build:libs
corepack pnpm --filter @sengoku-jidai/terrain gen rivers
```

It writes `terrain/rivers/control.png` and `terrain/rivers/generated.png` (for
inspection) and the committed board asset
`packages/web/src/assets/terrain/rivers.webp`. Review the outputs, then **commit the
`.webp`** — the web board picks it up automatically (Vite bundles
`src/assets/terrain/*.webp`).

The art style is controlled by one shared profile
([`packages/terrain/profiles/antique.json`](packages/terrain/profiles/antique.json)),
so every map looks consistent; adding a future map only needs an `SVG_BY_MAP` entry
and a generation run.

## Deployment

Production deploys through **GHCR → Dockge → Watchtower**. The Docker image serves on
container port `80`, and the Dockge stack keeps `/data` mounted so SQLite state
survives image updates. See [`deploy/`](deploy) for the compose stacks and notes.

```bash
docker build -t sengoku-jidai-web:test .   # validate the image when Docker is available
```
