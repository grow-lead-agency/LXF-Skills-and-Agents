# Docker Compose v2 Patterns

Docker Compose v2 is the default since Docker Desktop 3.4+ and Docker Engine 20.10+.
Command: `docker compose` (space, not dash). `docker-compose` is deprecated.

## Table of Contents
1. [File Anatomy](#file-anatomy)
2. [Profiles](#profiles)
3. [Watch Mode (Hot Reload)](#watch-mode-hot-reload)
4. [Health Checks and depends_on](#health-checks-and-depends_on)
5. [Environment Variables](#environment-variables)
6. [Override Files](#override-files)
7. [Networks](#networks)
8. [Volumes](#volumes)
9. [Resource Limits](#resource-limits)
10. [include: (compose multiple files)](#include-compose-multiple-files)
11. [extends: (reuse a service definition)](#extends-reuse-a-service-definition)
12. [Multiple Files and Merge Precedence](#multiple-files-and-merge-precedence)
13. [Lifecycle Hooks (post_start and pre_stop)](#lifecycle-hooks-post_start-and-pre_stop)
14. [pull_policy](#pull_policy)
15. [Top-level configs:](#top-level-configs)
16. [GPU and Device Reservations](#gpu-and-device-reservations)
17. [models: (Compose for AI models)](#models-compose-for-ai-models)
18. [Common Stacks](#common-stacks)

---

## File Anatomy

```yaml
# compose.yml (preferred name, replaces docker-compose.yml)
# compose.yaml also works

services:
  app:
    build:
      context: .          # Dockerfile location
      dockerfile: Dockerfile
      target: runner      # specific multi-stage target
      args:
        NODE_ENV: production
    image: myapp:latest   # if pulling from registry instead of building
    container_name: myapp # explicit name (no random suffix)
    restart: unless-stopped  # always | on-failure | no | unless-stopped
    ports:
      - "3000:3000"       # host:container
      - "127.0.0.1:3000:3000"  # bind to localhost only (more secure)
    environment:
      NODE_ENV: production
      DATABASE_URL: ${DATABASE_URL}  # from .env file
    env_file:
      - .env
    volumes:
      - ./data:/app/data  # bind mount (dev)
      - uploads:/app/uploads  # named volume (prod)
    networks:
      - app-network
    depends_on:
      postgres:
        condition: service_healthy
    deploy:
      resources:
        limits:
          memory: 512m
          cpus: "0.5"

networks:
  app-network:
    driver: bridge

volumes:
  uploads:
    driver: local
```

---

## Profiles

Profiles allow selectively starting services. Perfect for: tools, monitoring,
debug services that shouldn't run in prod.

```yaml
services:
  app:
    build: .
    # No profile = always starts

  db:
    image: postgres:16-alpine
    # No profile = always starts

  pgadmin:
    image: dpage/pgadmin4
    profiles: [tools]         # only starts with --profile tools
    environment:
      PGADMIN_DEFAULT_EMAIL: admin@local.dev
      PGADMIN_DEFAULT_PASSWORD: admin

  redis:
    image: redis:7-alpine
    profiles: [cache, full]   # starts with --profile cache OR --profile full

  mailhog:
    image: mailhog/mailhog
    profiles: [dev]           # local email testing

  prometheus:
    image: prom/prometheus
    profiles: [monitoring]

  grafana:
    image: grafana/grafana
    profiles: [monitoring]
```

Usage:
```bash
# Start core services only
docker compose up

# Start with tools
docker compose --profile tools up

# Start with multiple profiles
docker compose --profile tools --profile monitoring up

# Start everything
docker compose --profile tools --profile cache --profile dev --profile monitoring up
```

---

## Watch Mode (Hot Reload)

`docker compose watch` (v2.22+) synchronizes file changes without full rebuild.
Better than bind mounts for: large node_modules, platform-specific binaries.

```yaml
services:
  app:
    build:
      context: .
      target: dev
    develop:
      watch:
        # Sync source files instantly (no rebuild)
        - action: sync
          path: ./src
          target: /app/src

        # Rebuild image when dependencies change
        - action: rebuild
          path: package.json
        - action: rebuild
          path: package-lock.json

        # Sync + restart (for config changes)
        - action: sync+restart
          path: ./config
          target: /app/config

        # Ignore patterns
        - action: sync
          path: .
          target: /app
          ignore:
            - node_modules/
            - dist/
            - .git/
```

Usage:
```bash
docker compose watch
# or
docker compose up --watch
```

**When to use watch vs bind mounts:**
- Use **watch** when: different OS between dev and container, large node_modules
- Use **bind mounts** when: simple project, no platform-specific native modules

---

## Health Checks and depends_on

Without health checks, `depends_on` only waits for container start — not readiness.
Services can fail because postgres isn't accepting connections yet.

```yaml
services:
  postgres:
    image: postgres:16-alpine
    environment:
      POSTGRES_DB: myapp
      POSTGRES_USER: postgres
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD}
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U postgres -d myapp"]
      interval: 10s
      timeout: 5s
      start_period: 30s
      retries: 5
    volumes:
      - postgres_data:/var/lib/postgresql/data

  redis:
    image: redis:7-alpine
    command: redis-server --maxmemory 256mb --maxmemory-policy allkeys-lru
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 10s
      timeout: 5s
      retries: 3

  app:
    build: .
    depends_on:
      postgres:
        condition: service_healthy  # waits until pg_isready passes
      redis:
        condition: service_healthy
    # Optional: restart if dependency restarts
      postgres:
        condition: service_healthy
        restart: true

volumes:
  postgres_data:
```

**depends_on conditions:**
- `service_started` — default, just waits for container to start
- `service_healthy` — waits for healthcheck to pass (BEST for databases)
- `service_completed_successfully` — waits for service to exit 0 (for init containers)

---

## Environment Variables

```yaml
services:
  app:
    environment:
      # Hard-coded (not recommended for secrets)
      NODE_ENV: production

      # From shell environment
      DATABASE_URL:  # no value = takes from host shell's $DATABASE_URL

      # With default fallback
      PORT: ${PORT:-3000}

      # Interpolated
      API_URL: "https://${DOMAIN}/api"

    env_file:
      - .env          # loaded first
      - .env.local    # overrides (gitignored)
```

`.env` file (commit this with safe defaults):
```bash
# .env
NODE_ENV=development
PORT=3000
DATABASE_URL=postgres://postgres:postgres@db:5432/myapp
REDIS_URL=redis://redis:6379
```

`.env.local` (gitignore this — real secrets):
```bash
# .env.local
DATABASE_URL=postgres://user:realpassword@prod-host:5432/myapp
```

**Variable precedence (highest to lowest):**
1. `docker compose run -e VAR=val`
2. Shell environment (`export VAR=val`)
3. `.env` file
4. Compose file `environment:` defaults

---

## Override Files

Compose automatically merges `compose.yml` + `compose.override.yml`.
Use for dev vs prod differences.

```yaml
# compose.yml (production-ready base)
services:
  app:
    image: ghcr.io/myorg/myapp:latest
    restart: unless-stopped
    ports:
      - "3000:3000"
```

```yaml
# compose.override.yml (dev additions — gitignore or keep)
services:
  app:
    build: .  # build locally instead of pull
    volumes:
      - ./src:/app/src  # live code sync
    environment:
      NODE_ENV: development
      DEBUG: "app:*"
    ports:
      - "9229:9229"  # debugger port
```

```yaml
# compose.prod.yml (explicit production overrides)
services:
  app:
    deploy:
      replicas: 2
      resources:
        limits:
          memory: 1g
          cpus: "1.0"
```

Usage:
```bash
# Dev (auto-merges compose.override.yml)
docker compose up

# Prod (explicit file)
docker compose -f compose.yml -f compose.prod.yml up

# CI (no override)
docker compose -f compose.yml up
```

---

## Networks

```yaml
services:
  frontend:
    networks:
      - public    # internet-facing
      - internal  # backend access

  backend:
    networks:
      - internal  # no public exposure
      - db-net    # database access

  db:
    networks:
      - db-net    # isolated from frontend

networks:
  public:
    driver: bridge
  internal:
    driver: bridge
    internal: true  # no external internet access
  db-net:
    driver: bridge
    internal: true
```

**DNS in Compose:** Services are reachable by their service name within shared networks.
```yaml
# 'app' can reach 'db' at hostname 'db'
DATABASE_URL: postgres://postgres:pass@db:5432/myapp
#                                        ↑ service name = hostname
```

**Connecting to external network** (e.g., shared Traefik network):
```yaml
networks:
  traefik:
    external: true  # pre-exists outside this compose file

services:
  app:
    networks:
      - traefik
    labels:
      - "traefik.enable=true"
      - "traefik.http.routers.app.rule=Host(`myapp.com`)"
```

---

## Volumes

```yaml
volumes:
  # Named volume (managed by Docker, persists across compose down)
  db_data:
  uploads:

  # Named volume with options
  db_data:
    driver: local
    driver_opts:
      type: none
      o: bind
      device: /mnt/fast-disk/db  # bind to specific host path

  # External volume (pre-created, not managed by compose)
  shared_uploads:
    external: true
    name: myapp_uploads  # exact Docker volume name

services:
  db:
    volumes:
      - db_data:/var/lib/postgresql/data  # named volume
      - ./init.sql:/docker-entrypoint-initdb.d/init.sql:ro  # bind mount, read-only
      - /etc/timezone:/etc/timezone:ro  # share timezone

  app:
    volumes:
      # Named volume for persistence
      - uploads:/app/uploads
      # Bind mount for dev hot-reload
      - ./src:/app/src
      # Anonymous volume to shadow node_modules (prevent host override)
      - /app/node_modules
```

**Volume cleanup:**
```bash
docker compose down -v          # removes named volumes defined in compose file
docker volume prune             # removes all unused volumes (CAUTION!)
docker volume ls                # list volumes
docker volume inspect db_data   # inspect volume details
```

---

## Resource Limits

```yaml
services:
  app:
    deploy:
      resources:
        limits:
          memory: 512m      # hard limit — container killed if exceeded
          cpus: "0.5"       # 50% of one CPU core
        reservations:
          memory: 256m      # guaranteed minimum
          cpus: "0.25"

  # For high-traffic services
  api:
    deploy:
      resources:
        limits:
          memory: 1g
          cpus: "1.0"

  # For databases — give plenty of memory
  postgres:
    deploy:
      resources:
        limits:
          memory: 2g
          cpus: "2.0"
        reservations:
          memory: 512m
```

**Memory units:** `b`, `k`, `m`, `g` (bytes, kilobytes, megabytes, gigabytes)

Logging limits (prevent disk fill):
```yaml
services:
  app:
    logging:
      driver: json-file
      options:
        max-size: "50m"
        max-file: "5"
```

---

## include: (compose multiple files)

The top-level `include:` element pulls in **other complete Compose files** as
first-class dependencies. Each included file is loaded as its **own** Compose
project — its own project directory, its own `.env` — and then its resource
definitions are copied into your model. This is fundamentally different from
`-f file1 -f file2` (§12): with `-f`, files are **merged** field-by-field; with
`include`, each file resolves its own relative paths and env independently, and
Compose **warns on name conflicts instead of merging** them.

```yaml
# compose.yaml
include:
  - ../commons/compose.yaml          # short syntax: just a path
  - ../another-domain/compose.yaml

services:
  webapp:
    build: .
    depends_on:
      - included-service             # a service declared in another-domain's file
```

Short syntax loads the file with **its own parent folder** as the project
directory, picking up that folder's `.env` for interpolation (your local env can
override those values). Relative paths inside an included file resolve against
**that file's** location — not yours. This is the key win over `-f`: a sub-domain
team owns a self-contained `compose.yaml` (with its own `./config`, `./Dockerfile`
paths) and you just `include` it without rewriting any paths.

Long syntax for explicit control over parsing:

```yaml
include:
  - path: ../another/compose.yaml
    project_directory: ..            # base for resolving that file's relative paths
    env_file:                        # env file(s) for interpolating that file
      - ../another/.env
      - ../another/dev.env
  - path:                            # path can be a LIST -> those files merge together
      - ../commons/compose.yaml      # before being included as one unit
      - ./commons-override.yaml
```

`include` is recursive (an included file may `include` further files) and is
evaluated **after** the `-f` files are parsed and merged, so cross-file name
conflicts are detected. Use `include` to compose **independent sub-domains**; use
`-f` (§12) to layer **overrides** onto one model; use `extends` (§11) to reuse a
**single service definition**.

---

## extends: (reuse a service definition)

`extends:` reuses **one service's** configuration — from the same file or another
file — as a base you then override. Unlike `include` (whole files) and `-f`
(override layering), `extends` is service-to-service.

```yaml
# common.yaml — the base service
services:
  base-app:
    image: ghcr.io/myorg/myapp:latest
    environment:
      LOG_FORMAT: json
    deploy:
      resources:
        limits:
          memory: 512m
```

```yaml
# compose.yaml — reuse and override
services:
  api:
    extends:
      file: common.yaml      # omit `file:` to extend a service in THIS file
      service: base-app
    environment:
      SERVICE_NAME: api      # merged INTO base's environment (mapping merge)
    ports:
      - "3000:3000"          # added on top of the base
```

What merges, what doesn't:

- **Mappings** (e.g. `environment`, `build.args`, `deploy.labels`,
  `deploy.update_config`): main service keys **override** the referenced ones;
  non-overridden keys are kept.
- **Sequences** (e.g. `ports`, `dns`): items are **combined** — referenced items
  first, then the main service's.
- **Scalars** (e.g. `image`, `mem_limit`): main service value **wins**.
- **NOT auto-imported:** referenced `volumes`, `networks`, `configs`, `secrets`,
  `depends_on` (and `service:{name}` in `ipc`/`pid`/`network_mode`) are NOT pulled
  in for you — you must declare those resources in the model that uses `extends`.
- Circular `extends` is an error. `extends` is **not** supported with
  `docker stack deploy` (Swarm).

Common pattern: a `base-service` with shared logging/healthcheck/resource limits
that every concrete service extends, so the cross-cutting config lives once.

---

## Multiple Files and Merge Precedence

A frequent real-world footgun. When you give Compose multiple files, it builds
**one** model by merging them in order.

**How files are selected (precedence of the file list itself):**

1. **`-f` flags**, in the order given: `-f a.yml -f b.yml` → `a` is the base,
   `b` is layered on top. **Later files win** on conflicts.
2. **`COMPOSE_FILE` env var** — a list (separator `:` on Linux/macOS, `;` on
   Windows, override with `COMPOSE_PATH_SEPARATOR`) used when no `-f` is passed.
3. **Auto-load**: with no `-f` and no `COMPOSE_FILE`, Compose loads
   `compose.yaml` (or `docker-compose.yaml`) **plus**, if present,
   `compose.override.yaml` (or `docker-compose.override.yml`) layered on top
   automatically. This is why §6's override file "just works."

**How values merge (the part that bites):**

- **Mappings merge** — missing keys are added, conflicting keys take the value
  from the **later** file:

  ```yaml
  # base:      foo: { key1: value1, key2: value2 }
  # override:  foo: { key2: VALUE,  key3: value3 }
  # result:    foo: { key1: value1, key2: VALUE, key3: value3 }
  ```

- **Ordinary sequences append** — for fields such as `dns`, `dns_search`, `env_file`,
  and `tmpfs`, the later file's items are added to the base's:

  ```yaml
  # base:      dns: [1.1.1.1]
  # override:  dns: [8.8.8.8]
  # result:    dns: [1.1.1.1, 8.8.8.8]   # both! not just 8.8.8.8
  ```

  The unique-resource sequences `ports`, `volumes`, `secrets`, and `configs` are different.
  Compose identifies entries by their unique key (for example target port, or container target
  path) and merges a matching entry instead of blindly appending a duplicate. Non-matching
  entries are appended.

- **Reset or replace explicitly when needed.** Compose's custom YAML tags can clear or replace
  inherited values. `!reset` resets a field to its type default; `!override` (Compose 2.24.4+)
  replaces the field without applying normal merge rules:

  ```yaml
  services:
    app:
      # Clear all inherited ports.
      ports: !reset []

      # In another override, replace the inherited list wholesale.
      # ports: !override
      #   - "8443:443"
  ```

  These tags are Compose-specific, so generic YAML tooling may need Compose-aware parsing.

- **Exception — `command`, `entrypoint`, `healthcheck.test` REPLACE**, not
  append. The later file's value wins wholesale (so a dev override can swap the
  command without inheriting the base's args).

```bash
docker compose -f compose.yml -f compose.prod.yml config   # PRINT the merged model
```

> Always `docker compose config` to see the final merged result before deploying —
> it resolves files, env, `include`, and `extends` into the literal model Compose
> will run. It's the fastest way to debug "why is this list/value not what I set?"

---

## Lifecycle Hooks (post_start and pre_stop)

`post_start` and `pre_stop` run commands **after a container starts** / **before
it's stopped**, separately from `ENTRYPOINT`/`COMMAND`. Their headline feature:
hooks can run with **elevated privileges** (e.g. `user: root`) even when the
container itself runs unprivileged — so you do the one root task without dropping
the container's security posture.

```yaml
services:
  app:
    image: backend
    user: 1001                        # app runs as non-root
    volumes:
      - data:/data
    post_start:
      - command: chown -R 1001:1001 /data   # fix volume ownership as root, once
        user: root
      - command: /opt/scripts/register-service.sh   # e.g. register with a registry
    pre_stop:
      - command: /opt/scripts/drain-connections.sh   # graceful drain before SIGTERM

volumes:
  data: {}
```

Semantics to know:

- **`post_start` has NO ordering guarantee vs the entrypoint** — it may run
  before or after the app is serving. Use it only for tasks that don't need to
  finish before the app starts (registration, ownership fixups). Don't use it as
  a "wait for ready" gate — that's `healthcheck` + `depends_on` (§4).
- **`pre_stop` runs before the stop signal** is sent, and only on a *managed*
  stop (`docker compose down`, `stop`, Ctrl+C) — **not** if the container exits
  on its own or is killed (`SIGKILL`). Good for draining connections / a quick
  backup while the app is still fully up.

---

## pull_policy

Controls when Compose pulls an image before starting a service. Matters because
the right choice differs sharply across dev / CI / prod.

```yaml
services:
  api:
    image: ghcr.io/myorg/myapp:v2
    pull_policy: always        # see values below
```

- **`always`** — always pull from the registry. **Prod/CD:** guarantees you run
  the registry's current image even when a tag like `:latest` or `:staging`
  moved.
- **`missing`** — pull only if not in the local cache (**default** when not also
  building). `if_not_present` is an alias. Note: a `:latest` tag is **always**
  pulled even under `missing`.
- **`never`** — never pull; fail if the image isn't cached locally. **Air-gapped
  / offline** runs, or when you pre-loaded images via `docker load`.
- **`build`** — (re)build the image from `build:` even if one is already present.
  **Dev:** force local rebuilds.
- **Also:** `daily`, `weekly`, `every_<duration>` (e.g. `every_12h`) — check the
  registry for updates only if the last pull was older than that window. Useful
  on long-lived dev boxes to avoid hammering the registry.

**Typical mapping:** dev → `build` (or `missing`); CI → `always` for a clean
fetch; prod → `always` (moving tags) or `never` (immutable digest-pinned, fully
pre-pulled).

---

## Top-level configs:

`configs:` injects **non-secret** config files/values into a container at runtime
— without rebuilding the image and without managing host bind-mount paths. Use it
for app config you'd otherwise bake in or bind-mount; use **`secrets:`** for
anything sensitive (configs are world-readable `0444` by default), and prefer it
over bind mounts when you want the value defined **in** the Compose model (or
created in the engine) rather than as a host file the container depends on.

```yaml
services:
  app:
    image: ghcr.io/myorg/myapp:latest
    configs:
      - source: app_config
        target: /app/config.yml      # where it lands in the container
        mode: 0440                    # optional perms/owner override
      - inline_flags                  # short form -> mounts at /<config-name>

configs:
  app_config:
    file: ./config.yml               # from a file on the host
  inline_flags:
    content: |                        # inlined content (Compose v2.23.1+),
      DEBUG=${DEBUG}                  # interpolates env at deploy time
      APP=${COMPOSE_PROJECT_NAME}
  # other sources:
  #   environment: "SOME_ENV_VAR"     # value from an env var (v2.23.1+)
  #   external: true                  # pre-created in the engine; name: to look it up
```

Source is exactly one of `file`, `environment`, `content`, or `external`. With
`external: true`, every attribute except `name` is rejected. (Same model as
Swarm `configs` in `daemon-server-ops.md` §5 — on Compose it works on a single
host too.)

---

## GPU and Device Reservations

Reserve accelerators (GPUs, TPUs) for a service via
`deploy.resources.reservations.devices`. **Prerequisite:** the host needs the
**NVIDIA Container Toolkit** installed and the NVIDIA runtime configured in the
daemon, or no GPU is visible to the container.

```yaml
services:
  inference:
    image: ghcr.io/myorg/ml-worker:latest
    deploy:
      resources:
        reservations:
          devices:
            - driver: nvidia          # vendor driver
              capabilities: [gpu]      # REQUIRED — 'gpu' (or 'tpu', driver-specific caps)
              count: 1                 # 'all' or an integer
              # device_ids: ["GPU-f123d1c9-..."]   # OR pin specific GPUs (mutually exclusive with count)
              # options:                           # driver-specific opts
              #   virtualization: false
```

- `capabilities` is the only **required** field; a device must satisfy **all**
  requested caps. Generic caps: `gpu`, `tpu`. Driver-specific caps are prefixed
  (e.g. `nvidia-compute`).
- `count` and `device_ids` are **mutually exclusive** — set one, not both.
  `count: all` (or unset) reserves every matching device.

For local AI workloads this is how you give a model container the GPU — cross-ref
`docker-ai.md` (Docker Model Runner can serve models on the host's GPU; the
`models:` element below is the higher-level alternative when DMR manages the
model).

---

## models: (Compose for AI models)

Compose **v2.38+** treats AI models as first-class dependencies via a top-level
`models:` element plus a per-service `models:` binding. Docker Model Runner (or
any Compose-spec platform) handles the model pull, lifecycle, and env injection —
so a service can `depends_on` a model the way it depends on a database.

```yaml
services:
  chat:
    image: ghcr.io/myorg/chat-app:latest
    models:
      - llm            # short syntax -> auto-injects LLM_URL + LLM_MODEL env vars

models:
  llm:
    model: ai/llama3.2:1B   # OCI model artifact pulled + served by the platform
```

Short syntax (`models: [llm]`) auto-injects `<NAME>_URL` + `<NAME>_MODEL` env vars
(name uppercased) pointing your app at the served endpoint. This is just the
compose-side shape — the deep source for Docker Model Runner, the long syntax,
endpoint/embeddings options, and DMR-vs-Ollama is `docker-ai.md` §2–§3.

---

## Common Stacks

### Node.js + Postgres + Redis

```yaml
# compose.yml
services:
  app:
    build:
      context: .
      target: runner
    ports:
      - "3000:3000"
    environment:
      NODE_ENV: production
      DATABASE_URL: postgres://postgres:${POSTGRES_PASSWORD}@db:5432/myapp
      REDIS_URL: redis://redis:6379
    depends_on:
      db:
        condition: service_healthy
      redis:
        condition: service_healthy
    restart: unless-stopped
    deploy:
      resources:
        limits:
          memory: 512m

  db:
    image: postgres:16-alpine
    environment:
      POSTGRES_DB: myapp
      POSTGRES_USER: postgres
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD}
    volumes:
      - db_data:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U postgres -d myapp"]
      interval: 10s
      timeout: 5s
      start_period: 30s
      retries: 5
    restart: unless-stopped
    deploy:
      resources:
        limits:
          memory: 1g

  redis:
    image: redis:7-alpine
    command: redis-server --maxmemory 256mb --maxmemory-policy allkeys-lru --save ""
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 10s
      retries: 3
    restart: unless-stopped
    deploy:
      resources:
        limits:
          memory: 300m

volumes:
  db_data:
```

```yaml
# compose.override.yml (dev)
services:
  app:
    build:
      target: dev
    develop:
      watch:
        - action: sync
          path: ./src
          target: /app/src
        - action: rebuild
          path: package-lock.json
    environment:
      NODE_ENV: development
    ports:
      - "3000:3000"
      - "9229:9229"  # debugger

  db:
    ports:
      - "5432:5432"  # expose to host for TablePlus/DBeaver

  redis:
    ports:
      - "6379:6379"  # expose for Redis Commander
```

### Useful Commands

```bash
# Start
docker compose up              # foreground
docker compose up -d           # detached
docker compose up --build      # rebuild images first
docker compose up --watch      # with file watch

# Logs
docker compose logs -f         # all services, follow
docker compose logs -f app     # specific service

# Status
docker compose ps              # list containers with status
docker compose top             # processes inside containers

# Shell access
docker compose exec app sh     # sh (Alpine)
docker compose exec app bash   # bash (Debian)
docker compose run --rm app npm test  # one-off command

# Stop
docker compose stop            # stop, keep containers
docker compose down            # stop + remove containers + networks
docker compose down -v         # also remove volumes (CAUTION!)

# Rebuild
docker compose build --no-cache app  # force full rebuild

# Scale (multiple replicas, needs load balancer)
docker compose up --scale app=3
```


## Sources

- https://docs.docker.com/reference/compose-file/
- https://docs.docker.com/reference/compose-file/include/
- https://docs.docker.com/reference/compose-file/merge/
- https://docs.docker.com/reference/compose-file/services/
- https://docs.docker.com/compose/how-tos/lifecycle/
- https://docs.docker.com/reference/compose-file/configs/
- https://docs.docker.com/reference/compose-file/deploy/
- https://docs.docker.com/compose/how-tos/model-runner/
