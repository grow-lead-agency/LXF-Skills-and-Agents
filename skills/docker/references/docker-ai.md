# Docker AI Suite (Model Runner, Gordon, MCP Toolkit)

Docker's 2025-2026 AI product suite turns the Docker CLI + Desktop into a local
AI runtime and agent platform. This reference covers the three pillars and how
they fit a typical LLM/MCP-heavy stack (local models, MCP servers, Node apps).

## Table of Contents

1. [Overview — the three pillars](#1-overview--the-three-pillars)
2. [Docker Model Runner (`docker model`)](#2-docker-model-runner-docker-model)
3. [Compose integration (`models:`)](#3-compose-integration-models)
4. [Gordon (`docker ai`)](#4-gordon-docker-ai)
5. [MCP Toolkit + Catalog + Gateway (`docker mcp`)](#5-mcp-toolkit--catalog--gateway-docker-mcp)
6. [DMR vs Ollama](#6-dmr-vs-ollama)
7. [Gotchas](#7-gotchas)

Cross-refs: [`../SKILL.md`](../SKILL.md), [`compose-v2.md`](compose-v2.md).

---

## 1. Overview — the three pillars

| Pillar | Command | Job | When it matters |
|--------|---------|-----|-----------------|
| **Model Runner (DMR)** | `docker model` | Run LLMs locally, served on OpenAI/Anthropic/Ollama-compatible APIs | You want a local inference endpoint your Node app can hit, packaged as OCI artifacts and wired into Compose |
| **Gordon** | `docker ai` | Built-in AI assistant that acts on your Docker workflows (Dockerfiles, container debug, runs commands w/ approval) | Quick Docker Q&A, debugging a crashing container, Dockerfile review — without leaving the terminal |
| **MCP Toolkit / Catalog / Gateway** | `docker mcp` | Run 300+ MCP servers as containers behind one gateway; secrets + OAuth + isolation centralized | You connect Claude/Cursor/VS Code to many MCP servers and want isolation + one config instead of N |

All three are **Desktop-first** but have Docker Engine (Linux CE) paths. DMR is
**GA since 2025-09-18** (Beta April 2025). Gordon and MCP Toolkit/Gateway are
shipping features in Docker Desktop 4.6x–4.7x+; the MCP Gateway is open source.

---

## 2. Docker Model Runner (`docker model`)

### What it is

DMR runs and serves AI models locally using Docker. Key properties:

- **OpenAI-, Anthropic- and Ollama-compatible APIs** — point any existing SDK at the local endpoint.
- **Models packaged as OCI Artifacts** (GGUF / Safetensors) — pull/push to Docker Hub or any OCI registry, also pull directly from Hugging Face.
- **GPU acceleration** — Apple Silicon (Metal via llama.cpp), NVIDIA CUDA, AMD ROCm, Vulkan. Models load into memory only at request time and unload when idle.
- **Inference engines**: `llama.cpp` (default, all platforms, GGUF), `vLLM` (production throughput, NVIDIA Linux/WSL2, Safetensors), `Diffusers` (image gen, NVIDIA Linux only).

### Enabling it

**Docker Desktop** (4.40+): Settings → **AI** tab → enable **Docker Model Runner**.
- On Windows + NVIDIA: also enable **GPU-backed inference**.
- For host (non-container) access: enable **host-side TCP support** (default port `12434`) and set CORS origins if a local web app calls it.
- CLI equivalent: `docker desktop enable model-runner --tcp 12434`

**Docker Engine (Linux CE)** — install as a plugin package:
```bash
sudo apt-get update && sudo apt-get install docker-model-plugin   # Debian/Ubuntu
# or: sudo dnf install docker-model-plugin                        # RPM
docker model version
```
On Docker Engine, **TCP is on by default on port `12434`**.
Update path: `docker model uninstall-runner --images && docker model install-runner` (preserves local models unless `--models` added).

### Commands

```bash
docker model pull ai/smollm2:360M-Q4_K_M          # from Docker Hub
docker model pull hf.co/bartowski/Llama-3.2-1B-Instruct-GGUF   # from Hugging Face
docker model run ai/smollm2                         # interactive chat (TUI)
docker model run ai/qwen2.5-coder "explain this regex"  # one-shot
docker model ls                                     # list local models
docker model rm ai/smollm2                          # remove a model
docker model logs                                   # runtime logs (troubleshoot)
docker model configure --context-size 8192 ai/qwen2.5-coder   # tune context
docker model tag ai/smollm2 myorg/smollm2           # retag
docker model push myorg/smollm2                     # publish to a registry
docker model package --gguf "$(pwd)/model.gguf" --push myorg/mistral-7b:Q4_K_M  # GGUF → OCI artifact
```

### The API endpoint — how apps connect

DMR exposes endpoints under three access patterns:

| Run mode | From containers | From host (TCP) | Unix socket |
|----------|-----------------|-----------------|-------------|
| **Docker Desktop** | `http://model-runner.docker.internal` | `http://localhost:12434` (TCP must be enabled) | `$HOME/.docker/run/docker.sock` at `localhost/exp/vDD4.40/...` |
| **Docker Engine** | `http://172.17.0.1:12434` | `http://localhost:12434` | n/a |

`model-runner.docker.internal` is the internal DNS name containers use — no TCP
needed for container-to-DMR traffic. For containers inside a Compose project the
`172.17.0.1` bridge may not resolve; add:
```yaml
extra_hosts:
  - "model-runner.docker.internal:host-gateway"
```

**Base URLs for SDKs:**
- OpenAI SDK / clients → `http://localhost:12434/engines/v1`
- Anthropic SDK / clients → `http://localhost:12434` (messages at `/anthropic/v1/messages`)
- Ollama-compatible clients → `http://localhost:12434` (`/api/chat`, `/api/tags`, ...)

OpenAI-compatible endpoints: `/engines/v1/models`, `/engines/v1/chat/completions`,
`/engines/v1/completions`, `/engines/v1/embeddings`. You can pin an engine:
`/engines/llama.cpp/v1/chat/completions`.

### Real usage — a Node app calling local DMR via the OpenAI SDK

```ts
// npm install openai
import OpenAI from "openai";

const client = new OpenAI({
  baseURL: "http://localhost:12434/engines/v1", // DMR endpoint (host TCP)
  apiKey: "not-needed",                          // DMR ignores Authorization
});

const res = await client.chat.completions.create({
  model: "ai/qwen2.5-coder",
  messages: [{ role: "user", content: "Write a Node HTTP server in 10 lines." }],
});
console.log(res.choices[0].message.content);
```
Run with `npx tsx dmr-demo.ts` (or compile and `node dist/dmr-demo.js`). If this code runs **inside** a container, swap
`baseURL` to `http://model-runner.docker.internal/engines/v1`.

DMR also speaks Anthropic format, so a Claude-targeted client works unchanged:
```bash
curl http://localhost:12434/anthropic/v1/messages -H "Content-Type: application/json" \
  -d '{"model":"ai/smollm2","max_tokens":1024,"messages":[{"role":"user","content":"Hi"}]}'
```

---

## 3. Compose integration (`models:`)

Compose **v2.38+** treats AI models as first-class dependencies via a top-level
`models:` element plus a per-service `models:` binding. DMR (or any
Compose-spec platform) handles pull + lifecycle + env injection.

### Working `compose.yaml`

```yaml
services:
  chat-app:
    image: my-chat-app           # your Node app
    models:
      llm:                        # long syntax: rename injected env vars
        endpoint_var: AI_MODEL_URL
        model_var: AI_MODEL_NAME
      - embedding                 # short syntax also allowed

models:
  llm:
    model: ai/qwen2.5-coder       # required: OCI artifact identifier
    context_size: 4096
    runtime_flags:                # raw flags passed to the inference engine
      - "--no-prefill-assistant"
  embedding:
    model: ai/all-minilm
    context_size: 2048
    runtime_flags:
      - "--embeddings"            # REQUIRED for embedding models
```

### Binding shapes

- **Short syntax** (`models: [llm]`) auto-injects `LLM_URL` + `LLM_MODEL` env vars (name uppercased).
- **Long syntax** lets you choose names via `endpoint_var` / `model_var`.

Common model definition fields: `model` (required, OCI id), `context_size`,
`runtime_flags` (llama.cpp flags — `--temp`, `--top-k`, `--top-p`,
`--reasoning-budget 0` to disable reasoning, `--threads`, `--mlock`,
`--embeddings`), and `x-*` extension attributes (e.g. `x-cloud-options` for cloud
providers). The same Compose file is portable: a cloud platform implementing the
spec may use a managed model service instead of local inference.

> Note: the task brief mentioned a `provider:` shape. The current canonical
> Compose mechanism is the top-level `models:` element (above). `provider:`-style
> service definitions were an earlier experimental form; prefer `models:`.

Testcontainers (Java + Go) also support DMR for integration tests.

---

## 4. Gordon (`docker ai`)

### What it is

Gordon is Docker's built-in AI assistant that **takes action on your Docker
workflows** — it analyzes your environment, proposes commands/changes, and
executes them **only after you approve**.

What it does:
- Explains Docker concepts and commands.
- Writes/modifies Dockerfiles following best practices.
- Debugs container failures by reading logs and proposing fixes.
- Manages containers, images, volumes, networks.
- Searches Docker docs + web; can use **MCP Toolkit** tools you've enabled.

### Surfaces & how to invoke

- **CLI**: run `docker ai` for the interactive TUI, or one-shot:
  ```bash
  docker ai "show me logs from my nginx container"
  docker ai "review my Dockerfile for best practices"
  docker ai "list my local images and their sizes"
  ```
- **Docker Desktop**: sidebar → **Gordon** view → pick project dir → ask.
- **hub.docker.com** + **docs.docker.com**: Gordon icon (free, no account needed, no access to your environment).

### Prereqs, permissions, telemetry

- **Docker Desktop 4.74+**, signed-in Docker account. Enabled by default for
  signed-in users; Business orgs need Docker Support activation + admin toggle
  in Settings Management.
- **Permissions**: asks approval before each action (approve one / approve all
  for session); resets per session. Auto-approve is configurable.
- **Usage/telemetry**: Desktop + CLI usage counts against your Gordon plan
  limits. Hub/docs Gordon is free with a separate shared public limit. It is an
  opt-in assistant — review proposed actions before approving.

What it **can't** do: it won't silently run destructive commands (approval-gated),
and the free Hub/docs surface has no access to your local Docker environment.

---

## 5. MCP Toolkit + Catalog + Gateway (`docker mcp`)

### The pieces

- **MCP Catalog** — 300+ verified MCP servers packaged as container images
  (`mcp/*` on Docker Hub), each signed, with SBOM + provenance. Orgs can publish
  custom catalogs.
- **MCP Toolkit** — Docker Desktop UI (4.62+) to browse the catalog, enable
  servers, organize them into **profiles**, handle OAuth, and connect clients.
- **MCP Gateway** — open-source proxy that aggregates many MCP servers behind
  **one endpoint**, runs each server in an isolated container, injects secrets,
  enforces limits, and logs/traces all tool calls. With Desktop + Toolkit it runs
  automatically; standalone you run it yourself.

Core concepts: **catalogs** (server collections) → **profiles** (named server
sets per project, e.g. `web-dev` = GitHub + Playwright) → **clients** (Claude
Code, Cursor, VS Code, Zed connect to a profile through the gateway). **Dynamic
MCP** lets an agent discover/add servers on-demand mid-conversation.

### `docker mcp` CLI / gateway pattern

For Docker Engine without Desktop, install the plugin:
```bash
# download docker-mcp binary from GitHub releases, then:
ln -s <downloaded> ~/.docker/cli-plugins/docker-mcp
chmod +x ~/.docker/cli-plugins/docker-mcp
docker mcp --help
```

Run the gateway for a profile:
```bash
docker mcp gateway run --profile my_profile
```

### Connecting a client

**Claude Desktop / Claude Code / Cursor** — in Toolkit, Clients tab → **Connect**
next to the client, then restart it; it sees every server in the profile.

**VS Code** (global `mcp.json`):
```json
{
  "mcp": {
    "servers": {
      "MCP_DOCKER": {
        "type": "stdio",
        "command": "docker",
        "args": ["mcp", "gateway", "run", "--profile", "my_profile"]
      }
    }
  }
}
```
Per-project: `docker mcp client connect vscode --profile my_profile` (writes
`.vscode/mcp.json` — gitignore it).

### Security model

- **Passive**: all `mcp/*` images Docker-built, signed, SBOM-attested.
- **Active**: each tool runs in its own container capped at **1 CPU / 2 GB**, **no
  host filesystem access by default** (you opt-in mounts per server), and the
  gateway **intercepts requests carrying secrets** to block leakage.
- **OAuth**: Toolkit handles GitHub/Notion/Linear-style OAuth in-browser and
  stores credentials — no manual token wrangling per client.

### When Docker MCP gateway is the right choice

- **Use Docker MCP gateway** when you want **container isolation + signed images
  + per-tool resource caps** for untrusted/community MCP servers, or one gateway
  endpoint aggregating many local servers across Claude/Cursor/VS Code at once.
- **Use a managed connector platform** (or vendor SDKs) for SaaS app integrations
  (Gmail, Calendar, GitHub, Notion, Linear, etc.) when you want OAuth-managed tools
  without running containers yourself.
- **Use native MCP client config** for custom self-hosted servers where you already
  control credentials and networking.
- Docker MCP gateway shines as the **sandbox layer** when adopting many
  third-party catalog servers you don't fully trust.

---

## 6. DMR vs Ollama

| Dimension | Docker Model Runner | Ollama |
|-----------|---------------------|--------|
| Packaging | **OCI artifacts** (GGUF/Safetensors) — push to Docker Hub / any registry, CI-friendly | Custom blob store + Modelfile |
| Compose-native | **Yes** — `models:` top-level element, env injection, Testcontainers | No (run as a sidecar service) |
| Desktop integration | Native (Models tab, request inspector, logs) | Separate app |
| API surface | OpenAI **+ Anthropic + Ollama** compatible | Ollama API (+ OpenAI-compat subset) |
| Maturity / ecosystem | GA Sep 2025, newer | Mature, huge model library, battle-tested |
| Fleet / remote | Engine plugin on Linux; less mature for headless multi-host serving | Mature for headless remote inference |
| GPU | Metal (Apple Silicon), CUDA, ROCm, Vulkan | Metal, CUDA, ROCm |

**Rule of thumb:**
- **DMR** when you want models as **OCI artifacts wired into a Compose stack**,
  Desktop request-inspection during dev, or an Anthropic-compatible local endpoint
  for Claude-targeted code (Apple Silicon or NVIDIA desktops).
- **Ollama** when you need the broadest model library and proven headless
  multi-host or remote inference.

Both serve OpenAI-compatible endpoints, so app code can stay provider-agnostic
and switch via `baseURL`. For local embeddings, DMR's `ai/all-minilm` with
`--embeddings` is a Compose-native option alongside Ollama embeddings.

---

## 7. Gotchas

- **GPU requirements**: vLLM and Diffusers need **NVIDIA GPUs on Linux** (vLLM
  also WSL2). On Apple Silicon you get llama.cpp + Metal only — no vLLM/Diffusers.
  Windows GPU inference must be explicitly enabled.
- **Model size / disk**: models are large; first pull is slow, then cached
  locally. They load to RAM/VRAM only on request and unload when idle — but a 7B
  Q4 still wants several GB. Watch disk on developer machines and production volumes.
- **Desktop-first**: richest UX is Docker Desktop. Linux Docker Engine support is
  real (`docker-model-plugin`, TCP on `12434` by default) but the Models GUI,
  request inspector, and Gordon Desktop view are Desktop-only. Gordon needs
  Desktop **4.74+**; MCP Toolkit UI needs **4.62+**.
- **`docker model` not recognized**: plugin not symlinked. Fix:
  `ln -s /Applications/Docker.app/Contents/Resources/cli-plugins/docker-model ~/.docker/cli-plugins/docker-model`.
- **OpenAI-compat is a subset**: DMR ignores the `Authorization` header (no API
  key), token counting uses the model's native encoder (differs from OpenAI),
  function calling/vision depend on the model + llama.cpp support. Don't assume
  full OpenAI parity — test the specific feature.
- **Compose model binding**: embedding models **require** `--embeddings` in
  `runtime_flags` or `/v1/embeddings` won't work. Inside Compose, `172.17.0.1`
  may not resolve — add the `extra_hosts: model-runner.docker.internal:host-gateway`.
- **MCP gateway security**: only enable catalog servers you trust; though `mcp/*`
  images are signed and capped (1 CPU / 2 GB, no host FS by default), enabling
  file mounts or broad OAuth scopes widens the attack surface. The gateway blocks
  secret-bearing requests, but review which servers get credentials. Treat
  community/non-`mcp/*` servers as untrusted.
- **Gordon cost/telemetry**: Desktop + CLI Gordon usage counts against plan
  limits and acts on your environment — keep approval prompts on for anything
  destructive.


## Sources

- https://docs.docker.com/ai/model-runner/
- https://docs.docker.com/ai/model-runner/get-started/
- https://docs.docker.com/ai/model-runner/api-reference/
- https://docs.docker.com/ai/gordon/
- https://docs.docker.com/ai/mcp-catalog-and-toolkit/
- https://docs.docker.com/ai/mcp-catalog-and-toolkit/toolkit/
- https://docs.docker.com/ai/mcp-gateway/
- https://docs.docker.com/compose/how-tos/model-runner/
- https://www.docker.com/blog/announcing-docker-model-runner-ga/

