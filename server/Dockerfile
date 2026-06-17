# syntax=docker/dockerfile:1
#
# MobFleet backend (Fastify + Prisma) container for Railway.
#
# IMPORTANT: the build CONTEXT must be the repository root, because the server
# imports shared TypeScript from ../../src (src/shared + src/lib/authorization).
# esbuild bundles those into a single self-contained dist/index.js, so the
# runtime image needs only node_modules + dist + the Prisma schema.
#
#   Local:    docker build -f server/Dockerfile -t mobfleet-server .   (run at repo root)
#   Railway:  service Root Directory = repo root; railway.toml points
#             dockerfilePath at server/Dockerfile.
#
# No secrets are baked in — every value (DATABASE_URL, SUPABASE_JWT_SECRET,
# AUTH_PROVIDER, PORT, PUBLIC_SERVER_URL, …) is read from the environment at
# runtime (see server/src/env.ts).

# ─── Build stage ──────────────────────────────────────────────────────────────
FROM node:22-slim AS build
# Prisma's query engine needs OpenSSL.
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /app

# Parent manifest first — the server's `phone-farm-app: file:..` dep links to it.
COPY package.json ./package.json
# Shared TypeScript the server bundles in (only src/shared + src/lib/authorization
# are imported; esbuild tree-shakes the rest).
COPY src ./src
# Server manifest + lockfile first for cached, reproducible installs.
COPY server/package.json server/package-lock.json ./server/
WORKDIR /app/server
RUN npm ci

# Server source + Prisma schema, then generate the Postgres client and bundle.
COPY server/ ./
RUN npm run build

# ─── Runtime stage ────────────────────────────────────────────────────────────
FROM node:22-slim AS runtime
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /app/server
ENV NODE_ENV=production

# node_modules carries the generated Prisma client + the prisma CLI. prisma/ holds the schema +
# the versioned migration chain. scripts/ holds the dedicated pre-deploy migration runner
# (migrate-deploy.mjs), used by Railway's PRE-DEPLOY step -- NOT by container startup.
COPY --from=build /app/server/node_modules ./node_modules
COPY --from=build /app/server/dist ./dist
COPY --from=build /app/server/prisma ./prisma
COPY --from=build /app/server/scripts ./scripts
COPY --from=build /app/server/package.json ./package.json

# PORT is injected by Railway at runtime; 8787 is the local fallback default.
EXPOSE 8787

# Startup is SERVER-ONLY: it never mutates the schema. Schema changes are applied once per release
# by the Railway pre-deploy command (`npm run migrate:deploy` -> `prisma migrate deploy`), which
# must succeed before this start command runs. (railway.toml sets startCommand + preDeployCommand.)
CMD ["node", "dist/index.js"]
