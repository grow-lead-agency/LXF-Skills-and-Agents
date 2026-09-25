# First session: starter prompt

Open Claude Code in the platform repository (the Laravel ERP), then paste everything between the
lines. The agent verifies the pack, onboards you, calibrates the skills against the real code, runs a
security baseline and proposes the first pull requests. It does not change any code in this session.

---

I am a developer on this Laravel ERP repository. Onboard me with the LXF-Skills-and-Agents pack and give me a security baseline. Work step by step, show the verification output of every step, ask before installing anything, and do not change any code in this session.

1. Verify the pack. Confirm the plugin `lxf-skills-and-agents` is installed (version 1.1.1 or newer, 28 skills). If it is not, print these two commands and stop:
   `claude plugin marketplace add grow-lead-agency/LXF-Skills-and-Agents`
   `claude plugin install lxf-skills-and-agents@lxf-skills`

2. Onboarding. Follow steps 2 to 4 of the runbook at https://raw.githubusercontent.com/grow-lead-agency/LXF-Skills-and-Agents/main/AGENTS.md (process skills, Context7, `AGENTS.md` plus a thin `CLAUDE.md` in this repository). Fill the `AGENTS.md` template by inspecting the actual repository, no placeholders.

3. Calibration (step 5 of the runbook). Read the "Project conventions" section of the skills `laravel-11`, `laravel-security`, `shoptet-api-integration`, `deployer-php` and `laravel-ci-github`. Check every claim against this repository (paths, directory roles, queue driver, commands) and list what differs. Record the corrections in this repository's `AGENTS.md`.

4. Security baseline. Run
   `semgrep --config https://raw.githubusercontent.com/grow-lead-agency/LXF-Skills-and-Agents/main/skills/laravel-security/references/semgrep-rules.yml app/ routes/ resources/views/`
   (install Semgrep first with `pip install semgrep` or `brew install semgrep` if it is missing). Then go through `references/audit-checklist.md` and `references/route-exposure.md` of the `laravel-security` skill: list every route that writes data or returns customer data and has no authentication or authorization middleware. Report the findings grouped by rule, most severe first, with file:line, severity and a one-line fix. For any rule with more than 20 hits (typically `blade-raw-output` and `laravel-debug-output`), give counts per directory and the ten riskiest examples instead of every line, and tell me which of those hits are real (user-controlled input) versus safe (trusted, already escaped).

5. First pull requests. Based on steps 3 and 4, propose the first five pull requests, smallest and safest first. One PR = one topic, each with a regression test. If the repository has no CI, make "CI gate" (skill `laravel-ci-github`) one of the five. Wait for my approval before writing any code.

---

After the first session, start every non-trivial change with the process skills (spec first, tests first) and let the skills do their job: they activate on their own when a question or a file matches their domain.
