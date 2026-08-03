---
name: terraform
description: >-
  Terraform / OpenTofu Infrastructure as Code skill. Covers HCL syntax, state management,
  module design, multi-environment strategy, cloud and DNS providers (VM provisioning,
  Cloudflare, AWS, GCP, Kubernetes, Helm), policy-as-code (Checkov, tfsec, OPA), CI/CD
  integration (GitHub Actions, Atlantis), and complementary tooling (Terragrunt, Infracost,
  terraform-docs). Triggers: terraform, opentofu, tofu, infrastructure as code, iac,
  terraform plan, terraform apply, terraform state, tfstate, terraform module, terraform
  provider, terraform workspace, terragrunt, terraform cloud, spacelift, atlantis,
  terraform cloudflare, terraform aws, terraform kubernetes, terraform helm, hcl,
  terraform import, terraform moved, tfsec, checkov, infracost, terraform ci/cd,
  terraform github actions, terraform best practices, terraform troubleshoot,
  terraform multi-environment, terraform remote backend, terraform drift, tofu state,
  terraform policy, ephemeral resources, write-only arguments, removed block, check block,
  terraform_data, terraform test, terratest, sentinel, terragrunt stacks, S3 native locking,
  HCP terraform, provider-defined functions, plugin cache, provider mirror, .terraformrc,
  terraform providers lock, tflint plugin, terraform-ls, pre-commit terraform,
  custom provider, terraform-plugin-framework, secrets terraform. Not for: application
  deployment inside Kubernetes, or cloud-provider CLI usage without Terraform.
---

# Terraform / OpenTofu

Infrastructure as Code for a classic VM-based production stack: provisioning virtual machines
(nginx, PHP, Node.js, MySQL, supervisor, SSL, monitoring), DNS, and supporting cloud resources.

## Topic Map

| Topic | Reference file |
|------|-----------------|
| HCL syntax, resources, expressions, dynamic blocks, lifecycle | [core-hcl.md](references/core-hcl.md) |
| Remote backends, state operations, import, drift | [state-management.md](references/state-management.md) |
| Module structure, composition, versioning, testing | [module-patterns.md](references/module-patterns.md) |
| Workspaces, Terragrunt, tfvars, environment promotion | [multi-environment.md](references/multi-environment.md) |
| Cloud VM, Cloudflare, GCP, Kubernetes, Helm providers | [providers-multicloud.md](references/providers-multicloud.md) |
| Checkov, tfsec, OPA, GitHub Actions, Atlantis, OIDC | [policy-cicd.md](references/policy-cicd.md) |
| OpenTofu — fork status, state encryption, migration | [opentofu.md](references/opentofu.md) |
| Plugin management (cache/mirror/.terraformrc), tflint plugins, custom provider dev | [plugins-extensions.md](references/plugins-extensions.md) |
| Dependency cycles, state recovery, timeouts, import | [troubleshooting.md](references/troubleshooting.md) |

## Terraform vs OpenTofu — quick decision

| Situation | Recommendation |
|---------|-----------|
| New project | OpenTofu (BSL-free, active development, state encryption) |
| Existing Terraform state | Stay on Terraform or migrate — compatible |
| HCP Terraform (formerly Terraform Cloud) / Enterprise | Terraform (native) or Spacelift (multi-tool) |
| Self-hosted, open-source stack | OpenTofu + Atlantis |
| CI/CD without a platform | OpenTofu + GitHub Actions + OIDC |

## Quick Setup (new project)

```bash
# 1. Install (macOS example; Linux packages are available for all of these)
brew install opentofu        # or: brew install terraform
brew install terragrunt      # DRY wrapper (optional)
brew install tflint          # linting
brew install checkov         # security scanning
brew install infracost       # cost estimation
pip install pre-commit       # pre-commit hooks

# 2. Project structure
mkdir -p infra/{modules,environments/{staging,prod}}

# 3. Initialize
cd infra
tofu init    # or: terraform init
```

## Recommended project structure

