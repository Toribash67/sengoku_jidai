# Dockge Deployment

This stack mirrors the sibling Diplomacy deployment:

- Image: `ghcr.io/toribash67/sengoku-jidai-web:latest`
- Host port: `18081`
- Container port: `80`
- Persistent SQLite volume: `/data/sengoku.sqlite`
- Watchtower updates: enabled by label

## First Setup

1. Create a new Dockge stack.
2. Paste `deploy/dockge/compose.yml`.
3. If the GHCR package is private, log in to GHCR on the TrueNAS host.
4. Start the stack and open `http://<truenas-host>:18081`.

Watchtower will pull new `latest` images after pushes to `main`. The `/data` volume must be kept when replacing containers; it stores game state.

## CI/CD Flow

Pushes to `main` run the GitHub Actions CI/CD workflow. The workflow installs dependencies, runs typecheck, unit/API tests, lint, formatting checks, production build, and the Playwright smoke test. Only after those checks pass does it publish `ghcr.io/toribash67/sengoku-jidai-web:latest` and the commit SHA tag.

The TrueNAS host is not contacted directly by GitHub Actions. Deployment is handled the same way as the Diplomacy stack: Watchtower sees the new `latest` image in GHCR, pulls it, and restarts the Dockge-managed container while preserving the `sengoku-jidai-data` volume.
