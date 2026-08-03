---
name: vite-build-optimization
description: Version-aware Vite 6 and Vite 8 build optimization, chunks, targets, minification, and analysis
---

# Build Optimization Deep Dive

Use the configuration branch that matches the app's installed Vite major.

| Stage | Vite 6 | Vite 8 |
|---|---|---|
| Dependency optimization | esbuild | Rolldown |
| JavaScript/TypeScript transform | esbuild | Oxc |
| Production bundle | Rollup | Rolldown |
| Client JS minification | esbuild by default | Oxc by default |
| CSS minification | esbuild by default | Lightning CSS by default |

## Advanced Bundler Options

Vite 8 uses `build.rolldownOptions`:

```js
build: {
  rolldownOptions: {
    output: {
      chunkFileNames: "assets/[name]-[hash].js",
      entryFileNames: "assets/[name]-[hash].js",
      assetFileNames: "assets/[name]-[hash][extname]",
      codeSplitting: {
        groups: [
          { name: "react-vendor", test: /node_modules[\\/](?:react|react-dom)[\\/]/, priority: 20 },
          { name: "router-vendor", test: /node_modules[\\/]react-router(?:-dom)?[\\/]/, priority: 15 },
          { name: "vendor", test: /node_modules/, priority: 10 },
        ],
      },
    },
  },
}
```

Vite 6 uses `build.rollupOptions` and Rollup `manualChunks`:

```js
build: {
  rollupOptions: {
    output: {
      chunkFileNames: "assets/[name]-[hash].js",
      entryFileNames: "assets/[name]-[hash].js",
      assetFileNames: "assets/[name]-[hash][extname]",
      manualChunks: {
        "react-vendor": ["react", "react-dom"],
        "router-vendor": ["react-router-dom"],
      },
    },
  },
}
```

Do not override Vite's input in the Laravel admin. `laravel-vite-plugin` derives the build
input and manifest behavior from its `input` option. A standalone SPA normally uses
`index.html` as its entry.

## Splitting Strategy

Start with application-level lazy imports. For React Router route objects:

```js
const routes = [
  { path: "/account", lazy: () => import("./routes/account.jsx") },
  { path: "/orders", lazy: () => import("./routes/orders.jsx") },
];
```

Add manual vendor groups only when measurement shows that they improve caching or load
behavior. Broad vendor chunks can delay first render, and many tiny chunks increase request
overhead. Prefer stable dependency boundaries over arbitrary size-only splitting.

## Bundle Analysis

```bash
npm install -D rollup-plugin-visualizer
```

```js
import { visualizer } from "rollup-plugin-visualizer";

export default defineConfig({
  plugins: [
    // Existing app plugins first.
    process.env.ANALYZE && visualizer({
      open: true,
      filename: "dist/stats.html",
      gzipSize: true,
      brotliSize: true,
      template: "treemap",
    }),
  ].filter(Boolean),
});
```

```bash
ANALYZE=true npm run build
```

Interpret the report before changing config:

- Large initial chunks: lazy-load routes or features.
- Duplicate dependencies: inspect dependency versions and resolution before grouping.
- Large stable dependencies: consider a dedicated cached group.
- Many very small chunks: remove over-aggressive groups.

For the Laravel admin, set the visualizer filename inside the actual build directory if it
differs from `dist`; the Laravel plugin commonly owns that output layout.

## Build Targets

The defaults differ and may change with major releases:

```js
build: {
  target: "es2020",
  // target: "esnext", // Controlled modern browsers; minimal lowering.
}
```

- Vite 6 default: `modules`, mapped to browsers supporting native ESM, dynamic import, and
  `import.meta`.
- Vite 8 default: `baseline-widely-available` using the baseline documented for that release.
- Pin a target only when browser support is a product requirement; otherwise use the
  version's tested default.

## Minification

Use the default unless measurements justify a different minifier:

```js
build: {
  minify: true,
  // minify: false,       // Diagnostic build.
  // minify: "terser",    // Requires installing terser.
}
```

Version-specific values:

- Vite 6: `minify: "esbuild"` is the client default; SSR defaults to `false`.
- Vite 8: `minify: "oxc"` is the client default; SSR defaults to `false`.
- Vite 8 advanced Oxc compression belongs under
  `build.rolldownOptions.output.minify`, not Vite 6's `esbuild` config.

## Source Maps

```js
build: {
  sourcemap: false,      // Default.
  // sourcemap: true,     // External map referenced from output.
  // sourcemap: "inline", // Map embedded in output.
  // sourcemap: "hidden", // External map without sourceMappingURL comment.
}
```

Use `hidden` when an error-monitoring service uploads maps but public assets should not
advertise their URLs.

## CSS and Assets

```js
build: {
  cssCodeSplit: true,
  assetsInlineLimit: 4096,
  // cssTarget: "chrome90", // Only for a specific compatibility need.
}
```

- `cssCodeSplit: true` keeps CSS associated with async JavaScript chunks; `false` emits one
  CSS bundle.
- `assetsInlineLimit: 0` disables base64 inlining; the default is 4 KiB.
- Vite 6 uses esbuild for CSS minification by default and supports opting into
  `cssMinify: "lightningcss"`.
- Vite 8 uses `cssMinify: "lightningcss"` by default; setting `"esbuild"` requires esbuild.
- Sass processing occurs before CSS minification. Configure Sass under
  `css.preprocessorOptions.scss`, not under `build`.

## Warnings and Preload

For a legitimate large chunk, first split by route or feature. Raise
`build.chunkSizeWarningLimit` only after confirming the chunk cannot be split usefully.

Vite generates module-preload links for critical chunks. Disable them only for a measured
compatibility or delivery reason:

```js
build: {
  modulePreload: false,
  // modulePreload: { polyfill: true },
}
```

Avoid suppressing bundler warnings globally. If a known dependency emits an unavoidable
warning, filter that exact warning code and preserve all others using the warning hook
documented for that app's bundler version.

## Official Sources

- https://v6.vite.dev/config/build-options
- https://vite.dev/config/build-options
- https://vite.dev/guide/build
- https://rolldown.rs/reference/OutputOptions.codeSplitting
