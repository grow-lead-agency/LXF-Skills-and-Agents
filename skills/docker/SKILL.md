---
name: docker
description: >-
  Production-grade Docker — Dockerfiles, BuildKit cache mounts, multi-platform
  builds (linux/amd64 + linux/arm64), Docker Compose v2, container security (Trivy,
  cosign, SBOM), networking, volume strategies, and troubleshooting. Triggers:
  dockerfile, docker compose, container, docker build, docker image,
  multi-stage build, buildx, distroless, docker networking, docker security,
  container security, trivy, image optimization, docker dev, dev container,
  docker troubleshoot, GHCR, container registry, docker volume, docker health check,
  graceful shutdown docker, BuildKit, docker multi-platform, docker ARM,
  registry management, ECR, ACR, image retention, docker daemon tuning,
  docker prune, disk full docker, docker swarm, docker on server, daemon.json,
  docker ci, build push github actions, when kubernetes, when ecs, orchestration handoff,
  docker bake, buildx bake, docker scout, docker debug, distroless debug, docker init,
  docker context, containerd image store, docker model runner, docker ai, gordon,
  mcp toolkit, mcp gateway, run llm docker, colima, docker desktop, rancher desktop,
  local docker mac, compose include, compose extends, gpu compose, loki logging driver,
  copy --link, named build context, build attestation, provenance, sbom build.
  Not for: Kubernetes cluster operations, ECS service mesh / EKS internals, or
  serverless container platforms.
---

# Docker

Production-grade Docker: Dockerfiles, BuildKit, multi-platform builds, Compose v2,
security scanning, networking, and troubleshooting. Audience: senior developer who
knows Docker basics and wants production patterns.

## Reference Files

| Topic | File |
|-------|------|
| Dockerfile best practices + language templates | `references/dockerfile-patterns.md` |
| BuildKit features + multi-platform builds | `references/buildkit-multiplatform.md` |
| Docker Compose v2 patterns | `references/compose-v2.md` |
| Container security, Trivy, cosign, SBOM | `references/security-scanning.md` |
| Networking modes + volume strategies | `references/networking-volumes.md` |
| Registry mgmt (GHCR/ECR/ACR/Harbor), retention, signing | `references/registry-management.md` |
| Daemon tuning, prune, logs, Swarm, reverse proxy, hardening | `references/daemon-server-ops.md` |
| CI/CD build-push on self-hosted runners | `references/cicd-git-bridge.md` |
| When to leave single-host Docker for K8s/ECS | `references/orchestration-handoff.md` |
| Docker AI: Model Runner, Gordon, MCP Toolkit/Gateway | `references/docker-ai.md` |
| Local dev on macOS: runtimes, contexts, file sharing | `references/local-dev-mac.md` |
| Common issues + debugging (incl. `docker debug`, events) | `references/troubleshooting.md` |

## Quick Routing

```
Writing a Dockerfile?          → references/dockerfile-patterns.md
BuildKit / faster builds?      → references/buildkit-multiplatform.md
Multi-platform (ARM + AMD64)?  → references/buildkit-multiplatform.md
Docker Compose setup?          → references/compose-v2.md
Security audit / CVE scanning? → references/security-scanning.md
Networking / DNS issues?       → references/networking-volumes.md
Push to registry / retention?  → references/registry-management.md
Docker on your own server?     → references/daemon-server-ops.md
Build & push in CI?            → references/cicd-git-bridge.md
Outgrowing single host?        → references/orchestration-handoff.md
Run LLMs / MCP via Docker?     → references/docker-ai.md
Local dev on macOS?            → references/local-dev-mac.md
Bake / multi-target build?     → references/buildkit-multiplatform.md
Debug a distroless container?  → references/troubleshooting.md (docker debug)
Container not starting?        → references/troubleshooting.md
```

## The image is the contract (platform-agnostic principle)

A correctly built image — multi-stage, non-root, healthcheck, env-configured, stateless,
SIGTERM-handling, scanned, signed, git-SHA tagged — runs **identically** on bare
Docker, Swarm, Kubernetes, ECS, Azure Container Apps, or Cloud Run. Build it right **once**.
The platform difference is only at the *ship* boundary:

| Target | Registry | Deploy mechanism |
|--------|----------|------------------|
| Bare VM / VPS | GHCR / self-hosted | `docker compose up -d` / Swarm |
| Self-hosted PaaS | GHCR / any | platform pulls + runs |
| AWS ECS/Fargate | ECR | task def + service update |
| Azure Container Apps | ACR | `az containerapp update` |
| Kubernetes | any | manifest / Helm |

→ Registry auth per platform: `references/registry-management.md`
→ When to leave single-host Docker: `references/orchestration-handoff.md`

## Core Principles

**Layer order matters.** Put frequently-changing instructions (COPY app code) AFTER
infrequently-changing ones (package installs). Every cache miss invalidates all
subsequent layers — a wrong order can make 200ms builds into 3-minute builds.

**BuildKit is the default** since Docker 23.0. Use `--mount=type=cache` for package
manager caches, `--mount=type=secret` for build-time credentials. Never put secrets
in ENV or ARG — they leak into image history.

**Multi-stage is not optional for production.** Builder stage = all tools + dev deps.
Runner stage = runtime only. Typical Node.js: 800MB → 80MB.

**Non-root by default.** Run as UID 1001, not root. Read-only filesystem where possible.
Drop all capabilities (`cap_drop: [ALL]`), add back only what's needed.

**Scan before deploy.** `trivy image myapp:latest` catches CVEs before your servers
see the image. Add to CI pipeline — don't scan manually in prod.

