# syntax=docker/dockerfile:1

FROM node:26-alpine AS deps
WORKDIR /app
RUN apk add --no-cache python3 make g++
COPY package.json package-lock.json .npmrc ./
RUN npm ci

FROM node:26-alpine AS builder
WORKDIR /app
ENV CI=true
ENV NODE_ENV=production
# Cap the V8 heap below total host RAM. Coolify builders often share a 2–4GB VPS with
# Docker/Coolify overhead; --max-old-space-size=4096 invites the OOM killer (exit 255,
# no Vite error in logs). Leave headroom for native allocs (esbuild, sqlite, alpine).
# Override at build time if the builder has more headroom:
#   docker build --build-arg NODE_MAX_OLD_SPACE_SIZE=3072 .
ARG NODE_MAX_OLD_SPACE_SIZE=1536
ENV NODE_OPTIONS=--max-old-space-size=${NODE_MAX_OLD_SPACE_SIZE}
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# Separate RUNs so Coolify logs show which step died (sync vs vite vs worker).
# Avoid `npm run build` — it re-runs prepare and spikes RAM before Vite starts.
RUN ./node_modules/.bin/svelte-kit sync
RUN ./node_modules/.bin/vite build
RUN node scripts/build-worker.mjs
RUN npm prune --omit=dev

FROM node:26-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
COPY package.json ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/build ./build
COPY --from=builder /app/drizzle ./drizzle
COPY --from=builder /app/scripts/supervisor.mjs ./scripts/supervisor.mjs
RUN mkdir -p /app/data
VOLUME ["/app/data"]
EXPOSE 3000
ENV PORT=3000
ENV HOST=0.0.0.0
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
	CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/health').then((r)=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
# Runs web + queue worker together; dashboard can pause/stop/restart the worker.
CMD ["node", "scripts/supervisor.mjs"]
