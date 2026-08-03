# Terraform / OpenTofu — Core HCL Syntax

## Providers

```hcl
# versions.tf — ALWAYS keep separate from main.tf
terraform {
  required_version = ">= 1.10.0"

  required_providers {
    digitalocean = {
      source  = "digitalocean/digitalocean"
      version = "~> 2.0"    # ~> = patch/minor updates only
    }
    cloudflare = {
      source  = "cloudflare/cloudflare"
      version = "~> 5.0"
    }
  }
}

# Provider alias — multiple instances of the same provider
provider "aws" {
  region = "eu-central-1"
  alias  = "frankfurt"
}

provider "aws" {
  region = "us-east-1"
  alias  = "virginia"
}

resource "aws_s3_bucket" "eu" {
  provider = aws.frankfurt
  bucket   = "my-eu-bucket"
}
```

## Resources — Meta-Arguments

### count vs for_each (the key choice)

```hcl
# WRONG: count shifts indexes on deletion → destroy + recreate of the others
resource "digitalocean_droplet" "web" {
  count  = 3
  name   = "web-${count.index}"
  image  = "ubuntu-24-04-x64"
  size   = "s-2vcpu-4gb"
  region = "fra1"
}
# Deleting web[1] → web[2] gets renumbered to web[1] → destroy + recreate!

# CORRECT: for_each with a map → stable keys
locals {
  servers = {
    "web-1" = { region = "fra1", size = "s-2vcpu-4gb" }
    "web-2" = { region = "ams3", size = "s-2vcpu-4gb" }
    "db-1"  = { region = "fra1", size = "s-4vcpu-8gb" }
  }
}

resource "digitalocean_droplet" "servers" {
  for_each = local.servers
  name     = each.key
  image    = "ubuntu-24-04-x64"
  size     = each.value.size
  region   = each.value.region
}

# Accessing an output: digitalocean_droplet.servers["web-1"].ipv4_address
```

### lifecycle Rules

```hcl
resource "digitalocean_droplet" "db" {
  name   = "db-prod"
  image  = "ubuntu-24-04-x64"
  size   = "s-4vcpu-8gb"
  region = "fra1"

  lifecycle {
    # Create the new one first, then destroy the old one (zero-downtime replacement)
    create_before_destroy = true

    # Prevent destroy (protection for the prod DB)
    prevent_destroy = true

    # Ignore changes to these attributes (e.g. someone edits them via the web UI)
    ignore_changes = [
      tags,
      user_data,  # cloud-init script
    ]

    # Trigger a replace when another resource changes (OpenTofu 1.2+)
    replace_triggered_by = [
      digitalocean_ssh_key.default.id
    ]
  }
}
```

### depends_on — explicit dependencies

```hcl
# Use ONLY when Terraform cannot detect the dependency automatically
resource "digitalocean_firewall" "web" {
  name        = "web-firewall"
  droplet_ids = [digitalocean_droplet.web.id]

  # Terraform would detect this automatically — depends_on is redundant here
  # depends_on = [digitalocean_droplet.web]  # <- not needed

  inbound_rule {
    protocol         = "tcp"
    port_range       = "443"
    source_addresses = ["0.0.0.0/0", "::/0"]
  }
}

# A case where you REALLY need depends_on:
resource "null_resource" "setup" {
  depends_on = [digitalocean_droplet.web]  # null_resource knows nothing about the server without this

  connection {
    host = digitalocean_droplet.web.ipv4_address
  }

  provisioner "remote-exec" {
    inline = ["sudo apt-get update"]
  }
}
```

## Variables

```hcl
# variables.tf

# Basic string with validation
variable "environment" {
  type        = string
  description = "Deployment environment"

  validation {
    condition     = contains(["staging", "prod"], var.environment)
    error_message = "Environment must be 'staging' or 'prod'."
  }
}

# Number with a range
variable "server_count" {
  type        = number
  description = "Number of web servers"
  default     = 2

  validation {
    condition     = var.server_count >= 1 && var.server_count <= 10
    error_message = "Server count must be between 1 and 10."
  }
}

# Sensitive — hides the value in plan/apply output
variable "do_token" {
  type        = string
  sensitive   = true
  description = "Cloud provider API token"
}

# Object with default values
variable "server_config" {
  type = object({
    size   = string
    region = string
    image  = optional(string, "ubuntu-24-04-x64")  # optional with a default value
  })
  default = {
    size   = "s-2vcpu-4gb"
    region = "fra1"
  }
}

# Map for DNS records
variable "dns_records" {
  type = map(object({
    value   = string
    type    = string
    proxied = optional(bool, true)
  }))
  default = {}
}

# nullable = false → cannot be overridden with null
variable "project_name" {
  type     = string
  nullable = false
}
```

