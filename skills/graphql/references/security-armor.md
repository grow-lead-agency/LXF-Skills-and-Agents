# GraphQL Security — Query Limits, Armor, Production Checklist

## OWASP GraphQL Cheat Sheet — checklist (12 points)

Consolidated from `cheatsheetseries.owasp.org/cheatsheets/GraphQL_Cheat_Sheet.html` +
`graphql.org/learn/security` (official "demand control" terminology 2025/2026). Use as a
fast production-readiness checklist — detailed implementations of each item are in the
sections below.

1. **Input validation** against injection (SQL/NoSQL/OS command/SSRF/CRLF) — GraphQL arguments
   are not automatically safe just because they passed the type system; type ≠ sanitization.
2. **Trusted documents** (allowlist) as the strongest demand-control layer — when the API is
   not meant for third-party clients with arbitrary queries. See "APQ vs. Trusted Documents"
   below.
3. **Depth limiting** — reject a document above N nesting levels, separately from breadth limits.
4. **Breadth / batch limiting** — cap top-level fields, aliases, and batched operations in one
   request (see "Alias-based rate-limit bypass" below).
5. **Query complexity / cost analysis** — per-field / per-type weights, reject above threshold.
   Apollo: "before you spend a week implementing cost analysis, try to break your own staging
   API with a hostile query — you may not need it."
6. **Rate limiting in the business-logic layer**, not only at the network layer — a network
   limiter cannot tell a cheap query from an expensive one by field selection.
7. **Introspection disabled in production** — as *defense-in-depth*, never as the only protection
   ("security through obscurity"). An attacker can still fuzz field names without introspection.
8. **Field-suggestion hints ("Did you mean X?") disabled** together with introspection — they
   leak schema shape even with introspection off.
9. **Error masking** — no stack traces / debug info in production responses
   (`debug: false` / `NODE_ENV=production`).
10. **Authorization in the business-logic layer**, not hardcoded only in a resolver or only as a
    schema directive. Check **edges and nodes** (real HackerOne report: nodes lacked the auth
    check that the edge had).
11. **Batching-attack mitigation** — code-level rate limiting on the number of *object instances*
    in a request (not on the number of HTTP requests); ban batching for sensitive fields
    (username/email/OTP/session token — enforce single-object-per-request as with REST).
12. **HTTPS-only + CORS to a concrete origin** (not wildcard) + CSRF protection for mutations if
    the GraphQL endpoint accepts content types other than `application/json` with credentials.

## Threats specific to GraphQL

| Threat | Description | Severity |
|--------|-------------|----------|
| **Query depth attack** | `{ user { friends { friends { friends { ... } } } } }` — exponential backend work | Critical |
| **Query complexity attack** | Large collections with nested fields — O(n²) database / API operations | Critical |
| **Introspection enumeration** | Attacker maps the full schema — entities, fields, directives | High |
| **Circular reference** | Schema with circular relations — stack overflow in serialization | Medium |
| **Field suggestion enumeration** | GraphQL returns "Did you mean X?" — leaks field names | Low |
| **Batch query abuse** | N independent queries in 1 request — bypasses rate limiting | Medium |
| **Mutation flooding** | Mass create mutations — database / Laravel API DoS | High |

## NestJS 11 + Apollo Server 5 — protection configuration

Primary stack for this skill pack: NestJS code-first GraphQL BFF on Apollo Server 5,
consuming a Laravel API. Wire depth, complexity, and introspection at the GraphQL module
(and optionally via GraphQL Armor plugins).

```typescript
// app.module.ts (NestJS GraphQLModule + Apollo driver)
import { GraphQLModule } from '@nestjs/graphql'
import { ApolloDriver, ApolloDriverConfig } from '@nestjs/apollo'
import depthLimit from 'graphql-depth-limit'
import { createComplexityLimitRule } from 'graphql-validation-complexity'

GraphQLModule.forRoot<ApolloDriverConfig>({
  driver: ApolloDriver,
  autoSchemaFile: true, // code-first
  playground: process.env.NODE_ENV !== 'production',
  introspection: process.env.NODE_ENV !== 'production',
  validationRules: [
    depthLimit(10), // REQUIRED — without this, depth is unbounded
    createComplexityLimitRule(1000, {
      // Per-field costs: list fields should scale with `first` / `limit` args
      onCost: (cost) => {
        // optional: log expensive queries
      },
    }),
  ],
  formatError: (error) => {
    // Production: strip stack / internal details
    if (process.env.NODE_ENV === 'production') {
      return {
        message: error.message,
        extensions: {
          code: error.extensions?.code,
        },
        path: error.path,
      }
    }
    return error
  },
})
```

