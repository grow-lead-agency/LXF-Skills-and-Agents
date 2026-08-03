---
name: php-fpm
description: >-
  PHP-FPM tuning, configuration, and troubleshooting for PHP 8.4 applications —
  focused on a Laravel 11 app served by nginx + PHP-FPM on a classic VM (with
  supervisor for queue workers). Covers: process manager choice
  (static/dynamic/ondemand), pool sizing math (pm.max_children vs RAM and
  memory_limit), OPcache tuning (JIT, preload, save_comments, deploy-time reset
  when releases switch via symlink), slow log, FPM status page and ping,
  graceful reload and zero-downtime deploys, nginx FastCGI integration
  (unix socket vs TCP), health checks, and supervisor-managed queue workers.
  Triggers: php-fpm, phpfpm, fpm tuning, fpm pool, pm.max_children,
  pm.start_servers, pm dynamic static ondemand, opcache, opcache tuning,
  opcache preload, opcache jit, php-fpm sizing, fpm workers, fpm slowlog,
  fpm status, fpm ping, nginx fpm, fastcgi, fastcgi_pass, unix socket fpm,
  tcp socket fpm, php performance, php memory, graceful reload fpm,
  pm.max_requests, request_terminate_timeout, fpm oom, oom killer php,
  opcache invalidation, opcache revalidate_freq, fpm listen queue,
  max children reached, cachetool, symlink deploy opcache.
  NOT for: Apache mod_php (legacy), FrankenPHP, RoadRunner, Octane/Swoole
  (mentioned only as alternatives).
---

# PHP-FPM Tuning — Laravel on nginx on a VM

**Scope:** PHP 8.4 FPM serving a Laravel 11 application behind nginx on a classic Linux VM,
with supervisor managing queue workers and Deployer handling symlink-based releases.
Everything here also applies to plain PHP or other frameworks with minor adjustments.

---

## 1. PHP-FPM overview

**FastCGI Process Manager (PHP-FPM)** is a PHP SAPI that manages a pool of persistent
PHP worker processes. The HTTP server (nginx) delegates PHP requests to FPM over the
FastCGI protocol.

### Role in the stack

```
HTTP client
    |
nginx (port 80/443, TLS termination, static assets)
    |  FastCGI (unix socket /run/php/php8.4-fpm.sock)
php-fpm master process
    |  fork
php-fpm workers (pm.max_children = N processes)
    |
Laravel app (HTTP kernel -> routing -> controllers -> Eloquent -> MySQL / Redis)
```

Alongside the web pool, **supervisor** runs long-lived CLI processes on the same VM:
`php artisan queue:work` workers and (optionally) `php artisan schedule:work` or a
cron entry for the scheduler. Those are *not* FPM workers — but they compete for the
same RAM, so they must be part of the sizing math (section 4).

### Why not Apache mod_php

- mod_php embeds PHP inside every Apache process — no independent worker pool control
- Higher memory overhead (the PHP module is always loaded, even for static files)
- FPM gives clean separation of concerns: nginx handles HTTP, FPM handles PHP

### Alternatives (know they exist, don't reach for them by default)

- **Laravel Octane** (Swoole/RoadRunner/FrankenPHP) — keeps the framework booted between
  requests; big throughput gains, but different memory-leak discipline and debugging model.
- **FrankenPHP** — single binary (Caddy + embedded PHP), worker mode, HTTP/3.
- **RoadRunner** — Go application server with PHP workers.

All of these change the operational model. nginx + PHP-FPM remains the boring,
well-understood default for a classic VM deployment.

---

## 2. Process managers (pm)

FPM supports three worker-management strategies:

### static

```ini
pm = static
pm.max_children = 12
```

- Starts exactly `max_children` workers and keeps them running
- No spawning overhead at runtime
- Most predictable memory footprint
- Best for **constant production load** on a dedicated VM

### dynamic

```ini
pm = dynamic
pm.max_children = 20
pm.start_servers = 4
pm.min_spare_servers = 2
pm.max_spare_servers = 6
```

- Keeps between `min_spare_servers` and `max_spare_servers` idle workers
- Spawns more under load, kills idle workers above the maximum
- The FPM default; good for **variable load** (staging, smaller shared VMs)

### ondemand

```ini
pm = ondemand
pm.max_children = 20
pm.process_idle_timeout = 10s
```

- Zero idle workers — spawns on incoming request
- Highest spawning overhead (cold start per burst)
- Good for **near-zero or very sporadic traffic** (dev boxes, rarely used vhosts)
- Not suitable for production (cold-start latency)

