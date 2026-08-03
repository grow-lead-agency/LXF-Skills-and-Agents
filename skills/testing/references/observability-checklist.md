# Observability Checklist

> Verify logs, Sentry, health endpoint, and alert pipelines work BEFORE production deploy.

---

## Three Pillars

| Pillar | Tool in stack | Verification |
|--------|-------------|-------------|
| Logs | Cloudflare Workers Observability / Vercel Logs / Supabase Logs | `wrangler tail` shows request logs |
| Metrics | Sentry Performance | Transactions visible in Sentry |
| Traces | Sentry distributed tracing | Client → Server → Worker → DB traceable |

All three must be verified before declaring "ready for deploy".

---

## 1. Health Endpoint

### Minimum spec

```typescript
// Hono (Cloudflare Workers)
app.get('/health', (c) =>
  c.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
  })
)
```

### Extended spec (with DB ping)

```typescript
app.get('/health', async (c) => {
  const dbOk = await checkDatabase(c.env)
  return c.json({
    status: dbOk ? 'ok' : 'degraded',
    timestamp: new Date().toISOString(),
    version: c.env.VERSION || 'unknown',
    db: dbOk ? 'connected' : 'unreachable',
  }, dbOk ? 200 : 503)
})

async function checkDatabase(env: Env): Promise<boolean> {
  try {
    // D1
    await env.DB.prepare('SELECT 1').first()
    return true
  } catch {
    return false
  }
}
```

### Verification

```bash
# Local
curl -s http://localhost:8787/health | jq .

# Staging
curl -s https://staging.example.com/health | jq .

# Expected output:
# { "status": "ok", "timestamp": "2026-02-28T10:00:00.000Z" }

# Automated (use scripts/test-health.sh)
bash scripts/test-health.sh https://staging.example.com
```

---

## 2. Sentry Smoke Test

### Step-by-step procedure

**Step 1:** Confirm Sentry project exists

Use Sentry MCP:
```
MCP: find_projects → search for project name
```

Or REST API:
```bash
curl -H "Authorization: Bearer $SENTRY_AUTH_TOKEN" \
  "https://de.sentry.io/api/0/organizations/your-org/projects/"
```

**Step 2:** Confirm DSN is set

- Cloudflare Workers: `wrangler secret list` → SENTRY_DSN must exist
- Vercel: Dashboard → Settings → Env Vars → SENTRY_DSN
- Supabase EF: `supabase secrets list` → SENTRY_DSN

**Step 3:** Send test error from CLIENT

In browser console on staging/preview URL:
```javascript
throw new Error('[TEST] Pre-deploy client smoke test ' + Date.now())
```

**Step 4:** Send test error from SERVER

Create a test endpoint or use existing error page:
```typescript
// Temporary: app/api/test-sentry/route.ts
export async function GET() {
  throw new Error('[TEST] Pre-deploy server smoke test ' + Date.now())
}
```

Visit `/api/test-sentry` → should get error page, Sentry should capture.

**Step 5:** Verify events arrived

```
MCP: search_issues → query: "[TEST] Pre-deploy"
```

Check:
- [ ] Event exists for client error
- [ ] Event exists for server error
- [ ] Environment tag is correct (not "development" for staging)
- [ ] Source maps resolved (stack trace shows .ts files, not minified)
- [ ] User context attached (if user was authenticated)

**Step 6:** Clean up

Delete the test-sentry route. Resolve test issues in Sentry.

### Automated (CI)

Use `scripts/verify-sentry.ts`:
```bash
SENTRY_DSN=... SENTRY_AUTH_TOKEN=... SENTRY_ORG=your-org SENTRY_PROJECT=my-project \
  npx tsx scripts/verify-sentry.ts
```

---

## 3. Log Verification

### Cloudflare Workers

```bash
# Stream live logs
wrangler tail --format json

# Or use Cloudflare Observability MCP
MCP: query_worker_observability → filter by worker name, last 1 hour
```

Verify:
- [ ] Request logs appear for each route hit
- [ ] Error logs appear when errors occur (not swallowed)
- [ ] No sensitive data in logs (tokens, passwords, PII)

### Vercel / Next.js

Check Vercel Dashboard → Logs after hitting staging URL.

### Supabase Edge Functions

```bash
# Stream function logs
supabase functions logs process-booking --project-ref <ref>
```

### What to look for

| Good sign | Bad sign |
|-----------|----------|
| Request/response logged | Silent — no logs at all |
| Errors include context | `catch (e) {}` — empty catch |
| Structured JSON logs | Random console.log statements |
| Sentry event ID in error log | Just "Error: something failed" |

---

## 4. Alert Verification

### Sentry alerts → n8n → Telegram

The standard alert pipeline:

```
Sentry Alert Rule → Webhook → n8n (n8n.example.com) → Telegram
```

### Testing the pipeline

1. **Trigger a real error** that matches alert conditions (e.g., new issue)
2. **Check n8n:** Go to `n8n.example.com` → Executions → verify webhook received
3. **Check Telegram:** Message should appear in the alert group

If alerts don't fire:
- Check Sentry Alert Rules exist (5 per project)
- Check webhook URL is correct: `https://n8n.example.com/webhook/sentry-alert`
- Check n8n workflow is active
- Check Telegram bot token is valid

---

## 5. Post-Deploy Smoke Tests

After first production deploy, manually verify these 5 flows:

| # | Flow | What to check |
|---|------|-------------|
| 1 | Homepage loads | No console errors, no broken images |
| 2 | Login flow | Passwordless OTP sends, user lands on dashboard |
| 3 | Core CRUD | Create, read, update, delete main entity |
| 4 | Error state | Disconnect network → error message shown (not blank) |
| 5 | Health check | `curl production-url.com/health` → 200 OK |

---

## 6. "Done" Criteria

Observability is complete when ALL of these are true:

- [ ] `/health` returns 200 with correct JSON
- [ ] Sentry receives events from client AND server
- [ ] Source maps are resolved (TypeScript filenames in stack traces)
- [ ] 5 alert rules exist in Sentry for this project
- [ ] n8n webhook processes Sentry alerts → Telegram message arrives
- [ ] `wrangler tail` / Vercel Logs show structured request logs
- [ ] No silent catch blocks in codebase
- [ ] TEST-STATUS.md documents observability verification date

---

## Sources

- https://goreplay.org/blog/production-readiness-checklist-20250808133113/
- https://hydrolix.io/blog/observability-in-2025/
- https://docs.sentry.io/product/sentry-basics/integrate-frontend/generate-first-error/
