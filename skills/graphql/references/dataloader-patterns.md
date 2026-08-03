# DataLoader Patterns — N+1 Prevention

## The problem: N+1 in GraphQL

GraphQL resolvers run per-field, per-item. Without DataLoader, every nested field triggers
its own database (or HTTP) round-trip:

```graphql
# This query causes 1 + 100 backend calls without DataLoader
query {
  emails(first: 100) {
    edges {
      node {
        recipient
        template { name }   # → 1 lookup per email = 100 SELECTs / HTTP calls!
      }
    }
  }
}
```

A Sentry (or OpenTelemetry) trace will show 101 identical lookups instead of 2.

## Solution 1: Eager join / batch fetch at the data source (simple cases)

When the NestJS BFF talks to a Laravel API or a SQL database and the nested relation is
always needed for a known list query, batch at the source:

```typescript
// NestJS service — one Laravel/API call with includes, or one SQL JOIN
async findEmailsWithTemplates(first: number): Promise<Email[]> {
  // Prefer a single batch endpoint / include rather than N per-item calls
  return this.laravelClient.get('/api/emails', {
    params: { first, include: 'template,recipient' },
  })
}
```

Or, when the BFF owns the query against SQL:

```typescript
// TypeORM / Prisma / Knex — join once
const emails = await this.emailRepo
  .createQueryBuilder('e')
  .leftJoinAndSelect('e.template', 't')
  .leftJoinAndSelect('e.recipient', 'r')
  .take(first)
  .getMany()
```

**Pros:** Simple, no extra dependency, works for known relations.
**Cons:** Always loads the relation, even when the GraphQL selection set does not need it.
Poor fit for dynamic nested fields driven by client selection.

## Solution 2: DataLoader (batch loading) — preferred for NestJS resolvers

DataLoader accumulates `.load()` calls during one execution tick, then batches them into
one query or one HTTP call.

### NestJS + `dataloader` (Apollo Server 5)

```bash
bun add dataloader
# or: npm install dataloader
```

```typescript
// src/dataloaders/template.dataloader.ts
import DataLoader from 'dataloader'
import { Injectable, Scope } from '@nestjs/common'
import { TemplateService } from '../templates/template.service'
import { Template } from '../templates/template.entity'

@Injectable({ scope: Scope.REQUEST }) // one loader instance per GraphQL request
export class TemplateDataLoader {
  private readonly loader: DataLoader<string, Template | null>

  constructor(private readonly templateService: TemplateService) {
    this.loader = new DataLoader(async (ids: readonly string[]) => {
      // One Laravel batch call or one SQL IN (?) for all IDs
      const templates = await this.templateService.findByIds([...ids])

      // IMPORTANT: return results in the same order as `ids`!
      const byId = new Map(templates.map((t) => [t.id, t]))
      return ids.map((id) => byId.get(id) ?? null)
    })
  }

  load(templateId: string): Promise<Template | null> {
    return this.loader.load(templateId)
  }

  loadMany(templateIds: string[]): Promise<(Template | null | Error)[]> {
    return this.loader.loadMany(templateIds)
  }
}
```

```typescript
// Usage in a code-first NestJS field resolver
@Resolver(() => Email)
export class EmailResolver {
  constructor(private readonly templateLoader: TemplateDataLoader) {}

  @ResolveField(() => Template, { nullable: true })
  template(@Parent() email: Email): Promise<Template | null> {
    // DataLoader batches: all calls in one tick merge into one backend query
    return this.templateLoader.load(email.templateId)
  }
}
```

### Request-scoped registration

Create DataLoaders per GraphQL request (never as a process-wide singleton — that leaks
data across users):

```typescript
// context factory (Apollo Server / NestJS GraphQLModule)
context: ({ req }) => ({
  req,
  loaders: {
    template: new TemplateDataLoader(templateService),
    // ...other loaders
  },
})
```

Or inject request-scoped Nest providers (`Scope.REQUEST`) as shown above.

## Solution 3: Max depth limits (prevention, not a fix)

```typescript
// Apollo Server 5 — validation rule
import depthLimit from 'graphql-depth-limit'

GraphQLModule.forRoot({
  validationRules: [depthLimit(10)],
})
```

Depth limits stop recursive nesting attacks but do **not** fix N+1 — you can still get
100 SELECTs at depth 1.

## Client-side: DataLoader is usually unnecessary

On the React client, TanStack Query (or urql Graphcache) already deduplicates:

```typescript
// TanStack Query deduplicates parallel queries automatically
// These 3 hooks cause ONE network request (deduplicated)
const q1 = useQuery({ queryKey: ['template', '1'], queryFn: fetchTemplate })
const q2 = useQuery({ queryKey: ['template', '1'], queryFn: fetchTemplate }) // deduped
const q3 = useQuery({ queryKey: ['template', '1'], queryFn: fetchTemplate }) // deduped
```

