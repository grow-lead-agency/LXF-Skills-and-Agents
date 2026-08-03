---
name: nestjs-graphql-bff
description: >-
  Working on the GraphQL BFF in bff/bff-nestjs: NestJS 11 modules/providers/DI,
  code-first GraphQL with @nestjs/graphql + @nestjs/apollo + @apollo/server 5 on
  Express 5, thin resolvers proxying the Laravel datamixer /api/v1 API via
  @nestjs/axios, DataLoader batching, ioredis sessions. Trigger for: "BFF",
  "bff-nestjs", "resolver", "mutation", "schema.gql", "GraphQL endpoint",
  "session module", "datamixer proxy", "NestJS module", "Apollo Server".
---

# NestJS GraphQL BFF (bff/bff-nestjs)

The BFF is a thin GraphQL layer between the React storefront and the Laravel
`datamixer` API. It owns no business data: resolvers translate GraphQL
operations into upstream REST calls, aggregate responses, and manage
session/cart state in Redis. Keep it thin — business rules live in Laravel.

```
frontend (React 19, :3000) → BFF GraphQL (NestJS 11, :4000) → datamixer /api/v1 (Laravel 11) → MySQL
                                    ↕ ioredis (redis :6379, sessions/cache)
```

## Project conventions

- App root: `bff/bff-nestjs`. Runs on port **4000** (`bff-nestjs` service in
  `bff/docker-compose.yml`, project `luxshop`; redis 7 alpine alongside).
- Stack: NestJS 11, TS 5.7, `@nestjs/graphql` + `@nestjs/apollo` +
  `@apollo/server` **5**, Express **5** (integration package
  `@as-integrations/express5` — not `express4`), RxJS, ioredis, Jest 30.
- Generated schema: `src/schema.gql`. **Never hand-edit it** — it is emitted
  from decorators at startup. Commit it so schema diffs show up in review.
- Modules: `auth`, `account`, `catalog`, `cart`/`checkout`, `session`,
  `datamixer`, `health` (see module map below).
- Env: `DATAMIXER_BASE_URL` (upstream Laravel base URL), `DATAMIXER_API_KEY`
  (BFF→Laravel API key; the Laravel side validates it as `BFF_API_KEY`).
- Lint/format: ESLint 9 (typescript-eslint flat config) + Prettier. Run
  `npm run lint` and `npm run format` before committing.
- From repo root the Makefile has `bff-start` / `bff-stop` targets.

## NestJS 11 module & DI patterns

One feature = one module: resolver + service + module file per domain area.
Providers are singletons by default; constructor injection everywhere.

```ts
// src/catalog/catalog.module.ts
import { Module } from '@nestjs/common';
import { DatamixerModule } from '../datamixer/datamixer.module';
import { CatalogResolver } from './catalog.resolver';
import { CatalogService } from './catalog.service';

@Module({
  imports: [DatamixerModule],          // shared upstream HTTP client
  providers: [CatalogResolver, CatalogService],
  exports: [CatalogService],           // export only what other modules need
})
export class CatalogModule {}
```

Rules of thumb:
- Cross-cutting infrastructure (upstream HTTP client, Redis) lives in its own
  module and is imported — never re-instantiated per feature.
- Use `@Global()` sparingly; explicit imports keep the dependency graph honest.
- Config: read env via `ConfigService` (`@nestjs/config`) or a typed config
  provider — do not scatter `process.env` reads through services.
- Anything holding per-request state (e.g. DataLoader) must be
  `Scope.REQUEST`; everything else stays singleton for performance.

## Code-first GraphQL setup

```ts
// src/app.module.ts
import { ApolloDriver, ApolloDriverConfig } from '@nestjs/apollo';
import { GraphQLModule } from '@nestjs/graphql';
import { join } from 'path';

GraphQLModule.forRoot<ApolloDriverConfig>({
  driver: ApolloDriver,
  autoSchemaFile: join(process.cwd(), 'src', 'schema.gql'),
  sortSchema: true,
  context: ({ req, res }) => ({ req, res }),   // session token, headers
}),
```

`@nestjs/apollo` on this stack runs `@apollo/server` 5 mounted on Express 5
via `@as-integrations/express5`. Version gotchas:
- Apollo Server 5 dropped the built-in error classes — throw
  `new GraphQLError(msg, { extensions: { code: '...' } })` (from `graphql`).
- The Express integration is a separate package; if you ever touch bootstrap
  code, the Express 5 variant is `@as-integrations/express5`.
- CSRF prevention is on by default: plain GET/`content-type: text/plain`
  probes are rejected; clients must send `content-type: application/json`.

### Object types, fields, nullability

```ts
import { Field, Float, Int, ObjectType } from '@nestjs/graphql';

@ObjectType()
export class Product {
  @Field(() => Int)
  id: number;

  @Field()
  name: string;                       // String!, inferred

  @Field(() => Float, { nullable: true })
  price?: number;                     // Float

  @Field(() => [ProductVariant], { nullable: 'itemsAndList' })
  variants?: ProductVariant[];
}
```

