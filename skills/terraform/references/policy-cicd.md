# Terraform — Policy-as-Code & CI/CD Integration

## Policy-as-Code Tools

### Checkov — Infrastructure Security Scanning

```bash
# Install
pip install checkov
# or
brew install checkov

# Basic scanning
checkov -d .                           # whole directory
checkov -f main.tf                     # single file
checkov -d . --framework terraform     # Terraform only

# With report
checkov -d . --output json > checkov-report.json
checkov -d . --output sarif            # for GitHub Security tab

# Skip specific rules
checkov -d . --skip-check CKV_AZURE_1,CKV_AWS_20

# Soft fail (does not block CI, but reports)
checkov -d . --soft-fail
```

Inline skip (in HCL):
```hcl
resource "hcloud_server" "web" {
  #checkov:skip=CKV_HCLOUD_1:Public IP is intentional for this server
  name        = "web"
  image       = "ubuntu-24.04"
  server_type = "cx22"
  location    = "nbg1"
}
```

Key checks for Hetzner + Cloudflare:
- `CKV_HCLOUD_*` — Hetzner checks (SSH key, firewall)
- `CKV_CLOUDFLARE_*` — Cloudflare checks (HTTPS, TLS version)
- `CKV2_*` — framework-agnostic supply chain checks

### Trivy Config (successor to tfsec)

```bash
# Install
brew install trivy

# Terraform scanning
trivy config .
trivy config --severity HIGH,CRITICAL .
trivy config --format sarif --output results.sarif .

# Ignore (trivy-ignore file)
# .trivyignore
# AVD-AWS-0001  # specific AVD ID
```

### tflint — Linting

```bash
# Install
brew install tflint

# Configuration (.tflint.hcl)
plugin "hcloud" {
  enabled = true
  version = "0.3.0"
  source  = "github.com/hetznercloud/tflint-ruleset-hcloud"
}

plugin "aws" {
  enabled = true
  version = "0.34.0"
  source  = "github.com/terraform-linters/tflint-ruleset-aws"
}

# Run
tflint --init          # downloads plugins
tflint --recursive     # whole project
tflint -f compact      # compact output for CI
```

### OPA/Conftest — Policy for Terraform Plans

```bash
# Install
brew install conftest

# Test Terraform plan
tofu show -json tfplan > plan.json
conftest test plan.json --policy policies/

# policy/deny_public_s3.rego
package main

deny[msg] {
  resource := input.resource_changes[_]
  resource.type == "aws_s3_bucket"
  resource.change.after.acl == "public-read"
  msg := sprintf("S3 bucket %v must not be public", [resource.address])
}
```

### Sentinel — HCP Terraform Native Policy Engine

