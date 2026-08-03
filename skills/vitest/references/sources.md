# Research Sources — Vitest

## 2026-04-05 — Initial creation

- https://vitest.dev/guide/ — Getting Started, installation, writing tests, configuration
- https://vitest.dev/guide/mocking — Mocking guide (vi.fn, vi.mock, vi.spyOn, cheat sheet)
- https://vitest.dev/guide/coverage — Coverage providers (v8 vs istanbul), configuration, ignoring code
- https://vitest.dev/guide/cli — Command line interface reference
- https://vitest.dev/guide/projects — Test Projects (workspace/monorepo)
- https://vitest.dev/config/ — Full config reference
- https://vitest.dev/api/ — Full API reference (describe, it, expect, vi)
- https://vitest.dev/api/mock — Mock API (MockInstance, mockReset, mockRestore)
- https://vitest.dev/api/vi — vi helper API
- https://vitest.dev/api/expect — Matchers reference
- https://vitest.dev/guide/environment — Test environments (node, jsdom, happy-dom, edge-runtime)
- https://vitest.dev/guide/snapshot — Snapshot testing
- https://vitest.dev/guide/ui — Vitest UI
- https://github.com/vitest-dev/vitest — Vitest GitHub repository
- https://vitest.dev/blog/vitest-3-2 — Vitest 3.2 release notes (AST-based coverage remapping)

## 2026-07-15 — Delta refresh

Verified via Context7 (`/vitest-dev/vitest` — Versions: v3_2_4, v4.0.7, v4.1.6) + npm registry
(`npm view vitest version` → 4.1.10, dist-tags: `latest=4.1.10`, `V3=3.2.7`, `beta=5.0.0-beta.6`
— a Vitest 5 beta exists but is not stable, not covered here).

**Drift found and fixed:**
- Skill had no explicit "current stable" version anchor (unlike the react-19/nextjs/vite
  skills) — added "Current stable: Vitest 4.1.x" line. Vitest 4.0.0 actually GA'd 2025-10-22,
  so this drift predates the 2026-05-25 window but was still worth catching/stamping now.
- Coverage section didn't mention that `coverage.all`, `coverage.extensions`,
  `coverage.ignoreEmptyLines`, and `coverage.experimentalAstAwareRemapping` were **removed** in
  v4 (AST-aware remapping is now always-on, not opt-in). Skill's example config never used these
  removed options, so no code sample needed fixing, but added an explicit "don't use these"
  callout since they're a common copy-paste trap from pre-v4 blog posts/Stack Overflow answers.
- Added a new **Browser Mode (v4 config changed)** subsection — not previously covered at all.
  Two real breaking changes worth flagging: import path `@vitest/browser/context` → `vitest/browser`,
  and browser providers now imported as functions from separate packages
  (`@vitest/browser-playwright` etc.) instead of passed as `provider: 'playwright'` strings.
- Confirmed **no drift** in the existing Test Projects section — it already uses `test.projects`
  (correct v4 key), not the deprecated `test.workspace` (deprecated since 3.2, on its way to
  removal). Added a one-line callout near the version stamp pointing this out explicitly.

Sources fetched:
- https://github.com/vitest-dev/vitest/blob/main/docs/blog/vitest-4.md (via Context7) — Fetched: 2026-07-15
- https://github.com/vitest-dev/vitest/blob/main/docs/guide/migration.md (via Context7) — Fetched: 2026-07-15
- https://github.com/vitest-dev/vitest/blob/main/docs/guide/examples/projects-workspace.md (via Context7) — Fetched: 2026-07-15
- npm registry `vitest` package version/dist-tags/time — Fetched: 2026-07-15

No drift found in: Mocking (vi.fn/vi.mock/vi.spyOn), Matchers, Timers, Snapshots, CF Workers
(Hono) test pattern, CLI reference, Best Practices — all still accurate against v4.
