# Docker Skill — Research Sources

## 2026-07-15 — Delta refresh: verified, no drift

Checked via Firecrawl search against docs.docker.com/engine/release-notes + releasebot.io +
endoflife.date/docker-engine for changes since the 2026-05-30 refresh (~6.5 weeks prior).

- https://docs.docker.com/engine/release-notes/29/ — Docker Engine v29 still current major
  (latest patch **v29.4.3**, per releasebot.io July 2026 log); no v30 released. Skill's claim
  "containerd-snapshotter default on fresh Engine 29.0+" (`daemon-server-ops.md`, `troubleshooting.md`)
  is still accurate — no change needed.
- https://github.com/docker/compose/releases — Compose still v2.x line (no v3); no breaking
  syntax changes found since the 2026-05-30 compose-v2.md refresh (include/extends/merge/
  lifecycle-hooks/configs/GPU/models sections already current).
- https://docs.docker.com/desktop/release-notes/ — Desktop/Engine 29.3.0 + NVIDIA Container
  Toolkit 1.19.0, Gordon improvements — routine point releases, nothing skill-level.
- Conclusion: **no drift** — SKILL.md and all references/*.md left unchanged, only this log entry added.

## 2026-05-30 — compose-v2.md (include, extends, merge precedence, lifecycle hooks, pull_policy, configs, GPU, models)

Appended 8 sections to compose-v2.md. Firecrawl tokens stale + 0 credits, Context7 key invalid →
all syntax verified live via Exa crawl of official docs.docker.com.

- https://docs.docker.com/reference/compose-file/include/ — top-level `include`, short/long syntax, per-file project_directory + env_file, path-as-list, recursive, name-conflict warning (no merge), evaluated after `-f` merge
- https://docs.docker.com/reference/compose-file/merge/ — merge rules: mappings merge (later wins), sequences APPEND, exception command/entrypoint/healthcheck.test REPLACE
- https://docs.docker.com/reference/compose-file/services/ — `extends` (file/service, mapping override vs sequence combine vs scalar win, resources NOT auto-imported, no circular, not with stack deploy), `pull_policy` (always/missing/never/build/daily/weekly/every_<dur>, :latest always pulled under missing)
- https://docs.docker.com/compose/how-tos/lifecycle/ — `post_start` (no ordering guarantee, root hook on non-root container) + `pre_stop` (before stop signal, only managed stop, not SIGKILL)
- https://docs.docker.com/reference/compose-file/configs/ — top-level `configs` sources (file/environment/content/external), 0444 default, content+environment v2.23.1+, external rejects other attrs
- https://docs.docker.com/reference/compose-file/deploy/ — `deploy.resources.reservations.devices` GPU/TPU (capabilities required, count vs device_ids exclusive, driver: nvidia, options), update_config/rollback_config orders
- https://docs.docker.com/compose/how-tos/model-runner/ — Compose v2.38+ top-level `models:` + per-service binding, short syntax auto-injects <NAME>_URL/<NAME>_MODEL (cross-ref docker-ai.md)

## 2026-05-30 — daemon-server-ops.md (docker context, containerd image store, Loki/fluentd logging drivers, NFS/CIFS volume driver)

Appended 4 sections (§9–§12, renumbered Gotchas → §13). Firecrawl/Context7 unavailable →
verified live via Exa crawl of docs.docker.com + grafana.com.

- https://docs.docker.com/engine/manage-resources/contexts/ — `docker context create --docker "host=ssh://..."`, ls/use/inspect/export/import/update, DOCKER_HOST + DOCKER_CONTEXT env (env overrides `context use`), `--context` global flag, meta.json under ~/.docker/contexts/
- https://docs.docker.com/engine/storage/containerd/ — `features.containerd-snapshotter: true`, default on fresh Engine 29.0+, unlocks multi-platform local store + attestations + Wasm + lazy-pull snapshotters (stargz/nydus/dragonfly/soci), verify via `docker info -f '{{.DriverStatus}}'`, incompatible with userns-remap, dual compressed+extracted storage = more disk, switching hides other store's data
- https://docs.docker.com/engine/logging/configure/ — daemon.json log-driver/log-opts, built-in drivers (fluentd/gelf/splunk/awslogs), per-container --log-driver
- https://grafana.com/docs/loki/latest/send-data/docker-driver/ — `docker plugin install grafana/loki-docker-driver:3.7.0-<arch>`, plugin lifecycle, deadlock warning (in-memory buffer, retries-forever blocks daemon), prefer Alloy loki.source.docker
- https://grafana.com/docs/loki/latest/send-data/docker-driver/configuration/ — log-opt reference (loki-url/loki-batch-size/loki-retries/loki-timeout/loki-max-backoff/no-file/keep-file/mode), daemon.json values must be strings, compose `logging.driver: loki` + options, auto labels swarm_stack/compose_project
- https://docs.docker.com/engine/storage/volumes/ — `local` driver NFS (type=nfs, o=addr=...,nfsvers=4, device=:/export) + CIFS (type=cifs, device=//host/share, o=addr=,username=,password=), mounts on container start not volume create, CSI/external plugins via docker plugin install for clustered storage

## 2026-05-30 — troubleshooting.md (docker debug, docker events, inspect forensics, containerd --load)

Appended 4 sections to troubleshooting.md. Syntax verified live (Context7 + Firecrawl tokens
were stale → verified via Exa crawl of official docs.docker.com).

- https://docs.docker.com/reference/cli/docker/debug/ — `docker debug` full reference: usage `debug [OPTIONS] {CONTAINER|IMAGE}`, Nix toolbox, builtin install/uninstall/entrypoint/builtins, --shell/--command/--host options, distroless/slim/hello-world examples, /nix never visible to image, changes discarded on exit for image/stopped containers
- https://docs.docker.com/build/building/multi-platform/ — manifest list structure, containerd image store prerequisite, docker-container driver alternative (push-only, no --load)
- https://docs.docker.com/desktop/features/containerd/ — containerd image store default since Desktop 4.34, classic store can't load manifest lists / attestations, the "Multi-platform build is not supported for the docker driver" error, snapshotters (stargz/nydus/dragonfly), switch via Settings, images hidden not deleted on switch
- https://dbafromthecold.com/2024/01/30/the-docker-debug-command/ — confirms docker debug is a Pro+ licensed feature
- https://docs.docker.com/subscription/desktop-license/ — Docker Desktop subscription tiers (Personal free vs Pro/Team/Business paid)

## 2026-05-30 — docker-ai.md (Docker AI suite: Model Runner, Gordon, MCP Toolkit)

New reference covering Docker's 2025-2026 AI product suite. DMR confirmed GA 2025-09-18.

- https://docs.docker.com/ai/model-runner/ — DMR overview, engines (llama.cpp/vLLM/Diffusers), platform reqs
- https://docs.docker.com/ai/model-runner/get-started/ — enable DMR (Desktop AI tab + Engine docker-model-plugin), pull/run/publish, troubleshooting
- https://docs.docker.com/ai/model-runner/api-reference/ — OpenAI/Anthropic/Ollama-compat endpoints, base URLs, model-runner.docker.internal, port 12434, SDK examples
- https://docs.docker.com/ai/gordon/ — Gordon `docker ai` assistant, surfaces, permissions, telemetry, Desktop 4.74+
- https://docs.docker.com/ai/mcp-catalog-and-toolkit/ — catalog/profiles/clients concept (300+ servers)
- https://docs.docker.com/ai/mcp-catalog-and-toolkit/toolkit/ — MCP Toolkit UI, security (1 CPU/2GB, no host FS), OAuth, client connect examples
- https://docs.docker.com/ai/mcp-gateway/ — MCP Gateway open-source proxy, `docker mcp gateway run --profile`, manual install
- https://docs.docker.com/compose/how-tos/model-runner/ — Compose `models:` top-level element, short/long syntax, runtime_flags, embeddings
- https://www.docker.com/blog/announcing-docker-model-runner-ga/ — DMR GA announcement (Sep 18 2025, Beta April 2025)

## 2026-05-30 — docker-master agent + 4 new reference files

Added the `docker-master` agent (sibling skill dir `skills/tools/docker-master/`) and four
new reference files making the skill platform-agnostic and server-ops capable.

### registry-management.md (GHCR/ECR/ACR/Harbor/Distribution)
- https://docs.docker.com/registry/ — Docker registry / Distribution
- https://docs.github.com/en/packages — GitHub Packages / GHCR
- https://docs.aws.amazon.com/AmazonECR/latest/userguide/ — AWS ECR (auth, lifecycle policies)
- https://learn.microsoft.com/en-us/azure/container-registry/ — Azure ACR (tokens, purge tasks)
- https://goharbor.io/docs/ — Harbor self-hosted registry (robot accounts, retention, GC)
- https://docs.sigstore.dev/cosign/ — cosign signing & verification
- https://docs.docker.com/docker-hub/usage/ — Docker Hub pull rate limits

### daemon-server-ops.md (bare Docker on your own server)
- https://docs.docker.com/config/daemon/ — daemon.json configuration
- https://docs.docker.com/engine/install/ubuntu/ — Engine install on Ubuntu/Debian
- https://docs.docker.com/engine/swarm/ — Swarm mode (multi-node)
- https://docs.docker.com/engine/security/rootless/ — Rootless mode
- https://doc.traefik.io/traefik/ — Traefik reverse proxy (Docker provider, ACME)
- https://caddyserver.com/docs/ — Caddy reverse proxy

### cicd-git-bridge.md (build-push in CI, git-master integration)
- https://docs.docker.com/build/ci/github-actions/ — Docker in GitHub Actions
- https://github.com/docker/build-push-action — build-push-action
- https://github.com/docker/metadata-action — metadata-action (tagging)
- https://github.com/aquasecurity/trivy-action — Trivy scan in CI
- https://docs.docker.com/build/cache/backends/ — CI cache backends (gha/registry/local)

### orchestration-handoff.md (when to leave single-host Docker)
- https://kubernetes.io/docs/concepts/workloads/controllers/deployment/ — K8s Deployments
- https://kompose.io/ — Compose → K8s conversion tool
- https://docs.aws.amazon.com/AmazonECS/latest/developerguide/ — AWS ECS
- https://learn.microsoft.com/en-us/azure/container-apps/ — Azure Container Apps
- https://12factor.net/ — 12-factor app (portable container prerequisites)

## 2026-04-05 — Initial creation (full skill)

### Docker Official Documentation
- https://docs.docker.com/build/guide/ — Build guide overview
- https://docs.docker.com/build/building/multi-stage/ — Multi-stage builds
- https://docs.docker.com/build/cache/ — Build cache optimization
- https://docs.docker.com/build/cache/backends/ — Cache backends (registry, gha, local)
- https://docs.docker.com/build/building/multi-platform/ — Multi-platform builds
- https://docs.docker.com/build/bake/ — Bake build orchestration
- https://docs.docker.com/reference/dockerfile/ — Dockerfile reference
- https://docs.docker.com/compose/how-tos/profiles/ — Compose profiles
- https://docs.docker.com/compose/how-tos/file-watch/ — Compose watch mode
- https://docs.docker.com/engine/network/ — Docker networking overview
- https://docs.docker.com/engine/security/ — Container security
- https://docs.docker.com/guides/bun/containerize/ — Bun containerization guide
- https://docs.docker.com/guides/bun/develop/ — Bun development with Docker
- https://docs.docker.com/dhi/ — Docker Hardened Images
- https://docs.docker.com/engine/storage/volumes/ — Docker volumes
- https://docs.docker.com/engine/containers/resource_constraints/ — Resource limits

### BuildKit
- https://docs.docker.com/build/buildkit/ — BuildKit overview
- https://docs.docker.com/build/secrets/ — Build secrets
- https://docs.docker.com/build/ssh/ — SSH forwarding in builds

### Container Security
- https://aquasecurity.github.io/trivy/latest/docs/ — Trivy scanner docs
- https://aquasecurity.github.io/trivy/latest/docs/target/container_image/ — Image scanning
- https://aquasecurity.github.io/trivy/latest/docs/configuration/ — Trivy config (.trivyignore)
- https://docs.sigstore.dev/cosign/signing/signing_with_containers/ — cosign image signing
- https://docs.sigstore.dev/cosign/keyless/ — Keyless signing with GitHub OIDC
- https://syft.dev/ — SBOM generation tool
- https://github.com/anchore/syft — syft GitHub repo
- https://github.com/anchore/grype — Grype vulnerability scanner

### Base Images
- https://github.com/GoogleContainerTools/distroless — Distroless base images
- https://edu.chainguard.dev/chainguard/chainguard-images/reference/ — Chainguard images docs
- https://hub.docker.com/_/node — Official Node.js images
- https://hub.docker.com/r/oven/bun — Official Bun images

### Best Practices Articles
- https://northflank.com/blog/docker-build-and-buildx-best-practices-for-optimized-builds — BuildKit + buildx best practices
- https://oneuptime.com/blog/post/2026-01-16-docker-buildkit-cache-secrets/view — Cache mounts and secrets deep dive
- https://www.sliceofexperiments.com/p/a-comprehensive-guide-for-the-fastest — Fastest Docker builds guide
- https://tech.sparkfabrik.com/en/blog/docker-cache-deep-dive/ — Build cache deep dive
- https://www.augmentedmind.de/2023/11/19/advanced-buildkit-caching/ — Advanced BuildKit caching

### Multi-platform
- https://docs.docker.com/desktop/multi-arch/ — Multi-arch builds overview
- https://github.com/tonistiigi/binfmt — QEMU binfmt for cross-compilation

### GitHub Actions Integration
- https://github.com/docker/build-push-action — docker/build-push-action docs
- https://github.com/docker/metadata-action — Image metadata action
- https://github.com/docker/setup-buildx-action — Buildx setup action
- https://docs.github.com/en/packages/working-with-a-github-packages-registry/working-with-the-container-registry — GHCR docs

### Dive Tool
- https://github.com/wagoodman/dive — Docker layer explorer

### SLSA Supply Chain
- https://slsa.dev/ — SLSA framework
- https://github.com/slsa-framework/slsa-github-generator — SLSA GitHub generator

### Existing Skills Referenced
- skills/infra/devops-engineer/references/docker-patterns.md — Basic patterns (starting point)
