---
name: vite-build-optimization
description: Deep-dive into Vite build optimization — chunks, analysis, caching, targets
---

# Build Optimization Deep-Dive

## Understanding the Build Pipeline

```
Source files (TS/TSX/CSS)
  ↓ esbuild (dev: pre-bundling, build: TS/JSX transform)
  ↓ Rollup (build: tree-shaking, code-splitting, bundling)
  ↓ esbuild (build: minification, unless terser is configured)
  → dist/ (HTML + JS chunks + CSS + assets)
```

## Rollup Options

Most build optimization lives in `build.rollupOptions`:

```ts
build: {
  rollupOptions: {
    // Input overrides (usually not needed — Vite uses index.html)
    input: "src/main.tsx",

    output: {
      // Chunk naming pattern:
      chunkFileNames: "assets/[name]-[hash].js",
      entryFileNames: "assets/[name]-[hash].js",
      assetFileNames: "assets/[name]-[hash][extname]",
      
      // Vendor chunk splitting:
      manualChunks(id) {
        if (id.includes("node_modules/react")) return "react-vendor";
        if (id.includes("node_modules/@tanstack")) return "tanstack-vendor";
        if (id.includes("node_modules/@trpc")) return "trpc-vendor";
      },
    },
    
    // External packages (library mode only):
    external: ["react", "react-dom"],
  },
}
```

## manualChunks Strategies

### Object form (static, predictable)

```ts
output: {
  manualChunks: {
    "react-vendor": ["react", "react-dom", "react/jsx-runtime"],
    "router": ["@tanstack/react-router", "@tanstack/react-query"],
    "trpc": ["@trpc/client", "@trpc/tanstack-react-query"],
    "icons": ["lucide-react"],
  },
}
```

Best for: stable deps with known module IDs.

### Function form (dynamic, flexible)

```ts
output: {
  manualChunks(id) {
    // All node_modules → single vendor chunk:
    if (id.includes("node_modules")) return "vendor";
    
    // Route-based splitting (if not using TanStack Router auto-split):
    if (id.includes("/src/routes/")) {
      const segment = id.split("/src/routes/")[1].split("/")[0];
      return `route-${segment}`;
    }
  },
}
```

## Bundle Analysis

### rollup-plugin-visualizer

```ts
// vite.config.ts
import { visualizer } from "rollup-plugin-visualizer";

export default defineConfig({
  plugins: [
    // ... other plugins
    process.env.ANALYZE &&
      visualizer({
        open: true,
        filename: "dist/stats.html",
        gzipSize: true,
        brotliSize: true,
        template: "treemap",  // treemap | sunburst | network
      }),
  ].filter(Boolean),
});
```

```bash
# Run analysis build:
ANALYZE=true npm run build
```

### Reading the output

- **Large vendor chunks** → consider splitting or lazy-loading
- **Duplicated modules** (same package in multiple chunks) → move to manualChunks
- **Small chunks** (< 5KB) → might be better merged to reduce requests

## Build Targets

```ts
build: {
  // Modern (our CF Workers + SPA use case):
  target: "esnext",

  // Specific browsers (e.g., client requirement):
  target: ["chrome90", "firefox88", "safari14"],

  // Vite 6 default (conservative, safe for ~2 year old browsers):
  target: "baseline-widely-available",

  // ES2020 (includes dynamic import, optional chaining, nullish coalescing):
  target: "es2020",
}
```

For CF Workers Static Assets → always use `esnext` (assets served by browser, not Worker).

## Minification Options

```ts
build: {
  minify: "esbuild",    // Default, fastest (~10x faster than terser)
  minify: "terser",     // Smaller output, much slower build
  minify: false,        // No minification (dev/debug)
  
  // esbuild options:
  esbuild: {
    drop: ["console", "debugger"],  // Remove console.log in production
    legalComments: "none",
  },
}
```

## Source Maps

```ts
build: {
  sourcemap: true,        // Inline source maps (large output)
  sourcemap: "inline",    // Same as true
  sourcemap: "hidden",    // External .js.map files (not referenced in JS) → Sentry
  sourcemap: false,       // No source maps (default)
}
```

**For Sentry:** Use `sourcemap: "hidden"` + Sentry Vite plugin to upload maps without exposing them publicly.

## CSS Optimization

```ts
build: {
  cssCodeSplit: true,     // Default — CSS per chunk (lazy loading)
  cssCodeSplit: false,    // Single CSS bundle
  cssMinify: true,        // Default — minify CSS
  cssTarget: "esnext",   // CSS syntax target (for browser compat)
}
```

## Asset Inlining

```ts
build: {
  assetsInlineLimit: 4096,   // Default 4KB — files smaller than this become base64
  assetsInlineLimit: 0,      // Never inline (always separate files)
}
```

## Build Warnings

### "Some chunks are larger than 500 kB after minification"

Add `manualChunks` or enable `autoCodeSplitting` in TanStack Router.

```ts
build: {
  chunkSizeWarningLimit: 1000,  // Raise threshold if split isn't practical
}
```

### "Use of eval is strongly discouraged"

```ts
build: {
  rollupOptions: {
    onwarn(warning, warn) {
      if (warning.code === "EVAL") return;  // Suppress for known deps
      warn(warning);
    },
  },
}
```

## Preload Directives

Vite automatically generates `<link rel="modulepreload">` for critical chunks. Disable if needed:

```ts
build: {
  modulePreload: false,  // Disable preload generation
  modulePreload: {
    polyfill: true,  // Include modulepreload polyfill for older browsers
  },
}
```

## Source: https://vite.dev/guide/build, https://vite.dev/config/build-options
