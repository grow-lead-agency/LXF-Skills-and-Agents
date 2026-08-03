---
name: testing
description: |
  Pre-deploy quality assurance skill. Enforces comprehensive testing BEFORE deployment.
  Sits between development and deployment. Covers the full test pyramid: unit, integration,
  E2E (Playwright 1.58+), error handling verification, Sentry smoke tests, and observability
  gates. Vitest 4.x with stable Browser Mode, built-in visual regression (toMatchScreenshot),
  Playwright AI Test Agents (Planner/Generator/Healer), accessibility-tree-first selectors.
  Prevents the most common production bugs: API errors that fail silently, toast errors
  without messages, missing Sentry events, broken error boundaries, no health endpoint.
  Use when: a feature is coded, tests need writing, pre-deploy QA, CI failing,
  error handling review, Sentry not capturing, health check missing.
  Triggers: testing, tests, QA, quality, pre-deploy, quality gates, coverage,
  vitest, playwright, error boundary, toast error, Sentry smoke, health check,
  test pyramid, RTL, @testing-library, error handling, unit test, integration test,
  E2E, npm test, tsc noEmit, lint, before deploy, regression test,
  browser mode, visual regression, toMatchScreenshot, playwright agents.
---

# Pre-Deploy Testing

Quality assurance skill between coding and deployment. Every common production bug
has a test here that would have caught it.

**Workflow chain:** development → **`testing`** → deployment

**Stack context:** Laravel 11 backend (PHPUnit/Pest), NestJS GraphQL BFF (Jest 30),
React admin (Vitest 4 + Testing Library), React storefront (Vitest 4), Playwright for E2E.
This skill focuses on the JavaScript/TypeScript layers; backend tests follow the same
pyramid principles with their native runners.

---

## Workflow Overview

| Phase | What happens |
|-------|-------------|
| 1. Test Selection | Decide which tests to write based on what changed |
| 2. Test Implementation | Write tests following stack patterns |
| 3. Test Execution | Run full pyramid in correct order |
| 4. Quality Gates | Pre-deploy checklist — everything must pass |

---

## Phase 1: Test Selection

| Change type | Tests required |
|------------|---------------|
| New feature (UI + API) | Unit + Integration + 1 E2E happy path |
| Bug fix | Regression test that reproduces the bug FIRST |
| DB schema change | Backend feature test for the new table + authorization tests |
| New API/GraphQL endpoint | Backend test (Laravel feature test / Jest resolver test) |
| New React component | RTL component test (render + interactions) |
| Data mutation (API call from UI) | Vitest: mock API client + error path test |
| Auth/permission change | Backend policy tests + E2E permission boundary test |
| Error handling | Error boundary test + toast verification |
| Sentry integration | Smoke test → verify event arrives |

**Rule:** If it can break silently in production, it needs an automated test.

---

## Vitest 3.0+ Features (Jan 2025)

Key improvements to leverage in test implementation:

| Feature | What it enables |
|---------|----------------|
| **Inline workspace** | Define `workspace: ['packages/*']` in `vitest.config` — no separate workspace file |
| **Multi-browser instances** | `browser.instances: [{ browser: 'chromium' }, { browser: 'firefox' }]` — single Vite server, multiple browsers |
| **Line number filtering** | `vitest file.ts:42` — run tests at specific line (great for debugging) |
| **Redesigned reporters** | Less flicker, stable output, improved lifecycle API |
| **Public API (`vitest/node`)** | Stable programmatic access for CI/CD tooling |

### Vitest 3.0 Breaking Changes (migrate from v2)
- Workspace config renamed: `workspace` → `projects` (v3.2+)
- `--no-threads` → `--pool forks --poolOptions.forks.singleFork`
- `onTestFinished`/`onTestFailed` receive test context, not test result
- All timing APIs faked by default
- `--isolate false` → `--poolOptions.threads.isolate false`

## Vitest 4.0 Features (Oct 2025)

| Feature | Impact |
|---------|--------|
| **Stable Browser Mode** | Real browser execution replaces jsdom/happy-dom — graduated from experimental |
| **`toMatchScreenshot()`** | Built-in visual regression — no Percy/Chromatic needed for basic comparison |
| **Playwright Traces** | Enhanced debugging for browser tests with frame-by-frame navigation |
| **Separate providers** | `@vitest/browser-playwright`, `@vitest/browser-webdriverio`, `@vitest/browser-preview` |
| **Debug Test in VSCode** | Click-to-debug browser tests from VSCode extension |

