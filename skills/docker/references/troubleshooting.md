# Docker Troubleshooting Guide

## Table of Contents
1. [Container Won't Start](#wont-start)
2. [Build Cache Issues](#build-cache)
3. [Layer Debugging](#layer-debug)
4. [Networking Problems](#networking)
5. [Permission Errors](#permissions)
6. [OOM Kills](#oom)
7. [Graceful Shutdown Issues](#shutdown)
8. [Dev Container Issues](#devcontainer)
9. [Registry / Pull Issues](#registry)
10. [Performance Diagnostics](#performance)
11. [Useful Debug Commands](#commands)
12. [docker debug — Slim & Distroless Containers](#docker-debug)
13. [docker events — Real-Time Daemon Stream](#events)
14. [docker inspect — Crash Forensics](#inspect-forensics)
15. [containerd Image Store --load Gotcha](#containerd-store)

---

## Container Won't Start {#wont-start}

### Check exit code

```bash
# See exit code
docker ps -a  # STATUS column shows "Exited (1)"

# Exit codes:
# 0 = successful exit (expected)
# 1 = application error
# 125 = Docker daemon error
# 126 = command not found in container
# 127 = command not executable (permission issue)
# 137 = SIGKILL (OOM or explicit kill)
# 143 = SIGTERM (graceful shutdown signal received)
```

### Read the logs

```bash
# All logs
docker logs mycontainer

# Last 100 lines
docker logs --tail 100 mycontainer

# Follow new logs
docker logs -f mycontainer

# With timestamps
docker logs -t mycontainer

# Compose
docker compose logs -f app
docker compose logs --tail=50 app
```

### Inspect the container

```bash
# Full container config + state
docker inspect mycontainer

# Specific fields
docker inspect --format='{{.State.Status}}' mycontainer
docker inspect --format='{{.State.ExitCode}}' mycontainer
docker inspect --format='{{.State.Error}}' mycontainer
docker inspect --format='{{json .HostConfig.PortBindings}}' mycontainer
```

### Run interactively to debug

```bash
# Run without CMD to debug image
docker run -it --rm --entrypoint /bin/sh myapp:latest

# For distroless (no shell) — use debug variant
docker run -it --rm --entrypoint /busybox/sh gcr.io/distroless/nodejs22-debian12:debug

# Override CMD
docker run -it --rm myapp:latest sh

# Run as root to check permissions
docker run -it --rm --user root myapp:latest sh
```

---

## Build Cache Issues {#build-cache}

### Cache is not being used

```bash
# Check BuildKit is enabled
docker info | grep "buildkit"

# Force fresh build
docker build --no-cache -t myapp:latest .

# Check which layers are cached
docker build --progress=plain -t myapp:latest . 2>&1 | grep -E "CACHED|RUN"
```

### Cache invalidates unexpectedly

Common causes:
1. `COPY . .` too early — any file change invalidates everything after it
2. Timestamp-sensitive operations (`date`, `git rev-parse`)
3. Random values in ARG without a default

```dockerfile
# WRONG: cache busts on any file change
COPY . .
RUN npm install

# CORRECT: deps cached separately
COPY package.json package-lock.json ./
RUN npm install
COPY . .
```

### Cache mounts not working

```bash
# Verify BuildKit syntax directive is present
head -1 Dockerfile  # should be: # syntax=docker/dockerfile:1

# Check builder
docker buildx inspect  # should show BuildKit version

# Debug cache mount
docker build --progress=plain -t myapp . 2>&1 | grep "CACHED\|RUN"
```

### Clear build cache

```bash
# Clear all build cache
docker builder prune

# Clear with filter
docker builder prune --filter type=exec.cachemount  # only cache mounts
docker builder prune --filter until=24h              # older than 24h

# Clear everything (images + build cache)
docker system prune -a --volumes
```

---

## Layer Debugging {#layer-debug}

### What's in each layer?

```bash
# Inspect image history (shows each layer's command + size)
docker history myapp:latest

# With full commands (not truncated)
docker history --no-trunc myapp:latest

# JSON format
docker inspect --format='{{json .RootFS.Layers}}' myapp:latest
```

### dive — Interactive Layer Explorer

```bash
# Install
brew install dive

# Analyze image
dive myapp:latest

# CI mode (fails if wasted space > threshold)
CI=true dive myapp:latest --ci-config .dive.yml
```

`.dive.yml`:
```yaml
rules:
  lowestEfficiency: 0.9    # fail if efficiency < 90%
  highestWastedBytes: 10MB # fail if wasted > 10MB
  highestUserWastedPercent: 0.1
```

### Find what's bloating the image

```bash
# Quick size check by layer
docker history myapp:latest | sort -k4 -h -r | head -20

# Get into image and explore
docker run -it --rm myapp:latest sh
du -sh /* 2>/dev/null | sort -h
# or in /app:
du -sh /app/* | sort -h
```

---

## Networking Problems {#networking}

### Container can't reach another container

```bash
# Check they're on the same network
docker inspect --format='{{json .NetworkSettings.Networks}}' container1
docker inspect --format='{{json .NetworkSettings.Networks}}' container2

# Test connectivity
docker exec container1 ping container2
docker exec container1 wget -qO- http://container2:3000/health

# DNS resolution
docker exec container1 nslookup container2

# List networks
docker network ls
docker network inspect myapp-network
```

### Container can't reach the internet

```bash
# Test DNS
docker exec mycontainer nslookup google.com

# Test connectivity
docker exec mycontainer wget -qO- https://example.com

# Check Docker daemon DNS config
cat /etc/docker/daemon.json

# Common fix: use 8.8.8.8
# /etc/docker/daemon.json:
# {"dns": ["8.8.8.8", "8.8.4.4"]}
```

### Port not accessible from host

```bash
# Check port binding
docker port mycontainer 3000
# Should show: 0.0.0.0:3000

# Check if process is actually listening
docker exec mycontainer ss -tlnp
# or
docker exec mycontainer netstat -tlnp

# Check firewall on host
sudo iptables -L -n | grep 3000  # Linux
```

### macOS-specific networking issues

```bash
# "host.docker.internal" doesn't resolve
# → Add to extra_hosts in compose:
extra_hosts:
  - "host.docker.internal:host-gateway"

# Can't reach container from host with custom bridge network
# → macOS Docker Desktop doesn't route bridge networks to host
# → Use port mapping (ports:) instead of direct container IP
```

---

## Permission Errors {#permissions}

### Can't write to mounted directory

```bash
# Check who owns the directory in container
docker exec mycontainer ls -la /app/data

# Check who the container runs as
docker exec mycontainer whoami
docker exec mycontainer id

# Common fix: create dir with correct ownership in Dockerfile
RUN mkdir -p /app/data && chown -R 1001:1001 /app/data

# Or fix on host
chown -R 1001:1001 ./data/
```

### File created by container is owned by root on host

This happens because container UID 1001 doesn't map to your host user.

```bash
# Solution 1: Run container as your host UID
docker run --user $(id -u):$(id -g) myapp:latest

# Solution 2: In compose
services:
  app:
    user: "${UID}:${GID}"
# export UID=$(id -u) GID=$(id -g) before docker compose up

# Solution 3: Use ACLs on host directory
setfacl -m u:1001:rwx ./data/  # Linux only
```

### Can't read secrets/config in container

```bash
# Check file permissions
docker exec mycontainer ls -la /run/secrets/
docker exec mycontainer cat /run/secrets/api_key  # should work

# Verify secret was passed to build
docker build --secret id=api_key,src=./api_key .

# For runtime secrets in compose:
# Secrets go to /run/secrets/{secret_name}
```

---

## OOM Kills {#oom}

Container killed unexpectedly = usually OOM (Out of Memory).

```bash
# Check if OOM killed
docker inspect mycontainer | grep -A5 '"OOMKilled"'
# or
docker inspect --format='{{.State.OOMKilled}}' mycontainer

# Check kernel logs
dmesg | grep -i "oom\|killed process"

# Monitor memory usage
docker stats mycontainer
docker stats --no-stream  # single snapshot
```

### Fix OOM issues

```bash
# Increase memory limit
docker run --memory="1g" --memory-swap="1g" myapp:latest
# memory-swap = memory + swap. Set equal to disable swap.

# In compose:
services:
  app:
    deploy:
      resources:
        limits:
          memory: 1g

# For Node.js: set --max-old-space-size to ~75% of the container memory limit
CMD ["node", "--max-old-space-size=768", "dist/index.js"]
```

---

## Graceful Shutdown Issues {#shutdown}

App takes 10+ seconds to stop = SIGTERM not being handled.

### Diagnose

```bash
# Check how app stops
docker stop --time 5 mycontainer  # sends SIGTERM, waits 5s, then SIGKILL

# If it always takes exactly 10s → SIGTERM not received (default timeout)
# If it stops immediately → SIGTERM was handled
```

### Common causes

1. **Shell form CMD**: `/bin/sh -c` receives SIGTERM, not your app

```dockerfile
# WRONG
CMD node dist/index.js
# /bin/sh receives SIGTERM, your app doesn't

# CORRECT
CMD ["node", "dist/index.js"]
# node receives SIGTERM directly
```

2. **No SIGTERM handler in app code**:

```typescript
// Node.js graceful shutdown (Express/http.Server pattern)
const server = app.listen(port);

process.on('SIGTERM', async () => {
  console.log('SIGTERM received, shutting down gracefully');
  server.close();        // stop accepting new connections
  await cleanup();       // close DB connections, flush queues
  process.exit(0);
});

process.on('SIGINT', async () => {
  // Handle Ctrl+C in dev
  server.close();
  await cleanup();
  process.exit(0);
});
```

3. **PID != 1** (init process issues):

```dockerfile
# Use tini as PID 1 for proper signal forwarding
FROM node:22-alpine
RUN apk add --no-cache tini
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "dist/index.js"]

# Or Docker's built-in init:
# docker run --init myapp:latest
```

---

## Dev Container Issues {#devcontainer}

### Hot reload not working with bind mounts

```bash
# Check file events are reaching container
docker exec myapp sh -c "inotifywait -m /app/src"
# (install inotify-tools: apk add inotify-tools)

# macOS: Docker uses inotify via gRPC FUSE — can be slow
# Solution: use 'docker compose watch' instead of bind mounts
```

### node_modules on macOS behaves weirdly

```yaml
# ALWAYS add anonymous volume for node_modules
services:
  app:
    volumes:
      - ./src:/app/src
      - /app/node_modules  # ← this prevents host node_modules from overriding
```

Without `/app/node_modules`, macOS node_modules (native binaries for darwin) would
shadow the Linux modules installed in the container → native addons crash.

### VS Code Dev Containers

```json
// .devcontainer/devcontainer.json
{
  "name": "MyApp Dev",
  "dockerComposeFile": "../compose.yml",
  "service": "app",
  "workspaceFolder": "/app",
  "remoteUser": "vscode",
  "customizations": {
    "vscode": {
      "extensions": ["ms-vscode.vscode-typescript-next", "dbaeumer.vscode-eslint"]
    }
  }
}
```

---

## Registry / Pull Issues {#registry}

### Can't push/pull from GHCR

```bash
# Login
echo $GITHUB_TOKEN | docker login ghcr.io -u USERNAME --password-stdin

# Check token has correct scopes:
# write:packages (for push)
# read:packages (for pull)
# delete:packages (for deletion)

# Pull from private GHCR
docker pull ghcr.io/myorg/myapp:latest

# If 403: check package visibility settings in GitHub
```

### Manifest list / platform mismatch

```bash
# Check what platforms an image supports
docker buildx imagetools inspect myapp:latest

# Pull for specific platform
docker pull --platform linux/amd64 myapp:latest
docker pull --platform linux/arm64 myapp:latest
```

### Rate limiting (Docker Hub)

```bash
# Check rate limit status
docker run --rm alpine wget -qO- \
  -S "https://auth.docker.io/token?service=registry.docker.io&scope=repository:ratelimitpreview/test:pull" \
  2>&1 | grep "X-RateLimit"

# Use Docker Hub login to increase limits
docker login

# Or mirror to GHCR to avoid rate limits entirely
```

---

## Performance Diagnostics {#performance}

### Slow builds

```bash
# Profile build time
time docker build -t myapp:latest . 2>&1 | tee build.log

# See which steps are slowest
docker build --progress=plain -t myapp . 2>&1 | grep -E "^\s*#[0-9]+\s"

# Is cache being used?
docker build -t myapp . 2>&1 | grep "CACHED"
# Many CACHED = good, many RUN = cache not working
```

### Slow container startup

```bash
# Check startup time
docker run --rm myapp:latest sh -c "echo started"

# Profile inside container
docker run -it --rm myapp:latest sh
time node -e "require('./dist/index')"

# Add startup timing to app
console.time('startup');
// ... app init ...
console.timeEnd('startup');
```

### Container using too much CPU

```bash
# Real-time stats
docker stats

# CPU throttling info
docker inspect --format='{{.HostConfig.CpuShares}}' mycontainer
docker inspect --format='{{.HostConfig.NanoCpus}}' mycontainer

# Profile inside container
docker exec mycontainer sh -c "top -b -n1 | head -20"
```

---

## Useful Debug Commands {#commands}

```bash
# System-wide info
docker system df          # disk usage
docker system events      # real-time events
docker system info        # Docker config

# Container details
docker inspect CONTAINER  # full config + state
docker stats CONTAINER    # real-time metrics
docker top CONTAINER      # processes

# Network debugging
docker exec CONTAINER nslookup hostname
docker exec CONTAINER wget -qO- http://target:port/health
docker exec CONTAINER ss -tlnp  # listening ports

# File system inside container
docker exec CONTAINER ls -la /app
docker exec CONTAINER find / -name "*.log" 2>/dev/null
docker exec CONTAINER df -h    # disk usage inside container

# Copy files from/to container
docker cp CONTAINER:/app/logs/error.log ./error.log
docker cp ./config.json CONTAINER:/app/config.json

# Image analysis
docker history myapp:latest
docker inspect myapp:latest
dive myapp:latest  # requires dive installed

# Cleanup
docker container prune    # remove stopped containers
docker image prune        # remove dangling images
docker image prune -a     # remove all unused images
docker volume prune       # remove unused volumes
docker network prune      # remove unused networks
docker system prune -a    # remove everything unused
docker builder prune      # clear build cache
```

---

## docker debug — Slim & Distroless Containers {#docker-debug}

**THE answer to "distroless / scratch / slim image has no shell, how do I debug it?"**

`docker debug` is Docker's Nix-based debug toolbox. It attaches a full interactive
shell **plus a whole toolbox of tools** (`curl`, `vim`, `nano`, `htop`, etc.) to **any**
container or image — even shell-less ones (distroless, `scratch`, hardened images) — **without
modifying the image**. Where `docker exec -it my-app bash` fails on a slim container ("no such
file or directory: bash"), `docker debug my-app` just works.

```bash
# Get a debug shell into a stopped/crashed container
docker debug my-app

# Debug an image directly (pulls automatically, like docker run)
docker debug gcr.io/distroless/nodejs22-debian12

# Run a one-off command without an interactive session (scripting)
docker debug --command "cat /app/config.json" my-app

# Pick a shell explicitly (default: auto-detect)
docker debug --shell zsh my-app

# Debug a container on a REMOTE daemon (e.g. a prod box) over SSH
docker debug --host ssh://root@prod.example.org my-app
```

### The ephemeral toolbox

The toolbox ships with standard Linux tools pre-installed and lives in `/nix` — which is
**never visible** to the real image or container. Add anything from
[search.nixos.org/packages](https://search.nixos.org/packages) on the fly:

```bash
docker debug my-app
docker > install nmap jq strace   # add Nix packages to YOUR toolbox
docker > uninstall nmap           # remove them again
docker > builtins                 # list custom builtin tools
```

Installed tools persist **across debug sessions** (they're part of your personal toolbox,
not the image), so `install jq` once and it's there next time you `docker debug` a different
image too.

### Inspecting the entrypoint of a shell-less image

The builtin `entrypoint` tool decodes the effective `ENTRYPOINT`/`CMD` and can lint or run it
— invaluable when a distroless container "exits immediately" and you can't tell what it ran:

```bash
docker debug my-app
docker > entrypoint --print   # show the resolved startup command
docker > entrypoint           # lint ENTRYPOINT/CMD (shell vs exec form, etc.)
docker > entrypoint --run     # actually run it inside the debug shell, watch it crash
```

### Concrete example: a crashing distroless Node container

```bash
# Container built FROM gcr.io/distroless/nodejs22-debian12
# crashes on boot. docker exec won't help — there's no shell.
docker run --name api myorg/api:distroless   # Exited (1)

docker debug api
docker > entrypoint --print
node /app/dist/index.js
docker > ls /app/dist                 # is the build output even there?
docker > cat /app/package.json | jq .  # jq from the toolbox, not the image
docker > install curl
docker > entrypoint --run             # reproduce the crash + read the real stack trace
# leave — the image is byte-for-byte unchanged
docker > exit
```

This closes the long-standing "distroless: painful to debug" caveat: you no longer need a
separate `:debug` image variant or a baked-in busybox just to investigate.

### Tier / availability

`docker debug` is a **Docker Desktop** feature and requires a paid subscription —
**Pro, Team, or Business** (it is not part of Docker Personal/free). It ships with the
Docker Desktop CLI; no separate install. On a license without it, fall back to the
distroless `:debug` image variants (see [Container Won't Start](#wont-start)).

> Note: changes made while debugging an **image or stopped container** are discarded on exit.
> When you debug a **running/paused** container, filesystem changes ARE visible to that
> container live (handy for hot-patching a config), but `/nix` never is.

---

## docker events — Real-Time Daemon Event Stream {#events}

When a container restarts or dies "mysteriously", `docker events` shows you exactly what the
**daemon** saw and when — the missing half of the picture that `docker logs` (app stdout)
can't give you. Essential for the DEBUG mission on restart loops and OOM kills.

```bash
# Stream ALL daemon events live
docker events

# Watch only a specific container's lifecycle
docker events --filter container=my-app

# Watch only "die" events (catch the exact moment + exit code)
docker events --filter container=my-app --filter event=die

# Multiple event types
docker events --filter container=my-app \
  --filter event=oom --filter event=die --filter event=restart
```

Sample output correlating an OOM kill with the restart that followed:

```text
2026-05-30T14:02:11+02:00 container oom  abc123 (image=myorg/api:latest, name=my-app)
2026-05-30T14:02:11+02:00 container die  abc123 (exitCode=137, image=..., name=my-app)
2026-05-30T14:02:12+02:00 container start abc123 (image=..., name=my-app)
```

`oom` immediately before `die` with `exitCode=137` = the kernel OOM-killed it, then the
restart policy bounced it. See [OOM Kills](#oom) for the fix.

### Post-mortem with --since / --until

`docker events` is normally live, but you can replay a past window — perfect when you find a
crash after the fact:

```bash
# Everything in a time window (RFC3339, Unix ts, or relative like "10m"/"1h")
docker events --since '2026-05-30T13:55:00' --until '2026-05-30T14:05:00'

# Last 30 minutes for one container, then exit
docker events --since 30m --until 0m --filter container=my-app

# Machine-readable for scripting / piping to jq
docker events --since 1h --format '{{json .}}' | jq 'select(.Action=="die")'
```

Useful event types to filter on: `die`, `oom`, `kill`, `restart`, `health_status`,
`start`, `stop`, `destroy`.

---

## docker inspect — Crash Forensics {#inspect-forensics}

`docker inspect` carries the full post-crash state. These are the **specific fields** that
answer the common "why did it die?" questions (basic `inspect` usage is in
[Container Won't Start](#wont-start); this is the crash-forensics cheat sheet).

### Exit code decoder

```bash
docker inspect --format='{{.State.ExitCode}}' my-app
```

| Exit code | Meaning |
|-----------|---------|
| `0` | Clean exit (expected) |
| `1` | Generic application error |
| `137` | `128 + 9` = **SIGKILL** — almost always **OOM** (cross-check `.State.OOMKilled`) or `docker kill` |
| `139` | `128 + 11` = **SIGSEGV** — segfault (native addon, corrupt binary, bad arch) |
| `143` | `128 + 15` = **SIGTERM** — graceful stop signal received (see [Graceful Shutdown](#shutdown)) |
| `125` | Docker daemon failed to run the container |
| `126` / `127` | Command not executable / not found |

### The forensic fields

```bash
# Was it the OOM killer? (137 alone isn't proof — this is)
docker inspect --format='{{.State.OOMKilled}}' my-app          # true / false

# Daemon-level error string (e.g. "exec: no such file or directory")
docker inspect --format='{{.State.Error}}' my-app

# How many times has the restart policy bounced it?
docker inspect --format='{{.RestartCount}}' my-app

# Full state at a glance: status, exit code, OOM flag, error, timestamps
docker inspect --format='{{json .State}}' my-app | jq

# Healthcheck failure history — last probe outputs (why "unhealthy")
docker inspect --format='{{json .State.Health}}' my-app | jq
docker inspect --format='{{range .State.Health.Log}}{{.ExitCode}} {{.Output}}{{end}}' my-app

# When it died vs started (spot fast crash-loops)
docker inspect --format='start={{.State.StartedAt}} died={{.State.FinishedAt}}' my-app
```

### One-shot triage block

Copy-paste to dump every forensic field for a dead container:

```bash
C=my-app
docker inspect --format='
ExitCode:    {{.State.ExitCode}}
OOMKilled:   {{.State.OOMKilled}}
Error:       {{.State.Error}}
RestartCount:{{.RestartCount}}
StartedAt:   {{.State.StartedAt}}
FinishedAt:  {{.State.FinishedAt}}' "$C"
docker inspect --format='{{json .State.Health}}' "$C" 2>/dev/null | jq '.Log[-1] // "no healthcheck"'
```

Reading the result:
- `OOMKilled: true` → memory limit too low → [OOM Kills](#oom).
- `ExitCode: 143` + low `RestartCount` → clean SIGTERM, not a bug.
- `ExitCode: 137` + `OOMKilled: false` → killed by `docker kill` / `docker stop` timeout, not memory.
- `ExitCode: 139` → segfault — usually a native module built for the wrong arch (cross-ref [containerd store](#containerd-store) / platform mismatch).
- High `RestartCount` climbing → crash loop; pair with `docker events` to time it.

---

## containerd Image Store --load Gotcha {#containerd-store}

**Symptom:** a multi-platform build that works with `--push` **fails** with `--load`:

```bash
docker buildx build --platform linux/amd64,linux/arm64 --push  -t myorg/app .   # ✅ works
docker buildx build --platform linux/amd64,linux/arm64 --load  -t myorg/app .   # ❌ fails
# ERROR: docker exporter does not currently support exporting manifest lists
```

Or, with the plain `docker` driver:

```text
ERROR: Multi-platform build is not supported for the docker driver.
Switch to a different driver, or turn on the containerd image store, and try again.
```

### Why

A multi-platform image is a **manifest list** (one index pointing at per-arch manifests).
The **classic Docker image store** (legacy backend) can't represent manifest lists locally —
so it can't `--load` them and can't store build attestations. `--push` works because the
**registry** stores the manifest list; the local store is never asked to. This is the single
most common "works on push, breaks on load" trap.

### The fix: enable the containerd image store

The containerd image store natively understands manifest lists, so it supports
multi-platform local `--load`, image attestations, and alternative snapshotters
(stargz lazy-pulling, nydus/dragonfly peer-to-peer).

**Docker Desktop** (default since 4.34, otherwise toggle):
Settings → General → **Use containerd for pulling and storing images** → Apply.

**Docker Engine standalone** — `/etc/docker/daemon.json`:

```json
{
  "features": {
    "containerd-snapshotter": true
  }
}
```

```bash
sudo systemctl restart docker
docker info | grep -i "Driver:" -A2   # confirm containerd
# Now this loads a multi-platform image into your LOCAL store:
docker buildx build --platform linux/amd64,linux/arm64 --load -t myorg/app .
```

> Docker Engine 29.0+ uses the containerd image store **by default** — this gotcha mainly
> bites older engines or daemons upgraded from a classic-store install.

### Alternative if you can't switch the store

Use a `docker-container` driver builder — it supports multi-platform builds but **cannot
`--load`** into the engine (push directly instead):

```bash
docker buildx create --name multi --driver docker-container --bootstrap --use
docker buildx build --platform linux/amd64,linux/arm64 --push -t myorg/app .
```

> Switching stores hides (does NOT delete) images from the inactive store — they reappear if
> you switch back.

See also: [buildkit-multiplatform.md](buildkit-multiplatform.md) for the full multi-platform
build workflow, and [daemon-server-ops.md](daemon-server-ops.md) for `daemon.json` tuning.

## Sources

- https://docs.docker.com/reference/cli/docker/debug/
- https://docs.docker.com/build/building/multi-platform/
- https://docs.docker.com/desktop/features/containerd/