### Recommendation per environment

| Environment | pm | Reasoning |
|---|---|---|
| **Production** | `static` | Predictable footprint, no spawning overhead |
| **Staging** | `dynamic` | Lower idle memory, scales up under load tests |
| **Local dev** | `dynamic` or `ondemand` | Saves developer RAM |

Caveat: on a VM that also hosts MySQL/Redis, `dynamic` in production is a legitimate
choice — it keeps memory free for the database during quiet periods. Prefer `static`
once the database moves off-box or when RAM is clearly sufficient.

---

## 3. Pool configuration (www.conf)

Typical location on Debian/Ubuntu: `/etc/php/8.4/fpm/pool.d/www.conf`.
Production reference configuration:

```ini
[www]
; --- Process identity ---
user = www-data
group = www-data

; --- Socket (unix = faster than TCP, no network stack overhead) ---
listen = /run/php/php8.4-fpm.sock
listen.owner = www-data
listen.group = www-data
listen.mode = 0660

; --- Process manager ---
pm = static
pm.max_children = 12            ; see sizing math in section 4
pm.max_requests = 500           ; recycle worker after 500 requests (memory-leak hygiene)

; --- Timeouts ---
request_terminate_timeout = 30s ; force-kill worker after 30s (match nginx fastcgi_read_timeout)
request_slowlog_timeout = 5s    ; log requests slower than 5s
slowlog = /var/log/php/slow.log

; --- Logging ---
access.log = /var/log/php/fpm-access.log
catch_workers_output = yes            ; worker stderr -> FPM error log
decorate_workers_output = no          ; no [www] prefix (cleaner structured logs)

; --- Process limits ---
rlimit_files = 65535
rlimit_core = 0

; --- Status + health ---
pm.status_path = /fpm-status
ping.path = /fpm-ping
ping.response = pong
```

`process_control_timeout` is a global FPM directive, not a pool directive. Configure it
in `/etc/php/8.4/fpm/php-fpm.conf` when the default is not appropriate:

```ini
; how long a child waits to react to a master control signal
process_control_timeout = 60s
```

Staging variant (dynamic):

```ini
pm = dynamic
pm.max_children = 20
pm.start_servers = 4
pm.min_spare_servers = 2
pm.max_spare_servers = 6
pm.max_requests = 500
```

Make sure the log directory exists and is writable by the FPM user
(`install -d -o www-data -g www-data /var/log/php`), and add logrotate for it.

---

## 4. Sizing math (pm.max_children vs RAM)

`pm.max_children` is the single most important knob — too low means queued requests,
too high means the OOM killer takes down workers (or MySQL).

### Worksheet (example: 8 GB VM, colocated MySQL + Redis)

```
Total VM RAM:                       8192 MB
- MySQL (innodb_buffer_pool etc.):  2500 MB
- Redis (maxmemory + overhead):      600 MB
- nginx:                             100 MB
- supervisor + 4 queue workers:      600 MB   (~130-150 MB per Laravel worker)
- PHP-FPM master:                     40 MB
- OPcache shared memory:             192 MB   (opcache.memory_consumption)
- OS + page cache headroom:          800 MB
------------------------------------------
Available for FPM workers:         ~3360 MB

Memory per worker (Laravel 11, measured, RSS):
  - Freshly started:        ~40 MB
  - Steady state:           ~70-120 MB
  - Peak (heavy request):   ~150-200 MB

Conservative target: 120 MB per worker
pm.max_children = 3360 / 120 = 28  -> safe starting point: 20-24
```

**Always measure your own app** — package bloat, session handling and heavy responses
move the number a lot. Two hard rules:

1. `pm.max_children x memory_limit` must never exceed available RAM. With
   `memory_limit = 256M` and 20 workers, the theoretical worst case is 5 GB —
   acceptable only because workers rarely hit the limit; keep real headroom based on
   *measured* steady-state RSS, not on `memory_limit`.
2. Leave MySQL its buffer pool. Starving the database to run more PHP workers makes
   every request slower — the workers then live longer and you need even more of them.

### Measuring real worker footprint

```bash
# Average and max RSS of FPM workers, in MB
ps -o rss= -C php-fpm8.4 | awk '{s+=$1; if ($1>m) m=$1; n++} END {printf "avg %.0f MB, max %.0f MB, n=%d\n", s/n/1024, m/1024, n}'

# Or via the status page
curl -s "http://127.0.0.1/fpm-status?full" | grep -i "memory"
```

