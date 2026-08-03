---
name: redis
description: >-
  Redis in-memory data store — data types, commands, Node.js clients (ioredis/node-redis),
  pub/sub, streams, Lua scripting, pipelining, transactions, clustering, sentinel,
  persistence (RDB/AOF), memory optimization, key expiration patterns, Docker setup,
  Redis Cloud, performance tuning, and production best practices.
  Triggers: redis, redis cache, ioredis, node-redis, redis pub/sub, redis streams,
  redis cluster, redis sentinel, redis lua, redis pipeline, redis transactions,
  redis persistence, redis docker, redis cloud, redis memory, redis key expiration,
  redis session, redis rate limiting, redis leaderboard, redis geospatial.
  NE pro: BullMQ job queues, Cloudflare KV, ElastiCache specifika.
---

# Redis Master

Production-grade Redis: data types, Node.js clients, pub/sub, streams, clustering,
persistence, Lua scripting, and performance tuning. Audience: developer who knows Redis
basics and needs production patterns + Node.js integration.

## Reference Files

| Topic | File |
|-------|------|
| Data types + command patterns | `references/data-types-commands.md` |
| Node.js clients (ioredis + node-redis) | `references/nodejs-clients.md` |
| Pub/Sub, Streams, Lua scripting | `references/pubsub-streams-lua.md` |
| Clustering, Sentinel, Replication | `references/clustering-ha.md` |
| Persistence, memory, performance | `references/persistence-performance.md` |
| Common patterns (caching, sessions, rate limiting) | `references/patterns.md` |

## Quick Routing

```
Connecting from Node.js?        → references/nodejs-clients.md
Which data type to use?          → references/data-types-commands.md
Pub/Sub or Streams?              → references/pubsub-streams-lua.md
Cluster or Sentinel setup?       → references/clustering-ha.md
Memory issues / persistence?     → references/persistence-performance.md
Caching / sessions / rate limit? → references/patterns.md
```

## Core Principles

1. **Right data type for the job** — don't use strings for everything. Hashes for objects, Sorted Sets for leaderboards, Streams for event logs, Sets for unique collections.
2. **Pipeline everything** — batch commands to reduce RTT. Single command = 1 RTT, pipeline of 100 = 1 RTT.
3. **Set TTL on everything** — Redis is RAM. Every key without TTL is a memory leak waiting to happen.
4. **Use ioredis for Node.js** — better cluster support, Lua scripting, pipelining, auto-reconnect. node-redis (official) is good too but ioredis is more battle-tested in production.
5. **maxmemory-policy** — always configure. `allkeys-lru` for caches, `noeviction` for queues/persistent data.
6. **Never use KEYS in production** — use SCAN instead. KEYS blocks the single-threaded event loop.
7. **Lua for atomicity** — when you need atomic multi-step operations, use Lua scripts (EVAL/EVALSHA).

## Data Types Overview

| Type | Use Case | Key Commands |
|------|----------|-------------|
| **String** | Cache, counters, flags | `SET`, `GET`, `INCR`, `SETNX`, `MGET` |
| **Hash** | Objects, user profiles | `HSET`, `HGET`, `HGETALL`, `HINCRBY` |
| **List** | Queues, recent items | `LPUSH`, `RPOP`, `LRANGE`, `BRPOP` |
| **Set** | Tags, unique items | `SADD`, `SMEMBERS`, `SINTER`, `SCARD` |
| **Sorted Set** | Leaderboards, ranked data | `ZADD`, `ZRANGE`, `ZRANGEBYSCORE`, `ZRANK` |
| **Stream** | Event log, message broker | `XADD`, `XREAD`, `XREADGROUP`, `XACK` |
| **JSON** | Nested documents | `JSON.SET`, `JSON.GET`, `JSON.ARRAPPEND` |
| **Vector Set** | ML embeddings, similarity | `VADD`, `VSIM`, `VCARD` |
| **HyperLogLog** | Cardinality estimation | `PFADD`, `PFCOUNT`, `PFMERGE` |
| **Bitmap** | Feature flags, daily active | `SETBIT`, `GETBIT`, `BITCOUNT` |
| **Geo** | Location-based queries | `GEOADD`, `GEOSEARCH`, `GEODIST` |
| **Time Series** | Metrics, IoT data | `TS.ADD`, `TS.RANGE`, `TS.MRANGE` |

