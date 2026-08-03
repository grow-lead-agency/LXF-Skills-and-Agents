# Terraform — Multi-Cloud Providers

## Hetzner Cloud Provider (hcloud) — common VM provider for classic stacks

### Setup

```hcl
# versions.tf
terraform {
  required_providers {
    hcloud = {
      source  = "hetznercloud/hcloud"
      version = "~> 1.49"
    }
  }
}

provider "hcloud" {
  token = var.hcloud_token  # or TF_VAR_hcloud_token env var
}
```

### Server

```hcl
resource "hcloud_server" "web" {
  name        = "web-prod"
  image       = "ubuntu-24.04"
  server_type = "cx22"           # cx22 (4GB), cx32 (8GB), cx42 (16GB), cx52 (32GB)
  location    = "nbg1"           # nbg1=Nuremberg, fsn1=Falkenstein, hel1=Helsinki, ash=Ashburn

  # SSH keys
  ssh_keys = [hcloud_ssh_key.default.id]

  # Firewall (must exist)
  firewall_ids = [hcloud_firewall.web.id]

  # Networking
  network {
    network_id = hcloud_network.private.id
    ip         = "10.0.0.2"  # static private IP (optional)
  }

  # Cloud-init
  user_data = file("${path.module}/cloud-init.yaml")

  # Placement group
  placement_group_id = hcloud_placement_group.web.id

  labels = {
    environment = var.environment
    managed_by  = "terraform"
  }
}

# SSH key
resource "hcloud_ssh_key" "default" {
  name       = "default"
  public_key = file("~/.ssh/id_ed25519.pub")
}

# Data source — latest Ubuntu image
data "hcloud_image" "ubuntu" {
  name              = "ubuntu-24.04"
  most_recent       = true
  with_architecture = "x86"
}
```

### Network

```hcl
# Private network
resource "hcloud_network" "private" {
  name     = "private-network"
  ip_range = "10.0.0.0/16"
}

# Subnet
resource "hcloud_network_subnet" "servers" {
  network_id   = hcloud_network.private.id
  type         = "cloud"
  network_zone = "eu-central"   # eu-central, us-east, us-west, ap-southeast
  ip_range     = "10.0.0.0/24"
}
```

### Firewall

```hcl
resource "hcloud_firewall" "web" {
  name = "web-firewall"

  # Inbound
  rule {
    direction   = "in"
    protocol    = "tcp"
    port        = "22"
    source_ips  = ["0.0.0.0/0", "::/0"]
    description = "SSH"
  }

  rule {
    direction   = "in"
    protocol    = "tcp"
    port        = "80"
    source_ips  = ["0.0.0.0/0", "::/0"]
    description = "HTTP"
  }

  rule {
    direction   = "in"
    protocol    = "tcp"
    port        = "443"
    source_ips  = ["0.0.0.0/0", "::/0"]
    description = "HTTPS"
  }

  # Outbound — Hetzner default: everything allowed
  # If you want to restrict:
  rule {
    direction       = "out"
    protocol        = "tcp"
    port            = "any"
    destination_ips = ["0.0.0.0/0", "::/0"]
  }
}

# Attach firewall to server (alternative to firewall_ids on the server resource)
resource "hcloud_firewall_attachment" "web" {
  firewall_id = hcloud_firewall.web.id
  server_ids  = [hcloud_server.web.id]
}
```

### Load Balancer

```hcl
resource "hcloud_load_balancer" "web" {
  name               = "web-lb"
  load_balancer_type = "lb11"    # lb11 (~5€), lb21, lb31
  location           = "nbg1"

  labels = {
    environment = var.environment
  }
}

resource "hcloud_load_balancer_target" "web" {
  type             = "server"
  load_balancer_id = hcloud_load_balancer.web.id
  server_id        = hcloud_server.web.id
  use_private_ip   = true
}

resource "hcloud_load_balancer_service" "http" {
  load_balancer_id = hcloud_load_balancer.web.id
  protocol         = "http"
  listen_port      = 80
  destination_port = 3000

  http {
    sticky_sessions = true
    cookie_name     = "LB_SESSION"
  }

  health_check {
    protocol = "http"
    port     = 3000
    interval = 15
    timeout  = 10
    retries  = 3

    http {
      path         = "/health"
      response     = "OK"
      status_codes = ["200"]
    }
  }
}
```

### Volume

```hcl
resource "hcloud_volume" "data" {
  name     = "data-volume"
  size     = 50        # GB
  location = "nbg1"
  format   = "ext4"
}

resource "hcloud_volume_attachment" "data" {
  volume_id = hcloud_volume.data.id
  server_id = hcloud_server.db.id
  automount = true
}
```

### Placement Groups

