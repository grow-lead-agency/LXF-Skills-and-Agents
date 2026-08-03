---
name: laravel-file-transfer
description: >-
  Build and review feed or document transfer in Laravel 11 with Storage and
  league/flysystem-sftp-v3: SFTP disks, key authentication, streaming large
  files, atomic delivery, idempotent imports, database-queued jobs, locks,
  retries, failure reporting, and Storage::fake tests. Trigger on SFTP, feed
  import/export, partner file exchange, readStream, writeStream, remote archive,
  transfer retry, or large document delivery.
---

# Laravel feed and document transfer

Target Laravel 11 and `league/flysystem-sftp-v3` 3.x. Keep the Composer major
constraint at `^3.0` and the exact resolved package version in `composer.lock`.
Use Laravel's `Storage` disks as the application boundary so the same workflow
can run against SFTP, local storage, or an S3-compatible service.

## Project conventions

- The Laravel 11 app is at the repository root; configure disks in
  `config/filesystems.php` and secrets through environment variables.
- Put transfer orchestration in `app/Services` or `app/Pipelines`, one-off
  operations in `app/Actions`, and queued imports/exports in `app/Jobs`.
- The default queue connection is `database`; workers are managed by Supervisor
  in production. Keep slow network I/O outside database transactions.
- Define schedules in `routes/console.php` using Laravel 11's scheduler API.
- Put transfer run models in `app/Models`, status enums in `app/Enums`, and tests
  in `tests/Unit` / `tests/Feature` with PHPUnit 11.
- Keep received feeds and generated documents outside `public/`; publish only an
  explicit download endpoint or URL when required.

## Configure an SFTP disk

The adapter is already part of the platform stack. For a fresh installation,
Laravel 11 documents this exact major requirement:

```shell
composer require league/flysystem-sftp-v3 "^3.0"
```

Configure one disk per partner or trust boundary:

```php
// config/filesystems.php
'partner_sftp' => [
    'driver' => 'sftp',
    'host' => env('PARTNER_SFTP_HOST'),
    'port' => (int) env('PARTNER_SFTP_PORT', 22),
    'username' => env('PARTNER_SFTP_USERNAME'),

    // Key authentication (preferred):
    'privateKey' => env('PARTNER_SFTP_PRIVATE_KEY'),
    'passphrase' => env('PARTNER_SFTP_PASSPHRASE'),

    // Password authentication (alternative; avoid fallback unless required):
    // 'password' => env('PARTNER_SFTP_PASSWORD'),

    'root' => env('PARTNER_SFTP_ROOT', ''),
    'timeout' => (int) env('PARTNER_SFTP_TIMEOUT', 30),
    'maxTries' => (int) env('PARTNER_SFTP_MAX_TRIES', 4),
    'hostFingerprint' => env('PARTNER_SFTP_HOST_FINGERPRINT'),
    'visibility' => 'private',
    'directory_visibility' => 'private',
    'throw' => true,
],
```

Use a dedicated least-privileged SFTP account and a passphrase-protected key.
Prefer a deployed private-key file outside the repository for `privateKey`; the
adapter can also accept key material, which must still come from the deployment
secret store and never tracked config. Keep the passphrase, password, and host
details in the deployment secret store / `.env`, never in Git. Choose either
key or password authentication unless the partner explicitly requires a
reviewed fallback sequence.

Pin `hostFingerprint` from a value verified with the partner through a separate
channel. Do not auto-accept a new host key after a connection error. Restrict
`root` to the partner's exchange directory and choose a timeout shorter than the
job timeout.

Set `throw => true` for operational disks so Laravel rethrows Flysystem failures
instead of returning `false`. Catch specific failures when behavior differs, or
the `League\Flysystem\FilesystemException` marker for common reporting.

## Use Storage operations for normal files

Paths are always relative to the configured disk root:

```php
use Illuminate\Support\Facades\Storage;

$disk = Storage::disk('partner_sftp');

$disk->exists('incoming/feed.csv');
$disk->size('incoming/feed.csv');
$disk->lastModified('incoming/feed.csv');
$disk->files('incoming');
$disk->copy('outgoing/document.pdf', 'archive/document.pdf');
$disk->move('outgoing/document.pdf.part', 'outgoing/document.pdf');
$disk->delete('incoming/obsolete.csv');
```

Flysystem move/copy operations overwrite the destination. Check destination
state first when overwriting would destroy evidence or violate idempotency.

## Stream large files

Never call `file_get_contents()` or `Storage::get()` for a multi-gigabyte feed.
`readStream(string $path)` returns a resource or `null`; `writeStream(string
$path, resource $resource, array $options = [])` returns `bool` in Laravel 11.
Always close a stream you opened or received.

Stage an inbound SFTP feed to a local private disk before parsing it. This keeps
a flaky network connection out of a long parser transaction:

```php
$remote = Storage::disk('partner_sftp');
$local = Storage::disk('local');
$remotePath = 'incoming/orders-2026-08-03.csv';
$stagedPath = 'imports/staging/orders-2026-08-03.csv';

$stream = $remote->readStream($remotePath);

if (!is_resource($stream)) {
    throw new RuntimeException("Unable to open remote stream: {$remotePath}");
}

try {
    if (!$local->writeStream($stagedPath, $stream)) {
        throw new RuntimeException("Unable to stage import: {$stagedPath}");
    }
} finally {
    fclose($stream);
}
```