## Node.js Quick Start

### ioredis (recommended)

```typescript
import Redis from 'ioredis';

// Single instance
const redis = new Redis({
  host: 'localhost',
  port: 6379,
  password: process.env.REDIS_PASSWORD,
  db: 0,
  retryStrategy(times) {
    return Math.min(times * 50, 2000);
  },
  maxRetriesPerRequest: 3,
  enableReadyCheck: true,
  lazyConnect: false,
});

// Event handling
redis.on('connect', () => console.log('Redis connected'));
redis.on('error', (err) => console.error('Redis error:', err));
redis.on('close', () => console.log('Redis connection closed'));

// Basic operations
await redis.set('key', 'value', 'EX', 3600); // with TTL
const val = await redis.get('key');

// Pipeline (batched commands, single RTT)
const pipeline = redis.pipeline();
pipeline.set('key1', 'val1');
pipeline.set('key2', 'val2');
pipeline.get('key1');
const results = await pipeline.exec();
// results = [[null, 'OK'], [null, 'OK'], [null, 'val1']]

// Transaction (atomic)
const multi = redis.multi();
multi.incr('counter');
multi.expire('counter', 3600);
await multi.exec();
```

### ioredis Cluster

```typescript
import Redis from 'ioredis';

const cluster = new Redis.Cluster([
  { host: 'node1.example.com', port: 6379 },
  { host: 'node2.example.com', port: 6379 },
  { host: 'node3.example.com', port: 6379 },
], {
  redisOptions: {
    password: process.env.REDIS_PASSWORD,
  },
  scaleReads: 'slave', // read from replicas
  natMap: {}, // NAT mapping if behind proxy
});
```

### node-redis (official)

```typescript
import { createClient } from 'redis';

const client = createClient({
  url: 'redis://:password@localhost:6379/0',
  socket: {
    reconnectStrategy: (retries) => Math.min(retries * 50, 2000),
  },
});

client.on('error', (err) => console.error('Redis error:', err));
await client.connect();

await client.set('key', 'value', { EX: 3600 });
const val = await client.get('key');

await client.disconnect();
```

## Pub/Sub

```typescript
// Publisher
const pub = new Redis();
await pub.publish('notifications', JSON.stringify({ userId: 1, msg: 'hello' }));

// Subscriber (dedicated connection — cannot do other commands)
const sub = new Redis();
sub.subscribe('notifications', 'alerts');
sub.on('message', (channel, message) => {
  console.log(`${channel}: ${message}`);
});

// Pattern subscribe
sub.psubscribe('user:*');
sub.on('pmessage', (pattern, channel, message) => {
  console.log(`${pattern} → ${channel}: ${message}`);
});
```

**Pub/Sub vs Streams:**
- Pub/Sub: fire-and-forget, no persistence, no consumer groups. Good for real-time notifications.
- Streams: persistent, consumer groups, acknowledgment, replay. Good for reliable event processing.

## Streams (Event Log / Message Broker)

```typescript
// Producer
await redis.xadd('events', '*', 'type', 'order', 'data', JSON.stringify({ id: 1 }));

// Consumer group
await redis.xgroup('CREATE', 'events', 'workers', '0', 'MKSTREAM');

// Consumer (blocking read)
const messages = await redis.xreadgroup(
  'GROUP', 'workers', 'worker-1',
  'COUNT', 10, 'BLOCK', 5000,
  'STREAMS', 'events', '>'
);

// Acknowledge processed message
await redis.xack('events', 'workers', messageId);

// Trim stream (keep last 10000 entries)
await redis.xtrim('events', 'MAXLEN', '~', 10000);
```

## Lua Scripting (Atomic Operations)

```typescript
// Rate limiter in Lua (atomic increment + expire)
const rateLimitScript = `
  local current = redis.call('INCR', KEYS[1])
  if current == 1 then
    redis.call('EXPIRE', KEYS[1], ARGV[1])
  end
  return current
`;

const count = await redis.eval(rateLimitScript, 1, `rate:${userId}`, 60);
if (count > 100) throw new Error('Rate limited');

// Cache script SHA for performance
const sha = await redis.script('LOAD', rateLimitScript);
const count2 = await redis.evalsha(sha, 1, `rate:${userId}`, 60);
```

## Common Patterns

### Cache-Aside (Read-Through)

