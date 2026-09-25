---
name: laravel-security
description: >-
  Laravel 11-13 application security rules from a real ERP audit: routes outside the
  auth group, missing permission middleware, withoutMiddleware holes, spatie permission
  escalation, IDOR, hardcoded bypass tokens, signed URLs, webhook HMAC (incl. Shoptet),
  public wizards, Blade {!! !!}, PDF/Browsershot, public disk leaks, SameSite/iframe
  cookies, Host header resets, APP_DEBUG/--no-dev, dd/dump, PII logs, double-processed
  jobs, stock races. Includes route exposure test, audit checklist, Semgrep rules.
  Triggers: laravel security, laravel audit, laravel bezpečnost, audit laravel aplikace,
  laravel route audit, spatie permission security, laravel webhook signature, shoptet
  webhook podpis, laravel signed url, blade xss, laravel public disk, ShouldBeUnique,
  lockForUpdate, semgrep laravel.
  NE pro: obecnou OWASP teorii (viz owasp-security), audit report agentem (viz
  security-reviewer), audit webu zvenku (viz tech-audit-security), běžný Laravel vývoj
  (viz laravel-11).
metadata:
  author: grow-lead-agency
  version: "1.0"
  tags: [laravel, php, security, audit, semgrep]
---

# Laravel Security

Laravel-specific security rules. Each rule comes from a pattern that was found exploitable
(or one config flip away from it) in a production Laravel 11 application. Framework defaults
are mostly safe; the holes came from how the app was *wired*: route groups, middleware
exclusions, "temporary" shortcuts, public helper routes and background jobs.

**Scope and ownership**

| Need | Skill |
|------|-------|
| Generic OWASP Top 10 / ASVS theory, other stacks | `owasp-security` |
| Formal audit report with severity ratings (agent) | `security-reviewer` |
| External black-box audit of a live site (TLS, headers, exposure) | `tech-audit-security` |
| Laravel app structure, Eloquent, queues, Sanctum basics | `laravel-11` |
| **Laravel wiring mistakes, how to find them, how to regression-test them** | **this skill** |

Assume the reader knows what XSS, CSRF and IDOR are. This skill says *where they hide in a
Laravel app* and gives a find method plus a regression test for each.

## How to use

- **Writing code:** apply the rules of the category you are touching; load the matching
  reference file for full code.
- **Reviewing a PR:** run `semgrep --config references/semgrep-rules.yml app/ routes/ resources/views/`
  and the route exposure test on the branch, then read the diff against the categories it touches.
- **Auditing an app:** follow `references/audit-checklist.md` top to bottom (ordered by severity).
  Keep findings in a numbered register (ID, severity, where, fix, verified manually or
  agent-reported, status). Always do a second pass focused on money, stock, tax and document
  flows: in the source audit the second pass reversed one "verified OK" item and surfaced a
  whole new class of bugs (concurrency and idempotency).
- **Fixing:** every fix ships with the regression test from the reference file. Fixes that
  change cookies or embedded flows ship together with an E2E test of that flow.

Severity: **K** critical (exploitable now, big impact) · **V** high · **S** medium.

## Reference files

| File | Content |
|------|---------|
| `references/route-exposure.md` | Route inventory (jq), `RouteSecurityTest` (every state-changing route has auth + authorization), side-effect GET detector |
| `references/authorization.md` | spatie/laravel-permission wiring, Policies with tenant scope, IDOR tests, `withoutMiddleware`, customer tokens and signed URLs |
| `references/webhooks-and-public-flows.md` | HMAC middleware (generic + Shoptet), idempotency, re-fetch on delete, wizard session binding, bounded quantities, state guards |
| `references/output-files-session.md` | Blade raw output + sanitizers, PDF engines, Browsershot, disks and uploads, atomic feeds, SameSite/iframe cookies, Host header, deactivation |
| `references/deploy-and-concurrency.md` | APP_DEBUG, `--no-dev`, fail-closed tokens, logging without PII, dd/dump gate, API throttle, unique jobs, timeouts, locks, unique indexes, transactions |
| `references/audit-checklist.md` | One-page checklist for auditing any Laravel app, ordered by severity |
| `references/semgrep-rules.yml` | Custom Semgrep rules for the patterns below |
| `references/sources.md` | All URLs used |

---

## 1. Route exposure (start every audit here)

The most productive audit step. In the source audit, public routes defined *after* the
closing brace of the `auth` group, plus one inner group that switched the permission
middleware off, produced most of the critical findings.

