# Terraform — Research Sources

Public documentation URLs used while building and refreshing this skill. Internal project notes and local filesystem paths have been removed.

## OpenTofu releases & features

- https://opentofu.org/blog/opentofu-1-12-0/ — OpenTofu v1.12.0 (2026-05-14): dynamic `prevent_destroy`, provider checksum auto-hashes, `-json-into=FILENAME`, `destroy = false` lifecycle meta-arg, concurrent provider installation; WinRM provisioner and 32-bit builds deprecated
- https://github.com/opentofu/opentofu/releases — release tags and changelog
- https://opentofu.org/blog/opentofu-1-11-0/ — 1.11 (2025-12-09): ephemeral resources + write-only, `enabled` meta-arg
- https://opentofu.org/docs/v1.11/intro/whats-new/ — 1.11 feature overview
- https://opentofu.org/docs/v1.11/language/meta-arguments/enabled/ — `enabled` syntax and migration from `count`
- https://opentofu.org/docs/v1.11/language/ephemerality/write-only-attributes/ — write-only attributes
- https://github.com/opentofu/opentofu/releases/tag/v1.11.0 — release notes
- https://opentofu.org/blog/opentofu-1-10-0/ — 1.10 (2025-06-23): native S3 locking, OCI registry, OpenTelemetry, MCP server, VS Code extension, tofu-ls
- https://opentofu.org/docs/v1.10/intro/whats-new/ — 1.10 features overview
- https://opentofu.org/docs/language/settings/backends/s3/ — `use_lockfile=true` native S3 locking
- https://opentofu.org/blog/opentofu-1-8-0/ — 1.8: early evaluation, provider-defined functions, `.tofu` extension
- https://oneuptime.com/blog/post/2026-03-20-tofu-file-extension-opentofu-1-8/view — `.tofu`/`.tofu.json` overrides `.tf`
- https://opentofu.org/docs/ — main docs
- https://opentofu.org/docs/intro/migration/ — migrate from Terraform
- https://opentofu.org/docs/language/state/encryption/ — state encryption (1.7+)
- https://opentofu.org/blog/ — release notes and features
- https://github.com/opentofu/opentofu — GitHub repo
- https://opentofu.org/docs/cli/config/config-file/ — `.tofurc` / `tofu.rc`
- https://opentofu.org/docs/cli/config/ — CLI config overview
- https://opentofu.org/docs/cli/plugins/ — provider plugin terminology

## Terraform core (HashiCorp)

- https://github.com/hashicorp/terraform/releases — latest stable (v1.15.x patch line as of mid-2026)
- https://releases.hashicorp.com/terraform/ — patch history
- https://developer.hashicorp.com/terraform/language — HCL language reference
- https://developer.hashicorp.com/terraform/language/providers — providers
- https://developer.hashicorp.com/terraform/language/resources — resources and meta-arguments
- https://developer.hashicorp.com/terraform/language/meta-arguments/lifecycle — lifecycle rules
- https://developer.hashicorp.com/terraform/language/expressions — expressions, for, conditionals
- https://developer.hashicorp.com/terraform/language/state — state management
- https://developer.hashicorp.com/terraform/language/backend — backend configuration
- https://developer.hashicorp.com/terraform/cli/state — CLI state commands
- https://developer.hashicorp.com/terraform/language/import — import blocks (1.5+)
- https://developer.hashicorp.com/terraform/language/modules — modules
- https://developer.hashicorp.com/terraform/language/tests — test framework (1.6+)
- https://developer.hashicorp.com/terraform/cli/workspaces — workspaces
- https://developer.hashicorp.com/terraform/language/style — style guide
- https://developer.hashicorp.com/terraform/language/resources/ephemeral — ephemeral resources + write-only intro
- https://developer.hashicorp.com/terraform/language/resources/ephemeral/write-only — write-only args (TF 1.11+)
- https://developer.hashicorp.com/terraform/language/values/variables#exclude-values-from-state — ephemeral input variables
- https://developer.hashicorp.com/terraform/language/block/removed — removed block
- https://developer.hashicorp.com/terraform/language/block/check — check block
- https://developer.hashicorp.com/terraform/language/resources/terraform-data — terraform_data
- https://developer.hashicorp.com/terraform/language/functions — provider-defined functions
- https://developer.hashicorp.com/terraform/language/block/action — action blocks (TF 1.14)
- https://developer.hashicorp.com/terraform/language/backend/s3 — S3 `use_lockfile = true`
- https://github.com/hashicorp/terraform/blob/v1.15.0/CHANGELOG.md — `deprecated` on variable/output; variables/locals in module source/version
- https://github.com/hashicorp/terraform/blob/v1.14/CHANGELOG.md — terraform query + List Resources + action blocks
- https://github.com/hashicorp/web-unified-docs/blob/main/content/terraform/v1.14.x/docs/language/block/tfquery/list.mdx — `list` block in `.tfquery.hcl`
- https://registry.terraform.io/providers/-/aws/latest/docs/functions/arn_parse — `provider::aws::arn_parse`