## Outputs

```hcl
# outputs.tf

output "server_ip" {
  description = "Public IP of the web server"
  value       = digitalocean_droplet.web.ipv4_address
}

output "server_ips" {
  description = "IPs of all servers (for_each)"
  value       = { for k, v in digitalocean_droplet.servers : k => v.ipv4_address }
}

output "db_connection_string" {
  description = "Database connection string"
  value       = "postgres://${var.db_user}:${var.db_pass}@${digitalocean_droplet.db.ipv4_address}/app"
  sensitive   = true  # hides it in CLI output
}

output "cloudflare_nameservers" {
  description = "Nameservers for domain delegation"
  value       = cloudflare_zone.main.name_servers
}
```

## Locals — complex expressions

```hcl
locals {
  # Prefix for the naming convention
  prefix = "${var.project}-${var.environment}"

  # Condition
  is_prod = var.environment == "prod"

  # Map transformation with a for expression
  server_fqdns = {
    for name, server in digitalocean_droplet.servers :
    name => "${name}.${var.domain}"
  }

  # Flatten — for nested lists
  all_firewall_rules = flatten([
    for rule in var.firewall_rules : [
      for port in rule.ports : {
        description = rule.description
        port        = port
        protocol    = rule.protocol
      }
    ]
  ])

  # Merge maps
  common_labels = merge(
    var.extra_labels,
    {
      project     = var.project
      environment = var.environment
      managed_by  = "terraform"
    }
  )

  # Conditional resource config
  server_size = local.is_prod ? "s-4vcpu-8gb" : "s-2vcpu-4gb"
}
```

## Expressions — overview

```hcl
# Conditional (ternary)
name = var.environment == "prod" ? "app.example.com" : "app-stg.example.com"

# String interpolation
name = "${var.project}-${var.environment}-web"

# Heredoc string
user_data = <<-EOT
  #!/bin/bash
  apt-get update
  apt-get install -y nginx
  echo "Server: ${var.environment}" > /var/www/html/index.html
EOT

# Splat operator — list from for_each
server_ids = values(digitalocean_droplet.servers)[*].id

# For expression — list
public_ips = [for s in digitalocean_droplet.servers : s.ipv4_address]

# For expression — map (with a filter)
prod_servers = {
  for k, v in digitalocean_droplet.servers :
  k => v.ipv4_address
  if v.region == "fra1"
}

# Functions
name_lower    = lower(var.project_name)
name_trimmed  = trimspace(var.raw_name)
encoded_json  = jsonencode({ key = "value" })
decoded       = jsondecode(data.http.config.body)
file_content  = file("${path.module}/scripts/init.sh")
base64_encode = base64encode(local.user_data)

# coalesce — first non-null value
region = coalesce(var.region, data.aws_region.current.name, "eu-central-1")

# try — safe attribute access
server_ip = try(digitalocean_droplet.web[0].ipv4_address, "unknown")

# can — test whether an expression would raise an error
has_ipv4 = can(digitalocean_droplet.web[0].ipv4_address)
```

## Dynamic Blocks

```hcl
# Firewall with dynamic rules
resource "digitalocean_firewall" "web" {
  name        = "${local.prefix}-firewall"
  droplet_ids = [digitalocean_droplet.web.id]

  dynamic "inbound_rule" {
    for_each = var.allowed_ports
    content {
      protocol         = "tcp"
      port_range       = inbound_rule.value
      source_addresses = ["0.0.0.0/0", "::/0"]
    }
  }

  # Nested dynamic blocks
  dynamic "inbound_rule" {
    for_each = var.allowed_udp_ranges
    content {
      protocol         = "udp"
      port_range       = inbound_rule.value.port
      source_addresses = inbound_rule.value.source_ips
    }
  }
}

# Dynamic blocks vs map arguments — Kubernetes labels example
resource "kubernetes_deployment" "app" {
  metadata {
    name = var.app_name

    dynamic "labels" {
      for_each = var.extra_labels
      content {
        # Won't work — labels is a map argument, not a block
      }
    }
    # Correct:
    labels = merge(local.common_labels, var.extra_labels)
  }
}
```

