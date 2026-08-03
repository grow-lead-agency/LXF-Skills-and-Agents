# Docker CI/CD — Git Bridge (build → push → deploy on self-hosted infra)

This is the **bridge** between Docker image building and GitHub Actions / self-hosted
runner infrastructure. It documents the Docker-specific build-push-deploy workflow that
runs **on** a self-hosted build server.

**Assumed context:**
- Self-hosted GitHub Actions runner (a dedicated build server — e.g. a mid-size VPS, 12 vCPU / 24 GB)
- Runner selection: repo variable `CI_RUNNER` → `runs-on: ${{ vars.CI_RUNNER || 'ubuntu-latest' }}`
- Default registry: **GHCR** (`ghcr.io/my-org/<image>`)
- Stack: Node.js apps (Node 22 + npm)
- Deploy targets: bare VPS (docker compose), ECS (ECR), ACR / Container Apps

> Runner ops, runner registration, systemd unit hardening, and scheduled maintenance are
> out of scope here — this file owns only the Docker build/push/deploy that runs on that infra.

---

## Table of Contents

1. [Pipeline overview](#1-pipeline-overview)
2. [Canonical workflow — docker-build-push.yml](#2-canonical-workflow--docker-build-pushyml)
3. [Self-hosted runner Docker gotchas](#3-self-hosted-runner-docker-gotchas)
4. [Tag strategy in CI](#4-tag-strategy-in-ci)
5. [Deploy handoff by target](#5-deploy-handoff-by-target)
6. [Build caching strategies compared](#6-build-caching-strategies-compared)
7. [Multi-stage & monorepo matrix builds](#7-multi-stage--monorepo-matrix-builds)
7b. [Closing the loop — image ↔ git traceability & rollback](#7b-closing-the-loop--image--git-traceability--rollback)
8. [Gotchas](#8-gotchas)

---

## 1. Pipeline overview

```
┌──────────┐  ┌──────────────┐  ┌────────────┐  ┌──────────────┐
│ checkout │→ │ setup-qemu   │→ │ setup-     │→ │ login GHCR   │
│          │  │ (arm64 emul) │  │ buildx     │  │ (GITHUB_TOKEN)│
└──────────┘  └──────────────┘  └────────────┘  └──────┬───────┘
                                                        │
        ┌───────────────────────────────────────────────┘
        ▼
┌──────────────┐  ┌──────────────────┐  ┌───────────────┐  ┌──────────────┐
│ metadata     │→ │ build multi-arch │→ │ Trivy scan    │→ │ cosign sign  │
│ (tags+labels)│  │ amd64 + arm64    │  │ exit 1 on CRIT│  │ keyless OIDC │
└──────────────┘  │ cache gha/registry│  └───────────────┘  └──────┬───────┘
                  └────────┬─────────┘                              │
                           │ push by digest                        │
                           ▼                                        ▼
                  ┌──────────────────────────────────────────────────────┐
                  │ DEPLOY HANDOFF (digest-pinned)                        │
                  │ Coolify webhook │ Hetzner SSH │ ECS │ ACR/ContainerApp│
                  └──────────────────────────────────────────────────────┘
```

Key invariants:
- **Image is built once**, multi-arch, scanned, signed, pushed by **digest**.
- **Deploy consumes the digest**, never `:latest` in prod.
- Scan is a **hard gate** (`exit-code: 1` on CRITICAL) — broken/vulnerable images never push to a deployable tag.

---

## 2. Canonical workflow — docker-build-push.yml

Complete working `.github/workflows/docker-build-push.yml` for a Node.js app:

```yaml
name: docker-build-push

on:
  push:
    branches: [main]
    tags: ['v*']
  pull_request:
    branches: [main]

env:
  REGISTRY: ghcr.io
  IMAGE_NAME: ${{ github.repository }}   # <org>/<repo>

jobs:
  build:
    # Pattern: self-hosted runner with ubuntu-latest fallback
    runs-on: ${{ vars.CI_RUNNER || 'ubuntu-latest' }}
    permissions:
      contents: read       # checkout
      packages: write      # push to GHCR
      id-token: write      # cosign keyless OIDC token (Fulcio)
    steps:
      - name: Checkout
        uses: actions/checkout@v4

      # QEMU registers binfmt handlers for cross-arch (arm64 on amd64 host).
      # On self-hosted, binfmt may already be installed host-wide (see §3) — harmless to re-run.
      - name: Set up QEMU
        uses: docker/setup-qemu-action@v3

      - name: Set up Buildx
        uses: docker/setup-buildx-action@v3
        with:
          # On self-hosted, the docker-container driver is created automatically.
          driver: docker-container

      - name: Log in to GHCR
        if: github.event_name != 'pull_request'
        uses: docker/login-action@v3
        with:
          registry: ${{ env.REGISTRY }}
          username: ${{ github.actor }}
          password: ${{ secrets.GITHUB_TOKEN }}

      - name: Extract metadata (tags, labels)
        id: meta
        uses: docker/metadata-action@v5
        with:
          images: ${{ env.REGISTRY }}/${{ env.IMAGE_NAME }}
          tags: |
            type=sha,format=long,prefix=                # immutable git SHA — always
            type=semver,pattern={{version}}             # v1.2.3 on git tags
            type=semver,pattern={{major}}.{{minor}}     # v1.2 on git tags
            type=raw,value=latest,enable={{is_default_branch}}  # :latest only on main
          labels: |
            org.opencontainers.image.source=${{ github.server_url }}/${{ github.repository }}
            org.opencontainers.image.revision=${{ github.sha }}

      # PRs need a loadable, single-platform image because a non-pushed multi-platform
      # result has no local image and no registry digest for Trivy to scan.
      - name: Build PR image for local scan
        if: github.event_name == 'pull_request'
        id: build-pr
        uses: docker/build-push-action@v6
        with:
          context: .
          load: true
          platforms: linux/amd64
          tags: local/pr-image:${{ github.sha }}
          labels: ${{ steps.meta.outputs.labels }}
          provenance: false
          sbom: false
          cache-from: type=gha
          cache-to: type=gha,mode=max

      - name: Trivy vulnerability scan (PR image)
        if: github.event_name == 'pull_request'
        uses: aquasecurity/trivy-action@0.28.0
        with:
          image-ref: local/pr-image:${{ github.sha }}
          format: table
          exit-code: 1
          ignore-unfixed: true
          severity: CRITICAL
          vuln-type: os,library

      - name: Build and push multi-platform image
        if: github.event_name != 'pull_request'
        id: build
        uses: docker/build-push-action@v6
        with:
          context: .
          push: true
          platforms: linux/amd64,linux/arm64
          tags: ${{ steps.meta.outputs.tags }}
          labels: ${{ steps.meta.outputs.labels }}
          provenance: true                  # SLSA provenance attestation
          sbom: true                         # SBOM attestation
          cache-from: type=gha
          cache-to: type=gha,mode=max

      # Trivy scans the pushed digest. exit-code 1 fails the job on CRITICAL.
      - name: Trivy vulnerability scan (pushed image)
        if: github.event_name != 'pull_request'
        uses: aquasecurity/trivy-action@0.28.0
        with:
          image-ref: ${{ env.REGISTRY }}/${{ env.IMAGE_NAME }}@${{ steps.build.outputs.digest }}
          format: table
          exit-code: 1
          ignore-unfixed: true
          severity: CRITICAL
          vuln-type: os,library

      # Keyless signing — no long-lived keys. Uses OIDC token (id-token: write) + Fulcio + Rekor.
      - name: Install cosign
        if: github.event_name != 'pull_request'
        uses: sigstore/cosign-installer@v3

      - name: Sign image (keyless)
        if: github.event_name != 'pull_request'
        env:
          COSIGN_EXPERIMENTAL: '1'
        run: |
          cosign sign --yes \
            ${{ env.REGISTRY }}/${{ env.IMAGE_NAME }}@${{ steps.build.outputs.digest }}

      - name: Emit digest for downstream deploy jobs
        if: github.ref == 'refs/heads/main'
        id: out
        run: echo "digest=${{ steps.build.outputs.digest }}" >> "$GITHUB_OUTPUT"
    outputs:
      digest: ${{ steps.out.outputs.digest }}
      image: ${{ env.REGISTRY }}/${{ env.IMAGE_NAME }}
```

> `provenance`/`sbom` attestations + cosign → see `security-scanning.md`.
> Buildx driver + multi-arch internals → see `buildkit-multiplatform.md`.
> Registry tag/digest semantics → see `registry-management.md`.

---

## 3. Self-hosted buildserver Docker gotchas

These are the integration points between Docker builds and the runner infrastructure.

### 3.1 GHA cache (`type=gha`) needs a backend

`type=gha` uses GitHub's **Actions Cache service**, scoped per-repo with a ~10 GB quota.
It works on self-hosted runners too (the cache lives on GitHub, not the runner), **but**:

- Quota eviction is aggressive on busy repos → cache misses, slow builds.
- On a dedicated buildserver you usually want a cache that's **local to the host** or in a
  registry you control. Prefer **`type=registry`** (survives runner restarts, shared across repos)
  or a **local cache dir** (fastest, host-pinned):

```yaml
# Registry-backed cache (recommended for self-hosted — see §6)
cache-from: type=registry,ref=ghcr.io/my-org/<repo>:buildcache
cache-to: type=registry,ref=ghcr.io/my-org/<repo>:buildcache,mode=max
```

```yaml
# Local cache on the buildserver (fastest; needs prune — see §3.4)
cache-from: type=local,src=/opt/buildcache/<repo>
cache-to: type=local,dest=/opt/buildcache/<repo>,mode=max
```

### 3.2 QEMU / binfmt for arm64 — one-time host install

`docker/setup-qemu-action` registers binfmt handlers **per-job inside a container**. On a
self-hosted host you want them installed **persistently** so every job has arm64 emulation:

```bash
# Run ONCE on the buildserver host (re-run after host reboot if not persisted):
docker run --privileged --rm tonistiigi/binfmt --install all
# Verify:
docker run --privileged --rm tonistiigi/binfmt   # lists registered emulators
```

If `--privileged` is blocked by systemd hardening (see 3.5), arm64 cross-builds fail with
`exec format error`. Either relax the unit or build arm64 on a native arm runner.

### 3.3 Docker daemon reachable by the runner user

The runner process user must be in the `docker` group, or every `docker`/`buildx` call fails
with `permission denied while trying to connect to the Docker daemon socket`:

```bash
sudo usermod -aG docker <runner-user>     # e.g. 'actions' or 'github-runner'
sudo systemctl restart actions.runner.*   # group change needs a fresh login/session
# Verify as the runner user:
sudo -u <runner-user> docker info >/dev/null && echo OK
```

Do **not** mount `/var/run/docker.sock` into the runner container loosely — that grants
root-equivalent host access. Prefer rootless or a scoped socket.

### 3.4 Disk pressure — periodic builder prune

A multi-arch buildserver fills disk fast (layers, cache, dangling builders). Add a scheduled
cleanup (quarterly maintenance at minimum); a cron on the host is the safety net:

```bash
# Reclaim build cache older than 168h, keep 20 GB ceiling
docker builder prune --force --filter 'until=168h' --keep-storage 20gb
docker image prune --force --filter 'until=168h'
docker system df          # audit usage
```

See `daemon-server-ops.md` for full disk-management runbook (GC policy, log rotation).

### 3.5 systemd `NoNewPrivileges` / `ProtectHome` blocking

A hardened runner systemd unit can break Docker builds:
- `NoNewPrivileges=true` blocks `sudo`/privileged steps → binfmt install (3.2) and any
  `--with-deps` style apt installs fail (same class of bug as Playwright's `--with-deps`
  install being blocked).
- `ProtectHome=true` / `ReadOnlyPaths` can hide the buildx state dir (`~/.docker/buildx`)
  → "no builder instance found".

**Fix path:** carve out writable paths or run the privileged one-time setup outside the
hardened unit.

---

## 4. Tag strategy in CI

| Tag | When | Mutable? | Use |
|-----|------|----------|-----|
| `<git-sha>` (long) | every build | **immutable** | deploy reference, rollback target |
| `vX.Y.Z` / `vX.Y` | on `v*` git tag | immutable per release | release pinning |
| `latest` | only on `main` | mutable | dev convenience, **never prod** |
| `<repo>:buildcache` | every build | mutable | cache only, not deployable |

Rules:
- **Always** tag with the immutable git SHA — this is the canonical deploy handle.
- `:latest` **only** on the default branch and **never** pulled by a prod deploy.
- **Deploy by digest, not tag.** Resolve the digest in CI and pass it downstream:

```bash
# Digest pinning — deploy targets get @sha256:... not :latest
IMAGE="ghcr.io/my-org/<repo>@${{ needs.build.outputs.digest }}"
```

A tag can be moved/overwritten; a digest cannot. Prod deploys reference
`ghcr.io/...@sha256:...` so the running image is byte-for-byte the scanned+signed artifact.

---

## 5. Deploy handoff by target

Deploy jobs `needs: build` and consume `needs.build.outputs.{image,digest}`.

### 5.1 Coolify (self-hosted PaaS)

Two options — **webhook trigger** (explicit) or Coolify auto-pull (polls registry).

```yaml
  deploy-coolify:
    needs: build
    if: github.ref == 'refs/heads/main'
    runs-on: ${{ vars.CI_RUNNER || 'ubuntu-latest' }}
    steps:
      - name: Trigger Coolify deploy webhook
        run: |
          curl --fail --silent --show-error -X POST \
            "https://coolify.example.com/api/v1/deploy?uuid=${{ vars.COOLIFY_APP_UUID }}" \
            -H "Authorization: Bearer ${{ secrets.COOLIFY_API_TOKEN }}"
```

For digest-pinned deploys, set the Coolify app's image to the SHA tag before triggering, or
use Coolify "Docker Image" deployment with the digest. See the Coolify docs for app config.

### 5.2 Bare VPS (docker compose, e.g. Hetzner)

```yaml
  deploy-hetzner:
    needs: build
    if: github.ref == 'refs/heads/main'
    runs-on: ${{ vars.CI_RUNNER || 'ubuntu-latest' }}
    steps:
      - name: SSH deploy
        uses: appleboy/ssh-action@v1
        with:
          host: ${{ secrets.HETZNER_HOST }}
          username: deploy
          key: ${{ secrets.HETZNER_SSH_KEY }}          # ed25519 private key, repo secret
          script: |
            cd /opt/app
            echo "${{ secrets.GHCR_PAT }}" | docker login ghcr.io -u my-deploy-bot --password-stdin
            export IMAGE_DIGEST="${{ needs.build.outputs.digest }}"   # consumed by compose
            docker compose pull
            docker compose up -d --remove-orphans
            docker image prune -f
```

Secrets handling: SSH key + GHCR pull token are **repo/org secrets**, never inline. The
remote host logs in to GHCR with a **read-only PAT** (`read:packages`), not the build token.

### 5.3 ECS (ECR registry)

```yaml
  deploy-ecs:
    needs: build
    if: github.ref == 'refs/heads/main'
    runs-on: ${{ vars.CI_RUNNER || 'ubuntu-latest' }}
    permissions:
      id-token: write          # OIDC → AWS, no static keys
      contents: read
    steps:
      - uses: aws-actions/configure-aws-credentials@v4
        with:
          role-to-assume: ${{ secrets.AWS_DEPLOY_ROLE_ARN }}
          aws-region: eu-central-1
      - uses: aws-actions/amazon-ecr-login@v2
      # (Image typically built/pushed to ECR; if built to GHCR, mirror or push to ECR here.)
      - name: Force new deployment
        run: |
          aws ecs update-service \
            --cluster my-prod-cluster \
            --service ${{ vars.ECS_SERVICE }} \
            --force-new-deployment
```

> Task definition / service spec authoring → see the AWS ECS documentation.

### 5.4 ACR / Azure Container Apps

```yaml
  deploy-aca:
    needs: build
    if: github.ref == 'refs/heads/main'
    runs-on: ${{ vars.CI_RUNNER || 'ubuntu-latest' }}
    steps:
      - uses: azure/login@v2
        with:
          creds: ${{ secrets.AZURE_CREDENTIALS }}
      - uses: azure/docker-login@v2
        with:
          login-server: ${{ vars.ACR_LOGIN_SERVER }}
          username: ${{ secrets.ACR_USERNAME }}
          password: ${{ secrets.ACR_PASSWORD }}
      - name: Update Container App
        run: |
          az containerapp update \
            --name ${{ vars.ACA_APP }} \
            --resource-group my-rg \
            --image ${{ vars.ACR_LOGIN_SERVER }}/<repo>@${{ needs.build.outputs.digest }}
```

> Container App env / scaling / ingress spec → see the Azure Container Apps documentation.

---

## 6. Build caching strategies compared

| Backend | Where cache lives | Works on self-hosted? | Speed | Notes |
|---------|-------------------|------------------------|-------|-------|
| `type=gha` | GitHub Actions Cache | yes (cache on GitHub) | medium | ~10 GB/repo quota, aggressive eviction, zero host setup |
| `type=registry` | a registry tag (GHCR) | **yes — best portable** | medium-high | survives runner restarts, shareable across repos, needs `mode=max` for full layers |
| `type=local` | dir on the runner host | yes — **fastest** | high | host-pinned (no value on ephemeral runners), needs prune (§3.4) |
| inline (`type=inline`) | embedded in pushed image | yes | low | only caches final stage, no multi-stage layers — avoid for multi-stage |

Recommendation per runner type:
- **GitHub-hosted (`ubuntu-latest`):** `type=gha` (free, zero setup).
- **Self-hosted buildserver (persistent):** `type=local,dest=/opt/buildcache/<repo>` for max
  speed, or `type=registry` if you want cache shared across multiple buildservers/repos.
- **Mixed (CI_RUNNER fallback in play):** `type=registry` — works identically on both, so the
  same workflow behaves the same whether it lands on `buildserver` or `ubuntu-latest`.

> Cache backend internals + GC → `daemon-server-ops.md` and Docker cache backends docs.

---

## 7. Multi-stage & monorepo matrix builds

### 7.1 Build only what you need with `--target`

```yaml
      - uses: docker/build-push-action@v6
        with:
          context: .
          target: runtime          # skip test/dev stages, build only the runtime stage
          # build args common for bun multi-stage: deps → build → runtime
```

A typical Node.js Dockerfile: `deps` (frozen install) → `build` (`npm run build`) → `runtime`
(slim, copies only `dist` + prod deps). Targeting `runtime` in CI skips dev-only stages.

### 7.2 Parallel matrix builds for a monorepo

Build N images concurrently (one image per service/app):

```yaml
  build-matrix:
    runs-on: ${{ vars.CI_RUNNER || 'ubuntu-latest' }}
    permissions: { contents: read, packages: write, id-token: write }
    strategy:
      fail-fast: false
      matrix:
        app: [api, web, worker]      # apps/<app>/Dockerfile
    steps:
      - uses: actions/checkout@v4
      - uses: docker/setup-qemu-action@v3
      - uses: docker/setup-buildx-action@v3
      - uses: docker/login-action@v3
        with: { registry: ghcr.io, username: ${{ github.actor }}, password: ${{ secrets.GITHUB_TOKEN }} }
      - uses: docker/metadata-action@v5
        id: meta
        with:
          images: ghcr.io/my-org/${{ matrix.app }}
          tags: |
            type=sha,format=long,prefix=
            type=raw,value=latest,enable={{is_default_branch}}
      - uses: docker/build-push-action@v6
        with:
          context: .
          file: apps/${{ matrix.app }}/Dockerfile
          push: ${{ github.event_name != 'pull_request' }}
          load: ${{ github.event_name == 'pull_request' }}
          # Docker can load one platform locally; non-PR builds push a multi-platform index.
          platforms: ${{ github.event_name == 'pull_request' && 'linux/amd64' || 'linux/amd64,linux/arm64' }}
          tags: ${{ steps.meta.outputs.tags }}
          cache-from: type=registry,ref=ghcr.io/my-org/${{ matrix.app }}:buildcache
          cache-to: type=registry,ref=ghcr.io/my-org/${{ matrix.app }}:buildcache,mode=max
```

> **NX monorepo?** Don't hardcode the matrix — derive it from `nx affected --target=docker`
> so only changed apps build (project-graph-driven CI).

---

## 7b. Closing the loop — image ↔ git traceability & rollback

The forward direction (git commit → image) is covered by §4. This section closes the loop:
given a **running container**, get back to the exact commit; and given a **bad deploy**, roll
back to a known-good image. On your own servers this is the difference between a 10-second
"what's running and how do I revert" and a panicked archaeology session.

### 7b.1 Running container → git commit (reverse traceability)

Every image built by §2 carries the commit in an OCI label and is deployed by digest. To find
the commit behind anything running:

```bash
# On the server — what revision is THIS running container?
docker inspect <container> \
  --format '{{index .Config.Labels "org.opencontainers.image.revision"}}'
# → e.g. 5edf2aa1c... (the full git SHA)

# What digest is actually running (survives tag moves)?
docker inspect <container> --format '{{.Image}}'        # local image ID
docker inspect <container> --format '{{index .Config.Image}}'  # the ref it was started from

# Coolify host: find the container first (naming gotcha — see ../SKILL.md)
docker ps --format '{{.Names}}' | grep <service>
```

Then back in the repo:

```bash
git show <sha>                      # what changed in that build
git log --oneline <sha>~5..<sha>    # context around it
git tag --points-at <sha>           # was it a tagged release?
```

**Why this matters:** when you debug a prod issue, the first question is
"which code is actually running?" — not "which code do we *think* is running". The label answers
it definitively, even if `:latest` has moved 5 times since. Make `org.opencontainers.image.revision`
a **required** label in CI (it's in the §2 `metadata-action` config) — without it this whole
section collapses to guesswork.

> Tip: also stamp `org.opencontainers.image.created` and `...source` (repo URL). `metadata-action`
> does this by default with `type=sha` + the `images:` input. Verify with
> `docker inspect --format '{{json .Config.Labels}}' <img> | jq`.

### 7b.2 Rollback runbook (bad deploy → known-good digest)

Because prod deploys reference an immutable **digest** (§4), rollback = redeploy the previous
digest. No rebuild, no git revert needed to stop the bleeding (fix-forward in git comes after).

**Step 1 — find the previous good digest.** Options, fastest first:
```bash
# A) From the registry — list recent tags/digests (GHCR via gh)
gh api /orgs/my-org/packages/container/<repo>/versions \
  --jq '.[0:5] | .[] | {created: .created_at, tags: .metadata.container.tags, digest: .name}'

# B) From git — the previous deploy's SHA is just the prior commit on the deployed branch
git log --oneline -5 origin/main          # pick the last-known-good SHA
# its image: ghcr.io/my-org/<repo>:<that-sha>
docker buildx imagetools inspect ghcr.io/my-org/<repo>:<sha> \
  --format '{{.Manifest.Digest}}'         # resolve to the digest

# C) From the running history (Coolify keeps prior deployments; bare Docker — check your deploy log)
```

**Step 2 — redeploy that digest** (per target):
```bash
# Bare VPS (docker compose): pin the digest and recreate
export IMAGE="ghcr.io/my-org/<repo>@sha256:<previous-digest>"
docker compose pull && docker compose up -d --force-recreate <service>

# Coolify: set the image tag/digest to the previous SHA in the resource, Redeploy
#   (Redeploy, NOT Restart — Restart keeps the same image; see ../SKILL.md gotcha)

# ECS: aws ecs update-service --force-new-deployment with prior task-def revision
# K8s: kubectl rollout undo deployment/<name>   (or set image to prior digest)
```

**Step 3 — verify the rollback actually took:**
```bash
docker inspect <container> \
  --format '{{index .Config.Labels "org.opencontainers.image.revision"}}'
# must now equal the known-good SHA, not the bad one
```

**Step 4 — coordinate, don't cowboy.** In a real incident, the rollback decision belongs to
whoever owns incident response; the deploy mechanics belong to your deploy tooling. The Docker
job is to **identify the target digest and verify the running revision** before and after. Then
the fix-forward goes through normal git (branch → PR → CI → new SHA), never a hand-built image
pushed straight to prod.

**Rollback-ability checklist (verify these BEFORE you need them):**
- [ ] Prod deploys reference `@sha256:...`, not `:latest` (§4)
- [ ] Previous N image versions are retained in the registry (don't let retention GC eat your rollback target — see `registry-management.md` retention policies)
- [ ] `org.opencontainers.image.revision` label present on every image
- [ ] Deploy mechanism can pin an arbitrary digest (Coolify: yes via image ref; compose: yes via `@sha256`)
- [ ] DB migrations are backward-compatible for one release (rolling back the image must not break against the migrated DB — expand/contract pattern)

> The last point is the real trap: rolling back the *container* is trivial, but if the bad release
> ran a destructive migration, the old image won't run against the new schema. Keep migrations
> expand-then-contract so image rollback stays safe — coordinate with whoever owns the database.

### 7b.3 Git release tag → docker release build (the release seam)

Release management (`git tag v*`, changelog, GitHub Release) has one seam with Docker: a release
tag should **trigger a docker release build** so a versioned, signed image exists for that release.

```yaml
# .github/workflows/docker-build-push.yml — trigger block
on:
  push:
    branches: [main]          # main → :sha + :latest (dev convenience)
    tags: ['v*']              # v1.2.3 → :v1.2.3 + :v1.2 + :sha (immutable release image)
```

`metadata-action` then emits semver tags automatically:
```yaml
tags: |
  type=sha,format=long,prefix=          # always — the canonical handle
  type=semver,pattern={{version}}        # v1.2.3 on a git tag
  type=semver,pattern={{major}}.{{minor}} # v1.2 moving pointer
  type=raw,value=latest,enable={{is_default_branch}}
```

So the release flow is: cut `v1.2.3` → push tag → THIS workflow builds the release
image → signed + SBOM'd + pushed → the GitHub Release notes can reference
`ghcr.io/my-org/<repo>:v1.2.3@sha256:...`. The image and the git release are now the
**same artifact, addressable both ways** (by version and by commit). That is the loop, closed.

---

## 8. Gotchas

- **`GITHUB_TOKEN` can't push to GHCR without `packages: write`.** Default token is read-only
  for packages; add `permissions: { packages: write }` at job level or you get
  `denied: installation not allowed to Create organization package`.
- **cosign keyless needs `id-token: write` + Fulcio reachability.** Without `id-token: write`
  the OIDC token request fails (`getting key from Fulcio: ... no token`). It also needs network
  egress to `fulcio.sigstore.dev` + `rekor.sigstore.dev` — on a locked-down buildserver, allow
  those or use key-based signing instead.
- **buildx builder must exist / be selected.** With the default `docker` driver you can't do
  multi-platform or `cache-to`. The `docker/setup-buildx-action` creates a `docker-container`
  builder; if doing it manually on the host: `docker buildx create --use --name ci-builder`.
- **Registry rate limits.** Docker Hub anonymous pulls are rate-limited — base images pulled
  during build can throttle the buildserver. Authenticate to Docker Hub for base-image pulls,
  or mirror bases into GHCR. (GHCR itself has generous limits for org members.)
- **PRs from forks can't access secrets.** `pull_request` from a fork gets no `packages: write`
  and no secrets → build a single-platform image with `load: true` and scan its local tag (as in
  §2). Use `pull_request_target` only
  with extreme care (it runs trusted context against untrusted code).
- **Multi-arch push needs a manifest list, not per-arch tags.** `docker/build-push-action` with
  `platforms:` handles this automatically; doing it by hand requires `buildx imagetools create`.
- **`provenance: true` changes the pushed artifact to an index** — some older registries/runtimes
  choke on attestation manifests. Set `provenance: false` if a target can't pull it.

---

Cross-references:
- `registry-management.md` — GHCR auth, tag/digest semantics, retention, package visibility
- `security-scanning.md` — Trivy/Grype config, SBOM, cosign verify, attestations
- `daemon-server-ops.md` — buildserver disk GC, daemon config, log rotation
- `buildkit-multiplatform.md` — buildx drivers, QEMU internals, multi-arch manifests

Sources: https://docs.docker.com/build/ci/github-actions/, https://github.com/docker/build-push-action, https://github.com/docker/metadata-action, https://github.com/aquasecurity/trivy-action, https://docs.sigstore.dev/cosign/signing/overview/, https://docs.docker.com/build/cache/backends/, https://github.com/opencontainers/image-spec/blob/main/annotations.md