## Plugin management & lock/mirror

- https://developer.hashicorp.com/terraform/cli/config/config-file — `.terraformrc`, plugin cache, provider_installation
- https://developer.hashicorp.com/terraform/cli/commands/providers/lock — multi-platform lock
- https://developer.hashicorp.com/terraform/cli/commands/providers/mirror — provider mirror

## Editor / lint tooling

- https://github.com/terraform-linters/tflint — tflint (v0.62.x)
- https://github.com/antonbabenko/pre-commit-terraform — pre-commit hooks (v1.105.x)

## Custom provider development

- https://developer.hashicorp.com/terraform/plugin/framework — terraform-plugin-framework
- https://developer.hashicorp.com/terraform/plugin/which-sdk — framework vs SDKv2

## Testing (terraform test, Terratest, Sentinel)

- https://developer.hashicorp.com/terraform/language/tests — testing framework TF 1.6+
- https://developer.hashicorp.com/terraform/language/tests/mocking — mocking TF 1.7+
- https://docs.hashicorp.com/terraform/language/v1.7.x/files/tests — test files config reference
- https://oneuptime.com/blog/post/2026-02-23-how-to-use-override-files-in-terraform-tests/view — override files practice
- https://mattias.engineer/blog/2024/terraform-test-mocks/ — terraform test mocks deep dive
- https://terratest.gruntwork.io/docs/getting-started/quick-start/ — Terratest quick start
- https://developer.hashicorp.com/sentinel/docs/concepts/enforcement-levels — advisory / soft-mandatory / hard-mandatory
- https://developer.hashicorp.com/sentinel/docs/features/terraform/tfplan-v2 — tfplan/v2 import
- https://developer.hashicorp.com/terraform/cloud-docs/policy-enforcement/import-reference/tfplan-v2 — tfplan/v2 import reference (HCP)
- https://developer.hashicorp.com/terraform/cloud-docs/workspaces/policy-enforcement/define-policies/custom-sentinel — custom Sentinel policy
- https://developer.hashicorp.com/terraform/enterprise/workspaces/policy-enforcement/manage-policy-sets — policy sets

## Terragrunt

- https://docs.terragrunt.com/features/stacks/ — Stacks overview
- https://docs.terragrunt.com/features/stacks/explicit/ — `terragrunt.stack.hcl`, unit/stack blocks
- https://docs.terragrunt.com/features/stacks/implicit/ — implicit stacks from directory structure
- https://docs.terragrunt.com/reference/cli/commands/stack/generate/ — `terragrunt stack generate`
- https://terragrunt.gruntwork.io/docs/reference/config-blocks-and-attributes — generate, remote_state, dependency
- https://terragrunt.gruntwork.io/docs/migrate/cli-redesign — CLI redesign (`run --all`, etc.)
- https://github.com/gruntwork-io/terragrunt/pull/4233 — deprecating run-all
- https://github.com/gruntwork-io/terragrunt/issues/3445 — CLI Redesign RFC
- https://terragrunt.gruntwork.io/docs/ — Terragrunt docs
- https://github.com/gruntwork-io/terragrunt — GitHub (examples)

## Cloud providers

### Hetzner Cloud
- https://registry.terraform.io/providers/hetznercloud/hcloud/latest/docs
- https://github.com/hetznercloud/terraform-provider-hcloud
- https://docs.hetzner.cloud/

### Cloudflare
- https://registry.terraform.io/providers/cloudflare/cloudflare/latest/docs
- https://developers.cloudflare.com/terraform/
- https://github.com/cloudflare/terraform-provider-cloudflare
- https://github.com/cloudflare/tf-migrate

### GCP
- https://registry.terraform.io/providers/hashicorp/google/latest/docs
- https://cloud.google.com/docs/terraform

### Kubernetes + Helm
- https://registry.terraform.io/providers/hashicorp/kubernetes/latest/docs
- https://registry.terraform.io/providers/hashicorp/helm/latest/docs

## Policy-as-Code

- https://www.checkov.io/1.Welcome/What%20is%20Checkov.html
- https://aquasecurity.github.io/trivy/latest/docs/scanner/misconfiguration/
- https://www.openpolicyagent.org/docs/
- https://www.conftest.dev/
- https://github.com/antonbabenko/pre-commit-terraform

## CI/CD

- https://developer.hashicorp.com/terraform/tutorials/automation/github-actions
- https://opentofu.org/docs/intro/install/github-actions/
- https://runatlantis.io/docs/
- https://spacelift.io/docs
- https://www.infracost.io/docs/
- https://www.infracost.io/docs/guides/github_actions/

## Complementary tools

- https://terraform-docs.io/
- https://github.com/tflint/tflint
- https://github.com/infracost/infracost
- https://mise.jdx.dev/

## Best practices

- https://cloud.google.com/docs/terraform/best-practices-for-terraform
- https://www.hashicorp.com/resources/evolving-infrastructure-terraform-opencredo
- https://developer.hashicorp.com/terraform/language/style