```
infra/
├── main.tf              # Root module — resources
├── variables.tf         # Input variables
├── outputs.tf           # Outputs
├── versions.tf          # Provider and terraform version constraints
├── backend.tf           # Remote backend configuration
├── terraform.tfvars     # Default values (DO NOT COMMIT if it contains secrets)
├── staging.tfvars       # Staging-specific values
├── prod.tfvars          # Prod-specific values
│
├── modules/             # Reusable modules
│   ├── web-server/
│   │   ├── main.tf
│   │   ├── variables.tf
│   │   ├── outputs.tf
│   │   └── versions.tf
│   └── dns-zone/
│       ├── main.tf
│       ├── variables.tf
│       └── outputs.tf
│
└── environments/        # Alternative: per-env dirs instead of workspaces
    ├── staging/
    │   ├── main.tf      # module calls
    │   └── terraform.tfvars
    └── prod/
        ├── main.tf
        └── terraform.tfvars
```

## Core Workflow

```bash
# Daily work
tofu fmt -recursive          # formatting
tofu validate                # syntax check
tflint --recursive           # linting
tofu plan -out=tfplan        # plan (always save to a file)
tofu apply tfplan            # apply only from the saved plan

# Safe destroy
tofu plan -destroy -out=destroy-plan
tofu apply destroy-plan

# Refresh state (no changes)
tofu plan -refresh-only
tofu apply -refresh-only

# Specific resource
tofu plan -target=aws_instance.web
tofu apply -target=aws_instance.web   # WARNING: use only during recovery
```

## State — where to store it

| Backend | When | Benefits |
|---------|-----|--------|
| S3 + DynamoDB (or S3 native locking, TF 1.10+) | AWS projects | Native, locking |
| GCS | GCP projects | Native |
| PostgreSQL | Self-hosted stack | Any managed Postgres, no AWS dependency |
| HCP Terraform (formerly Terraform Cloud) | Enterprise | UI, RBAC, remote runs, Stacks |
| OpenTofu + encrypted state | New project | At-rest encryption built in |

Postgres backend example (any managed PostgreSQL):
```hcl
terraform {
  backend "pg" {
    conn_str = "postgres://user:pass@db.example.com/terraform_state"
  }
}
```

## Provider Quick Reference

| Provider | Registry slug | Primary auth |
|----------|--------------|-------------|
| DigitalOcean | `digitalocean/digitalocean` | `DIGITALOCEAN_TOKEN` env var |
| Cloudflare | `cloudflare/cloudflare` | `CLOUDFLARE_API_TOKEN` env var |
| AWS | `hashicorp/aws` | `AWS_*` env vars or OIDC |
| Google Cloud | `hashicorp/google` | `GOOGLE_CREDENTIALS` or Workload Identity |
| Kubernetes | `hashicorp/kubernetes` | kubeconfig or in-cluster |
| Helm | `hashicorp/helm` | kubeconfig or in-cluster |

Detailed examples → [providers-multicloud.md](references/providers-multicloud.md)

## VM + DNS — basic pattern (classic VM stack)

Provisioning a production VM plus a proxied DNS record. The example uses DigitalOcean for the
VM and Cloudflare for DNS — swap the VM provider for your own cloud; the pattern is identical.

```hcl
# versions.tf
terraform {
  required_version = ">= 1.10"   # 1.10+ for ephemeral resources, write-only args, S3 native locking
  required_providers {
    digitalocean = {
      source  = "digitalocean/digitalocean"
      version = "~> 2.0"
    }
    cloudflare = {
      source  = "cloudflare/cloudflare"
      version = "~> 5.0"
    }
  }
  backend "pg" {}               # partial config; supply credentials during init
}

provider "digitalocean" {
  token = var.do_token
}

provider "cloudflare" {
  api_token = var.cloudflare_api_token
}

# main.tf — server with DNS
resource "digitalocean_droplet" "web" {
  name     = "${var.project}-${var.env}-web"
  image    = "ubuntu-24-04-x64"
  size     = "s-2vcpu-4gb"
  region   = "fra1"
  ssh_keys = [digitalocean_ssh_key.default.id]

  tags = [var.project, var.env, "managed-by-terraform"]
}

resource "cloudflare_dns_record" "web" {   # v5: cloudflare_record → cloudflare_dns_record
  zone_id = var.cloudflare_zone_id
  name    = var.env == "prod" ? "app.example.com" : "app-stg.example.com"  # v5: FQDN
  content = digitalocean_droplet.web.ipv4_address  # v5: value → content
  type    = "A"
  ttl     = 1                                # v5: number, 1 = auto (required when proxied)
  proxied = true
}
```

