# OpenTofu — BSL-Free Terraform Fork

## What is OpenTofu

OpenTofu was created in August 2023 in response to HashiCorp moving Terraform from open-source MPL-2.0
to the Business Source License (BSL). BSL forbids use in competitive products.

- **Steward:** Linux Foundation (under the OpenTF Pledge)
- **License:** Mozilla Public License 2.0 (truly open source)
- **Compatibility:** State files compatible with Terraform (same format)
- **CLI:** `tofu` instead of `terraform` (same arguments)
- **Status (2026):** Active development, **OpenTofu 1.12** (released 2026-05-14), faster release cycle than Terraform. 20M+ downloads, mature ecosystem (official VS Code extension, `tofu-ls` LSP, MCP server)

## When to choose OpenTofu vs Terraform

| Situation | Choice |
|---------|-------|
| **New project in 2026** | **Consider OpenTofu** — neutral governance (Linux Foundation), truly open source (MPL-2.0), feature parity + OpenTofu-only features (state encryption, `enabled`, `.tofu`) |
| New project, open-source stack | OpenTofu |
| HCP Terraform / Terraform Enterprise (IBM) | Terraform |
| BSL problem (competitive product) | OpenTofu |
| Existing Terraform state | Either — they are compatible |
| Need state encryption | OpenTofu (built-in) |
| Conditional resource without `count` hack | OpenTofu (`enabled` meta-arg) |
| Ecosystem stability (corporate, IBM support) | Terraform |

### Licensing reality (2026)

> **IBM completed the HashiCorp acquisition — closed February 2025.** Terraform is now under IBM.
> For 2026 decision-making that means:
> - **Terraform** = IBM, license **BSL 1.1** (source-available, NOT open source). Forbidden for use
>   in "competitive" products. Enterprise stability + IBM support, but closed governance.
> - **OpenTofu** = **Linux Foundation** (neutral governance), license **MPL-2.0** (truly open source).
>   Community RFC process, faster release cycle, several OpenTofu-only features.
>
> **Rationale for a new 2026 project → OpenTofu:** neutral stewardship + open source + achieved feature
> parity (ephemeral/write-only/OCI/native S3 lock) + differentiators Terraform lacks
> (state encryption, `enabled` meta-arg, `.tofu` extension). State remains mutually compatible —
> migration is reversible, so lock-in risk is low.

## Key differences: OpenTofu vs Terraform

| Feature | OpenTofu | Terraform |
|---------|----------|-----------|
| State encryption | **Native (1.7+)** — OpenTofu-only | Only via external solutions |
| `enabled` meta-arg | **Yes (1.11+)** — OpenTofu-only | No (only `count = … ? 1 : 0`) |
| `.tofu` / `.tofu.json` ext | **Yes (1.8+)** — OpenTofu-only | No |
| Native S3 state locking | Yes (1.10+, `use_lockfile`) | Yes (1.10+, `use_lockfile`) |
| Ephemeral resources / write-only | Yes (1.11+) | Yes (1.10/1.11) |
| OCI Registry | Yes (1.8+) | Yes (1.13+) |
| Provider-defined functions | Yes (1.8+) | Yes (1.8+) |
| Early variable evaluation | Yes (1.8+) | No (limited) |
| Provider source | registry.opentofu.org | registry.terraform.io |
| `tofu` CLI | Yes | No (`terraform`) |
| License | **MPL-2.0** (open source) | **BSL 1.1** (source-available) |
| Governance | Linux Foundation (neutral) | IBM (HashiCorp acquisition, Feb 2025) |
| Test framework | Yes (1.6+, identical) | Yes (1.6+) |
| Import / moved / removed blocks | Yes | Yes |
| Speed | Similar | Similar |

## Installation

```bash
# macOS
brew install opentofu

# Linux
curl --proto '=https' --tlsv1.2 -fsSL https://get.opentofu.org/install-opentofu.sh | sh

# mise (version manager)
mise install opentofu
mise use opentofu@1.12.0

# tofuenv (similar to tfenv)
brew install tofuenv
tofuenv install 1.12.0
tofuenv use 1.12.0
```

## Migrating from Terraform to OpenTofu

Migration is reversible — state files are compatible.

