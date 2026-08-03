# Connection Lifecycle & Scaling

## Connection States

```
CONNECTING → CONNECTED → DISCONNECTED
                ↑              │
                └──────────────┘
              (reconnect with backoff)
```

### Supabase Channel States

| State | Meaning |
|-------|---------|
| `SUBSCRIBED` | Connected and receiving events |
| `TIMED_OUT` | Connection timed out |
| `CLOSED` | Channel closed (client or server) |
| `CHANNEL_ERROR` | Error during subscription |

```typescript
channel.subscribe((status, err) => {
  switch (status) {
    case 'SUBSCRIBED':
      console.log('Connected')
      break
    case 'TIMED_OUT':
      console.log('Timeout — will auto-retry')
      break
    case 'CLOSED':
      console.log('Closed')
      break
    case 'CHANNEL_ERROR':
      console.error('Error:', err)
      break
  }
})
```

### WebSocket ReadyState

| Value | Constant | Meaning |
|-------|----------|---------|
| 0 | `CONNECTING` | Connection not yet open |
| 1 | `OPEN` | Connection open, ready to communicate |
| 2 | `CLOSING` | Connection closing |
| 3 | `CLOSED` | Connection closed |

---

## Reconnection Strategy

### Exponential Backoff

```typescript
function getBackoffDelay(attempt: number, options?: {
  baseDelay?: number
  maxDelay?: number
  jitter?: boolean
}): number {
  const { baseDelay = 1000, maxDelay = 30_000, jitter = true } = options ?? {}
  const exponential = Math.min(baseDelay * 2 ** attempt, maxDelay)
  if (!jitter) return exponential
  // Add random jitter (0-100% of calculated delay)
  return Math.round(exponential * (0.5 + Math.random() * 0.5))
}

// Usage:
// Attempt 0: ~1s
// Attempt 1: ~2s
// Attempt 2: ~4s
// Attempt 3: ~8s
// Attempt 4: ~16s
// Attempt 5+: ~30s (capped)
```

### Supabase Client Reconnection

Supabase JS client handles reconnection automatically:
- WebSocket disconnects → client retries with backoff
- Token expires → call `supabase.realtime.setAuth('new-token')`
- Channel error → resubscribe

**Manual reconnection pattern (if needed):**

```typescript
function subscribeWithRetry(
  channelName: string,
  config: Parameters<typeof supabase.channel>[1],
  handlers: Array<{ event: string; callback: (payload: any) => void }>,
  maxRetries = 5
) {
  let retries = 0

  function connect() {
    const channel = supabase.channel(channelName, config)

    for (const { event, callback } of handlers) {
      channel.on('broadcast', { event }, callback)
    }

    channel.subscribe((status, err) => {
      if (status === 'SUBSCRIBED') {
        retries = 0
      } else if (status === 'CHANNEL_ERROR' && retries < maxRetries) {
        supabase.removeChannel(channel)
        const delay = getBackoffDelay(retries)
        retries++
        setTimeout(connect, delay)
      }
    })

    return channel
  }

  return connect()
}
```

---

## Heartbeat Patterns

### Client-Side Heartbeat (WebSocket)

```typescript
function startHeartbeat(ws: WebSocket, intervalMs = 30_000) {
  const timer = setInterval(() => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'ping', timestamp: Date.now() }))
    }
  }, intervalMs)

  return () => clearInterval(timer)
}
```

### DO-Side Heartbeat via Alarm

```typescript
export class RealtimeRoom extends DurableObject {
  async startHeartbeat() {
    await this.ctx.storage.setAlarm(Date.now() + 30_000)
  }

  async alarm() {
    // Broadcast heartbeat to all clients
    for (const ws of this.ctx.getWebSockets()) {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'heartbeat', timestamp: Date.now() }))
      }
    }
    // Reschedule
    if (this.ctx.getWebSockets().length > 0) {
      await this.ctx.storage.setAlarm(Date.now() + 30_000)
    }
  }
}
```

### Note on CF Durable Objects

Cloudflare runtime **automatically handles WebSocket protocol ping/pong** without waking the DO.
You can also use `setWebSocketAutoResponse` for application-level ping/pong.
Server-side heartbeat via alarm is for **application-level liveness** (e.g., broadcasting a timestamp).

---

## Scaling Patterns

### 1. Supabase Realtime — When to Use What

| Use Case | Connections | Best Approach |
|----------|-------------|---------------|
| Live dashboard (few viewers) | <100 | Postgres Changes directly |
| Chat room | 100-1000 | Broadcast channels |
| Live cursors / collaboration | 10-50 per doc | Broadcast + Presence |
| High-volume event stream | >1000 | Broadcast from DB (bypass RLS bottleneck) |
| Notifications | Any | Broadcast via REST (fire-and-forget) |

### 2. Durable Objects — Scaling Model

```
                     ┌─── DO "room:abc" ← 500 clients
                     │
Worker (edge) ───────┼─── DO "room:def" ← 500 clients
                     │
                     └─── DO "room:ghi" ← 500 clients
```

- Each DO = single-threaded, co-located compute + storage
- Route by entity ID → natural sharding
- Millions of DOs worldwide, each processing independently

### 3. Fan-Out for Large Audiences

When a single DO can't handle all connections:

```
Coordinator DO (receives updates)
├── Relay DO "shard-1" (500 clients)
├── Relay DO "shard-2" (500 clients)
└── Relay DO "shard-3" (500 clients)
```

### 4. Hybrid Pattern: Supabase + DO

```
DB change → Supabase Realtime → Server-side listener
                                      │
                                      ▼
                              CF Worker receives change
                                      │
                                      ▼
                              DO processes + enriches
                                      │
                                      ▼
                              Broadcast to WebSocket clients
```

Use Supabase for DB change detection, DOs for custom processing/routing logic.

---

## Common Gotchas

### Duplicate Events

- **Cause:** Component re-renders creating multiple subscriptions
- **Fix:** Always clean up in useEffect return. Use unique channel names.
- **Detection:** Log subscription count, check for doubled messages

### Message Ordering

- **Supabase Postgres Changes:** Ordered by WAL position (consistent within a table)
- **Supabase Broadcast:** No guaranteed ordering across clients
- **DO WebSocket:** Ordered per-client, but broadcast order across clients is non-deterministic
- **Fix:** Include sequence numbers or timestamps in payloads, reconcile on client

### Stale Subscriptions After Token Refresh

```typescript
// After refreshing auth token, update Realtime
supabase.realtime.setAuth('new-token')
```

### DO In-Memory State Loss on Hibernation

```typescript
// BAD — lost on hibernation
constructor(ctx, env) {
  super(ctx, env)
  this.counter = 0 // reset to 0 after wake-up!
}

// GOOD — restore from storage or attachments
constructor(ctx, env) {
  super(ctx, env)
  // Restore from WebSocket attachments
  this.sessions = new Map()
  this.ctx.getWebSockets().forEach((ws) => {
    this.sessions.set(ws, ws.deserializeAttachment())
  })
}
```

### Channel Name Collision

```typescript
// BAD: Two components using same channel name
supabase.channel('updates') // shared state, duplicate handlers

// GOOD: Namespace channels
supabase.channel('updates:orders')
supabase.channel('updates:users')
```

### Supabase Realtime Publication Missing

```
// Symptom: subscribed but no events arrive
// Fix: ensure table is in the publication
ALTER PUBLICATION supabase_realtime ADD TABLE your_table;
```
