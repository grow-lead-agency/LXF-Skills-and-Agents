# Terraform / OpenTofu — Plugins & Extensions Ecosystem

How provider plugins are **managed**, how a repo is **linted/edited** (editor tooling), and how to write a **custom provider**. Practical copy-paste recipes for a typical team: developers on Mac arm64 + Linux CI runners (x86_64), common providers such as Hetzner Cloud + Cloudflare, Node/bun toolchains.

> **Where things live:** Concrete providers (hcloud, cloudflare, aws, google…) and their `required_providers` blocks → [providers-multicloud.md](providers-multicloud.md). CI gates / GHA cache → [policy-cicd.md](policy-cicd.md). Provider-defined functions + `required_providers` syntax → [core-hcl.md](core-hcl.md). OpenTofu specifics (`.tofurc`, registry) → [opentofu.md](opentofu.md). **Here** = how the plugin ecosystem is managed and extended.

---

## Table of Contents

1. [Terminology: plugin = provider](#1-terminology-plugin--provider)

**PART A — Plugin/Provider management**
2. [.terraform.lock.hcl deep dive](#2-terraformlockhcl-deep-dive)
3. [Plugin cache](#3-plugin-cache)
4. [.terraformrc / CLI config](#4-terraformrc--cli-config)
5. [Provider mirror (air-gapped / corporate CI)](#5-provider-mirror-air-gapped--corporate-ci)
6. [Dependency lock workflow in CI](#6-dependency-lock-workflow-in-ci)

**PART B — Linting & editor tooling**
7. [tflint plugin system](#7-tflint-plugin-system)
8. [terraform-ls + editor extensions](#8-terraform-ls--editor-extensions)
9. [Pre-commit hooks](#9-pre-commit-hooks)

**PART C — Custom provider development**
10. [When to write a custom provider (usually NO)](#10-when-to-write-a-custom-provider-usually-no)
11. [terraform-plugin-framework](#11-terraform-plugin-framework)
12. [Publish to the registry](#12-publish-to-the-registry)
13. [Lighter alternatives to a full provider](#13-lighter-alternatives-to-a-full-provider)

---

## 1. Terminology: plugin = provider

In Terraform, "plugin" means **provider** in 99% of cases. A provider is a separate binary (Go) that the Terraform CLI downloads, starts, and talks to via the Terraform Plugin Protocol (v5 or v6). Provisioner plugins existed historically, but they are effectively dead — today "plugin" = provider.

Three layers this document covers:

| Layer | What it is about | Sections |
|---|---|---|
| **Management** | How provider plugins are downloaded, cached, locked, mirrored | PART A (2–6) |
| **Editor / lint tooling** | tflint plugins, language server, pre-commit hooks | PART B (7–9) |
| **Custom dev** | When no provider exists and you must write one | PART C (10–13) |

OpenTofu uses the same protocol and concepts — all commands below work with `tofu` instead of `terraform` (differences in [opentofu.md](opentofu.md)).

---

# PART A — Plugin/Provider management

## 2. .terraform.lock.hcl deep dive

`.terraform.lock.hcl` is the **dependency lock file** — created/updated by `terraform init` in the root module. It locks the exact version of each provider and its checksums. **Commit it to git** (like `package-lock.json` / `bun.lock`) so the whole team and CI get bit-identical providers.

Example contents:

```hcl
# This file is maintained automatically by "terraform init".
# Manual edits may be lost in future updates.

provider "registry.terraform.io/hetznercloud/hcloud" {
  version     = "1.49.1"
  constraints = "~> 1.49"
  hashes = [
    "h1:abc123...",                      # h1 hash of the whole package for a specific platform
    "zh:0a1b2c...",                      # zh = zip hash from origin registry (signed)
    # ... more zh: for each platform
  ]
}
```

- **`h1:` hashes** — modern hash scheme (hash of the whole unpacked package). Applies to a **specific platform** (OS_ARCH) you initialized with.
- **`zh:` hashes** — "zip hashes" from the origin registry, covered by the publisher's cryptographic signature. Cover all platforms for which the registry reports checksums.

### Problem: lock pinned for only one platform

When you run `terraform init` on a Mac (`darwin_arm64`), the lock gets `h1:` only for `darwin_arm64`. When CI then runs on `linux_amd64`, init **adds** a new `h1:` and the lock changes after a CI commit → noise in the diff or "lock is inconsistent" errors.

### Solution: multi-platform lock

Pre-populate checksums for **all platforms the team + CI use** at once:

```bash
terraform providers lock \
  -platform=darwin_arm64 \   # team on Apple Silicon Mac
  -platform=linux_amd64 \    # Linux CI runners (x86_64)
  -platform=linux_arm64      # optional ARM nodes / CI runners
```

This downloads the needed metadata from the origin registry and writes `h1:` + `zh:` for all three platforms into `.terraform.lock.hcl`. The lock is then stable across Mac dev and Linux CI and nobody rewrites it by accident. **Run this after every provider add/upgrade and commit the result.** (On Windows the whole command must be on one line without `\`.)

### Upgrading providers

```bash
terraform init -upgrade   # picks newest versions within version constraints + rewrites the lock
```

After `-upgrade`, re-run `terraform providers lock -platform=...` to fill all platforms; otherwise `-upgrade` on a Mac writes only `darwin_arm64`.

> Verified from developer.hashicorp.com/terraform/cli/commands/providers/lock — `-platform=OS_ARCH` is repeatable; `terraform providers lock` writes package checksums without initializing providers.

---

## 3. Plugin cache

Without a cache **every `terraform init` in every working directory downloads providers again** — and provider binaries can easily be hundreds of MB (hcloud, cloudflare, aws are large). On a slow/metered connection and in CI that wastes time and bandwidth.

Plugin cache = a shared local directory where each unique provider version is downloaded **only once**; into the working dir it is then symlinked/copied.

### Setup (recommended via `.terraformrc`)

```hcl
# ~/.terraformrc
plugin_cache_dir = "$HOME/.terraform.d/plugin-cache"
```

The directory **must exist beforehand** — Terraform will not create it:

```bash
mkdir -p ~/.terraform.d/plugin-cache
```

Alternatively via env var (per-shell override):

```bash
export TF_PLUGIN_CACHE_DIR="$HOME/.terraform.d/plugin-cache"
```

Note: the cache dir **must not** also be a filesystem-mirror directory (section 5) — they conflict.

### CI cache pattern (self-hosted or cloud runners)

You want the cache to survive between jobs. In GitHub Actions:

```yaml
env:
  TF_PLUGIN_CACHE_DIR: ${{ runner.temp }}/.terraform-plugin-cache

steps:
  - run: mkdir -p "$TF_PLUGIN_CACHE_DIR"

  - name: Cache Terraform providers
    uses: actions/cache@v4
    with:
      path: ${{ env.TF_PLUGIN_CACHE_DIR }}
      # key bound to lock file — cache invalidates only when provider versions change
      key: tf-plugins-${{ runner.os }}-${{ hashFiles('**/.terraform.lock.hcl') }}
      restore-keys: |
        tf-plugins-${{ runner.os }}-

  - run: terraform init -input=false
```

> On a persistent self-hosted runner, `TF_PLUGIN_CACHE_DIR` can point at a stable path outside the workspace (e.g. `/opt/terraform-plugin-cache`) and you may not need `actions/cache` at all — the cache survives across jobs on its own. For the GHA cache layer in CI pipelines see [policy-cicd.md](policy-cicd.md).

> Caution: plugin cache is **not** concurrency-safe — two parallel `terraform init` on the same cache dir = undefined behavior (verified from docs). On matrix jobs give each shard its own cache key/dir.

---

## 4. .terraformrc / CLI config

The CLI configuration file sets **per-user** Terraform CLI behaviour across all working directories (unrelated to infrastructure `.tf` configuration).

### Where it lives

- **macOS / Linux:** `~/.terraformrc` (leading dot, directly in home).
- **Windows:** `terraform.rc` in `%APPDATA%`.
- **Override:** env var `TF_CLI_CONFIG_FILE=/path/to/custom.tfrc` (file should have `*.tfrc` extension).

Syntax is HCL (like `.tf`), but with different attributes/blocks.

### What it can do (complete example)

```hcl
# ~/.terraformrc

# 1) Plugin cache (section 3)
plugin_cache_dir = "$HOME/.terraform.d/plugin-cache"

# 2) Disable "phone home" check to HashiCorp (faster init, no egress)
disable_checkpoint = true

# 3) Credentials for HCP Terraform / TFE (typically written by `terraform login`)
credentials "app.terraform.io" {
  token = "xxxxxx.atlasv1.zzzzz"
}

# 4) Provider installation (mirror / direct) — see section 5
provider_installation {
  filesystem_mirror {
    path    = "/opt/terraform/providers"
    include = ["registry.terraform.io/hetznercloud/*"]
  }
  direct {
    exclude = ["registry.terraform.io/hetznercloud/*"]
  }
}
```

> Tip: you do not have to put API tokens in the file — Terraform 1.2+ also reads host-specific env var `TF_TOKEN_app_terraform_io` (dots in hostname → underscores). Useful for CI where you do not want a `credentials` block on disk.

### OpenTofu equivalent

OpenTofu has its own CLI config file: **`.tofurc`** (or `tofu.rc` on Windows), override via `TOFU_CLI_CONFIG_FILE`. Same blocks (`plugin_cache_dir`, `provider_installation`, `disable_checkpoint`). For backward compatibility OpenTofu also reads `.terraformrc` if `.tofurc` does not exist. Detail → [opentofu.md](opentofu.md).

> Verified from developer.hashicorp.com/terraform/cli/config/config-file + opentofu.org/docs/cli/config/config-file.

---

## 5. Provider mirror (air-gapped / corporate CI)

Default is downloading providers from the registry (`registry.terraform.io`). A **provider mirror** replaces that with a local/corporate source. When it helps:

- **Locked-down build hosts** without egress to the internet (firewall rules, no registry access).
- **Speed / stability** — no dependency on registry availability for every CI run.
- **Supply-chain control** — providers only pass through a mirror you trust.

### Step 1: populate the mirror directory

`terraform providers mirror` downloads all providers from the current configuration and lays them out in the expected directory structure (`HOSTNAME/NAMESPACE/TYPE/...`):

```bash
terraform providers mirror \
  -platform=darwin_arm64 \
  -platform=linux_amd64 \
  -platform=linux_arm64 \
  ./tf-provider-mirror
```

Upload the resulting `./tf-provider-mirror` to the build host (e.g. `/opt/terraform/providers`) or to a static web server (it also creates a `.json` index for the network mirror protocol). Re-running the command with a new `-platform=...` incrementally fills the directory.

### Step 2: point the CLI at the mirror

```hcl
# .terraformrc on the build host
provider_installation {
  filesystem_mirror {
    path    = "/opt/terraform/providers"
    include = ["registry.terraform.io/*/*"]   # everything from the mirror
  }
  direct {
    exclude = ["registry.terraform.io/*/*"]   # nothing goes directly to the registry
  }
}
```

Two installation methods (combinable with `include`/`exclude`; `exclude` wins):

| Method | Argument | Use |
|---|---|---|
| `direct` | — | Download directly from origin registry (default). |
| `filesystem_mirror` | `path` | Local directory (packed `.zip` or unpacked layout). |
| `network_mirror` | `url` | HTTPS server implementing the network mirror protocol (must end with `/`). |

> **Network mirror = trust carefully:** a mirror with its own TLS certificate can serve modified providers. Never configure a `network_mirror` URL you do not trust (warning from HashiCorp docs).

### Step 3: lock against the mirror

With a mirror, `terraform init` does not contact the origin registry, so `.terraform.lock.hcl` lacks official signed checksums. Pre-populate them from the mirror:

```bash
terraform providers lock \
  -fs-mirror=/opt/terraform/providers \
  -platform=linux_amd64 \
  registry.terraform.io/hetznercloud/hcloud
```

> Verified from developer.hashicorp.com/terraform/cli/commands/providers/mirror + .../config/config-file (Provider Installation) + .../commands/providers/lock (`-fs-mirror`).

---

## 6. Dependency lock workflow in CI

Goal: CI **fails** when `.terraform.lock.hcl` is stale or init would want to change it — forcing the lock to always match the code and be committed.

```yaml
- name: Terraform init (lock readonly)
  run: terraform init -input=false -lockfile=readonly
```

`-lockfile=readonly` means: use exactly what is in the lock file and **do not modify** it. If `required_providers` in code requires something the lock does not cover (added/upgraded provider without updating the lock), init fails → the author must run `terraform init -upgrade` + `terraform providers lock -platform=...` locally and commit.

Recommended CI flow:

```yaml
- run: terraform fmt -check -recursive
- run: terraform init -input=false -lockfile=readonly
- run: terraform validate
- run: terraform plan -input=false -lock-timeout=60s -out=tfplan
```

> CI gates (fmt/validate/plan/policy), PR comments and `-lockfile=readonly` in a pipeline context → [policy-cicd.md](policy-cicd.md).

---

# PART B — Linting & editor tooling (extensions)

## 7. tflint plugin system

[tflint](https://github.com/terraform-linters/tflint) (terraform-linters/tflint, MPL-2.0, v0.62.x as of 2026-05) is a **pluggable linter** — the core is a framework and each capability comes as a plugin (ruleset). It finds more than `terraform validate`: deprecated syntax, unused declarations, naming conventions, and — with cloud rulesets — **deep checking** (e.g. validates instance types against the real provider API).

### Bundled "terraform" ruleset

Rules for the Terraform language itself (deprecated syntax, unused, naming) are **bundled** in tflint — nothing to install:

```hcl
# .tflint.hcl
plugin "terraform" {
  enabled = true
  preset  = "recommended"
}
```

### Cloud rulesets (per provider)

Deep validation for major clouds are separate plugins:

- `terraform-linters/tflint-ruleset-aws`
- `terraform-linters/tflint-ruleset-google`
- `terraform-linters/tflint-ruleset-azurerm`

Declare them in `.tflint.hcl` and download via `tflint --init`:

```hcl
plugin "aws" {
  enabled = true
  version = "0.43.0"
  source  = "github.com/terraform-linters/tflint-ruleset-aws"
}
```

### Hetzner / Cloudflare setup (no official cloud ruleset)

There is **no official tflint ruleset for Hetzner or Cloudflare** — so you do not get deep checking of instance types. For a Hetzner + Cloudflare project a sensible `.tflint.hcl` is: bundled terraform ruleset (catches deprecated/unused/naming) + optional community plugins from the [`tflint-ruleset` GitHub topic](https://github.com/topics/tflint-ruleset):

```hcl
# .tflint.hcl — Hetzner + Cloudflare project
config {
  call_module_type = "all"   # also lint called modules
  force            = false
}

# Bundled — no install needed, works immediately
plugin "terraform" {
  enabled = true
  preset  = "recommended"
}

# For providers without an official ruleset lean on bundled terraform rules
# (naming, unused, deprecated, required_version) + custom Rego rules via the OPA ruleset.
# plugin "opa" { enabled = true ... }  # terraform-linters/tflint-ruleset-opa
```

If the project also has AWS/GCP pieces (multi-cloud), add the matching cloud `plugin` block.

### Usage

```bash
tflint --init          # downloads declared plugins into ~/.tflint.d/
tflint                 # lint current directory
tflint --recursive     # including subdirectories (modules)
tflint --chdir=infra/  # specific directory
```

Docker (useful in CI without installing a binary):

```bash
docker run --rm -v "$(pwd):/data" -t --entrypoint /bin/sh \
  ghcr.io/terraform-linters/tflint -c "tflint --init && tflint"
```

GitHub Actions: use the official [`terraform-linters/setup-tflint`](https://github.com/terraform-linters/setup-tflint) action.

> Verified from github.com/terraform-linters/tflint README (latest v0.62.1, 2026-05-13) — `.tflint.hcl` plugin blocks, `preset = "recommended"`, `tflint --init`, bundled terraform ruleset.

---

## 8. terraform-ls + editor extensions

**HashiCorp Terraform Language Server (`terraform-ls`)** is the official LSP server. Editor extensions use it for: autocomplete (resource/attribute/provider), hover documentation, go-to-definition, format-on-save (`terraform fmt`), inline validation, and module symbol navigation.

| Editor | How | Notes |
|---|---|---|
| **VS Code / Cursor** | Extension **"HashiCorp Terraform"** (publisher HashiCorp) | Bundles terraform-ls; most used. Enable `editor.formatOnSave` for auto `terraform fmt`. |
| **JetBrains** (IntelliJ, GoLand…) | Built-in Terraform/HCL plugin | Works out of the box. |
| **Neovim** | `nvim-lspconfig` → `terraformls` (+ `tflint` as a separate LSP) | Requires `terraform-ls` on PATH. |

OpenTofu has a separate language server (from OpenTofu) — the VS Code "HashiCorp Terraform" extension is primarily Terraform, but `.tf` syntax is shared.

> Keep the extension/terraform-ls version current — completion relies on provider schemas downloaded during `terraform init`, so hover docs match the version in the lock file.

---

## 9. Pre-commit hooks

[`antonbabenko/pre-commit-terraform`](https://github.com/antonbabenko/pre-commit-terraform) (MIT, v1.105.x as of 2026-01) = a set of git hooks for the [pre-commit framework](https://pre-commit.com). It is the **local side** of the same gates that run in CI ([policy-cicd.md](policy-cicd.md)) — catches issues at commit time so CI does not fail on trivial things.

`.pre-commit-config.yaml`:

```yaml
repos:
  - repo: https://github.com/antonbabenko/pre-commit-terraform
    rev: v1.105.0   # latest tag: https://github.com/antonbabenko/pre-commit-terraform/releases
    hooks:
      - id: terraform_fmt
      - id: terraform_validate
      - id: terraform_tflint
        args:
          - --args=--config=__GIT_WORKING_DIR__/.tflint.hcl
      - id: terraform_docs            # auto-generates README input/output tables
      - id: terraform_trivy           # security scan (successor to tfsec)
      - id: terraform_checkov         # policy/security scan (Bridgecrew)
```

Install + run:

```bash
# one-time (pre-commit is a Python tool)
brew install pre-commit terraform-docs tflint trivy checkov

pre-commit install          # installs the git hook into .git/hooks/
pre-commit run -a           # runs on all files in the repo
```

Available hooks (selection): `terraform_fmt`, `terraform_validate`, `terraform_tflint`, `terraform_docs`, `terraform_trivy`, `terraform_checkov`, `terraform_providers_lock`, `terragrunt_fmt`. Can also run via Docker image `ghcr.io/antonbabenko/pre-commit-terraform`.

> **Division of labour:** pre-commit = local gate (fast feedback, developer commits clean code). CI = authoritative gate (`-lockfile=readonly`, plan, policy enforcement). Same tools, two layers.

> Verified from github.com/antonbabenko/pre-commit-terraform README (latest v1.105.0, 2026-01-06) — `repos:`/`rev:`/`hooks:` structure + hook IDs (terraform_fmt, terraform_docs, terraform_tflint, terraform_trivy, terraform_checkov).

---

# PART C — Custom provider development

## 10. When to write a custom provider (usually NO)

Write a custom provider **only** when:

- You manage an **internal API / company service** with no existing provider, and you want declarative `terraform plan/apply` with state management.
- A SaaS you use has **no** TF provider and you need full CRUD lifecycle management of its resources.

**Most of the time you do NOT need this.** A custom provider is a Go project with its own release/signing/maintenance cycle — a non-trivial commitment. **Try first:**

1. **`http` provider** (data source) — when a GET to an endpoint is enough.
2. **`restful` provider** (community, Azure/magodo) — generic CRUD over any REST API without writing Go.
3. **`external` data source** — shell-out to a script (section 13).
4. **Provider-defined functions** in an existing provider (section 13 + [core-hcl.md](core-hcl.md)).

Only when none of those suffice (complex lifecycle, drift detection, imports) should you write a custom provider.

---

## 11. terraform-plugin-framework

**terraform-plugin-framework** is HashiCorp's **recommended** SDK for new providers (Go, protocol v6 or v5). It replaces the older **SDKv2**, which is in **maintenance mode** (no major feature development, but still supported). Existing large providers can be migrated gradually via `terraform-plugin-mux`.

Why framework over SDKv2 (from official "Plugin framework benefits"):

- Separate packages per concept (`provider`, `resource`, `datasource`) instead of recursive `schema.Resource`.
- Unambiguous **null vs unknown** values (SDKv2 returned zero-value for both).
- **Interface** types → Go compiler catches a missing `Read()`/`Delete()` at build time (not only at runtime).
- Request/response pattern, fewer type assertions, `context.Context` everywhere.
- New capabilities: provider-defined **functions**, **ephemeral resources**, **actions**, dynamic attributes, list resources.

### Start: scaffolding template

Do not start from scratch — clone the official [`terraform-provider-scaffolding-framework`](https://github.com/hashicorp/terraform-provider-scaffolding-framework).

### Minimal skeleton (resource with CRUD)

```go
// internal/provider/thing_resource.go
package provider

import (
	"context"

	"github.com/hashicorp/terraform-plugin-framework/resource"
	"github.com/hashicorp/terraform-plugin-framework/resource/schema"
	"github.com/hashicorp/terraform-plugin-framework/types"
)

// Compile-time check: ThingResource satisfies the interface.
// If a method is missing (Read/Delete...), Go build FAILS.
var _ resource.Resource = &ThingResource{}

type ThingResource struct {
	client *ExampleAPIClient
}

type ThingModel struct {
	ID   types.String `tfsdk:"id"`
	Name types.String `tfsdk:"name"`
}

func NewThingResource() resource.Resource { return &ThingResource{} }

func (r *ThingResource) Metadata(ctx context.Context, req resource.MetadataRequest, resp *resource.MetadataResponse) {
	resp.TypeName = req.ProviderTypeName + "_thing"
}

func (r *ThingResource) Schema(ctx context.Context, req resource.SchemaRequest, resp *resource.SchemaResponse) {
	resp.Schema = schema.Schema{
		Attributes: map[string]schema.Attribute{
			"id":   schema.StringAttribute{Computed: true},
			"name": schema.StringAttribute{Required: true},
		},
	}
}

func (r *ThingResource) Create(ctx context.Context, req resource.CreateRequest, resp *resource.CreateResponse) { /* call API, set state */ }
func (r *ThingResource) Read(ctx context.Context, req resource.ReadRequest, resp *resource.ReadResponse)       { /* refresh from API */ }
func (r *ThingResource) Update(ctx context.Context, req resource.UpdateRequest, resp *resource.UpdateResponse) { /* PUT/PATCH */ }
func (r *ThingResource) Delete(ctx context.Context, req resource.DeleteRequest, resp *resource.DeleteResponse) { /* DELETE */ }
```

### Repo structure

```
terraform-provider-example/
├── main.go                       # providerserver.Serve(...)
├── internal/provider/
│   ├── provider.go               # provider.Provider impl, Resources()/DataSources()/Functions()
│   ├── thing_resource.go         # resource (CRUD above)
│   ├── thing_data_source.go      # data source (Read-only)
│   └── thing_resource_test.go    # acceptance tests
├── examples/                     # examples for docs generation
├── templates/                    # tfplugindocs templates
├── docs/                         # generated docs (registry reads these)
├── go.mod
└── .goreleaser.yml               # build + GPG signing for registry release
```

### Testing

**Acceptance tests** run via `terraform-plugin-testing` and call the real API — only when the env var is set:

```bash
TF_ACC=1 go test ./internal/provider/ -v -timeout 120m
```

(Without `TF_ACC=1` acceptance tests are skipped — protects against accidentally hitting real infra.)

### Documentation

`tfplugindocs` generates `docs/` from the provider schema + `examples/`:

```bash
go generate ./...    # typically calls: tfplugindocs generate
```

> Verified from developer.hashicorp.com/terraform/plugin/framework + .../plugin/which-sdk (framework = recommended, SDKv2 = maintenance, interface instead of declarative struct, request/response pattern, functions/ephemeral/actions).

---

## 12. Publish to the registry

### Public Terraform Registry

1. Repo must be **public on GitHub** and named `terraform-provider-{NAME}`.
2. Release via git tag `vX.Y.Z` (semver), typically GoReleaser → builds for all platforms + `*_SHA256SUMS` + `.sig`.
3. **GPG signing** is mandatory — the registry verifies the signature; upload the GPG public key in registry settings.
4. `terraform-registry-manifest.json` declares the supported protocol version (`5.0` or `6.0`).
5. The registry watches tags and publishes new versions automatically.

### Private / OpenTofu registry

- **Private registry** in HCP Terraform / Terraform Enterprise — internal providers without public publication.
- **OpenTofu registry** (`registry.opentofu.org`) has its own publication mechanism (PR into the registry repo, not automatic tag watching like Terraform) — detail → [opentofu.md](opentofu.md).
- Without a registry: distribute via **filesystem/network mirror** (section 5) — the provider works without publication.

---

## 13. Lighter alternatives to a full provider

Before writing a Go provider, consider these — they cover 80% of "I need to get something into TF that no provider supports":

| Tool | What it does | When |
|---|---|---|
| **provider-defined functions** (`provider::terraform::*`, `provider::<name>::*`) | Pure compute logic called from config | You need a transform/calculation, not a resource lifecycle. See [core-hcl.md](core-hcl.md). |
| **`external` data source** (`data "external"`) | Shell-out to a script that returns JSON on stdout | One-shot read of data from anything (script, CLI, internal API). Read-only, no state. |
| **`http` provider** (`data "http"`) | Plain HTTP GET, returns body/headers | You only need to read an endpoint (public JSON, IP lookup). |
| **`restful` provider** (community, `magodo/terraform-provider-restful`) | Generic CRUD over any REST API directly in HCL | Internal/SaaS REST API with CRUD, but you do not want to write a Go provider. |

Example `external` data source (shell-out):

```hcl
data "external" "git_sha" {
  program = ["bash", "-c", "echo '{\"sha\": \"'$(git rev-parse HEAD)'\"}'"]
}

output "deployed_sha" {
  value = data.external.git_sha.result.sha
}
```

> **Rule of thumb:** lifecycle management (create/update/delete + drift) of real resources → custom provider (section 11). One-shot read / compute / API call → `external` / `http` / `restful` / provider-defined function. A custom provider is the heaviest option — reach for it only when the others are not enough.

---

Sources: https://developer.hashicorp.com/terraform/cli/config/config-file, https://developer.hashicorp.com/terraform/cli/commands/providers/lock, https://developer.hashicorp.com/terraform/cli/commands/providers/mirror, https://github.com/terraform-linters/tflint, https://developer.hashicorp.com/terraform/plugin/framework, https://developer.hashicorp.com/terraform/plugin/which-sdk, https://github.com/antonbabenko/pre-commit-terraform, https://opentofu.org/docs/cli/config/config-file/, https://opentofu.org/docs/cli/plugins/