[Sentinel](https://developer.hashicorp.com/sentinel) is HashiCorp's embedded policy-as-code engine,
**natively built into the HCP Terraform / Terraform Enterprise run workflow**. Policy runs automatically
**between `plan` and `apply`** — if it fails (per enforcement level), the run is blocked. Unlike OPA
or Checkov this is not a standalone CLI scan, but part of the managed run pipeline itself.

**Sentinel vs OPA/Conftest vs Checkov:**

| | Sentinel | OPA / Conftest | Checkov |
|---|----------|----------------|---------|
| Type | HCP-native, embedded in run | Tool-agnostic, open source | Static scan, open source |
| Where it runs | Automatically in HCP Terraform run (between plan and apply) | Anywhere in CI (`conftest test plan.json`) | Anywhere in CI (`checkov -d .`) |
| Language | Sentinel policy language | Rego | Python checks (built-in + custom) |
| Enforcement | advisory / soft-mandatory / hard-mandatory (first-class) | Pass/fail, gating via CI exit code | Pass/fail + `--soft-fail` |
| Cost | Requires HCP Terraform (Standard/Premium for VCS policy sets; Free = 1 set / 5 policies) | $0 | $0 |

Sentinel works with imports provided by HCP Terraform: `tfplan`/`tfplan/v2` (planned changes),
`tfconfig` (`.tf` files), `tfstate` (state), `tfrun` (run data, e.g. workspace).

```python
# restrict-instance-types.sentinel
import "tfplan/v2" as tfplan

# Allowed instance types
allowed_types = ["t2.small", "t2.medium", "t2.large"]

# Find all aws_instance resources from the plan
ec2_instances = filter tfplan.resource_changes as _, rc {
    rc.type is "aws_instance" and
    rc.mode is "managed" and
    (rc.change.actions contains "create" or rc.change.actions contains "update")
}

# Rule: every instance type must be in allowed_types
instance_type_allowed = rule {
    all ec2_instances as _, instance {
        instance.change.after.instance_type in allowed_types
    }
}

# Main rule — must return true for the policy to pass
main = rule {
    instance_type_allowed
}
```

**Enforcement levels** (first-class concept — set WHEN deploying the policy, NOT in the policy body):
- **advisory** — policy may fail; user only sees/logs a warning. Default level.
- **soft-mandatory** — must pass, BUT an authorized user can **override** the failure (privilege separation + non-repudiation of who approved the override).
- **hard-mandatory** — must pass, **no override** possible. The only way forward is to explicitly remove the policy. For hard compliance rules.

**Policy sets** — policies are grouped into sets and attached to workspaces. On HCP Terraform Standard/Premium
a policy set can be connected directly to a **VCS repository** (Git-connected — push = update policies) or versioned
via API. Free edition: 1 policy set, max 5 policies.

**WHEN to use what (self-hosted OpenTofu stacks):**
- **OPA/Conftest or Checkov in CI = default.** Free, tool-agnostic, runs in GitHub Actions on `tofu show -json` output. This is the standard path for self-hosted OpenTofu without HCP.
- **Sentinel** only if you move to **HCP Terraform / Terraform Enterprise** and want embedded gating directly in the run workflow with enforcement levels and VCS-connected policy sets. Outside HCP, Sentinel does not make sense.

---

## Pre-commit Hooks

```bash
# Install
pip install pre-commit
# or
brew install pre-commit
```

### .pre-commit-config.yaml

```yaml
repos:
  - repo: https://github.com/antonbabenko/pre-commit-terraform
    rev: v1.92.0
    hooks:
      # Formatting
      - id: terraform_fmt
        args: [--args=-recursive]

      # Validation
      - id: terraform_validate

      # Trivy
      - id: terraform_trivy
        args:
          - --args=--severity HIGH,CRITICAL

      # tflint
      - id: terraform_tflint
        args:
          - --args=--config=__GIT_WORKING_DIR__/.tflint.hcl

      # terraform-docs
      - id: terraform_docs
        args:
          - --hook-config=--path-to-file=README.md
          - --hook-config=--add-to-existing-file=true

  - repo: https://github.com/pre-commit/pre-commit-hooks
    rev: v4.6.0
    hooks:
      - id: check-merge-conflict
      - id: end-of-file-fixer
      - id: trailing-whitespace
      - id: detect-private-key
```

```bash
pre-commit install          # hook into .git/hooks/pre-commit
pre-commit run --all-files  # manual run
pre-commit autoupdate       # update revisions
```

---

## GitHub Actions — CI/CD

### Basic Pattern: Plan on PR, Apply on Merge

```yaml
# .github/workflows/terraform.yml
name: Terraform

on:
  push:
    branches: [main]
    paths: ['infra/**']
  pull_request:
    branches: [main]
    paths: ['infra/**']

# Prevent parallel apply (race condition)
concurrency:
  group: terraform-${{ github.ref }}
  cancel-in-progress: false  # do NOT cancel a waiting apply!

jobs:
  plan:
    name: Terraform Plan
    runs-on: ubuntu-latest
    if: github.event_name == 'pull_request'

    permissions:
      id-token: write      # OIDC auth
      contents: read
      pull-requests: write

    defaults:
      run:
        working-directory: infra/

    steps:
      - uses: actions/checkout@v4

      # Cache .terraform directory
      - uses: actions/cache@v4
        with:
          path: infra/.terraform
          key: terraform-${{ hashFiles('infra/.terraform.lock.hcl') }}

      # OpenTofu setup
      - uses: opentofu/setup-opentofu@v1
        with:
          tofu_version: "1.9.0"

      # AWS OIDC auth (no static credentials)
      - uses: aws-actions/configure-aws-credentials@v4
        with:
          role-to-assume: arn:aws:iam::ACCOUNT:role/github-terraform
          aws-region: eu-central-1

      - name: Tofu Init
        run: tofu init

      - name: Tofu Validate
        run: tofu validate

      - name: Tofu Plan
        id: plan
        run: |
          tofu plan -no-color -out=tfplan 2>&1 | tee plan-output.txt
          echo "exitcode=$?" >> $GITHUB_OUTPUT

      # Comment on PR with plan output
      - uses: actions/github-script@v7
        if: github.event_name == 'pull_request'
        with:
          script: |
            const fs = require("fs");
            const plan = fs.readFileSync("infra/plan-output.txt", "utf8");
            const truncated = plan.length > 60000 ? plan.slice(-60000) : plan;
            github.rest.issues.createComment({
              issue_number: context.issue.number,
              owner: context.repo.owner,
              repo: context.repo.repo,
              body: "## Terraform Plan\n\n```\n" + truncated + "\n```"
            });

  apply:
    name: Terraform Apply
    runs-on: ubuntu-latest
    if: github.ref == 'refs/heads/main' && github.event_name == 'push'
    environment: production  # requires manual approval

    permissions:
      id-token: write
      contents: read

    defaults:
      run:
        working-directory: infra/

    steps:
      - uses: actions/checkout@v4

      - uses: actions/cache@v4
        with:
          path: infra/.terraform
          key: terraform-${{ hashFiles('infra/.terraform.lock.hcl') }}

      - uses: opentofu/setup-opentofu@v1
        with:
          tofu_version: "1.9.0"

      - uses: aws-actions/configure-aws-credentials@v4
        with:
          role-to-assume: arn:aws:iam::ACCOUNT:role/github-terraform
          aws-region: eu-central-1

      - name: Tofu Init
        run: tofu init

      - name: Tofu Apply
        run: tofu apply -auto-approve
```

### OIDC Auth — No Static Credentials

OIDC auth = GitHub Actions authenticates directly with AWS/GCP without API keys.

**AWS OIDC Setup (Terraform):**
```hcl
# One-time bootstrap
resource "aws_iam_openid_connect_provider" "github" {
  url = "https://token.actions.githubusercontent.com"

  client_id_list = ["sts.amazonaws.com"]

  thumbprint_list = [
    "6938fd4d98bab03faadb97b34396831e3780aea1"  # GitHub Actions thumbprint
  ]
}

resource "aws_iam_role" "github_terraform" {
  name = "github-terraform"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = {
        Federated = aws_iam_openid_connect_provider.github.arn
      }
      Action    = "sts:AssumeRoleWithWebIdentity"
      Condition = {
        StringLike = {
          "token.actions.githubusercontent.com:sub" = "repo:my-org/my-repo:*"
        }
        StringEquals = {
          "token.actions.githubusercontent.com:aud" = "sts.amazonaws.com"
        }
      }
    }]
  })
}
```

**Hetzner + Cloudflare (no OIDC — API token in secrets):**
```yaml
- name: Tofu Apply
  env:
    TF_VAR_hcloud_token: ${{ secrets.HCLOUD_TOKEN }}
    TF_VAR_cloudflare_api_token: ${{ secrets.CF_API_TOKEN }}
  run: tofu apply -auto-approve
```

### Multi-environment GitHub Actions Matrix

```yaml
strategy:
  matrix:
    environment: [staging, prod]
  fail-fast: false

steps:
  - name: Tofu Plan (${{ matrix.environment }})
    run: |
      tofu plan \
        -var-file="${{ matrix.environment }}.tfvars" \
        -out="${{ matrix.environment }}.tfplan"
```

---

## Atlantis — Self-hosted GitOps

Atlantis = webhook listener on Git — automates plan/apply from PR comments.

```yaml
# atlantis.yaml
version: 3

projects:
  - name: myapp-staging
    dir: environments/staging
    workspace: staging
    autoplan:
      when_modified: ["*.tf", "../../modules/**/*.tf"]
      enabled: true
    apply_requirements:
      - approved
      - mergeable

  - name: myapp-prod
    dir: environments/prod
    workspace: prod
    autoplan:
      enabled: true
    apply_requirements:
      - approved
      - mergeable
      - undiverged
```

PR comments:
```
atlantis plan -p myapp-staging     # manual plan
atlantis apply -p myapp-staging    # apply after approval
atlantis unlock                    # unlock workspace
```

### Deploy Atlantis on a VM (Docker)

```bash
docker run -d \
  -p 4141:4141 \
  -e ATLANTIS_GH_TOKEN=$GH_TOKEN \
  -e ATLANTIS_GH_WEBHOOK_SECRET=$WEBHOOK_SECRET \
  -e ATLANTIS_REPO_ALLOWLIST="github.com/my-org/my-repo" \
  ghcr.io/runatlantis/atlantis:latest server \
    --gh-user=atlantis-bot \
    --gh-token=$GH_TOKEN \
    --gh-webhook-secret=$WEBHOOK_SECRET \
    --repo-allowlist="github.com/my-org/my-repo" \
    --atlantis-url=https://atlantis.example.com
```

---

## Infracost — Cost Estimation

```bash
# Install
brew install infracost

# API key (free)
infracost auth login

# Cost estimate
infracost breakdown --path .
infracost breakdown --path . --format json > infracost.json

# Diff against main
infracost diff --path . --compare-to infracost.json

# GitHub Actions integration
- uses: infracost/actions/setup@v3
  with:
    api-key: ${{ secrets.INFRACOST_API_KEY }}

- name: Infracost diff
  run: |
    infracost diff \
      --path . \
      --format json \
      --out-file /tmp/infracost.json

- uses: infracost/actions/comment@v3
  with:
    path: /tmp/infracost.json
    behavior: update
```

---

## Spacelift — Managed Terraform Platform

Spacelift = managed alternative to Atlantis (SaaS or self-hosted).

When to choose Spacelift:
- Enterprise needs: SSO, audit log, RBAC
- Drift detection with auto-remediation
- Policy-as-code (OPA) natively
- Multi-cloud, multi-tool (Terraform + Pulumi + Ansible)

Basic configuration (via UI or API):
- Stack = a "project" in Spacelift (maps to a Terraform root module)
- Trigger: push to branch or PR
- Policies: approval, scheduling, drift detection
