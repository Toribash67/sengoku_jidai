# Agent Guidelines

This project is a TypeScript monorepo for a digital implementation of **General Orders: Sengoku Jidai**. Keep changes small, verified, and aligned with `ARCHITECTURE.md`.

## Core Rules

- Read the relevant files before editing. Prefer existing patterns over new abstractions.
- Keep package boundaries intact:
  - `packages/engine`: pure deterministic rules, no HTTP, database, DOM, React, filesystem, or wall-clock time.
  - `packages/shared`: API schemas and client/server contracts only.
  - `packages/server`: authority, persistence, sessions, API, deployment-facing behavior.
  - `packages/web`: rendering, interaction, local UI state, and client API calls.
- The server is authoritative. Clients submit player intent, not `GameState`, `nextState`, actor identity, dice results, or hidden information.
- Engine state must stay JSON-compatible and deterministic.
- Do not reset or delete production/persistent SQLite data. Development/test reset scripts are fine.
- Do not revert unrelated user changes.

## Verification

Before finishing code changes, run the narrowest useful checks. For broad changes, prefer:

```bash
corepack pnpm typecheck
corepack pnpm test
corepack pnpm lint
corepack pnpm exec prettier --check .
corepack pnpm build
```

Run Playwright when browser behavior changes:

```bash
corepack pnpm test:e2e
```

If deployment files or dependencies change, validate the image when Docker is available:

```bash
docker build -t sengoku-jidai-web:test .
```

## Development Notes

- Use `corepack pnpm ...`; `pnpm` may not be directly on the PATH.
- The local web port is `18081`; API defaults to `3000`.
- Production deploys through GHCR, Dockge, and Watchtower. The Docker image must keep serving on container port `80`.
- The Dockge stack must keep `/data` mounted so SQLite state survives image updates.
- Add tests in proportion to risk. Engine rule changes should have fast deterministic unit tests.