- Fields are **non-nullable by default** — the opposite of the upstream JSON,
  where almost anything can be `null`. If Laravel can return `null`, mark the
  field `{ nullable: true }`, or a null value kills the whole response branch.
- `number` is ambiguous: always pass `() => Int` or `() => Float` explicitly.
- List nullability: `'items'`, `'itemsAndList'` when needed.
- These classes are GraphQL shapes, not upstream DTOs. Map upstream JSON to
  them in the service layer; don't leak Laravel field naming into the schema.

### Resolvers, args, input types

```ts
import { Args, Int, Mutation, Query, Resolver } from '@nestjs/graphql';

@Resolver(() => Product)
export class CatalogResolver {
  constructor(private readonly catalog: CatalogService) {}

  @Query(() => Product, { nullable: true })
  product(@Args('id', { type: () => Int }) id: number) {
    return this.catalog.findProduct(id);
  }

  @Mutation(() => Cart)
  addToCart(@Args('input') input: AddToCartInput, @Context() ctx: GqlContext) {
    return this.cart.addItem(ctx.sessionId, input);
  }
}

@InputType()
export class AddToCartInput {
  @Field(() => Int) productId: number;
  @Field(() => Int, { defaultValue: 1 }) quantity: number;
}
```

- Resolvers are **thin**: read args + context, call one service method, return.
  No HTTP calls, no Redis, no mapping logic in resolvers.
- Mutations always take a single `input` arg with an `@InputType()` class —
  never a bag of scalars — so the schema stays evolvable.
- Use `@ResolveField()` + `@Parent()` for nested fields that need their own
  upstream fetch, and back them with DataLoader (below).
- After changing any type/resolver, restart the app and review the
  `src/schema.gql` diff — that diff is the API contract change.

## Upstream calls: the datamixer module

The `datamixer` module wraps `@nestjs/axios` with base URL + API key + timeout
and is the **only** place that talks HTTP to Laravel. Feature services depend
on it, not on `HttpService` directly.

```ts
// src/datamixer/datamixer.module.ts
HttpModule.registerAsync({
  useFactory: (config: ConfigService) => ({
    baseURL: config.getOrThrow('DATAMIXER_BASE_URL'),
    timeout: 5000,
    headers: { /* API key header the Laravel API expects — see the existing
                  datamixer service for the exact header name; value comes
                  from DATAMIXER_API_KEY */ },
  }),
  inject: [ConfigService],
}),
```

```ts
// src/datamixer/datamixer.service.ts
import { firstValueFrom } from 'rxjs';
import { AxiosError } from 'axios';

@Injectable()
export class DatamixerService {
  constructor(private readonly http: HttpService) {}

  async get<T>(path: string, params?: Record<string, unknown>): Promise<T> {
    try {
      const { data } = await firstValueFrom(this.http.get<T>(path, { params }));
      return data;
    } catch (err) {
      throw mapUpstreamError(err);
    }
  }
}
```

### RxJS / firstValueFrom pitfalls

- `HttpService` returns Observables. **Always** `await firstValueFrom(...)`;
  never `.subscribe()` (fire-and-forget, unhandled rejections) and never
  `.toPromise()` (removed).
- The request only fires on subscription — building the Observable and
  returning it without awaiting means "sometimes nothing happens".
- If the Observable completes empty (e.g. a `filter` upstream), `firstValueFrom`
  rejects with `EmptyError`. Don't add filtering operators to HTTP pipes.
- Retries: use `.pipe(retry({ count: 2, delay: 300 }))` **only on idempotent
  GETs**. Never retry cart/checkout mutations — you'll double-submit orders.
- Per-call timeout beyond the axios `timeout`: `.pipe(timeout(3000))` from
  `rxjs` — but prefer the module-level axios timeout as the single knob.

### Error mapping: upstream HTTP → GraphQL

Map in one helper so every resolver fails consistently:

| Upstream                 | GraphQL error `extensions.code`             |
| ------------------------ | ------------------------------------------- |
| 400 / 422 validation     | `BAD_USER_INPUT` (attach field messages)    |
| 401                      | `UNAUTHENTICATED`                           |
| 403                      | `FORBIDDEN`                                 |
| 404                      | `NOT_FOUND` (often: return `null` instead)  |
| 5xx / timeout / ECONNREFUSED | `BAD_GATEWAY` — generic message, log detail |

```ts
export function mapUpstreamError(err: unknown): GraphQLError {
  if (err instanceof AxiosError) {
    const status = err.response?.status;
    if (status === 422) {
      return new GraphQLError('Validation failed', {
        extensions: { code: 'BAD_USER_INPUT', errors: err.response?.data?.errors },
      });
    }
    if (status === 401) return new GraphQLError('Unauthenticated', { extensions: { code: 'UNAUTHENTICATED' } });
    if (status === 404) return new GraphQLError('Not found', { extensions: { code: 'NOT_FOUND' } });
  }
  // timeouts, network errors, 5xx — never leak upstream bodies to the client
  return new GraphQLError('Upstream service unavailable', {
    extensions: { code: 'BAD_GATEWAY' },
  });
}
```

