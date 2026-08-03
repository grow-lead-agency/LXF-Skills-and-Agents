# Dockerfile Best Practices + Language Templates

## Table of Contents
1. [Instruction Order (Cache Optimization)](#instruction-order)
2. [Multi-stage Build Anatomy](#multi-stage)
3. [Node.js Templates](#nodejs)
4. [Python Template](#python)
5. [Go Template](#go)
6. [Rust Template](#rust)
7. [ENTRYPOINT vs CMD](#entrypoint-cmd)
8. [ARG vs ENV](#arg-env)
9. [HEALTHCHECK](#healthcheck)
10. [COPY vs ADD](#copy-add)
11. [Shell vs Exec Form](#shell-exec)

---

## Instruction Order (Cache Optimization) {#instruction-order}

Docker rebuilds from the first changed layer downward. Wrong order = slow CI.

**Golden rule:** Dependencies before code.

```dockerfile
# WRONG — any code change reinstalls all deps
COPY . .
RUN npm install

# CORRECT — deps cached unless package.json changes
COPY package.json package-lock.json ./
RUN npm install
COPY . .
```

**Optimal layer order:**
1. FROM (base image)
2. System packages (apt-get, apk add) — change almost never
3. Package manager lockfile + install (package-lock.json, poetry.lock, go.sum)
4. Build configuration (tsconfig, vite.config, etc.) — change rarely
5. Source code — changes every commit

---

## Multi-stage Build Anatomy {#multi-stage}

```dockerfile
# syntax=docker/dockerfile:1
# ↑ enables BuildKit features (cache mounts, heredoc, etc.)

# Stage names must be lowercase
FROM node:22-alpine AS deps
# deps stage: install production deps only

FROM node:22-alpine AS builder
# builder stage: compile, transpile, build

FROM node:22-alpine AS runner
# runner stage: minimal runtime image

# Stages can be referenced by name:
COPY --from=deps /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist

# Build specific stage only:
# docker build --target deps .
```

**Naming convention:** deps → builder → runner (or test, lint as side stages)

---

## Node.js Templates {#nodejs}

### Node.js Production (recommended)

```dockerfile
# syntax=docker/dockerfile:1
FROM node:22-alpine AS deps
WORKDIR /app

# Only copy manifest files first — cache layer until lockfile changes
COPY package.json package-lock.json ./

# Cache mount: npm cache persists between builds
RUN --mount=type=cache,target=/root/.npm \
    npm ci --omit=dev

# ─────────────────────────────────────────────
FROM node:22-alpine AS builder
WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Build (if using a bundler like Vite)
RUN npm run build

# ─────────────────────────────────────────────
FROM node:22-alpine AS runner
WORKDIR /app

# Non-root user (UID 1001 is convention)
RUN addgroup -g 1001 -S appuser && \
    adduser -S appuser -u 1001 -G appuser

# Copy only what runtime needs
COPY --from=builder --chown=appuser:appuser /app/dist ./dist
COPY --from=deps --chown=appuser:appuser /app/node_modules ./node_modules
# If you have static assets:
# COPY --from=builder --chown=appuser:appuser /app/public ./public

USER appuser
EXPOSE 3000

# Health check — adjust endpoint and timing
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD wget -qO- http://localhost:3000/health || exit 1

# Use exec form (no shell wrapper = direct SIGTERM handling)
CMD ["node", "dist/index.js"]
```


### Next.js (with standalone output)

```dockerfile
# syntax=docker/dockerfile:1
FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN --mount=type=cache,target=/root/.npm \
    npm ci

FROM node:22-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# Required for standalone build
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
RUN addgroup -g 1001 -S nodejs && adduser -S nextjs -u 1001 -G nodejs
# Standalone build includes only necessary files
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=builder --chown=nextjs:nodejs /app/public ./public
USER nextjs
EXPOSE 3000
ENV PORT=3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -qO- http://localhost:3000/api/health || exit 1
CMD ["node", "server.js"]
```

Add to `next.config.js`:
```js
output: 'standalone'
```

---

## Python Template {#python}

```dockerfile
# syntax=docker/dockerfile:1
FROM python:3.12-slim AS deps
WORKDIR /app

# Install build tools only in builder stage
RUN pip install --no-cache-dir poetry==1.8.2

COPY pyproject.toml poetry.lock ./
# Export requirements (no dev deps)
RUN poetry export -f requirements.txt --output requirements.txt --without-hashes

# Build wheels for faster runtime install
RUN --mount=type=cache,target=/root/.cache/pip \
    pip wheel --no-cache-dir --wheel-dir /wheels -r requirements.txt

# ─────────────────────────────────────────────
FROM python:3.12-slim AS runner
WORKDIR /app

RUN useradd -m -u 1001 -s /bin/bash appuser

# Install wheels (no network needed)
COPY --from=deps /wheels /wheels
RUN pip install --no-cache-dir --no-index --find-links=/wheels /wheels/* && \
    rm -rf /wheels

COPY --chown=appuser:appuser . .
USER appuser
EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD python -c "import urllib.request; urllib.request.urlopen('http://localhost:8000/health')" || exit 1

CMD ["python", "-m", "uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
```

---

## Go Template {#go}

Go produces a single static binary — perfect for minimal images.

```dockerfile
# syntax=docker/dockerfile:1
FROM golang:1.23-alpine AS builder
WORKDIR /build

# Download deps first (cached until go.sum changes)
COPY go.mod go.sum ./
RUN --mount=type=cache,target=/go/pkg/mod \
    --mount=type=cache,target=/root/.cache/go-build \
    go mod download

COPY . .

# CGO_ENABLED=0: static binary (no glibc deps)
# -ldflags="-s -w": strip debug info (smaller binary)
RUN --mount=type=cache,target=/go/pkg/mod \
    --mount=type=cache,target=/root/.cache/go-build \
    CGO_ENABLED=0 GOOS=linux go build -ldflags="-s -w" -o /app/server ./cmd/server

# ─────────────────────────────────────────────
FROM scratch AS runner
# scratch = empty image, only your binary
COPY --from=builder /etc/ssl/certs/ca-certificates.crt /etc/ssl/certs/
COPY --from=builder /app/server /server
# scratch has no users — run as nobody (UID 65534)
USER 65534:65534
EXPOSE 8080
CMD ["/server"]
```

If you need a shell for debugging, use `gcr.io/distroless/static-debian12` instead of `scratch`.

---

## Rust Template {#rust}

```dockerfile
# syntax=docker/dockerfile:1
FROM rust:1.82-alpine AS builder
WORKDIR /build

# Install musl tools for static linking
RUN apk add --no-cache musl-dev

# Cache dependencies separately
COPY Cargo.toml Cargo.lock ./
# Create dummy main to cache deps
RUN mkdir src && echo "fn main() {}" > src/main.rs
RUN --mount=type=cache,target=/usr/local/cargo/registry \
    --mount=type=cache,target=/build/target \
    cargo build --release
# Remove dummy binary
RUN rm src/main.rs

# Build actual binary
COPY src ./src
RUN --mount=type=cache,target=/usr/local/cargo/registry \
    --mount=type=cache,target=/build/target \
    cargo build --release && \
    cp target/release/myapp /app

# ─────────────────────────────────────────────
FROM scratch AS runner
COPY --from=builder /etc/ssl/certs/ca-certificates.crt /etc/ssl/certs/
COPY --from=builder /app /app
USER 65534:65534
EXPOSE 8080
CMD ["/app"]
```

---

## ENTRYPOINT vs CMD {#entrypoint-cmd}

| | ENTRYPOINT | CMD |
|-|-----------|-----|
| **Purpose** | The executable (rarely overridden) | Default args (easily overridden) |
| **Override** | `docker run --entrypoint` | `docker run image <new-args>` |
| **Together** | ENTRYPOINT = binary, CMD = default flags | |

```dockerfile
# Pattern 1: CMD only (simple)
CMD ["node", "dist/index.js"]

# Pattern 2: ENTRYPOINT + CMD (executable + overridable args)
ENTRYPOINT ["node"]
CMD ["dist/index.js"]
# → docker run myapp dist/other.js  (overrides CMD, keeps ENTRYPOINT)

# Pattern 3: ENTRYPOINT with shell wrapper (for init logic)
COPY docker-entrypoint.sh /usr/local/bin/
ENTRYPOINT ["docker-entrypoint.sh"]
CMD ["node", "dist/index.js"]
```

Shell wrapper pattern for init logic:
```bash
#!/bin/sh
set -e

# Run migrations on startup
if [ "$RUN_MIGRATIONS" = "true" ]; then
  npm run db:migrate
fi

# Replace shell with CMD (exec = SIGTERM propagation)
exec "$@"
```

Always use exec form `["executable", "arg1"]`, not shell form `executable arg1`.
Shell form wraps in `/bin/sh -c` which doesn't receive SIGTERM.

---

## ARG vs ENV {#arg-env}

```dockerfile
# ARG: build-time only, not in final image
ARG NODE_ENV=production
ARG BUILD_DATE

# ENV: runtime environment variable (persists in image)
ENV NODE_ENV=production
ENV PORT=3000

# Common pattern: ARG sets value, ENV makes it available at runtime
ARG APP_VERSION=unknown
ENV APP_VERSION=$APP_VERSION

# Build with: docker build --build-arg APP_VERSION=$(git rev-parse --short HEAD) .
```

**NEVER put secrets in ARG or ENV** — they're visible in `docker history` and
image metadata. Use `--mount=type=secret` instead (see buildkit-multiplatform.md).

---

## HEALTHCHECK {#healthcheck}

```dockerfile
# Syntax
HEALTHCHECK [OPTIONS] CMD <command>
# Options:
#   --interval=DURATION   (default: 30s) — how often to run
#   --timeout=DURATION    (default: 30s) — max time for check
#   --start-period=DURATION (default: 0s) — grace period after container starts
#   --retries=N           (default: 3) — failures before marking unhealthy

# Lightweight HTTP check (wget, no curl needed)
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD wget -qO- http://localhost:3000/health || exit 1

# Node.js native check (no external tools)
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3000/health', r => process.exit(r.statusCode === 200 ? 0 : 1)).on('error', () => process.exit(1))"

# Postgres check (for db containers in compose)
HEALTHCHECK --interval=10s --timeout=5s --start-period=10s --retries=5 \
  CMD pg_isready -U ${POSTGRES_USER:-postgres} -d ${POSTGRES_DB:-postgres} || exit 1

# Redis check
HEALTHCHECK --interval=10s --timeout=5s --retries=3 \
  CMD redis-cli ping | grep -q PONG || exit 1
```

**start-period** is critical: app startup can take 5-20s. Without it, the container
gets marked unhealthy before it's done starting. Set to 2x your average startup time.

---

## COPY vs ADD {#copy-add}

Use COPY always. ADD only for:
- Auto-extracting tar archives: `ADD app.tar.gz /app/`
- Remote URLs (but prefer `RUN curl` for better caching)

```dockerfile
# CORRECT: explicit COPY
COPY src/ ./src/
COPY public/ ./public/
COPY package.json package-lock.json ./

# WRONG: ADD for local files (surprising behavior)
ADD src/ ./src/

# WRONG: ADD for remote URL (cache unpredictable)
ADD https://example.com/config.json ./config.json
# CORRECT: use RUN with explicit checksum
RUN curl -fsSL https://example.com/config.json -o config.json
```

---

## Shell vs Exec Form {#shell-exec}

```dockerfile
# Shell form (BAD for CMD/ENTRYPOINT) — runs as /bin/sh -c "..."
CMD node dist/index.js
# Problem: /bin/sh receives SIGTERM, not your app → graceful shutdown broken

# Exec form (GOOD) — runs executable directly
CMD ["node", "dist/index.js"]
# SIGTERM goes directly to your app → graceful shutdown works

# Exception: RUN can use shell form (no SIGTERM issue at build time)
RUN apt-get update && apt-get install -y curl && rm -rf /var/lib/apt/lists/*
```
