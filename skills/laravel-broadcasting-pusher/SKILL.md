---
name: laravel-broadcasting-pusher
description: >-
  Laravel 11 event broadcasting over Pusher Channels: server setup
  (pusher/pusher-php-server, install:broadcasting, ShouldBroadcast events,
  channel authorization in routes/channels.php, queued broadcasts with the
  database queue) and client setup (laravel-echo + pusher-js in the React 18
  admin at resources/js/app.jsx). Trigger for: "broadcast an event", "real-time
  update", "Pusher", "Echo", "private channel", "presence channel",
  "/broadcasting/auth 403", "WebSocket notification", "live refresh in admin".
---

# Laravel 11 Broadcasting with Pusher

## Project conventions

- Laravel 11 app at repo root. **Laravel 11 layout**: no `BroadcastServiceProvider` —
  broadcasting is wired in `bootstrap/app.php`.
- Events live in `app/Events`, channel auth callbacks in `routes/channels.php`.
- `QUEUE_CONNECTION=database` — broadcasts are queued jobs in the `jobs` table.
  Jobs live in `app/Jobs`; a queue worker must be running (locally via Sail).
- Admin frontend: React 18 mounted from `resources/js/app.jsx`, built by Vite 6.
  Echo client code belongs next to it (e.g. `resources/js/echo.js`).
- Auth: Sanctum 4. The React admin is served by Blade and uses the normal
  session (`web` guard), so `/broadcasting/auth` works with session cookies.

## Server side

### 1. Enable broadcasting

```shell
composer require pusher/pusher-php-server
php artisan install:broadcasting
```

`install:broadcasting` creates `config/broadcasting.php` + `routes/channels.php`
and registers them in `bootstrap/app.php`. To customize the auth route's
middleware yourself (Laravel 11 style):

```php
// bootstrap/app.php
return Application::configure(basePath: dirname(__DIR__))
    ->withRouting(
        web: __DIR__.'/../routes/web.php',
        // ...
    )
    ->withBroadcasting(
        __DIR__.'/../routes/channels.php',
        ['middleware' => ['web']], // session-authenticated admin
    )
    // ...
```

For a token-authenticated SPA you would use
`['prefix' => 'api', 'middleware' => ['api', 'auth:sanctum']]` instead — not
needed for the Blade-served admin.

### 2. Environment

```dotenv
BROADCAST_CONNECTION=pusher

PUSHER_APP_ID="your-app-id"
PUSHER_APP_KEY="your-key"
PUSHER_APP_SECRET="your-secret"
PUSHER_APP_CLUSTER="eu"

VITE_PUSHER_APP_KEY="${PUSHER_APP_KEY}"
VITE_PUSHER_APP_CLUSTER="${PUSHER_APP_CLUSTER}"
```

`config/broadcasting.php` reads the `PUSHER_*` vars for the `pusher`
connection (`key`, `secret`, `app_id`, `options.cluster`, `options.useTLS`).
The `VITE_*` mirrors are what Vite exposes to the browser — Vite only exposes
vars prefixed `VITE_`. Changing them requires restarting `npm run dev` /
rebuilding, and `php artisan config:clear` after changing `PUSHER_*`.

### 3. Broadcast an event

```php
<?php

namespace App\Events;

use App\Models\Import;
use Illuminate\Broadcasting\InteractsWithSockets;
use Illuminate\Broadcasting\PrivateChannel;
use Illuminate\Contracts\Broadcasting\ShouldBroadcast;
use Illuminate\Foundation\Events\Dispatchable;
use Illuminate\Queue\SerializesModels;

class ImportFinished implements ShouldBroadcast
{
    use Dispatchable, InteractsWithSockets, SerializesModels;

    public function __construct(public Import $import) {}

    /** @return array<int, \Illuminate\Broadcasting\Channel> */
    public function broadcastOn(): array
    {
        return [
            new PrivateChannel('imports.'.$this->import->user_id),
        ];
    }

    public function broadcastAs(): string
    {
        return 'import.finished';
    }

    /** @return array<string, mixed> */
    public function broadcastWith(): array
    {
        return [
            'id' => $this->import->id,
            'status' => $this->import->status,
        ];
    }
}
```

- `broadcastOn()` returns an **array** of channels: `Channel` (public),
  `PrivateChannel`, or `PresenceChannel`.
- `broadcastAs()` is optional — without it the event name is the class name
  (`ImportFinished`). With it, the client must listen with a leading dot:
  `.import.finished` (the dot suppresses the namespace prefix).
- `broadcastWith()` is optional — without it, all public properties are
  serialized into the payload. Prefer an explicit payload; don't leak whole
  models to the browser.
- Dispatch as any event: `ImportFinished::dispatch($import);`. Use
  `broadcast(new ImportFinished($import))->toOthers();` to skip the tab that
  triggered the action (requires axios so the `X-Socket-ID` header is sent).

### 4. Channel authorization — `routes/channels.php`

```php
use App\Models\User;
use Illuminate\Support\Facades\Broadcast;

// Private: return bool
Broadcast::channel('imports.{userId}', function (User $user, int $userId) {
    return $user->id === $userId;
});

// Presence: return user data array (truthy = authorized)
Broadcast::channel('editing.{documentId}', function (User $user, int $documentId) {
    return $user->canEdit($documentId)
        ? ['id' => $user->id, 'name' => $user->name]
        : false;
});
```

