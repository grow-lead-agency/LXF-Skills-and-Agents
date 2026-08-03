---
name: vitest
description: >-
  Vitest 4.x testing framework — unit/integration tests, mocking (vi.fn, vi.mock, vi.spyOn),
  coverage (v8/istanbul, AST-aware remapping), snapshots, test projects (test.projects,
  workspace renamed), environments (jsdom, happy-dom, node), browser mode, configuration
  (vitest.config.ts), CLI, watch mode, type checking, in-source testing, Vite integration,
  concurrent tests, and production test patterns.
  Triggers: vitest, vitest 4, unit test, test runner, vi.fn, vi.mock, vi.spyOn, test coverage,
  vitest config, mocking, snapshot testing, test environment, vitest workspace,
  vitest projects, test watch, vitest ui, integration test vitest, vitest browser mode.
  NE pro: Playwright E2E, Jest (migruj na Vitest),
  testing strategie obecne (viz testing skill).
---

# Vitest Master

Production testing with Vitest: configuration, mocking, coverage, environments, snapshots,
and patterns for our CF Workers + React stack. Powered by Vite — shares config, plugins,
and transforms.

**Current stable: Vitest 4.1.x** (Vitest 4.0.0 GA'd 2025-10-22; latest patch 4.1.10 — last
verified 2026-07-15 via npm + Context7 `/vitest-dev/vitest`). The `test.projects` config key
used throughout this skill (not `test.workspace`) is the correct v4 syntax — `workspace` was
deprecated in 3.2 and is on its way out.

## Quick Routing

```
Config / setup?               → ## Configuration
Mocking functions/modules?    → ## Mocking
Code coverage?                → ## Coverage
Test environments?            → ## Environments
Snapshot testing?             → ## Snapshots
Testing async / timers?       �� ## Async & Timers
CF Workers testing?           → ## Platform-Specific Patterns
```

## Installation

```bash
npm install -D vitest @vitest/coverage-v8
```

## Configuration

```typescript
// vitest.config.ts (standalone)
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,                    // no need to import describe/it/expect
    environment: 'node',              // 'node' | 'jsdom' | 'happy-dom' | 'edge-runtime'
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
    exclude: ['node_modules', 'dist', 'e2e'],
    coverage: {
      provider: 'v8',                // faster than istanbul, same accuracy since v3.2
      include: ['src/**/*.{ts,tsx}'],
      exclude: ['**/*.test.*', '**/*.spec.*', '**/types/**'],
      thresholds: {
        statements: 80,
        branches: 80,
        functions: 80,
        lines: 80,
      },
    },
    setupFiles: ['./test/setup.ts'],
    testTimeout: 10_000,
    hookTimeout: 10_000,
  },
});

// Or inside vite.config.ts (shared with app)
/// <reference types="vitest/config" />
import { defineConfig } from 'vite';

export default defineConfig({
  // ... vite config
  test: {
    // ... same test options
  },
});
```

### Test Projects (Monorepo / Multi-Environment)

```typescript
// vitest.config.ts
export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'unit',
          include: ['src/**/*.test.ts'],
          environment: 'node',
        },
      },
      {
        test: {
          name: 'components',
          include: ['src/**/*.test.tsx'],
          environment: 'jsdom',
          setupFiles: ['./test/setup-dom.ts'],
        },
      },
    ],
  },
});
```

## Writing Tests

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';