## Node.js Stack Quick Start

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
RUN npm run build && npm prune --omit=dev

FROM node:22-alpine AS runner
WORKDIR /app
RUN addgroup -g 1001 -S appuser && adduser -S appuser -u 1001 -G appuser
COPY --from=builder --chown=appuser:appuser /app/dist ./dist
COPY --from=builder --chown=appuser:appuser /app/node_modules ./node_modules
USER appuser
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD wget -qO- http://localhost:3000/health || exit 1
CMD ["node", "dist/main.js"]
```

Full language templates: `references/dockerfile-patterns.md`

## .dockerignore (always create this)

```
node_modules
.git
.gitignore
*.md
.env
.env.*
dist
coverage
.nyc_output
.next
*.log
Dockerfile*
docker-compose*.yml
.dockerignore
```

## Image Base Selection

| Base | Size | Use when |
|------|------|---------|
| `node:22-alpine` | ~60MB | Node.js production |
| `node:22-slim` | ~90MB | Node.js + glibc deps needed |
| `php:8.3-fpm-alpine` | ~80MB | PHP-FPM production (Laravel) |
| `python:3.12-slim` | ~130MB | Python production |
| `golang:1.23-alpine AS builder` + `scratch` runner | ~0MB runner | Go static binaries |
| `gcr.io/distroless/nodejs22-debian12` | ~60MB | Node.js, no shell (max security) |
| `gcr.io/distroless/base-debian12` | ~20MB | Go/Rust/compiled binaries |
| `cgr.dev/chainguard/node` | ~50MB | Node.js, daily CVE patches (Chainguard) |

Distroless: no shell, no package manager — perfect for prod, painful to debug.
Chainguard images: updated daily, near-zero CVEs, SLA-backed. Free tier available.

## Production Checklist

- [ ] Multi-stage build — builder vs runner stage
- [ ] Non-root user created and applied (USER instruction)
- [ ] HEALTHCHECK defined with realistic timeouts
- [ ] `.dockerignore` present and comprehensive
- [ ] No secrets in ENV/ARG (use `--mount=type=secret`)
- [ ] BuildKit cache mounts for package manager
- [ ] `SIGTERM` handler in application code (graceful shutdown)
- [ ] Resource limits in docker-compose.yml (`mem_limit`, `cpus`)
- [ ] `trivy image` scan passes before deploy
- [ ] Image tagged with git SHA, not just `latest`

## Production Gotchas (hard-won)

### Healthcheck-missing = unhealthy (not neutral)

A Compose service **without** a `healthcheck:` block is **not** treated as "no opinion" by orchestrators. Both Docker `docker ps` and Coolify report it as `unhealthy` / `starting` indefinitely, which:

- Triggers Coolify's UI to show the service red
- Causes upstream Traefik/Caddy to refuse traffic on some setups
- Makes deploy CI workflows think the deploy failed (when it didn't)

**Always define an explicit healthcheck**, even a trivial one:

```yaml
services:
  worker:
    image: ghcr.io/me/worker:latest
    healthcheck:
      test: ["CMD-SHELL", "test -f /tmp/alive || exit 1"]
      interval: 30s
      timeout: 10s
      retries: 3
      start_period: 60s
```

For Bun workers, write a heartbeat file from your event loop:
```typescript
setInterval(() => Bun.write("/tmp/alive", String(Date.now())), 10_000);
```

(Seen in production: a 2-day debug session where a worker was restarted manually over and over because the Coolify UI lied. Compose without healthcheck = Docker didn't know state = UI showed red.)

### `docker compose restart` does NOT reload env vars

Common misconception. `docker compose restart <service>` restarts the **same container** with the **same config it was created with**. Changing `.env` or `environment:` in compose has zero effect until you recreate the container.

```bash
# ❌ env changes ignored
docker compose restart worker

# ✅ correct — recreate container with new env
docker compose up -d --force-recreate worker

# ✅ also works — full down/up cycle
docker compose down worker && docker compose up -d worker
```

Same applies to Coolify "Restart" button vs "Redeploy". For env changes use Redeploy.

### Coolify container naming gotcha

When you run `docker ps --filter name=<service>` on a Coolify host, you'll **miss** containers because Coolify uses `<service>-<resource-uuid>` naming (not the `container_name:` from your compose). Example:

```bash
# ❌ Returns nothing — Coolify ignored container_name
docker ps --filter name=myapp-worker

# ✅ Find Coolify containers by partial match
docker ps --format '{{.Names}}' | grep myapp

# ✅ Find by Coolify resource UUID (from URL)
docker ps --filter label=coolify.resourceUuid=<uuid>
```

For scripted lookups against Coolify hosts, always use `grep` or `--filter label=coolify.*`, never `--filter name=<exact>`.

## Disambiguation

- **Coolify deploy** — once image is built, Coolify runs it (its own docs cover the UI/API).
- **Cloudflare Containers** — Workers-managed containers, not covered here.
- **ECR / ECS** — AWS container registry and orchestration; this skill only touches the push boundary.
- **Railway** — Railway handles builds (Nixpacks or Docker).
- **Kubernetes** — not covered here. Docker skill covers image building only.

Sources: https://docs.docker.com/build/guide/, https://docs.docker.com/guides/bun/containerize/, https://docs.docker.com/build/cache/, https://northflank.com/blog/docker-build-and-buildx-best-practices-for-optimized-builds, https://aquasecurity.github.io/trivy/latest/, https://docs.sigstore.dev/cosign/, https://github.com/GoogleContainerTools/distroless, https://edu.chainguard.dev/chainguard/chainguard-images/reference/
