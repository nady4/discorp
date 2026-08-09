# syntax=docker/dockerfile:1

# ─── Dependencies ──────────────────────────────────────────────────────
FROM node:20-alpine AS deps
WORKDIR /app
ENV CHECKPOINT_DISABLE=1
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

# ─── Build ─────────────────────────────────────────────────────────────
FROM node:20-alpine AS build
WORKDIR /app
ENV CHECKPOINT_DISABLE=1
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN ./node_modules/.bin/prisma generate
RUN npm run build

# ─── Runtime ───────────────────────────────────────────────────────────
FROM node:20-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV AGENTS_DIR=/app/agents
ENV WORKSPACE_DIR=/app/data/workspace

COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/prisma ./prisma
COPY --from=build /app/agents ./agents
COPY --from=build /app/package.json ./package.json
RUN mkdir -p /app/data/workspace

EXPOSE 8080
CMD ["node", "dist/index.js"]