### The role of `pm.max_requests`

After serving `pm.max_requests` requests, the worker process **restarts**:

- PHP apps accumulate small memory leaks (container bindings, static caches, extensions)
- 500 is a sensible default (lower = more restart overhead, higher = more leak buildup)
- After restart the worker starts with clean memory; OPcache is shared memory and
  survives worker recycling — only a full FPM restart clears it

---

## 5. OPcache — the single biggest PHP performance win

OPcache stores compiled PHP bytecode in shared memory — files are parsed and compiled
once, not on every request. On a Laravel app this is typically a 3-10x throughput
difference. It must be deliberately configured, not left on defaults.

### Production configuration

```ini
; /etc/php/8.4/fpm/conf.d/99-opcache.ini
[opcache]
opcache.enable=1
opcache.enable_cli=0                  ; CLI (artisan, queue workers) does not need it

opcache.memory_consumption=192        ; MB of shared memory for bytecode
opcache.interned_strings_buffer=16    ; MB for interned strings
opcache.max_accelerated_files=20000   ; Laravel + vendor is typically 8-15k files
opcache.max_wasted_percentage=5       ; restart OPcache if >5% of memory is wasted

; PROD: files do not change between deploys -> skip stat() calls entirely
opcache.validate_timestamps=0
opcache.revalidate_freq=0

; Keep docblocks/attribute metadata in bytecode. Several packages read
; annotations/attributes via reflection — stripping comments breaks them.
opcache.save_comments=1

opcache.enable_file_override=0
opcache.use_cwd=1

; --- JIT (PHP 8.x) ---
opcache.jit_buffer_size=100M
opcache.jit=tracing                   ; profiles hot paths; best default for web apps
```

Local dev: set `opcache.validate_timestamps=1` (with `revalidate_freq=0`) so code
changes are picked up immediately.

### JIT notes

- `opcache.jit=tracing` — profiles hot code paths and compiles them to native code.
- JIT adds ~5-20% for CPU-heavy work (regex, hashing, serialization). For typical
  I/O-bound apps (DB + Redis calls) the gain is small — enable it, but don't expect
  miracles.

### Deploy-time reset with symlinked releases (Deployer)

This is the classic trap. With `opcache.validate_timestamps=0` OPcache never re-checks
files, **and** it caches entries by resolved (real) path. When Deployer switches the
`current` symlink to a new release:

- Old workers may keep serving bytecode from the previous release (symlink resolution
  is cached at multiple levels), or serve a mix of old and new files mid-deploy.
- Old release entries stay in shared memory as dead weight.

Two-part fix:

**1. nginx must resolve the symlink per request** — pass the *real* path to FPM so a
release switch means new cache keys, never a stale mix:

```nginx
fastcgi_param SCRIPT_FILENAME $realpath_root$fastcgi_script_name;
fastcgi_param DOCUMENT_ROOT   $realpath_root;
```

(`$realpath_root` instead of `$document_root` — this is the important part.)

**2. Reset OPcache as a deploy step**, after the symlink switch. Options, best first:

```php
// deploy.php (Deployer) — after('deploy:symlink', ...)

// Option A: cachetool talks to FPM over the socket — resets the *web* OPcache
task('opcache:reset', function () {
    run('{{bin/php}} {{deploy_path}}/cachetool.phar opcache:reset --fcgi=/run/php/php8.4-fpm.sock');
});

// Option B: graceful FPM reload — also clears OPcache, finishes in-flight requests
task('php-fpm:reload', function () {
    run('sudo systemctl reload php8.4-fpm');
});
```

Do **not** call `opcache_reset()` from an artisan/CLI command — CLI has its own
(or no) OPcache; it does not touch the FPM pool's shared memory. Reset must go
through the FPM socket (cachetool) or an FPM reload.

Also run the standard Laravel warmups in the release *before* the switch:

```bash
php artisan config:cache
php artisan route:cache
php artisan view:cache
php artisan event:cache
```

### Preloading (optional)

`opcache.preload` loads a chosen set of files into OPcache at FPM start, so even the
first request after a reload is warm:

```ini
opcache.preload=/var/www/app/current/preload.php
opcache.preload_user=www-data
```

Caveats: the preload script runs as part of FPM startup — a fatal error there prevents
FPM from starting, and changing preloaded code requires an FPM restart (reload is not
enough for preloaded files). Adopt it only after basic OPcache tuning is done and
measured; many Laravel apps skip it.

