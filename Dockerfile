FROM node:22-alpine AS build

WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY packages ./packages
# The web renders Rivers procedurally from riversSource (no board.svg?raw import), but the
# terrain package still uses assets/maps/rivers/board.svg as its land/sea mask source.
# Card art lives under packages/web/src/assets (web-sized webp), copied via `COPY packages`.
COPY assets ./assets

RUN corepack enable
RUN corepack pnpm install --frozen-lockfile
RUN corepack pnpm build

FROM node:22-alpine

WORKDIR /app

ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=80
ENV SQLITE_PATH=/data/sengoku.sqlite

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/server/package.json ./packages/server/package.json
COPY packages/engine/package.json ./packages/engine/package.json
COPY packages/shared/package.json ./packages/shared/package.json
COPY packages/web/package.json ./packages/web/package.json
# terrain + board-render now build to dist (like engine/shared); the server imports both at
# runtime for on-demand custom-map terrain generation, so their package.json must be present
# for the workspace install below to link them, and their dist/ (plus terrain's profiles/ +
# assets/, read via import.meta.url) must be copied into the runtime image.
COPY packages/terrain/package.json ./packages/terrain/package.json
COPY packages/board-render/package.json ./packages/board-render/package.json
COPY packages/ai/package.json ./packages/ai/package.json
RUN corepack enable
RUN corepack pnpm install --prod --frozen-lockfile

COPY --from=build /app/packages/server/dist ./packages/server/dist
COPY --from=build /app/packages/server/migrations ./packages/server/migrations
# Seed assets (the committed Rivers terrain art) read at boot via import.meta.url.
COPY --from=build /app/packages/server/seed ./packages/server/seed
COPY --from=build /app/packages/engine/dist ./packages/engine/dist
COPY --from=build /app/packages/shared/dist ./packages/shared/dist
COPY --from=build /app/packages/web/dist ./packages/web/dist
COPY --from=build /app/packages/terrain/dist ./packages/terrain/dist
COPY --from=build /app/packages/terrain/profiles ./packages/terrain/profiles
COPY --from=build /app/packages/terrain/assets ./packages/terrain/assets
COPY --from=build /app/packages/board-render/dist ./packages/board-render/dist
COPY --from=build /app/packages/ai/dist ./packages/ai/dist

EXPOSE 80

CMD ["node", "packages/server/dist/server.js"]