- **R1.1 (K)** Every state-changing route (POST/PUT/PATCH/DELETE) has authentication **and**
  authorization middleware, or sits on an explicit public allowlist with a reason. Enforce it
  with a test, not with review. `Router::gatherRouteMiddleware()` resolves groups, aliases and
  `withoutMiddleware` exclusions, so the test sees what really runs.
- **R1.2 (V)** No side effects on GET. `GET /links/purge` plus a cross-site cookie is a one-click
  CSRF. Detect by verbs in route names and URIs (delete, purge, cancel, approve, sync, send).
- **R1.3 (S)** Disable what you do not use: `Auth::routes(['register' => false])` on internal
  apps; delete test and demo routes that render real records.
- **R1.4 (S)** Every public route has `throttle:`.

Find: `php artisan route:list --json --except-vendor | jq` (filter in reference), then read
`routes/*.php` for anything after the auth group closes. Test: `RouteSecurityTest`.

## 2. Authorization

- **R2.1 (K)** Role and permission management endpoints are admin-only: `permission:permissions.manage`
  on every write route, the actor never edits their own roles, and never grants a permission
  they do not hold.
- **R2.2 (V)** `permission:` / `can:` middleware on every write route. `auth` alone means
  "any employee". Check permissions, not role names (spatie best practice).
- **R2.3 (V)** Tenant-owned data (shop, company, branch) goes through a Policy that checks the
  tenant; every `findOrFail($id)` on a tenant-owned model is followed by `authorize()`.
  Sequential IDs + `findOrFail` without a policy = IDOR across tenants.
- **R2.4 (V)** `->withoutMiddleware(...)` on a group is a red flag: it silently removes a check
  from every nested route. If truly needed: comment with the reason + covered by R1.1 test.
- **R2.5 (S)** No hardcoded user-ID allowlists (`in_array(auth()->id(), [10, 11, 12])`). Model
  it as a permission; ID lists rot when people leave.
- **R2.6 (S)** Never `update($request->all())`; use `$request->validated()` or `safe()->only()`.
  "Write the column named in the request" endpoints need a column allowlist.
- **R2.7 (V)** Do not trust an identity asserted by a client (a BFF sending `customer_id`,
  protected only by a shared API key). Derive the subject from the token or session.

```php
// BAD: any authenticated user can grant themselves everything
Route::middleware('auth')->post('/permissions/user/{user}', [PermissionController::class, 'sync']);

// GOOD
Route::middleware(['auth', 'permission:permissions.manage'])
    ->post('/permissions/user/{user}', [PermissionController::class, 'sync']);
// in the action: abort_if($user->is($request->user()), 403);
// and: abort_unless($request->user()->hasAllPermissions($requested), 403);
```

## 3. Tokens in links (customer decision links, magic links)

- **R3.1 (K)** No hardcoded bypass values in token checks (`$token !== $expected && $token !== 'x'`).
  Grep every comparison of a token-like variable with a string literal.
- **R3.2 (V)** Compare secrets with `hash_equals()`; `==` / `!==` are not constant-time.
- **R3.3 (S)** Action tokens expire and are single-use (`used_at`, consumed in a transaction
  with a row lock). A decision link that works forever is a standing credential.
- **R3.4** Prefer `URL::temporarySignedRoute()` + `signed` middleware over home-made tokens.
  Signed URLs are not single-use by themselves, so add a `used_at` check for state changes.
- **R3.5 (V)** Fail closed: a missing or empty configured token denies. With `env('X', '')` and
  `!==`, an empty header matches the empty config and the endpoint is open.

## 4. Webhooks

- **R4.1 (K)** Verify an HMAC over the **raw body** before anything else, with `hash_equals`.
  Shoptet: header `Shoptet-Webhook-Signature` = `hash_hmac('sha1', $rawBody, $signatureKey)`,
  key generated by `POST /api/webhooks/renew-signature-key`, stored per e-shop (Shoptet docs,
  verified 2026-09-25). Defense in depth: Shoptet sends only from `185.184.254.0/24`.
- **R4.2 (V)** Idempotency: providers retry (Shoptet: HTTP 200 within 4 s, otherwise resent
  after 15 min, max 3 attempts). Store a dedup key, answer 200 fast, queue the work.
- **R4.3 (K)** No destructive action from the payload alone. On `*:delete` events re-fetch from
  the provider API and delete locally only if the API confirms (404).
