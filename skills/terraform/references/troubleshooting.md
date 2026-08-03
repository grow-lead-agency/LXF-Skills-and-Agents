# Terraform — Troubleshooting Guide

## Dependency Cycles

### Diagnostics

```bash
# Terraform shows a cycle error:
# Error: Cycle: hcloud_server.web, hcloud_firewall_attachment.web, hcloud_server.web

tofu graph | dot -Tsvg > graph.svg   # visualize the dependency graph
```

### Solutions

**Pattern 1: Direct reference instead of depends_on**
```hcl
# PROBLEM: circular depends_on
resource "hcloud_server" "web" {
  depends_on = [hcloud_firewall.web]
}
resource "hcloud_firewall" "web" {
  depends_on = [hcloud_server.web]  # CYCLE!
}

# SOLUTION: firewall_ids directly on the server resource
resource "hcloud_server" "web" {
  firewall_ids = [hcloud_firewall.web.id]  # direct reference, not depends_on
}
```

**Pattern 2: Data source instead of resource reference**
```hcl
# Read an existing resource instead of creating it
data "hcloud_server" "existing" {
  name = "existing-server"
}
```

**Pattern 3: Null resource as a breakpoint**
```hcl
resource "null_resource" "breakpoint" {
  triggers = {
    server_id = hcloud_server.web.id
  }
}
resource "hcloud_firewall_attachment" "web" {
  depends_on  = [null_resource.breakpoint]
  firewall_id = hcloud_firewall.web.id
  server_ids  = [null_resource.breakpoint.triggers.server_id]
}
```

---

## State Lock Issues

```bash
# Error: Error acquiring the state lock
# Lock ID: 12345678-abcd-...

# Check whether another process is actually running
# (check CI/CD, other terminals)

# Force unlock — use ONLY when you are sure no apply is running
tofu force-unlock 12345678-abcd-...

# S3/DynamoDB backend — manual unlock
aws dynamodb delete-item   --table-name terraform-locks   --key '{"LockID": {"S": "terraform-state/terraform.tfstate-md5"}}'

# PostgreSQL backend — manual unlock
psql "$CONN_STR" -c "DELETE FROM schema_locks WHERE id = 'state';"
```

---

## Provider Version Conflicts

```bash
# Error: Provider requirements cannot be satisfied by installed plugins

# Check lockfile
cat .terraform.lock.hcl

# Reset and reinstall
rm -rf .terraform/
rm .terraform.lock.hcl
tofu init

# Upgrade a specific provider
tofu init -upgrade
tofu providers lock -platform=linux_amd64 -platform=darwin_arm64
```

The lockfile must be in Git — ensures deterministic builds in CI:
```bash
git add .terraform.lock.hcl
git commit -m "chore: update terraform lock file"
```

---

## Plan vs Apply Drift

When it happens: the provider returns different values than the plan predicted.

```bash
# Symptom: apply changes something the plan did not show
# Diagnosis:
tofu plan -refresh-only    # shows the real state

# Update state to match reality
tofu apply -refresh-only

# Specific resource
tofu plan -target=hcloud_server.web -refresh-only
```

---

## Partial Apply Recovery

Terraform apply failed mid-way — state is inconsistent.

```bash
# Check what was created
tofu state list

# Inspect a specific resource
tofu state show hcloud_server.web

# If the resource exists in the cloud but not in state → import
tofu import hcloud_server.web 12345678

# If the resource exists in state but not in the cloud → remove
tofu state rm hcloud_server.web

# Re-run apply — Terraform is idempotent
tofu plan -out=recovery.plan
tofu apply recovery.plan
```

---

## -target Flag — Use Carefully!

```bash
# Safe use: ONLY during recovery or testing
tofu plan -target=module.web.hcloud_server.main
tofu apply -target=module.web.hcloud_server.main

# DANGER: -target can create inconsistent state
# Terraform does not know about dependencies of resources outside the target
# After using it, ALWAYS run a full plan without -target
tofu plan    # check overall state
```

