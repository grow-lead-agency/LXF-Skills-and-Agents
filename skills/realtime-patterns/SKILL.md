---
name: realtime-patterns
description: |
  Realtime and WebSocket patterns for a Supabase + Cloudflare stack: Supabase Realtime (Postgres Changes,
  Broadcast, Presence) + Cloudflare Durable Objects (WebSocket Hibernation, Alarms, state).
  Client-side React subscription patterns, connection lifecycle, reconnection, scaling.
  Triggers: realtime, websocket, supabase realtime, postgres changes, broadcast, presence,
  durable objects, websocket hibernation, live updates, real-time, subscription, channel,
  WebSocket server, connection lifecycle, reconnect, heartbeat.
---

# Realtime Patterns

Specialist knowledge for building realtime features on a Supabase + Cloudflare stack.

## Stack

| Layer | Technology | Purpose |
|-------|-----------|---------|
| DB change streams | Supabase Realtime — Postgres Changes | Listen to INSERT/UPDATE/DELETE on Postgres tables |
| Low-latency messaging | Supabase Realtime — Broadcast | Client-to-client or server-to-client messages |
| User state sync | Supabase Realtime — Presence | Track who's online, typing indicators, cursor positions |
| Custom realtime logic | Cloudflare Durable Objects | WebSocket server with stateful compute, hibernation |
| Scheduled wake-ups | DO Alarms API | Timer-based triggers for DOs (heartbeat, cleanup, batching) |
| Client framework | React (useEffect, refs) | Subscription lifecycle, cleanup, reconnection |

## Decision Tree: Which Realtime Primitive?

```
Need realtime?
├─ Listening to DB row changes? → Supabase Postgres Changes
│   ├─ Need RLS filtering? → Yes, enable RLS + publication
│   ├─ High throughput (>100 changes/s)? → Use Broadcast from DB instead
│   └─ Need old record on UPDATE/DELETE? → ALTER TABLE ... REPLICA IDENTITY FULL
│
├─ Sending messages between clients? → Supabase Broadcast
│   ├─ Need persistence/replay? → Broadcast from Database + replay config
│   ├─ Fire-and-forget from server? → REST API broadcast (no WS needed)
│   └─ Need delivery confirmation? → Set ack: true
│
├─ Tracking online users / shared state? → Supabase Presence
│   └─ Custom presence key? → config.presence.key
│
└─ Need custom server-side logic?
    ├─ Stateful coordination (game rooms, collab editing) → Durable Objects
    ├─ Need to survive idle periods? → WebSocket Hibernation API (recommended)
    ├─ Need periodic tasks? → DO Alarms API
    └─ Simple pub/sub without state? → Supabase Broadcast is simpler
```

## Reference Index

| File | Content |
|------|---------|
| [react-subscription-patterns.md](references/react-subscription-patterns.md) | useEffect cleanup, reconnection hooks, React patterns |
| [connection-lifecycle.md](references/connection-lifecycle.md) | Connect, reconnect, backoff, heartbeat, scaling |
| [sources.md](references/sources.md) | All research URLs used |

## Workflow: Adding Realtime to a Feature

1. **Choose primitive** — use decision tree above
2. **Check references** — read the relevant reference file for API details
3. **Enable prerequisites**:
   - Postgres Changes: add table to `supabase_realtime` publication, enable RLS
   - Broadcast from DB: create RLS policy on `realtime.messages`, create trigger function
   - Durable Objects: add binding + migration in `wrangler.jsonc`
4. **Implement server-side** (if DO) — use Hibernation API pattern from reference
5. **Implement client-side** — follow React patterns from reference (cleanup!)
6. **Add reconnection** — exponential backoff, see connection-lifecycle reference
7. **Test** — verify cleanup on unmount, test reconnection, check for duplicate events

## What NOT to Do

- **Don't skip useEffect cleanup** — stale subscriptions cause memory leaks and duplicate events
- **Don't use `*` wildcard on high-traffic tables** — filter by table + event type
- **Don't store large payloads in Broadcast** — keep messages small, fetch full data separately
- **Don't use standard WebSocket API on DOs** — always use Hibernation API (saves cost)
- **Don't forget `supabase_realtime` publication** — Postgres Changes won't work without it
- **Don't use Postgres Changes for high-throughput** — use Broadcast from DB instead (single-threaded bottleneck)
- **Don't rely on message ordering** — design for idempotency, use sequence numbers if needed
- **Don't serialize large objects in DO attachments** — max 2,048 bytes, use Storage API for bigger data
- **Don't create one channel per row** — use filters instead (channel per entity type, filter by ID)