```typescript
async function getUser(id: string) {
  const cached = await redis.get(`user:${id}`);
  if (cached) return JSON.parse(cached);

  const user = await db.query('SELECT * FROM users WHERE id = $1', [id]);
  await redis.set(`user:${id}`, JSON.stringify(user), 'EX', 3600);
  return user;
}

// Invalidation on write
async function updateUser(id: string, data: Partial<User>) {
  await db.query('UPDATE users SET ... WHERE id = $1', [id]);
  await redis.del(`user:${id}`); // invalidate cache
}
```

### Distributed Lock (Redlock Pattern)

```typescript
import Redis from 'ioredis';

async function acquireLock(redis: Redis, key: string, ttlMs: number): Promise<string | null> {
  const token = crypto.randomUUID();
  const result = await redis.set(key, token, 'PX', ttlMs, 'NX');
  return result === 'OK' ? token : null;
}

async function releaseLock(redis: Redis, key: string, token: string): Promise<boolean> {
  const script = `
    if redis.call('GET', KEYS[1]) == ARGV[1] then
      return redis.call('DEL', KEYS[1])
    else
      return 0
    end
  `;
  const result = await redis.eval(script, 1, key, token);
  return result === 1;
}
```

### Session Store

```typescript
// Store session
await redis.hset(`session:${sessionId}`, {
  userId: user.id,
  email: user.email,
  createdAt: Date.now().toString(),
});
await redis.expire(`session:${sessionId}`, 86400); // 24h

// Get session
const session = await redis.hgetall(`session:${sessionId}`);
if (!session.userId) throw new Error('Session expired');

// Slide expiry on activity
await redis.expire(`session:${sessionId}`, 86400);
```

### Sliding Window Rate Limiter

```typescript
async function isRateLimited(userId: string, limit: number, windowSec: number): Promise<boolean> {
  const key = `ratelimit:${userId}`;
  const now = Date.now();
  const windowStart = now - windowSec * 1000;

  const pipe = redis.pipeline();
  pipe.zremrangebyscore(key, 0, windowStart); // remove old entries
  pipe.zadd(key, now, `${now}-${Math.random()}`); // add current
  pipe.zcard(key); // count in window
  pipe.expire(key, windowSec); // auto-cleanup

  const results = await pipe.exec();
  const count = results![2][1] as number;
  return count > limit;
}
```

### Leaderboard

```typescript
// Add/update score
await redis.zadd('leaderboard:weekly', score, `user:${userId}`);

// Top 10
const top10 = await redis.zrevrange('leaderboard:weekly', 0, 9, 'WITHSCORES');

// User rank (0-indexed)
const rank = await redis.zrevrank('leaderboard:weekly', `user:${userId}`);

// Users around a specific rank
const around = await redis.zrevrange('leaderboard:weekly', rank - 5, rank + 5, 'WITHSCORES');
```

## Docker Setup

```yaml
# docker-compose.yml
services:
  redis:
    image: redis:7-alpine
    ports:
      - "6379:6379"
    command: >
      redis-server
      --appendonly yes
      --maxmemory 256mb
      --maxmemory-policy allkeys-lru
      --requirepass ${REDIS_PASSWORD}
    volumes:
      - redis-data:/data
    healthcheck:
      test: ["CMD", "redis-cli", "-a", "${REDIS_PASSWORD}", "ping"]
      interval: 10s
      timeout: 5s
      retries: 3

volumes:
  redis-data:
```

## Persistence

| Mode | Description | Tradeoff |
|------|-------------|----------|
| **RDB** (snapshots) | Point-in-time snapshots at intervals | Fast restart, potential data loss between snapshots |
| **AOF** (append-only) | Logs every write operation | Durable, slower restart, larger files |
| **RDB + AOF** | Both enabled | Best durability, slowest writes |
| **None** | Pure cache, no persistence | Fastest, data lost on restart |

```
# redis.conf — production recommended
save 900 1        # snapshot after 900s if >= 1 key changed
save 300 10       # snapshot after 300s if >= 10 keys changed
save 60 10000     # snapshot after 60s if >= 10000 keys changed
appendonly yes
appendfsync everysec  # good balance of safety/performance
```

## Memory Optimization

