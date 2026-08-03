# Observability Checklist

> Verify health endpoints, nginx/PHP-FPM/supervisor logs, MySQL and Redis signals,
> error reporting, and alerts before a production deploy to a VM.

---

## Operating Model

| Signal | Primary source on the VM | Verification |
|--------|--------------------------|--------------|
| HTTP access/errors | nginx access/error logs | Request ID, status, latency, upstream timing visible |
| PHP application/errors | Laravel log + PHP-FPM journal/slow log | Application exception correlates with the request |
| BFF application/errors | NestJS service journal | GraphQL operation and request ID visible without sensitive input |
| Background work | supervisor status + worker logs | Queue processes running; failed jobs visible |
| Database | MySQL health/status/slow query log | Ping succeeds; saturation and slow queries observable |
| Cache/queue backend | Redis ping/info/log | Connectivity and memory pressure observable |
| Error aggregation | Sentry or equivalent | Client, BFF, and Laravel events arrive with environment/release |

Logs, metrics, and traces should share a request/correlation ID across nginx, NestJS,
Laravel, and queued work where the architecture permits it.

---

## 1. Health and Readiness Endpoints

### Laravel

Laravel 11 provides `/up` as a liveness endpoint. Keep it cheap: it answers whether the
application can boot, not whether every dependency is healthy. Add a separate protected
readiness endpoint when a load balancer or deploy gate must verify MySQL and Redis.

```php
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Route;

Route::get('/ready', function () {
    try {
        DB::select('SELECT 1');
        Cache::store('redis')->get('readiness-probe');

        return response()->json([
            'status' => 'ok',
            'timestamp' => now()->toIso8601String(),
        ]);
    } catch (Throwable $error) {
        report($error);

        return response()->json([
            'status' => 'degraded',
            'timestamp' => now()->toIso8601String(),
        ], 503);
    }
});
```

Do not return credentials, hostnames, exception messages, query text, or stack traces.
If `/ready` is public, rate-limit it; otherwise restrict it at nginx to the monitoring host.

### NestJS BFF

Expose a cheap HTTP health route outside GraphQL so infrastructure can probe it without
constructing a GraphQL request:

```typescript
@Controller('health')
export class HealthController {
  @Get()
  health() {
    return { status: 'ok', timestamp: new Date().toISOString() }
  }
}
```

### Verification

```bash
curl --fail --silent https://staging.example.com/up
curl --fail --silent https://staging.example.com/ready | jq .
curl --fail --silent https://staging.example.com/bff/health | jq .

# Reusable gate
bash scripts/test-health.sh https://staging.example.com
```

Verify both success and failure behavior: stop or firewall a non-production dependency,
confirm readiness returns `503`, restore it, and confirm recovery.

---

## 2. nginx Verification

### Configuration and service health

```bash
sudo nginx -t
systemctl is-active --quiet nginx
systemctl status nginx --no-pager
```

### Logs

```bash
sudo tail -n 100 /var/log/nginx/access.log
sudo tail -n 100 /var/log/nginx/error.log
sudo journalctl -u nginx --since '15 minutes ago' --no-pager
```

Verify:

- [ ] Access logs include status, request duration, upstream duration, and request ID
- [ ] 499/502/503/504 responses are distinguishable
- [ ] nginx forwards the request ID to the BFF/Laravel layer
- [ ] Health probes are either sampled or sent to a separate low-noise log
- [ ] Authorization headers, cookies, tokens, and request bodies are not logged

---

## 3. PHP-FPM Verification

```bash
sudo php-fpm8.4 -t
systemctl is-active --quiet php8.4-fpm
sudo systemctl status php8.4-fpm --no-pager
sudo journalctl -u php8.4-fpm --since '15 minutes ago' --no-pager
sudo tail -n 100 /var/log/php/slow.log
```

Expose `/fpm-status` and `/fpm-ping` only to localhost or the monitoring network. Check:

```bash
curl --fail --silent http://127.0.0.1/fpm-ping
curl --fail --silent 'http://127.0.0.1/fpm-status?json' | jq .
```

Verify:

- [ ] `listen queue` is normally zero and `max listen queue` is monitored
- [ ] `max children reached` is zero under normal load
- [ ] Slow requests appear in the slow log with actionable stack information
- [ ] Worker stderr reaches the FPM/system journal
- [ ] Deploy reloads do not create bursts of 502 responses

---

## 4. Supervisor and Queue Workers

```bash
sudo supervisorctl status
sudo supervisorctl tail -100 laravel-worker:laravel-worker_00 stderr
sudo journalctl -u supervisor --since '15 minutes ago' --no-pager
php artisan queue:failed
```

Verify:

- [ ] Every configured process is `RUNNING`, not `BACKOFF`, `FATAL`, or restart-looping
- [ ] Worker logs include job class/name and correlation ID but not serialized secrets
- [ ] Failed jobs create an alert and retain enough context for replay
- [ ] `stopwaitsecs` exceeds the longest valid job duration
- [ ] Deploys run `php artisan queue:restart` and new workers load the new release