**Complexity scoring must apply to EVERY paginated field**, root and nested — otherwise
nested calls of the same expensive operation slip under a flat default cost (see Iron Law #4
in `graphql-review-checklist.md`):

```typescript
// Code-first: attach complexity to field options
@Query(() => ProductConnection, {
  complexity: ({ args, childComplexity }) => {
    const first = args.first ?? 20
    return first * childComplexity
  },
})
products(@Args('first', { nullable: true }) first?: number) { /* ... */ }

// Nested field on Category — SAME cost model required
@ResolveField(() => ProductConnection, {
  complexity: ({ args, childComplexity }) => {
    const first = args.first ?? 20
    return first * childComplexity
  },
})
products(@Parent() category: Category, @Args('first', { nullable: true }) first?: number) {
  /* ... */
}
```

Recurring health check: search resolvers for `Connection` return types without a
`complexity` option (or without a shared complexity helper).

Relying only on `NODE_ENV !== 'production'` for introspection is fine for most BFFs, but
if a future env override accidentally enables debug in prod, introspection reopens silently.
Prefer an explicit `GRAPHQL_INTROSPECTION=false` env in production rather than only
`NODE_ENV`.

## GraphQL Armor (recommended for Apollo / Yoga)

```bash
bun add @escape.tech/graphql-armor
```

```typescript
// NestJS Apollo plugin or standalone Yoga server
import { ApolloArmor } from '@escape.tech/graphql-armor'

const armor = new ApolloArmor({
  maxDepth: {
    enabled: true,
    n: 10, // maximum depth
  },
  costLimit: {
    enabled: true,
    maxCost: 1000,
    objectCost: 1,
    scalarCost: 0,
    depthCostFactor: 1.5, // each level increases cost by 50%
    ignoreIntrospection: true,
  },
  blockFieldSuggestion: {
    enabled: true, // hide "Did you mean X?" hints
    mask: '<redacted>',
  },
  maxAliases: {
    enabled: true,
    n: 15, // max aliases in a query
  },
  maxDirectives: {
    enabled: true,
    n: 50,
  },
  maxTokens: {
    enabled: true,
    n: 1000, // max tokens in the query document
  },
})

// Merge armor protection into Apollo Server plugins / validation
const protection = armor.protect()
// GraphQLModule.forRoot({ ...protection, plugins: [...protection.plugins] })
```

**Rough complexity model (default multipliers vary by library):**
- Each scalar field ≈ 1 point
- Each list field ≈ 10 points (or `first * childComplexity`)
- Max allowed complexity = 1000 (tune to your most expensive legitimate UI query)

```graphql
# Example cost sketch
query {          # complexity = ?
  emails {       # list = 10 (or first * child)
    edges {
      node {
        id       # +1
        recipient # +1
        template { # relation +1
          name   # +1
        }
      }
    }
  }
}
# Total: on the order of 14 (within a 1000 budget)
```

## Introspection guard (production)

Default: disable introspection and playground/GraphiQL in production (see Nest config above).

If you need introspection for admin tooling in production:

```typescript
// NestJS guard / Apollo plugin — allow __schema / __type only for admins
@Injectable()
export class GraphQlIntrospectionGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const gqlCtx = GqlExecutionContext.create(context)
    const info = gqlCtx.getInfo()
    const user = gqlCtx.getContext().req.user

    if (this.isIntrospection(info) && !user?.roles?.includes('admin')) {
      throw new ForbiddenException('GraphQL introspection is disabled')
    }
    return true
  }

  private isIntrospection(info: GraphQLResolveInfo): boolean {
    // Also scan the full document for __schema / __type
    return info.fieldName === '__schema' || info.fieldName === '__type'
  }
}
```

