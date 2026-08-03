# Research Sources — Vite Skill

## Primary Vite Sources

- https://vite.dev/guide/ — Current official Vite guide
- https://vite.dev/guide/features — CSS preprocessors, assets, and frontend features
- https://vite.dev/guide/env-and-mode — Environment variables and `.env` modes
- https://vite.dev/guide/api-plugin — Plugin ordering, transforms, and HMR hooks
- https://vite.dev/guide/build — Current build and library mode guide
- https://vite.dev/guide/migration — Vite 8 migration guidance
- https://vite.dev/config/shared-options — Plugins, aliases, and `css.preprocessorOptions`
- https://vite.dev/config/server-options — Dev server, proxy, CORS, HMR, and warmup
- https://vite.dev/config/build-options — Vite 8 build, minification, and Rolldown options
- https://vite.dev/config/dep-optimization-options — Vite 8 dependency optimization
- https://v6.vite.dev/guide/ — Archived official Vite 6 guide
- https://v6.vite.dev/config/shared-options — Vite 6 shared and SCSS options
- https://v6.vite.dev/config/server-options — Vite 6 dev server options
- https://v6.vite.dev/config/build-options — Vite 6 Rollup, esbuild, target, and build defaults
- https://v6.vite.dev/config/dep-optimization-options — Vite 6 esbuild dependency optimization
- https://rolldown.rs/reference/OutputOptions.codeSplitting — Vite 8 / Rolldown chunk groups

## Integration Sources

- https://laravel.com/docs/11.x/vite — Laravel 11 Vite plugin, React, Blade `@vite`, manifest, and refresh
- https://github.com/laravel/vite-plugin — Official `laravel-vite-plugin` package
- https://github.com/vitejs/vite-plugin-react — Official React plugin
- https://reactrouter.com/start/data/route-object#lazy — React Router lazy route modules
- https://vitest.dev/guide/ — Vitest configuration and Vite integration
- https://sass-lang.com/documentation/at-rules/use/ — Sass module-system `@use`
- https://getbootstrap.com/docs/5.3/customize/sass/ — Bootstrap 5 Sass customization
- https://tailwindcss.com/docs/installation/using-vite — Optional Tailwind v4 Vite plugin

## 2026-08-03 — Reader-Stack Reframe

Verified through Context7 against `/vitejs/vite/v8.0.10` and the archived Vite 6 docs,
then checked against the official pages above. Firecrawl retrieval was unavailable during
this refresh, so the official pages were loaded directly.

Confirmed version boundary:

- Vite 6 uses Rollup for production builds, esbuild for dependency optimization and the
  default client minifier, `build.rollupOptions`, `optimizeDeps.esbuildOptions`, and the
  `modules` default build target.
- Vite 8 uses Rolldown for dependency optimization and production builds, Oxc for JavaScript
  transforms/default client minification, Lightning CSS for default CSS minification,
  `build.rolldownOptions`, `optimizeDeps.rolldownOptions`, and the
  `baseline-widely-available` default build target.
- Laravel 11's official React example registers `laravel(...)` before `react()`, accepts JSX
  as an input, requires `@viteReactRefresh` before Blade's `@vite(...)`, and supports
  `refresh: true` or explicit watched paths.
- Vite supports Sass through `sass-embedded` or `sass` and configures it through
  `css.preprocessorOptions.scss`; Sass `@use` statements precede other rules, while
  Bootstrap 5.3 still documents `@import` for its Sass entry and partial customization.