For exports, generate to a local staging file as a stream, calculate size and
SHA-256 there, then open it with `readStream()` and upload with `writeStream()`.
Do not hold the complete CSV, XML, PDF, or ZIP in a PHP string.

## Publish atomically

Use a consumer-visible two-phase delivery:

1. Generate and checksum the complete file locally.
2. Upload to a unique path such as
   `.tmp/{final-name}.{transfer-id}.part` on the destination disk.
3. Verify the remote size. If the adapter/server cannot provide a checksum,
   retain the local SHA-256 in the transfer record or manifest; a remote hash
   requires a partner-specific capability or a read-back.
4. If the final path already exists, compare it with the recorded transfer and
   treat an exact match as success; otherwise stop instead of overwriting.
5. Move the temporary file to the final path on the same SFTP disk.
6. Write a small `{final-name}.ready` or manifest marker last when the receiver
   supports markers. Consumers process only final files with a ready marker.

A same-server SFTP rename is the intended atomic publish boundary, but atomicity
depends on the target server and filesystem. Verify it during partner onboarding.

<!-- TODO-verify: Confirm the target partner SFTP server performs same-directory
rename atomically and permits the .tmp/ and processed/ directory layout before
depending on rename as the delivery commit point. -->

If the move fails, leave the uniquely named `.part` file for a later retry or
cleanup job; never present it as complete. A retry may resume by validating that
temporary object or upload a new transfer ID.

## Make import runs idempotent

Represent each discovery/import as a durable transfer run. Store at least:
partner, direction, remote path, remote size/mtime, local staged path, SHA-256,
status, attempt count, discovered/started/completed timestamps, archive path,
and a sanitized error code/message.

Use this sequence:

1. Discover only eligible final files. Prefer a partner-written `.ready` marker;
   otherwise require size and modification time to remain unchanged across two
   polls before claiming a file.
2. Claim a run using a database uniqueness rule such as partner + direction +
   remote path + source checksum. Do not rely only on a filename.
3. Stream to local staging while tracking bytes; compute SHA-256 on the completed
   local file and verify expected size before parsing.
4. If a completed run with the same checksum exists, record a duplicate outcome
   and skip domain writes.
5. Parse and apply domain changes inside appropriately small database
   transactions. Use domain-level idempotency keys for orders/documents too.
6. Mark the transfer complete only after every required domain write succeeds.
7. Then move the remote source and marker to
   `processed/YYYY/MM/DD/`, or write a processed marker. Keep an audit retention
   period; do not delete the only source immediately.
8. Move permanently invalid content to `failed/` or `quarantine/` with a safe
   report. Do not archive transient connection failures as processed.

Use explicit states such as `discovered`, `downloading`, `staged`, `processing`,
`completed`, `duplicate`, `retryable_failed`, and `permanent_failed`. State
transitions make partial recovery observable and prevent a retry from repeating
already committed work.

## Queue and schedule transfers

Run imports/exports as Laravel 11 queued jobs on the database connection. The job
middleware lock is the worker-concurrency guard; the durable transfer record is
the replay/idempotency guard.

```php
<?php

namespace App\Jobs;

use App\Services\Transfers\FeedTransferService;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Queue\Queueable;
use Illuminate\Queue\Middleware\WithoutOverlapping;
use Throwable;

final class ImportPartnerFeed implements ShouldQueue
{
    use Queueable;

    // Requires database queue retry_after to be greater than 900 seconds.
    public int $tries = 8;
    public int $timeout = 900;

    public function __construct(
        public readonly string $partner,
        public readonly string $remotePath,
    ) {}

    /** @return list<int> */
    public function backoff(): array
    {
        return [30, 120, 300, 900];
    }

    /** @return list<object> */
    public function middleware(): array
    {
        $key = 'sftp:import:'.$this->partner.':'.hash('sha256', $this->remotePath);

        return [
            (new WithoutOverlapping($key))
                ->releaseAfter(60)
                ->expireAfter(1200),
        ];
    }

    public function handle(FeedTransferService $service): void
    {
        $service->import($this->partner, $this->remotePath);
    }

    public function failed(?Throwable $exception): void
    {
        // Mark the durable run failed and notify operations; never log secrets.
    }
}
```

Laravel 11's application skeleton defaults the database connection's
`retry_after` to 90 seconds. This large-transfer example therefore requires
`DB_QUEUE_RETRY_AFTER` (or the equivalent `config/queue.php` value) to be raised
above 900 seconds; otherwise another worker may receive the job while it is
still running.

The lock uses Laravel's cache store; all workers must share a store that supports
atomic locks. The platform's database cache is acceptable when all workers share
that database and the cache table is present. Set `expireAfter()` longer than the
maximum credible job runtime so a crashed worker cannot leave a permanent lock.
Overlapping jobs released back to the queue consume attempts, so allow enough
`$tries` for expected contention or choose `dontRelease()` when a later scheduled
discovery will safely recreate the work. Use `shared()` when different job
classes must share the same lock key.

