# BuildKit Features + Multi-platform Builds

## Table of Contents
1. [BuildKit Basics](#basics)
2. [Cache Mounts (`--mount=type=cache`)](#cache-mounts)
3. [Secret Mounts (`--mount=type=secret`)](#secret-mounts)
4. [SSH Forwarding (`--mount=type=ssh`)](#ssh-mounts)
5. [Bind Mounts in RUN (`--mount=type=bind`)](#bind-mounts)
6. [Inline Cache (`--cache-from`)](#inline-cache)
7. [Multi-platform Builds (buildx)](#multiplatform)
8. [CI/CD Integration](#cicd)
9. [Docker Bake (`docker buildx bake`)](#bake)
10. [Named Build Contexts (`--build-context`)](#named-contexts)
11. [`COPY --link`](#copy-link)
12. [`ADD --checksum` (+ git/tar behaviors)](#add-checksum)
13. [`RUN --network` (hermetic build steps)](#run-network)
14. [Build-time Attestations (`--provenance`, `--sbom`)](#attestations)
15. [OCI Annotations (`--annotation`)](#annotations)
16. [Build Debugging (`docker buildx debug --invoke`)](#debug)

---

## BuildKit Basics {#basics}

BuildKit is the default build engine since Docker 23.0. Enabled automatically.
For older Docker, set: `DOCKER_BUILDKIT=1`

Always start Dockerfile with:
```dockerfile
# syntax=docker/dockerfile:1
```
This pins to the latest Docker frontend and unlocks all BuildKit features.

**Key benefits over legacy builder:**
- Parallel stage building (builder and test stages run simultaneously)
- Cache mounts — package manager caches persist between builds
- Secret mounts — credentials available at build time but NOT in image layers
- SSH forwarding — git clone private repos without embedding keys
- Better layer caching — more granular invalidation

---

## Cache Mounts (`--mount=type=cache`) {#cache-mounts}

Cache mounts share directories between build runs WITHOUT committing to image layers.
Package managers download packages to cache → next build reuses them.

```dockerfile
# npm
RUN --mount=type=cache,target=/root/.npm \
    npm ci --omit=dev

# Bun
RUN --mount=type=cache,target=/root/.bun/install/cache \
    bun install --frozen-lockfile

# yarn
RUN --mount=type=cache,target=/root/.yarn/cache \
    yarn install --frozen-lockfile

# pip (Python)
RUN --mount=type=cache,target=/root/.cache/pip \
    pip install -r requirements.txt

# Go modules
RUN --mount=type=cache,target=/go/pkg/mod \
    --mount=type=cache,target=/root/.cache/go-build \
    go build ./...

# Rust/Cargo
RUN --mount=type=cache,target=/usr/local/cargo/registry \
    --mount=type=cache,target=/build/target \
    cargo build --release

# apt-get (system packages)
RUN --mount=type=cache,target=/var/cache/apt,sharing=locked \
    --mount=type=cache,target=/var/lib/apt,sharing=locked \
    apt-get update && apt-get install -y curl git
```

**Cache sharing modes:**
- `sharing=shared` (default) — multiple builds can read simultaneously
- `sharing=locked` — exclusive access (use for apt to avoid dpkg conflicts)
- `sharing=private` — each build gets its own copy (rarely needed)

**Cache invalidation:** Cache mounts never invalidate based on Dockerfile changes.
They persist until `docker builder prune`. Clear with:
```bash
docker builder prune --filter type=exec.cachemount
```

---

## Secret Mounts (`--mount=type=secret`) {#secret-mounts}

Secrets available at build time but NOT visible in image layers or `docker history`.
Use for: NPM_TOKEN, GITHUB_TOKEN, private registry auth, API keys for build steps.

```dockerfile
# Access secret in RUN
RUN --mount=type=secret,id=npm_token \
    NPM_TOKEN=$(cat /run/secrets/npm_token) \
    npm config set //registry.npmjs.org/:_authToken=$NPM_TOKEN && \
    npm install

# Multiple secrets
RUN --mount=type=secret,id=gh_token \
    --mount=type=secret,id=npm_token \
    # ... use both
```

Pass secret during build:
```bash
# From file
docker build --secret id=npm_token,src=.secrets/npm_token .

# From environment variable
echo $NPM_TOKEN | docker build --secret id=npm_token,src=- .

# Inline (stdin)
docker build --secret id=npm_token,env=NPM_TOKEN .
```

GitHub Actions:
```yaml
- name: Build with secret
  run: |
    docker build \
      --secret id=npm_token,env=NPM_TOKEN \
      -t myapp:latest .
  env:
    NPM_TOKEN: ${{ secrets.NPM_TOKEN }}
```

---

## SSH Forwarding (`--mount=type=ssh`) {#ssh-mounts}

Clone private GitHub repos without embedding SSH keys in image.

```dockerfile
# syntax=docker/dockerfile:1
FROM node:22-alpine AS builder

# Install git + openssh client
RUN apk add --no-cache git openssh-client

# Configure known_hosts (required)
RUN mkdir -p /root/.ssh && \
    ssh-keyscan github.com >> /root/.ssh/known_hosts

# Clone using forwarded SSH agent
RUN --mount=type=ssh \
    git clone git@github.com:your-org/private-repo.git /app/private

# Or with npm private packages
COPY package.json package-lock.json ./
RUN --mount=type=ssh \
    --mount=type=cache,target=/root/.npm \
    npm ci
```

Build with SSH forwarding:
```bash
# Enable SSH agent
eval $(ssh-agent)
ssh-add ~/.ssh/id_ed25519

docker build --ssh default .
```

---

## Bind Mounts in RUN (`--mount=type=bind`) {#bind-mounts}

Mount files from build context without COPYing them into the image.
Useful for configuration files needed only during build.

```dockerfile
# Mount tsconfig without copying it to final layer
RUN --mount=type=bind,source=tsconfig.json,target=tsconfig.json \
    npx tsc --noEmit

# Mount test files for running tests during build
RUN --mount=type=bind,source=tests,target=tests \
    npm test
```

---

## Inline Cache (`--cache-from`) {#inline-cache}

Reuse layers from a previously pushed image (e.g., in CI where local cache is gone).

```dockerfile
# Enable inline cache metadata in build
docker build \
  --cache-from myregistry/myapp:cache \
  --cache-to type=inline \
  --tag myregistry/myapp:latest \
  .

# Push cache to registry
docker push myregistry/myapp:latest
```

**Registry cache (better for CI):**
```bash
docker buildx build \
  --cache-from type=registry,ref=ghcr.io/myorg/myapp:cache \
  --cache-to type=registry,ref=ghcr.io/myorg/myapp:cache,mode=max \
  --tag ghcr.io/myorg/myapp:latest \
  --push \
  .
```

GitHub Actions cache:
```yaml
- uses: docker/build-push-action@v6
  with:
    cache-from: type=gha
    cache-to: type=gha,mode=max
    push: true
    tags: ghcr.io/${{ github.repository }}:latest
```

---

## Multi-platform Builds (buildx) {#multiplatform}

Build images that run on both AMD64 (x86) and ARM64 (Apple Silicon, ARM cloud instances).
Required for: ARM-based VPS/cloud instances, Raspberry Pi, Apple Silicon dev consistency.

### Setup

```bash
# Create builder with multi-platform support
docker buildx create --name multiplatform --use --bootstrap

# Verify QEMU emulators (needed for cross-compilation)
docker run --privileged --rm tonistiigi/binfmt --install all

# Check supported platforms
docker buildx inspect --bootstrap
```

### Build and Push Multi-platform Image

```bash
# Build for both platforms and push to registry
docker buildx build \
  --platform linux/amd64,linux/arm64 \
  --tag ghcr.io/myorg/myapp:latest \
  --push \
  .

# Build locally for testing (only one platform at a time without registry)
docker buildx build \
  --platform linux/arm64 \
  --tag myapp:arm64-test \
  --load \  # load into local docker images
  .
```

### Multi-platform Dockerfile Patterns

```dockerfile
# syntax=docker/dockerfile:1

# Platform-specific base images
FROM --platform=$BUILDPLATFORM node:22-alpine AS builder
# $BUILDPLATFORM = machine running the build (e.g., linux/amd64 on Intel Mac)
# $TARGETPLATFORM = target (e.g., linux/arm64 when building for ARM)

ARG BUILDPLATFORM
ARG TARGETPLATFORM
ARG TARGETOS
ARG TARGETARCH

RUN echo "Building for $TARGETPLATFORM on $BUILDPLATFORM"

# For Go: use TARGETARCH for cross-compilation
FROM --platform=$BUILDPLATFORM golang:1.23-alpine AS go-builder
ARG TARGETARCH TARGETOS
RUN GOOS=$TARGETOS GOARCH=$TARGETARCH go build -o /app .

# Runner stage (no platform prefix = uses TARGETPLATFORM automatically)
FROM alpine:3.20 AS runner
COPY --from=go-builder /app /app
```

### Platform-specific Instructions

```dockerfile
# Install platform-specific packages
RUN case "${TARGETARCH}" in \
    amd64) ARCH_SUFFIX="x86_64" ;; \
    arm64) ARCH_SUFFIX="aarch64" ;; \
    *) echo "Unsupported arch: ${TARGETARCH}"; exit 1 ;; \
    esac && \
    wget "https://example.com/tool-${ARCH_SUFFIX}.tar.gz" -O tool.tar.gz
```

### Manifest Lists

Inspect what platforms an image supports:
```bash
docker buildx imagetools inspect ghcr.io/myorg/myapp:latest

# Create manifest list from separate images
docker buildx imagetools create \
  --tag ghcr.io/myorg/myapp:latest \
  ghcr.io/myorg/myapp:latest-amd64 \
  ghcr.io/myorg/myapp:latest-arm64
```

---

## CI/CD Integration {#cicd}

### GitHub Actions (Complete Pipeline)

```yaml
name: Build and Push

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

jobs:
  build:
    runs-on: ubuntu-latest
    permissions:
      contents: read
      packages: write  # for GHCR push

    steps:
      - uses: actions/checkout@v4

      - name: Set up Docker Buildx
        uses: docker/setup-buildx-action@v3

      - name: Log in to GHCR
        uses: docker/login-action@v3
        with:
          registry: ghcr.io
          username: ${{ github.actor }}
          password: ${{ secrets.GITHUB_TOKEN }}

      - name: Extract metadata
        id: meta
        uses: docker/metadata-action@v5
        with:
          images: ghcr.io/${{ github.repository }}
          tags: |
            type=ref,event=branch
            type=ref,event=pr
            type=sha,format=short
            type=raw,value=latest,enable=${{ github.ref == 'refs/heads/main' }}

      - name: Build and push
        uses: docker/build-push-action@v6
        with:
          context: .
          platforms: linux/amd64,linux/arm64
          push: ${{ github.event_name != 'pull_request' }}
          tags: ${{ steps.meta.outputs.tags }}
          labels: ${{ steps.meta.outputs.labels }}
          cache-from: type=gha
          cache-to: type=gha,mode=max
          # For NPM_TOKEN secret:
          # secrets: |
          #   npm_token=${{ secrets.NPM_TOKEN }}
```

### GHCR Authentication

```bash
# Local login to GHCR
echo $GITHUB_TOKEN | docker login ghcr.io -u USERNAME --password-stdin

# Pull from GHCR
docker pull ghcr.io/OWNER/IMAGE:TAG

# Image tagging convention
# ghcr.io/{github-owner}/{repo-name}:{tag}
# ghcr.io/my-org/myapp:main
# ghcr.io/my-org/myapp:abc1234  (git SHA)
```

### Image Tagging Strategy

```bash
# NEVER use :latest as the only tag in production
# Use git SHA for immutable references
docker build -t myapp:$(git rev-parse --short HEAD) .

# Multi-tag
docker build \
  -t ghcr.io/myorg/myapp:$(git rev-parse --short HEAD) \
  -t ghcr.io/myorg/myapp:main \
  .
```

---

## Docker Bake (`docker buildx bake`) {#bake}

Bake is a declarative front-end for buildx. Instead of a shell loop of `docker build`
invocations, you describe every image as a **target** in a file (`docker-bake.hcl`,
`docker-bake.json`, or a Compose file) and run them all with one command. Bake builds
all targets **concurrently with a shared build graph and one cache** — the big win for
monorepos.

```bash
docker buildx bake                 # build the `default` group
docker buildx bake webapp api      # build named targets
docker buildx bake mygroup         # build a group
docker buildx bake --print         # preview resolved JSON, build nothing
```

**WHY use it:** one `docker build` = one target = one process. Five images means five
commands (or a brittle shell `for` loop) — each with its own flags, cache, and no
parallelism between them. Bake collapses that into one declaration that runs concurrently,
shares cache across targets, and is version-controlled. In CI it replaces a fan-out of
`build-push-action` steps for a fixed set of images (see `cicd-git-bridge.md` §7.2 — note
that for **NX monorepos** you still want `nx affected` to derive *which* targets to build,
then hand them to bake or a matrix).

### File format & lookup

Bake searches the cwd in this order (all found files are **merged**, later wins for
scalar attributes like `tags`, `platforms`, `target`):

1. `compose.yaml` / `compose.yml` / `docker-compose.yml` / `docker-compose.yaml`
2. `docker-bake.json`
3. `docker-bake.hcl`
4. `docker-bake.override.json`
5. `docker-bake.override.hcl`

Point at an explicit file with `-f` / `--file`:
```bash
docker buildx bake -f ../docker/bake.hcl --print
```

HCL is the preferred format — it supports variables, functions, and interpolation that
JSON/Compose don't.

### Targets, groups, and the `default` group

- A **target** maps 1:1 to a `docker build` invocation (context, dockerfile, tags, etc.).
- A **group** invokes multiple targets at once.
- `docker buildx bake` with no arguments builds the `default` **group** if present,
  otherwise the `default` **target**. (A `default` group takes precedence over a `default`
  target of the same name.)

### Variables & `${VAR}` interpolation

`variable` blocks declare inputs with optional `type`, `default`, and `description`.
Override defaults via environment variables of the same name. Interpolate with `${VAR}`.

```hcl
variable "TAG" {
  type        = string
  default     = "latest"
  description = "Tag to use for build"
}

target "webapp" {
  tags = ["docker.io/username/webapp:${TAG}"]
}
```
```bash
TAG=dev docker buildx bake webapp   # env override → webapp:dev
```

Typed variables validate overrides and enable list/loop expressions:
```hcl
variable "TAGS" {
  default = ["latest"]
  type    = list(string)
}
target "webapp" {
  tags = [for t in TAGS : "docker.io/username/webapp:${t}"]
}
```

Set a build arg to `null` to fall back to the `ARG` default baked into the Dockerfile.

### Inheritance (`inherits`)

A target can pull attributes from one or more other targets. Common pattern: a `_common`
base target plus per-variant targets that add platforms/tags.

```hcl
target "_common" {
  args   = { GO_VERSION = "1.23" }
  labels = { "org.opencontainers.image.source" = "https://github.com/my-org/app" }
}

target "app-dev" {
  inherits = ["_common"]
  tags     = ["docker.io/username/app:dev"]
}

target "app-release" {
  inherits  = ["app-dev", "_common"]   # list — later wins on conflicts
  platforms = ["linux/amd64", "linux/arm64"]
}
```

### Matrix builds (fork one target into N)

`matrix` is a map of parameter names → lists of values. Bake builds **every combination**
as a separate target. You MUST give each generated target a unique `name` (use
interpolation). Works like GitHub Actions matrix but inside the bake file — eliminates
duplication.

```hcl
# Single axis: app-foo, app-bar
target "app" {
  name   = "app-${tgt}"
  matrix = { tgt = ["foo", "bar"] }
  target = tgt                      # build stage = matrix value
}

# Multiple axes: app-foo-1-0, app-foo-2-0, app-bar-1-0, app-bar-2-0
target "app" {
  name   = "app-${tgt}-${replace(version, ".", "-")}"
  matrix = {
    tgt     = ["foo", "bar"]
    version = ["1.0", "2.0"]
  }
  target = tgt
  args   = { VERSION = version }
}

# Map values per matrix item (differentiate on more than one field)
target "app" {
  name   = "app-${item.tgt}-${replace(item.version, ".", "-")}"
  matrix = {
    item = [
      { tgt = "foo", version = "1.0" },
      { tgt = "bar", version = "2.0" },
    ]
  }
  target = item.tgt
  args   = { VERSION = item.version }
}
```

### `--set` overrides on the CLI

Override any target attribute without editing the file. Pattern: `--set target.attribute=value`.
`*` is a wildcard for all targets. Useful in CI to inject tags or flip platforms.

```bash
docker buildx bake --set "*.platform=linux/amd64,linux/arm64"
docker buildx bake --set "webapp.tags=ghcr.io/my-org/webapp:$(git rev-parse --short HEAD)"
docker buildx bake --set "*.no-cache=true" --set "*.output=type=registry"
```

### Multi-platform in bake

Set `platforms` per target (or globally with `--set "*.platform=..."`). Same QEMU /
`docker-container` builder requirements as raw buildx (see [§7](#multiplatform)).

```hcl
target "release" {
  platforms = ["linux/amd64", "linux/arm64"]
  output    = ["type=registry"]            # = --push
}
```

### Building from a Compose file

Bake reads `services.<name>.build` blocks from a Compose file as targets — service name
becomes the target name. You can layer a `docker-bake.hcl` on top to add bake-only fields
(matrix, inherits) via the `x-bake` Compose extension or a merged HCL file.

```yaml
# compose.yaml
services:
  webapp:
    build:
      context: .
      dockerfile: Dockerfile
    image: ghcr.io/my-org/webapp:latest
```
```bash
docker buildx bake --print webapp   # service → target
```

### `--print` to preview

`--print` resolves all variables, matrices, inheritance, and merges, then prints the final
JSON build plan **without building anything**. Always sanity-check matrix/interpolation here
before a real run.

```bash
docker buildx bake --print app
# → shows the expanded group + per-target context/dockerfile/target/args
```

### Complete monorepo example

```hcl
# docker-bake.hcl — repo with apps/{api,web,worker}/Dockerfile
variable "TAG" {
  default = "latest"
}
variable "REGISTRY" {
  default = "ghcr.io/my-org"
}

group "default" {
  targets = ["api", "web", "worker"]
}

# Shared base: platforms, OCI source label, build args
target "_common" {
  context   = "."
  platforms = ["linux/amd64", "linux/arm64"]
  labels = {
    "org.opencontainers.image.source" = "https://github.com/my-org/monorepo"
  }
  args = { NODE_VERSION = "22" }
}

target "api" {
  inherits   = ["_common"]
  dockerfile = "apps/api/Dockerfile"
  tags       = ["${REGISTRY}/api:${TAG}"]
}

target "web" {
  inherits   = ["_common"]
  dockerfile = "apps/web/Dockerfile"
  tags       = ["${REGISTRY}/web:${TAG}"]
}

target "worker" {
  inherits   = ["_common"]
  dockerfile = "apps/worker/Dockerfile"
  tags       = ["${REGISTRY}/worker:${TAG}"]
}

# Matrix variant: build the same api image against multiple Node versions
target "api-matrix" {
  inherits   = ["_common"]
  name       = "api-node${node}"
  matrix     = { node = ["20", "22"] }
  dockerfile = "apps/api/Dockerfile"
  args       = { NODE_VERSION = node }
  tags       = ["${REGISTRY}/api:${TAG}-node${node}"]
}
```
```bash
docker buildx bake --print                       # preview default group (api, web, worker)
docker buildx bake                               # build all three concurrently
docker buildx bake --set "*.output=type=registry"  # push all
docker buildx bake api-matrix                    # build api-node20 + api-node22
```

> **CI:** wire `docker buildx bake` into the pipeline in place of a fixed build matrix when
> the set of images is stable. See `cicd-git-bridge.md` §7.2 for the GitHub Actions matrix
> alternative and the `nx affected`-driven target selection for NX monorepos.

---

## Named Build Contexts (`--build-context`) {#named-contexts}

`--build-context name=value` exposes an **additional** context to the build alongside the
main one. Inside the Dockerfile, `FROM name`, `COPY --from=name`, and
`RUN --mount=from=name` resolve to it. (Requires Dockerfile 1.4+ / buildx v0.8+.)

The `name` resolves in this priority order:
1. A `--build-context name=...` value
2. A stage defined with `AS name` in the Dockerfile
3. A remote image `name` in a registry

Value types (BuildKit auto-detects):
| Type | Example |
|------|---------|
| Local directory | `--build-context src=../path/to/src` |
| Git repo | `--build-context qemu=https://github.com/qemu/qemu.git` |
| HTTP tarball | `--build-context src=https://example.org/src.tar` |
| Docker image | `--build-context alpine=docker-image://alpine:3.20` |

**Use case 1 — pin a base image** to an immutable digest without editing the Dockerfile
(reproducible rebuilds even if the tag moves):
```bash
docker buildx build \
  --build-context alpine:3.20=docker-image://alpine:3.20@sha256:0123... .
```

**Use case 2 — override a stage with a local dir** (debug a dependency without pushing it).
Given a Dockerfile that clones a helper repo into a stage, you can swap the stage's source
for a local checkout:
```bash
docker buildx build --build-context helper-src=../path/to/local/helper .
```

**Use case 3 — multiple source directories** (escapes the single-context / single
`.dockerignore` limitation, and lets you reach files outside the main context):
```dockerfile
# syntax=docker/dockerfile:1
FROM scratch AS app1-src     # placeholder; replaced by --build-context
FROM golang AS build1
COPY --from=app1 . /src
RUN go build -o /out/app1 .
```
```bash
docker buildx build --build-context app1=app1/src --build-context app2=app2/src .
```

> In Bake the equivalent is `target.contexts` (a map). A Bake context value of
> `target:base` chains one target's output as another target's named context — a build
> pipeline without an intermediate registry push. See [§Docker Bake](#bake).

---

## `COPY --link` {#copy-link}

`COPY --link <src> <dest>` (and `ADD --link`, Dockerfile 1.4+) copies files into an
**independent layer** that is rebased on top of previous layers instead of being computed
relative to them.

```dockerfile
# syntax=docker/dockerfile:1
FROM alpine
COPY --link /foo /bar
```

**Why it matters:** without `--link`, a `COPY --from=build /out /app` is invalidated if
*any* earlier command in the stage changes (or the base image updates) — forcing a full
rebuild of the intermediate stages. With `--link`, the copied layer is content-addressed
and **independent of the layers below it**, so:
- It is reused via `--cache-from` even when earlier layers changed.
- Base-image updates **rebase** without re-running the copy (no full rebuild).
- Multi-stage `COPY --from` no longer cascades invalidation upward.

**When to use:** almost always for `COPY --from=<stage>` of build artifacts in multi-stage
builds, and for copying static assets onto a frequently-changing base. It's the
recommended default for artifact copies.

**Caveats:**
- The destination is treated as an **empty directory** — `--link` does not read existing
  files at the destination. If your copy depends on files already present at `dest`
  (e.g. merging into an existing dir, or `--chown` matching a pre-created user), the
  semantics differ; omit `--link` for those.
- Best paired with registry/inline cache so the independent layer can actually be reused
  across machines (see [Inline Cache](#inline-cache)).

---

## `ADD --checksum` (+ git/tar behaviors) {#add-checksum}

`ADD --checksum=<hash> <src> <dest>` (Dockerfile 1.6+) verifies the integrity of a remote
resource before adding it — fail the build if the download doesn't match.

```dockerfile
# syntax=docker/dockerfile:1
# HTTP source: SHA-256 content digest (only supported algorithm)
ADD --checksum=sha256:24454f830cdb571e2c4ad15481119c43b3cafd48dd869a9b2945d1036d1dc68d \
    https://mirrors.edge.kernel.org/pub/linux/kernel/Historic/linux-0.01.tar.gz /

# Git source: the commit SHA (full, or a unique prefix)
ADD --checksum=be1f38e https://github.com/moby/buildkit.git#v0.26.2 /
```

- **HTTP:** checksum is `sha256:<hex>`. SHA-256 is the only supported algorithm.
- **Git:** checksum is the commit SHA; a prefix (1+ chars) is allowed if unambiguous.

**Other `ADD` remote behaviors worth knowing:**

```dockerfile
# Git repo: BuildKit clones it; .git is EXCLUDED by default.
# Keep it with --keep-git-dir=true (Dockerfile 1.1+):
ADD --keep-git-dir=true https://github.com/moby/buildkit.git#v0.10.1 /buildkit

# Local tar archive: ADD auto-extracts it into <dest> (decompression: gzip/bzip2/xz).
ADD release.tar.gz /opt/app/

# Remote URL (non-archive): downloaded as a file, NOT extracted.
ADD https://example.com/archive.zip /usr/src/things/
```

> Rule of thumb: use `COPY` for local files (no surprise extraction, no network). Use `ADD`
> only when you specifically want remote fetch, checksum verification, git-clone, or
> local-tar auto-extraction. See `dockerfile-patterns.md` for the COPY vs ADD guidance.

---

## `RUN --network` (hermetic build steps) {#run-network}

`RUN --network=<TYPE>` (Dockerfile 1.3+) controls the networking environment for a single
build step.

| Type | Behavior |
|------|----------|
| `default` (omitted) | The build's default network. |
| `none` | **No network access** (`lo` only, isolated to this process). |
| `host` | The host's network namespace (per-instruction, like `docker build --network=host`). |

**`--network=none` — hermetic / reproducible steps.** Force a step to use only files already
in the image, proving it does not silently reach the internet. Ideal for tests that must be
offline, or installs that should only use a pre-fetched vendor dir.

```dockerfile
# syntax=docker/dockerfile:1
FROM python:3.12
ADD wheels.tgz wheels/
# pip can ONLY use the wheels provided by an earlier stage — no PyPI access:
RUN --network=none pip install --find-links wheels mypackage

# Run unit tests hermetically — fails if a test tries to hit a real endpoint:
RUN --mount=type=bind,source=tests,target=tests \
    --network=none npm test
```

**`--network=host` — caveats.** Gated behind the `network.host` **entitlement**. The
buildkitd daemon must be started with `--allow-insecure-entitlement network.host` (or set in
buildkitd config) **and** the build must pass `--allow network.host`. On a locked-down
self-hosted build server this is usually disabled — don't rely on it in shared CI. Use it only
for builds that genuinely need host-network access (e.g. talking to a host-local service),
and prefer cache mounts / multi-stage prefetch instead where possible.

```bash
docker buildx build --allow network.host .
```

---

## Build-time Attestations (`--provenance`, `--sbom`) {#attestations}

BuildKit can attach **SLSA provenance** (how the image was built) and an **SBOM** (what
software it contains) to the image *at build time*, wrapped in in-toto JSON and stored as a
manifest in the image index. This is distinct from scan-time SBOM generation (Trivy/Syft) —
see `security-scanning.md` for that path and for `cosign` verification.

```bash
# Min-level provenance is added BY DEFAULT (with docker-container / cloud drivers).
docker buildx build --sbom=true .                  # opt in to SBOM
docker buildx build --provenance=mode=max .        # full provenance (build args, source, etc.)
docker buildx build --provenance=false .           # opt OUT (see gotcha below)

# Disable all default attestations via env:
BUILDX_NO_DEFAULT_ATTESTATIONS=1 docker buildx build .
```

In `build-push-action` (CI): `provenance: true|mode=max|false` and `sbom: true` inputs map to
these flags (see `cicd-git-bridge.md` §1).

### Gotcha: attestations turn the output into an OCI image **index**

When provenance/SBOM attestations are attached, the pushed artifact becomes an **OCI image
index** (a manifest list with extra attestation manifests) — even for a single-platform image.
**Some older registries and runtimes choke on this** (they expect a plain image manifest):
classic cases include older registry implementations, some Lambda/ECR-consuming runtimes, and
legacy on-prem registries.

**Fix:** disable provenance for those targets:
```bash
docker buildx build --provenance=false .          # CLI
```
```yaml
# build-push-action
with:
  provenance: false
```
This is the same gotcha documented in `cicd-git-bridge.md` §8 — set `provenance: false` when a
deploy target can't pull an attestation index. Exporters that write to disk (`local`, `tar`)
can't embed attestations into an image manifest and instead emit JSON files in the export root.

---

## OCI Annotations (`--annotation`) {#annotations}

Annotations and `org.opencontainers.image.*` labels make an image **traceable** back to its
source, revision, and build time — without inspecting layers. Two mechanisms:

**1. OCI annotations** (`--annotation`) — written onto the OCI manifest/index, the OCI-native
way to attach metadata. By default added to the image manifest; prefix with a level list
(`index`, `manifest`) to target where they land:

```bash
docker buildx build \
  --annotation "org.opencontainers.image.source=https://github.com/my-org/app" \
  --annotation "org.opencontainers.image.revision=$(git rev-parse HEAD)" \
  --annotation "index,manifest:org.opencontainers.image.created=$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
  -t ghcr.io/my-org/app:latest --push .
```

**2. Image labels** (`LABEL` in the Dockerfile, or `--label` on the CLI) — stored in the image
config, visible via `docker inspect`. Use the same `org.opencontainers.image.*` keys for
consistency:

```dockerfile
# syntax=docker/dockerfile:1
ARG GIT_SHA=unknown
LABEL org.opencontainers.image.source="https://github.com/my-org/app" \
      org.opencontainers.image.revision="${GIT_SHA}" \
      org.opencontainers.image.licenses="MIT"
```

Common `org.opencontainers.image.*` keys for traceability: `source` (repo URL), `revision`
(git SHA), `created` (RFC 3339 timestamp), `version`, `title`, `description`, `licenses`,
`authors`. In CI, `docker/metadata-action` emits these labels automatically (`labels` output)
— wire them into `build-push-action` (see [CI/CD Integration](#cicd) and `cicd-git-bridge.md`).
In Bake, use `target.annotations` (with optional `index,manifest:` prefix) and `target.labels`.

---

## Build Debugging (`docker buildx debug --invoke`) {#debug}

When a build fails on a `RUN` step or produces a wrong final image, the debug monitor drops you
into a shell **inside the build** without exporting/loading the image. Experimental — requires
`BUILDX_EXPERIMENTAL=1`.

```bash
export BUILDX_EXPERIMENTAL=1

# Drop into /bin/sh in the FINAL stage after the build:
docker buildx debug --invoke /bin/sh build .

# Start a debug shell automatically WHEN the build fails (inspect the failing state):
docker buildx debug --on=error build .
```

Arguments after `build` are identical to `docker buildx build`. Inside the session, toggle to
**monitor mode** with `Ctrl-a` then `c` — commands include `reload` (re-run the build after
editing the Dockerfile), `rollback` (re-run the interactive container with the step's rootfs),
`exec`, `ps`, `attach`, and `list`. Long-form `--invoke` accepts CSV key-value config
(`args`, `entrypoint`, `env`, `user`, `cwd`, `tty`).

> Healthcheck tuning (`HEALTHCHECK --interval/--timeout/--start-period/--start-interval/--retries`)
> is **not** a BuildKit/buildx feature — see the HEALTHCHECK section in `dockerfile-patterns.md`.

Sources: https://docs.docker.com/build/bake/reference/, https://docs.docker.com/reference/dockerfile/, https://docs.docker.com/build/concepts/context/, https://docs.docker.com/build/metadata/attestations/, https://docs.docker.com/reference/cli/docker/buildx/build/, https://github.com/docker/buildx/blob/master/docs/debugging.md, https://www.docker.com/blog/dockerfiles-now-support-multiple-build-contexts/