## Alias-based rate-limit bypass & batched-query brute force (attack context)

Why rate limiting and breadth limiting must be **at the object-instance level, not the HTTP
request level** — offensive view of what the defensive checklist above mitigates (OWASP +
graphql.org).

**Alias-based bypass:** one GraphQL request can carry N independent queries via aliases —
from a network-layer rate limiter / WAF this is **one request**, so a per-request limit
(e.g. "100 req/min") never sees it:

```graphql
{
  droid(id:"2000"){name}
  second: droid(id:"2001"){name}
  third: droid(id:"2002"){name}
  # ... N aliases, N object lookups, 1 HTTP request
}
```

Classic breadth-explosion example from the same family (graphql.org): `friends1: friends(limit:1)
... friends100: friends(limit:100)` — depth stays shallow, breadth explodes.

**Batched-query brute force:** same mechanism abused against sensitive operations — an attacker
packs dozens/hundreds of OTP/PIN/token attempts into one request and bypasses per-request
lockout that would work for individual REST-style requests.

**Mitigation (code-level, not network-level):**
- Count rate limits on **object instances requested in the request**, not on HTTP request
  count (`maxAliases` in GraphQL Armor is one tool — but the limit alone does not replace
  business-logic rate limiting on a concrete entity/user).
- For sensitive objects (username/email lookup, OTP/PIN verification, session token) **ban
  batching entirely** — enforce single-object-per-request as the equivalent REST endpoint would.
- Cap the total number of operations allowed in one batch request.

## Rate limiting

```typescript
// NestJS — dedicated limiters for GraphQL query vs mutation
// Example with @nestjs/throttler or a custom interceptor

@Injectable()
export class GraphQlRateLimitInterceptor implements NestInterceptor {
  constructor(
    private readonly queryLimiter: RateLimiter,    // e.g. 100 / 60s per IP or user
    private readonly mutationLimiter: RateLimiter, // e.g. 20 / 60s
  ) {}

  intercept(context: ExecutionContext, next: CallHandler) {
    const gql = GqlExecutionContext.create(context)
    const info = gql.getInfo()
    const req = gql.getContext().req
    const key = req.user?.id ?? req.ip

    const limiter =
      info.operation.operation === 'mutation'
        ? this.mutationLimiter
        : this.queryLimiter

    if (!limiter.consume(key)) {
      throw new HttpException('GraphQL rate limit exceeded', 429)
    }
    return next.handle()
  }
}
```

Prefer identity-based keys (user id) over IP alone when the BFF is behind a trusted gateway.

## APQ vs. Trusted Documents — do not conflate (common even among experienced teams)

Source: `benjie.dev/graphql/trusted-documents` (Benjie Gillam, GraphQL Working Group member,
co-author of the `@oneOf` RFC) — the canonical distinction. **Many blog posts mix these up.**

| | **Automatic Persisted Queries (APQ)** | **Trusted Documents** |
|---|---|---|
| **Purpose** | Bandwidth optimization — send a hash instead of full query text | Security allowlist — server runs only operations that passed CI |
| **Who can register a new operation** | **Anyone, at runtime** — client sends unknown hash → server rejects → client sends full query + hash → server **remembers it for next time** | **Nobody at runtime** — documents are persisted at build/deploy; unknown `documentId` = hard reject, no runtime registration |
| **Is it a security control?** | **NO.** An attacker can still send any new query as without APQ — they only pay one full-text send | **YES** — the only operations an attacker can run are ones your own team wrote |
| **When to deploy** | Whenever you want bandwidth savings / GET-cacheable URLs | Whenever the API faces the internet/WAN and is not meant for third parties with arbitrary queries — i.e. most first-party web/mobile clients |

**If the goal is security, do not treat APQ as sufficient** — implement trusted documents.
The middleware below rejects unknown hashes without runtime registration
(`allowUnpersisted = false`) — that is **trusted documents, not APQ**, despite the historical
`PersistedQuery` naming. Real APQ would *accept* and register the new query in that branch,
which is exactly what a security allowlist must not do.