---

## 6. Status page and monitoring

### FPM status endpoint

FPM exposes status over FastCGI; nginx proxies it (locked down — see section 9):

```bash
curl -s "http://127.0.0.1/fpm-status?json" | jq
```

```json
{
  "pool": "www",
  "process manager": "static",
  "start since": 3600,
  "accepted conn": 15000,
  "listen queue": 0,           // KEY: requests waiting for a free worker
  "max listen queue": 2,
  "listen queue len": 511,
  "idle processes": 7,
  "active processes": 5,
  "total processes": 12,
  "max active processes": 10,
  "max children reached": 0,   // CRITICAL: >0 means the pool is undersized
  "slow requests": 3
}
```

### Key metrics and thresholds

| Metric | Alert condition | Action |
|---|---|---|
| `listen queue` | > 0 sustained for 5 min | Increase `pm.max_children` (if RAM allows) or scale the VM |
| `max children reached` | > 0 (ever, since start) | Pool undersized — investigate immediately |
| `active processes / total processes` | > 90% for 10 min | Load approaching capacity |
| `slow requests` | Rising trend | Diagnose slow endpoints via slow log / APM |

Scrape `?json` with whatever monitoring you run (Prometheus php-fpm exporter,
Zabbix, Netdata, a cron script shipping to your metrics backend). The exact shipper
does not matter; alert on the two critical signals: `listen queue` and
`max children reached`.

---

## 7. Slow log

The slow log captures a PHP stack trace of every request slower than
`request_slowlog_timeout` — it shows *where* PHP was stuck, with zero code changes.

```ini
[www]
slowlog = /var/log/php/slow.log
request_slowlog_timeout = 5s
request_slowlog_trace_depth = 20
```

Example output:

```
[23-Apr-2026 12:34:56]  [pool www] pid 4242
script_filename = /var/www/app/current/public/index.php
[0x00007f...] PDOStatement->execute() /var/www/app/current/vendor/laravel/framework/src/Illuminate/Database/Connection.php:414
[0x00007f...] Illuminate\Database\Connection->select() ...
```

Most common causes in a Laravel app:

- Slow SQL without an index (fix in MySQL, not in FPM)
- N+1 queries via Eloquent (add eager loading — `with()`)
- Synchronous calls to external APIs without a timeout (set explicit connect/request
  timeouts on the HTTP client; move slow work to queue jobs)

---

## 8. Graceful reload and zero-downtime deploys

### Signals

- **SIGUSR2** (what `systemctl reload php8.4-fpm` sends) — graceful reload: master
  re-reads config, workers finish the current request, then restart. Clears OPcache.
- **SIGQUIT** — graceful shutdown (workers finish current requests, then exit).
- **SIGTERM** — fast shutdown.
- `process_control_timeout` — how long a child process may take to react to a control
  signal from the master. It is not a request-drain or request-execution timeout.

Request execution is bounded separately by `request_terminate_timeout`. Shutdown and
service-manager drain limits belong in systemd/supervisor configuration and should be
longer than the longest request you intentionally allow to finish.

Rule of thumb: config changes and deploys use `reload`, never `restart`, unless you
changed something only a full restart picks up (e.g. `opcache.preload`, extension
ini files in some setups).

```bash
sudo php-fpm8.4 -t                    # config test first
sudo systemctl reload php8.4-fpm
```

### Queue workers under supervisor

Queue workers are long-lived CLI processes — a deploy does *not* automatically give
them new code. The standard sequence:

```bash
# As a deploy step, after the symlink switch:
php artisan queue:restart
```

`queue:restart` sets a flag in the cache; each worker finishes its current job and
exits; supervisor restarts it — now running the new release's code.

Supervisor program config that cooperates with this:

```ini
; /etc/supervisor/conf.d/laravel-worker.conf
[program:laravel-worker]
command=php /var/www/app/current/artisan queue:work redis --sleep=3 --tries=3 --max-time=3600
process_name=%(program_name)s_%(process_num)02d
numprocs=4
autostart=true
autorestart=true
user=www-data
stopasgroup=true
killasgroup=true
stopwaitsecs=120            ; must exceed your longest job runtime
stdout_logfile=/var/log/supervisor/laravel-worker.log
```

- `stopwaitsecs` — supervisor sends SIGTERM, waits this long, then SIGKILL. Laravel's
  worker handles SIGTERM by finishing the current job first — give it enough time.
