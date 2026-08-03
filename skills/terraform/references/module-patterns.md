# Terraform — Module Design Patterns

## Recommended module structure

```
modules/hetzner-server/
├── main.tf          # Main resources
├── variables.tf     # Input variables
├── outputs.tf       # Output values
├── versions.tf      # required_version + required_providers
└── README.md        # terraform-docs auto-generates this
```

### versions.tf — provider requirements

```hcl
# modules/hetzner-server/versions.tf
terraform {
  required_version = ">= 1.6.0"
  required_providers {
    hcloud = {
      source  = "hetznercloud/hcloud"
      version = ">= 1.49.0"
    }
  }
}
```

### variables.tf — input validation

```hcl
variable "name" {
  type        = string
  description = "Server name (without prefix, module adds it)"

  validation {
    condition     = can(regex("^[a-z0-9-]+$", var.name))
    error_message = "Name must be lowercase alphanumeric with hyphens."
  }
}

variable "server_type" {
  type        = string
  description = "Hetzner server type"
  default     = "cx22"

  validation {
    condition     = contains(["cx22", "cx32", "cx42", "cx52", "ccx23"], var.server_type)
    error_message = "Invalid server type."
  }
}

variable "location" {
  type    = string
  default = "nbg1"

  validation {
    condition     = contains(["nbg1", "fsn1", "hel1", "ash", "hil"], var.location)
    error_message = "Invalid Hetzner location."
  }
}

variable "labels" {
  type        = map(string)
  description = "Additional labels (merged with module defaults)"
  default     = {}
}

variable "firewall_ids" {
  type        = list(number)
  description = "Firewall IDs to attach"
  default     = []
}
```

### main.tf — resource definitions

```hcl
locals {
  common_labels = merge(var.labels, {
    managed_by = "terraform"
    module     = "hetzner-server"
  })
}

resource "hcloud_server" "main" {
  name        = var.name
  image       = var.image
  server_type = var.server_type
  location    = var.location
  ssh_keys    = var.ssh_key_ids
  labels      = local.common_labels

  lifecycle {
    ignore_changes = [user_data]
  }
}

resource "hcloud_server_firewall" "main" {
  for_each    = toset(var.firewall_ids)
  server_id   = hcloud_server.main.id
  firewall_id = each.value
}
```

### outputs.tf

```hcl
output "id" {
  description = "Server ID"
  value       = hcloud_server.main.id
}

output "ipv4_address" {
  description = "Public IPv4 address"
  value       = hcloud_server.main.ipv4_address
}

output "ipv6_address" {
  description = "Public IPv6 address"
  value       = hcloud_server.main.ipv6_address
}

output "name" {
  description = "Server name"
  value       = hcloud_server.main.name
}
```

## Module Sources

```hcl
# 1. Local module (monorepo)
module "web_server" {
  source = "./modules/hetzner-server"
}

# 2. Git — specific version (recommended for sharing)
module "web_server" {
  source = "git::https://github.com/org/terraform-modules.git//hetzner-server?ref=v1.2.0"
}

# SSH:
module "web_server" {
  source = "git::ssh://git@github.com/org/terraform-modules.git//hetzner-server?ref=v1.2.0"
}

# 3. Terraform Registry (public)
module "eks" {
  source  = "terraform-aws-modules/eks/aws"
  version = "~> 20.0"
}

# 4. HCP Terraform (formerly Terraform Cloud) Private Registry
module "hetzner_cluster" {
  source  = "app.terraform.io/my-org/hetzner-cluster/hcloud"
  version = "~> 1.0"
}
```

## Module Composition Patterns

### Pattern 1: Root module calls child modules

```hcl
# infra/main.tf — root module

module "network" {
  source = "./modules/hetzner-network"

  name     = local.prefix
  location = var.location
}

module "web" {
  source = "./modules/hetzner-server"

  name        = "${local.prefix}-web"
  location    = var.location
  network_id  = module.network.id  # output from another module
  ssh_key_ids = [hcloud_ssh_key.default.id]
}

module "db" {
  source = "./modules/hetzner-server"

  name        = "${local.prefix}-db"
  server_type = "cx42"
  location    = var.location
  network_id  = module.network.id
}
```

### Pattern 2: For_each over modules (Terraform 1.1+)

```hcl
variable "services" {
  type = map(object({
    server_type = string
    location    = string
  }))
  default = {
    "web"    = { server_type = "cx22", location = "nbg1" }
    "worker" = { server_type = "cx32", location = "nbg1" }
    "db"     = { server_type = "cx42", location = "hel1" }
  }
}

module "services" {
  source   = "./modules/hetzner-server"
  for_each = var.services

  name        = "${local.prefix}-${each.key}"
  server_type = each.value.server_type
  location    = each.value.location
}

# Access: module.services["web"].ipv4_address
output "service_ips" {
  value = { for k, v in module.services : k => v.ipv4_address }
}
```

