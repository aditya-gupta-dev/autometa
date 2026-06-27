# syntax=docker/dockerfile:1

# ---- Stable, pinned Bun base image -----------------------------------------
# Pinned to the exact Bun version used in development for reproducible builds.
# Alpine keeps the image small; bun:sqlite is built into Bun, so no extra libs.
FROM oven/bun:1.3.13-alpine AS base
WORKDIR /app

# ---- Dependencies ----------------------------------------------------------
# Install in a separate layer so deps are only re-fetched when the lockfile
# changes. --frozen-lockfile fails the build if bun.lock is out of date.
FROM base AS deps
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production

# ---- Runtime image ---------------------------------------------------------
FROM base AS runtime
ENV NODE_ENV=production \
    PORT=3000 \
    DATABASE_PATH=/data/autometa.db

# Bring in production node_modules and application source.
COPY --from=deps /app/node_modules ./node_modules
COPY package.json bun.lock tsconfig.json index.ts ./
COPY src ./src

# Persistent location for the SQLite token store. Mount a named volume or a
# host path here so connected accounts survive container restarts.
RUN mkdir -p /data && chown -R bun:bun /data /app
VOLUME ["/data"]

# Run as the non-root user shipped with the Bun image.
USER bun

EXPOSE 3000

# Container-level health check hitting the app's /health endpoint.
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- "http://127.0.0.1:${PORT}/health" || exit 1

CMD ["bun", "run", "index.ts"]