Backend blocks are initialized before normal input variables, so `var.*` is not available there.
Keep the connection string in a local, secret-managed file that is excluded from Git, then pass it
explicitly during initialization:

```hcl
# backend.pg.hcl — do not commit
conn_str = "postgres://terraform:secret@state-db.example.com/terraform_state"
```

```bash
terraform init -backend-config=backend.pg.hcl
```

> **Cloudflare provider v5** has breaking changes vs v4 — `cloudflare_dns_record`,
> `content` instead of `value`, FQDN names, `cloudflare_zone_setting` per-setting,
> `cloudflare_zero_trust_tunnel_cloudflared`. Migration: `cloudflare/tf-migrate` CLI.
> Details + examples → `references/providers-multicloud.md`.

## Security Rules

- **NEVER** commit `terraform.tfstate` or `*.tfvars` containing secrets to Git
- **ALWAYS** use `sensitive = true` for secrets in variables and outputs
- Secrets come from environment variables or a secrets manager (e.g. Vault), NOT from tfvars files
- Remote backend is mandatory for team work (locking)
- OIDC auth in CI/CD — no static credentials
- Run `checkov` / `trivy config .` regularly before apply

## Known Gotchas

1. **Terraform plan is only an estimate** — the provider may return different results than the plan shows
2. **-target is dangerous** — it can create inconsistent state; use only during recovery
3. **count vs for_each** — count shifts indexes on deletion (re-indexes), for_each does not → prefer for_each
4. **depends_on on data sources** — increases latency; use only when there is a real dependency
5. **Sensitive outputs** — even with `sensitive = true` they are visible in the state file (encrypt state!)
6. **terraform refresh** is deprecated — use `plan -refresh-only` + `apply -refresh-only`
7. **taint** is deprecated — use `terraform apply -replace=resource.name`
8. **Workspaces don't share modules** — each workspace is isolated; for team dev prefer per-env dirs
9. **Provider upgrades** — always commit `.terraform.lock.hcl` to Git (guarantees deterministic builds)
10. **State locking (DynamoDB)** — a crashed apply leaves the lock behind; force-unlock only after verifying

## Cost estimation

Estimate infrastructure cost before apply: `infracost breakdown --path .`
Wire it into CI to comment cost diffs on pull requests (see `references/policy-cicd.md`).

## Reference Files Index

| File | Content |
|--------|-------|
| [core-hcl.md](references/core-hcl.md) | HCL syntax, resources, expressions, dynamic blocks, lifecycle |
| [state-management.md](references/state-management.md) | Backends, locking, import, moved, drift |
| [module-patterns.md](references/module-patterns.md) | Module structure, composition, versioning, testing |
| [multi-environment.md](references/multi-environment.md) | Workspaces, Terragrunt, tfvars, env promotion |
| [providers-multicloud.md](references/providers-multicloud.md) | Cloud VM, Cloudflare, GCP, K8s, Helm providers |
| [policy-cicd.md](references/policy-cicd.md) | Checkov, tfsec, GitHub Actions, Atlantis, OIDC |
| [opentofu.md](references/opentofu.md) | OpenTofu, state encryption, enabled meta-arg, migration |
| [plugins-extensions.md](references/plugins-extensions.md) | Plugin cache/mirror, .terraformrc, tflint plugins, terraform-ls, pre-commit, custom provider (plugin-framework) |
| [troubleshooting.md](references/troubleshooting.md) | Common issues, recovery, import workflow |

Sources: https://developer.hashicorp.com/terraform/docs, https://opentofu.org/docs, https://registry.terraform.io/providers/digitalocean/digitalocean/latest/docs, https://registry.terraform.io/providers/cloudflare/cloudflare/latest/docs, https://terragrunt.gruntwork.io/docs/, https://www.checkov.io/, https://runatlantis.io/docs/, https://infracost.io/docs/