```bash
# 1. Back up state
terraform state pull > backup-$(date +%Y%m%d).json

# 2. Install OpenTofu
brew install opentofu

# 3. Migrate (one-shot command)
tofu init -upgrade    # reinstalls providers from the OpenTofu registry

# 4. Verify
tofu plan    # should return "No changes"

# 5. Update .terraform.lock.hcl
# Delete the old lockfile and let tofu init regenerate it:
rm .terraform.lock.hcl
tofu init

# 6. Update CI/CD
# - replace hashicorp/setup-terraform with opentofu/setup-opentofu
# - replace "terraform" with "tofu" in commands
```

Note: terraform and tofu use the same state format — you can switch back at any time.

## State Encryption (OpenTofu 1.7+)

The biggest differentiator. Encrypts state at rest (in the backend) and in transit.

```hcl
# versions.tf — encryption configuration
terraform {
  encryption {
    # Encryption method
    method "aes_gcm" "my_method" {
      keys = key_provider.pbkdf2.my_key
    }

    # Key provider — from passphrase (simple)
    key_provider "pbkdf2" "my_key" {
      passphrase = var.state_encryption_passphrase
    }

    # State encryption
    state {
      method   = method.aes_gcm.my_method
      enforced = true  # rejects unencrypted state
    }

    # Plan encryption (optional)
    plan {
      method = method.aes_gcm.my_method
    }
  }
}
```

Key providers:
- **pbkdf2** — from passphrase (simple setup, fine for small teams)
- **aws_kms** — AWS KMS key (enterprise, rotation support)
- **gcp_kms** — Google Cloud KMS
- **openbao** — OpenBao / HashiCorp Vault

```hcl
# AWS KMS example
key_provider "aws_kms" "main" {
  kms_key_id = "arn:aws:kms:eu-central-1:123456789:key/my-key-id"
  region     = "eu-central-1"
}
```

Encrypted state looks like a base64 blob — not readable without the key.

## OCI Registry (OpenTofu 1.8+)

OpenTofu added support for OCI (Open Container Initiative) registries for providers and modules.
Enables a self-hosted provider registry (without depending on registry.opentofu.org).

```hcl
# versions.tf — OCI provider source
terraform {
  required_providers {
    hcloud = {
      source  = "oci://ghcr.io/hetznercloud/hcloud-terraform-provider"
      version = "~> 1.49"
    }
  }
}
```

Useful for: air-gapped environments, enterprises with a private registry, mirroring providers.

## OpenTofu 1.12 (May 2026, latest)

- **Dynamic `prevent_destroy`** — the argument in a `lifecycle` block can now reference other symbols
  in the same module (e.g. an input variable), instead of a hardcoded `true`/`false`. Enables a shared module
  where production protects the DB against deletion and dev does not:
  ```hcl
  variable "prevent_destroy_database" {
    type    = bool
    default = true
  }
  resource "example_database" "example" {
    lifecycle {
      prevent_destroy = var.prevent_destroy_database
    }
  }
  ```
- **Provider checksum improvements** — `tofu init` now automatically downloads a complete set of checksums
  (`zh:` and `h1:`) for all platforms from the OpenTofu Registry. `tofu providers lock` is no longer needed
  for the default install flow — only for alternative install sources (custom mirror/registry).
- **`-json-into=FILENAME`** — machine-readable JSON output can be written to a file/named pipe
  simultaneously with normal human-readable output on stdout (previously `-json` replaced the entire UI output).
- **`destroy = false` lifecycle meta-arg** — removes a resource from state without destroying the real object
  (adoption/hand-off scenarios).
- **Provider installer performance** — concurrent requests when installing multiple providers → faster `tofu init`.
- **Deprecations:** WinRM in provisioner `connection` blocks is deprecated (removal planned
  in 1.13); 32-bit CPU architectures (386/arm) are being phased out of official builds.

## OpenTofu 1.11 (December 2025)

### Ephemeral resources + write-only attributes (parity with TF)

Ephemeral values exist only in memory during a single OpenTofu phase — they are NEVER stored in the state
snapshot or plan file. Use cases: temporary credentials (e.g. time-limited AWS keys from OpenBao),
temporary SSH tunnels for providers.

