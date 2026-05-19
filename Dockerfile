# syntax=docker/dockerfile:1

# ---- Build stage ----
FROM oven/bun:1.3.13-alpine AS builder

WORKDIR /app

COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

COPY tsconfig.json ./
COPY src/ ./src/

RUN bun run build

# ---- Production stage ----
FROM oven/bun:1.3.13-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production

# Copy built output and package manifests
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/package.json ./
COPY --from=builder /app/bun.lock ./

RUN bun install --production --frozen-lockfile

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://localhost:3000/ready || exit 1

CMD ["bun", "dist/index.js"]
