# Terraform — Multi-Environment Strategy

## Workspaces vs Directory Structure — choosing

| | Workspaces | Per-env directories |
|---|---|---|
| **Principle** | One codebase, multiple state files | Code duplication, separate state |
| **Isolation** | Weaker (shares code) | Strong (separate lifecycle) |
| **Best for** | Identical environments | Substantially different environments |
| **Risk** | `terraform.workspace` conditionals → spaghetti | Duplication → drift between environments |
| **Terraform docs recommendation** | Only for identical environments | Preferred for staging/prod |

**Recommendation for most projects:** Per-env directories + Terragrunt.

## Workspaces

Basic operations:

```bash
tofu workspace new staging
tofu workspace new prod
tofu workspace select staging
tofu workspace list
tofu workspace show      # current workspace
tofu workspace select default
tofu workspace delete staging
```

Usage in code:
```hcl
locals {
  is_prod = terraform.workspace == "prod"

  server_type_map = {
    staging = "cx22"
    prod    = "cx42"
  }

  config = {
    server_type = local.server_type_map[terraform.workspace]
    replicas    = local.is_prod ? 3 : 1
    domain      = local.is_prod ? "app.example.com" : "app-stg.example.com"
  }
}

resource "hcloud_server" "web" {
  count       = local.config.replicas
  name        = "${terraform.workspace}-web-${count.index}"
  server_type = local.config.server_type
}
```

Workspace state isolation in S3:
```
s3://terraform-state/
  env:/staging/terraform.tfstate
  env:/prod/terraform.tfstate
  terraform.tfstate  (default workspace)
```

## Per-Environment Directories

```
infra/
├── modules/              # shared modules
│   ├── hetzner-server/
│   └── cloudflare-zone/
├── environments/
│   ├── staging/
│   │   ├── main.tf       # module calls
│   │   ├── variables.tf
│   │   ├── outputs.tf
│   │   ├── backend.tf    # separate backend
│   │   └── terraform.tfvars
│   └── prod/
│       ├── main.tf
│       ├── variables.tf
│       ├── outputs.tf
│       ├── backend.tf
│       └── terraform.tfvars
└── shared/               # shared resources
    ├── main.tf
    └── backend.tf
```

## tfvars Per Environment

```hcl
# common.tfvars
project  = "myapp"
location = "nbg1"

# staging.tfvars
environment  = "staging"
server_type  = "cx22"
server_count = 1
domain       = "app-stg.example.com"

# prod.tfvars
environment  = "prod"
server_type  = "cx42"
server_count = 3
domain       = "app.example.com"
```

Usage:
```bash
tofu plan -var-file="common.tfvars" -var-file="staging.tfvars"
tofu apply -var-file="common.tfvars" -var-file="prod.tfvars"
```

Variable precedence (higher number = higher priority):
1. Default values in the variable block
2. terraform.tfvars
3. *.auto.tfvars (alphabetically)
4. -var-file CLI flag
5. -var CLI flag
6. Environment variables (TF_VAR_name)

## Terragrunt — DRY Multi-Environment

Terragrunt eliminates HCL code duplication across environments.

```bash
brew install terragrunt
```

### Structure with Terragrunt

```
infra/
├── terragrunt.hcl           # root configuration
├── modules/
│   └── hetzner-server/
└── environments/
    ├── staging/
    │   ├── terragrunt.hcl   # env overrides
    │   └── web/
    │       └── terragrunt.hcl
    └── prod/
        ├── terragrunt.hcl
        └── web/
            └── terragrunt.hcl
```

### Terragrunt commands

```bash
# In a specific service directory
cd environments/staging/web
terragrunt plan
terragrunt apply
terragrunt destroy

# Bulk operations (multi-unit)
terragrunt run --all plan
terragrunt run --all apply

# Dependency graph
terragrunt dag graph
```

