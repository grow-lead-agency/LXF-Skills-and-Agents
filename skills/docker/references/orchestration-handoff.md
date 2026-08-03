# Orchestration Handoff — When and How to Move Off Single-Host Docker

> This file answers ONE strategic
> question: **I have Docker containers running on a single host with Compose/Swarm — when and
> how do I move to Kubernetes or AWS ECS, and what carries over?**
>
> The short answer: **the image is portable, the orchestration is not.** Build portable images
> now, migrate the manifest only when a real signal hits. Premature migration is a costly,
> common mistake.

---

## Table of Contents

1. [The Core Principle — The Image Is Portable, The Orchestration Is Not](#1-the-core-principle)
2. [Decision Matrix — Where Should This Workload Run?](#2-decision-matrix)
3. [The Stay-vs-Go Signals (the heart of this file)](#3-the-stay-vs-go-signals)
4. [What Carries Over vs What You Rewrite](#4-what-carries-over-vs-what-you-rewrite)
5. [Compose → Kubernetes Migration Sketch](#5-compose--kubernetes-migration-sketch)
6. [Compose → ECS Migration Sketch](#6-compose--ecs-migration-sketch)
7. [Healthcheck / Probe Mapping Detail](#7-healthcheck--probe-mapping-detail)
8. [Stateful Workloads Warning](#8-stateful-workloads-warning)
9. [Anti-Patterns](#9-anti-patterns)
10. [Cross-References](#10-cross-references)

---

## 1. The Core Principle

**The image is portable. The orchestration is not.**

A correctly-built OCI image is the unit of portability. If your image is:

- **Multi-stage** — build deps left behind, runtime layer is lean
- **Non-root** — `USER node` (or a dedicated UID), no reliance on host root
- **Healthcheck-aware** — exposes a real `/healthz` endpoint the platform can poll
- **Env-configured** — all config injected via environment / mounted secrets, nothing baked in
- **Stateless** — no local disk state that matters; writes go to a DB, object store, or volume
- **SIGTERM-handling** — graceful shutdown on `SIGTERM`, drains in-flight requests within the grace period
- **12-factor** — config in env, logs to stdout/stderr, processes disposable ([12factor.net](https://12factor.net/))

...then that **exact same image** runs **UNCHANGED** on:

| Platform | What schedules it |
|----------|-------------------|
| Docker Compose | `docker compose up` on one host |
| Docker Swarm | `docker stack deploy` across a swarm |
| Kubernetes | Deployment + Service + kubelet |
| AWS ECS (Fargate or EC2) | task definition + service |
| Azure Container Apps | revision + ingress |
| Google Cloud Run | revision (knative) |

**Migration = rewrite the manifest, not the app.** You do not rebuild the binary, you do not
touch application code (assuming it is already stateless and 12-factor). You translate the
*declarative orchestration spec* — the Compose file — into the target platform's spec
(Deployment YAML, ECS task definition, Container App ARM/Bicep).

**Therefore, the strategy is:**

1. **Don't orchestrate-shop early.** Choosing Kubernetes for three containers because it's
   "industry standard" is a multi-month tax for zero benefit.
2. **Build portable images today.** The discipline above costs nothing extra now and makes any
   future migration a manifest-rewrite (days), not a re-architecture (months).
3. **Migrate when a real signal hits** — see [Section 3](#3-the-stay-vs-go-signals). Because the
   image carries over 100%, the migration is **genuinely low-risk** when actually needed.

This reframes orchestration choice from a scary one-way door into a reversible, signal-driven
decision. The expensive part was never the orchestrator — it was building stateless, portable
images, and that work pays off regardless of where you land.

---

## 2. Decision Matrix

Rows = workload characteristics. Columns = candidate platforms. ✅ = recommended fit,
🟡 = workable but not ideal, ❌ = wrong tool.

| Workload characteristic | Stay Compose | Swarm | Coolify | Kubernetes | ECS / Fargate | Azure Container Apps |
|---|---|---|---|---|---|---|
| 1 service / few services | ✅ | 🟡 | ✅ | ❌ | 🟡 | 🟡 |
| Single host is enough | ✅ | ❌ | ✅ | ❌ | 🟡 | 🟡 |
| Multi-node HA needed | ❌ | ✅ | 🟡¹ | ✅ | ✅ | ✅ |
| Autoscaling needed (HPA / request-based) | ❌ | 🟡² | ❌ | ✅ | ✅ | ✅ |
| Rolling / canary / blue-green deploys | 🟡³ | 🟡 | 🟡³ | ✅ | ✅ | ✅ |
| Small team (1–3, no ops platform team) | ✅ | ✅ | ✅ | ❌ | 🟡 | 🟡 |
| Platform / SRE team exists | 🟡 | 🟡 | 🟡 | ✅ | ✅ | ✅ |
| Existing AWS commitment | 🟡 | 🟡 | 🟡 | 🟡⁴ | ✅ | ❌ |
| Existing Azure commitment | 🟡 | 🟡 | 🟡 | 🟡⁴ | ❌ | ✅ |
| Cost-sensitive / bootstrap budget | ✅ | ✅ | ✅ | ❌⁵ | 🟡 | 🟡 |
| Low ops appetite (don't want to babysit infra) | ✅ | 🟡 | ✅ | ❌ | ✅⁶ | ✅⁶ |
| Scale-to-zero (idle workloads) | ❌ | ❌ | ❌ | 🟡⁷ | 🟡⁷ | ✅ |

¹ Coolify supports multi-server clusters via Swarm under the hood (see `coolify` skill).
² Swarm has `--replicas` and basic scaling but no native request-based autoscaling.
³ Compose/Coolify can do rolling restarts; true canary/blue-green needs external tooling or a proxy.
⁴ K8s on AWS = EKS, on Azure = AKS — viable but adds K8s ops cost on top of cloud bill.
⁵ K8s control plane + worker nodes + ops overhead is the most expensive option for small workloads.
⁶ Fargate / Container Apps are serverless — no node fleet to patch, but per-vCPU pricing.
⁷ K8s/ECS need KEDA or scheduled scaling for scale-to-zero; Container Apps does it natively (KEDA built in).

**Default reading of this matrix for a small team:** most projects (Node.js + Postgres on a VPS with
bare Docker + Coolify) sit firmly in the **Stay Compose / Coolify** column. The matrix only
pushes right when a concrete signal in Section 3 fires.

---

## 3. The Stay-vs-Go Signals

This is the heart of the file. Do not migrate on vibes — migrate on a signal.

### STAY on Compose / Coolify (the default — most small-team projects live here)

Stay put when **all** of these hold:

- Fewer than ~10 services in the deployment.
- A single host (or one Coolify-managed node) has enough headroom for current + near-term load.
- **No hard multi-node HA requirement** — a few minutes of downtime during a deploy or reboot
  is acceptable to the business.
- Small team, no dedicated platform/SRE engineer.
- Cost-sensitive — every euro of infra and ops time matters.

This describes a **typical small-team stack**: Node.js apps + Postgres on a VPS with
bare Docker, fronted by Coolify. Coolify already gives you Git-push deploys, rolling restarts,
Traefik routing, SSL, and backups without any orchestrator complexity. **Do not leave this tier
until a signal below actually fires.**

### GO to Docker Swarm — the middle ground

Move to Swarm when you need:

- **Multi-node placement** — spread replicas across 2–3 hosts so one node dying doesn't take you
  fully down.
- **Simple HA** — `docker service` replicas with built-in load balancing (routing mesh).
- **Secrets management** — `docker secret` for credentials mounted as files.
- ...but you want to **keep the Compose mental model** (`docker stack deploy -c stack.yml`) and
  have **zero appetite for Kubernetes complexity** (no Helm, no operators, no etcd, no kubelet
  babysitting).

Swarm is the pragmatic step when "single host is no longer enough" but "we are not a platform
team." See the Swarm section of **`daemon-server-ops.md`** for `docker swarm init`, overlay
networks, `docker stack deploy`, secrets, and rolling update config.

> **Caveat:** Swarm is in maintenance mode upstream and Coolify deprecated managed Swarm in
> beta.474 (see `coolify` skill). It still works and is fine for a stable small cluster, but for
> *new* multi-node ambitions weigh Swarm vs. jumping to a managed platform (ECS/Container Apps)
> that won't strand you.

### GO to Kubernetes — hand off to the `kubernetes` agent

Move to K8s when you need **one or more** of:

- **HPA autoscaling** — scale replicas on CPU/memory/custom metrics automatically.
- **Self-healing across nodes** — pods rescheduled onto healthy nodes on failure, declaratively.
- **Sophisticated deploys** — native rolling updates plus canary / blue-green via Argo Rollouts,
  Flagger, or a service mesh.
- **Service mesh** — mTLS, traffic splitting, observability (Istio, Linkerd).
- **Large ecosystem** — operators (Postgres operators, cert-manager), Helm charts, GitOps (Argo
  CD / Flux).
- **A platform team exists** — someone whose job is to run the cluster. This is the real gating
  signal: **K8s without a platform team is a liability, not an asset.**

When this fires → **hand production cluster work to a Kubernetes specialist.** The Docker side's
job is to confirm the image is K8s-ready (probes, resource requests/limits, graceful shutdown)
and produce a draft manifest; the cluster owner takes the production cluster, Helm, GitOps, and operators.
Reference: [Kubernetes Deployments](https://kubernetes.io/docs/concepts/workloads/controllers/deployment/).

### GO to AWS ECS / Fargate

Move to ECS when:

- You are **already deep in AWS** (RDS, S3, VPC, IAM are your home).
- You want a **managed control plane** — no etcd, no Kubernetes ops — with a simpler model than
  EKS.
- You want **serverless containers** via **Fargate** — no EC2 node fleet to patch or scale.
- You need **tight IAM / VPC integration** — task IAM roles, security groups per service, ALB
  integration, Secrets Manager / SSM Parameter Store.

ECS gives you most of the orchestration benefits (scheduling, health, autoscaling, rolling
deploys) without K8s's conceptual surface area, *if* you're already living in AWS. When this
fires → **hand off to the `aws-master` agent.** Reference:
[Amazon ECS Developer Guide](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/).

### GO to Azure Container Apps — hand off to the `azure-master` agent

Move to Container Apps when:

- You are **already in Azure**.
- You want **serverless containers** with a knative-style revision model.
- You want **scale-to-zero** for spiky or idle workloads (KEDA is built in — request-based and
  event-driven autoscaling out of the box).
- You want **Dapr** for service-to-service calls, pub/sub, state, and bindings without bolting on
  a mesh.

When this fires → **hand off to the `azure-master` agent.** Reference:
[Azure Container Apps docs](https://learn.microsoft.com/en-us/azure/container-apps/).

---

## 4. What Carries Over vs What You Rewrite

The image and its build artifacts travel for free. The orchestration spec is what you rewrite.

| Artifact | Carries over? | What happens on migration |
|---|---|---|
| **Dockerfile / OCI image** | ✅ 100% | Same image, same tag, same registry. Pulled unchanged on every platform. |
| **`.dockerignore`** | ✅ Carries | Build-time concern; unchanged — still controls build context. |
| **HEALTHCHECK** | 🟡 Concept carries | Docker `HEALTHCHECK` → K8s liveness/readiness/startup probes → ECS container health check → Container Apps health probes. Same endpoint, different declaration. See [Section 7](#7-healthcheck--probe-mapping-detail). |
| **Compose `service`** | ❌ Rewrite | → K8s `Deployment` + `Service`; → ECS task definition + service; → Container App. |
| **Compose `volumes`** | ❌ Rewrite | → K8s `PersistentVolumeClaim` (+ StorageClass); → ECS EFS volume or bind; → Container Apps volume mount. |
| **Compose `networks`** | ❌ Rewrite | → K8s `Service` + `NetworkPolicy` (service discovery via DNS); → ECS security groups + service discovery; → Container Apps internal ingress. |
| **Compose `environment`** | ❌ Rewrite | → K8s `ConfigMap` + `Secret`; → ECS `environment` + `secrets` (SSM Parameter Store / Secrets Manager); → Container Apps env vars + secrets. |
| **Compose `depends_on`** | ❌ Rewrite | No direct equivalent. → K8s `initContainers` + readiness probes (orchestrator retries until deps ready); → ECS `dependsOn` in container definitions. |
| **Compose `restart` policy** | ❌ Rewrite | → K8s pod `restartPolicy` + Deployment self-healing; → ECS service desired-count reconciliation; → Container Apps revision health. |
| **Compose `deploy.replicas`** | ❌ Rewrite | → K8s `replicas` (or HPA); → ECS `desiredCount` (+ Application Auto Scaling); → Container Apps `minReplicas`/`maxReplicas`. |
| **Compose `ports`** | 🟡 Rewrite | Container port carries; published port → K8s Service/Ingress, ECS load balancer target, Container Apps ingress. |

**Mental model:** everything *inside* the image (the "what") carries. Everything that describes
*how the platform runs the image* (replicas, networking, storage, config injection, dependencies)
is platform-specific glue you rewrite once.

---

## 5. Compose → Kubernetes Migration Sketch

A tiny Compose service:

```yaml
# compose.yaml
services:
  api:
    image: registry.example.com/myapp:1.4.0
    ports:
      - "3000:3000"
    environment:
      NODE_ENV: production
      LOG_LEVEL: info
      DATABASE_URL: ${DATABASE_URL}   # secret
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:3000/healthz"]
      interval: 15s
      timeout: 3s
      retries: 3
    deploy:
      replicas: 2
    restart: unless-stopped
```

Becomes a **Deployment + Service + ConfigMap + Secret** in Kubernetes:

```yaml
# k8s.yaml
apiVersion: v1
kind: ConfigMap
metadata:
  name: api-config
data:
  NODE_ENV: production
  LOG_LEVEL: info
---
apiVersion: v1
kind: Secret
metadata:
  name: api-secrets
type: Opaque
stringData:
  DATABASE_URL: "postgres://..."   # from a real secret store in prod (External Secrets / SOPS)
---
apiVersion: apps/v1
kind: Deployment
metadata:
  name: api
spec:
  replicas: 2                       # was deploy.replicas
  selector:
    matchLabels: { app: api }
  template:
    metadata:
      labels: { app: api }
    spec:
      containers:
        - name: api
          image: registry.example.com/myapp:1.4.0   # IMAGE CARRIES UNCHANGED
          ports:
            - containerPort: 3000
          envFrom:
            - configMapRef: { name: api-config }
            - secretRef: { name: api-secrets }
          readinessProbe:           # was part of healthcheck
            httpGet: { path: /healthz, port: 3000 }
            periodSeconds: 15
            timeoutSeconds: 3
            failureThreshold: 3
          livenessProbe:
            httpGet: { path: /healthz, port: 3000 }
            periodSeconds: 15
      # restartPolicy: Always is implicit for Deployments (was restart: unless-stopped)
---
apiVersion: v1
kind: Service
metadata:
  name: api
spec:
  selector: { app: api }
  ports:
    - port: 3000
      targetPort: 3000              # was ports mapping; external exposure via Ingress
```

**Kompose** ([kompose.io](https://kompose.io/)) can bootstrap this: `kompose convert -f compose.yaml`
emits Deployment/Service YAML from a Compose file. **Treat its output as a DRAFT, not production.**
It won't set resource requests/limits, won't split liveness vs readiness sensibly, won't wire a
real secret store, and won't add Ingress/HPA/NetworkPolicy. Use it as a starting skeleton, then
**hand off the production hardening to the `kubernetes` agent.**

---

## 6. Compose → ECS Migration Sketch

`docker compose` has historically had ECS integration (the old Docker Compose CLI ECS context,
now via `docker compose alpha`, AWS Copilot, or writing the task definition directly). The most
durable path is the **ECS task definition JSON**, which maps cleanly from a Compose service:

```jsonc
// task-definition.json
{
  "family": "myapp-api",
  "networkMode": "awsvpc",            // Fargate requires awsvpc
  "requiresCompatibilities": ["FARGATE"],
  "cpu": "512",                        // Fargate task sizing (no Compose equivalent — explicit)
  "memory": "1024",
  "executionRoleArn": "arn:aws:iam::...:role/ecsTaskExecutionRole",
  "taskRoleArn": "arn:aws:iam::...:role/myapp-task-role",   // app's IAM identity
  "containerDefinitions": [
    {
      "name": "api",
      "image": "registry.example.com/myapp:1.4.0",   // IMAGE CARRIES UNCHANGED
      "portMappings": [{ "containerPort": 3000 }],     // was ports
      "environment": [                                  // was non-secret environment
        { "name": "NODE_ENV", "value": "production" },
        { "name": "LOG_LEVEL", "value": "info" }
      ],
      "secrets": [                                      // was secret env → Secrets Manager / SSM
        { "name": "DATABASE_URL",
          "valueFrom": "arn:aws:secretsmanager:...:secret:myapp/DATABASE_URL" }
      ],
      "healthCheck": {                                  // was HEALTHCHECK
        "command": ["CMD-SHELL", "curl -f http://localhost:3000/healthz || exit 1"],
        "interval": 15,
        "timeout": 3,
        "retries": 3
      },
      "logConfiguration": {
        "logDriver": "awslogs",
        "options": { "awslogs-group": "/ecs/myapp-api", "awslogs-region": "eu-central-1" }
      }
    }
  ]
}
```

Replicas/HA come from the **ECS *service*** (`desiredCount`, deployment strategy, ALB target
group, Application Auto Scaling) layered on top of this task definition — that's the analogue of
`deploy.replicas` + `restart`. **Hand off the service definition, networking (VPC/subnets/SGs),
load balancer, IAM roles, and autoscaling policies to whoever owns your AWS surface.** The Docker
side ensures the image and task definition are correct.

---

## 7. Healthcheck / Probe Mapping Detail

This is a **common migration bug source** — get it wrong and you ship a workload that the
orchestrator either never sends traffic to (stuck "unready") or kills in a crash loop.

| Concept | Docker | Kubernetes | ECS |
|---|---|---|---|
| "Is the container alive? restart if not." | `HEALTHCHECK` (one signal) | **livenessProbe** | container `healthCheck` (one signal) |
| "Is it ready to serve traffic yet?" | — (no distinct concept) | **readinessProbe** | (health check gates ALB registration) |
| "Is it still starting up (don't kill yet)?" | `--start-period` | **startupProbe** | `startPeriod` |

**The trap:** Docker has *one* `HEALTHCHECK` that conflates "alive" and "ready". Kubernetes
splits this into **three** probes, and using only one is the most common mistake:

- **liveness only** → during a slow boot, the kubelet thinks the container is dead and restarts
  it forever (crash loop) even though it would have come up fine. Fix with a **startupProbe**.
- **readiness only** → a wedged process (deadlocked, but still answering /healthz superficially)
  never gets restarted.
- **Correct pattern:** `startupProbe` covers slow boot (generous `failureThreshold`),
  `readinessProbe` gates traffic (fast, gates the Service endpoint), `livenessProbe` restarts a
  truly dead process (conservative, avoid false positives).

**Design rule for portable images:** expose a real `/healthz` (liveness — "process is up") and
ideally a separate `/readyz` (readiness — "deps connected, ready for traffic"). Make `/healthz`
cheap and dependency-free; put DB/queue connectivity checks in `/readyz`. That single design
choice makes the image map cleanly onto Docker, K8s, and ECS without rework.

---

## 8. Stateful Workloads Warning

Postgres, Redis, message queues — stateful workloads are where naive migrations go wrong.

**On a single host (Compose / Coolify):**

- Postgres in a container with a **named volume** + scheduled `pg_dump` / PITR backups to
  S3/R2/Backblaze is a **perfectly good, simple setup** for small workloads. Coolify manages
  this well (see `coolify` skill databases + backup sections).

**On Kubernetes:**

- Stateful services need a **StatefulSet** + **PersistentVolumeClaim** (stable network identity,
  ordered rollout, per-pod durable storage). This is materially harder than a Deployment:
  storage classes, volume expansion, backup/restore, failover, and version upgrades all become
  *your* problem.
- **Running production Postgres in K8s without a platform team is an anti-pattern.** You inherit
  operator selection (CloudNativePG, Zalando, Crunchy), failover correctness, PITR, and storage
  ops — a full-time discipline.

**The recommendation for a small team: keep the database OUT of the orchestrator.**

- Use a **managed DB**: **Neon** or **Supabase** (Postgres), or **RDS / Aurora** on AWS,
  **Azure Database for PostgreSQL** on Azure.
- Your orchestrated workload becomes **fully stateless** — which is exactly what makes the image
  portable and the migration low-risk in the first place.
- Managed DB > self-orchestrated StatefulSet for any team without a dedicated DBA/platform
  function. The cost of a managed Postgres is far lower than the cost of operating one correctly
  on Kubernetes.

This closes the loop with [Section 1](#1-the-core-principle): the whole portability story
depends on the *app* being stateless. Push state to managed services and you keep that property.

---

## 9. Anti-Patterns

- **Orchestrating prematurely.** Standing up Kubernetes for 3 containers because it's "the
  standard." You pay months of ops tax (cluster, Helm, GitOps, upgrades, on-call) for zero
  benefit a single Compose host or Coolify would have delivered. **Migrate on a signal
  (Section 3), not on hype.**
- **Running stateful DBs in K8s without a platform team.** StatefulSet + PVC + operator +
  failover + PITR is a full-time job. Use managed Postgres (Neon/Supabase/RDS) instead — see
  [Section 8](#8-stateful-workloads-warning).
- **Lift-and-shift without making images stateless first.** Migrating a container that writes
  important state to local disk just moves the fragility to a new platform. **Make the image
  12-factor and stateless BEFORE migrating**, or the migration multiplies your problems.
- **Choosing the orchestrator by hype, not by signal.** "We should use K8s / ECS / Container
  Apps because $BigCo does." The right driver is your actual workload characteristics
  ([Section 2](#2-decision-matrix)) and a fired signal ([Section 3](#3-the-stay-vs-go-signals)) —
  existing cloud commitment, autoscaling need, HA need, team shape — not a logo.
- **Treating `kompose convert` output as production.** It's a draft skeleton. Ship it as-is and
  you'll have no resource limits, no real secret store, no Ingress/HPA, and conflated probes.
- **Migrating to escape ops you could fix in place.** If the pain is "deploys are manual" or
  "no SSL automation," Coolify solves that on your existing host. Don't reach for K8s to fix a
  Compose-tier problem.

---

## 10. Cross-References

- **`daemon-server-ops.md`** — Docker Swarm section (`swarm init`, overlay networks,
  `stack deploy`, secrets, rolling updates). The middle-ground GO target from Section 3.
- **`compose-v2.md`** — the Compose source-of-truth you're migrating *from*; service/volume/
  network/env semantics that map into Sections 4–6.
- **Kubernetes** — hand off all K8s production work (cluster, Helm, GitOps, operators,
  HPA, probes hardening) to whoever runs the cluster; the Docker side only produces the draft manifest.
- **AWS** — hand off ECS/Fargate service definition, VPC/SG networking, ALB, IAM
  task roles, Secrets Manager/SSM wiring, Application Auto Scaling.
- **Azure** — hand off Azure Container Apps (revisions, KEDA scale-to-zero, Dapr,
  ingress).
- **Coolify** — a good self-hosted PaaS default for most small-team workloads: Git-push deploys,
  Traefik, SSL, managed databases, backups, and multi-server (Swarm) clusters.

> **The Docker side's role across all handoffs:** verify the image is portable (multi-stage,
> non-root, real health endpoint, stateless, SIGTERM handling, env-config), produce the draft
> target manifest, then hand the production platform work to the platform owner. The image is the
> deliverable that travels; the manifest is the deliverable you draft and hand off.

Sources: https://kubernetes.io/docs/concepts/workloads/controllers/deployment/, https://docs.docker.com/engine/swarm/, https://kompose.io/, https://docs.aws.amazon.com/AmazonECS/latest/developerguide/, https://learn.microsoft.com/en-us/azure/container-apps/, https://12factor.net/
