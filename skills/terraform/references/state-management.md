# Terraform — State Management

## Remote Backends

### PostgreSQL Backend (self-hosted stacks — recommended when avoiding AWS)

```hcl
# backend.tf
terraform {
  backend "pg" {
    conn_str    = "postgres://tfstate:PASSWORD@db.example.com:5432/terraform_state?sslmode=require"
    schema_name = "project_name"  # isolation per project
  }
}

# Or via environment variable TF_BACKEND_CONN_STR (OpenTofu)
# Init: tofu init -backend-config="conn_str=$TF_BACKEND_CONN_STR"
```

Benefits: no AWS dependency, self-hosted, works with any managed PostgreSQL that supports SSL.

### S3 Backend (AWS projects)

```hcl
terraform {
  backend "s3" {
    bucket       = "my-terraform-state"
    key          = "projects/myapp/terraform.tfstate"
    region       = "eu-central-1"
    encrypt      = true  # server-side encryption
    use_lockfile = true  # S3 native locking (TF 1.10+ / OpenTofu 1.10+) — DynamoDB is NOT required

    # OIDC auth (no static credentials in CI)
    # Configure via AWS IAM OIDC provider + role
  }
}
```

**S3 native locking (`use_lockfile = true`, TF 1.10+ / OpenTofu 1.10+) is the modern default.**
Terraform stores the lock directly in S3 as object `<key>.tflock` (using S3 conditional writes),
so a **separate DynamoDB table is no longer needed**. DynamoDB-based locking is officially
**deprecated** and will be removed in a future minor version — it still works and `dynamodb_table`
can be configured alongside `use_lockfile` (for migrating older projects), but do not use it for new work.

IAM permissions for `use_lockfile`: also need `s3:GetObject`, `s3:PutObject`, `s3:DeleteObject`
on the lock object `arn:aws:s3:::mybucket/path/to/my/key.tflock`.

DynamoDB table for locking (LEGACY — existing projects only, deprecated):
```hcl
resource "aws_dynamodb_table" "terraform_locks" {
  name         = "terraform-locks"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "LockID"

  attribute {
    name = "LockID"
    type = "S"
  }
}
```

### GCS Backend (GCP projects)

```hcl
terraform {
  backend "gcs" {
    bucket = "my-terraform-state"
    prefix = "terraform/state"
  }
}
```

### HCP Terraform (formerly Terraform Cloud, rebranded 2024) / Enterprise

```hcl
terraform {
  cloud {
    organization = "my-org"
    workspaces {
      name = "my-project-prod"
      # or: tags = ["app:myproject", "env:prod"]
    }
  }
}
```

HCP Terraform (= Terraform Cloud after the 2024 rebrand) adds on top of remote state:
- **Stacks** (GA November 2025) — declarative grouping of multiple configurations (components) and their
  deployments; config in `.tfcomponent.hcl` + `.tfdeploy.hcl`, own lifecycle for multi-environment
  infra without copying root modules.
- **No-code modules** — provision from a Registry module via the UI without writing HCL.
- **Run tasks** — external checks (policy, security scan, cost) wired into the plan/apply pipeline.

## State Locking

State locking prevents concurrent operations (race conditions).

```bash
# Show lock info (when state is locked)
tofu plan  # returns Error acquiring the state lock with Lock ID

# Force unlock — CAREFULLY, only when you are sure no other apply is running
tofu force-unlock LOCK_ID

# Bypass lock (DANGEROUS — absolute last resort only)
tofu apply -lock=false

# Manual DynamoDB unlock (S3 backend)
aws dynamodb delete-item \
  --table-name terraform-locks \
  --key '{"LockID": {"S": "my-state-key"}}'
```

## State Operations

### Viewing and inspection

```bash
# List all resources in state
tofu state list

# Detail of a specific resource
tofu state show hcloud_server.web
tofu state show 'hcloud_server.servers["web-1"]'
tofu state show 'module.web.hcloud_server.main'

# Pull current state as JSON
tofu state pull > state-backup.json

# Push state (use with EXTREME caution)
tofu state push state-backup.json
```

### Moving resources in state

```bash
# Rename a resource
tofu state mv hcloud_server.app hcloud_server.web

# Move into a module
tofu state mv hcloud_server.web 'module.web_server.hcloud_server.main'

# Move from count index to for_each key
tofu state mv 'hcloud_server.servers[0]' 'hcloud_server.servers["web-1"]'

# Move from one state to another (cross-workspace)
tofu state mv -state-out=./other/terraform.tfstate hcloud_server.db 'module.db.hcloud_server.main'
```

Prefer a `moved {}` block in code — it is versioned, auditable, and shareable with the team.

### Removing from state (without destroy)