```typescript
// Trusted documents / persisted-operations allowlist in NestJS (NOT automatic runtime
// registration — that would be APQ and would have zero security value)
// 1. Client sends request with hash (documentId)
// 2. Server looks up query from a pre-persisted allowlist (Redis/DB, filled at CI/deploy)
// 3. If found → execute
// 4. If not → hard reject, NO runtime storage of the new query

@Injectable()
export class TrustedDocumentsMiddleware {
  constructor(
    private readonly cache: Cache,
    private readonly allowUnpersisted: boolean, // ALWAYS false in production for trusted docs
  ) {}

  async process(request: GraphQLRequest): Promise<GraphQLRequest> {
    const hash = request.extensions?.persistedQuery?.sha256Hash

    if (hash) {
      const cachedQuery = await this.cache.get<string>(`gql_pq_${hash}`)

      if (cachedQuery) {
        request.query = cachedQuery
      } else if (!this.allowUnpersisted) {
        // Trusted documents: no auto-registration. Unknown hash = reject.
        throw new Error('PersistedQueryNotFound')
      }
    }

    return request
  }
}
```

**Trusted documents are not a silver bullet:** an attacker who cannot write a new document can
still replay an existing trusted document with malicious *variable values*
(e.g. `$limit: 2147483647` against `topUsers(first: $limit)`). Mitigation: hardcode pagination
limits in the text of the persisted document instead of leaving them as client-supplied
variables, and push complex filter objects into the document itself, not into variables.

**Depth limiting / cost analysis / introspection-disabling remain useful even with trusted
documents, but are far less critical** — residual risk shifts from "arbitrary attacker-written
query" to "known document fed with malicious variables".

**Bonus:** trusted documents give a complete inventory of operations and fields actually in
production — safe field removal becomes "revalidate all persisted documents against the
candidate schema; if all pass, ship" instead of guessing (see CI gates in
`graphql-review-checklist.md`).

## Production Security Checklist

### NestJS / Apollo configuration
- [ ] Depth limit set (e.g. 10, or lower for a simple API)
- [ ] Complexity / cost limit set (tune to the most expensive legitimate query)
- [ ] `introspection: false` in production (or auth-guarded)
- [ ] Playground / GraphiQL disabled in production

### HTTP layer
- [ ] GraphQL endpoint behind a WAF when public
- [ ] Rate limiting per identity (and preferably per object-instance cost)
- [ ] CORS set to the concrete React app origin (not wildcard)
- [ ] Content-Type whitelist: `application/json` only

### Schema design
- [ ] Cap depth on circular / deep relations in resolvers or schema design
- [ ] Field suggestions disabled in production (GraphQL Armor or equivalent)
- [ ] Do not expose internal fields (soft-delete timestamps, internal notes) on default types

### Monitoring
- [ ] Performance tracing on the GraphQL endpoint (distributed traces into Laravel calls)
- [ ] Alert if the GraphQL endpoint returns 5xx more than a few times in a short window
- [ ] Log slow operations (&gt; 2s) with query body (redact sensitive variables)
- [ ] Alert on unusual volume of entries in the `errors` array (DoS indicator)

### Deployment
- [ ] GraphQL endpoint not reachable without authentication (unless the API is intentionally public)
- [ ] Service network policy: BFF can call Laravel; clients cannot call Laravel directly unless intended
- [ ] Secrets (JWT signing keys, Laravel client credentials) come from a secret store, not plain env in source

### Apollo / Armor specifics
- [ ] Depth and complexity limits set together (one alone is not enough — see Iron Law #5 in
      `graphql-review-checklist.md`)
- [ ] Complexity / cost scaling on **all** `Connection` / paginated fields, root and nested —
      not only on root queries
- [ ] If a persisted-query mechanism exists, verify it is trusted documents
      (`allowUnpersisted = false`, no runtime registration), not APQ marketed as security

Sources: https://cheatsheetseries.owasp.org/cheatsheets/GraphQL_Cheat_Sheet.html, https://graphql.org/learn/security/, https://github.com/apollographql/skills