Public channels need no entry here. Private/presence channels without a
matching callback → 403 on `/broadcasting/auth`.

### 5. Queue interaction (important with `QUEUE_CONNECTION=database`)

`ShouldBroadcast` events are **queued**, not sent inline. With the database
driver the broadcast sits in the `jobs` table and reaches Pusher only when a
worker runs:

```shell
php artisan queue:work        # sail artisan queue:work in dev
```

Symptom of a stopped worker: no event arrives, no error anywhere, rows pile up
in `jobs`. Check that table first when "broadcasting doesn't work".

Options:

- `ShouldBroadcastNow` — broadcast synchronously in the request (skips the
  queue). Fine for small payloads; adds Pusher HTTP latency to the request.
- Pin queue/connection per event with public properties on the event class:
  `public $connection = 'database'; public $queue = 'broadcasts';` — then make
  sure the worker consumes that queue (`queue:work --queue=broadcasts,default`).

## Client side — React 18 admin

### 1. Install and configure Echo

```shell
npm install laravel-echo pusher-js
```

```js
// resources/js/echo.js
import Echo from 'laravel-echo';
import Pusher from 'pusher-js';

window.Pusher = Pusher;

const echo = new Echo({
    broadcaster: 'pusher',
    key: import.meta.env.VITE_PUSHER_APP_KEY,
    cluster: import.meta.env.VITE_PUSHER_APP_CLUSTER,
    forceTLS: true,
});

export default echo;
```

Import it once in `resources/js/app.jsx` (`import echo from './echo';`).
Private channels authorize via POST `/broadcasting/auth` using the session
cookie + CSRF token — keep the `<meta name="csrf-token">` tag in the Blade
layout (Echo/axios picks it up).

### 2. Subscribe / leave in a React component

```jsx
import { useEffect, useState } from 'react';
import echo from '../echo';

export default function ImportStatus({ userId }) {
    const [status, setStatus] = useState(null);

    useEffect(() => {
        echo.private(`imports.${userId}`)
            .listen('.import.finished', (e) => setStatus(e.status));

        return () => {
            echo.leave(`imports.${userId}`); // unsubscribe on unmount
        };
    }, [userId]);

    return <span>{status ?? 'running…'}</span>;
}
```

- `echo.channel('name')` — public; `echo.private('name')` — private
  (channel name WITHOUT the `private-` prefix, Echo adds it);
  `echo.join('name')` — presence (`.here/.joining/.leaving/.listen`).
- `.listen('.import.finished', cb)` — leading dot because the event defines
  `broadcastAs()`. Without `broadcastAs()`, listen to `'ImportFinished'`
  (class name, no dot, no namespace).
- Always `echo.leave(...)` in the effect cleanup — otherwise re-renders stack
  duplicate handlers and dev StrictMode double-subscribes.

## End-to-end checklist (minimal example above)

1. Event `App\Events\ImportFinished` (`ShouldBroadcast`, `PrivateChannel('imports.{userId}')`).
2. Auth callback for `imports.{userId}` in `routes/channels.php`.
3. `ImportFinished::dispatch($import)` somewhere server-side (job, action, controller).
4. Queue worker running (`sail artisan queue:work`).
5. React: `echo.private('imports.' + userId).listen('.import.finished', ...)`.

## Common failure modes

| Symptom | Cause / fix |
|---|---|
| Nothing arrives, no errors | Queue worker not running — check `jobs` table, start `queue:work`. Or `BROADCAST_CONNECTION` still `log`/`null`. |
| 403 on `/broadcasting/auth` | Channel callback returns false; no callback for that channel name; user not authenticated on the `web` guard (session cookie missing → check `auth` state, CSRF 419 also surfaces here); channel name mismatch (don't include `private-` prefix in Echo or channels.php). |
| Connects but no events | Wrong event name in `.listen()` — leading dot vs class name (see `broadcastAs` rules); channel name typo. |
| WebSocket won't connect / 404 from Pusher | Wrong `cluster` — `VITE_PUSHER_APP_CLUSTER` must match the app's cluster in the Pusher dashboard (e.g. `eu`), and match `PUSHER_APP_CLUSTER`. |
| `import.meta.env.VITE_PUSHER_APP_KEY` undefined | Env var not prefixed `VITE_`, or Vite dev server/build not restarted after `.env` change. |
| Stale config after editing `.env` | `php artisan config:clear` (config may be cached). |
| Event fires for the sender's own tab too | Use `broadcast(...)->toOthers()` and send requests via axios (needs `X-Socket-ID`). |

Debugging aids: Pusher dashboard → Debug Console shows every message reaching
Pusher (separates server-side vs client-side problems); `pusher-js` verbose
logging via `Pusher.logToConsole = true;` in dev.

## Sources

- Laravel 11 broadcasting — https://laravel.com/docs/11.x/broadcasting
- Laravel events — https://laravel.com/docs/11.x/events
- Laravel Echo — https://laravel.com/docs/11.x/broadcasting#client-side-installation
- Pusher Channels docs — https://pusher.com/docs/channels/
- pusher-js client library — https://github.com/pusher/pusher-js
- pusher-http-php server library — https://github.com/pusher/pusher-http-php
