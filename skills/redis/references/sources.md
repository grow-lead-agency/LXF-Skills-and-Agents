# Research Sources — Redis

## 2026-04-05 — Initial creation

- https://redis.io/docs/latest/develop/ — Redis developer documentation hub
- https://redis.io/docs/latest/develop/data-types/ — All Redis data types overview (String, Hash, List, Set, Sorted Set, Stream, JSON, Vector Set, HyperLogLog, Bitmap, Geo, Time Series, probabilistic)
- https://redis.io/docs/latest/commands/ — Complete Redis command reference
- https://redis.io/docs/latest/develop/clients/nodejs/ — Node.js client documentation (node-redis)
- https://github.com/redis/ioredis — ioredis GitHub repo, API docs, clustering, pipelining
- https://github.com/redis/ioredis/blob/master/API.md — ioredis full API reference
- https://redis.io/docs/latest/develop/data-types/streams/ — Redis Streams documentation
- https://redis.io/docs/latest/develop/programmability/ — Lua scripting and Redis Functions
- https://redis.io/docs/latest/operate/oss_and_stack/management/optimization/memory-optimization/ — Memory optimization guide
- https://redis.io/docs/latest/operate/oss_and_stack/management/persistence/ — RDB and AOF persistence
- https://redis.io/docs/latest/operate/oss_and_stack/management/sentinel/ — Redis Sentinel for HA
- https://redis.io/docs/latest/operate/oss_and_stack/management/scaling/ — Redis Cluster scaling
- https://redis.io/docs/latest/develop/interact/pubsub/ — Pub/Sub documentation
- https://hub.docker.com/_/redis — Official Redis Docker image
- https://valkey.io/ — Valkey (Linux Foundation Redis fork, BSD-3)

## 2026-07-15 — Delta refresh (Context7 + web verification)

Checked: Redis 8.x status + license development, data types/command claims, ioredis/node-redis
API surface. Verdict: **1 drift found and fixed** — license row said "SSPL (v7.4+)" only;
Redis Ltd. re-added AGPLv3 as a licensing option for Redis 8+ in May 2025 (reversal of the
March 2024 RSAL/SSPL-only move). Redis is now triple-licensed (RSALv2 / SSPLv1 / AGPLv3).
Everything else (data types, ioredis/node-redis API, pub/sub, streams, Lua, persistence,
memory optimization, key naming) verified current, no drift.

- https://redis.io/tutorials/what-is-redis — confirms triple-license (RSALv2/SSPLv1/AGPLv3) since Redis 8, BSDv3 for ≤7.2 (via Context7 `/llmstxt/redis_io_llms_txt`)
- https://redis.io/open-source — Redis Open Source current release = Redis 8.8 (480+ commands, 18 data structures) (via Context7)
- https://redis.io/cloud — Redis Cloud built on Redis 8 (via Context7)