## Module Versioning

```
# Semantic versioning for modules
v1.0.0 — initial release
v1.1.0 — added support for placement groups (backward compatible)
v2.0.0 — breaking change: renamed variable server_size → server_type

# Git tags
git tag -a v1.2.0 -m "Add firewall support"
git push origin v1.2.0
```

Version constraints in the root module:
```hcl
module "web" {
  source  = "git::https://github.com/org/modules.git//hetzner-server?ref=v1.2.0"
  # Always pin to a concrete tag in production!
}
```

## Module Testing (Terraform 1.6+ / OpenTofu 1.6+)

```hcl
# modules/hetzner-server/tests/basic.tftest.hcl

provider "hcloud" {
  token = var.hcloud_token
}

# Mock provider (no real API calls)
mock_provider "hcloud" {}

variables {
  name        = "test-server"
  server_type = "cx22"
  location    = "nbg1"
}

run "basic_server_creation" {
  command = plan  # or apply (real resources)

  assert {
    condition     = hcloud_server.main.name == "test-server"
    error_message = "Server name doesn't match"
  }

  assert {
    condition     = hcloud_server.main.server_type == "cx22"
    error_message = "Server type doesn't match"
  }
}

run "invalid_server_type" {
  variables {
    server_type = "invalid-type"
  }

  expect_failures = [var.server_type]  # expect a validation error
}
```

```bash
# Run tests
tofu test                           # all tests
tofu test -filter=tests/basic.tftest.hcl  # specific test file
tofu test -verbose                  # detailed output
```

## terraform-docs — Auto-generated README

```bash
# Install
brew install terraform-docs

# Generate README.md
terraform-docs markdown table --output-file README.md ./modules/hetzner-server

# pre-commit hook
# .pre-commit-config.yaml:
repos:
  - repo: https://github.com/terraform-docs/terraform-docs
    rev: v0.18.0
    hooks:
      - id: terraform-docs-go
        args: ["markdown", "table", "--output-file", "README.md", "./"]
```

## Anti-patterns — when NOT to modularize

1. **Over-modularization** — one resource per module = unnecessary complexity
2. **Wrapper modules** — module only accepts and passes variables through = useless
3. **God module** — 50+ resources in one module = hard to debug
4. **Circular dependencies** — module A depends on module B output and vice versa

Right granularity: a module = a logical unit (server + firewall + SSH), not one resource and not the whole stack.

## `terraform test` Deep Dive (`.tftest.hcl`, native TF 1.6+ / OpenTofu 1.6+)

The native testing framework lives in `.tftest.hcl` files (default in the module directory or under `tests/`).
Each file contains one or more `run` blocks — sequential test steps that share state within a single file run.

### Anatomy of a `run` block

```hcl
# tests/server.tftest.hcl

# Global variables — apply to all run blocks in the file
variables {
  name        = "test-server"
  server_type = "cx22"
  location    = "nbg1"
}

run "creates_single_server" {
  command = plan   # plan = fast assertion without real apply | apply = real resources (auto teardown)

  # Per-run variables override globals
  variables {
    server_count = 3
  }

  assert {
    condition     = length(hcloud_server.main) == 3
    error_message = "Expected 3 servers, got ${length(hcloud_server.main)}"
  }

  assert {
    condition     = hcloud_server.main[0].server_type == "cx22"
    error_message = "Server type doesn't match cx22"
  }
}

run "validates_output" {
  command = plan

  assert {
    condition     = output.server_ips != null
    error_message = "Module must export server_ips output"
  }
}

# Test that a validation rule fails for invalid input
run "rejects_invalid_type" {
  command = plan

  variables {
    server_type = "invalid-type"
  }

  expect_failures = [var.server_type]   # expect a custom validation error on this variable
}
```

**Key blocks and attributes:**
- `command = plan|apply` — `plan` asserts planned values (fast, no infra); `apply` creates real resources and destroys them after the run.
- `assert { condition = ... error_message = ... }` — `condition` must be `true`, otherwise the test fails with `error_message`. Multiple `assert` blocks per `run`.
- `variables {}` — at file level (default for all `run`) and inside `run` (override).
- `mock_provider "name" {}` — fake provider, no real API calls / credentials (see granular mocking below).
- `expect_failures = [...]` — test PASSES only when the listed addresses (variable/resource/output) fail validation/precondition.

```bash
tofu test                              # runs all .tftest.hcl
tofu test -filter=tests/server.tftest.hcl
tofu test -verbose
```

## Granular Mocking — `override_resource` / `override_data` / `override_module` (TF 1.7+)

Test mocking is available from **Terraform 1.7.0+**. Beyond a whole `mock_provider`, you can mock a
**specific** resource, data source, or module — without a real apply and without mocking the entire provider.
Override blocks also work with real providers (they overwrite computed values at the target address).