```hcl
# Write-only attribute — value is used only on change, not stored in state
resource "some_db" "main" {
  # ...
  admin_password_wo         = var.db_password   # write-only (suffix _wo per provider)
  admin_password_wo_version = 1                 # bump = trigger update
}
```

Functional parity with Terraform (TF 1.10/1.11). Detail: `Ephemerality` in the OpenTofu docs.

### `enabled` meta-argument (OpenTofu-ONLY — NOT in Terraform)

**Important differentiator.** A cleaner way to conditionally create/skip a SINGLE instance of a resource
or module — without the `count = var.x ? 1 : 0` hack and without `[0]` indexing. Lives inside a `lifecycle` block.

```hcl
variable "create_instance" {
  type    = bool
  default = true
}

resource "aws_instance" "example" {
  # ...
  lifecycle {
    enabled = var.create_instance   # false → resource is not created, evaluates to null
  }
}

# A module can be disabled the same way
module "servers" {
  source = "./app-cluster"
  lifecycle {
    enabled = var.enable_cluster
  }
}

# Access (resource may be null):
output "instance_id" {
  value = aws_instance.example != null ? aws_instance.example.id : "not-created"
}
```

- **Migrating from `count`:** OpenTofu automatically moves state from `aws_instance.example[0]` to
  `aws_instance.example` — no `moved` block or manual state manipulation.
- **Restrictions:** cannot combine with `count`/`for_each`; value must be a known, non-null,
  non-sensitive, non-ephemeral **bool**.

## OpenTofu 1.10 (June 2025)

- **Native S3 state locking** — without DynamoDB. Locking via conditional writes (`If-None-Match` header):
  ```hcl
  terraform {
    backend "s3" {
      bucket       = "myapp-tfstate"
      key          = "prod/terraform.tfstate"
      region       = "eu-central-1"
      use_lockfile = true    # native S3 lock instead of dynamodb_table
    }
  }
  ```
- **OpenTofu Registry MCP server** — `https://mcp.opentofu.org/mcp` (or local). AI assistants
  (Claude, Cursor) read current provider/module docs → more accurate IaC generation.
- **OpenTelemetry tracing** — local-only observability for debugging and performance analysis.
- Other: OCI registry support, deprecation attributes (variables/outputs), `-target-file`/`-exclude-file`,
  global provider cache lock, external key providers for state encryption.

## `.tofu` / `.tofu.json` extension (OpenTofu 1.8+, OpenTofu-only)

OpenTofu reads `.tofu` (or `.tofu.json`) files and, if they exist, they **override** the corresponding `.tf`
— enables OpenTofu-specific code that Terraform ignores (Terraform does not read `.tofu`).

## Provider-defined functions + early variable evaluation (OpenTofu 1.8+)

- **Provider-defined functions** — providers can export custom functions called as
  `provider::<name>::<func>(...)`. Parity with Terraform (both 1.8+).
- **Early variable evaluation** — variables can be used in `backend`/`module source`/`required_providers`
  blocks (evaluated early). OpenTofu has broader support than TF.

## OpenTofu Registry

OpenTofu has its own registry (registry.opentofu.org) that mirrors the Terraform registry.
Most providers are available on both.

```hcl
# Explicit OpenTofu registry (default, no need to specify)
terraform {
  required_providers {
    hcloud = {
      source  = "registry.opentofu.org/hetznercloud/hcloud"
      # short form (works the same):
      # source = "hetznercloud/hcloud"
      version = "~> 1.49"
    }
  }
}
```

## GitHub Actions with OpenTofu

```yaml
# Instead of hashicorp/setup-terraform
- uses: opentofu/setup-opentofu@v1
  with:
    tofu_version: "1.12.0"
    tofu_wrapper: true    # wraps output for GitHub Actions
```

## Community Resources

- **Docs:** https://opentofu.org/docs/
- **Registry:** https://registry.opentofu.org/
- **GitHub:** https://github.com/opentofu/opentofu
- **Slack:** opentofu.org/slack
- **Blog:** opentofu.org/blog (release notes, features)
- **Migration guide:** opentofu.org/docs/intro/migration/
- **MCP server:** https://mcp.opentofu.org/mcp (provider/module docs for AI assistants)