```bash
# Removes the resource from state but does NOT delete it from the cloud
# Use case: "forget" the resource so you can manage it elsewhere
tofu state rm hcloud_server.old_web
tofu state rm 'module.obsolete_module.hcloud_server.main'

# Remove an entire module
tofu state rm 'module.old_module'
```

Prefer the declarative `removed {}` block (TF 1.7+) over CLI `state rm` — it is versioned and auditable (deep dive: core-hcl.md → "removed Block" section).

### Replace (instead of deprecated taint)

```bash
# Marks a resource for destroy + create on the next apply
# Modern approach (replaces deprecated terraform taint)
tofu apply -replace=hcloud_server.web
tofu apply -replace='hcloud_server.servers["web-1"]'

# Plan with replace only (no apply)
tofu plan -replace=hcloud_server.web -out=replace.plan
```

## Import — Existing Infrastructure

### Import Block (Terraform 1.5+ / OpenTofu 1.6+) — recommended

```hcl
# import.tf — declarative import
import {
  to = hcloud_server.existing_web
  id = "12345678"  # cloud server ID
}

import {
  to = cloudflare_record.www
  id = "zone_id/record_id"  # Cloudflare composite ID
}

# After import: tofu plan (shows diffs), tofu apply
# Then delete the import blocks — they are one-shot
```

### Generate Config (Terraform 1.5+ / OpenTofu 1.6+)

```bash
# Generates HCL config for the imported resource
tofu plan -generate-config-out=generated.tf
# Review generated.tf → move into main.tf → adjust → apply
```

### CLI import (older approach)

```bash
# terraform import <resource_address> <provider_id>
tofu import hcloud_server.web 12345678
tofu import 'cloudflare_record.www' "zone_id/record_id"
tofu import 'hcloud_server.servers["web-1"]' 12345678
tofu import 'module.web.hcloud_server.main' 12345678

# You MUST have a resource block in code BEFORE import
resource "hcloud_server" "web" {
  # arguments get filled after import — placeholders for now
  name        = "web-prod"
  image       = "ubuntu-24.04"
  server_type = "cx22"
  location    = "nbg1"
}
```

How to find the provider ID:
```bash
# Hetzner Cloud
hcloud server list
hcloud server describe web-prod --output json | jq .id

# Cloudflare (CLI or API)
curl -s -H "Authorization: Bearer $CF_TOKEN" \
  "https://api.cloudflare.com/client/v4/zones/ZONE_ID/dns_records" | jq '.result[] | {id, name, type}'
```

## Drift Detection

```bash
# Check drift without applying changes
tofu plan -refresh-only

# Apply drift (sync state with reality — DANGEROUS, removes "ghost" resources)
tofu apply -refresh-only

# Disable refresh (faster plan, but inaccurate for drift)
tofu plan -refresh=false

# Refresh before apply (default behaviour, explicit)
tofu apply -refresh=true
```

## State File — Structure

The state file is JSON — never edit it by hand (except extreme situations).

```json
{
  "version": 4,
  "terraform_version": "1.9.0",
  "serial": 42,          // increments on every change
  "lineage": "uuid",     // unique ID of the state file
  "resources": [
    {
      "mode": "managed",  // managed | data
      "type": "hcloud_server",
      "name": "web",
      "provider": "provider[\"registry.terraform.io/hetznercloud/hcloud\"]",
      "instances": [
        {
          "schema_version": 0,
          "attributes": {
            "id": "12345678",
            "name": "web-prod",
            "ipv4_address": "1.2.3.4"
            // ... all attributes
          },
          "sensitive_attributes": [],
          "private": "base64..."
        }
      ]
    }
  ],
  "outputs": {
    "server_ip": {
      "value": "1.2.3.4",
      "type": "string",
      "sensitive": false
    }
  }
}
```

Sensitive values are stored in state as **plain text** — always encrypt state!

## State Backup and Recovery

```bash
# Automatic backup before apply → terraform.tfstate.backup
# Manual backup
tofu state pull > "backup-$(date +%Y%m%d-%H%M%S).json"

# Recovery from backup
tofu state push backup-20260401-120000.json

# State corruption — emergency procedure
# 1. Download state from the backend
# 2. Edit JSON (state mv, rm)
# 3. Upload again: state push
# Always test via state pull + validate before push
```

## Splitting Large State

When to split state:
- >500 resources → slow plan
- Different teams own different parts
- Different deployment cadences (infra vs apps)

```hcl
# Separate state files with data references
# state-networking/main.tf → creates VPC, subnets
# state-apps/main.tf → reads networking via remote_state

data "terraform_remote_state" "networking" {
  backend = "s3"
  config = {
    bucket = "terraform-state"
    key    = "networking/terraform.tfstate"
    region = "eu-central-1"
  }
}

resource "hcloud_server" "app" {
  # ...
  network {
    network_id = data.terraform_remote_state.networking.outputs.private_network_id
  }
}
```