### When to use Vitest Browser Mode vs Playwright E2E
| Use case | Tool |
|----------|------|
| Component-level visual regression | Vitest 4 `toMatchScreenshot()` |
| Full user journey E2E | Playwright 1.58 |
| Unit tests (logic, hooks) | Vitest with jsdom (default) |
| GraphQL BFF resolvers | Jest 30 (NestJS testing module) |

### Migration: Vitest 3 → 4
```bash
# Update + install browser provider
npm install -D vitest@latest @vitest/browser-playwright
```
See https://vitest.dev/guide/migration for full guide.

## Playwright 1.56–1.58 Features (2025–2026)

| Feature | Version | Impact |
|---------|---------|--------|
| **Test Agents** (planner/generator/healer) | 1.56 | AI-assisted test authoring and repair |
| **Chrome for Testing** (default) | 1.57 | Better reproducibility local ↔ CI |
| **`webServer.wait` with regex** | 1.57 | Flexible readiness detection via stdout/stderr patterns |
| **Timeline in HTML report** | 1.58 | Visualize test duration, spot bottlenecks |
| **Speedboard tab** | 1.58 | Performance analysis across test suite |
| **UI mode improvements** | 1.58 | OS theme, Cmd+F search, JSON formatting in network panel |
| **`isLocal` CDP option** | 1.58 | File-system optimizations for local CDP connections |

### Breaking changes (Playwright 1.58)
- Removed: `_react` and `_vue` selectors
- Removed: `:light` selector engine suffix
- Removed: `devtools` option from `browserType.launch()`
- Dropped: WebKit support for macOS 13

### Playwright MCP Server (microsoft/playwright-mcp)
25+ tools for LLM-driven browser control. Accessibility tree snapshots (2-5KB structured data, 10-100x faster than screenshots).

**Three AI Test Agents (v1.56+):**
- **Planner** — explores the app via MCP, produces Markdown test plans
- **Generator** — reads project structure, generates test files with role-based locators
- **Healer** — monitors failures, re-evaluates via accessibility tree, 75%+ fix rate on selector issues

**Token efficiency:** MCP ~114K tokens/task. `@playwright/cli` (early 2026): ~27K tokens (74% reduction).

Prefer `getByRole()`, `getByLabel()` over CSS selectors — accessibility-tree-first = more resilient.

---

## Phase 2: Test Implementation

### File locations (convention)

```
src/features/<module>/__tests__/   # Unit + integration (co-located)
src/test/mocks/                    # API client mocks, MSW handlers
e2e/                               # Playwright specs + page objects
```

### Pattern reference navigator

| What to test | Reference file | Key pattern |
|-------------|---------------|-------------|
| React component | `vitest-patterns.md` | RTL render + userEvent + screen queries |
| API service function | `vitest-patterns.md` | Mock API client factory + assert return shape |
| Custom hook | `vitest-patterns.md` | renderHook + act + async state |
| HTTP layer | `vitest-patterns.md` | MSW handlers + per-test overrides |
| E2E user flow | `playwright-e2e.md` | POM pattern + auth session reuse |
| Error boundary | `error-handling-testing.md` | RTL: child throws → assert fallback |
| Toast message | `error-handling-testing.md` | Toast module mock → assert toast.error() |
| Sentry capture | `error-handling-testing.md` | vi.spyOn(Sentry, 'captureException') |
| AI-generated code | `ai-code-review.md` | Security checklist + mutation testing |
| Observability | `observability-checklist.md` | /health + log assertions |

### Non-negotiable patterns

1. **Error paths always tested** — every function needs success AND failure test
2. **Sentry capture verified** — if code calls captureException, test it
3. **Toast messages verified** — every toast.error() must have a test
4. **Shared mock factories** — use `src/test/mocks/`, never inline mocks
5. **TypeScript strict** — tests must compile without `any`

---

## Phase 3: Test Execution

Run in pyramid order (fast → slow). Stop on first failure.

```bash
# 1. Type check — dead imports, wrong types, missing props
npx tsc --noEmit

# 2. Lint — style violations, unused vars, console.log
npm run lint

# 3. Unit + Integration (Vitest)
npm test

# 3b. BFF tests (NestJS, Jest 30)
npm run test --workspace=bff    # or: cd bff && npm test

# 4. Backend tests (Laravel)
php artisan test

# 5. E2E (Playwright) — slowest, highest signal
npm run test:e2e

# Coverage (when improving coverage)
npx vitest run --coverage
```

### What each step catches