- `--max-time=3600` — worker self-recycles hourly (memory hygiene), supervisor restarts it.
- `command=` points at `current/artisan` — the symlink, so restarts pick up new releases.

---

## 9. nginx integration

### Unix socket vs TCP

| | Unix socket | TCP (127.0.0.1:9000) |
|---|---|---|
| Performance | Faster (~10-20%) — no TCP overhead | Slower |
| Debugging | Slightly harder | Easier (`nc`, `curl`) |
| Same-host setup | Natural fit | Also fine |
| Recommendation | **Default on a single VM** | Use when FPM runs on another host/container |

### Server block (Laravel)

```nginx
upstream php_fpm {
    server unix:/run/php/php8.4-fpm.sock;
}

server {
    listen 80;
    server_name example.com;
    root /var/www/app/current/public;

    index index.php;
    client_max_body_size 16M;

    location / {
        try_files $uri $uri/ /index.php?$query_string;
    }

    location ~ ^/index\.php(/|$) {
        fastcgi_pass php_fpm;
        include fastcgi_params;
        # IMPORTANT with symlinked releases: use $realpath_root, not $document_root
        fastcgi_param SCRIPT_FILENAME $realpath_root$fastcgi_script_name;
        fastcgi_param DOCUMENT_ROOT $realpath_root;
        internal;

        fastcgi_buffering on;
        # Keep this >= request_terminate_timeout in the FPM pool.
        fastcgi_read_timeout 60s;
        fastcgi_send_timeout 60s;
        fastcgi_connect_timeout 5s;
    }

    location ~ \.php$ {
        # Block direct access to every other PHP file.
        return 404;
    }

    # --- FPM status + ping: localhost / monitoring only ---
    location = /fpm-status {
        access_log off;
        allow 127.0.0.1;
        deny all;
        fastcgi_pass php_fpm;
        include fastcgi_params;
        fastcgi_param SCRIPT_FILENAME $fastcgi_script_name;
    }

    location = /fpm-ping {
        access_log off;
        allow 127.0.0.1;
        deny all;
        fastcgi_pass php_fpm;
        include fastcgi_params;
        fastcgi_param SCRIPT_FILENAME $fastcgi_script_name;
    }
}
```

---

## 10. Health checks

Three layers, from cheapest to deepest:

1. **nginx alive** — TCP/HTTP check on `/` or a static file. Detects nginx, not PHP.
2. **FPM alive** — `/fpm-ping` returns `pong` straight from FPM. Detects a dead or
   saturated pool without booting the framework.
3. **Application healthy** — Laravel 11 ships a built-in health route: enable it in
   `bootstrap/app.php` (`->withRouting(..., health: '/up')`). It boots the framework
   and fires a `DiagnosingHealth` event you can listen to for DB/Redis checks.

Point uptime monitoring at `/up`; use `/fpm-ping` in load-balancer checks where you
want to detect a saturated pool quickly without paying the framework boot cost.

---

## 11. Troubleshooting common issues

### 1. `[pool www] server reached pm.max_children setting`

**Symptoms:** warning in FPM log, `max children reached > 0` in status, rising latency,
`listen queue > 0`.

**Causes and actions:**
- Load genuinely exceeds capacity — raise `pm.max_children` if RAM allows, else scale
- Slow queries blocking workers — check slow log, fix DB first
- External API calls without timeouts — a hung upstream can pin every worker; set timeouts
- Memory leak shrinking effective capacity — temporarily lower `pm.max_requests` to 200

### 2. OOM killer terminating workers (or MySQL)

**Symptoms:** `Killed` in logs, `dmesg | grep -i oom`, random 502s.

**Actions:**
1. Reduce `pm.max_children` — the sizing math (section 4) is violated somewhere
2. Check `opcache.memory_consumption` — 192-256 MB is plenty for most apps
3. Recount queue-worker memory (supervisor `numprocs` x worker RSS)
4. If MySQL got killed: the DB and PHP are fighting for RAM — shrink one or scale the VM

### 3. `opcache.max_accelerated_files` exhausted

**Detection:** query the cache from code executed by the FPM SAPI. A CLI process has a
separate cache (or none at all when `opcache.enable_cli=0`) and cannot inspect the FPM
shared cache.

Add a temporary Laravel route and restrict it to localhost at nginx before using it:

```php
use Illuminate\Support\Facades\Route;

Route::get('/_ops/opcache', function () {
    $status = opcache_get_status(false);
    abort_if($status === false, 503, 'FPM OPcache is disabled');

    return response()->json($status['opcache_statistics'] ?? []);
});
```

