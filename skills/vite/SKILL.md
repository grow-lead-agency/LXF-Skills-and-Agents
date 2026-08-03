---
name: vite
description: >-
  Configure and troubleshoot two independent React applications: a Vite 6 / React 18
  Laravel 11 admin built with laravel-vite-plugin, Bootstrap 5, and Sass; and a Vite 8 /
  React 19 storefront SPA using react-router-dom 7 and a GraphQL BFF. Covers version-safe
  vite.config files, plugins, Blade @vite integration, SCSS, env variables, dev proxies,
  builds, code splitting, dependency optimization, HMR, library mode, and Vitest. Use for
  Vite config, import.meta.env, VITE_, laravel-vite-plugin, Rolldown, Oxc, or HMR issues.
---

# Vite for Two Independent React Apps

Treat the applications as separate projects. Each has its own `package.json`, lockfile,
`vite.config.*`, dependency versions, dev server, and build command. Do not introduce
workspace aliases, a shared monorepo config, a routing generator, or a Vite router plugin.

| Application | Runtime and integration | Vite-specific rule |
|---|---|---|
| Laravel admin | Vite 6, React 18, Bootstrap 5, Laravel 11 | Laravel owns the HTML; `laravel-vite-plugin` owns entries, refresh, hot-file, and manifest integration |
| Storefront | Vite 8, React 19, `react-router-dom` 7, GraphQL BFF | Vite owns `index.html`; React Router is configured in application code |

Always inspect the installed Vite major before changing advanced options:

```bash
npm ls vite
```

## 1. Default Configurations

### Laravel admin: Vite 6

```js
// vite.config.js (Laravel project root)
import { defineConfig } from "vite";
import laravel from "laravel-vite-plugin";
import react from "@vitejs/plugin-react";
import { fileURLToPath, URL } from "node:url";

export default defineConfig({
  plugins: [
    laravel({
      input: ["resources/js/app.jsx"],
      refresh: true,
    }),
    react(),
  ],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./resources/js", import.meta.url)),
      "@styles": fileURLToPath(new URL("./resources/sass", import.meta.url)),
    },
  },
  css: {
    preprocessorOptions: {
      scss: {
        // Inject shared Sass APIs only; emitted CSS here would be duplicated.
        additionalData: '@use "@styles/tokens" as *;',
      },
    },
  },
});
```

Import the main stylesheet from the JavaScript entry when the application has a single
React entry:

```jsx
// resources/js/app.jsx
import "../sass/app.scss";
import "bootstrap";
```

Laravel's official React setup places `laravel(...)` before `react()`. In Blade, include
React Refresh before the entry:

```blade
@viteReactRefresh
@vite('resources/js/app.jsx')
```

During development these directives point at the Vite dev server. After `npm run build`,
`@vite` resolves the hashed JavaScript and imported CSS through Laravel's Vite manifest.
Keep the Blade entry string identical to `laravel({ input: ... })`.

`refresh: true` performs full-page refreshes for Laravel's default Blade, route, language,
Livewire, and view-component paths. Use an explicit list such as
`refresh: ["resources/views/**"]` only when the defaults are too broad.

### Storefront SPA: Vite 8

```js
// vite.config.js (storefront root)
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath, URL } from "node:url";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      "/graphql": {
        target: "http://localhost:3000",
        changeOrigin: true,
      },
    },
  },
  build: {
    sourcemap: "hidden",
  },
});
```

The proxy is development-only. Production routing or `VITE_GRAPHQL_URL` determines the
deployed BFF URL. Keep the proxy path unchanged when the BFF is already mounted at
`/graphql`; add `rewrite` only when the upstream path is genuinely different.

### Plugin ordering

`react()` provides JSX transformation and Fast Refresh. If another plugin transforms
source before React, follow that plugin's documentation and prefer its `enforce: "pre"`
contract; build/reporting plugins normally use `enforce: "post"`. Vite resolves plugins in
`pre` → core → normal → build → `post` buckets, so array order alone does not override
`enforce`. The Laravel integration remains `laravel(...), react()` as shown above.

## 2. Sass / SCSS and Bootstrap

Vite handles `.scss` without a Vite-specific plugin, but Sass must be installed:

```bash
npm install -D sass-embedded
```

