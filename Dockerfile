FROM node:22-alpine AS build

WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY packages ./packages
# The web build inlines the canonical map (packages/web imports ../../../../../cloned_map.svg?raw).
COPY cloned_map.svg ./

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
RUN corepack enable
RUN corepack pnpm install --prod --frozen-lockfile

COPY --from=build /app/packages/server/dist ./packages/server/dist
COPY --from=build /app/packages/server/migrations ./packages/server/migrations
COPY --from=build /app/packages/engine/dist ./packages/engine/dist
COPY --from=build /app/packages/shared/dist ./packages/shared/dist
COPY --from=build /app/packages/web/dist ./packages/web/dist

EXPOSE 80

CMD ["node", "packages/server/dist/server.js"]