| Step | Catches |
|------|---------|
| `tsc --noEmit` | Dead imports after refactor, wrong prop types, missing returns |
| `lint` | console.log, unused vars, `any` types, import order |
| `npm test` | Logic errors, wrong mock behavior, broken data-layer calls |
| `php artisan test` | Authorization bypasses, validation gaps, schema constraint violations |
| `test:e2e` | Real auth flows, navigation breaks, permission errors, toast bugs |

---

## Phase 4: Quality Gates (Pre-Deploy Checklist)

Every item must pass before handing off to deploy.

### G1: Automated tests

- [ ] `npx tsc --noEmit` — 0 errors
- [ ] `npm run lint` — 0 errors (warnings acceptable)
- [ ] `npm test` — all passing
- [ ] `php artisan test` — all passing (backend changes)
- [ ] `npm run test:e2e` — all passing (skip if no E2E setup)

### G2: Error handling coverage

- [ ] Every API endpoint / mutation has an error path test
- [ ] Root error boundary renders fallback (RTL test exists)
- [ ] Every `toast.error()` call has a test asserting it fires
- [ ] Error messages are user-readable (not "undefined" or stack traces)
- [ ] 401 → redirects to login (not blank page)
- [ ] 403 → shows permission denied message
- [ ] 422 → shows field validation errors inline
- [ ] 500 → shows generic message + Sentry captures

### G3: Sentry smoke test

- [ ] Sentry project exists for this app
- [ ] `SENTRY_DSN` is set in the deployment environment
- [ ] Test error from client → visible in Sentry dashboard
- [ ] Test error from server → visible with correct environment tag

Smoke test procedure:
```typescript
// Browser console on staging/preview URL:
throw new Error('[TEST] Pre-deploy Sentry smoke test');
// Then check the Sentry issue stream for the event
```

For automated: `npx tsx scripts/verify-sentry.ts`

### G4: Health endpoint

- [ ] `/health` exists and returns HTTP 200
- [ ] Response: `{ status: "ok", timestamp: string }`
- [ ] Tested: `curl https://staging-url.example/health`
- [ ] Includes DB ping result where applicable

Minimum (NestJS example):
```typescript
@Get('health')
health() {
  return { status: 'ok', timestamp: new Date().toISOString() };
}
```

Laravel: define a `/health` route (or use the built-in `/up` health route in Laravel 11).

### G5: Observability

- [ ] Logs are being produced (check app log streams)
- [ ] No silent `catch` blocks — at least console.error or Sentry.captureException
- [ ] API errors return typed objects `{ success: false, error: string }` — never leak stack traces

### G6: Documentation

- [ ] Test status/coverage notes updated in the repo docs
- [ ] New E2E scenario documented alongside the spec
- [ ] Bug fixed → regression test added and referenced in the fix PR

---

## Common Production Bugs — Required Tests

| Bug pattern | Root cause | Test that prevents it |
|------------|------------|----------------------|
| Backend job silently fails | No error logging, no Sentry | captureException in catch + Sentry smoke |
| Toast shows empty message | error.message is undefined | Test error object structure before toast |
| Error boundary shows nothing | Boundary not wired correctly | RTL: child throws → assert fallback UI |
| 401 shows JSON to user | Missing redirect in guard/middleware | E2E: logout → protected route → assert redirect |
| Sentry not receiving events | DSN not set in production | G3 smoke test |
| `/health` returns 404 | Route not added | G4 curl test |
| `tsc` fails after deploy | Dead imports post-refactor | G1: tsc --noEmit before deploy |

---

## CI Integration

Enhanced quality job: copy `assets/github-actions-quality.yml` into your CI workflow.

Additions over a baseline deploy pipeline:
- Separate steps for tsc, lint, test (easier failure diagnosis)
- Conditional E2E step (only if Playwright config exists)
- `--reporter=github` for inline PR annotations

---

## Quick Reference: Commands

```bash
# Full pre-deploy run
npx tsc --noEmit && npm run lint && npm test && echo "All quality gates passed"

# With E2E
npx tsc --noEmit && npm run lint && npm test && npm run test:e2e

# Watch mode during development
npx vitest

# Coverage
npx vitest run --coverage

# Single file
npx vitest run src/features/auth/__tests__/login.test.ts

# Single test by line (Vitest 3.0+)
npx vitest run src/features/auth/__tests__/login.test.ts:42

# E2E headed (debugging)
npx playwright test --headed --debug

# E2E with Timeline report (Playwright 1.58+)
npx playwright test --reporter=html

# Health check
bash scripts/test-health.sh https://staging.example.com

# Sentry smoke
npx tsx scripts/verify-sentry.ts
```
