# syntax=docker/dockerfile:1

# ---------------------------------------------------------------------------
# Stage 1: Build the UI
# ---------------------------------------------------------------------------
FROM node:22-alpine AS ui-builder
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@9.12.0 --activate

# Supabase auth is baked into the UI bundle at build time (Vite inlines VITE_*).
# Pass these as build args on Railway (Variables are exposed to the build).
ARG VITE_SUPABASE_URL
ARG VITE_SUPABASE_ANON_KEY
ENV VITE_SUPABASE_URL=$VITE_SUPABASE_URL
ENV VITE_SUPABASE_ANON_KEY=$VITE_SUPABASE_ANON_KEY

COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY packages/ui/package.json ./packages/ui/
COPY packages/server/package.json ./packages/server/
RUN pnpm install --frozen-lockfile --filter @mailhook/ui...

COPY packages/ui ./packages/ui
RUN pnpm --filter @mailhook/ui build

# ---------------------------------------------------------------------------
# Stage 2: Build the server
# ---------------------------------------------------------------------------
FROM node:22-alpine AS server-builder
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@9.12.0 --activate

COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY packages/server/package.json ./packages/server/
COPY packages/ui/package.json ./packages/ui/
RUN pnpm install --frozen-lockfile --filter @mailhook/server...

COPY packages/server ./packages/server
RUN pnpm --filter @mailhook/server build

# ---------------------------------------------------------------------------
# Stage 3: Production image
# ---------------------------------------------------------------------------
FROM node:22-alpine AS production
WORKDIR /app
ENV NODE_ENV=production
RUN corepack enable && corepack prepare pnpm@9.12.0 --activate

COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY packages/server/package.json ./packages/server/
# Production deps only (all pure JS — no native build toolchain needed).
RUN pnpm install --frozen-lockfile --filter @mailhook/server --prod

# Built server + built UI (served statically by Fastify).
COPY --from=server-builder /app/packages/server/dist ./packages/server/dist
COPY --from=ui-builder /app/packages/ui/dist ./packages/ui/dist

EXPOSE 3000
CMD ["node", "packages/server/dist/index.js"]