```hcl
resource "hcloud_placement_group" "web" {
  name = "web-spread"
  type = "spread"  # spread = different physical hosts (HA)
}
```

### Floating IP

```hcl
resource "hcloud_floating_ip" "web" {
  type          = "ipv4"
  home_location = "nbg1"
}

resource "hcloud_floating_ip_assignment" "web" {
  floating_ip_id = hcloud_floating_ip.web.id
  server_id      = hcloud_server.web.id
}
```

---

## Cloudflare Provider — DNS / edge

> **Provider v5 (default since 2024) — breaking changes vs v4.** v5 is a ground-up rewrite generated from the Cloudflare OpenAPI schema. Main changes: `cloudflare_record` → `cloudflare_dns_record` (+ `value` → `content`), `cloudflare_zone_settings_override` removed → individual `cloudflare_zone_setting`, `cloudflare_tunnel*` → `cloudflare_zero_trust_tunnel_cloudflared*`, and nested blocks (`rules {}`, `config {}`) changed to **attribute syntax** (`rules = [{ ... }]`, `config = { ... }`). Migration: official `cloudflare/tf-migrate` CLI (https://github.com/cloudflare/tf-migrate) + built-in state upgrader. These examples target **v5**.

### Setup

```hcl
# versions.tf
terraform {
  required_providers {
    cloudflare = {
      source  = "cloudflare/cloudflare"
      version = "~> 5.0"
    }
  }
}

provider "cloudflare" {
  api_token = var.cloudflare_api_token  # scoped token (recommended)
  # api_key + email = legacy (not recommended)
}

# Required API token permissions:
# Zone:Read, DNS:Edit, Firewall Services:Edit, Workers Routes:Edit
```

### DNS Records

**v5 changes:** resource `cloudflare_record` → `cloudflare_dns_record`. Attribute `value` → `content`. `ttl` is always a **number** (1 = automatic, required when `proxied = true`; otherwise 60-86400). `name` must be **FQDN** (full name, not a relative label — `app.example.com`, not `app`; apex = `example.com`). Zone lookup: data source `cloudflare_zone` takes `zone_id` directly, or `filter = { name = "..." }`; read via `data.cloudflare_zone.main.zone_id`.

```hcl
# Zone lookup by name (v5 — filter block instead of name argument)
data "cloudflare_zone" "main" {
  filter = {
    name = "example.com"
  }
}
# If you know the zone_id, pass it directly:
# data "cloudflare_zone" "main" { zone_id = var.cloudflare_zone_id }

# A record with Cloudflare proxy
resource "cloudflare_dns_record" "web" {
  zone_id = data.cloudflare_zone.main.zone_id
  name    = "app.example.com"   # FQDN
  content = hcloud_server.web.ipv4_address
  type    = "A"
  proxied = true   # Cloudflare proxy (orange cloud)
  ttl     = 1      # number; 1 = automatic (required when proxied=true)
}

# CNAME
resource "cloudflare_dns_record" "www" {
  zone_id = data.cloudflare_zone.main.zone_id
  name    = "www.example.com"
  content = "app.example.com"
  type    = "CNAME"
  proxied = true
  ttl     = 1
}

# MX
resource "cloudflare_dns_record" "mx" {
  zone_id  = data.cloudflare_zone.main.zone_id
  name     = "example.com"      # apex = full zone name
  content  = "mail.example.com"
  type     = "MX"
  priority = 10
  ttl      = 3600
  proxied  = false
}

# TXT (SPF, DKIM, verify)
resource "cloudflare_dns_record" "spf" {
  zone_id = data.cloudflare_zone.main.zone_id
  name    = "example.com"
  content = "v=spf1 include:sendgrid.net ~all"
  type    = "TXT"
  ttl     = 3600
}
```

### Zone Settings

**v5 change:** `cloudflare_zone_settings_override` (one resource, `settings {}` block) was
**removed**. v5 has one resource `cloudflare_zone_setting` **per setting** — each setting =
a separate resource with `setting_id` + `value`. For multiple settings use `for_each`:

```hcl
resource "cloudflare_zone_setting" "main" {
  for_each = {
    ssl                      = "strict"   # off | flexible | full | strict
    min_tls_version          = "1.2"
    http3                    = "on"
    brotli                   = "on"
    always_use_https         = "on"
    automatic_https_rewrites = "on"
    opportunistic_encryption = "on"
    browser_cache_ttl        = "14400"    # number-as-string per provider schema
  }

  zone_id    = data.cloudflare_zone.main.zone_id
  setting_id = each.key
  value      = each.value
}
```

> Verify the name/values of a specific setting in the registry docs — `value` type differs per setting
> (string vs number vs nested). Some settings are read-only depending on the zone plan.

### WAF Rules (Rulesets)

```hcl
# Rate limiting
resource "cloudflare_ruleset" "rate_limit" {
  zone_id     = data.cloudflare_zone.main.id
  name        = "Rate Limiting Rules"
  description = "Custom rate limiting"
  kind        = "zone"
  phase       = "http_ratelimit"

  rules {
    description = "Rate limit API"
    expression  = "(http.request.uri.path matches \"^/api/\")"
    action      = "block"
    ratelimit {
      characteristics     = ["ip.src"]
      period              = 60
      requests_per_period = 100
      mitigation_timeout  = 600
    }
  }
}

# Managed WAF
resource "cloudflare_ruleset" "managed_waf" {
  zone_id     = data.cloudflare_zone.main.id
  name        = "Managed WAF"
  kind        = "zone"
  phase       = "http_request_firewall_managed"

  rules {
    description = "Cloudflare OWASP"
    action      = "execute"
    action_parameters {
      id = "4814384a9e5d4991b9815dcfc25d2f1f"  # OWASP Core Ruleset
    }
    expression = "true"
    enabled    = true
  }
}
```

### Cloudflare Workers

```hcl
# Worker script
resource "cloudflare_workers_script" "api" {
  account_id = var.cloudflare_account_id
  name       = "my-api-worker"
  content    = file("${path.module}/worker.js")

  plain_text_binding {
    name = "ENVIRONMENT"
    text = var.environment
  }

  secret_text_binding {
    name = "API_KEY"
    text = var.api_key
  }

  kv_namespace_binding {
    name         = "KV"
    namespace_id = cloudflare_workers_kv_namespace.cache.id
  }
}

# Worker route
resource "cloudflare_workers_route" "api" {
  zone_id     = data.cloudflare_zone.main.id
  pattern     = "app.example.com/api/*"
  script_name = cloudflare_workers_script.api.name
}

# KV namespace
resource "cloudflare_workers_kv_namespace" "cache" {
  account_id = var.cloudflare_account_id
  title      = "my-cache"
}
```

### R2 Bucket

```hcl
resource "cloudflare_r2_bucket" "assets" {
  account_id = var.cloudflare_account_id
  name       = "my-assets"
  location   = "WEUR"   # WEUR, EEUR, APAC, WNAM, ENAM
}
```

### Cloudflare Tunnel (Zero Trust)

**v5 change:** `cloudflare_tunnel` → `cloudflare_zero_trust_tunnel_cloudflared`,
`cloudflare_tunnel_config` → `cloudflare_zero_trust_tunnel_cloudflared_config`. Nested block
`config {}` / `ingress_rule {}` → **attribute syntax** (`config = { ingress = [{...}] }`).
`config_src = "cloudflare"` means Terraform manages the config (not a local `config.yml`).

```hcl
resource "cloudflare_zero_trust_tunnel_cloudflared" "homelab" {
  account_id = var.cloudflare_account_id
  name       = "homelab"
  config_src = "cloudflare"
  # tunnel_secret optional — without it CF generates a token (read via .token output)
}

resource "cloudflare_zero_trust_tunnel_cloudflared_config" "homelab" {
  account_id = var.cloudflare_account_id
  tunnel_id  = cloudflare_zero_trust_tunnel_cloudflared.homelab.id

  config = {
    ingress = [
      {
        hostname = "app.example.com"
        service  = "http://localhost:3000"
      },
      {
        service = "http_status:404"   # catch-all — required last rule
      },
    ]
  }
}
```

---

## GCP Provider — Basics

```hcl
provider "google" {
  project = var.gcp_project_id
  region  = "europe-west3"  # Frankfurt
}

# Compute instance
resource "google_compute_instance" "web" {
  name         = "web-instance"
  machine_type = "e2-micro"
  zone         = "europe-west3-a"

  boot_disk {
    initialize_params {
      image = "ubuntu-os-cloud/ubuntu-2404-lts"
    }
  }

  network_interface {
    network = "default"
    access_config {}  # ephemeral external IP
  }
}

# Cloud SQL
resource "google_sql_database_instance" "main" {
  name             = "main-db"
  database_version = "POSTGRES_16"
  region           = "europe-west3"

  settings {
    tier = "db-f1-micro"
    backup_configuration {
      enabled = true
    }
  }
  deletion_protection = true
}

# GCS bucket
resource "google_storage_bucket" "assets" {
  name                        = "my-assets-bucket"
  location                    = "EU"
  force_destroy               = false
  uniform_bucket_level_access = true
}
```

---

## Kubernetes + Helm Providers

### Setup — ALWAYS depends on an existing cluster

```hcl
# Kubernetes provider — reads kubeconfig
provider "kubernetes" {
  config_path    = "~/.kube/config"
  config_context = "my-cluster"
}

# Or directly from cluster outputs (e.g. a managed k8s module)
provider "kubernetes" {
  host                   = module.k8s_cluster.endpoint
  cluster_ca_certificate = base64decode(module.k8s_cluster.ca_certificate)
  token                  = module.k8s_cluster.token
}

# Helm provider
provider "helm" {
  kubernetes {
    config_path = "~/.kube/config"
  }
}
```

### Kubernetes Resources

```hcl
resource "kubernetes_namespace" "app" {
  metadata {
    name = "my-app"
    labels = {
      managed_by = "terraform"
    }
  }
}

resource "kubernetes_deployment" "app" {
  metadata {
    name      = "my-app"
    namespace = kubernetes_namespace.app.metadata[0].name
  }

  spec {
    replicas = 2

    selector {
      match_labels = {
        app = "my-app"
      }
    }

    template {
      metadata {
        labels = {
          app = "my-app"
        }
      }

      spec {
        container {
          name  = "app"
          image = "nginx:1.27"

          port {
            container_port = 80
          }

          resources {
            limits = {
              cpu    = "500m"
              memory = "128Mi"
            }
            requests = {
              cpu    = "250m"
              memory = "64Mi"
            }
          }
        }
      }
    }
  }
}

# Secret
resource "kubernetes_secret" "app_secrets" {
  metadata {
    name      = "app-secrets"
    namespace = kubernetes_namespace.app.metadata[0].name
  }

  data = {
    DATABASE_URL = base64encode(var.database_url)
    API_KEY      = base64encode(var.api_key)
  }

  type = "Opaque"
}
```

### Helm Release

```hcl
resource "helm_release" "nginx_ingress" {
  name             = "nginx-ingress"
  repository       = "https://kubernetes.github.io/ingress-nginx"
  chart            = "ingress-nginx"
  version          = "4.10.0"
  namespace        = "ingress-nginx"
  create_namespace = true

  set {
    name  = "controller.replicaCount"
    value = "2"
  }

  # Values file
  values = [
    file("${path.module}/nginx-values.yaml")
  ]
}

# cert-manager
resource "helm_release" "cert_manager" {
  depends_on = [helm_release.nginx_ingress]  # explicit order

  name             = "cert-manager"
  repository       = "https://charts.jetstack.io"
  chart            = "cert-manager"
  version          = "v1.15.0"
  namespace        = "cert-manager"
  create_namespace = true

  set {
    name  = "installCRDs"
    value = "true"
  }
}
```

### Core pattern: Terraform provisions the cluster; apps belong in GitOps (ArgoCD)

Terraform = infrastructure (cluster, nodes, networking, namespaces)
ArgoCD / Flux = applications (deployments, services, configs)
Exception: bootstrap charts (nginx-ingress, cert-manager, monitoring stack)

---

## Terraform ↔ Container / Docker boundary

Terraform and Docker are **two layers with a clean, one-way handoff** — they do not interfere;
they connect. TF provisions the *substrate*; Docker/CI deploys *containers* onto it.

| Task | Terraform? | Who does it |
|------|-----------|-------------|
| Provision registry (ECR / ACR / GHCR settings / R2-as-OCI) | ✅ YES | TF (infra resource) |
| **Push image** to registry | ❌ NO | CI pipeline |
| Bootstrap Helm charts (ingress, cert-manager, monitoring) | ✅ YES | TF (`helm` provider) |
| **App deploy** (your services) | ❌ NO | GitOps (ArgoCD/Flux) or a PaaS / `docker compose` |
| Provision server/VPC/DNS/firewall on which Docker runs | ✅ YES | TF |
| Start/build a container | ❌ NO | Docker tooling / PaaS / CI |

**Handoff via outputs (one-way):** TF emits `server_ip`, `kubeconfig`, `registry_url`
→ the deploy layer consumes them. TF never knows about a running container; the deploy layer never changes infra.

**The `docker` provider (kreuzwerker/docker) exists**, but for a single-host VM stack,
**deploying containers via Terraform is an antipattern** — use a PaaS / `docker compose` / CI instead.
Legitimate only for local dev or bootstrap image builds where you have no CI. For a production VM stack:
do not use it for deploy.

Cross-ref related skills when present: Docker image lifecycle, Kubernetes (cluster apps via GitOps), PaaS deploy.

Sources: https://registry.terraform.io/providers/cloudflare/cloudflare/latest/docs, https://github.com/cloudflare/tf-migrate, https://developer.hashicorp.com/terraform/language/providers, https://registry.terraform.io/providers/hetznercloud/hcloud/latest/docs