1. **Use Hashes for small objects** — Redis uses ziplist encoding for small hashes (< 128 fields, < 64 bytes per value). Much more memory-efficient than separate keys.
2. **Short key names** — `u:123:name` not `user:123:full_name`. Saves significant memory at scale.
3. **OBJECT ENCODING** — check encoding: `OBJECT ENCODING mykey`. Prefer ziplist/listpack over hashtable.
4. **MEMORY USAGE** — `MEMORY USAGE mykey` shows exact bytes.
5. **INFO MEMORY** — monitor `used_memory`, `mem_fragmentation_ratio` (ideal: 1.0-1.5).
6. **Avoid storing large values** — keep values < 100KB. For larger data, store reference and fetch from blob storage.

## Key Naming Conventions

```
{entity}:{id}:{field}     → user:123:profile
{entity}:{id}             → order:456
{scope}:{entity}:{id}     → cache:user:123
{feature}:{qualifier}     → ratelimit:api:user:123
{prefix}:{date}:{entity}  → leaderboard:2026-01:weekly
```

Rules:
- Use colons `:` as separators
- Use lowercase
- Be consistent across the project
- Include environment prefix if sharing Redis instance: `prod:`, `staging:`

## Production Checklist

- [ ] `maxmemory` set (don't let Redis eat all RAM)
- [ ] `maxmemory-policy` configured (`allkeys-lru` for cache, `noeviction` for persistent data)
- [ ] Password set (`requirepass`)
- [ ] `bind` restricted (not `0.0.0.0` in production)
- [ ] `rename-command FLUSHALL ""` (disable dangerous commands)
- [ ] Persistence configured (RDB + AOF for important data)
- [ ] Monitoring: `INFO`, `SLOWLOG`, `LATENCY DOCTOR`
- [ ] Connection pooling configured in clients
- [ ] TTL on all cache keys
- [ ] No `KEYS *` in production code (use `SCAN`)
- [ ] `maxclients` set appropriately
- [ ] Redis Sentinel or Cluster for HA
- [ ] Backup strategy for RDB files

## Redis vs Alternatives

| Feature | Redis | Cloudflare KV | Dragonfly | KeyDB | Valkey |
|---------|-------|---------------|-----------|-------|--------|
| **Type** | In-memory | Edge KV | Redis-compatible | Redis fork | Redis fork (LF) |
| **Latency** | < 1ms | ~50ms (edge) | < 1ms | < 1ms | < 1ms |
| **Persistence** | RDB + AOF | Durable | RDB + AOF | RDB + AOF | RDB + AOF |
| **Clustering** | Native | N/A | Native | Native | Native |
| **Multi-thread** | Single + IO threads | N/A | Multi-thread | Multi-thread | Single + IO |
| **License** | RSALv2 / SSPLv1 / AGPLv3 (v8+) | Proprietary | BSL 1.1 | BSD-3 | BSD-3 |
| **When to use** | Default choice | Edge/serverless | Drop-in, multi-threaded | Multi-threaded Redis | OSS Redis replacement |

Note (last verified 2026-07-15): Redis Ltd. re-added AGPLv3 as a licensing option for Redis 8+
in May 2025 — a reversal of the March 2024 RSAL/SSPL-only move. Redis is now
**triple-licensed** (RSALv2 / SSPLv1 / AGPLv3), so "pick AGPLv3" makes Redis 8+ usable again
under an OSI-recognized copyleft license (unlike SSPL/RSAL, which are not OSI-approved).
This narrows — but doesn't eliminate — the license argument for Valkey (see below): Valkey
remains the simpler BSD-3 choice with no license-selection step, and the governance/performance
reasons for preferring Valkey on new deployments still apply. Current OSS release: Redis 8.8
(480+ commands, 18 data types incl. vector sets).

## Redis vs Valkey — Routing Decision

**For NEW deployments, evaluate Valkey first.** Valkey (BSD-3, Linux Foundation governance, drop-in Redis fork with strong performance) is a common default choice.

This `redis` skill remains the reference for:
- **Existing Redis instances** (maintenance, troubleshooting, optimization)
- **Redis-specific commands/patterns** (identical API — Valkey uses same commands)
- **Client libraries** (ioredis, redis-py work with both Redis and Valkey)

Note: after Redis's 2024 license change, many teams default to Valkey (BSD-3, drop-in fork) for new in-memory store deployments; the AGPLv3 option re-added for Redis 8+ narrows that argument — evaluate per project.