Log the full axios error (URL, status, body) server-side; expose only the
mapped message. Nest `HttpException`s thrown from services also surface as
GraphQL errors, but the explicit `GraphQLError` mapping keeps `extensions.code`
stable for the storefront.

## DataLoader: avoid upstream N+1

A query like `{ cart { items { product { name } } } }` naively issues one
Laravel request per item. Batch with `dataloader` (request-scoped — loaders
cache per request and must not leak between users):

```ts
import DataLoader from 'dataloader';
import { Injectable, Scope } from '@nestjs/common';

@Injectable({ scope: Scope.REQUEST })
export class ProductLoader {
  readonly byId = new DataLoader<number, Product | null>(async (ids) => {
    const products = await this.datamixer.get<Product[]>('/api/v1/products', {
      ids: ids.join(','),                       // bulk endpoint upstream
    });
    const map = new Map(products.map((p) => [p.id, p]));
    return ids.map((id) => map.get(id) ?? null); // MUST match input order/length
  });

  constructor(private readonly datamixer: DatamixerService) {}
}
```

- The batch function must return results in the same order and length as the
  input keys (`null` for misses) — this is DataLoader's contract.
- Use it from `@ResolveField()` resolvers: `loader.byId.load(item.productId)`.
- Requires a bulk upstream endpoint; if Laravel lacks one for that resource,
  add it there rather than fanning out N requests.
- Request scope bubbles: anything injecting a request-scoped provider becomes
  request-scoped too. Keep loaders at the resolver edge, not inside singleton
  services.

## Sessions with ioredis

The `session` module owns the Redis client and session semantics. Session/cart
state is shared between requests (and readable by other services) via Redis —
the BFF itself stays stateless.

```ts
// src/session/session.module.ts — single shared client
{
  provide: 'REDIS',
  useFactory: (config: ConfigService) =>
    new Redis(config.getOrThrow('REDIS_URL')),
  inject: [ConfigService],
}
```

```ts
const SESSION_TTL = 60 * 60 * 24; // 24h, refreshed on touch

async get(sessionId: string): Promise<SessionData | null> {
  const raw = await this.redis.get(`session:${sessionId}`);
  return raw ? (JSON.parse(raw) as SessionData) : null;
}

async set(sessionId: string, data: SessionData): Promise<void> {
  await this.redis.set(`session:${sessionId}`, JSON.stringify(data), 'EX', SESSION_TTL);
}
```

Conventions:
- Namespaced keys: `session:<id>`, `cart:<sessionId>`. Every key gets a TTL —
  no immortal carts. Refresh TTL on each authenticated/active request.
- The session ID travels from the storefront in the GraphQL context (cookie or
  header — follow the existing auth module); resolvers read it from `@Context()`
  and pass it down. Services never touch `req` directly.
- One `Redis` instance for the app (connection pooling is internal); inject the
  `'REDIS'` token, don't `new Redis()` in feature code.
- Handle Redis-down gracefully in reads where possible (treat as cache miss);
  fail loudly on session writes during checkout.

## Module map

| Module      | Owns                                                                |
| ----------- | ------------------------------------------------------------------- |
| `datamixer` | The only upstream HTTP client: base URL, API key, timeout, error mapping. |
| `auth`      | Login/logout/token exchange with Laravel Sanctum; puts identity into session. |
| `session`   | Redis client provider, session CRUD, TTLs, context extraction.       |
| `account`   | Customer profile queries/mutations (proxied, requires auth).         |
| `catalog`   | Products, categories, search — read-only queries + DataLoaders.      |
| `cart` / `checkout` | Cart state (Redis + upstream), checkout mutations. Never retried, idempotency-sensitive. |
| `health`    | Liveness/readiness endpoints (REST, not GraphQL).                    |

New feature? It goes into the module whose domain it belongs to; a new domain
gets a new module wired like `catalog`. Cross-module reuse goes through
exported services, never by importing another module's internals.

## Health checks

Health is plain REST (orchestrators and probes don't speak GraphQL):

- `GET /health` — liveness: process is up, returns `{ status: 'ok' }`, 200.
- Readiness variant additionally pings Redis (`redis.ping()`) and optionally
  the upstream (cheap endpoint, short timeout). Degrade to 503 with a body
  naming the failing dependency.
- Keep it dependency-light and fast (<100 ms happy path); never require auth.
- Docker/deploy health checks in `bff/docker-compose.yml` point here.

## Before commit

```bash
npm run lint          # ESLint 9 (typescript-eslint) — fix, don't disable rules
npm run format        # Prettier
npm run test          # Jest 30 unit tests
npm run test:e2e      # supertest against /graphql
git diff src/schema.gql   # review the schema contract change explicitly
```

## References

- `references/testing-jest.md` — read when writing or fixing tests: Jest 30 +
  ts-jest unit patterns (mocked `HttpService`, mocked ioredis), overriding
  providers in `Test.createTestingModule`, and supertest e2e against `/graphql`
  including error assertions.