## Moved Blocks — rename without destroy

```hcl
# Renaming a resource (Terraform 1.1+)
moved {
  from = digitalocean_droplet.app
  to   = digitalocean_droplet.web
}

# Moving from count to for_each
moved {
  from = digitalocean_droplet.web[0]
  to   = digitalocean_droplet.web["web-1"]
}

# Moving into a module
moved {
  from = digitalocean_droplet.web
  to   = module.web_server.digitalocean_droplet.main
}

# PROCEDURE: add the moved block → tofu plan (verify 0 changes) → tofu apply → delete the moved block after success
```

## Data Sources

```hcl
# Read-only lookup of an existing resource
data "digitalocean_image" "ubuntu" {
  slug = "ubuntu-24-04-x64"
}

data "cloudflare_zone" "main" {
  filter = {
    name = "example.com"
  }
}

# Usage in a resource
resource "digitalocean_droplet" "web" {
  image = data.digitalocean_image.ubuntu.id
}

resource "cloudflare_dns_record" "app" {   # provider v5: cloudflare_record → cloudflare_dns_record
  zone_id = data.cloudflare_zone.main.zone_id
  name    = "app.example.com"                       # v5: FQDN
  content = digitalocean_droplet.web.ipv4_address   # v5: value → content
  type    = "A"
  ttl     = 1
}

# depends_on on a data source — only when truly necessary
data "aws_iam_policy_document" "assume" {
  depends_on = [aws_iam_role.main]  # only if the IAM replica needs time to propagate
}
```

## Ephemeral Resources & Values (TF 1.10+) — THE secrets feature

Ephemeral constructs exist **only during a single operation** — Terraform NEVER writes them to the state or plan file. This closes the historical leak where secrets (DB passwords, tokens) ended up in plaintext state.

```hcl
# 1) ephemeral resource — temporary resource, disappears after the operation, never in state
ephemeral "random_password" "db_password" {
  length           = 16
  override_special = "!#$%&*()-_=+[]{}<>:?"
}

# The value is passed to the provider via a write-only argument (see below) — no persistence
resource "aws_db_instance" "example" {
  instance_class      = "db.t3.micro"
  allocated_storage   = "5"
  engine              = "postgres"
  username            = "example"
  skip_final_snapshot = true
  password_wo         = ephemeral.random_password.db_password.result
  password_wo_version = 1
}

# 2) ephemeral input variable (TF 1.10+) — value never lands in state/plan
variable "session_token" {
  type      = string
  ephemeral = true   # restriction: may only be used in ephemeral contexts / write-only args
}

# 3) ephemeral output — propagates an ephemeral value to the calling module (root from 1.14.1)
output "vault_token" {
  value     = ephemeral.vault_kv_secret_v2.app.data["token"]
  ephemeral = true
}

# 4) ephemeralasnull() — converts an ephemeral value to null (e.g. for debug output)
locals {
  safe = ephemeralasnull(ephemeral.random_password.db_password.result)
}
```

Real-world pattern: ephemeral Vault/AWS Secrets Manager lookup → write-only argument on the target resource → the secret never remains in plaintext state.

```hcl
# Generate → store in AWS Secrets Manager → re-read ephemerally → hand off to the DB
ephemeral "random_password" "db_password" {
  length = 16
}

resource "aws_secretsmanager_secret" "db_password" {
  name = "db_password"
}

resource "aws_secretsmanager_secret_version" "db_password" {
  secret_id                = aws_secretsmanager_secret.db_password.id
  secret_string_wo         = ephemeral.random_password.db_password.result
  secret_string_wo_version = 1
}

ephemeral "aws_secretsmanager_secret_version" "db_password" {
  secret_id = aws_secretsmanager_secret_version.db_password.secret_id
}

resource "aws_db_instance" "example" {
  instance_class      = "db.t3.micro"
  allocated_storage   = "5"
  engine              = "postgres"
  username            = "example"
  skip_final_snapshot = true
  password_wo         = ephemeral.aws_secretsmanager_secret_version.db_password.secret_string
  password_wo_version = aws_secretsmanager_secret_version.db_password.secret_string_wo_version
}
```

### Secret sources — where the values come from

Ephemeral/write-only solves *how* to keep a secret out of state. *Where* to fetch it from is the second layer. If you run a self-hosted secrets manager such as **Infisical**, it has an official Terraform provider (`Infisical/infisical`):