If you need per-request batching in React Server Components:

```typescript
// lib/loaders.ts (React cache() = per-request memoization)
import { cache } from 'react'

const getTemplate = cache(async (id: string): Promise<Template> => {
  // React cache() memoizes per render tree — automatic DataLoader for RSC
  const { data } = await gqlClient.request(GetTemplateDocument, { id })
  return data.emailTemplate
})
```

### Gotcha: `await` before `.load()` silently breaks batching

JS `DataLoader` (Node.js / GraphQL.js resolvers) only batches calls issued **within the
same event-loop tick**. If a resolver `await`s anything before `.load()` (permission check,
feature-flag lookup, other async work), the batch window closes before `.load()` runs —
batching collapses back to N individual loads. **No error, no warning** — only lost
performance, typically invisible until monitoring catches it (see "Monitoring N+1" below).

```typescript
// BAD — await checkPermission() moves .load() to another tick; batch collapses
async function resolveTemplate(parent, args, context) {
  await checkPermission(context.user, parent.templateId) // <- this await kills batching
  return templateLoader.load(parent.templateId)
}

// GOOD — .load() as the last (or only) await in the resolver
function resolveTemplate(parent, args, context) {
  return templateLoader.load(parent.templateId) // sync call; batch window stays open
}
```

If the permission check must be async (e.g. external auth service), either resolve it
synchronously from already-loaded context, or use DataLoader's `batchScheduleFn` option
to extend the batch window with a configurable delay instead of relying on the natural
tick. This is a top-cited anti-pattern across GraphQL performance sources (see
`graphql-review-checklist.md`, item "`await` before `.load()`").

## Monitoring N+1

### Sentry / OpenTelemetry tracing

```typescript
// Enable DB and HTTP spans on the NestJS BFF
// After deploy: Performance → Database / HTTP → look for groups of 50+ identical queries
// to the Laravel API or to the database
```

### Custom query-count logging

```typescript
// In a Nest interceptor or service: log when a single operation fans out too far
const before = this.metrics.httpCallCount
const result = await this.fetchEmails(filters)
const after = this.metrics.httpCallCount

if (after - before > 10) {
  this.logger.warn('Possible N+1 detected', {
    callCount: after - before,
    operation: info.fieldName,
  })
}
```

## Batch size strategy

```typescript
class EmailDataLoader {
  // 100 is a reasonable batch size
  // Most SQL engines and REST batch APIs handle IN(100) / ?ids=... fine
  // Larger batches = fewer round-trips, but bigger result sets in memory
  private static readonly BATCH_SIZE = 100

  async loadBatch(ids: string[]): Promise<Email[]> {
    const chunks = chunk(ids, EmailDataLoader.BATCH_SIZE)
    const results: Email[] = []

    for (const part of chunks) {
      // Each chunk = 1 SQL IN (?) or 1 Laravel batch endpoint call
      const partial = await this.emailService.findByIds(part)
      results.push(...partial)
    }

    return results
  }
}
```

## DataLoader lifecycle on Apollo Server / NestJS

On Node.js, batching closes at the end of the current event-loop tick (or after
`batchScheduleFn`). Apollo Server and NestJS GraphQL resolve a "level" of the selection
set, collect pending promises, then move to the next level — DataLoader is designed for
exactly that model.

**Practical review rule:** every nested field that fans out to Laravel or SQL by ID
should either (a) use a request-scoped DataLoader, or (b) be eager-joined / batch-fetched
up front. Do not copy PHP-only batching APIs into Nest resolvers; use the `dataloader`
npm package with request scope.

Keep all loaders registered in one place (context factory or a `DataloadersModule`) so
reviewers can inventory them easily — especially once you pass ~10 loaders.

## When NOT to use DataLoader

| Scenario | Why | Alternative |
|----------|-----|-------------|
| Simple always-needed 1:1 relation | Eager join is simpler | JOIN / `include` on the list query |
| Relation always loaded for this operation | Batch fetch in the parent service | Single API call with includes |
| Small collections (&lt; 20 items) | DataLoader overhead not justified | Load everything at once |
| Pure REST single-resource handlers | DataLoader is for GraphQL field resolvers | N/A |

## Checklist: N+1 prevention at review time

- [ ] Every nested field in the GraphQL schema has either a DataLoader or an eager/batch fetch
- [ ] `max_query_depth` (or equivalent validation rule) is set (blocks exponential nesting)
- [ ] Sentry / OTel performance tracing is on and monitors DB + Laravel HTTP spans
- [ ] List/collection resolvers join or batch common relations used by the UI
- [ ] Unit tests for each DataLoader assert result order matches input order
