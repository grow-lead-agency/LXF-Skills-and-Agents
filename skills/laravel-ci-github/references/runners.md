# Runner selection — org vs client repos

`ci.yml` and `deploy.yml` both use:

```yaml
runs-on: ${{ vars.CI_RUNNER || 'ubuntu-latest' }}
```

## grow-lead-agency repos — self-hosted ONLY (HARD RULE)

For repos under the `grow-lead-agency` GitHub org, GitHub-hosted runners
(`ubuntu-latest`, `macos-*`) are not allowed at all — not for security scans, not as a
temporary fallback. Set the repo variable so the fallback branch of the expression is
never actually taken:

```bash
gh variable set CI_RUNNER --body "m5" --repo grow-lead-agency/<repo>
```

Heavy jobs (long PHPUnit runs, Larastan on a 600+ file app at a high level) route to a
separate heavier pool via a second variable:

```yaml
runs-on: ${{ vars.CI_RUNNER_HEAVY || 'ubuntu-latest' }}
```

```bash
gh variable set CI_RUNNER_HEAVY --body "e2e" --repo grow-lead-agency/<repo>
```

If the M5 self-hosted pool is overloaded, the fix is a job diet or another runner — never
flipping a workflow back to a GitHub-hosted runner, even temporarily. See `github-master`
agent / skill for the full self-hosted runner operations playbook (onboarding a repo,
workload routing GREEN/YELLOW/RED, cost reporting).

## Client repos (e.g. a Laravel app on a client's own GitHub org)

The self-hosted-only rule is a GrowLead org policy, not a general one. A client repo with
no runner pool of its own should just use the `ubuntu-latest` fallback — leave the
`vars.CI_RUNNER` expression in place (it costs nothing when the variable is unset, and it
means the workflow "just works" if the client later spins up self-hosted runners), but do
not create the `CI_RUNNER` repo variable unless the client actually has a runner pool to
point it at.

## MySQL service container note

The `mysql:8.0` service container in `ci.yml`'s `test` job works identically on
GitHub-hosted and self-hosted Linux runners (Docker is required on self-hosted runners for
service containers — verify with `docker --version` on the runner if a self-hosted job
fails to start the service with "docker: command not found").