```hcl
terraform {
  required_providers {
    infisical = { source = "Infisical/infisical", version = "~> 0.15" }
  }
}

provider "infisical" {
  host = "https://infisical.example.com"   # your self-hosted instance (or https://app.infisical.com)
  auth = { universal = {} }  # INFISICAL_UNIVERSAL_AUTH_CLIENT_ID/_SECRET from env (Machine Identity)
}

# Read a secret from an Infisical project
data "infisical_secrets" "db" {
  env_slug     = "prod"
  workspace_id = var.infisical_project_id
  folder_path  = "/database"
}

# Pass it via a write-only argument → the value never remains in plaintext state
resource "some_resource" "x" {
  password_wo         = data.infisical_secrets.db.secrets["DB_PASSWORD"].value
  password_wo_version = 1
}
```

**Anti-pattern:** do not store secret *values* in TF state via the `infisical_secret` resource.
Use the provider/data source only for **bootstrap** or for secrets managed by other IaC; manage
regular app-level secrets through the secrets manager UI/CLI and pull them into TF via the
write-only/ephemeral path.

Choosing a secrets source: a self-hosted manager like Infisical (docs: https://infisical.com/docs)
· Vault (HashiCorp, enterprise) · cloud-native (AWS Secrets Manager / GCP Secret Manager — when
you're all-in on a single cloud).

## Write-Only Arguments (TF 1.11+)

A write-only argument is a **specific resource argument** (password, secret) whose value goes to the provider but Terraform does **NOT** store it in the state or plan file. Requires TF 1.11+ and a resource/provider that declares the write-only argument (recognizable in the Registry — typically `*_wo`).

```hcl
resource "aws_db_instance" "test" {
  instance_class      = "db.t3.micro"
  allocated_storage   = "5"
  engine              = "postgres"
  username            = "example"
  skip_final_snapshot = true
  password_wo         = "my-password-here"  # accepts both ephemeral and non-ephemeral values
  password_wo_version = 1                    # versioning argument — THIS one is stored in state
}
```

Because the value is not in state, Terraform cannot tell that it changed. That's why it is paired with a **versioning argument** (`password_wo_version`). You force a change by incrementing the version:

```hcl
resource "aws_db_instance" "main" {
  # ...
  password_wo         = "new-password-here"
  password_wo_version = 2   # 1 → 2 = Terraform sends the provider the new value
}
```

**Ephemeral vs write-only contrast:**
- **ephemeral** = the whole value/resource lives outside state (temporary existence during the operation).
- **write-only** = a specific resource *argument* lives outside state; the resource itself remains in state.
- A write-only argument accepts both ephemeral and non-ephemeral values; feeding it from an ephemeral resource is the recommended approach.

## removed Block (TF 1.7+) — declarative twin of moved/import

Removes a resource from the configuration **without destroy** — a declarative counterpart of `terraform state rm`, but version-controlled and auditable. `from`/`moved`/`import`/`removed` form the complete set of declarative lifecycle blocks.

```hcl
# Remove a resource from state but DO NOT destroy the real infrastructure (handing over to another team/tool)
removed {
  from = aws_instance.old

  lifecycle {
    destroy = false   # false = just forget it from state; true (default) = remove from state AND destroy
  }
}

# With a destroy-time provisioner (optional)
removed {
  from = aws_instance.example

  lifecycle {
    destroy = true
  }

  provisioner "local-exec" {
    when    = destroy
    command = "echo 'Instance ${self.id} was destroyed.'"
  }
}
```

`from` accepts a resource address (`<TYPE>.<NAME>`). Delete the `removed` block after a successful apply — it is one-shot (same as `moved`/`import`).

## check Block (TF 1.5+) — health assertions after apply

The `check` block is the only validation that does **not block** the operation — when an assertion fails, Terraform just prints a warning and continues. It runs as the **last step** of plan/apply, so use it to verify that the deployed infra actually works (HTTP health, number of SGs, ...).

```hcl
check "health_check" {
  data "http" "endpoint" {
    url = "https://api.example.com/health"
  }

  assert {
    condition     = data.http.endpoint.status_code == 200
    error_message = "Health check failed: ${data.http.endpoint.url} returned ${data.http.endpoint.status_code}"
  }
}

# Multiple asserts + a nested data source (read only after the rest of the config is applied)
check "service_validation" {
  data "aws_lb" "app" {
    name = "application-lb"
  }

  assert {
    condition     = data.aws_lb.app.enable_deletion_protection
    error_message = "Load balancer must have deletion protection enabled"
  }

  assert {
    condition     = length(data.aws_lb.app.security_groups) > 0
    error_message = "Load balancer must have at least one security group"
  }
}
```

A nested `data` block inside `check` is evaluated as the final step of the operation and its errors are masked as warnings. In HCP Terraform, Continuous validation can run the checks continuously.

## terraform_data — replaces null_resource

`terraform_data` is a **built-in** resource (source `terraform.io/builtin/terraform`) — no extra `null` provider. It implements the standard resource lifecycle and serves for: storing values in state, triggering provisioners, and `replace_triggered_by` from plain values. **Recommended modern default instead of `null_resource`** (see the `depends_on` example with `null_resource` above).

```hcl
# Arguments: input (stores a value), triggers_replace (replace on change)
# Attributes: id (unique string), output (computed from input)

# 1) Container for provisioners — replacement for the null_resource above
resource "terraform_data" "bootstrap" {
  triggers_replace = [
    digitalocean_droplet.web.id,
    digitalocean_droplet.db.id,
  ]

  provisioner "local-exec" {
    command = "bootstrap-hosts.sh"
  }
}

# 2) replace_triggered_by from a plain value (var/local can't be used directly → go via terraform_data)
resource "terraform_data" "replacement" {
  input = var.revision
}

resource "digitalocean_droplet" "app" {
  # ...
  lifecycle {
    replace_triggered_by = [terraform_data.replacement]
  }
}
```

Migrating `null_resource` → `terraform_data`: `triggers` → `triggers_replace`, remove `required_providers { null = ... }`, use `terraform state mv` or a `moved` block to relocate the address.

## Provider-Defined Functions (GA TF 1.8+)

Since TF 1.8, providers can ship their own functions. They're called via the namespace `provider::<NAME>::<FUNCTION>(...)`, where `<NAME>` matches the key in `required_providers`.

```hcl
# Built-in terraform provider
locals {
  vars = provider::terraform::encode_tfvars({ example = "Hello!" })
}

# AWS provider — arn_parse splits an ARN into its parts (account_id, region, resource, ...)
locals {
  parsed     = provider::aws::arn_parse("arn:aws:iam::444455556666:role/example")
  account_id = local.parsed.account_id
}
```

Functions of external providers are documented in the Terraform Registry for the given provider (Functions section).

## TF 1.14 / 1.15 — net-new (verified against changelogs, December 2025–April 2026)

### terraform query + List Resources (`.tfquery.hcl`) — TF 1.14.0

The new `terraform query` command queries **existing** infrastructure and can generate config for import. A list query is declared in files with the `.tfquery.hcl` extension using a `list` block.

```hcl
# infra.tfquery.hcl
list "aws_instance" "web" {
  provider         = aws
  include_resource = true   # true = full resource objects; false (default) = identities only
  limit            = 100    # default 100

  config {
    # provider-specific filters — see the provider documentation
  }
}
```

```bash
terraform query                 # prints the discovered resources
terraform fmt                   # can also format .tfquery.hcl (1.15)
terraform validate -query       # offline validation of query files
```

### action blocks — TF 1.14.0

Provider-defined imperative actions outside the standard CRUD model (e.g. `aws_lambda_invoke`). Invoked via the `-invoke` CLI flag or attached to resource lifecycle.

```hcl
action "aws_lambda_invoke" "example" {
  config {
    function_name = "123456789012:function:my-function:1"
    payload = jsonencode({ key1 = "value1" })
  }
}
```

### deprecated argument on variable/output — TF 1.15.0

Marks a variable/output as deprecated → Terraform prints a warning when a value is passed to a deprecated variable or when a deprecated output is referenced.

```hcl
variable "legacy_region" {
  type       = string
  deprecated = "Use var.region. legacy_region will be removed in the next major version of the module."
}

output "old_endpoint" {
  value      = aws_lb.main.dns_name
  deprecated = "Use the endpoint output instead of old_endpoint."
}
```

### Variables and locals in module source/version — TF 1.15.0

TF 1.15 supports `var`/`local` in the `source` and `version` attributes of a `module` block. These are evaluated already at `terraform init`, so most commands now accept variable values for the init phase as well.

```hcl
variable "module_version" {
  type    = string
  default = "1.4.0"
}

module "vpc" {
  source  = "terraform-aws-modules/vpc/aws"
  version = var.module_version
}
```
