# syntax=docker/dockerfile:1

FROM node:22-alpine AS deps
WORKDIR /app
RUN apk add --no-cache python3 make g++
RUN corepack enable pnpm
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
RUN pnpm install --frozen-lockfile

FROM node:22-alpine AS builder
WORKDIR /app
# pnpm 10+ aborts module purge/reinstall without a TTY unless CI or confirm-modules-purge is set.
ENV CI=true
RUN corepack enable pnpm
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN pnpm build && pnpm prune --prod --config.ignore-scripts=true

FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
COPY package.json ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/build ./build
RUN mkdir -p /app/data
VOLUME ["/app/data"]
EXPOSE 3000
ENV PORT=3000
ENV HOST=0.0.0.0
CMD ["node", "build"]