describe('UserService', () => {
  let service: UserService;

  beforeEach(() => {
    service = new UserService();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('creates a user with valid data', async () => {
    const user = await service.create({ name: 'Alice', email: 'a@b.com' });
    expect(user).toMatchObject({ name: 'Alice', email: 'a@b.com' });
    expect(user.id).toBeDefined();
  });

  it('throws on duplicate email', async () => {
    await service.create({ name: 'Alice', email: 'a@b.com' });
    await expect(
      service.create({ name: 'Bob', email: 'a@b.com' })
    ).rejects.toThrow('Email already exists');
  });

  it.each([
    { input: '', error: 'Name is required' },
    { input: 'a'.repeat(256), error: 'Name too long' },
  ])('rejects invalid name: $input', async ({ input, error }) => {
    await expect(service.create({ name: input, email: 'x@y.com' })).rejects.toThrow(error);
  });

  it.concurrent('runs in parallel with other concurrent tests', async () => {
    // safe when tests don't share mutable state
  });
});
```

### Matchers Cheat Sheet

```typescript
// Equality
expect(val).toBe(exact);              // === strict
expect(val).toEqual(deep);            // deep equality
expect(val).toStrictEqual(strict);    // deep + no undefined props

// Truthiness
expect(val).toBeTruthy();
expect(val).toBeFalsy();
expect(val).toBeNull();
expect(val).toBeDefined();
expect(val).toBeUndefined();

// Numbers
expect(val).toBeGreaterThan(3);
expect(val).toBeCloseTo(0.3, 5);      // floating point

// Strings
expect(str).toMatch(/regex/);
expect(str).toContain('sub');

// Arrays / Objects
expect(arr).toContain(item);
expect(arr).toHaveLength(3);
expect(obj).toHaveProperty('key', 'value');
expect(obj).toMatchObject({ partial: true });

// Exceptions
expect(() => fn()).toThrow('message');
expect(() => fn()).toThrowError(CustomError);
await expect(asyncFn()).rejects.toThrow();

// Asymmetric matchers
expect(obj).toEqual({
  id: expect.any(Number),
  name: expect.stringContaining('Ali'),
  tags: expect.arrayContaining(['admin']),
  metadata: expect.objectContaining({ version: 1 }),
});
```

## Mocking

### Functions (vi.fn)

```typescript
const mockFn = vi.fn();
mockFn.mockReturnValue(42);
mockFn.mockResolvedValue({ data: 'ok' });
mockFn.mockImplementation((x) => x * 2);

// Assertions
expect(mockFn).toHaveBeenCalled();
expect(mockFn).toHaveBeenCalledWith('arg1', 'arg2');
expect(mockFn).toHaveBeenCalledTimes(3);
expect(mockFn).toHaveBeenNthCalledWith(1, 'first call arg');

// Reset
mockFn.mockClear();          // clear call history
mockFn.mockReset();          // clear + remove implementation
mockFn.mockRestore();        // restore original (for spies)
```

### Modules (vi.mock)

```typescript
// Auto-mock entire module (hoisted to top!)
vi.mock('./database');

// Manual mock with factory
vi.mock('./email-service', () => ({
  sendEmail: vi.fn().mockResolvedValue({ sent: true }),
  EmailClient: vi.fn(),
}));

// Partial mock (keep original, override specific)
vi.mock('./utils', async (importOriginal) => {
  const mod = await importOriginal<typeof import('./utils')>();
  return {
    ...mod,
    formatDate: vi.fn(() => '2026-01-01'),
  };
});
```

### Spying (vi.spyOn)

```typescript
import * as userModule from './user-service';

const spy = vi.spyOn(userModule, 'getUser');
spy.mockResolvedValue({ id: 1, name: 'Test' });

// spy tracks calls AND can mock implementation
expect(spy).toHaveBeenCalledWith(1);

spy.mockRestore(); // restores original implementation
```

### Timers

```typescript
beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

it('debounces calls', () => {
  const fn = vi.fn();
  const debounced = debounce(fn, 1000);

  debounced();
  debounced();
  debounced();

  expect(fn).not.toHaveBeenCalled();
  vi.advanceTimersByTime(1000);
  expect(fn).toHaveBeenCalledOnce();
});

// Mock Date
vi.setSystemTime(new Date('2026-01-01'));
expect(new Date().getFullYear()).toBe(2026);
```

### Environment Variables

```typescript
it('reads env', () => {
  vi.stubEnv('API_KEY', 'test-key-123');
  expect(process.env.API_KEY).toBe('test-key-123');
});
// auto-restored if `unstubEnvs: true` in config
```

## Coverage

```bash
# Run with coverage
npx vitest run --coverage

# Watch mode (no coverage)
npx vitest

# Specific file
npx vitest run src/utils/format.test.ts
```

```typescript
// vitest.config.ts
test: {
  coverage: {
    provider: 'v8',               // recommended: fast + accurate since v3.2
    reporter: ['text', 'html', 'lcov'],
    include: ['src/**/*.{ts,tsx}'],
    thresholds: {
      statements: 80,
      branches: 80,
      functions: 80,
      lines: 80,
    },
  },
}
```

**v8 vs istanbul:**
- **v8** (default): Faster, lower memory, no pre-instrumentation. Recommended. AST-aware source
  map remapping is **always on** in v4 (`coverage.experimentalAstAwareRemapping` was removed as
  a config option — it's no longer optional, just the only supported behavior).
- **istanbul**: Works on any JS runtime. Required for non-V8 environments (Firefox, Bun).

**Removed in v4 (don't use these — will error):** `coverage.all`, `coverage.extensions`,
`coverage.ignoreEmptyLines`, `coverage.experimentalAstAwareRemapping`. Use `coverage.include` /
`coverage.exclude` glob patterns instead of `all`/`extensions`.

### Ignore Coverage

```typescript
/* v8 ignore next -- @preserve */
if (impossibleCondition) {
  // this line excluded from coverage
}

/* v8 ignore start -- @preserve */
// entire block excluded
/* v8 ignore stop -- @preserve */
```

## Snapshots

```typescript
it('renders correctly', () => {
  const result = renderComponent({ title: 'Hello' });
  expect(result).toMatchSnapshot();       // file-based snapshot
});

it('produces expected output', () => {
  expect(transform(input)).toMatchInlineSnapshot(`
    {
      "id": 1,
      "name": "test",
    }
  `);
});

// Update snapshots: npx vitest --update
```

## Environments

| Environment | Use Case | Package |
|-------------|----------|---------|
| `node` | API, workers, utilities | Built-in |
| `jsdom` | React components, DOM APIs | `jsdom` |
| `happy-dom` | Faster DOM alternative | `happy-dom` |
| `edge-runtime` | CF Workers, Vercel Edge | `@edge-runtime/vm` |

```typescript
// Per-file environment override
// @vitest-environment jsdom

import { render, screen } from '@testing-library/react';

it('renders button', () => {
  render(<Button label="Click" />);
  expect(screen.getByText('Click')).toBeDefined();
});
```

### Browser Mode (v4 config changed)

Real-browser testing (as opposed to `jsdom`/`happy-dom` simulation) via `test.browser`. **Two
breaking changes vs older docs/examples you may find online:**

```typescript
// v4 — import path changed:
import { page } from 'vitest/browser'       // was '@vitest/browser/context' in v3

// v4 — provider is now a function from a separate package, not a string:
import { defineConfig } from 'vitest/config'
import { playwright } from '@vitest/browser-playwright'   // new package, install separately

export default defineConfig({
  test: {
    browser: {
      enabled: true,
      provider: playwright({ launchOptions: { slowMo: 100 } }),  // function, not 'playwright' string
      instances: [{ browser: 'chromium' }],
    },
  },
})
```

Other providers: `@vitest/browser-webdriverio`, `@vitest/browser-preview`. The old `/// <reference path="@vitest/browser/providers/playwright" />` triple-slash comment is no longer needed.

## Setup Files

```typescript
// test/setup.ts
import { afterEach } from 'vitest';

// Global cleanup after each test
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

// test/setup-dom.ts (for component tests)
import '@testing-library/jest-dom/vitest';
```

## Platform-Specific Patterns

### Cloudflare Workers (Hono)

```typescript
import { describe, it, expect } from 'vitest';
import app from '../src/index';

describe('API', () => {
  it('GET / returns 200', async () => {
    const res = await app.request('/');
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('Hello');
  });

  it('POST /users creates user', async () => {
    const res = await app.request('/users', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Alice' }),
    });
    expect(res.status).toBe(201);
    const data = await res.json();
    expect(data).toMatchObject({ name: 'Alice' });
  });
});
```

### Database Tests (with cleanup)

```typescript
import { beforeEach, afterAll } from 'vitest';
import { db } from '../src/db';
import { users } from '../src/schema';

beforeEach(async () => {
  await db.delete(users); // clean slate
});

afterAll(async () => {
  await db.$pool.end();
});
```

## CLI Reference

```bash
vitest                  # watch mode
vitest run              # single run
vitest run --coverage   # with coverage
vitest run src/utils/   # specific directory
vitest -t "user"        # filter by test name
vitest --reporter=json  # JSON output
vitest --ui             # browser UI
vitest --typecheck      # type checking
```

## Best Practices

1. **One assertion concept per test** — test one behavior, not one `expect`.
2. **Arrange-Act-Assert** — clear separation makes tests readable.
3. **Always restore mocks** — `vi.restoreAllMocks()` in `afterEach` or `setupFiles`.
4. **Prefer `vi.mock` over manual DI** for module-level mocking.
5. **Use `it.each` for data-driven tests** — less code, more coverage.
6. **Don't test implementation** — test behavior, not internal method calls.
7. **Co-locate tests** — `foo.ts` + `foo.test.ts` in same directory.
8. **Use `vitest/config` types** — get autocomplete in config files.
9. **Coverage thresholds in CI** — prevents coverage regression.
10. **Fake timers for time-dependent code** — deterministic, fast.
