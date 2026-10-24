# Build from the repo root: docker build -f apps/server/Dockerfile .
FROM node:24-alpine AS build
RUN corepack enable
WORKDIR /repo
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/server/package.json apps/server/
COPY packages/shared/package.json packages/shared/
RUN pnpm install --frozen-lockfile --filter @interprete/server...
COPY packages/shared packages/shared
COPY apps/server apps/server
RUN pnpm --filter @interprete/server build

# The esbuild bundle is self-contained: no node_modules in the runtime image.
FROM node:24-alpine
WORKDIR /app
ENV NODE_ENV=production PORT=3035
COPY --from=build /repo/apps/server/dist ./dist
COPY --from=build /repo/apps/server/drizzle ./drizzle
USER node
EXPOSE 3035
CMD ["node", "dist/server.mjs"]