- **R4.4 (S)** Validate and `rawurlencode()` payload identifiers before putting them into
  outbound API URLs (`eventInstance` = `../customers/x` walks the provider API with your token).
- **R4.5 (S)** `throttle:` on webhook routes; CSRF exception only for the exact webhook paths.

## 5. Public multi-step forms (wizards)

- **R5.1 (K)** Store the verified entity **ID** in the session only **after** the full check
  (order number + email both match). Later steps use `Model::find(session('wizard.order_id'))`
  and never re-query by a user-supplied identifier.
- **R5.2 (V)** Bound quantities server-side: `qty <= purchased - already_claimed`, computed in a
  transaction with a lock, not just `integer|min:1`.
- **R5.3 (V)** Guard state transitions: allowed only from specific source states, once
  (`abort_unless($claim->status === ClaimStatus::AwaitingDecision, 409)`).
- **R5.4 (S)** Lookup endpoints (number + email): `throttle`, identical response for found and
  not found, captcha after repeated failures.
- **R5.5 (S)** Paths and IDs echoed back by the client (uploaded image paths, item IDs used as
  session keys) are checked against what this session created; never accept storage paths.
- **R5.6 (S)** Public endpoints that send email to staff or customers: throttle + token or captcha.

## 6. Output escaping

- **R6.1 (K)** `{!! !!}` only on HTML that went through a sanitizer (HTMLPurifier via
  `mews/purifier`, or `symfony/html-sanitizer`). Customer messages, names, addresses and
  provider data from webhooks are attacker input. If the repo already has a sanitizer, use it
  everywhere: a message sanitized in one view and raw in another was a stored XSS in the audit.
- **R6.2 (S)** PDF templates escape like web views. dompdf: keep `isRemoteEnabled` false and
  set `chroot`. mPDF fetches remote `<img>` and CSS while rendering, so HTML injection becomes
  SSRF: escape input and block egress from the PDF worker.
- **R6.3 (S)** Browsershot/Chromium: no `noSandbox()` on a normal host (Spatie documents it
  for certain virtualized environments only); render server templates, never user URLs; run
  in a queue, not synchronously in PHP-FPM (a few label prints can exhaust the FPM pool).
- **R6.4** Third-party scripts on admin pages: pinned version + SRI, or bundle via Vite.

## 7. Files

- **R7.1 (K)** Personal or financial data goes to the private `local` disk, served through an
  authorized controller or `Storage::temporaryUrl()`. `storage:link` publishes everything
  under `storage/app/public` at a guessable URL, forever.
- **R7.2 (K)** No delete-by-path from user input. Delete only files tied to the actor (session
  upload list, DB row owned by the tenant).
- **R7.3 (V)** Generated names (`$file->store()` / `hashName()`), extension allowlist via
  `mimes:`. SVG and HTML are XSS on whatever domain serves them: reject or sanitize, and
  serve downloads with `Content-Disposition: attachment`.
- **R7.4 (S)** Feeds consumed by others: write to a temp file, then `rename()` (atomic). Feeds
  with PII or purchase prices never on a public path without a secret token.
- **R7.5 (S)** Uploads: max count, max size, throttle, cleanup job.

## 8. Session, cookies, CORS, hosts

- **R8.1 (V)** Main session cookie stays `lax`. `SameSite=None` + any GET side effect = CSRF.
  Flows embedded in an iframe on another site get a **separate** cookie
  (`SameSite=None; Secure; Partitioned`) or a stateless signed token. Ship with an E2E test
  of the embedded flow, a global `lax` flip silently breaks iframe wizards.
- **R8.2 (S)** Session ID only from the cookie. A custom `StartSession` reading an ID from the
  query string = session fixation + leakage through logs and Referer.
- **R8.3 (S)** Host header: `$middleware->trustHosts(at: [...])` and/or a catch-all nginx server
  returning 444, plus `URL::forceRootUrl(config('app.url'))`, so reset links cannot point to an
  attacker domain.
- **R8.4 (S)** `auth.session` (`AuthenticateSession`) so password changes kill other sessions;
  an `active` flag checked on every request for offboarding.
- **R8.5 (S)** CORS `supports_credentials` only for origins that need it; no wildcards.
- **R8.6 (S)** `trustProxies` configured behind a proxy or CDN, otherwise rate limits key on the
  proxy IP and lock out everyone at once.

## 9. Config and deploy hygiene