Run one staging job end to end. Confirm enqueue time, start, completion/failure, and the
resulting database state are all observable.

---

## 5. MySQL and Redis

### MySQL 8

```bash
mysqladmin --host=127.0.0.1 --user=monitor --password ping
mysql --host=127.0.0.1 --user=monitor --password \
  --execute='SELECT 1; SHOW GLOBAL STATUS LIKE "Threads_connected";'
```

Verify:

- [ ] Connection count, rejected connections, lock waits, and buffer-pool pressure are monitored
- [ ] Slow query log is enabled with a reviewed threshold
- [ ] Laravel and MySQL timestamps use the intended timezone policy
- [ ] Backups are recent and restore verification is scheduled
- [ ] The monitoring account is read-only and its password is not embedded in scripts

### Redis

```bash
redis-cli -h 127.0.0.1 ping
redis-cli -h 127.0.0.1 info memory
redis-cli -h 127.0.0.1 info stats
```

Verify memory usage, eviction count, rejected connections, persistence policy, and queue
latency. A successful `PING` alone does not prove that Redis has memory headroom.

---

## 6. Application and Error-Reporting Smoke Tests

### Structured logs

Trigger one successful request, one validation failure, one authorization failure, and one
controlled server error in staging. For each request, verify the same correlation ID appears
in the relevant nginx and application logs.

Good logs contain operation, status, duration, actor/tenant identifiers where permitted,
and an error/event ID. Bad logs contain raw GraphQL variables, passwords, tokens, full request
bodies, SQL bindings with personal data, or only a context-free `Something failed` message.

### Sentry or equivalent

1. Confirm DSNs/tokens are present in the VM service environment, not in the repository.
2. Send a uniquely named test error from the React client.
3. Send a controlled test error through the NestJS BFF.
4. Send a controlled test error through Laravel/FPM.
5. Verify environment, release, source maps, request ID, and safe user context.
6. Remove temporary test endpoints and resolve the test issues.

For an SDK/API ingestion check independent of the application runtime:

```bash
SENTRY_DSN=... SENTRY_AUTH_TOKEN=... SENTRY_ORG=example SENTRY_PROJECT=app \
  npx tsx scripts/verify-sentry.ts
```

That script confirms ingestion, but it does not replace testing the real React, NestJS, and
Laravel integrations.

---

## 7. Alert Verification

Test the actual route from signal to the on-call destination:

1. Trigger a new staging error that matches the production-style rule.
2. Confirm the alert rule evaluates it.
3. Confirm the notification reaches the configured incident channel/on-call service.
4. Confirm the alert links to logs/traces and includes environment and release.
5. Acknowledge and resolve the test incident.

At minimum, cover sustained 5xx rate, nginx upstream failures, PHP-FPM saturation, supervisor
process failure, queue backlog/failed jobs, MySQL availability, Redis memory pressure, disk
space, and expiring TLS certificates. Thresholds should come from measured normal load rather
than arbitrary copied values.

---

## 8. Post-Deploy Smoke Tests

| # | Flow | What to verify |
|---|------|----------------|
| 1 | Homepage/storefront loads | No browser errors, assets return 200, release is correct |
| 2 | Login and GraphQL query | Auth context reaches BFF/Laravel; no data leakage |
| 3 | Core mutation | Laravel policy passes for allowed actor; MySQL row is committed |
| 4 | Forbidden mutation | UI handles GraphQL error; database remains unchanged |
| 5 | Background job | Supervisor worker processes it and logs completion |
| 6 | Health/readiness | Liveness 200; readiness 200 with dependencies restored |

Immediately after deploy, compare 5xx rate, FPM queue, worker restarts, MySQL connections,
Redis evictions, and error volume with the pre-deploy baseline.

---

## Serverless Variant

For a serverless deployment, replace systemd/nginx/FPM/supervisor checks with the provider's
function health, deployment logs, concurrency, cold-start, and queue controls. Keep the same
application-level requirements: liveness/readiness semantics, correlation IDs, safe structured
logs, dependency checks, error ingestion, alert delivery, and end-to-end smoke tests.

---

## Done Criteria

- [ ] nginx, PHP-FPM, supervisor, Laravel, and NestJS services are healthy
- [ ] Laravel `/up`, readiness, and BFF health endpoints have verified 200/503 behavior
- [ ] MySQL and Redis health plus saturation signals are visible
- [ ] Queue success and failure paths are observable
- [ ] Client, BFF, and Laravel error events reach the error tracker with release/environment
- [ ] Alerts reach the real incident destination
- [ ] Logs contain correlation IDs and exclude secrets/personal data
- [ ] Post-deploy flows pass and metrics show no regression

---

## Sources

- https://nginx.org/en/docs/http/ngx_http_log_module.html
- https://www.php.net/manual/en/fpm.status.php
- https://supervisord.org/running.html
- https://dev.mysql.com/doc/refman/8.0/en/server-status-variables.html
- https://redis.io/docs/latest/commands/info/
- https://laravel.com/docs/11.x/deployment#the-health-route
- https://docs.sentry.io/product/sentry-basics/integrate-frontend/generate-first-error/
