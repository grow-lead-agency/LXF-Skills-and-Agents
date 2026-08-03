# Research Sources: realtime-patterns

> Log of ALL URLs used during research, creation, and updates of this skill.
> Newest entries first. See CLAUDE.md §3 for format requirements.

## 2026-03-31 — Initial creation (v1.0.0)

### Supabase Realtime
- https://supabase.com/docs/guides/realtime — Overview of Realtime features (Broadcast, Presence, Postgres Changes)
- https://supabase.com/docs/guides/realtime/postgres-changes — Postgres Changes API, filters (eq/neq/lt/gt/in), RLS, replica identity, custom tokens, performance/throughput table
- https://supabase.com/docs/guides/realtime/broadcast — Broadcast via client libs/REST/database, realtime.send(), realtime.broadcast_changes(), replay, ack, self-send
- https://supabase.com/docs/guides/realtime/presence — Presence sync/join/leave events, track/untrack, presence key, gotchas with sync event
- https://supabase.com/docs/guides/realtime/authorization — Channel authorization, RLS on realtime.messages (referenced from Broadcast docs)

### Cloudflare Durable Objects
- https://developers.cloudflare.com/durable-objects/ — DO overview, features, pricing links
- https://developers.cloudflare.com/durable-objects/best-practices/websockets/ — WebSocket Hibernation API, standard API, handler methods, serializeAttachment/deserializeAttachment, message batching, wrangler config
- https://developers.cloudflare.com/durable-objects/examples/websocket-hibernation-server/ — Full WebSocket Hibernation example (JS/TS/Python), session management, auto-response, broadcast patterns
- https://developers.cloudflare.com/durable-objects/api/alarms/ — Alarms API: setAlarm, getAlarm, deleteAlarm, alarm handler, retry/backoff, multi-event scheduling pattern

## Initial Creation (2026-03-31)

*Created based on official Supabase Realtime documentation and Cloudflare Durable Objects documentation. React patterns derived from Supabase client library conventions and standard React hooks patterns.*
