# Local Docker Dev — macOS (and Linux)

The rest of this skill is **server-first** (daemons, registries, CI, orchestration). This file
fills the **local development** gap: what to run Docker on while you code, especially on a Mac.
On an Apple Silicon Mac doing daily dev, arm64 behaviour and file-sharing perf are
front and center.

Bottom line up front: **OrbStack is the recommended default Mac local runtime** (fast, low-RAM,
auto-imports from Docker Desktop, `*.orb.local` domains). **Colima** is the best free/headless/CI
choice — with one real networking caveat documented below. **Docker Desktop** stays only when you
need its exclusive features (Extensions, ECI, Wasm, Model Runner / Gordon).

Cross-refs: [`../SKILL.md`](../SKILL.md) · [`daemon-server-ops.md`](daemon-server-ops.md) (docker
context, remote daemons) · [`compose-v2.md`](compose-v2.md) (watch / hot reload) ·
[`docker-ai.md`](docker-ai.md) (Desktop-first AI features) ·
[`buildkit-multiplatform.md`](buildkit-multiplatform.md) (arm64/amd64 builds).

## Table of Contents

1. [The landscape](#1-the-landscape)
2. [Comparison table](#2-comparison-table)
3. [OrbStack — recommended Mac default](#3-orbstack--recommended-mac-default)
4. [Colima — free, scriptable, headless/CI](#4-colima--free-scriptable-headlessci)
5. [Docker Desktop — when you still need it](#5-docker-desktop--when-you-still-need-it)
6. [File-sharing performance](#6-file-sharing-performance)
7. [Switching runtimes with `docker context`](#7-switching-runtimes-with-docker-context)
8. [Local dev workflow](#8-local-dev-workflow)
9. [Gotchas](#9-gotchas)

---

## 1. The landscape

What can actually run the Docker engine + `docker` CLI on your laptop:

- **Docker Desktop** — the official all-in-one (engine + GUI + k8s + Extensions). macOS / Windows /
  Linux. The default everyone knows; commercial licensing strings attached at scale.
- **OrbStack** — macOS (+ Linux beta). A fast, low-overhead Docker + Linux-VM + k8s app built for
  Apple Silicon. Drop-in `docker`/`compose` CLI, native container domains. Paid for commercial use.
- **Colima** — macOS / Linux. CLI-only, Lima-based VM wrapper around containerd/Docker. Free,
  open-source, scriptable. Great headless and in CI.
- **Rancher Desktop** — macOS / Windows / Linux. Open-source desktop app (Lima VM on Mac) with
  moby/containerd backend and **k3s built in**. Free.
- **Podman** (+ Podman Desktop) — macOS / Windows / Linux. Daemonless, rootless-first container
  engine; `podman` is largely Docker-CLI compatible. Free, OSS.

On **Linux** there is no VM layer — Docker Engine / Podman run natively, so most of the
Mac-specific perf and networking pain below simply does not apply. This doc assumes macOS unless a
section says otherwise.

---

## 2. Comparison table

| Runtime | Platform | Cost / license | RAM/CPU overhead | Startup | File-sharing perf | k8s built-in | GUI | `docker` CLI drop-in | Best for |
|---|---|---|---|---|---|---|---|---|---|
| **OrbStack** | macOS (Linux beta) | **Paid for commercial** ($8/user/mo, $96/yr billed annually); free for personal/non-commercial | Lowest — lightweight VM, idles low | Seconds (fastest) | **VirtioFS, fast** | Yes (built-in k8s) | Yes (polished) | Yes (incl. compose/buildx) | **Recommended Mac default** — fast iteration, low battery/RAM |
| **Colima** | macOS / Linux | **Free** (MIT, OSS) | Low, fully tunable (`--cpu/--memory/--disk`) | Few seconds | VirtioFS via `--vm-type vz`; sshfs on QEMU | Optional (`--kubernetes`, k3s) | No (CLI only) | Yes (sets up a docker context) | Free dev, **headless / CI**, scripted profiles |
| **Docker Desktop** | macOS / Win / Linux | Free **only** if company < 250 employees **and** < $10M revenue; else Pro/Team/Business sub | Highest of the bunch | Slower | VirtioFS (gRPC-FUSE legacy) | Yes (single-node) | Yes | Yes (reference impl) | Feature parity — Extensions, ECI, Wasm, Model Runner/Gordon |
| **Rancher Desktop** | macOS / Win / Linux | **Free** (OSS, SUSE) | Medium | Slower (k3s init) | Lima-backed (VirtioFS-capable) | **Yes (k3s)** | Yes | Yes (moby) or nerdctl (containerd) | Local **Kubernetes** dev, multi-version k8s |
| **Podman** | macOS / Win / Linux | **Free** (OSS, Apache-2) | Low | Few seconds | virtiofs (machine) | Via kind/podman play | Podman Desktop (optional) | Mostly (`alias docker=podman`; rootless quirks) | Rootless/daemonless, RHEL/OpenShift parity, security-conscious |

Notes:
- Colima, Rancher Desktop and Podman-machine on macOS all sit on **Lima** under the hood. Lima's
  default VM type on macOS is **`vz`** (Apple Virtualization.Framework) since Lima v1.0 (macOS ≥ 13).
- "Drop-in `docker` CLI" means you keep typing `docker build`/`docker compose`; only Podman needs an
  alias and occasionally trips on rootless behaviour.

---

## 3. OrbStack — recommended Mac default

OrbStack is purpose-built for Apple Silicon: a single lightweight Linux VM hosts Docker, optional
full Linux machines, and Kubernetes, with far less RAM/CPU and faster cold start than Docker Desktop.

**Install**

```bash
brew install orbstack
# or download the .dmg from https://orbstack.dev
orb start              # start the engine (also auto-starts on first docker call)
orb status
```

**Why it's fast**
- Lightweight, tuned VM (low idle memory, scales CPU on demand — your laptop fan stays quiet).
- **VirtioFS** file sharing by default → bind-mount reads/writes close to native.
- Fast networking and DNS; containers reachable directly without manual port juggling.

**Native container domains** — every container gets a name you can hit from the host:

```
http://<container-name>.orb.local
http://<service>.<project>.orb.local      # docker compose: service.project
```

No more `-p 3000:3000` bookkeeping for local browsing; the port still works, but the domain is
nicer for multi-service compose stacks.

**`orb` CLI** — manage everything from the terminal:

```bash
orb list                       # docker containers + linux machines
orb top                        # activity monitor TUI
orb create ubuntu my-box       # spin a full Linux machine
orb shell my-box               # drop into it
orb start k8s / orb stop       # toggle the built-in Kubernetes
```

OrbStack gives you **Docker + Linux machines + Kubernetes in one app** — handy when you want a
throwaway Linux box next to your containers without a second tool.

**Migration from Docker Desktop** — on first launch OrbStack **auto-imports** existing containers,
images and volumes from Docker Desktop, and registers its own `docker context`. You can usually quit
Docker Desktop the same day. Verify the active context (see §7) and re-pull anything that didn't
copy.

**Commercial licensing** — OrbStack is a paid product post-beta. Free for **personal,
non-commercial** use; **business/commercial use is $8/user/month** ($96/year billed annually). For
commercial client/dev work this is a commercial use → it needs a paid seat. Cheaper and faster than a
Docker Business seat, and no employee/revenue threshold ambiguity.

> Recommendation: make OrbStack the default local runtime on developer machines for interactive dev.
> Budget one paid seat per active developer machine.

---

## 4. Colima — free, scriptable, headless/CI

Colima (COntainer-on-LIMA) is a CLI wrapper that boots a Lima VM and wires up a Docker/containerd
runtime. No GUI, fully scriptable, MIT-licensed — the right tool for CI, servers, and anyone who
wants $0 and config-as-code. Actively maintained (v0.10.0, Feb 2026; ~29k★).

**Install**

```bash
brew install colima docker        # docker = the CLI client; colima = the VM/runtime
# add 'docker-compose' or 'docker-buildx' formulae if you want those plugins
colima start
```

**Profiles & sizing** — Colima reads flags or `~/.colima/<profile>/colima.yaml`:

```bash
# A bigger default profile
colima start --cpu 4 --memory 8 --disk 60

# Apple Virtualization framework (faster than QEMU) + VirtioFS mounts
colima start --vm-type vz --mount-type virtiofs

# Rosetta for fast x86_64 emulation on Apple Silicon (run amd64 images)
colima start --vm-type vz --vz-rosetta

# Named profiles for parallel environments
colima start --profile heavy --cpu 6 --memory 12
colima start --profile ci    --cpu 2 --memory 4
colima list
colima stop --profile ci
colima delete --profile ci
```

`--vm-type vz` uses Apple's Virtualization.Framework (the modern default on Lima); `--vz-rosetta`
plugs Rosetta 2 into the VM so `linux/amd64` images run much faster than QEMU emulation — useful
when an image has no arm64 variant (see [`buildkit-multiplatform.md`](buildkit-multiplatform.md)).

**Docker context** — `colima start` automatically creates and selects a `colima` docker context
pointing at the VM's socket. You don't have to set `DOCKER_HOST` manually:

```bash
docker context ls            # shows 'colima' as current
docker run --rm hello-world
```

**Kubernetes (k3s)** — Colima can bundle a single-node k3s:

```bash
colima start --kubernetes        # boots k3s, writes kubeconfig
kubectl get nodes
```

**Headless / CI use** — because it's pure CLI, Colima drops straight into CI runners and SSH-only
boxes: `colima start --cpu 2 --memory 4 && docker build ...`. No login GUI, no licensing seat.

### ⚠️ Colima networking gotcha (real, documented incident)

> **Colima's LaunchAgent can hijack your Mac's default route and break ALL outbound networking.**

On one of our Macs, Colima's `LaunchAgent` created a **`bridge100`** interface for the VM and that
bridge **took over the default route**. Combined with macOS **Tahoe's negative route cache**, the
symptoms were nasty and confusing:

- Already-ESTABLISHED TCP sessions kept working (SMB shares, NUT `upsmon`, long-lived SSH) — so it
  looked "mostly fine."
- But **new** connections failed: `ping`, `nc`, `upsc`, fresh curls returned **"No route to host"**.
  Outbound networking was globally broken for anything new.

**Fix that was applied**

```bash
# 1. Disable the Colima LaunchAgent so it stops recreating bridge100 on boot/login
launchctl bootout gui/$(id -u)/com.colima.* 2>/dev/null || \
  launchctl unload ~/Library/LaunchAgents/com.colima*.plist
# (and remove the plist if Colima isn't needed on that machine)

# 2. Restore the real default route (gateway = your LAN router)
sudo route -n delete default 2>/dev/null
sudo route -n add default 192.168.10.1      # use your actual gateway

# 3. As a belt-and-suspenders safety net, a LaunchDaemon can re-assert the
#    default route every few minutes.
```

The root cause is the **bridge interface stealing the default route**, not Colima's container engine
itself. Colima was ultimately **removed from that machine** because it also does a lot of other
networking (NUT/UPS, SMB, Tailscale, cluster traffic) and a route hijack there is unacceptable.

**Honest framing:** Colima is excellent **headless / in CI / on dedicated build boxes** where it's
the only thing touching the network. On a daily-driver Mac that *also* runs Tailscale, SMB, UPS
monitoring, etc., watch its LaunchAgent and bridge interface — or use OrbStack, which doesn't exhibit
this behaviour. Check after install:

```bash
ifconfig | grep -A3 bridge        # is there a bridge100 with a default-route IP?
netstat -rn | grep default        # is your default route still the real gateway?
```

---

## 5. Docker Desktop — when you still need it

Reach for Docker Desktop only when you need a feature the lighter runtimes don't ship:

- **Docker Extensions** (the marketplace UI plugins).
- **Enhanced Container Isolation (ECI)** — Business-tier hardening that runs containers in a user
  namespace inside the VM.
- **Wasm** workloads (containerd Wasm shims, runwasi integration).
- **Docker Model Runner / "Gordon" (Ask Gordon)** and other AI features — these are Desktop-first.
  See [`docker-ai.md`](docker-ai.md) before assuming another runtime has them.

**Licensing model** — Docker Desktop is free **only** when used at a company with **fewer than 250
employees AND less than $10M annual revenue** (also free for personal, education, non-commercial OSS).
Above either threshold, **commercial use requires a paid subscription** (Pro / Team / Business).
Business tier adds ECI, centralized settings management, and image/registry access controls. For an
agency doing commercial client work, assume a paid seat is required if you keep Desktop — which is a
reason to prefer OrbStack/Colima where the exclusive features aren't needed.

**Resource tuning** — Settings → Resources, or `~/.docker/desktop/settings-store.json`. Cap CPUs,
Memory, Swap and Disk image size so Desktop's VM doesn't starve the host; switch file sharing to
**VirtioFS** (Settings → General) — it's the default on recent versions and dramatically faster than
the legacy gRPC-FUSE.

---

## 6. File-sharing performance

The classic macOS Docker pain is **bind-mount I/O across the host↔VM boundary**. History:

- **gRPC-FUSE** (legacy Desktop default) — correct but slow; `node_modules`/vendor trees crawl.
- **VirtioFS** (Desktop recent default, OrbStack default, Colima `--mount-type virtiofs`) — much
  faster, close enough to native for most workflows. **Use it.**
- The old **`:cached` / `:delegated`** bind-mount consistency flags were a band-aid for the
  osxfs/gRPC-FUSE era. With VirtioFS they're **mostly moot** — harmless if present, but don't rely on
  them for speed anymore.

**The rules that actually matter for a Node project:**

1. **Named volumes >> bind mounts for dependency dirs.** Never let `node_modules` (or `.venv`,
   `target/`, etc.) live on a host bind mount — that's where the cross-boundary tax is worst.
2. **The `node_modules` mount-over trick** — bind-mount your source for live editing, but stack an
   **anonymous/named volume on top of `node_modules`** so deps stay inside the VM and aren't shadowed
   by the (possibly empty or host-arch) host folder:

   ```yaml
   # compose.yaml (dev)
   services:
     app:
       build: .
       volumes:
         - .:/app                 # source: edit on host, see it live
         - /app/node_modules      # anonymous volume — keep deps in the VM, fast + arch-correct
       command: npm run dev
   ```

   Same idea works for `npm install` artifacts. Run `npm install` **inside** the image/container so
   the binaries match the container's arch, not your Mac's.

3. Keep the bind mount **scoped to source only**; don't mount the whole `$HOME` or huge asset trees.
4. For watch-heavy dev, prefer compose **watch mode** (next section) over deep recursive bind mounts —
   it syncs only changed files.

Concrete guidance for Node on Mac: OrbStack VirtioFS source mount + a volume over `node_modules`
gives near-native `npm run dev` reload times. On Colima, add `--mount-type virtiofs`; without it the
sshfs default is noticeably slower for big dep trees.

---

## 7. Switching runtimes with `docker context`

Each runtime registers a Docker **context** (a named pointer to a daemon socket). You can have Docker
Desktop, OrbStack and Colima installed at once and flip between them — only one is "current."

```bash
docker context ls            # list contexts + which is active (*)
docker context show          # just the current name

docker context use orbstack        # OrbStack
docker context use colima          # Colima (default profile → 'colima'; others 'colima-<profile>')
docker context use desktop-linux   # Docker Desktop on macOS
docker context use default         # native unix socket (Linux / remote via DOCKER_HOST)
```

How each registers itself:
- **OrbStack** → creates/selects the `orbstack` context on install/start.
- **Colima** → `colima start` creates/selects `colima` (or `colima-<profile>`); `colima stop`/`delete`
  leaves the context but it points at a stopped socket.
- **Docker Desktop** → `desktop-linux` on macOS.

**Switch cleanly:** stop the runtime you're leaving (`orb stop` / `colima stop` / quit Desktop) so its
socket isn't half-alive, then `docker context use <other>`. If `docker ps` errors with a socket path,
you're pointed at a stopped daemon — check `docker context ls`.

This is the same mechanism used to talk to a **remote daemon over SSH**
(`docker context create remote --docker host=ssh://user@host`) — see
[`daemon-server-ops.md`](daemon-server-ops.md) for remote/prod daemon operations and security.

---

## 8. Local dev workflow

**Compose watch (hot reload)** — `docker compose watch` syncs/rebuilds on file changes without manual
restarts; far better than deep bind mounts for big dep trees:

```yaml
# compose.yaml — develop.watch
services:
  app:
    build: .
    develop:
      watch:
        - action: sync          # copy changed files into the running container
          path: ./src
          target: /app/src
        - action: rebuild       # rebuild image when deps change
          path: ./package.json
```

```bash
docker compose up --watch
```

Full watch semantics (sync / sync+restart / rebuild) live in [`compose-v2.md`](compose-v2.md).

**Local registry** — to test a `docker push`/pull cycle without hitting GHCR/ECR:

```bash
docker run -d -p 5000:5000 --name registry registry:2
docker tag myapp:dev localhost:5000/myapp:dev
docker push localhost:5000/myapp:dev
```

(Registry retention/signing for real registries → [`registry-management.md`](registry-management.md).)

**Testcontainers** — integration tests can spin throwaway services (Postgres, Redis, etc.) against
whatever local runtime is active. It honours your current `docker context`, so it works the same on
OrbStack or Colima; on Colima set `TESTCONTAINERS_DOCKER_SOCKET_OVERRIDE` to the Colima socket if a
library can't auto-detect it (`colima status` prints the socket path).

**Resource limits so a local stack doesn't eat the laptop** — cap the VM (OrbStack settings / `colima
start --cpu --memory`) *and* per-service in compose:

```yaml
services:
  db:
    image: postgres:17
    deploy:
      resources:
        limits: { cpus: "1.0", memory: 512M }
```

A 6-service compose stack can otherwise pin every core and drain the battery.

---

## 9. Gotchas

- **Colima networking LaunchAgent (the big one)** — the `bridge100` default-route hijack + macOS Tahoe
  negative route cache. See §4 for symptoms ("No route to host" for *new* connections only) and the
  fix (disable the LaunchAgent, `route add default <gw>`, optional re-assert LaunchDaemon). On a
  multi-purpose networking Mac, prefer OrbStack.
- **Apple Silicon arm64 vs amd64** — your Mac is arm64. Pulling/building `linux/amd64` images runs
  under emulation: **Rosetta** (fast; OrbStack default, Colima `--vz-rosetta`) or **QEMU** (slow,
  fallback). Watch for "image platform does not match" warnings; force a target with
  `--platform linux/amd64` only when you must, and expect it to be slower. Build true multi-arch
  images with `docker buildx` — see [`buildkit-multiplatform.md`](buildkit-multiplatform.md).
- **Docker Desktop licensing audit risk** — commercial use over 250 employees **or** $10M revenue
  without a paid sub is a license violation; Docker does enforce. Don't leave Desktop installed
  "just in case" on commercial machines without a seat — switch to OrbStack/Colima or buy the sub.
- **File-watching limits** — large repos can exhaust inotify watchers inside the VM (`ENOSPC`/missed
  events). Prefer compose **watch** (§8) over recursive bind-mount watchers; scope mounts narrowly.
- **Port conflicts** — only one runtime can bind a host port at a time. If `bind: address already in
  use`, another runtime (or a leftover container in a different context) holds it: `docker context ls`
  then `lsof -i :PORT`. OrbStack's `*.orb.local` domains sidestep most manual port mapping.
- **Time drift after Mac sleep** — VM-based runtimes can drift after the Mac sleeps/wakes, breaking
  TLS handshakes and token expiry ("certificate not yet valid", clock-skew auth errors). Quickest
  fix: restart the runtime (`orb restart` / `colima restart`) or, for Colima, re-sync inside the VM
  (`colima ssh -- sudo sntp -sS time.apple.com` / `hwclock -s`). Recurs on every long sleep.

---

Sources: https://orbstack.dev/, https://orbstack.dev/pricing, https://docs.orbstack.dev/faq, https://docs.orbstack.dev/docker/domains, https://github.com/abiosoft/colima, https://github.com/abiosoft/colima/releases/tag/v0.10.0, https://colima.run/docs/configuration/, https://lima-vm.io/docs/config/vmtype/vz/, https://lima-vm.io/docs/config/vmtype/, https://docs.docker.com/subscription/desktop-license/, https://www.docker.com/pricing/, https://rancherdesktop.io/, https://podman-desktop.io/
