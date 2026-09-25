# Laravel app security audit: one-page checklist

Order = severity. Record each item in a numbered findings register (ID, severity, where, fix,
verified manually or agent-reported, status). Rule IDs refer to SKILL.md.

## Critical first (hours, not days)
- [ ] Route inventory: write routes without auth, authenticated write routes without permission, GET with side effects (R1.1, R1.2). `references/route-exposure.md`
- [ ] Routes defined after the auth group closes; test/demo routes with real data; open registration (R1.3)
- [ ] Token checks compared with string literals (bypass values), `==` on secrets, fail-open empty config (R3.1, R3.2, R3.5). Semgrep `laravel-hardcoded-token-comparison`
- [ ] Permission/role management routes: who can call them, can users grant themselves (R2.1)
- [ ] Webhooks: signature verified on raw body with hash_equals; delete events re-fetched (R4.1, R4.3)
- [ ] Public wizards: what goes into the session before verification; later steps re-query by user input? (R5.1)
- [ ] `{!! !!}` on customer, webhook or message data (R6.1)
- [ ] `storage/app/public` contents: invoices, feeds with PII, labels, uploads (R7.1); delete-by-path routes (R7.2)
- [ ] Laravel major still receives security fixes; `composer audit`, `npm audit` (R9.7)
- [ ] Double side effects: jobs calling tax/payment/shipping APIs without unique + pending record; stock reservation without row locks (R10.1, R10.4)

## High
- [ ] Tenant/shop scoping: Policies on every `findOrFail` of tenant data, listing queries scoped; sequential-ID IDOR test (R2.3)
- [ ] `withoutMiddleware` on groups; hardcoded user-ID allowlists (R2.4, R2.5)
- [ ] Identity asserted by a client or BFF instead of derived from the token (R2.7)
- [ ] Webhook idempotency and throttle; payload IDs URL-encoded (R4.2, R4.4, R4.5)
- [ ] Wizard quantity bounds and state transitions (R5.2, R5.3)
- [ ] SameSite value, GET side effects, iframe flows, CORS with credentials (R8.1, R8.5)
- [ ] `APP_DEBUG`, `--no-dev` in deploy, debug packages present on the server (R9.1, R9.2)
- [ ] Secrets in code, scripts, git history; token in git remote URLs (R9.3)
- [ ] Job `$timeout` vs `retry_after`; `withoutOverlapping` on scheduled side effects; UNIQUE on natural keys; HTTP inside transactions; `catch { commit }`; swallowed job exceptions (R10.2, R10.3, R10.5, R10.6, R10.7)
- [ ] Uploads: generated names, extension allowlist, SVG/HTML, files pushed to other domains (R7.3)

## Medium
- [ ] Mass assignment from `$request->all()`, column-name-from-request writers (R2.6)
- [ ] Action tokens: expiry and single use; signed URLs with `used_at` (R3.3, R3.4)
- [ ] Lookup endpoints: throttle, uniform responses, captcha; public mail-sending endpoints (R5.4, R5.6)
- [ ] Client-supplied file paths and session keys (R5.5)
- [ ] PDF engines: remote resources, escaping in PDF views; Browsershot sandbox and sync rendering (R6.2, R6.3)
- [ ] Feeds: atomic writes, secret paths (R7.4); upload limits and cleanup (R7.5)
- [ ] Session ID from URL; Host header and reset links; `auth.session`, `active` flag, token expiry; trustProxies (R8.2, R8.3, R8.4, R8.6)
- [ ] PII in logs; dd/dump in `app/`; `api` group throttle; TLS verification and SFTP fingerprints (R9.4, R9.5, R9.6, R9.8)
- [ ] CDN scripts without SRI (R6.4)

## Process (turns fixes into lasting state)
- [ ] CI runs PHPUnit incl. `RouteSecurityTest`, Semgrep rules, Larastan, `composer audit`, gitleaks
- [ ] Fixes reach the production branch (check that fixes on a side branch actually shipped)
- [ ] Every fix has a regression test run as the lowest privileged role
- [ ] Second audit pass on money, stock, tax and document flows (concurrency, idempotency)
- [ ] Server questions listed separately: production `.env` values, what is under `/storage`, access logs for exploited paths (GDPR)
