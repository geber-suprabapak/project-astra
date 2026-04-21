# syntax=docker/dockerfile:1

# ---- Build stage ----
FROM node:22-alpine AS builder

WORKDIR /app

# Enable corepack for pnpm (used in build stage only)
RUN corepack enable && corepack prepare pnpm@latest --activate

COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile --ignore-scripts

COPY tsconfig.json ./
COPY src/ ./src/

RUN pnpm run build

# ---- Production stage ----
# Use npm ci with only production deps for a smaller final image.
# We regenerate node_modules from npm to avoid shipping pnpm tooling.
FROM node:22-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production

# Copy built output and package manifests
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/package.json ./

# Install production deps via npm (no dev deps, no scripts)
# Using --legacy-peer-deps because some packages have strict peer declarations
RUN npm install --omit=dev --ignore-scripts --legacy-peer-deps

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://localhost:3000/live || exit 1

CMD ["node", "dist/index.js"]