Prefer Sass modules in the main stylesheet:

```scss
// resources/sass/app.scss
@use "./tokens" as tokens;

// Bootstrap 5.3's documented Sass entry still uses the legacy import form.
@import "bootstrap/scss/bootstrap";

.admin-shell {
  color: tokens.$text-color;
}
```

Prefer `@use` for application partials and place it before `@import` or style rules. Bootstrap
5.3 still documents `@import` for its Sass entry and partial customization. Use
`css.preprocessorOptions.scss` for compiler options or small shared variable/mixin injections.
If `additionalData` contains selectors or other emitted CSS, that CSS is repeated in every
processed SCSS file. Aliases or absolute paths are safer than relative paths in injected content.

Tailwind is optional, not the default styling path. If a separate app adopts Tailwind v4,
install `tailwindcss` and `@tailwindcss/vite`, then add `tailwindcss()` to that app's plugins.

## 3. Environment Variables and Modes

Only variables prefixed with `VITE_` are exposed to browser code. They are public after a
build; never put credentials or server secrets in them.

```js
const endpoint = import.meta.env.VITE_GRAPHQL_URL;
const mode = import.meta.env.MODE;
const isDev = import.meta.env.DEV;
const isProd = import.meta.env.PROD;
const base = import.meta.env.BASE_URL;
```

Load order, highest priority first:

```text
.env.[mode].local
.env.[mode]
.env.local
.env
```

Use `loadEnv` when non-`VITE_` values are needed while evaluating the config:

```js
import { defineConfig, loadEnv } from "vite";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  return { server: { port: Number(env.DEV_PORT) || 5173 } };
});
```

Typing for TypeScript applications belongs in `src/vite-env.d.ts`:

```ts
/// <reference types="vite/client" />
interface ImportMetaEnv { readonly VITE_GRAPHQL_URL: string }
interface ImportMeta { readonly env: ImportMetaEnv }
```

Vite also replaces `%VITE_APP_NAME%`-style placeholders in `index.html`. This applies to
the storefront HTML, not to Blade templates.

## 4. Vite 6 vs Vite 8 Build Pipeline

| Concern | Admin: Vite 6 | Storefront: Vite 8 |
|---|---|---|
| Dependency optimization | esbuild | Rolldown |
| Production bundler | Rollup | Rolldown |
| JS transform/minifier | esbuild; client minify default `esbuild` | Oxc; client minify default `oxc` |
| CSS minifier default | esbuild | Lightning CSS |
| Advanced build key | `build.rollupOptions` | `build.rolldownOptions` |
| Optimizer-specific key | `optimizeDeps.esbuildOptions` | `optimizeDeps.rolldownOptions` |
| Default browser target | `modules` | `baseline-widely-available` |

Vite 8 accepts some Vite 6 keys through compatibility aliases, but they are migration
inputs, not new-config defaults. Never copy `rolldownOptions`, Oxc minifier settings, or
Rolldown `codeSplitting` into the Vite 6 admin config.

Generic build options work in both versions:

```js
build: {
  target: "es2020",       // Pin only when browser support must not drift.
  sourcemap: "hidden",    // External maps without sourceMappingURL comments.
  cssCodeSplit: true,
  minify: true,            // Uses the version's default minifier.
}
```

### Code splitting

Prefer dynamic imports and React Router lazy route modules before manual vendor groups:

```js
const routes = [
  { path: "/products", lazy: () => import("./routes/products.jsx") },
];
```

Vite 8 / Rolldown-only grouping:

```js
build: {
  rolldownOptions: {
    output: {
      codeSplitting: {
        groups: [
          { name: "react-vendor", test: /node_modules[\\/](?:react|react-dom)[\\/]/, priority: 20 },
          { name: "router-vendor", test: /node_modules[\\/]react-router(?:-dom)?[\\/]/, priority: 15 },
        ],
      },
    },
  },
}
```

Vite 6 equivalent:

```js
build: {
  rollupOptions: {
    output: {
      manualChunks: {
        "react-vendor": ["react", "react-dom"],
        "router-vendor": ["react-router-dom"],
      },
    },
  },
}
```

Default chunking is usually sufficient. Add groups only after bundle analysis shows a
caching or loading problem. See [references/build-optimization.md](references/build-optimization.md).