Schedule job discovery/dispatch in `routes/console.php`:

```php
use App\Jobs\DiscoverPartnerImports;
use Illuminate\Support\Facades\Schedule;

Schedule::job(new DiscoverPartnerImports('partner-a'))
    ->everyFiveMinutes()
    ->withoutOverlapping();
```

The scheduler lock avoids duplicate scheduler executions; every per-file job
still needs `WithoutOverlapping` and database idempotency.

## Retry only transient failures

Retry timeouts, connection resets, temporary DNS failures, and server-side
availability errors with backoff and jitter where the surrounding service
supports it. Keep adapter `maxTries` small; job-level retries provide the durable
backoff and observability boundary.

Do not retry invalid credentials, host-fingerprint mismatches, permission
denials, unsupported paths, schema errors, checksum mismatches, or a conflicting
final file without operator action. Keep the SFTP connection timeout below the
job timeout, and keep the job/worker timeout several seconds below the queue
connection's `retry_after`; otherwise another worker may retry a job that is
still running.

## Handle and report partial failures

- Update the transfer run after every durable boundary: discovered, staged,
  domain commit, final publish, remote archive.
- Preserve the local staged file and remote `.part` path for retry or forensic
  review; attach retention/cleanup rules.
- Record byte counts, expected/actual size, SHA-256, remote path, transfer ID,
  attempt, duration, and sanitized exception class/message.
- Never log passwords, private keys, passphrases, full documents, or sensitive
  feed rows.
- Emit an application event or notification for permanent failure and expose a
  run status to administrators. Include a safe next action: retry, replace
  credentials, correct source data, or resolve a destination conflict.
- Reconcile periodically: stale `.part` files, runs stuck in non-terminal states,
  completed local runs whose remote archive move failed, and orphan ready
  markers.

With `throw => true`, catch `UnableToReadFile`, `UnableToWriteFile`, or
`UnableToMoveFile` when the operation changes recovery behavior. Catch the
`FilesystemException` interface for common transfer reporting, preserving the
previous exception for internal diagnostics.

## Test without SFTP

Replace the configured disk with a fake in PHPUnit:

```php
use Illuminate\Support\Facades\Storage;

public function test_export_is_published_with_ready_marker(): void
{
    Storage::fake('partner_sftp');
    Storage::fake('local');

    $this->app->make(FeedTransferService::class)->export('partner-a', 42);

    Storage::disk('partner_sftp')->assertExists('outgoing/orders-42.csv');
    Storage::disk('partner_sftp')->assertExists('outgoing/orders-42.csv.ready');
    Storage::disk('partner_sftp')->assertDirectoryEmpty('.tmp');
}
```

Add cases for duplicate imports, retry after a staged download, conflicting
final files, checksum mismatch, parser failure before remote archive, and a
permanent failure report. Use `Queue::fake()` only to test dispatch; call the job
or service normally when testing transfer behavior.

For adapter-neutral integration tests, define two `local` disks rooted in test
directories and run the same stream/move/archive workflow. A local disk catches
path and state-machine errors without credentials. Keep any real-SFTP smoke test
opt-in, isolated from normal CI, and pointed at a disposable account.

## Other disks

- Local: the same stream, checksum, marker, idempotency, and archive patterns
  apply. A rename is atomic only within the same filesystem.
- S3-compatible: keep the Storage API, but do not assume `move()` is atomic;
  object stores commonly implement move as copy then delete. Stream to a unique
  versioned object and publish a small manifest/ready marker last. Verify
  multipart thresholds against the installed S3 adapter/SDK when files are large.
- Cross-disk transfer: `move()` operates within one disk. Stream between two
  disks and treat the destination marker as the commit point.

Design the transfer state machine around capabilities, not the SFTP adapter, so
changing the disk does not change domain idempotency or reporting.

## Sources

- Laravel 11 file storage, SFTP configuration, streams, failed writes, and
  `Storage::fake()` — https://laravel.com/docs/11.x/filesystem
- Laravel 11 filesystem contract (`readStream`, `writeStream`, `move`) —
  https://api.laravel.com/docs/11.x/Illuminate/Contracts/Filesystem/Filesystem.html
- Laravel 11 queues, retries, timeouts, and `WithoutOverlapping` —
  https://laravel.com/docs/11.x/queues
- Laravel 11 application queue defaults (`retry_after`) —
  https://github.com/laravel/laravel/blob/11.x/config/queue.php
- Laravel 11 `WithoutOverlapping` API —
  https://api.laravel.com/docs/11.x/Illuminate/Queue/Middleware/WithoutOverlapping.html
- Laravel 11 task scheduling — https://laravel.com/docs/11.x/scheduling
- Flysystem SFTP v3 adapter setup —
  https://flysystem.thephpleague.com/docs/adapter/sftp-v3/
- Flysystem filesystem API and streaming —
  https://flysystem.thephpleague.com/docs/usage/filesystem-api/
- Flysystem exception handling —
  https://flysystem.thephpleague.com/docs/usage/exception-handling/
