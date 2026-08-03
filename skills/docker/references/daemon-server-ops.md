# Docker Daemon & Bare-Server Operations

Running and operating the Docker Engine daemon on **your own** bare server. Target
environment: self-managed VPS/cloud VMs (Ubuntu 22.04/24.04 LTS or Debian 12+),
running **Node.js + Postgres** (or similar) workloads, often with **Traefik or Caddy**
as the edge reverse proxy and optional private mesh VPN (WireGuard/private network-style).

This file is the server-operations reference. It assumes you have
SSH/root on the box and are responsible for the daemon, the disk, and the proxy.

## Table of Contents

1. [Installing Docker Engine on Ubuntu/Debian](#1-installing-docker-engine)
2. [daemon.json tuning](#2-daemonjson-tuning)
3. [Disk pressure management](#3-disk-pressure-management)
4. [Deploying on a bare server](#4-deploying-on-a-bare-server)
5. [Docker Swarm for multi-node](#5-docker-swarm-for-multi-node)
6. [Reverse proxy + TLS (Traefik / Caddy)](#6-reverse-proxy--tls)
7. [Security hardening of the daemon/host](#7-security-hardening)
8. [Monitoring handoff (cAdvisor + node-exporter)](#8-monitoring-handoff)
9. [`docker context` — multiple / remote daemons](#9-docker-context)
10. [containerd image store](#10-containerd-image-store)
11. [Logging drivers beyond json-file/local](#11-logging-drivers)
12. [Volume drivers / remote volumes (NFS/CIFS)](#12-volume-drivers)
13. [Gotchas](#13-gotchas)

Sibling references: `registry-management.md` (mirrors, pull-through cache, GHCR),
`orchestration-handoff.md` (when to leave Swarm for K8s), `troubleshooting.md`
(daemon won't start, corrupted overlay2, etc.), `networking-volumes.md` (bridge vs
overlay, volume drivers).

---

## 1. Installing Docker Engine

**Never** install the `docker.io` / `docker` package from the distro repo — it lags
versions and ships an old containerd. Use Docker's own apt repo. The convenience
script is fine for throwaway boxes; for anything you keep, use the apt repo so you
get unattended upgrades and pinning.

### Option A — convenience script (fast, dev/throwaway only)

```bash
curl -fsSL https://get.docker.com -o get-docker.sh
sh get-docker.sh
# pin the channel if you want: CHANNEL=stable sh get-docker.sh
```

### Option B — apt repo (production, recommended)

```bash
# 1. prerequisites + Docker GPG key
sudo apt-get update
sudo apt-get install -y ca-certificates curl
sudo install -m 0755 -d /etc/apt/keyrings
sudo curl -fsSL https://download.docker.com/linux/ubuntu/gpg \
  -o /etc/apt/keyrings/docker.asc
sudo chmod a+r /etc/apt/keyrings/docker.asc

# 2. add the repo (swap 'ubuntu' -> 'debian' on Debian boxes)
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] \
https://download.docker.com/linux/ubuntu \
$(. /etc/os-release && echo "${UBUNTU_CODENAME:-$VERSION_CODENAME}") stable" \
  | sudo tee /etc/apt/sources.list.d/docker.list > /dev/null

# 3. install engine + CLI + buildx + compose plugin
sudo apt-get update
sudo apt-get install -y docker-ce docker-ce-cli containerd.io \
  docker-buildx-plugin docker-compose-plugin
```

### Post-install — non-root group + boot enable

```bash
# run docker without sudo (security note: docker group == effective root, see §7)
sudo groupadd -f docker
sudo usermod -aG docker "$USER"
newgrp docker          # apply in current shell without logout

# enable on boot (apt install already enables; make it explicit)
sudo systemctl enable --now docker.service containerd.service

# verify
docker version
docker run --rm hello-world
```

---

## 2. daemon.json tuning

The single most important config file on a self-hosted Docker box. The default
config is **dangerous on a server**: the `json-file` log driver grows unbounded and
*will* fill `/var` and take the host down. Fix that before anything else.

Write `/etc/docker/daemon.json`:

```jsonc
{
  // --- LOGGING (CRITICAL) ---
  // Default json-file driver has NO size limit -> unbounded growth -> disk full.
  // Cap every container's logs. This is the #1 cause of "server died overnight".
  "log-driver": "json-file",
  "log-opts": {
    "max-size": "10m",     // rotate a container's log file at 10 MB
    "max-file": "3",       // keep 3 rotated files => 30 MB hard cap per container
    "compress": "true"     // gzip rotated files
  },
  // Alternative: "log-driver": "local" — binary, auto-rotating, lower overhead,
  // 100 MB default cap. Use it if you don't need `docker logs` JSON tooling. The
  // 'local' driver is the upstream recommendation for new hosts.

  // --- DAEMON RESILIENCE ---
  // Keep containers RUNNING across daemon restarts/upgrades (no traffic blip when
  // you `apt upgrade docker-ce`). NOTE: incompatible with Swarm mode (see §13).
  "live-restore": true,

  // --- STORAGE ---
  // overlay2 is the only sane choice on modern kernels. Explicit = no surprises.
  "storage-driver": "overlay2",

  // --- DEFAULT ULIMITS ---
  // Node + Postgres open lots of fds; the default 1024 soft limit bites under
  // load (EMFILE / "too many open files"). Raise the daemon-wide default.
  "default-ulimits": {
    "nofile": { "Name": "nofile", "Soft": 65536, "Hard": 65536 }
  },

  // --- REGISTRY MIRROR / PULL-THROUGH CACHE ---
  // Mitigate Docker Hub anonymous pull rate limits (100 pulls / 6h per IP).
  // Point at a local pull-through cache or a mirror. Full setup: registry-management.md
  "registry-mirrors": ["https://mirror.gcr.io"],

  // --- ADDRESS POOLS ---
  // Each compose stack / `docker network create` grabs a /16 (then /24) from the
  // default 172.17-172.31 space. With many stacks you EXHAUST it and `up` fails
  // with "could not find available network". Give a big pool carved into /24s.
  "default-address-pools": [
    { "base": "10.200.0.0/16", "size": 24 }
  ],

  // --- METRICS for Prometheus (see §8) ---
  // Exposes daemon metrics. Bind to localhost or a private VPN IP, NEVER 0.0.0.0.
  "metrics-addr": "127.0.0.1:9323",
  "experimental": false,   // metrics-addr no longer needs experimental on modern engines

  // --- HOUSEKEEPING ---
  "userland-proxy": false  // use iptables hairpin instead of docker-proxy procs
}
```

### Applying changes — reload vs restart

```bash
# Validate JSON first — a syntax error here means the daemon WON'T START.
sudo dockerd --validate --config-file /etc/docker/daemon.json

# Some keys are hot-reloadable (log-opts defaults for NEW containers, debug,
# registry-mirrors, max-concurrent-*). SIGHUP / reload picks them up:
sudo systemctl reload docker

# Structural keys (storage-driver, live-restore, default-address-pools,
# metrics-addr, default-ulimits, userland-proxy) require a FULL restart:
sudo systemctl restart docker
```

> Existing containers keep their old log-opts; new settings apply to containers
> created *after* the change. Recreate containers to pick up new log limits.

---

## 3. Disk pressure management

The #1 day-2 problem on self-host Docker. Images, build cache, dangling layers,
stopped containers, and unbounded logs silently eat `/var/lib/docker`.

### Diagnose

```bash
docker system df            # summary: Images / Containers / Volumes / Build Cache
docker system df -v         # per-object breakdown — find the fat layers & volumes
du -sh /var/lib/docker/*    # raw FS view (run as root)
df -h /var/lib/docker       # is the partition actually full?
```

### Reclaim — least to most aggressive

```bash
# Dangling images + stopped containers + unused networks + dangling build cache.
# Does NOT touch named volumes or tagged images in use. Safe on any host.
docker system prune

# Only old images not used by a running container, older than 30 days (720h):
docker image prune -a --filter "until=720h"

# Build cache only (frees a LOT on CI/build boxes, harmless to running apps):
docker builder prune --filter "until=168h"   # older than 7 days

# Stopped containers / unused networks individually:
docker container prune
docker network prune
```

### DANGER — shared / multi-app hosts

```bash
# ⚠️ DO NOT run this on a multi-tenant or PaaS-managed host without care:
docker system prune -a --volumes
```

`-a` removes **every** image not attached to a *running* container — including
images kept for stopped-but-deployed apps — and `--volumes` deletes
**named volumes not currently mounted**, i.e. your *databases*. On a shared box
this means data loss. Prefer filtered prunes (`image prune -a --filter until=...`)
or the platform's own cleanup tooling. Volume name suffixes like `_data` vs
`-data` are different volumes — never assume a name is unused.

### Log file bloat — find & truncate

Even with `daemon.json` caps, containers created *before* the change have no limit.
Hunt them:

```bash
# Find the biggest container json logs:
sudo find /var/lib/docker/containers/ -name '*-json.log' -printf '%s\t%p\n' \
  | sort -rn | head -20 | numfmt --field=1 --to=iec

# Truncate IN PLACE (keeps the file handle valid; container keeps logging):
sudo truncate -s 0 /var/lib/docker/containers/<id>/<id>-json.log
# NEVER `rm` a live json.log — the daemon holds the fd and disk won't free until
# the container restarts. truncate is the correct tool.
```

The real fix is recreating those containers so they inherit the `max-size`/`max-file`
opts from §2.

### Automated cron prune (safe, filtered)

`/etc/cron.d/docker-prune` — runs Sunday 04:17, **never** `-a --volumes`:

```cron
# m h dom mon dow user command
17 4 * * 0 root docker image prune -a --filter "until=720h" --force >> /var/log/docker-prune.log 2>&1
27 4 * * 0 root docker builder prune --filter "until=168h" --force >> /var/log/docker-prune.log 2>&1
37 4 * * 0 root docker container prune --filter "until=168h" --force >> /var/log/docker-prune.log 2>&1
```

> On PaaS-managed hosts, prefer the platform's scheduled Docker cleanup so it
> respects deployed-app images. Don't double up with this cron there.

---

## 4. Deploying on a bare server

SSH + Compose is the right level for a single app on a small VPS.

### Pull-and-up over SSH

```bash
# From your laptop, drive a remote host without copying compose around:
export DOCKER_HOST="ssh://deploy@app01.example.com"
docker compose -f deploy/compose.yml pull
docker compose -f deploy/compose.yml up -d --remove-orphans
```

Or run on the box (CI does this after `git pull`):

```bash
docker compose pull && docker compose up -d --remove-orphans
docker image prune -f   # drop the now-orphaned old image tags
```

`--remove-orphans` deletes containers for services you removed from the compose
file — without it you accumulate zombies.

### Zero-downtime-ish on a single host

You can't get *true* zero downtime on one host without an orchestrator, but you can
get close with healthchecks + ordered recreate, or use Swarm's rolling update (§5).

```yaml
# compose.yml — restart policy + healthcheck so the proxy only routes to healthy
services:
  api:
    image: ghcr.io/myorg/myapp:${TAG:-latest}
    restart: unless-stopped          # comes back on reboot & on crash
    healthcheck:
      test: ["CMD", "npm", "run", "healthcheck"]   # or: curl -f http://localhost:3000/health
      interval: 10s
      timeout: 3s
      retries: 3
      start_period: 20s
    stop_grace_period: 30s           # let Node drain in-flight requests on SIGTERM
```

Recreate with the proxy waiting for health (Traefik/Caddy poll the healthcheck):

```bash
docker compose up -d --no-deps --wait api   # --wait blocks until healthy/timeout
```

For genuine rolling updates of replicas on a single node, init a one-node Swarm and
use `update_config` (§5) — it's the lightest way to get start-first/stop-second.

### Boot persistence

Two independent layers:

1. **Restart policies** (`restart: unless-stopped` / `always`) — the daemon restarts
   containers after a reboot or crash. `unless-stopped` won't restart ones you
   manually stopped; `always` always does.
2. **`live-restore: true`** (§2) — containers keep *running* across a daemon
   restart/upgrade. Restart policy handles host *reboots*; live-restore handles
   daemon *restarts*. You want both (except on Swarm — see §13).

---

## 5. Docker Swarm for multi-node

When one VPS isn't enough but K8s is overkill: a couple of nodes, a handful
of services, rolling updates, secrets. Swarm is built into the engine — zero extra
install.

> For anything beyond ~5 nodes or needing autoscaling/operators, jump to K8s — see
> `orchestration-handoff.md`.

### Init + join

```bash
# On the manager (advertise a private/VPN IP so the control plane stays off the public net):
docker swarm init --advertise-addr 10.0.0.10

# Print join tokens:
docker swarm join-token worker      # -> docker swarm join --token SWMTKN-... 10.0.0.10:2377
docker swarm join-token manager

# On each worker, paste the printed join command. Verify on manager:
docker node ls
```

> Open **only** 2377/tcp (control), 7946/tcp+udp (gossip), 4789/udp (overlay VXLAN)
> — and only between nodes on a private network/VPN, never to the public internet (§7/§13).

### Stack deploy

```bash
docker stack deploy -c stack.yml myapp
docker stack services myapp
docker service logs -f myapp_api
```

`stack.yml` (compose v3 + `deploy:` keys):

```yaml
services:
  api:
    image: ghcr.io/myorg/myapp:${TAG}
    networks: [edge, backend]
    secrets: [pg_password]
    configs:
      - source: app_config
        target: /app/config.yml
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:3000/health"]
      interval: 10s
      retries: 3
    deploy:
      replicas: 3
      update_config:
        parallelism: 1          # one task at a time
        delay: 10s
        order: start-first      # start new before stopping old => no downtime
        failure_action: rollback
      rollback_config:
        parallelism: 1
        order: stop-first
      restart_policy:
        condition: on-failure
      placement:
        constraints:
          - node.role == worker
          - node.labels.tier == app

  db:
    image: postgres:17
    networks: [backend]
    secrets: [pg_password]
    environment:
      POSTGRES_PASSWORD_FILE: /run/secrets/pg_password
    volumes: [pgdata:/var/lib/postgresql/data]
    deploy:
      placement:
        constraints: [node.labels.tier == data]   # pin DB to one node w/ the volume

networks:
  edge:
    driver: overlay
  backend:
    driver: overlay
    internal: true              # backend net has no external routing

volumes:
  pgdata:

secrets:
  pg_password:
    external: true              # created out-of-band, see below

configs:
  app_config:
    file: ./config.yml
```

### Secrets & configs

```bash
# Secrets are encrypted at rest in the raft log and mounted as files in /run/secrets:
printf '%s' "$(openssl rand -base64 32)" | docker secret create pg_password -
docker secret ls

# Configs are non-secret files distributed to tasks:
docker config create app_config ./config.yml
```

Never bake DB passwords into env in `stack.yml` — use `*_FILE` env + a `docker secret`.

### Rolling updates & constraints

```bash
docker service update --image ghcr.io/myorg/myapp:v2 myapp_api  # honors update_config
docker service scale myapp_api=5
docker service update --rollback myapp_api
# placement: node labels target where tasks land
docker node update --label-add tier=data db-node-01
docker node update --label-add tier=app  app-node-01
```

### Swarm vs K8s — quick decision

Stay on **Swarm** for: ≤5 nodes, a few stacks, simple rolling updates, no
autoscaling, one small ops team. Move to **K8s** when you need HPA/autoscaling,
operators (DB/cert/ingress controllers), multi-tenant namespaces+RBAC, or a managed
control plane. Full criteria and migration notes: `orchestration-handoff.md`.

---

## 6. Reverse proxy + TLS

Edge proxy terminates TLS (Let's Encrypt) and routes by Host header to containers via
the Docker provider. Pick **Traefik** (label-driven, great with Swarm) or **Caddy**
(simplest automatic HTTPS). If a PaaS already runs Traefik/Caddy, don't run a second
edge proxy — configure labels/routing through the platform.

### Traefik (compose snippet, with ACME)

```yaml
services:
  traefik:
    image: traefik:v3.3
    restart: unless-stopped
    command:
      - --providers.docker=true
      - --providers.docker.exposedbydefault=false      # opt-in per service
      - --entrypoints.web.address=:80
      - --entrypoints.websecure.address=:443
      - --entrypoints.web.http.redirections.entrypoint.to=websecure
      - --entrypoints.web.http.redirections.entrypoint.scheme=https
      - --certificatesresolvers.le.acme.tlschallenge=true
      - --certificatesresolvers.le.acme.email=ops@example.com
      - --certificatesresolvers.le.acme.storage=/letsencrypt/acme.json
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock:ro    # read-only! (see §7)
      - letsencrypt:/letsencrypt
    networks: [edge]

  api:
    image: ghcr.io/myorg/myapp:latest
    restart: unless-stopped
    networks: [edge]
    labels:
      - traefik.enable=true
      - traefik.http.routers.api.rule=Host(`app.example.com`)
      - traefik.http.routers.api.entrypoints=websecure
      - traefik.http.routers.api.tls.certresolver=le
      - traefik.http.services.api.loadbalancer.server.port=3000

networks:
  edge:

volumes:
  letsencrypt:
```

> Swarm note: with Swarm use `--providers.swarm=true` and put the `labels:` block
> under `deploy:` (Swarm reads service-level deploy labels, not container labels).

### Caddy (Caddyfile, automatic HTTPS)

Caddy gets you HTTPS with one line — it provisions and renews certs automatically.

```caddyfile
# Caddyfile
app.example.com {
    reverse_proxy api:3000
}
api.example.com {
    reverse_proxy backend:8080
    encode zstd gzip
}
```

```yaml
services:
  caddy:
    image: caddy:2
    restart: unless-stopped
    ports: ["80:80", "443:443"]
    volumes:
      - ./Caddyfile:/etc/caddy/Caddyfile:ro
      - caddy_data:/data         # persists certs — back this up or you re-issue on every redeploy
      - caddy_config:/config
volumes:
  caddy_data:
  caddy_config:
```

---

## 7. Security hardening

### Socket protection — never expose the daemon

```bash
# NEVER do this (unauthenticated root-equivalent over the network):
#   dockerd -H tcp://0.0.0.0:2375     # 2375 = plaintext, full host takeover
```

`/var/run/docker.sock` is **root-equivalent**: anyone who can write it owns the host.
Consequences:

- Mount it `:ro` into proxies (Traefik), and only when needed.
- For remote management use `DOCKER_HOST=ssh://...` (§4) — SSH-tunneled, no open port.
- If you *must* have a TCP endpoint, only `2376` with TLS client-cert auth
  (`--tlsverify`), bound to a **private/VPN IP**, never a public one.
- Being in the `docker` group == effective root. Treat group membership as root
  grant; don't hand it out casually.

### Rootless mode (option)

Run the daemon as an unprivileged user so a container escape doesn't land as root:

```bash
sudo apt-get install -y uidmap docker-ce-rootless-extras
dockerd-rootless-setuptool.sh install      # as the target NON-root user
export DOCKER_HOST=unix:///run/user/$(id -u)/docker.sock
systemctl --user enable --now docker
loginctl enable-linger "$USER"             # keep it running after logout
```

Trade-offs: no host-port < 1024 without `setcap`, overlay networks need extra
config, slightly more setup. Good for single-tenant app boxes; managed PaaS
daemons usually stay rootful.

### User namespace remapping (rootful alternative)

Maps container root to an unprivileged host UID range. Add to `daemon.json`:

```jsonc
{ "userns-remap": "default" }
```

Then `systemctl restart docker`. Caveat: existing images/volumes get re-owned under
the remapped range — plan a migration, and some `--privileged` workloads break.

### Firewall — the ufw / Docker iptables trap

**Docker publishes ports by writing iptables `DOCKER` chain rules that bypass ufw.**
A `ports: ["5432:5432"]` is reachable from the internet even with
`ufw deny 5432` — because Docker's rules run *before* ufw's. This burns people
constantly.

Mitigations (in order of preference):

```yaml
# 1. BEST — don't publish to all interfaces. Bind to localhost or a private VPN IP only:
services:
  db:
    ports:
      - "127.0.0.1:5432:5432"      # only the host can reach Postgres
  api:
    ports:
      - "10.0.0.10:3000:3000"      # only the private network can reach it
```

```bash
# 2. Use ufw-docker to insert ufw-aware rules into Docker's chains:
#    https://github.com/chaifeng/ufw-docker
sudo ufw-docker install
sudo ufw-docker allow myapp 443/tcp
```

```jsonc
// 3. Disable Docker's iptables management entirely and own all rules yourself
//    (advanced — you must then write the NAT/forward rules). daemon.json:
{ "iptables": false }
```

Baseline ufw on a VPS (containers still need the §13 binding fix):

```bash
sudo ufw default deny incoming
sudo ufw default allow outgoing
sudo ufw allow in on wg0              # trust the private VPN interface if used
sudo ufw allow 22/tcp                 # or restrict SSH to the private network
sudo ufw allow 80,443/tcp             # only if this box is the public edge proxy
sudo ufw enable
```

---

## 8. Monitoring handoff

Expose container + host metrics to your observability stack (Prometheus, Grafana,
VictoriaMetrics, Alloy, etc.). Daemon-level metrics come from `metrics-addr` (§2);
container and host metrics come from **cAdvisor** + **node-exporter**.

```yaml
# monitoring.compose.yml
services:
  cadvisor:
    image: gcr.io/cadvisor/cadvisor:v0.49.1
    restart: unless-stopped
    command: ["-housekeeping_interval=15s", "-docker_only=true"]
    volumes:
      - /:/rootfs:ro
      - /var/run:/var/run:ro
      - /sys:/sys:ro
      - /var/lib/docker/:/var/lib/docker:ro
      - /dev/disk/:/dev/disk:ro
    devices: ["/dev/kmsg"]
    ports:
      - "127.0.0.1:8080:8080"        # private-only — never public

  node-exporter:
    image: prom/node-exporter:v1.8.2
    restart: unless-stopped
    command:
      - --path.rootfs=/host
      - --collector.systemd
    pid: host
    volumes: ["/:/host:ro,rslave"]
    ports:
      - "127.0.0.1:9100:9100"        # private-only
```

Scrape targets: `:9323` (daemon), `:8080/metrics` (cAdvisor), `:9100/metrics`
(node-exporter). Bind every metrics port to localhost or a private VPN IP — these
endpoints are unauthenticated.

---

## 9. `docker context`

A **context** bundles everything the CLI needs to talk to a daemon — endpoint,
TLS material, name. Switching context retargets every `docker` command at a
different daemon **without touching the remote box's network exposure**. This is
the right way to drive remote Docker hosts from your laptop: the connection
rides **SSH**, so you never open the TCP socket (`2375`/`2376`) that §7 warns
against.

```bash
# List contexts — the asterisk marks the active one
docker context ls
# NAME       DESCRIPTION   DOCKER ENDPOINT               ERROR
# default *                unix:///var/run/docker.sock

# Create a context pointing at a remote daemon over SSH (the SECURE way):
docker context create app01 \
  --docker "host=ssh://deploy@app01.example.com" \
  --description "App box over SSH"

# Switch the CLI to it — all subsequent docker commands hit the remote daemon
docker context use app01
docker ps                    # lists containers ON app01
docker compose up -d         # deploys to app01, no files copied around

# Back to local
docker context use default
```

This works because the SSH transport tunnels straight to the remote
`/var/run/docker.sock` — that socket is **root-equivalent** (§7), so SSH access
to a user in the remote `docker` group is exactly the trust boundary you're
relying on. Keep the box's `2375`/`2376` closed; the context needs nothing open
but `22/tcp` (and you can pin even that to a private network).

One-shot without switching contexts (handy in scripts / CI):

```bash
# Pick a context for a single command:
docker --context app01 ps
# Or via env — same SSH transport, no persisted context:
DOCKER_HOST="ssh://deploy@app01.example.com" docker compose pull
DOCKER_CONTEXT=app01 docker compose up -d   # env overrides `context use`
```

Inspect / move contexts between machines:

```bash
docker context inspect app01           # see endpoint + TLS material
docker context export  app01           # -> app01.dockercontext
docker context import  app01 app01.dockercontext   # on another host
docker context update  app01 --description "..."   # edit in place
```

Local Docker Desktop / OrbStack / Colima each register their own context the same
way. For a TCP endpoint you can't avoid, use `2376` + `--tlsverify` bound to a
private/VPN IP only — never `2375`, never `0.0.0.0` (§7, §13).

---

## 10. containerd image store

Docker can store images via the **containerd snapshotter** instead of the
classic `overlay2` graph driver. It's the default on **fresh** Engine 29.0+
installs; upgraded daemons keep `overlay2` until you opt in. Enable it in
`daemon.json`:

```jsonc
{ "features": { "containerd-snapshotter": true } }
```

```bash
sudo systemctl restart docker
# Verify you're on the containerd store:
docker info -f '{{ .DriverStatus }}'
# [[driver-type io.containerd.snapshotter.v1]]
```

What it unlocks:

- **Multi-platform images in one local store** — build/store ARM64 + AMD64 in a
  single tagged image locally without an external builder. (This is the fix for
  the `--load` multi-platform gotcha in `troubleshooting.md`: with the classic
  store, `buildx --platform linux/amd64,linux/arm64 --load` fails because
  overlay2 can't hold an image index; the containerd store can.)
- **Build attestations** — provenance + SBOM ride along as image indices the
  classic store doesn't understand.
- **Lazy-pulling snapshotters** — pluggable snapshotters like **stargz**,
  **nydus**, and **soci** start a container before the whole image is pulled,
  fetching layers on demand. **The practical server win:** much faster *cold*
  pulls of large images (big ML/Playwright/monolith images) — the container is
  up while bytes stream in, instead of blocking on a full download.
- **Wasm** — runs WebAssembly workloads via the containerd shim.

> ⚠️ Gotchas before flipping this on a live box:
> - **Incompatible with `userns-remap`** (§7) — the containerd store is disabled
>   when user-namespace remapping is on.
> - **Switching hides the other store's data.** Images/containers from `overlay2`
>   stay on disk but become invisible until you switch back. Migrate by pushing
>   to a registry (or `docker save`) first — don't expect them to carry over.
> - **More disk** — containerd keeps layers **both** compressed and extracted, so
>   the same images use more space than overlay2. Watch `docker system df` and
>   keep the §3 prune cron running.

---

## 11. Logging drivers

§2 covers `json-file` (capped) and `local`. The daemon also supports drivers that
ship logs straight off-box — set one globally in `daemon.json` (`log-driver` +
`log-opts`) or per-container (`--log-driver` / compose `logging:`). Built-ins
include **`fluentd`**, **`gelf`** (Graylog/Logstash), **`splunk`**, and
**`awslogs`** (CloudWatch).

A common production choice is the **Grafana Loki driver** — a
managed **plugin** (not a built-in), so it's installed per host:

```bash
# Install on each Docker host (match arch: amd64 / arm64):
docker plugin install grafana/loki-docker-driver:3.7.0-amd64 \
  --alias loki --grant-all-permissions
docker plugin ls          # ENABLED=true once it starts
```

Ship one container's logs to Loki (point at a private IP of your Loki host, never public):

```bash
docker run --log-driver=loki \
  --log-opt loki-url="http://10.0.0.20:3100/loki/api/v1/push" \
  --log-opt loki-retries=2 \
  --log-opt loki-batch-size=400 \
  --log-opt keep-file=true \
  ghcr.io/myorg/myapp:latest
```

Compose / Swarm form (stack + service names auto-become Loki labels):

```yaml
services:
  app:
    image: ghcr.io/myorg/myapp:latest
    logging:
      driver: loki
      options:
        loki-url: "http://10.0.0.20:3100/loki/api/v1/push"
        loki-batch-size: "400"
        mode: "non-blocking"      # don't stall the app if Loki is unreachable
        keep-file: "true"         # retain json log on disk -> `docker logs` still works
```

Make it the host default in `daemon.json` (all NEW containers ship to Loki):

```jsonc
{
  "log-driver": "loki",
  "log-opts": {
    "loki-url": "http://10.0.0.20:3100/loki/api/v1/push",
    "loki-batch-size": "400"
  }
}
```

> All `log-opts` values in `daemon.json` MUST be **strings** (quote numbers and
> booleans), or the daemon won't start.

> ⚠️ **Deadlock risk:** the Loki driver buffers in memory and, by default, retries
> 10×. With `loki-retries=0` it retries *forever* — and because the daemon waits
> for the driver to flush a container's logs before removing it, an unreachable
> Loki can hang `docker rm`/`down`. On a server prefer `mode: non-blocking` +
> short `loki-timeout`/`loki-max-backoff` + `keep-file=true` so logs fall back to
> the local JSON file instead of blocking the daemon. For pull-based collection
> with no daemon coupling at all, use Grafana Alloy's `loki.source.docker`
> component (or Promtail) instead of this push driver.

---

## 12. Volume drivers

The built-in **`local`** driver does more than `/var/lib/docker/volumes` — it
forwards mount options straight to the Linux `mount` syscall, so you can mount an
**NFS** export or a **CIFS/SMB** share (a NAS) as a named volume, no host fstab
entry needed.

NFS-backed named volume in Compose (`o:` carries the `mount -o` options):

```yaml
services:
  app:
    image: ghcr.io/myorg/myapp:latest
    volumes:
      - nas_uploads:/app/uploads

volumes:
  nas_uploads:
    driver: local
    driver_opts:
      type: nfs
      o: "addr=10.0.0.10,nfsvers=4,rw,soft,timeo=180"   # NFS server + mount opts
      device: ":/export/uploads"                        # exported path on the server
```

CIFS/Samba (e.g. a Synology/QNAP share) via the CLI:

```bash
docker volume create \
  --driver local \
  --opt type=cifs \
  --opt device=//nas.example.com/backup \
  --opt o=addr=nas.example.com,username=svc,password=***,file_mode=0777,dir_mode=0777 \
  cifs_backup
```

> The `local` driver creates the volume object eagerly but only mounts the remote
> share when a container actually uses it — a wrong `addr`/credential fails at
> container start, not at `volume create`. Prefer private DNS/VPN hostnames for NAS.

For **clustered / multi-node** storage (so a Swarm task can reschedule onto any
node and still see its data), the `local` NFS/CIFS trick is enough for a shared
NAS, but for real clustered block storage use an external/**CSI** volume plugin
(e.g. `rclone/docker-volume-rclone`, or a CSI driver for Ceph/Longhorn) installed
via `docker plugin install` and referenced with `driver:` + `driver_opts:`. See
`networking-volumes.md` for the volume-strategy decision matrix and
`orchestration-handoff.md` for when shared-storage needs push you toward K8s.

---

## 13. Gotchas

- **Docker bypasses ufw/iptables.** Published ports (`-p`) are reachable from the
  internet regardless of ufw `deny`. Fix: bind to `127.0.0.1:` or a private/VPN
  IP, or use `ufw-docker`. See §7. This is the most common self-host
  Docker security incident.

- **`live-restore: true` is INCOMPATIBLE with Swarm.** Swarm needs the daemon to
  manage task lifecycle; `live-restore` is silently ignored (or errors) on a Swarm
  node. Use it on standalone/compose hosts only; drop it before `swarm init`.

- **overlay2 inode exhaustion.** A box can show free *space* in `df -h` but fail to
  create containers because it's out of *inodes* (`df -i`). Many small layers/files
  burn inodes. Diagnose with `df -i /var/lib/docker`; remediate with image/builder
  prune (§3) or, if chronic, recreate the filesystem with more inodes.

- **`docker system prune -a --volumes` on a shared/multi-app host = data loss.** Kills
  other apps' images and named DB volumes. Use filtered prunes or the platform's cleanup.
  Watch volume name suffixes carefully (`_data` vs `-data` are different volumes).

- **Live `*-json.log` must be `truncate`d, not `rm`d.** The daemon holds the fd;
  deleting frees no disk until restart. See §3.

- **Time drift breaks TLS & registries.** A clock skewed by minutes causes
  Let's Encrypt/registry cert validation failures and confusing "x509" errors.
  Ensure `systemd-timesyncd`/chrony is active: `timedatectl status` → `synced: yes`.

- **Default-address-pool exhaustion.** Many compose stacks each grab a subnet from
  the 172.16-172.31 default; you run out and `up` fails with "could not find an
  available, non-overlapping IPv4 address pool". Fix with `default-address-pools`
  in §2. Details in `networking-volumes.md`.

- **Distro `docker.io` package.** Old engine + old containerd + different socket
  paths. Always use the Docker apt repo (§1).

- **`docker` group = root.** Adding a user to `docker` grants effective root via the
  socket. Audit membership like you audit sudoers.

- **Swarm ports public.** Never expose 2377/7946/4789 to the internet — gossip and
  raft are not meant for hostile networks. Keep them on a private network/VPN (§5).

When the daemon won't start after editing `daemon.json`, run
`dockerd --validate --config-file /etc/docker/daemon.json` and check
`journalctl -u docker --no-pager -n 50` — full recovery flow in `troubleshooting.md`.


## Sources

- https://docs.docker.com/config/daemon/
- https://docs.docker.com/engine/install/ubuntu/
- https://docs.docker.com/engine/swarm/
- https://docs.docker.com/engine/security/rootless/
- https://doc.traefik.io/traefik/
- https://caddyserver.com/docs/
- https://docs.docker.com/engine/manage-resources/contexts/
- https://docs.docker.com/engine/storage/containerd/
- https://docs.docker.com/engine/logging/configure/
- https://grafana.com/docs/loki/latest/send-data/docker-driver/
- https://grafana.com/docs/loki/latest/send-data/docker-driver/configuration/
- https://docs.docker.com/engine/storage/volumes/