## 5. Dependency Optimization

`include` and `exclude` are valid in both versions:

```js
optimizeDeps: {
  include: ["react", "react-dom", "react-router-dom"],
  // exclude: ["already-clean-esm-package"],
  force: false,
}
```

Add `include` when runtime discovery causes repeated “new dependencies found” restarts or
when a CommonJS dependency needs eager conversion. Use `npm run dev -- --force` once to
rebuild the optimizer cache. Put low-level optimizer settings under
`esbuildOptions` on Vite 6 and `rolldownOptions` on Vite 8.

## 6. Dev Server, Proxy, and HMR

Run each app from its own root. Use distinct ports only if both dev servers run together:

```bash
npm install
npm run dev
npm run build
npm run preview # only if this app defines a preview script
```

The Laravel admin is normally opened through the Laravel URL so Blade can emit the Vite
tags; do not use the Vite server as the application origin. The standalone storefront is
opened directly through its Vite dev server.

React Fast Refresh works when `react()` is installed and loaded. Behind a reverse proxy:

```js
server: {
  hmr: { protocol: "ws", host: "localhost", clientPort: 5173 },
}
```

Prefer an explicit `server.cors.origin` allowlist over `cors: true` when the dev server is
reachable by other machines. `server.warmup.clientFiles` may pre-transform hot paths in
either app; use real entry/route paths from that app.

## 7. Library Mode

Library mode is independent of the two application builds, but remains useful for a
separately published package:

```js
// Vite 8
import { fileURLToPath, URL } from "node:url";

build: {
  lib: {
    entry: fileURLToPath(new URL("./src/index.js", import.meta.url)),
    formats: ["es"],
  },
  rolldownOptions: {
    external: ["react", "react-dom", "react/jsx-runtime"],
  },
  sourcemap: true,
}
```

For Vite 6, keep `build.lib` but replace `rolldownOptions` with `rollupOptions`. Externalize
peer dependencies so consumers provide their own React instance.

## 8. Vitest Integration

Keep one test config per app:

```js
// vitest.config.js
import { defineConfig, mergeConfig } from "vitest/config";
import viteConfig from "./vite.config.js";

export default mergeConfig(viteConfig, defineConfig({
  test: {
    environment: "jsdom",
    setupFiles: ["./src/test/setup.js"],
  },
}));
```

Use paths appropriate to each app (`resources/js/...` in the admin, `src/...` in the
storefront). Keep Vitest and Vite versions compatible with that app's installed major.

## 9. Troubleshooting

- **HMR fails:** inspect browser WebSocket errors; verify the correct app/port and `react()`;
  behind a proxy, set `server.hmr.clientPort`. Laravel Blade changes are full reloads from
  `refresh`, while React module changes use Fast Refresh.
- **Import cannot resolve:** confirm the package is installed in this app, inspect its exports,
  then check the app-local alias. There are no workspace-package fallbacks.
- **Optimizer loops:** add the discovered dependency to `optimizeDeps.include`, then force one
  cache rebuild.
- **CJS/ESM error:** include the problematic CommonJS package in dependency optimization.
- **Wrong chunk sizes:** use a bundle visualizer, then lazy-load routes or add the
  version-correct chunk configuration.
- **SCSS fails:** install `sass-embedded` (or `sass`), keep `@use` before style rules, and avoid
  fragile relative paths in `additionalData`.
- **Laravel asset 404:** make `laravel({ input })` and Blade `@vite(...)` identical, ensure the
  Vite dev server is running in development, or rebuild the production manifest.

The Environment API, Module Runner API, SSR, and other deployment targets such as edge
static hosting are advanced concerns; neither default application needs them.

## References

| Topic | File |
|---|---|
| Custom plugins, ordering, virtual modules, HMR | [references/plugin-api.md](references/plugin-api.md) |
| Version-aware build optimization | [references/build-optimization.md](references/build-optimization.md) |
| Official sources and verification log | [references/sources.md](references/sources.md) |

<!-- Origin: https://vite.dev/guide/, https://v6.vite.dev/guide/, https://laravel.com/docs/11.x/vite | Inspiration: https://sass-lang.com/documentation/at-rules/use/ -->