- **R9.1 (V)** `APP_DEBUG=false` in production; `.env.example` does not default to debug.
- **R9.2 (V)** `composer install --no-dev --optimize-autoloader` in deploy. Debugbar, Boost, MCP
  servers and Telescope in production expose SQL, sessions and requests.
- **R9.3 (V)** Secrets in env, never in code, crontab scripts or git; rotate anything ever committed.
- **R9.4 (S)** Logs carry IDs, not payloads: no `$request->all()`, full customer objects or IBANs.
- **R9.5 (S)** No `dd()` / `dump()` / `var_dump()` in `app/`: CI gate via the Semgrep rule or
  `spaze/phpstan-disallowed-calls` on top of Larastan.
- **R9.6 (S)** The `api` group is **not** throttled unless you opt in with
  `$middleware->throttleApi()` in `bootstrap/app.php` (framework 12.x source, verified 2026-09-25).
- **R9.7 (K)** Supported Laravel major only. Security fixes end: 11 on 2026-03-12, 12 on
  2027-02-24, 13 on 2028-03-17 (Laravel 13 release notes, last verified 2026-09-25).
  `composer audit` and `npm audit` in CI.
- **R9.8 (S)** Outbound TLS verification stays on (`Http::withoutVerifying()`,
  `CURLOPT_SSL_VERIFYPEER => false` are findings). SFTP disks pin `hostFingerprint`.

## 10. Concurrency and integrity (security-relevant)

Double processing is a money bug: a document sent twice to a tax authority, the last item sold
twice, a refund queued twice.

- **R10.1 (K)** Jobs with external side effects implement `ShouldBeUnique` with `uniqueId()` per
  business key and write a `pending` record under a lock *before* calling the API.
- **R10.2 (V)** Job `$timeout` and worker `--timeout` several seconds shorter than the queue
  connection `retry_after`, otherwise a slow job runs twice (Laravel queue docs).
- **R10.3 (V)** Scheduled tasks with side effects: `->withoutOverlapping()`, `->onOneServer()` on
  multi-server, unique `->name()`, `->onFailure()` alert.
- **R10.4 (K)** Stock and balances: `lockForUpdate()` on affected rows in a stable order (by id)
  inside the transaction; "read last balance, add delta, insert" without a lock loses writes.
- **R10.5 (V)** Natural keys get UNIQUE indexes (`(tenant_id, external_id)`); writes use `upsert`
  or `firstOrCreate` backed by the constraint. Find and merge duplicates first.
- **R10.6 (V)** No external HTTP calls inside DB transactions; dispatch after commit
  (`->afterCommit()` / `ShouldQueueAfterCommit`). Never `catch { DB::commit(); }`.
- **R10.7 (V)** Jobs rethrow exceptions so `$tries`, `$backoff`, `failed()` and `failed_jobs`
  work; delete the "pending update" marker only after success.

---

## Anti-patterns seen in the wild

| Pattern | Why it hurts |
|---------|--------------|
| Public routes appended after the `auth` group "just for this form" | Anonymous write access, invisible in review |
| `withoutMiddleware(PermissionMiddleware::class)` on an inner group | Hundreds of routes lose authorization in one line |
| `&& $check != 'somevalue'` debug bypass left in a token check | Universal key for every customer link |
| Delete webhooks trusting the payload | Anyone can mark invoices or customers as deleted |
| Wizard stores the order number in session before verification | Takeover of any order by number |
| Sanitizer exists but is used in only one of two views | Stored XSS through the other view |
| `storage/app/public/invoices/{order_id}/invoice.pdf` | Enumerable PII, GDPR incident |
| Global `SameSite=None` to make an iframe work | CSRF across the whole admin |
| `composer install` without `--no-dev` | Debug tooling in production |
| No unique job + `retry_after` 90 s + slow API | Same side effect executed twice |
| Hardcoded user IDs as "permissions" | Offboarding and audit impossible |

57 rules in 10 categories (R1.1 to R10.7); find methods and regression tests are in the reference files.

<!-- Origin: Petr Rohan / Claude | Created: 2026-09-25 | Inspiration: https://laravel.com/docs/12.x/authorization, https://laravel.com/docs/12.x/urls, https://laravel.com/docs/12.x/queues, https://developers.shoptet.com/webhooks/, https://spatie.be/docs/laravel-permission/v6/basic-usage/middleware | Derived from a real Laravel 11 ERP security audit, client anonymized -->
