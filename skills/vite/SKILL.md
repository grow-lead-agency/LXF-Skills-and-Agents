---
name: vite
description: >-
  Vite 8.x (Rolldown, GA) build tool mastery — vite.config.ts, plugins, Environment API,
  dev server, build optimization, library mode, and Vitest integration. Also covers the
  Vite 6.x baseline (older/pinned projects) and the Vite 6→8 migration delta.
  Use when configuring Vite, debugging builds or HMR, adding plugins, splitting
  chunks, setting up env vars, or integrating Tailwind v4 / edge static assets.
  Not for: general webpack configuration (Vite 8 bundles via Rolldown, not Rollup+esbuild —
  see section 12).
  Triggers: vite, vite.config, defineConfig, import.meta.env, VITE_, HMR, vite build,
  vite dev, optimizeDeps, rollupOptions, rolldownOptions, manualChunks, @vitejs/plugin-react,
  @tailwindcss/vite, vitest, library mode, SSR, vite plugin, chunk splitting, rolldown,
  rolldown-vite, vite 8, vite 6.
---

# Vite — Build Tool Mastery

Vite build tool for a modern React stack: monorepo + React 19 + TanStack Router + Tailwind v4 (optional edge/static asset hosting).

**Current stable: Vite 8.1.x** (Vite 8.0 GA'd 2026-06-23, Rolldown merged in as the default
unified bundler; latest patch 8.1.4 — last verified 2026-07-15 via npm + Context7
`/vitejs/vite`). **If a project still pins `vite@^6.3.x`** (e.g. an older project
that hasn't been bumped), most of this skill applies unchanged — `build.rollupOptions`
still works via Vite 8's automatic compat layer, and `@tailwindcss/vite` / `@vitejs/plugin-react`
/ TanStack Router plugin all work identically across 6→8. See **## 13. Vite 8 (Rolldown) —
What Changed** for the delta if upgrading.

## Disambiguation

- **NX task inference** from `vite.config.ts` → NX monorepo docs / project NX skill
- **Vitest in Workers context** → `@cloudflare/vitest-pool-workers` — see project Vitest/Workers docs if present
- **Astro projects** → Astro is built on Vite (Astro 5.x = Vite 6+ inside) but has its **own config** in `astro.config.mjs`, not a top-level `vite.config.ts`. Pass Vite plugins via `vite: { plugins: [...] }` in `astro.config.mjs`. Tailwind v4 in Astro = `@tailwindcss/vite` as a Vite plugin (not the deprecated `@astrojs/tailwind`).
- **Tailwind CSS architecture** → project frontend/styling conventions
- **TanStack Router file-based routing plugin** → TanStack Router docs / project routing skill

---

## 1. vite.config.ts — Anatomy

```ts
// apps/{hub}/web/vite.config.ts
import tailwindcss from "@tailwindcss/vite";
import { TanStackRouterVite } from "@tanstack/router-plugin/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [
    TanStackRouterVite(),   // 1. FIRST — generates routeTree.gen.ts before React transform
    react(),                // 2. JSX transform, Fast Refresh
    tailwindcss(),          // 3. Tailwind v4 via @tailwindcss/vite (not PostCSS)
  ],
  server: {
    port: 5174,
    proxy: {
      "/api": { target: "http://localhost:8788", changeOrigin: true },
    },
  },
  resolve: {
    alias: { "@": "./src" },  // Allows `import { X } from "@/components/X"`
  },
  build: { outDir: "dist" },
});
```

**Plugin order matters:** TanStackRouterVite must run before react() so route tree is generated before JSX transformation.

### Conditional config (dev vs build)

```ts
export default defineConfig(({ command, mode }) => {
  const isDev = command === "serve";
  return {
    plugins: [react()],
    build: {
      sourcemap: isDev ? true : "hidden",   // inline in dev, external in prod
      minify: isDev ? false : "esbuild",
    },
  };
});
```

### Async config + loadEnv

```ts
import { defineConfig, loadEnv } from "vite";

export default defineConfig(({ mode }) => {
  // .env files are NOT available via process.env inside config — use loadEnv
  const env = loadEnv(mode, process.cwd(), "");  // "" = include ALL vars (bypass VITE_ filter)
  return {
    server: { port: Number(env.PORT) || 5173 },
    define: { __APP_ENV__: JSON.stringify(env.APP_ENV) },
  };
});
```

---

## 2. Environment Variables

### Prefix rules

| Prefix | Exposed to browser | Use case |
|--------|-------------------|----------|
| `VITE_` | Yes (`import.meta.env.VITE_X`) | Public API URLs, feature flags |
| No prefix | No | Server-only secrets (DB passwords) |

```ts
// VITE_ vars available anywhere in frontend code:
const apiUrl = import.meta.env.VITE_API_URL;
const isProd  = import.meta.env.PROD;      // built-in boolean
const isDev   = import.meta.env.DEV;       // built-in boolean
const mode    = import.meta.env.MODE;      // "development" | "production" | custom
const base    = import.meta.env.BASE_URL;  // from config.base
```

### .env file hierarchy (priority, highest first)

```
.env.[mode].local    # mode-specific, gitignored — secrets for that mode
.env.[mode]          # mode-specific
.env.local           # always loaded, gitignored — local overrides
.env                 # always loaded, committed
```

Do NOT expose server secrets via `VITE_` — browser-prefixed vars are public. Put secrets in the server runtime (env, secret store, or platform secret API).

### TypeScript typing

```ts
// src/vite-env.d.ts  (auto-created by Vite scaffolding, extend as needed)
/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_URL: string;
  readonly VITE_APP_NAME: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
```

### HTML env replacement

```html
<!-- index.html — replaced at build time -->
<title>%VITE_APP_NAME%</title>
<meta name="description" content="%VITE_APP_DESCRIPTION%">
```

---

## 3. Monorepo Setup (workspaces)

### Key pattern: each app has its own vite.config.ts

Do NOT share a single vite.config.ts across the monorepo. Each app (`apps/auth/web`, `apps/app/web`, `apps/backoffice/web`) has its own config with app-specific port and proxy target.

### resolve.alias for workspace packages

Vite resolves `@acme/*` workspace packages automatically via package-manager workspaces (npm/pnpm). No special alias config needed — just ensure packages export correctly:

```json
// packages/ui/package.json
{
  "name": "@acme/ui",
  "exports": {
    ".": {
      "import": "./src/index.ts",    // source for dev (Vite resolves TS directly)
      "require": "./dist/index.cjs"  // built for external consumers
    }
  }
}
```

### optimizeDeps — pre-bundling workspace packages

By default, Vite skips pre-bundling workspace packages (linked via `node_modules`). If you see `[vite] Forced re-optimization of dependencies` loops or slow startup, add:

```ts
export default defineConfig({
  optimizeDeps: {
    include: [
      "@acme/ui",
      "@acme/auth",
      // Add workspace packages that have complex re-exports
    ],
    // Exclude packages that are pure ESM and bundle correctly:
    exclude: ["@acme/tsconfig"],
  },
});
```

### Path resolution across packages

For `@/` alias to work in packages (not just apps), configure it per-package:

```ts
// packages/ui/vite.config.ts (if building package with vite)
export default defineConfig({
  resolve: { alias: { "@": new URL("./src", import.meta.url).pathname } },
});
```

---

## 4. Plugins — Recommended Stack

### @vitejs/plugin-react

```ts
import react from "@vitejs/plugin-react";

react({
  // Babel transform options (Vite 6 uses Babel by default; SWC variant = plugin-react-swc)
  babel: {
    plugins: ["babel-plugin-react-compiler"],  // React Compiler (optional, experimental)
  },
  // Fast Refresh is ON by default in dev — no config needed
})
```

**When to use plugin-react-swc instead:** SWC is faster (~20x) but less flexible for custom Babel plugins. For a stack without custom Babel transforms, both work identically.

### @tailwindcss/vite (Tailwind v4)

```ts
import tailwindcss from "@tailwindcss/vite";

// Tailwind v4 uses @tailwindcss/vite plugin — NOT PostCSS
// Add to plugins array (position 3, after TanStack and React):
plugins: [TanStackRouterVite(), react(), tailwindcss()]
```

**Critical:** Do NOT use PostCSS config (`postcss.config.js`) with Tailwind v4 when using `@tailwindcss/vite`. The Vite plugin replaces PostCSS integration. Having both causes conflicts.

### TanStack Router Plugin

```ts
import { TanStackRouterVite } from "@tanstack/router-plugin/vite";

TanStackRouterVite({
  routesDirectory: "./src/routes",      // default
  generatedRouteTree: "./src/routeTree.gen.ts",  // default
  autoCodeSplitting: true,              // split routes into separate chunks
})
```

### vite-plugin-svgr (SVG as React components)

```ts
import svgr from "vite-plugin-svgr";

svgr({
  svgrOptions: { icon: true },  // adds width/height="1em" for icon use
})
```

Usage: `import Logo from "./logo.svg?react"`

### Other useful plugins

```ts
// Bundle analysis
import { visualizer } from "rollup-plugin-visualizer";
visualizer({ open: true, gzipSize: true })  // generates stats.html

// Environment variable validation
import { z } from "zod";
// Use @t3-oss/env-core — no extra plugin needed
```

---

## 5. Build Optimization

### Chunk splitting (manualChunks)

```ts
export default defineConfig({
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          // Vendor chunks — stable hash, long-term caching
          "react-vendor": ["react", "react-dom"],
          "router-vendor": ["@tanstack/react-router", "@tanstack/react-query"],
          "trpc-vendor": ["@trpc/client", "@trpc/tanstack-react-query"],
        },
      },
    },
  },
});
```

**Strategy:** Split large stable deps into separate chunks so they can be cached independently from app code. For most SPAs aggressive splitting is optional — default chunking is usually fine.

### Route-based code splitting (recommended)

```ts
// TanStack Router with autoCodeSplitting: true handles this automatically.
// Each route file becomes a separate chunk loaded on navigation.
```

### Build targets

```ts
build: {
  target: "esnext",           // Modern browsers — safe for CF Workers proxy
  // target: "es2020"         // If you need broader browser compat
  // target: "baseline-widely-available"  // Vite 6 default (conservative)
}
```

When assets are served from a modern CDN/edge to modern browsers, use `esnext` for smallest output.

### CSS code splitting

Vite automatically splits CSS per JS chunk (each async chunk gets its own CSS file). To disable:

```ts
build: { cssCodeSplit: false }  // Single CSS bundle (simpler, but no lazy loading)
```

### Bundle analysis

```bash
# Install once:
npm install -D rollup-plugin-visualizer

# Add to vite.config.ts plugins:
visualizer({ open: true, filename: "dist/stats.html", gzipSize: true })

# Build and open automatically:
vite build
```

### Pre-bundling tuning (esbuild)

Vite uses esbuild to pre-bundle dependencies before dev server starts. This converts CJS to ESM and reduces browser request count.

```ts
optimizeDeps: {
  include: [
    "react",
    "react-dom",
    // List packages that cause "new dependencies found" churn
  ],
  force: false,  // Set true temporarily to force re-bundle (then remove)
}
```

---

## 6. Dev Server

### Ports (multi-app monorepo example)

| Hub | Web port | API port |
|-----|----------|----------|
| auth | 5173 | 8787 |
| app | 5174 | 8788 |
| backoffice | 5175 | 8789 |

### Proxy configuration

```ts
server: {
  port: 5174,
  proxy: {
    "/api": {
      target: "http://localhost:8788",
      changeOrigin: true,
      // Do NOT use rewrite if the API is already mounted at /api/
    },
    // Multiple proxies:
    "/health": { target: "http://localhost:8788", changeOrigin: true },
  },
},
```

**How it works:** In dev, the Vite frontend proxies `/api/*` to the local API. In production, the reverse proxy or platform routing handles API and SPA together (no Vite proxy).

### HMR configuration

```ts
server: {
  hmr: true,   // default — Fast Refresh via @vitejs/plugin-react
  // If HMR isn't working behind a reverse proxy:
  hmr: {
    protocol: "ws",
    host: "localhost",
    port: 5174,
  },
  // Disable HMR entirely (fallback to full reload):
  hmr: false,
}
```

### CORS in dev

```ts
server: {
  cors: true,  // Enable CORS for all origins in dev
  // Or specific config:
  cors: {
    origin: ["http://localhost:5173", "http://localhost:5174"],
  },
}
```

### server.warmup (Vite 6)

Pre-transform files before first request, reducing cold start:

```ts
server: {
  warmup: {
    clientFiles: [
      "./src/main.tsx",
      "./src/routes/__root.tsx",
      "./src/routes/index.tsx",
    ],
  },
}
```

---

## 7. Library Mode (packages/)

For building `packages/ui` and `packages/auth` as distributable libraries:

```ts
// packages/ui/vite.config.ts
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";

export default defineConfig({
  plugins: [react()],
  build: {
    lib: {
      entry: resolve(import.meta.dirname, "src/index.ts"),
      formats: ["es"],       // ESM only — modern consumers
      fileName: "index",
    },
    rollupOptions: {
      // Externalize deps — consumers install them separately
      external: ["react", "react-dom", "react/jsx-runtime"],
      output: {
        preserveModules: true,      // Keep file structure (better tree-shaking)
        preserveModulesRoot: "src",
      },
    },
    sourcemap: true,
    emptyOutDir: true,
  },
});
```

**Source-first monorepos:** Packages often export `src/index.ts` directly and Vite resolves TypeScript without building. Library mode is only needed if distributing to external consumers.

---

## 8. SSR / Cloudflare Workers Context

### Important distinction

In a typical split SPA + API setup, Vite only builds the **frontend SPA**. The API/worker (e.g. wrangler, NestJS, or another runtime) is built by its own toolchain, NOT by Vite.

```
Vite build output → apps/{app}/web/dist/   (SPA assets)
API/worker build  → separate process         (NestJS, wrangler, etc.)
Static hosting / reverse proxy serves web/dist/
```

### When Vite touches Workers code

If you need to import Worker-specific types or APIs in a shared package that is also consumed by Vite:

```ts
// vite.config.ts — tell Vite to use worker-compatible conditions
resolve: {
  conditions: ["workerd", "worker", "browser", "import", "default"],
}
```

### Externals for Worker builds (in wrangler/esbuild)

This is NOT in vite.config.ts — it's in `wrangler.toml` or `tsconfig.json`. Vite doesn't build workers.

---

## 9. Vitest Integration

### Shared config pattern

```ts
// packages/auth/vitest.config.ts
import { defineConfig } from "vitest/config";  // NOT from "vite"

export default defineConfig({
  test: {
    globals: true,          // describe/it/expect without imports
    environment: "node",    // default — good for API/util tests
  },
});
```

```ts
// packages/ui/vitest.config.ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "jsdom",               // React component tests
    setupFiles: ["./src/__tests__/setup.ts"],
  },
});
```

### Reusing vite.config.ts for Vitest

```ts
// apps/app/web/vitest.config.ts
import { defineConfig, mergeConfig } from "vitest/config";
import viteConfig from "./vite.config";

export default mergeConfig(
  viteConfig,
  defineConfig({
    test: {
      globals: true,
      environment: "jsdom",
    },
  }),
);
```

### @cloudflare/vitest-pool-workers

For testing CF Worker code (not applicable to the web SPA):

```ts
// apps/auth/api/vitest.config.ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    // No special pool needed for Hono tests — use app.request()
    // @cloudflare/vitest-pool-workers is for direct Worker execution tests
  },
});
```

See full patterns in [vitest-workers.md](references/vitest-workers.md).

---

## 10. Tailwind v4 Integration

### @tailwindcss/vite vs PostCSS

| Approach | When | How |
|----------|------|-----|
| `@tailwindcss/vite` plugin | Tailwind v4 + Vite | `import tailwindcss from "@tailwindcss/vite"` → add to plugins |
| PostCSS (`postcss.config.js`) | Tailwind v3 or non-Vite tools | `@tailwindcss/postcss` in postcss plugins |

**Use `@tailwindcss/vite`.** Do NOT create a `postcss.config.js` — Tailwind v4 + Vite plugin bypasses PostCSS entirely.

### CSS import in entry point

```tsx
// apps/app/web/src/main.tsx
import "./index.css";  // Must import the CSS file that contains @import "tailwindcss"
```

```css
/* apps/app/web/src/index.css */
@import "tailwindcss";
@import "@acme/design-tokens/src/themes/app.css";  /* Hub theme tokens */
```

### CSS processing order

Vite processes CSS in this order:
1. `@tailwindcss/vite` plugin transforms Tailwind directives
2. CSS modules (`.module.css`) are scoped
3. Regular CSS is bundled and minified

---

## 11. Vite 6.x Features

### Environment API

Vite 6 formalizes multiple runtime environments (client, server, edge):

```ts
export default defineConfig({
  environments: {
    client: {
      // SPA config (browser)
    },
    edge: {
      resolve: { noExternal: true },  // Bundle all deps for edge runtime
      build: { outDir: "dist/edge" },
    },
  },
});
```

The Environment API is primarily relevant when using multi-runtime plugins (e.g. edge). A typical SPA setup does NOT need explicit environment config.

### Module Runner API

New in Vite 6 — replaces `ssrLoadModule`. Used by framework authors, not application developers. Not relevant to typical app setups.

### server.warmup (Vite 5.1+)

Pre-transforms critical files before the first browser request:

```ts
server: {
  warmup: {
    clientFiles: ["./src/main.tsx"],
  },
}
```

---

## 12. Vite 8 (Rolldown) — What Changed

**Vite 8.0 (GA 2026-06-23) merged `rolldown-vite` into the core `vite` package** — Rolldown
(Rust-based bundler) is now the single, unified bundler for both dev pre-bundling AND
production builds, replacing the old esbuild (pre-bundle) + Rollup (build) split. Vercel/Vite
team reports 10-30x faster builds. Verified 2026-07-15 via Context7 `/vitejs/vite` changelog +
migration guide.

**Breaking changes (per official changelog, 3 items):**

1. **`optimizeDeps.esbuildOptions` → `optimizeDeps.rolldownOptions`** — dependency pre-bundling
   now uses Rolldown instead of esbuild. `esbuildOptions` still works (auto-converted field by
   field) but is deprecated:
   ```ts
   // Deprecated (still works via compat shim):
   optimizeDeps: { esbuildOptions: { define: { ... } } }

   // Preferred (Vite 8+):
   optimizeDeps: { rolldownOptions: { transform: { define: { ... } } } }
   ```
2. **`import.meta.hot.accept` resolution fallback removed** — if HMR accept callbacks relied on
   implicit module resolution, they now need an explicit path.
3. **Default browser build target updated** — check `build.target` if you support older
   browsers; don't assume the previous "Baseline Widely Available" default is unchanged.

**Also from the migration guide (not flagged as "breaking" but behavior-affecting):**

- **`define` no longer shares object references** — each variable using the same object value in
  `define` now gets its own copy (Oxc transformer behavior). Rarely matters unless code mutates
  a `define`d object at runtime (unusual pattern).
- **`build.rollupOptions` still works** via an automatic compat layer that converts it to
  Rolldown equivalents — **most projects need zero config changes**. `build.commonjsOptions` is
  now a no-op (Rolldown handles CJS natively, no separate plugin needed).

**Migration path for larger/complex projects:** try the `rolldown-vite` package as a drop-in on
Vite 7 first to isolate Rolldown-specific issues from other Vite 8 changes, then upgrade to
`vite@8`. For a typical stack (React + TanStack Router + Tailwind v4 + static assets), the
plugin chain (`@tanstack/router-plugin`, `@vitejs/plugin-react`, `@tailwindcss/vite`) is
confirmed compatible — no known Rolldown-specific breakage as of 2026-07-15.

---

## 13. Troubleshooting

### HMR not working

1. Check browser console for WebSocket errors
2. Ensure dev server port is accessible (no firewall/VPN blocking WS)
3. If behind nginx/proxy: configure `server.hmr.clientPort`
4. Check `@vitejs/plugin-react` is in plugins (required for React Fast Refresh)

### "Failed to resolve import X from Y"

1. Is X installed? `npm install X`
2. Is X a workspace package? Check `packages/X/package.json#exports` field
3. Does X need to be in `optimizeDeps.include`?
4. Check `resolve.alias` if using path aliases

### CJS/ESM conflicts ("require is not defined in ES module scope")

```ts
// In vite.config.ts:
optimizeDeps: {
  include: ["problematic-cjs-package"],  // Force Vite to pre-bundle it as ESM
}
```

### "New dependencies found, optimizing..."

Vite re-runs pre-bundling when it discovers new deps at runtime. To prevent:

```ts
optimizeDeps: {
  include: ["all-deps-you-use"],  // Pre-declare them
}
```

Or run `vite --force` once to clear the cache, then restart.

### Build produces wrong chunk sizes

Use `rollup-plugin-visualizer` to inspect what's in each chunk. Large chunks usually mean:
- Not externalizing deps in library mode
- Missing `manualChunks` for vendor code
- A single large import that should be lazy-loaded

### TypeScript errors in vite.config.ts

```ts
// If import.meta.dirname is unavailable (Node < 20):
import { fileURLToPath } from "node:url";
const __dirname = fileURLToPath(new URL(".", import.meta.url));
```

### Tailwind classes not applied

1. Confirm `@tailwindcss/vite` is in plugins (NOT `@tailwindcss/postcss` in postcss.config.js)
2. Confirm CSS file is imported in `main.tsx` (not just in a component)
3. Confirm `@import "tailwindcss"` is in your root CSS file
4. Check that `tailwindcss` and `@tailwindcss/vite` versions match (both should be `^4.x`)

---

## Quick Reference

### Plugin install commands

```bash
npm install -D @vitejs/plugin-react
npm install -D @tailwindcss/vite tailwindcss
npm install -D @tanstack/router-plugin
npm install -D vite-plugin-svgr
npm install -D rollup-plugin-visualizer    # bundle analysis
```

### Useful CLI flags

```bash
vite                      # Start dev server
vite build                # Production build
vite build --mode staging # Use .env.staging
vite preview              # Preview built output locally
vite --force              # Force re-optimization of deps (clear cache)
vite build --sourcemap    # Build with sourcemaps
```

### Vite config options reference (6.x–8.x, largely unchanged — see ## 12 for the Vite 8 delta)

| Option | Default | Description |
|--------|---------|-------------|
| `root` | `process.cwd()` | Project root (where index.html is) |
| `base` | `/` | Base public path |
| `mode` | `development`/`production` | Build mode |
| `build.target` | Baseline Widely Available | Browser/runtime target |
| `build.outDir` | `dist` | Output directory |
| `build.minify` | `esbuild` | Minifier (esbuild or terser) |
| `build.sourcemap` | `false` | Source maps |
| `build.cssCodeSplit` | `true` | CSS code splitting |
| `server.port` | `5173` | Dev server port |
| `server.open` | `false` | Open browser on start |
| `optimizeDeps.force` | `false` | Force re-bundle deps |

---

## References

| Topic | File |
|-------|------|
| Plugin API (custom plugins, virtual modules, HMR) | [references/plugin-api.md](references/plugin-api.md) |
| Vitest + CF Workers pool | [references/vitest-workers.md](references/vitest-workers.md) |
| Build optimization deep-dive | [references/build-optimization.md](references/build-optimization.md) |
| Research sources | [references/sources.md](references/sources.md) |
