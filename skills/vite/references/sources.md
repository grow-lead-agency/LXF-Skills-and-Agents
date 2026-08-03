# Research Sources — Vite Skill

## Primary Sources

- https://vite.dev/guide/ — Official Vite guide
- https://vite.dev/config/ — Full configuration reference
- https://vite.dev/guide/features — Vite features (glob imports, env vars, assets)
- https://vite.dev/guide/build — Build guide (library mode, targets, rollup options)
- https://vite.dev/guide/api-plugin — Plugin API reference
- https://vite.dev/guide/api-environment — Environment API (Vite 6)
- https://vite.dev/guide/env-and-mode — Environment variables and modes
- https://vite.dev/config/build-options — Build options reference
- https://vite.dev/config/server-options — Server options reference
- https://vite.dev/config/optimizedeps — optimizeDeps reference
- https://vite.dev/blog/announcing-vite6 — Vite 6 announcement and new features

## Vendor Skills (Reference)

- https://raw.githubusercontent.com/antfu/skills/refs/heads/main/skills/vite/SKILL.md — antfu's Vite skill (Vite 8 beta focus)
- https://raw.githubusercontent.com/antfu/skills/refs/heads/main/skills/vite/references/core-config.md
- https://raw.githubusercontent.com/antfu/skills/refs/heads/main/skills/vite/references/core-features.md
- https://raw.githubusercontent.com/antfu/skills/refs/heads/main/skills/vite/references/build-and-ssr.md
- https://raw.githubusercontent.com/antfu/skills/refs/heads/main/skills/vite/references/environment-api.md
- https://raw.githubusercontent.com/antfu/skills/refs/heads/main/skills/vite/references/core-plugin-api.md

## Plugin Documentation

- https://github.com/vitejs/vite-plugin-react — @vitejs/plugin-react
- https://tailwindcss.com/docs/installation/framework-guides/vite — Tailwind v4 + Vite
- https://tanstack.com/router/latest/docs/framework/react/bundling/vite — TanStack Router Vite plugin
- https://github.com/nicolo-ribaudo/vitest-pool-workers — @cloudflare/vitest-pool-workers

## Testing Sources

- https://vitest.dev/guide/ — Vitest guide
- https://developers.cloudflare.com/workers/testing/vitest-integration/ — CF Workers + Vitest pool
- https://testing-library.com/docs/react-testing-library/intro/ — React Testing Library

## 2026-07-15 — Delta refresh

Verified via Context7 (`/vitejs/vite` — Versions: v7.0.0, v5.4.21, v8.0.0, v7.3.1, v8.0.7,
v8.0.10) + npm registry (`npm view vite version` → 8.1.4, dist-tags: `latest=8.1.4`,
`previous=7.3.6`, `beta=8.1.0-beta.0`).

**Drift found and fixed (significant — major-version drift):**
- Skill said "This stack uses Vite 6.3.x. The antfu/vite skill targets Vite 8 beta (Rolldown)."
  — **wrong**: Vite 8.0 GA'd 2026-06-23 (no longer beta), now on 8.1.4. Rolldown was merged
  into the core `vite` package as the default unified bundler (replaces Rollup+esbuild split),
  reportedly 10-30x faster builds. Rewrote intro + description to lead with Vite 8 as current
  stable while keeping full Vite 6.x compat notes (most content applies unchanged — Vite 8 has
  an automatic compat layer for `rollupOptions`/`esbuildOptions`).
- Added **## 12. Vite 8 (Rolldown) — What Changed**: the 3 official breaking changes
  (`optimizeDeps.esbuildOptions` → `rolldownOptions` deprecation, `import.meta.hot.accept`
  fallback removed, default browser build target updated) plus 2 behavior-affecting notes
  (`define` no longer shares object references, `build.commonjsOptions` now no-op).
- Softened "Vite 6 config options reference" table header — options table is unchanged across
  6.x–8.x, just relabeled to not imply it's 6-only.

Sources fetched:
- https://github.com/vitejs/vite/blob/main/packages/vite/CHANGELOG.md (via Context7) — Fetched: 2026-07-15
- https://github.com/vitejs/vite/blob/main/docs/guide/migration.md (via Context7) — Fetched: 2026-07-15
- https://github.com/vitejs/vite/blob/main/docs/blog/announcing-vite8.md (via Context7) — Fetched: 2026-07-15
- npm registry `vite` package version/dist-tags/time — Fetched: 2026-07-15

No drift found in: vite.config.ts anatomy, env var handling, monorepo/NX patterns, plugin
configs (`@vitejs/plugin-react`, `@tailwindcss/vite`, TanStack Router plugin — all confirmed
compatible with Vite 8/Rolldown), dev server/HMR/proxy config, library mode, SSR/CF Workers
notes, Vitest integration patterns.