> **CLI Redesign (Terragrunt v0.78+ → v1.0):** Commands were renamed (issue #3445).
> `run-all` → **`run --all`** (deprecated, still works with a warning), `graph-dependencies` → `dag graph`,
> `hclfmt` → `hcl fmt`, `hclvalidate` → `hcl validate`. Flags lost the `terragrunt-` prefix
> (`--terragrunt-non-interactive` → `--non-interactive`), env vars `TERRAGRUNT_*` → `TG_*`.
> Shortcuts (`terragrunt plan`, `terragrunt apply`) still work. For non-shortcut commands:
> `terragrunt run -- workspace ls`. Backend auto-bootstrap is NO LONGER the default — add `--backend-bootstrap`.

## Terragrunt Stacks (terragrunt.stack.hcl) — modern orchestration

> **Headline feature 2024-2026.** A stack = a collection of related **units** (= module instances)
> managed together. `terragrunt.stack.hcl` is a *blueprint* that programmatically generates
> Terragrunt configuration at runtime. Solves the DRY problem for repetitive environment patterns.

### unit / stack blocks

```hcl
# live/terragrunt.stack.hcl
unit "vpc" {
  source = "git::git@github.com:acme/infra-catalog.git//units/vpc?ref=v0.0.1"
  path   = "vpc"                       # where it is generated (relative to .terragrunt-stack)
  values = {                           # passed into the unit via values.*
    vpc_name = "main"
    cidr     = "10.0.0.0/16"
  }
}

unit "database" {
  source = "git::git@github.com:acme/infra-catalog.git//units/database?ref=v0.0.1"
  path   = "database"
  values = {
    engine   = "postgres"
    version  = "13"
    vpc_path = "../vpc"
  }
}
```

- **`unit "x" {}`** — one deployable piece of infrastructure (VPC, DB, app). Generates a directory
  with one `terragrunt.hcl` + `terragrunt.values.hcl`.
- **`stack "x" {}`** — reusable multi-unit pattern (e.g. a whole "dev environment").
  Source is another `terragrunt.stack.hcl` → enables nested stacks.

```hcl
# Reusable pattern, deployed multiple times with different values
stack "dev" {
  source = "git::git@github.com:acme/infra-catalog.git//stacks/environment?ref=v0.0.1"
  path   = "dev"
  values = { environment = "development", cidr = "10.0.0.0/16" }
}
stack "prod" {
  source = "git::git@github.com:acme/infra-catalog.git//stacks/environment?ref=v0.0.1"
  path   = "prod"
  values = { environment = "production", cidr = "10.1.0.0/16" }
}
```

### Stack commands

```bash
# Generate units from terragrunt.stack.hcl (into .terragrunt-stack/)
terragrunt stack generate

# Run a command on all units in the stack (auto-generates if missing)
terragrunt stack run apply
terragrunt stack run plan
terragrunt stack run destroy

# Aggregated outputs of all units
terragrunt stack output

# Clean the generated .terragrunt-stack directory
terragrunt stack clean
```

> **Limitations of explicit stacks:** a `dependency` block cannot yet point at a whole stack (only at a
> unit inside it), the `include` block is not supported in `terragrunt.stack.hcl`, deeply nested generation
> can be slow (mitigation: `--experiment cas` + `update_source_with_cas = true`).

## generate block — provider/backend config

Generates an arbitrary file in the working directory (where `tofu`/`terraform` is invoked). Typically used to
share provider blocks across modules from a parent config.

```hcl
# root.hcl / terragrunt.hcl
generate "provider" {
  path      = "provider.tf"
  if_exists = "overwrite_terragrunt"   # overwrite | overwrite_terragrunt | skip | error
  contents  = <<EOF
provider "aws" {
  region = "eu-central-1"
}
EOF
}
```

- **`name`** (label) — distinguishes multiple `generate` blocks.
- **`if_exists`** — `overwrite_terragrunt` (overwrites only a file generated by terragrunt, otherwise error) is the safest.
- **`disable`** — turns the generate block off.

## dependency + dependencies blocks — outputs between units

`dependency` exports outputs of the target module as attributes (`dependency.<name>.outputs.*`).
`mock_outputs` enables plan/validate BEFORE apply (when the target module has no state yet).

```hcl
# terragrunt.hcl
dependency "vpc" {
  config_path = "../vpc"

  # Mock outputs for commands that run before apply (otherwise plan would fail)
  mock_outputs_allowed_terraform_commands = ["validate", "plan"]
  mock_outputs = {
    vpc_id = "fake-vpc-id"
  }
}

dependency "rds" {
  config_path = "../rds"
}

inputs = {
  vpc_id = dependency.vpc.outputs.vpc_id
  db_url = dependency.rds.outputs.db_url
}
```

- **`mock_outputs_merge_strategy_with_state`** — `no_merge` (default) | `shallow` | `deep_map_only`.
- **`dependency..inputs` was removed** — use only `dependency..outputs`.

The `dependencies` block = ordering only for `run --all`; it does NOT export outputs:

```hcl
# Ensure ../vpc and ../rds run first during `run --all`
dependencies {
  paths = ["../vpc", "../rds"]
}
```

## remote_state block — automatic backend (S3/GCS)

Terragrunt keeps backend configuration DRY and can automatically create an S3 / GCS bucket
(with `--backend-bootstrap`). The `generate` sub-attribute writes the backend into a `.tf` file.

```hcl
# root.hcl
remote_state {
  backend = "s3"

  generate = {
    path      = "backend.tf"
    if_exists = "overwrite_terragrunt"
  }

  config = {
    bucket         = "myapp-tfstate"
    key            = "${path_relative_to_include()}/terraform.tfstate"
    region         = "eu-central-1"
    encrypt        = true
    use_lockfile   = true            # native S3 locking (OpenTofu 1.10+ / TF 1.10+, instead of DynamoDB)
  }
}
```

Equivalent generated `backend.tf`:

```hcl
terraform {
  backend "s3" {
    bucket = "myapp-tfstate"
    key    = "..."
    region = "eu-central-1"
  }
}
```

- **Auto-creation** is supported only for `s3` and `gcs` backends. To create the bucket: `--backend-bootstrap`
  (default is now `false` — auto-provisioning is no longer implicit).
- **`disable_init = true`** — Terragrunt does not touch backend resources (only lets tofu/terraform initialize them).
- **`encryption`** sub-attribute — maps to the OpenTofu `encryption` block (state/plan encryption).

## Environment Variables for secrets

Never commit secrets into tfvars. Use the TF_VAR_* prefix:

```bash
export TF_VAR_hcloud_token="$HCLOUD_TOKEN"
export TF_VAR_cloudflare_api_token="$CF_API_TOKEN"
export TF_VAR_db_password="$DB_PASSWORD"
```

## Environment Promotion Pattern

```bash
# 1. Deploy to staging
cd environments/staging
tofu plan -var-file="staging.tfvars" -out=staging.plan
tofu apply staging.plan

# 2. Smoke tests
curl -f https://app-stg.example.com/health

# 3. Promote to prod
cd environments/prod
tofu plan -var-file="prod.tfvars" -out=prod.plan
# REVIEW THE PLAN before apply!
tofu apply prod.plan
```