---

## Timeout Issues

```hcl
# Production resources may take longer
resource "google_container_cluster" "main" {
  name = "my-cluster"

  timeouts {
    create = "30m"
    update = "40m"
    delete = "20m"
  }
}

# Hetzner servers are fast; timeouts are usually unnecessary
# AWS RDS can take 15-20 minutes
resource "aws_db_instance" "main" {
  # ...
  timeouts {
    create = "40m"
    update = "80m"
    delete = "40m"
  }
}
```

---

## Import Workflow (Complete)

Scenario: you have an existing cloud server and want to manage it with Terraform.

```bash
# 1. Find the resource ID
hcloud server list
# Output: ID=12345678, NAME=web-prod

# 2. Write a resource block in code
# main.tf:
resource "hcloud_server" "web" {
  name        = "web-prod"
  image       = "ubuntu-24.04"
  server_type = "cx22"
  location    = "nbg1"
}

# 3. Import (CLI approach)
tofu import hcloud_server.web 12345678

# 3b. Import block (declarative, Terraform 1.5+ / OpenTofu 1.6+)
# Add to main.tf:
import {
  to = hcloud_server.web
  id = "12345678"
}
# Then: tofu plan (shows import + diff) → tofu apply

# 4. Check the result
tofu state show hcloud_server.web

# 5. Verify plan (should be 0 changes or only ignore_changes diff)
tofu plan

# 6. Fix configuration if there are differences
# (image ID may differ from name, labels, etc.)

# 7. Delete the import block after success (it is one-shot)
```

### Generate Config for Import (OpenTofu 1.6+)

```bash
# Add an import block
# Run generate
tofu plan -generate-config-out=generated.tf

# generated.tf contains all attributes from the cloud
# Review, add to main.tf, delete the import block
cat generated.tf
```

---

## State Corruption — Emergency Procedure

```bash
# 1. STOP all apply operations

# 2. Download current state
tofu state pull > corrupted-state-$(date +%Y%m%d-%H%M%S).json

# 3. Download backup (terraform.tfstate.backup or from S3)
aws s3 cp s3://my-state-bucket/terraform.tfstate ./

# 4. Validate JSON
python3 -m json.tool terraform.tfstate > /dev/null && echo "Valid JSON"

# 5. Check serial number (must be >= current)
# If using a backup, check "serial" in the JSON

# 6. Upload the repaired state (EXTREMELY carefully)
tofu state push terraform.tfstate

# 7. Verify
tofu state list
tofu plan    # check state
```

---

## Most Common Errors

| Error | Cause | Fix |
|-------|---------|--------|
| `Error acquiring the state lock` | Another apply is running or crashed | Check → force-unlock |
| `Provider produced inconsistent result` | Provider bug or race condition | Re-run apply |
| `Error: Inconsistent dependency lock file` | Stale lockfile | `tofu init -upgrade` |
| `Context deadline exceeded` | Timeout on API call | Retry or increase timeout |
| `Error: Reference to undeclared resource` | Typo or deleted resource | Fix the reference in HCL |
| `Error: Invalid count argument` | count depends on an unknown value | Use -target or refactor |
| `Error: Cycle` | Circular dependency | Remove depends_on or refactor |
| `Error: Provider configuration not present` | Missing provider {} block | Add provider configuration |

---

## Debug Mode

```bash
# Detailed output (provider API calls)
TF_LOG=DEBUG tofu plan 2> debug.log

# Terraform internal logs only
TF_LOG=TRACE tofu apply

# Provider-specific debug
TF_LOG_PROVIDER=DEBUG tofu plan

# Write to a file
TF_LOG=DEBUG TF_LOG_PATH=./terraform-debug.log tofu plan
```

Levels: `TRACE`, `DEBUG`, `INFO`, `WARN`, `ERROR`
