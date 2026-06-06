# syntax=docker/dockerfile:1
# Multi-stage build for the Remix + Prisma (PostgreSQL) app.
#
# Why multi-stage: the production bundle is built by `remix vite:build`, and
# vite + typescript live in devDependencies. A single-stage `npm ci --omit=dev`
# (the old Dockerfile) would skip them and the build would fail. So the builder
# stage installs ALL deps and builds; the runner stage gets only the pruned
# production module tree + the build output, for a lean final image.
#
# Node 20 (LTS) matches package.json `engines: ">=20.19"` — the old node:18 base
# was two majors behind what the app declares.

# ---------- builder: full deps + production build ----------
FROM node:20-alpine AS builder
RUN apk add --no-cache openssl
WORKDIR /app

# NODE_ENV is intentionally NOT "production" here, so the install keeps the
# devDependencies (vite/typescript) that the build needs.
COPY package.json package-lock.json* ./
# `npm install` (not `npm ci`): the lockfile was resolved on macOS arm64 and
# omits some Linux-only optional transitive deps (@emnapi/core, @emnapi/runtime
# — a known npm optional-deps lockfile bug), so strict `npm ci` fails in this
# Linux image. `npm install` re-resolves the correct per-platform deps from
# package.json; the overrides/resolutions still pin the versions that matter.
RUN npm install --no-audit --no-fund

COPY . .
# Generate the Prisma client, then build the Remix app.
RUN npx prisma generate
RUN npm run build

# Strip dev deps so the runner copies a lean node_modules.
RUN npm prune --omit=dev

# ---------- runner: lean runtime ----------
FROM node:20-alpine AS runner
RUN apk add --no-cache openssl
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000
EXPOSE 3000

# Pruned prod modules + build output + Prisma schema/migrations + manifest.
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/build ./build
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/package.json ./package.json

# docker-start = prisma generate && prisma migrate deploy && remix-serve.
# Running migrate deploy on boot keeps the DB schema in sync on every release;
# prisma generate re-resolves the query engine for the runtime platform.
CMD ["npm", "run", "docker-start"]
