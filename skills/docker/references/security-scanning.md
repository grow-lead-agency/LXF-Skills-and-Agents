# Container Security, Trivy, cosign, SBOM

## Table of Contents
1. [Security Hardening in Dockerfile](#security-hardening-in-dockerfile)
2. [Linux Capabilities](#linux-capabilities)
3. [Read-only Filesystem](#read-only-filesystem)
4. [Trivy Vulnerability Scanning](#trivy-vulnerability-scanning)
5. [Grype Alternative Scanner](#grype-alternative-scanner)
6. [SBOM Generation (syft)](#sbom-generation-syft)
7. [Docker Scout](#docker-scout)
8. [Image Signing (cosign)](#image-signing-cosign)
9. [Supply Chain Security (SLSA)](#supply-chain-security-slsa)
10. [Docker Content Trust (DCT) Deprecated](#docker-content-trust-dct-deprecated)
11. [Security Checklist](#security-checklist)

---

## Security Hardening in Dockerfile

### Non-root User (mandatory)

```dockerfile
FROM node:22-alpine AS runner

# Alpine: addgroup + adduser
RUN addgroup -g 1001 -S appgroup && \
    adduser -S appuser -u 1001 -G appgroup

# Debian/Ubuntu: useradd
# RUN useradd -r -u 1001 -g appgroup appuser

# Directories the app needs to write to — owned by app user
RUN mkdir -p /app/logs /app/uploads && \
    chown -R appuser:appgroup /app

WORKDIR /app
COPY --from=builder --chown=appuser:appgroup /app/dist ./dist
COPY --from=deps --chown=appuser:appgroup /app/node_modules ./node_modules

USER appuser  # MUST be before CMD/ENTRYPOINT
```

### Minimal Attack Surface

```dockerfile
# Don't install curl/wget in production images unless HEALTHCHECK needs it
# Use nc or /dev/tcp for health checks in distroless/minimal images

# Remove package manager caches
RUN apt-get update && \
    apt-get install -y --no-install-recommends curl && \
    rm -rf /var/lib/apt/lists/*  # always clean up!

# For Alpine:
RUN apk add --no-cache curl
# --no-cache: don't use local cache (no cleanup needed)

# Don't expose unnecessary ports
# EXPOSE 3000  # only expose what's needed
# Don't EXPOSE 22 (SSH), 5432 (postgres), etc.
```

---

## Linux Capabilities

Containers inherit too many capabilities by default. Drop all, add back minimum.

```yaml
# compose.yml
services:
  app:
    cap_drop:
      - ALL  # drop everything first
    cap_add:
      - NET_BIND_SERVICE  # if app binds to port < 1024 (usually not needed)
    # Other common caps to add back:
    # - CHOWN          # if app needs to chown files
    # - SETUID/SETGID  # if app switches users at runtime
    security_opt:
      - no-new-privileges:true  # prevent privilege escalation
    user: "1001:1001"  # explicit UID:GID
```

```bash
# Run with minimal capabilities
docker run \
  --cap-drop ALL \
  --security-opt no-new-privileges \
  --user 1001:1001 \
  myapp:latest
```

**Most web apps need zero capabilities.** Apps that need to bind port 80/443 should
use a reverse proxy (nginx, Caddy, Traefik) instead of binding privileged ports directly.

---

## Read-only Filesystem

```yaml
services:
  app:
    read_only: true  # container filesystem read-only
    tmpfs:
      - /tmp         # writable tmpfs for temp files
      - /var/run     # for PID files, sockets
    volumes:
      - uploads:/app/uploads  # named volume for actual writes
```

```bash
docker run \
  --read-only \
  --tmpfs /tmp \
  myapp:latest
```

**Test your app with read-only:** Most apps fail because they write to unexpected places.
Common write locations: `/tmp`, `/var/run`, `/home/user/.config`.

---

## Trivy Vulnerability Scanning

Trivy is the industry-standard scanner. Scans OS packages + language deps (npm, pip, go).

### Installation

```bash
# macOS
brew install trivy

# Docker (no install)
docker run --rm -v /var/run/docker.sock:/var/run/docker.sock \
  aquasec/trivy:latest image myapp:latest

# CI — use action
```

### Basic Scanning

```bash
# Scan local image
trivy image myapp:latest

# Scan with severity filter
trivy image --severity HIGH,CRITICAL myapp:latest

# Scan and fail CI on CRITICAL
trivy image --exit-code 1 --severity CRITICAL myapp:latest

# Scan a specific Dockerfile (config scan)
trivy config Dockerfile

# Scan docker-compose.yml
trivy config compose.yml

# Scan filesystem (for dev)
trivy fs .

# Scan git repo
trivy repo https://github.com/myorg/myapp
```

### Output Formats

```bash
# JSON (for processing)
trivy image --format json --output trivy-report.json myapp:latest

# SARIF (for GitHub Code Scanning)
trivy image --format sarif --output trivy.sarif myapp:latest

# Table (default, human-readable)
trivy image --format table myapp:latest

# Template
trivy image --format template --template '@/contrib/html.tpl' \
  --output report.html myapp:latest
```

### Ignoring Known False Positives

```yaml
# .trivyignore (in repo root)
# CVE-YYYY-NNNNN  # reason for ignoring

# Example:
CVE-2023-45853    # zlib issue, only affects use of compress() — we don't use it
CVE-2024-12345    # not applicable — we don't use X feature

# Or in trivy.yaml config:
# vulnerability:
#   ignore-unfixed: true  # ignore CVEs without a fix
```

```yaml
# .trivy.yaml
scan:
  # Ignore unfixed vulnerabilities (can't update until base image is fixed)
  ignore-unfixed: true
severity:
  - HIGH
  - CRITICAL
```

### GitHub Actions Integration

```yaml
- name: Run Trivy vulnerability scanner
  uses: aquasecurity/trivy-action@master
  with:
    image-ref: ghcr.io/${{ github.repository }}:${{ github.sha }}
    format: sarif
    output: trivy-results.sarif
    exit-code: '1'
    ignore-unfixed: true
    severity: 'CRITICAL,HIGH'

- name: Upload Trivy scan results to GitHub Security tab
  uses: github/codeql-action/upload-sarif@v3
  if: always()
  with:
    sarif_file: trivy-results.sarif
```

---

## Grype Alternative Scanner

Grype by Anchore. Good for SBOM-based scanning.

```bash
# Install
brew install grype

# Scan image
grype myapp:latest

# Scan SBOM (see syft below)
grype sbom:myapp-sbom.json

# Fail on CRITICAL
grype myapp:latest --fail-on critical
```

---

## SBOM Generation (syft)

SBOM (Software Bill of Materials) — inventory of every package in your image.
Required by: SLSA, some enterprise security policies, supply chain audits.

```bash
# Install syft
brew install syft

# Generate SBOM for image
syft myapp:latest -o spdx-json=sbom.spdx.json
syft myapp:latest -o cyclonedx-json=sbom.cyclonedx.json
syft myapp:latest -o table  # human-readable

# Generate SBOM for directory
syft dir:. -o spdx-json=sbom.spdx.json

# Scan SBOM with grype
grype sbom:sbom.spdx.json
```

### Attach SBOM to Image (attest)

```bash
# Generate and attach SBOM attestation via cosign (see next section)
syft myapp:latest -o spdx-json > sbom.spdx.json

cosign attest --predicate sbom.spdx.json \
  --type spdxjson \
  --key cosign.key \
  ghcr.io/myorg/myapp:latest
```

---

## Docker Scout

Docker's own first-party supply-chain security product. Unlike Trivy/Grype (OSS scanners),
Scout is an **integrated service + platform**: it builds an SBOM, matches it against a
continuously-updated CVE database, evaluates **org policies**, and gives **actionable
remediation** — most notably **base-image bump suggestions**. It plugs into Docker
Desktop, Docker Hub, the Scout Dashboard, registries, and CI. The local CLI
(`docker scout ...`) works standalone after `docker login`.

### What it is vs Trivy / Grype

| | Docker Scout | Trivy / Grype |
|---|---|---|
| Vendor | First-party (Docker) | OSS (Aqua / Anchore) |
| Account | Docker account / `docker login` required | None — fully offline-capable |
| SBOM + CVE | Yes (continuously refreshed DB) | Yes |
| Base-image bump recommendations | **Yes (killer feature)** | No |
| Image-to-image comparison (diff CVEs) | **Yes (`compare`)** | No native diff |
| Org policy engine + gating | **Yes** | Trivy has policy/config scan, no managed org policies |
| Hub / registry / Dashboard integration | Yes | No |
| IaC / secrets / license scanning | Limited | **Trivy broad** (IaC, secrets, licenses, K8s) |
| Cost | Free tier limited (see gotcha) | Free / OSS |

**Bottom line: use both, not either/or.** Keep **Trivy as the free CI gate** (no account,
broad coverage — wire it into CI yourself), and add **Scout for the
recommendations / `compare` UX and base-image suggestions** (locally + on PRs).

### Installation

Scout ships with recent Docker Desktop / Docker Engine. Standalone install:

```bash
# Install the CLI plugin
curl -fsSL https://raw.githubusercontent.com/docker/scout-cli/main/install.sh | sh -s --

docker scout version
docker login   # most features need a Docker account
```

### Key Commands

```bash
# Quick overview: vulnerabilities, base image, recommendations, policy status
docker scout quickview myapp:latest
docker scout quickview            # no arg → most recently built image

# CVEs — full vulnerability listing
docker scout cves myapp:latest
docker scout cves --only-severity critical,high myapp:latest
docker scout cves --only-fixed myapp:latest          # only CVEs with a fix
docker scout cves --ignore-base myapp:latest         # exclude base-image CVEs
docker scout cves --format sarif --output scout.sarif myapp:latest  # GitHub code scanning
docker scout cves --format markdown myapp:latest     # also: packages (default), spdx, gitlab, sbom
docker scout cves --only-cisa-kev myapp:latest       # only CISA Known-Exploited CVEs
docker scout cves --epss --epss-score 0.5 myapp:latest  # filter by exploit-prediction score
docker scout cves -e --only-severity critical myapp:latest  # --exit-code → exit 2 if found (CI gate)

# Recommendations — base image bumps + remediation (the standout feature)
docker scout recommendations myapp:latest
docker scout recommendations --only-update myapp:latest   # only version updates
docker scout recommendations --only-refresh myapp:latest  # only rebuild-on-same-tag refresh

# Compare two images — diff vulnerabilities/packages between versions/tags
docker scout compare --to myorg/myapp:latest myorg/myapp:v2     # (alias: docker scout diff)
docker scout compare local://myorg/myapp:latest --to registry://myorg/myapp:latest
docker scout compare --ignore-unchanged --only-severity critical,high --to myorg/myapp:prod myorg/myapp:pr-123

# SBOM
docker scout sbom myapp:latest
docker scout sbom --format spdx --output sbom.spdx.json myapp:latest

# Policy — evaluate org policies against an image (experimental)
docker scout policy myorg/myapp:latest --org myorg
```

The `image://` prefix is the default; you can also point Scout at other artifacts via
`local://`, `registry://`, `oci-dir://`, `archive://` (a `docker save` tarball),
`fs://` (a directory/file), or `sbom://` (an existing SPDX/syft SBOM — lets Scout
re-use a syft SBOM instead of re-indexing).

### Enabling Scout on a Repository

The CLI works locally on any image without enabling anything. To get **continuous
analysis** of pushed images (Dashboard, PR policy results, automated base-image PRs):

```bash
docker login
docker scout enroll myorg                      # enroll the org once
docker scout repo enable --org myorg myorg/myapp   # enable analysis for a repo
docker scout config organization myorg         # set default org for policy/compare
```

You can also enable repos from **Docker Hub** (repo → *Docker Scout* tab) or the
**Scout Dashboard** (`scout.docker.com`).

### Policy Evaluation & Gating

Policies are org-level, customizable rules that gate whether an image is "compliant".
Out-of-the-box policies include: **No fixable critical or high vulnerabilities**,
**Default non-root user**, **No outdated base images**, **No copyleft licenses**,
**No high-profile vulnerabilities (CISA KEV / known-exploited)**, **Supply chain
attestations** (provenance + SBOM present). `quickview` shows a roll-up:

```text
Policy status  FAILED  (2/6 policies met, 2 missing data)
  ✓  No copyleft licenses
  !  Default non-root user                        ← violated
  !  No fixable critical or high vulnerabilities    2C  16H
  ✓  No high-profile vulnerabilities
  ?  No outdated base images                       ← no data (needs provenance attestation)
  ?  Supply chain attestations
```

`?` = not enough metadata — add provenance + SBOM attestations at build time
(`docker build --provenance=true --sbom=true ...`, requires the containerd image store)
so policies like *outdated base images* can evaluate. Gating in CI is done with
`--exit-code` (cves) or `--exit-on vulnerability,policy` (compare).

### GitHub Actions Integration (`docker/scout-action`)

Sits **alongside** your Trivy CI step — Trivy stays the hard
pass/fail gate; Scout adds the PR-comment UX, base-image recommendations, and version
comparison. The action runs any of `quickview`, `cves`, `recommendations`, `compare`,
`sbom`, `environment`, `attestation-add` (comma-separate to run several in order).

```yaml
# On a PR: compare the new image against production, comment the diff, gate on regressions
- name: Authenticate to Docker Hub
  uses: docker/login-action@v4
  with:
    username: ${{ secrets.DOCKER_USER }}
    password: ${{ secrets.DOCKER_PAT }}

- name: Docker Scout
  if: ${{ github.event_name == 'pull_request' }}
  uses: docker/scout-action@v1
  with:
    command: cves,recommendations,compare
    image: ${{ steps.meta.outputs.tags }}
    to-latest: true                 # or: to-env: production
    ignore-base: true
    ignore-unchanged: true
    only-severities: critical,high
    exit-on: vulnerability,policy    # fail the step on new CVEs or policy regressions
    write-comment: true              # PR comment (needs pull-requests: write)
    github-token: ${{ secrets.GITHUB_TOKEN }}

# Optional: upload Scout CVEs to GitHub code scanning (same Security tab as Trivy)
- name: Scout CVEs → SARIF
  uses: docker/scout-action@v1
  with:
    command: cves
    image: ${{ steps.meta.outputs.tags }}
    sarif-file: scout.sarif.json
- uses: github/codeql-action/upload-sarif@v3
  with:
    sarif_file: scout.sarif.json
```

> Note: `compare`/`to-env`/`to-latest` require the image to be in the runner's local
> image store (use `load: true` on `build-push-action` for PRs), and an `organization`.

### When Scout vs Trivy

- **Trivy** — the free, no-account, CI-friendly gate. Broad coverage (OS + lang deps +
  **IaC, secrets, licenses, K8s manifests**). Use it as the standing CI scanner and authoritative pass/fail gate. Best when you want zero external dependencies.
- **Scout** — best **developer UX** for "what should I bump?": base-image update
  recommendations, `compare` between tags/versions, Hub/Dashboard rollups, managed org
  policies, PR comments. Great locally (`docker scout quickview`) and as an *additive*
  PR step.
- **Recommendation:** run **both**. Trivy gates the pipeline (free, broad); Scout drives
  remediation and base-image hygiene.

### Gotchas

- **Free tier is limited.** Docker **Personal ($0)** includes Scout for a small number
  of enabled repos (historically ~3 Scout-enabled repos / "local analysis is unlimited");
  full continuous analysis, more repos, and team features need a paid Docker plan
  (Team/Business). **Verify current limits at `docker.com/pricing`** before relying on it
  org-wide.
- **Needs a Docker account.** Most non-trivial features require `docker login`; CI needs
  `DOCKER_USER` + a PAT. Trivy needs none.
- **Some features are Desktop/Hub-bound.** The Dashboard, automated base-image PRs, and
  registry-wide continuous analysis live behind Docker Hub / the Scout Dashboard, not the
  bare CLI. `compare`, `policy`, `environment`, `stream` are still marked **experimental**.
- **Policy "No data" results** mean the image lacks provenance/SBOM attestations — build
  with `--provenance=true --sbom=true` (containerd image store) to get full evaluation.

---

## Image Signing (cosign)

cosign signs container images — proves the image came from your CI, not a third party.

### Installation

```bash
brew install cosign
```

### Keyless Signing (GitHub Actions — recommended)

No keys needed — uses GitHub's OIDC token.

```yaml
- name: Install cosign
  uses: sigstore/cosign-installer@v3

- name: Sign image
  run: |
    cosign sign --yes ghcr.io/${{ github.repository }}:${{ github.sha }}
  env:
    COSIGN_EXPERIMENTAL: 1  # keyless mode
```

### Key-based Signing

```bash
# Generate key pair
cosign generate-key-pair
# Creates: cosign.key (private, keep secret) + cosign.pub (public, share)

# Sign image
cosign sign --key cosign.key ghcr.io/myorg/myapp:latest

# Verify signature
cosign verify --key cosign.pub ghcr.io/myorg/myapp:latest

# Sign with annotations
cosign sign --key cosign.key \
  -a "git-commit=$(git rev-parse HEAD)" \
  -a "build-date=$(date -u +'%Y-%m-%dT%H:%M:%SZ')" \
  ghcr.io/myorg/myapp:latest
```

### Verify in Kubernetes (policy controller)

```yaml
# Policy: only allow images signed by our key
apiVersion: policy.sigstore.dev/v1alpha1
kind: ClusterImagePolicy
metadata:
  name: signed-images-only
spec:
  images:
    - glob: "ghcr.io/myorg/**"
  authorities:
    - key:
        data: |
          -----BEGIN PUBLIC KEY-----
          ... cosign.pub content ...
          -----END PUBLIC KEY-----
```

---

## Supply Chain Security (SLSA)

SLSA (Supply-chain Levels for Software Artifacts) is a framework for build provenance.
Level 2 = provenance generated by hosted build system (GitHub Actions, etc.).

```yaml
# Generate SLSA provenance with GitHub Actions
- uses: slsa-framework/slsa-github-generator/.github/workflows/container_generator.yml@v2
  with:
    image: ghcr.io/${{ github.repository }}
    digest: ${{ steps.build.outputs.digest }}
    registry-username: ${{ github.actor }}
    registry-password: ${{ secrets.GITHUB_TOKEN }}
```

---

## Docker Content Trust (DCT) Deprecated

**DEPRECATED — do not use for new work.** DCT is built on The Update Framework (TUF)
and the **Notary v1** project, whose upstream codebase is effectively unmaintained.
Docker officially announced retirement of Docker Content Trust (blog, Jul 2025), and
registries are following suit (e.g. Azure Container Registry retires DCT on 2028-03-31).
There is no reason to start a new project on DCT.

**Use instead:**
- **cosign (Sigstore)** — the de-facto standard for OCI image signing today (keyless
  via OIDC, transparency log, attestations). This is what the rest of this doc uses
  (see [Image Signing (cosign)](#image-signing-cosign)).
- **Notation / Notary Project (a.k.a. Notary v2)** — the CNCF successor to Notary v1,
  if you specifically need the Notary-style trust model (`notation sign` / `notation verify`,
  trust policies). Prefer cosign for most workloads.

```bash
# DCT (legacy — shown for migration/awareness only, NOT recommended)
export DOCKER_CONTENT_TRUST=1
docker push myregistry/myapp:latest   # signs automatically via Notary v1
docker pull myregistry/myapp:latest   # fails if not signed

# Migrate: re-sign existing images with cosign instead
cosign sign --yes ghcr.io/myorg/myapp:latest
```

---

## Security Checklist

### Dockerfile Security
- [ ] Non-root user (UID 1001 or custom)
- [ ] `USER` instruction before `CMD`/`ENTRYPOINT`
- [ ] No secrets in `ENV`, `ARG`, or `COPY`
- [ ] Secrets via `--mount=type=secret` only
- [ ] `--no-install-recommends` or `--no-cache` for package installs
- [ ] `/var/lib/apt/lists/*` cleaned after apt-get
- [ ] Minimal base image (Alpine, distroless, or Chainguard)
- [ ] Multi-stage: no build tools in final image
- [ ] HEALTHCHECK defined
- [ ] `# syntax=docker/dockerfile:1` at top

### Runtime Security (Compose / docker run)
- [ ] `cap_drop: [ALL]`
- [ ] `security_opt: [no-new-privileges:true]`
- [ ] `read_only: true` where possible
- [ ] `tmpfs` for writable temp directories
- [ ] Named volumes, not bind mounts, for persistent data in prod
- [ ] Resource limits (`mem_limit`, `cpus`)
- [ ] Ports bound to `127.0.0.1` if reverse proxy handles external

### CI/CD Security
- [ ] `trivy image` scan — fail on CRITICAL (free CI gate)
- [ ] `docker scout` (optional) — PR comment + base-image recommendations + `compare`
- [ ] SBOM generated and attached
- [ ] Image signed with cosign
- [ ] Image tagged with git SHA (immutable)
- [ ] No `latest` tag as sole reference in prod
- [ ] Registry with private access (GHCR + token auth)
- [ ] `.trivyignore` for documented false positives

### Supply Chain
- [ ] Base image pinned to specific digest:
  `FROM node@sha256:abc123...` (not just `:latest`)
- [ ] Lockfile committed (package-lock.json)
- [ ] No `curl | sh` in Dockerfile (installs unverified scripts)
- [ ] Verify checksums for external downloads


## Sources

- https://docs.docker.com/scout/
- https://docs.docker.com/reference/cli/docker/scout/
- https://docs.docker.com/scout/quickstart/
- https://docs.docker.com/reference/cli/docker/scout/cves/
- https://docs.docker.com/reference/cli/docker/scout/compare/
- https://docs.docker.com/scout/policy/
- https://docs.docker.com/scout/integrations/ci/gha/
- https://github.com/docker/scout-action
- https://www.docker.com/blog/retiring-docker-content-trust/
- https://www.docker.com/pricing/