```nginx
location = /_ops/opcache {
    allow 127.0.0.1;
    allow ::1;
    deny all;
    try_files $uri /index.php?$query_string;
}
```

```bash
curl --fail --silent http://127.0.0.1/_ops/opcache | jq '{num_cached_scripts, max_cached_keys}'
```

Remove the temporary route after diagnosis.

**Action:** raise `opcache.max_accelerated_files` (e.g. to 30000). It only sizes a hash
table — negligible memory cost. Note: with symlinked releases, old + new release files
count double until the next reset — another reason for the deploy-time reset.

### 4. Unix socket permission denied (502 Bad Gateway)

**Symptoms:** nginx 502, error log: `connect() to unix:/run/php/php8.4-fpm.sock failed (13: Permission denied)`.

**Actions:**
- `listen.owner`/`listen.group` in `www.conf` must match the nginx user (typically `www-data`)
- `listen.mode = 0660`
- Confirm the socket path matches on both sides (`php-fpm` pool vs nginx `upstream`)

### 5. Stale code served after deploy

**Symptoms:** deploy "succeeded" but old behavior persists, or a mix of old/new (random
500s referencing classes that do not exist anymore).

**Checklist:**
- nginx uses `$realpath_root` (section 5/9)? If not, fix that first
- OPcache reset step ran after the symlink switch (cachetool or FPM reload)?
- `php artisan config:cache` re-ran in the new release (cached config is a file in the
  release; a stale shared/cached config path also causes this)?
- Queue workers restarted (`php artisan queue:restart`)? Workers keep old code otherwise

### 6. Intermittent 502 Bad Gateway

| Cause | Diagnosis | Fix |
|---|---|---|
| FPM worker crashed | FPM error log, segfault entries | Fix the crashing extension/code path; upgrade PHP |
| Socket missing | `ls -la /run/php/` | FPM not running / wrong path; check `systemctl status` |
| `fastcgi_read_timeout` < request duration | nginx error log: `upstream timed out` | Raise the timeout or fix the slow endpoint |
| FPM `request_terminate_timeout` fired | FPM log: `child ... exited on signal` / `terminated by timeout` | Raise the timeout or fix the endpoint; keep nginx timeout >= FPM timeout |

---

## 12. Advanced patterns

### Multiple FPM pools

Separate pools isolate workloads (e.g. a public site and an admin panel, or an API
with different limits):

```ini
[web]
listen = /run/php/fpm-web.sock
pm = static
pm.max_children = 12

[admin]
listen = /run/php/fpm-admin.sock
pm = ondemand
pm.max_children = 4
php_admin_value[memory_limit] = 512M
```

Each pool has its own status page, sizing and limits. For a single app on a single
VM, one pool is the right default — add pools only for a concrete isolation need.

### Containerized note

The same tuning applies inside containers with two adjustments: size
`pm.max_children` against the **container memory limit** (not host RAM), and run FPM
in the foreground as PID 1 (`php-fpm -F`) so SIGTERM from the orchestrator reaches the
master directly and graceful shutdown works. Deploys are then image swaps — fresh
containers start with an empty OPcache, so the symlink-reset problem disappears (and a
warmup/start period matters instead).

---

## 13. Capacity signals

| Signal | Action |
|---|---|
| `listen queue > 0` sustained for 5 min | Raise `pm.max_children` (RAM permitting) or scale the VM |
| `max children reached > 0` | Pool undersized — same as above, investigate now |
| p95 latency up while FPM idle workers > 0 | Not an FPM problem — look at MySQL/Redis/external APIs |
| Memory pressure / swap in use | Lower `pm.max_children`, recheck section 4 math, or add RAM |

---

## Sources

- [PHP-FPM Configuration Directives](https://www.php.net/manual/en/install.fpm.configuration.php)
- [OPcache Configuration](https://www.php.net/manual/en/opcache.configuration.php)
- [Laravel Deployment Guide](https://laravel.com/docs/11.x/deployment) (opcache, optimization commands)
- [Laravel Queues — Supervisor Configuration](https://laravel.com/docs/11.x/queues#supervisor-configuration)
- [Deployer Documentation](https://deployer.org/docs)
- [cachetool](https://github.com/gordalina/cachetool) — OPcache reset over the FPM socket
- [FrankenPHP Documentation](https://frankenphp.dev/)
