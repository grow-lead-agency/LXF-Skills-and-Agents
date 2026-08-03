---
name: vite-plugin-api
description: Vite plugin authoring — hooks, virtual modules, HMR, client-server communication
---

# Vite Plugin API

## Basic Plugin Structure

```ts
import type { Plugin } from "vite";

function myPlugin(): Plugin {
  return {
    name: "my-plugin",  // required, unique name for error messages
    // hooks...
  };
}

export default myPlugin;
```

## Plugin Lifecycle Hooks

### config — Modify config before resolution

```ts
{
  name: "extend-config",
  config(config, { command, mode }) {
    return {
      resolve: { alias: { "~icons": "virtual:icons" } },
    };
  },
}
```

### configResolved — Access final resolved config

```ts
{
  name: "read-config",
  configResolved(resolvedConfig) {
    // Store for use in other hooks:
    config = resolvedConfig;
  },
}
```

### configureServer — Custom dev middleware

```ts
{
  name: "custom-middleware",
  configureServer(server) {
    // Runs BEFORE Vite's internal middleware:
    server.middlewares.use("/custom", (req, res) => {
      res.end("custom response");
    });
    
    // Return function to run AFTER Vite's middleware:
    return () => {
      server.middlewares.use((req, res, next) => {
        // Post-processing
        next();
      });
    };
  },
}
```

### transformIndexHtml — Transform index.html

```ts
{
  name: "inject-meta",
  transformIndexHtml(html) {
    // String replacement:
    return html.replace("</head>", '<meta name="build-time" content="2026"> </head>');
  },
}

// Or return descriptor with tags:
{
  transformIndexHtml() {
    return [
      {
        tag: "script",
        attrs: { src: "/inject.js", defer: true },
        injectTo: "body",
      },
    ];
  },
}
```

### handleHotUpdate — Custom HMR handling

```ts
{
  name: "custom-hmr",
  handleHotUpdate({ file, server, modules }) {
    if (file.endsWith(".json")) {
      // Send custom HMR event instead of module replacement:
      server.ws.send({ type: "custom", event: "json-update", data: { file } });
      return [];  // Return empty to skip default HMR
    }
    // Return undefined to let Vite handle it normally
  },
}
```

## Universal Hooks (Rollup-compatible)

These run in both dev and build:

```ts
{
  name: "transform-plugin",
  
  // Resolve import paths
  resolveId(id, importer, options) {
    if (id === "my-virtual") return "\0my-virtual";  // \0 = internal resolved ID
  },
  
  // Load module content
  load(id) {
    if (id === "\0my-virtual") {
      return `export const value = "from virtual"`;
    }
  },
  
  // Transform module code
  transform(code, id, options) {
    if (id.endsWith(".special")) {
      return {
        code: transformCode(code),
        map: null,  // or source map
      };
    }
  },
}
```

## Virtual Modules

Serve generated content without a file on disk:

```ts
function virtualPlugin(): Plugin {
  const VIRTUAL_ID = "virtual:config";
  const RESOLVED_ID = "\0" + VIRTUAL_ID;  // \0 prefix = private, hidden from Vite processing

  return {
    name: "virtual-config",
    resolveId(id) {
      if (id === VIRTUAL_ID) return RESOLVED_ID;
    },
    load(id) {
      if (id === RESOLVED_ID) {
        const config = JSON.stringify({ version: "1.0.0" });
        return `export const config = ${config}`;
      }
    },
  };
}

// Usage in app:
import { config } from "virtual:config";
```

## Plugin Ordering

```ts
{
  enforce: "pre",   // Before core plugins (alias resolution)
  enforce: "post",  // After build plugins
  // No enforce = user plugins (default order)
}
```

Full order: Alias → enforce:'pre' → Vite core → User plugins → Vite build → enforce:'post' → Post-build

## Conditional Application

```ts
{
  apply: "build",  // Only during build (not dev)
  apply: "serve",  // Only during dev

  // Function form (e.g., only non-SSR builds):
  apply(config, { command }) {
    return command === "build" && !config.build.ssr;
  },
}
```

## Client-Server Communication

### Server → Client (push events)

```ts
// Plugin (server side):
{
  name: "push-events",
  configureServer(server) {
    server.watcher.on("change", (file) => {
      server.ws.send({
        type: "custom",
        event: "file-changed",
        data: { file },
      });
    });
  },
}

// App (client side):
if (import.meta.hot) {
  import.meta.hot.on("file-changed", (data) => {
    console.log("File changed:", data.file);
  });
}
```

### Client → Server (bidirectional)

```ts
// Client:
import.meta.hot.send("my:request", { query: "something" });

// Plugin server:
configureServer(server) {
  server.ws.on("my:request", (data, client) => {
    client.send("my:response", { result: "processed" });
  });
}
```

## Source: https://vite.dev/guide/api-plugin
