# Container Registry Management — GHCR, ECR, ACR, Docker Hub, Harbor

Platform-agnostic registry playbook for a typical small-team stack: Node.js images built on a
self-hosted GitHub Actions buildserver, deployed to a VPS via Coolify. Default registry is
**GHCR**; ECR/ACR/Harbor/Docker Hub are covered for client work and
fallback. Sibling refs: [`security-scanning.md`](./security-scanning.md) (cosign keys, SBOM,
Trivy), [`cicd-git-bridge.md`](./cicd-git-bridge.md) (CI push from buildserver),
[`daemon-server-ops.md`](./daemon-server-ops.md) (registry mirror in `daemon.json`).

## Table of Contents
1. [Registry Comparison](#comparison)
2. [Authentication per Registry](#auth)
3. [Push/Pull — Immutable git-SHA Tagging + Digest Pinning](#pushpull)
4. [Multi-arch Manifest Lists](#multiarch)
5. [Retention / Cleanup Policies](#retention)
6. [Image Signing & Verification (cosign)](#cosign)
7. [Self-hosted Registry on a VPS](#selfhosted)
8. [Gotchas — Rate Limits, Mirrors, Throttling](#gotchas)

---

## <a id="comparison"></a>1. Registry Comparison

| Registry | Cost | Auth method | Retention features | When to use |
|----------|------|-------------|--------------------|-------------|
| **GHCR** (`ghcr.io`) | Free for public; private free within GitHub plan storage/transfer | PAT (`CR_PAT`, scope `write:packages`) or Actions `GITHUB_TOKEN` | API delete + `actions/delete-package-versions` (no native lifecycle UI) | **Default.** Your GitHub org, CI on buildserver, keyless cosign via OIDC |
| **AWS ECR** | ~$0.10/GB-month storage + egress | `aws ecr get-login-password` (12h token) | Native **lifecycle policies** (JSON, by count/age/tag-prefix) | Client runs on AWS (ECS/EKS/Lambda), needs IAM-scoped pull, VPC-private |
| **Azure ACR** | Basic $0.167/day, Standard $0.667/day, Premium $1.667/day | `az acr login` / token / service principal | Premium **retention policy** + `acr purge` tasks | Client on Azure (AKS/Container Apps), geo-replication, ACR Tasks builds |
| **Docker Hub** | Free 1 private repo; Pro/Team paid; **pull rate limits** | `docker login` (PAT recommended over password) | Paid auto-delete by inactivity | Public OSS images, base-image pulls (mirror it — see gotchas) |
| **Harbor** (self-hosted) | Server cost only (small VPS) | Robot accounts, OIDC, basic auth | **Tag retention rules** + immutability + GC | Full control, air-gapped/EU-residency, built-in Trivy + signing, projects/RBAC |
| **registry:2** (self-hosted) | Server cost only | htpasswd / token | Manual `garbage-collect` only | Minimal private registry, internal mirror, no UI/RBAC needed |

Rule of thumb: **GHCR unless the deploy target's IAM/network forces ECR/ACR, or the client demands
self-hosted EU residency → Harbor.**

---

## <a id="auth"></a>2. Authentication per Registry

### GHCR (default)
```bash
# PAT in env (classic PAT with write:packages, or fine-grained with Packages: RW).
# Store in your secrets manager as CR_PAT, NEVER commit.
echo "$CR_PAT" | docker login ghcr.io -u your-github-username --password-stdin

# Pull-only on a VPS / Coolify: use a read-only fine-grained token.
echo "$GHCR_PULL_TOKEN" | docker login ghcr.io -u my-org --password-stdin
```
In GitHub Actions (buildserver), prefer the ephemeral `GITHUB_TOKEN` — no PAT needed:
```yaml
permissions:
  contents: read
  packages: write          # required to push to GHCR
  id-token: write          # required for keyless cosign (see §6)
steps:
  - uses: docker/login-action@v3
    with:
      registry: ghcr.io
      username: ${{ github.actor }}
      password: ${{ secrets.GITHUB_TOKEN }}
```
> Make the image public/visible to the org under **Org → Packages → package → Settings →
> Manage Actions access** so Coolify can pull, or give Coolify a read-only PAT.

### AWS ECR
```bash
ACCOUNT=123456789012
REGION=eu-central-1
REGISTRY="$ACCOUNT.dkr.ecr.$REGION.amazonaws.com"

aws ecr get-login-password --region "$REGION" \
  | docker login --username AWS --password-stdin "$REGISTRY"   # token valid 12h

# ECR repos must EXIST before push (no auto-create — see gotchas):
aws ecr create-repository \
  --repository-name my-org/myapp \
  --region "$REGION" \
  --image-scanning-configuration scanOnPush=true \
  --image-tag-mutability IMMUTABLE          # blocks tag overwrite — pairs with git-SHA tags
```
Attach a lifecycle policy at creation or after (full JSON in §5):
```bash
aws ecr put-lifecycle-policy --repository-name my-org/myapp \
  --region "$REGION" --lifecycle-policy-text file://ecr-lifecycle.json
```

### Azure ACR
```bash
REG=myacr     # ACR name (no .azurecr.io); login server is $REG.azurecr.io

# (a) Interactive / dev — uses your az credentials, no admin user needed:
az acr login --name "$REG"

# (b) CI / non-interactive — scoped token (preferred over admin user):
az acr token create --name ci-push --registry "$REG" \
  --scope-map _repositories_push --output json
docker login "$REG.azurecr.io" -u ci-push -p "$TOKEN_PASSWORD"

# (c) Service principal (cross-tenant CI, Terraform):
docker login "$REG.azurecr.io" -u "$SP_APP_ID" -p "$SP_PASSWORD"

# Admin user (quick start ONLY — single shared cred, disable for prod):
az acr update --name "$REG" --admin-enabled false
```

### Harbor (self-hosted)
```bash
# Robot accounts = per-project machine creds (revocable, no human SSO). Create in
# Harbor UI → Project → Robot Accounts, or via API. Username is prefixed 'robot$'.
docker login harbor.example.com -u 'robot$myproject+ci' -p "$HARBOR_ROBOT_SECRET"

# Projects namespace images: harbor.example.com/<project>/<repo>:<tag>
# Use a per-project robot with push on CI, a separate pull-only robot on the deploy host.
```

---

## <a id="pushpull"></a>3. Push/Pull — Immutable git-SHA Tagging + Digest Pinning

**NEVER deploy `:latest` to production.** `:latest` is mutable → non-reproducible rollbacks and
silent drift. Tag every build with the immutable git SHA; optionally add a moving `:staging` /
`:edge` convenience tag for non-prod only.

```bash
IMAGE=ghcr.io/my-org/myapp
SHA=$(git rev-parse --short=12 HEAD)

docker build -t "$IMAGE:$SHA" .
docker push "$IMAGE:$SHA"

# Optional convenience tags (NOT for prod deploy targets):
docker tag "$IMAGE:$SHA" "$IMAGE:edge"
docker push "$IMAGE:edge"
```

**Digest pinning** — the strongest guarantee. A digest (`@sha256:...`) is content-addressed and
cannot be moved. Pin deploy manifests / Coolify image to the digest, not the tag:
```bash
# Resolve a tag to its immutable digest:
docker buildx imagetools inspect "$IMAGE:$SHA" --format '{{json .Manifest.Digest}}'
# or after push, capture from the push output / inspect:
DIGEST=$(docker buildx imagetools inspect "$IMAGE:$SHA" --format '{{ .Manifest.Digest }}')
echo "$IMAGE@$DIGEST"          # ghcr.io/my-org/myapp@sha256:abc123...

# Coolify: set the image field to the FULL digest reference for prod releases.
# Base images in Dockerfile should also be digest-pinned for reproducibility:
#   FROM oven/bun:1-slim@sha256:<digest>
```
Inspect a remote image without pulling it (size, layers, platforms, config):
```bash
docker buildx imagetools inspect "$IMAGE:$SHA"
docker buildx imagetools inspect "$IMAGE:$SHA" --raw      # raw manifest JSON
```

---

## <a id="multiarch"></a>4. Multi-arch Manifest Lists

ARM (e.g. Ampere-based VPS) and x86 servers often coexist in a fleet, so ship **both
`linux/amd64` + `linux/arm64`**. `buildx --push` builds per-arch images and publishes a single
**manifest list** (OCI image index) under one tag — the daemon pulls the matching arch automatically.

```bash
# One-time: create a builder with the docker-container driver (enables multi-platform).
docker buildx create --name ci-builder --driver docker-container --use
docker buildx inspect --bootstrap

# Build + push a manifest list in one shot (must --push; local docker can't store multi-arch):
docker buildx build \
  --platform linux/amd64,linux/arm64 \
  -t "$IMAGE:$SHA" \
  --provenance=true --sbom=true \
  --push .
```
Inspect the manifest list and confirm both platforms are present:
```bash
docker buildx imagetools inspect "$IMAGE:$SHA"
# Look for:
#   Manifests:
#     Platform:  linux/amd64
#     Platform:  linux/arm64
```
Pull a specific platform explicitly (debugging arch mismatch):
```bash
docker pull --platform linux/arm64 "$IMAGE:$SHA"
```
> See [`buildkit-multiplatform.md`](./buildkit-multiplatform.md) for QEMU emulation vs native
> ARM runners and cache-mount tuning for bun installs.

---

## <a id="retention"></a>5. Retention / Cleanup Policies

Registries fill up: every CI push of a multi-arch image with SBOM/provenance adds several
artifacts. Untagged digests pile up, private storage costs rise, and Docker Hub hits repo limits.
**Automate cleanup per registry.**

### GHCR — no native lifecycle; use API + Action
In CI, after a successful push, prune old versions of the package (keep last N, never delete
the just-pushed SHA or `:latest`):
```yaml
- uses: actions/delete-package-versions@v5
  with:
    package-name: myapp
    package-type: container
    min-versions-to-keep: 15
    delete-only-untagged-versions: true      # safest: nuke dangling digests only
    token: ${{ secrets.CR_PAT }}             # GITHUB_TOKEN can't delete org packages
```
Manual API prune (untagged versions of an org package):
```bash
gh api -X GET "/orgs/my-org/packages/container/myapp/versions" --paginate \
  | jq -r '.[] | select(.metadata.container.tags | length == 0) | .id' \
  | while read -r id; do
      gh api -X DELETE "/orgs/my-org/packages/container/myapp/versions/$id"
    done
```

### AWS ECR — native lifecycle policy (`ecr-lifecycle.json`)
```json
{
  "rules": [
    {
      "rulePriority": 1,
      "description": "Expire untagged after 7 days",
      "selection": {
        "tagStatus": "untagged",
        "countType": "sinceImagePushed",
        "countUnit": "days",
        "countNumber": 7
      },
      "action": { "type": "expire" }
    },
    {
      "rulePriority": 2,
      "description": "Keep only last 20 tagged 'sha-' images",
      "selection": {
        "tagStatus": "tagged",
        "tagPrefixList": ["sha-"],
        "countType": "imageCountMoreThan",
        "countNumber": 20
      },
      "action": { "type": "expire" }
    }
  ]
}
```
```bash
aws ecr put-lifecycle-policy --repository-name my-org/myapp \
  --region eu-central-1 --lifecycle-policy-text file://ecr-lifecycle.json
# Dry-run preview which images a policy would delete:
aws ecr start-lifecycle-policy-preview --repository-name my-org/myapp --region eu-central-1
```

### Azure ACR — purge task (Standard) / retention policy (Premium)
```bash
# Scheduled purge via ACR Task (works on Basic/Standard). Deletes tags older than 30d,
# keeps newest 10, removes resulting dangling manifests:
az acr task create --name purge-old --registry myacr --cmd \
  "acr purge --filter 'myapp:.*' --ago 30d --keep 10 --untagged" \
  --schedule "0 3 * * *" --context /dev/null

# Premium SKU only — declarative untagged retention:
az acr config retention update --registry myacr --status enabled --days 7 --type UntaggedManifests
```

### Harbor — tag retention + immutability + GC
- Project → **Tag Retention**: e.g. "retain most recent 10 tags matching `**`" on a daily cron.
- Project → **Tag Immutability**: lock `sha-*` so they can't be overwritten/deleted.
- Retention only *marks* manifests; reclaim disk with **garbage collection**
  (UI → Administration → Garbage Collection, or API). GC needs registry read-only briefly.

### registry:2 — manual garbage collection
```bash
# Deleting a tag/manifest only removes the reference; blobs persist until GC.
docker exec -it registry bin/registry garbage-collect /etc/docker/registry/config.yml \
  --delete-untagged
```

---

## <a id="cosign"></a>6. Image Signing & Verification (cosign)

Sign images so deploy targets can verify provenance. Pairs with SBOM/attestation in
[`security-scanning.md`](./security-scanning.md). Two modes:

### Keyless (OIDC) — preferred in GitHub Actions
No private key to manage; identity comes from the workflow's OIDC token, signature + cert logged
to the Rekor transparency log. Requires `id-token: write` (see §2).
```yaml
- uses: sigstore/cosign-installer@v3
- name: Sign image (keyless)
  env:
    COSIGN_EXPERIMENTAL: "1"
  run: |
    cosign sign --yes \
      "ghcr.io/my-org/myapp@${{ steps.build.outputs.digest }}"
```
Verify (anywhere — Coolify pre-pull hook, admission policy, local), asserting the signing
workflow identity:
```bash
cosign verify \
  --certificate-identity-regexp "https://github.com/my-org/.+/.github/workflows/.+@.+" \
  --certificate-oidc-issuer "https://token.actions.githubusercontent.com" \
  ghcr.io/my-org/myapp@sha256:abc123...
```

### Key-based — registries without OIDC plumbing (ECR/ACR/Harbor robots)
```bash
cosign generate-key-pair          # cosign.key (secret → secrets manager / KMS), cosign.pub (commit)
echo "$COSIGN_PASSWORD" | cosign sign --key cosign.key "$IMAGE@$DIGEST"
cosign verify --key cosign.pub "$IMAGE@$DIGEST"
```
> **Always sign the digest, not a tag** — signing `:latest` is meaningless (tag can move).
> Harbor can enforce signature presence per project (Deployment Security → Cosign).

---

## <a id="selfhosted"></a>7. Self-hosted Registry on a VPS

For EU residency / air-gapped / cost control. **Harbor** when you want UI + RBAC + Trivy +
retention; **registry:2** for a minimal private mirror.

### Minimal `registry:2` via Docker Compose (TLS + htpasswd)
```yaml
# docker-compose.yml — front with Caddy/Traefik for TLS, or terminate at Coolify/CF Tunnel.
services:
  registry:
    image: registry:2
    restart: unless-stopped
    ports: ["5000:5000"]
    environment:
      REGISTRY_AUTH: htpasswd
      REGISTRY_AUTH_HTPASSWD_REALM: "Private Registry"
      REGISTRY_AUTH_HTPASSWD_PATH: /auth/htpasswd
      REGISTRY_STORAGE_DELETE_ENABLED: "true"   # required for GC to reclaim
    volumes:
      - registry-data:/var/lib/registry         # external:true in prod (see networking-volumes.md)
      - ./auth:/auth:ro
volumes:
  registry-data:
```
```bash
# Generate auth (bcrypt). Keep htpasswd file OUT of git.
docker run --rm --entrypoint htpasswd httpd:2 -Bbn ci "$REGISTRY_PASS" > auth/htpasswd

# Behind TLS (Coolify/Traefik gives a cert for registry.example.com):
echo "$REGISTRY_PASS" | docker login registry.example.com -u ci --password-stdin
docker tag myapp:$SHA registry.example.com/myapp:$SHA
docker push registry.example.com/myapp:$SHA
```
Garbage collection (registry must be read-only during GC):
```bash
docker exec -it registry bin/registry garbage-collect \
  /etc/docker/registry/config.yml --delete-untagged
```
Backup: snapshot the `registry-data` volume (it's just blobs + metadata):
```bash
docker run --rm -v registry-data:/data -v "$PWD":/backup alpine \
  tar czf /backup/registry-$(date +%F).tar.gz -C /data .
```

### Harbor on a VPS (recommended for client-facing self-hosted)
Use the official online installer (Docker Compose under the hood). Deploy on a mid-size VPS,
front with Coolify/Traefik for TLS on `harbor.example.com`:
```bash
curl -sLO https://github.com/goharbor/harbor/releases/latest/download/harbor-online-installer.tgz
tar xzf harbor-online-installer.tgz && cd harbor
cp harbor.yml.tmpl harbor.yml
# Edit harbor.yml: hostname, https.certificate/private_key (or external_url + terminate TLS upstream),
# harbor_admin_password, data_volume.
sudo ./install.sh --with-trivy        # built-in vuln scanning
```
Harbor gives projects (RBAC namespaces), robot accounts (§2), tag retention/immutability (§5),
Trivy scan-on-push, and cosign verification gates — most of this file's manual steps as policy.

---

## <a id="gotchas"></a>8. Gotchas — Rate Limits, Mirrors, Throttling

- **Docker Hub pull rate limits.** Anonymous: **100 pulls / 6h per IP**; authenticated free:
  **200 / 6h**. A shared VPS egress IP + CI churn = `429 Too Many Requests / toomanyrequests`
  mid-build. Mitigations:
  1. Push your own base images to **GHCR / Harbor** and `FROM` those.
  2. Configure a **pull-through cache mirror** in `daemon.json` so base-image pulls go through your
     own registry — see [`daemon-server-ops.md`](./daemon-server-ops.md):
     ```json
     { "registry-mirrors": ["https://registry.example.com"] }
     ```
     (mirror only affects Docker Hub / `docker.io` pulls; GHCR/ECR/ACR are pulled directly).
  3. Authenticate even for public pulls (`docker login docker.io`) to get the 200 tier.
- **`registry-mirrors` is Docker Hub-only.** Mirrors do not proxy GHCR/ECR/ACR. For those, run a
  `registry:2` configured as a remote proxy (`proxy.remoteurl`) or Harbor proxy-cache project.
- **ECR: repo must exist before push.** Unlike GHCR/Hub, ECR does **not** auto-create on push —
  `name unknown` / `repository does not exist`. Run `aws ecr create-repository` first (§2), or add
  a CI step that creates-if-missing.
- **ECR login token expires after 12h.** Long-lived self-hosted runners must re-run
  `get-login-password` per job, not once at boot.
- **ACR throttling.** ACR enforces read/write/delete operation quotas per minute (tighter on
  Basic/Standard). Bursty parallel CI matrix builds get `429 TooManyRequests` — back off, batch
  manifest pushes, or bump SKU. Geo-replication is Premium-only.
- **`IMMUTABLE` tags + git-SHA = win.** Enable immutability (ECR `IMMUTABLE`, Harbor immutability
  rule) so a re-run can never silently overwrite a deployed SHA. The build fails loudly instead.
- **GHCR `GITHUB_TOKEN` can't delete org packages.** Cleanup (§5) needs a PAT with
  `delete:packages`; the ephemeral token only pushes.
- **Untagged digest bloat from multi-arch + attestations.** Each `buildx --push --sbom --provenance`
  adds referrer artifacts. Without untagged-prune policies, storage grows fast — always pair §4 with §5.
- **Self-hosted GC needs delete enabled + read-only window.** `registry garbage-collect` is a no-op
  unless `REGISTRY_STORAGE_DELETE_ENABLED=true`, and writes during GC can corrupt — pause pushes.
- **Coolify pull auth.** Private GHCR/Harbor images need Coolify to hold a read-only token/robot;
  a missing/expired cred shows as `unauthorized` or a stuck deploy, not an obvious error.

Sources: https://docs.docker.com/registry/, https://distribution.github.io/distribution/, https://docs.github.com/en/packages/working-with-a-github-packages-registry/working-with-the-container-registry, https://docs.aws.amazon.com/AmazonECR/latest/userguide/, https://learn.microsoft.com/en-us/azure/container-registry/, https://goharbor.io/docs/, https://docs.sigstore.dev/cosign/signing/signing_with_containers/, https://docs.docker.com/docker-hub/usage/, https://docs.docker.com/build/building/multi-platform/