- `override_resource` — overwrites resource values. Terraform does not call the underlying provider. Has `values {}`.
- `override_data` — overwrites data source values. Terraform does not call the underlying provider. Has `values {}`.
- `override_module` — overwrites **outputs** of an entire module. Terraform creates no resources inside. Has `outputs {}`.

All three can live at the root of a `.tftest.hcl`, inside a `run` block (local override wins),
and `override_resource`/`override_data` also inside `mock_provider`. The shared required attribute is `target`
(target address). `values`/`outputs` are optional — if missing, Terraform generates them.

```hcl
# tests/credentials.tftest.hcl

mock_provider "aws" {}

# Override a specific data source (root-level → applies to all run blocks)
override_data {
  target = module.credentials.data.aws_s3_object.data_bucket
  values = {
    body = "{\"username\":\"username\",\"password\":\"password\"}"
  }
}

run "uses_file_level_override" {
  assert {
    condition     = jsondecode(local_file.credentials_json.content).username == "username"
    error_message = "incorrect username"
  }
}

run "uses_run_level_override" {
  # Local override takes precedence over file-level
  override_data {
    target = module.credentials.data.aws_s3_object.data_bucket
    values = {
      body = "{\"username\":\"different\",\"password\":\"password\"}"
    }
  }

  assert {
    condition     = jsondecode(local_file.credentials_json.content).username == "different"
    error_message = "run-level override should win"
  }
}

# Override an entire module — outputs instead of values; no resources are created
run "overrides_whole_module" {
  override_module {
    target = module.credentials
    outputs = {
      data = { username = "username", password = "password" }
    }
  }

  assert {
    condition     = jsondecode(local_file.credentials_json.content).username == "username"
    error_message = "module override failed"
  }
}

# override_resource (analogous to override_data, but for a resource)
run "overrides_resource" {
  override_resource {
    target = hcloud_server.main
    values = {
      ipv4_address = "192.0.2.10"   # computed value, otherwise would be (known after apply)
    }
  }

  assert {
    condition     = hcloud_server.main.ipv4_address == "192.0.2.10"
    error_message = "resource override failed"
  }
}
```

Note: for repeated blocks / nested computed attributes you cannot set a value per instance — one set of
values applies to all instances in the collection. Optional attribute `override_during = plan|apply` controls when
mock data is generated (inherits from `mock_provider`).

## Terratest (Go) — Integration Testing with Real Infrastructure

[Terratest](https://terratest.gruntwork.io/) (Gruntwork) is an **external** Go library and the most widely used
framework for **integration** testing of IaC. Unlike native `terraform test` (plan-level assertions,
no Go), it actually **spins up infra, verifies it via HTTP/SSH/cloud API, then tears it down**. Requires Go (≥1.26).

Workflow: write `*_test.go`, use `terraform.InitAndApply` → assert via `terraform.Output` + testify →
`defer terraform.Destroy` ensures teardown even on failure.

```go
// test/server_test.go
package test

import (
    "testing"

    "github.com/gruntwork-io/terratest/modules/terraform"
    "github.com/stretchr/testify/assert"
)

func TestHetznerServerModule(t *testing.T) {
    opts := &terraform.Options{
        TerraformDir: "../examples/hetzner-server",
        Vars: map[string]interface{}{
            "name":        "terratest-server",
            "server_type": "cx22",
        },
    }

    // Teardown at the end — even if the test fails
    defer terraform.Destroy(t, opts)

    // Real: terraform init + apply
    terraform.InitAndApply(t, opts)

    // Read output and assert
    publicIP := terraform.Output(t, opts, "public_ip")
    assert.NotEmpty(t, publicIP)
}
```

```bash
cd test
go mod init github.com/org/modules    # first time
go mod tidy
go test -v -timeout 30m               # high timeout — Go default 10m kills teardown too
```

### When Terratest vs native `terraform test`

| Criterion | `terraform test` (native) | Terratest (Go) |
|-----------|----------------------------|----------------|
| Language | HCL (`.tftest.hcl`), no Go | Go (`*_test.go`) |
| Speed | Fast (`command = plan`) | Slow (real apply + teardown) |
| What it verifies | Planned/applied values, outputs, validation | Real infra: HTTP, SSH, cloud API, multi-step |
| Mocking | `mock_provider`, `override_*` (no infra) | Real cloud resources (no mocks) |
| WHEN | Fast plan/apply assertions, module logic validation, no cloud credentials | Real cloud integration, end-to-end check that a server actually responds, multi-step orchestration |
| Cost | $0 (plan) | Real cloud cost + longer runtime |

Rule of thumb: native `terraform test` as the default for module logic (fast, cheap, always in CI);
add Terratest for critical modules where you need to prove **real infra actually works**
(server answers on a port, SSH succeeds, load balancer routes).
