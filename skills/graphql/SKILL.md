---
name: graphql
description: >-
  GraphQL full-coverage skill — queries, mutations, subscriptions, schema design,
  N+1 / DataLoader, security, federation, and client integration. Applied stack:
  NestJS 11 code-first GraphQL BFF (@nestjs/graphql + Apollo Server 5) in front of a
  Laravel 11 backend, consumed by React 18/19 (Vite) clients. Includes a review
  checklist against real-world anti-patterns.
  Activate for: graphql, graphql schema, graphql query, graphql mutation, graphql
  subscription, graphql resolver, graphql dataloader, n+1 graphql, apollo client,
  apollo server, apollo federation, relay graphql, urql, graphcache, graphql-codegen,
  nestjs graphql, code first graphql, schema first graphql, graphql bff, graphql
  typescript, graphql nodejs, graphql vs rest, graphql authorization, graphql rate
  limiting, graphql caching, persisted queries, trusted documents, subgraph,
  graphql testing, graphiql, graphql review, graphql best practices, graphql
  anti-patterns, errors as data, oneOf, schema coordinates, tanstack query graphql,
  react graphql, graphql armor, query complexity, query depth limiting, relay
  pagination cursor, gateway graphql, graphql microservices.
  NOT for: gRPC (mention as an alternative), tRPC (TypeScript-only ecosystem —
  mention but do not route here), REST-only integrations.
---

# GraphQL — Full Coverage Reference

GraphQL is a query language for APIs and a runtime for fulfilling those queries. Instead of fixed
endpoints (REST), the client specifies exactly what it needs — nothing more, nothing less. The
server returns data in the exact shape of the query.

**Applied stack in this project:** React 18 admin + React 19 storefront (Vite) → **NestJS 11
GraphQL BFF** (code-first, `@nestjs/graphql` + Apollo Server 5) → Laravel 11 backend (REST /
internal services). The BFF owns the GraphQL schema; Laravel stays REST.

---

## 1. When GraphQL — decision tree

### When YES (GraphQL wins)

| Scenario | Why GraphQL |
|----------|-------------|
| **BFF / aggregator layer** | 1 request instead of N REST calls — the primary use case of a GraphQL BFF |
| **Mobile + bandwidth sensitive** | Client says exactly what it wants, no over-fetching |
| **Complex nested queries** | Order → Payment → Customer in 1 query without extra endpoints |
| **Real-time subscriptions** | `graphql-ws` subscriptions over WebSocket |
| **Admin with complex filtering** | Typed filter input object instead of 5 untyped URL query params |
| **Rapid frontend iteration** | Frontend changes its queries without backend changes |

### When NO (REST wins)

| Scenario | Why REST |
|----------|----------|
| **Service-to-service calls** | REST has clear idempotency semantics (POST = create) |
| **Webhooks (email/payment/shipping providers)** | External providers send REST, not GraphQL |
| **Public partner API** | OpenAPI tooling is more universal, better SDK generation |
| **Simple CRUD without nesting** | GraphQL overhead is not justified |
| **CDN caching is critical** | REST GET caches trivially, GraphQL POST does not (APQ mitigates) |
| **Team does not know GraphQL** | Learning curve → REST is the safer choice for an MVP |

### Architecture context for this stack

- **React clients talk GraphQL only to the BFF.** The NestJS BFF resolves queries by calling
  Laravel (REST) and any other internal services, then composes the response.
- **Laravel stays REST.** Do not add a second GraphQL server on the PHP side — one graph, owned
  by the BFF, is the contract for all frontends.
- **Service-to-service and webhooks stay REST** — GraphQL is the client-facing contract, not the
  internal transport.

---

## 2. Core concepts

### Query / Mutation / Subscription

```graphql
# QUERY — reading data (idempotent)
query GetInvoice($id: ID!) {
  invoice(id: $id) {
    id
    amount
    status
    customer {
      name
      email
    }
  }
}

# MUTATION — writes / actions (side effects)
mutation SendEmail($input: CreateEmailInput!) {
  createEmail(input: $input) {
    email {
      id
      status
    }
  }
}

# SUBSCRIPTION — real-time stream (over WebSocket or SSE)
subscription OnPaymentReceived($orderId: ID!) {
  paymentStatusChanged(orderId: $orderId) {
    orderId
    status
    receivedAt
  }
}
```

### Schema Definition Language (SDL)

SDL is the vendor-neutral way to describe a GraphQL schema. In a code-first NestJS setup the SDL
file is **generated** from TypeScript classes (`autoSchemaFile`) — you never write it by hand,
but you review it in PRs and diff it in CI.

```graphql
# Built-in scalar types
scalar String
scalar Int
scalar Float
scalar Boolean
scalar ID

# Custom scalars (for specific formats)
scalar DateTime
scalar UUID
scalar Decimal

# Object type
type Email {
  id: ID!           # ! = non-null (required)
  recipient: String!
  subject: String!
  status: EmailStatus!
  template: EmailTemplate
  sentAt: DateTime
  createdAt: DateTime!
}

# Enum
enum EmailStatus {
  QUEUED
  SENT
  FAILED
  BOUNCED
}

# Interface — polymorphism
interface Node {
  id: ID!
}

# Union — one of several types
union SearchResult = Email | Invoice | Customer

# Input type — for mutations
input CreateEmailInput {
  recipient: String!
  subject: String!
  templateId: ID!
  variables: String
}

# Relay Connection (cursor pagination)
type EmailConnection {
  edges: [EmailEdge!]!
  pageInfo: PageInfo!
  totalCount: Int!
}

type EmailEdge {
  node: Email!
  cursor: String!
}

type PageInfo {
  hasNextPage: Boolean!
  hasPreviousPage: Boolean!
  startCursor: String
  endCursor: String
}
```

### Resolvers (NestJS code-first)

```typescript
// email.resolver.ts — thin resolver: marshal arguments, delegate to a service
import { Resolver, Query, Args, ID } from '@nestjs/graphql';

@Resolver(() => Email)
export class EmailResolver {
  constructor(private readonly emailService: EmailService) {}

  @Query(() => Email, { nullable: true })
  async email(@Args('id', { type: () => ID }) id: string): Promise<Email | null> {
    return this.emailService.findById(id); // never business logic inline
  }
}
```

### Variables and Fragments

```graphql
# Variables — parameterize queries (ALWAYS via variables, never string interpolation)
query GetEmailsFiltered($recipient: String, $status: EmailStatus, $first: Int = 10) {
  emails(recipient: $recipient, status: $status, first: $first) {
    edges {
      node {
        ...EmailFields
      }
    }
  }
}

# Fragment — reusable field selection
fragment EmailFields on Email {
  id
  recipient
  status
  sentAt
}
```

---

## 3. Schema design best practices

### Relay Connection pattern (cursor pagination)

Relay Connections are the de-facto standard for pagination in GraphQL.

```graphql
query GetEmails {
  emails(first: 20, after: "cursor_abc") {
    edges {
      node {
        id
        recipient
        status
      }
      cursor
    }
    pageInfo {
      hasNextPage
      endCursor
    }
    totalCount
  }
}
```

**Why cursor instead of offset:** offset pagination breaks under concurrent inserts (page 2
returns duplicates or skips records). A cursor is stable — it always continues where it left off.

### Global object identification (Node interface)

```graphql
interface Node {
  id: ID!
}

type Email implements Node {
  id: ID!
  # ...
}

# Enables refetching any object by its global ID
query {
  node(id: "RW1haWw6NTUwZTg0MDA...") {
    ... on Email {
      recipient
      status
    }
  }
}
```

### Mutation payload pattern

```graphql
# Always return a payload object, not the bare type
type CreateEmailPayload {
  email: Email           # null on error
  errors: [UserError!]!  # empty on success
}

type UserError {
  field: String          # which field caused the error
  message: String!
}

mutation CreateEmail($input: CreateEmailInput!) {
  createEmail(input: $input) {
    email {
      id
    }
    errors {
      field
      message
    }
  }
}
```

**Why:** Business failures should be represented as typed payload data so clients can handle them
without parsing generic messages. Root-level `errors` represent request or execution failures;
field errors after execution commonly arrive with HTTP 200, while parse, validation, auth,
transport, and server failures may use 4xx/5xx. Clients must inspect both status and payload.

### Errors-as-data — Result Type union (stronger variant of the payload)

```graphql
# Typed error states instead of a generic UserError — the client gets an exhaustive switch
union CreateUserResult = CreateUserSuccess | ValidationError | EmailAlreadyTaken

type CreateUserSuccess { user: User! }
type ValidationError { fieldErrors: [FieldError!]! }
type EmailAlreadyTaken { suggestedAction: String! }

mutation { createUser(input: $input) {
  __typename
  ... on CreateUserSuccess { user { id } }
  ... on ValidationError { fieldErrors { field message } }
  ... on EmailAlreadyTaken { suggestedAction }
}}
```

**The dividing line:** a business state the client reacts to with DIFFERENT UI → errors-as-data
(union/payload). Server-side failures (auth, timeout, bug) → top-level `errors` array. Never mix
them — a validation error in the top-level `errors` forces the client to pattern-match message
strings.

### Spec September 2025 — what is new

The first new spec edition since 2021: **`@oneOf` input unions** (exactly one field of the input
type — solves "polymorphic input" without the optional-everything anti-pattern; supported by
GraphQL.js 16+), **Schema Coordinates** (machine-readable references like `Type.field` — a
foundation for tooling/AI agents), extended deprecation, full Unicode. ⚠️ `@defer`/`@stream` are
STILL not in the spec — they are implementation extensions; do not build a portable schema on them.

### Nullability strategy

```graphql
# STRICT (recommended for new schemas)
type Email {
  id: ID!           # non-null: always present
  recipient: String!
  sentAt: DateTime  # nullable: can be null (not sent yet)
  failureReason: String  # nullable: present only in FAILED status
}

# Anti-pattern: everything nullable = client must defensively null-check every field
type Email {
  id: ID          # wrong — ID is always present
  recipient: String  # wrong — recipient is required
}
```

**Rule: non-null by default + only 4 valid reasons for a nullable field:**
1. The data is genuinely optional (user may not have filled it in)
2. Partial failure — the field depends on an EXTERNAL service (don't fail the whole query
   because one dependency is down)
3. Permission-based visibility (field visible only to some roles)
4. Semantic meaning of "not set yet" (`sentAt` before sending)

**Lists: always `[Type!]!`, never `[Type]`** — an empty list instead of null/mixed-null arrays.

### Deprecation instead of versioning

```graphql
# CORRECT: deprecated directive, not a v2 schema
type Email {
  id: ID!
  recipient: String!
  recipientEmail: String @deprecated(reason: "Use `recipient` instead. Will be removed 2027-01.")
}

# WRONG: schema versioning
# /api/v1/graphql  (old schema)
# /api/v2/graphql  (new schema)
# → duplicated logic, clients must migrate all at once
```

---

## 4. NestJS code-first BFF (applied stack)

NestJS with `@nestjs/graphql` in **code-first** mode: TypeScript classes + decorators are the
source of truth; the SDL schema is generated (`autoSchemaFile`) and committed for diffing.

### Setup

```bash
npm install @nestjs/graphql @nestjs/apollo @apollo/server graphql
```

```typescript
// app.module.ts
import { GraphQLModule } from '@nestjs/graphql';
import { ApolloDriver, ApolloDriverConfig } from '@nestjs/apollo';
import { join } from 'path';
import { EmailModule } from './email/email.module';
import { EmailService } from './email/email.service';
import { createLoaders } from './graphql/loaders';

@Module({
  imports: [
    GraphQLModule.forRootAsync<ApolloDriverConfig>({
      driver: ApolloDriver,
      imports: [EmailModule],       // EmailModule must export EmailService
      inject: [EmailService],
      useFactory: (emailService: EmailService) => ({
        autoSchemaFile: join(process.cwd(), 'src/schema.gql'), // generated SDL — commit + diff in CI
        sortSchema: true,             // deterministic output → clean diffs
        graphiql: process.env.NODE_ENV !== 'production', // IDE only in dev
        introspection: process.env.NODE_ENV !== 'production',
        context: ({ req }) => ({
          req,
          loaders: createLoaders(emailService), // explicit dependency, fresh loaders per request
        }),
      }),
    }),
  ],
})
export class AppModule {}
```

### Object types and resolvers

```typescript
// email.model.ts
import { ObjectType, Field, ID, registerEnumType } from '@nestjs/graphql';

export enum EmailStatus {
  QUEUED = 'QUEUED',
  SENT = 'SENT',
  FAILED = 'FAILED',
  BOUNCED = 'BOUNCED',
}
registerEnumType(EmailStatus, { name: 'EmailStatus' });

@ObjectType()
export class Email {
  @Field(() => ID)
  id: string;

  @Field()
  recipient: string;

  @Field(() => EmailStatus)
  status: EmailStatus;

  @Field({ nullable: true })
  sentAt?: Date;
}
```

```typescript
// email.resolver.ts
import { Resolver, Query, Mutation, Args, ResolveField, Parent, Context, ID } from '@nestjs/graphql';

@Resolver(() => Email)
export class EmailResolver {
  constructor(private readonly emailService: EmailService) {}

  @Query(() => Email, { nullable: true })
  email(@Args('id', { type: () => ID }) id: string) {
    return this.emailService.findById(id);
  }

  @Mutation(() => CreateEmailPayload)
  createEmail(@Args('input') input: CreateEmailInput) {
    return this.emailService.create(input);
  }

  // Nested field — resolved via DataLoader, NOT via a per-item service call
  @ResolveField(() => EmailTemplate, { nullable: true })
  template(@Parent() email: Email, @Context('loaders') loaders: Loaders) {
    return loaders.template.load(email.templateId); // last statement, no await before it
  }
}
```

### The BFF resolves against Laravel (REST downstream)

```typescript
// email.service.ts — the BFF composes data from the backend API
@Injectable()
export class EmailService {
  constructor(private readonly http: HttpService) {}

  async findById(id: string): Promise<Email | null> {
    const { data } = await firstValueFrom(
      this.http.get(`${process.env.BACKEND_URL}/api/emails/${id}`),
    );
    return data ?? null;
  }

  // A batch endpoint on the Laravel side is what makes DataLoader effective:
  // GET /api/email-templates?ids=1,2,3 → one downstream call for N GraphQL fields
  async findTemplatesByIds(ids: readonly string[]): Promise<EmailTemplate[]> {
    const { data } = await firstValueFrom(
      this.http.get(`${process.env.BACKEND_URL}/api/email-templates`, {
        params: { ids: ids.join(',') },
      }),
    );
    return data;
  }
}
```

**Rule:** every nested field the BFF resolves from the backend needs a **batch endpoint** on the
Laravel side (accepting a list of IDs). Without it, DataLoader batches on the Node side but still
fires N downstream HTTP calls.

### Guards for auth (operation-level security)

```typescript
// gql-auth.guard.ts
@Injectable()
export class GqlAuthGuard extends AuthGuard('jwt') {
  getRequest(context: ExecutionContext) {
    return GqlExecutionContext.create(context).getContext().req;
  }
}

// Usage — per query/mutation, exactly like REST controllers
@UseGuards(GqlAuthGuard, RolesGuard)
@Roles('ADMIN')
@Mutation(() => CreateEmailPayload)
createEmail(@Args('input') input: CreateEmailInput) { ... }
```

**Gotcha:** guards run BEFORE the resolver — object-level checks ("is this the owner?") belong in
the service layer after the object is loaded, not in the guard.

---

## 5. Authentication and authorization

### Query depth + complexity limiting (MANDATORY for any exposed API)

Without limits an attacker can send:
```graphql
{ user { friends { friends { friends { friends { name } } } } } }  # O(n^k) queries!
```

Use **GraphQL Armor** with Apollo Server 5 (see `references/security-armor.md` for the full
security checklist):

```typescript
import { ApolloArmor } from '@escape.tech/graphql-armor';

const armor = new ApolloArmor({
  maxDepth: { enabled: true, n: 10 },
  costLimit: { enabled: true, maxCost: 1000 },
});
const protection = armor.protect();

GraphQLModule.forRoot<ApolloDriverConfig>({
  driver: ApolloDriver,
  // ...
  plugins: [...protection.plugins],
  validationRules: [...protection.validationRules],
});
```

### Field-level authorization

```typescript
// Sensitive field — resolve to null unless the caller has the role
@ResolveField(() => String, { nullable: true })
internalNote(@Parent() email: Email, @Context('req') req: Request): string | null {
  return req.user?.roles.includes('ADMIN') ? email.internalNote : null;
}
```

Prefer implementing the check in the service/authorization layer (reusable, testable) and keep
the resolver thin — the example above is the minimal inline form.

### Rate limiting per query cost

Network-level rate limiting (per HTTP request) is not enough for GraphQL — one request can carry
an arbitrarily expensive query. Count cost, not requests:

```typescript
// Sketch: compute query cost (Armor's cost analysis or your own visitor),
// then consume that many tokens from a per-client rate limiter.
const cost = estimateQueryCost(document);
const allowed = await rateLimiter.consume(clientId, cost);
if (!allowed) throw new GraphQLError('Rate limit exceeded', {
  extensions: { code: 'RATE_LIMITED' },
});
```

---

## 6. Performance patterns

See `references/dataloader-patterns.md` for the complete DataLoader guide.

### N+1 problem — the most common GraphQL perf issue

```graphql
# This query causes N+1 without DataLoader
query {
  emails(first: 100) {
    edges {
      node {
        recipient
        template { name }   # → 100 downstream calls for templates!
      }
    }
  }
}
```

### Solution: DataLoader (batch loading)

```typescript
import DataLoader from 'dataloader';

// Created PER REQUEST (in the GraphQL context factory) — never a singleton
export function createLoaders(emailService: EmailService) {
  return {
    template: new DataLoader<string, EmailTemplate | null>(async (ids) => {
      const templates = await emailService.findTemplatesByIds(ids);
      // IMPORTANT: return results in the same order as the input ids!
      const byId = new Map(templates.map((t) => [t.id, t]));
      return ids.map((id) => byId.get(id) ?? null);
    }),
  };
}
```

### Persisted queries (APQ)

```
# Without APQ: every request sends the whole query string (big query = big request)
POST /graphql
{"query": "query GetInvoice($id: ID!) { invoice(id: $id) { ... all fields ... } }"}

# With APQ: sends only a hash, the server looks the query up
POST /graphql
{"extensions": {"persistedQuery": {"version": 1, "sha256Hash": "abc123..."}}}
```

APQ reduces bandwidth after the initial hash negotiation, but requests remain POST by default.
Apollo Client can opt query hash requests into GET with `useGETForHashedQueries: true`; mutations
remain POST. That separate GET opt-in can make the hash URL CDN-cacheable when the CDN and server
use compatible cache headers.
⚠️ APQ is **not** a security measure — see "APQ vs. trusted documents" in
`references/security-armor.md`.

---

## 7. React clients

See `references/react-graphql-client.md` for the full client comparison and code generation
setup, and `references/urql-client.md` if you need a normalized cache.

### Default in this stack: TanStack Query + graphql-request (admin), plain fetch (storefront)

The admin already uses TanStack Query — GraphQL integration is minimal overhead. The storefront
talks to the BFF with plain `fetch`/`graphql-request`; no normalized cache client is required.

```bash
npm install graphql-request graphql
npm install -D @graphql-codegen/cli @graphql-codegen/typescript @graphql-codegen/typescript-operations @graphql-codegen/typescript-react-query
```

```typescript
// lib/graphql-client.ts
import { GraphQLClient } from 'graphql-request';

export const gqlClient = new GraphQLClient(
  `${import.meta.env.VITE_BFF_URL}/graphql`,
  {
    headers: () => ({
      Authorization: `Bearer ${getSessionToken()}`,
    }),
  },
);
```

```typescript
// hooks/useEmails.ts
import { useQuery } from '@tanstack/react-query';
import { gqlClient } from '@/lib/graphql-client';
import { GetEmailsDocument } from '@/generated/graphql'; // auto-generated

export function useEmails(filters: EmailFilters) {
  return useQuery({
    queryKey: ['emails', filters],
    queryFn: () => gqlClient.request(GetEmailsDocument, { filters }),
    staleTime: 30_000,
  });
}
```

### graphql-codegen configuration

```yaml
# codegen.yml
schema: src/schema.gql          # generated by the NestJS BFF (autoSchemaFile) — single source of truth
# Or against a running dev server:
# schema: http://localhost:3000/graphql

documents: 'src/**/*.graphql'   # .graphql files colocated with components

generates:
  src/generated/graphql.ts:
    plugins:
      - typescript
      - typescript-operations
      - typescript-react-query   # generates useQuery hooks

config:
  reactQueryVersion: 5
  fetcher:
    func: '@/lib/graphql-client#gqlClient'
    isReactHook: false
```

```bash
# Run codegen
npx graphql-codegen --config codegen.yml

# Watch mode during development
npx graphql-codegen --config codegen.yml --watch
```

### Fragment colocation (best practice)

```graphql
# components/EmailRow.graphql — colocated fragment
fragment EmailRowFields on Email {
  id
  recipient
  status
  sentAt
}
```

```typescript
// components/EmailRow.tsx — the fragment lives next to the component
import type { EmailRowFieldsFragment } from '@/generated/graphql';

export function EmailRow({ data }: { data: EmailRowFieldsFragment }) {
  return <tr><td>{data.recipient}</td><td>{data.status}</td></tr>;
}
```

### Apollo vs TanStack vs urql — which when

| | TanStack + graphql-request | Apollo Client | urql |
|--|---------------------------|---------------|------|
| **Setup** | Minimal (TanStack already in use) | Heavyweight | Lightweight |
| **Normalized cache** | No (sufficient for admin dashboards) | Yes (for highly reactive apps) | Optional (Graphcache) |
| **Subscriptions** | Via graphql-ws / EventSource manually | Apollo Link WebSocket | Built-in |
| **SSR** | React Query hydration | Framework-specific links | SSR exchange |
| **Bundle size** | ~14 kB | ~40 kB | ~20 kB |
| **This stack** | ✅ **Default choice** | Only if real-time subs dominate | If list/detail cache sync is needed |

Version note: `graphql` core is on the 16/17 line, `graphql-request` v7+, `@graphql-codegen/cli`
is actively maintained — always check `npm view <pkg> version` and peer dependencies before
installing; this table describes roles, not pinned versions.

---

## 8. Subscriptions (real-time)

Apollo Server 5 does not ship a subscription transport — use **`graphql-ws`** (WebSocket), which
`@nestjs/graphql` wires in via the `subscriptions` config:

```typescript
GraphQLModule.forRoot<ApolloDriverConfig>({
  driver: ApolloDriver,
  subscriptions: {
    'graphql-ws': true,
  },
  // ...
});
```

```typescript
// payment.resolver.ts
import { Subscription } from '@nestjs/graphql';
import { PubSub } from 'graphql-subscriptions';

const pubSub = new PubSub(); // in-memory — use a Redis-backed PubSub in production

@Resolver()
export class PaymentResolver {
  @Subscription(() => Payment, {
    filter: (payload, variables) => payload.paymentStatusChanged.orderId === variables.orderId,
  })
  paymentStatusChanged(@Args('orderId', { type: () => ID }) orderId: string) {
    return pubSub.asyncIterableIterator('paymentStatusChanged');
  }
}
```

Client side (`graphql-ws`):

```typescript
import { createClient } from 'graphql-ws';

const wsClient = createClient({ url: `${import.meta.env.VITE_BFF_WS_URL}/graphql` });

const unsubscribe = wsClient.subscribe(
  {
    query: `subscription($orderId: ID!) {
      paymentStatusChanged(orderId: $orderId) { orderId status receivedAt }
    }`,
    variables: { orderId },
  },
  {
    next: ({ data }) => setPayment(data?.paymentStatusChanged),
    error: console.error,
    complete: () => {},
  },
);
```

**Decision rule:** if you only need "poll a status until it changes", TanStack Query
`refetchInterval` is simpler and often good enough. Reach for subscriptions when latency matters
or many entities update concurrently.

---

## 9. Testing

### BFF — e2e test against the real schema (NestJS + supertest)

```typescript
// email.e2e-spec.ts
import { Test } from '@nestjs/testing';
import request from 'supertest';

describe('Email GraphQL', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
  });

  it('returns the emails collection', async () => {
    const res = await request(app.getHttpServer())
      .post('/graphql')
      .send({
        query: `query GetEmails {
          emails(first: 10) {
            edges { node { id recipient status } }
            totalCount
          }
        }`,
      })
      .expect(200);

    // HTTP 200 ≠ success — always assert errors BEFORE data
    expect(res.body.errors).toBeUndefined();
    expect(res.body.data.emails.totalCount).toBeDefined();
  });

  it('creates an email via mutation', async () => {
    const res = await request(app.getHttpServer())
      .post('/graphql')
      .send({
        query: `mutation CreateEmail($input: CreateEmailInput!) {
          createEmail(input: $input) {
            email { id status }
            errors { field message }
          }
        }`,
        variables: {
          input: {
            recipient: 'user@example.com',
            subject: 'Test email',
            templateId: '1',
          },
        },
      })
      .expect(200);

    expect(res.body.errors).toBeUndefined();
    expect(res.body.data.createEmail.email.status).toBe('QUEUED');
  });
});
```

### Schema validation in CI

```bash
# GraphQL Inspector — detects breaking changes
npx @graphql-inspector/cli diff \
  origin/main:src/schema.gql \
  src/schema.gql

# Exits 1 on breaking change → CI gate
```

### React side — MSW mock

```typescript
// test/mocks/handlers.ts
import { graphql, HttpResponse } from 'msw';

export const handlers = [
  graphql.query('GetEmails', () => {
    return HttpResponse.json({
      data: {
        emails: {
          edges: [
            { node: { id: '1', recipient: 'user@example.com', status: 'SENT' } },
          ],
          totalCount: 1,
        },
      },
    });
  }),

  graphql.mutation('CreateEmail', ({ variables }) => {
    return HttpResponse.json({
      data: {
        createEmail: {
          email: { id: '2', status: 'QUEUED' },
          errors: [],
        },
      },
    });
  }),
];
```

---

## 10. Tooling

| Tool | Where | Purpose |
|------|-------|---------|
| **GraphiQL / Apollo Sandbox** | dev endpoint | Interactive query editor, schema explorer |
| **GraphQL Voyager** | graphql-voyager | Visualize the schema as a graph (entity relationships) |
| **GraphQL Inspector** | `@graphql-inspector/cli` | Schema diff in CI, breaking change detection |
| **GraphQL Armor** | `@escape.tech/graphql-armor` | Security middleware (depth, complexity, introspection off) |
| **graphql-codegen** | `@graphql-codegen/cli` | Generates TypeScript types + React Query hooks from the schema |
| **Postman / Insomnia** | Desktop | GraphQL queries, collection management |

The GraphiQL / landing page must be **disabled in production** (see security reference) — enable
only when `NODE_ENV !== 'production'`.

---

## 11. Migration patterns

### REST → GraphQL via the BFF (incremental)

The BFF approach makes migration incremental — Laravel endpoints stay untouched:

1. Add a GraphQL type + resolver on the BFF wrapping an existing REST endpoint
   (nothing breaks — REST keeps serving existing consumers)
2. Refactor 1 frontend page to GraphQL (A/B compare latency vs the N-REST-calls version)
3. If results are good → migrate the remaining pages incrementally
4. Keep REST alive for webhooks, service-to-service calls, and external integrations

### Single graph → Federation

See `references/federation-guide.md`. Only relevant once you run **multiple GraphQL services
with overlapping entities** — a single BFF does not need federation.

---

## 12. Federation (Apollo Federation v2)

See `references/federation-guide.md` for the complete guide.

**When to adopt:** if the platform grows to many services with overlapping entities (Customer
exists in Emails, Payments, and Orders at once — federation composes them into one graph).

**Key concepts:**
- **Subgraph** = each service has its own GraphQL schema with `@key` directives
- **Supergraph** = a gateway component (Apollo Router) composes all subgraphs
- **`@key`** = the entity identifier across subgraphs

```graphql
# emails-service schema (subgraph)
extend schema @link(url: "https://specs.apollo.dev/federation/v2.0", import: ["@key"])

type Email @key(fields: "id") {
  id: ID!
  recipient: String!
  # Customer is defined in the customers-service subgraph
  customer: Customer!
}

type Customer @key(fields: "id", resolvable: false) {
  id: ID!
}
```

NestJS supports federation natively via `ApolloFederationDriver` — turning the BFF into a
subgraph is a configuration change, not a rewrite.

---

## 13. Common gotchas

1. **N+1 without DataLoader** — the most common perf issue. Every nested resolver = 1 downstream
   call × N items. Fix: DataLoader batching + batch endpoints on the backend.

2. **HTTP status is not enough** — field errors after successful GraphQL execution commonly return
   HTTP 200 with an `errors` array (and possibly partial `data`). Malformed requests, parse or
   validation failures, unsupported media types, authentication failures, and transport failures
   may return 4xx/5xx depending on the negotiated media type and server. Clients and tests must
   check both the HTTP status and `response.errors`.

3. **Query complexity DoS** — without depth/complexity limits an attacker can send an
   exponential query. `maxDepth: 10` and `costLimit: 1000` are MANDATORY for production.

4. **CDN caching** — GraphQL POST requests are not normally cached by shared CDNs. APQ only
   negotiates a query hash; it does not change the HTTP method by itself. For queries, configure
   the client separately with `useGETForHashedQueries: true` and compatible cache headers if GET
   caching is desired. Mutations must remain POST.

5. **Introspection in production** — lets an attacker map the whole schema. Disable or
   auth-guard it. Disable field suggestions ("Did you mean X?") along with it.

6. **Circular references** — `Author → Books → Author` without a depth limit can blow the stack.

7. **DataLoader as a singleton** — loaders cache per instance; a singleton leaks data between
   users and serves stale data. Always create loaders per request in the context factory.

8. **`await` before `.load()`** — silently breaks DataLoader batching (the batch window closes).
   `.load()` must be the last statement in the resolver. See
   `references/dataloader-patterns.md`.

9. **Generated schema drift** — with `autoSchemaFile`, the committed `schema.gql` must be
   regenerated in CI and diffed; a stale committed schema hides breaking changes from
   `graphql-inspector` and client codegen.

---

## 14. Reference files

| File | Content |
|------|---------|
| `references/graphql-review-checklist.md` | **Review checklist** — Iron Laws, anti-pattern table (real production findings), per-area checklists, CI gates, testing minimum |
| `references/dataloader-patterns.md` | N+1 problem, DataLoader in Node/NestJS, batch strategies, monitoring, the await-batching gotcha |
| `references/security-armor.md` | GraphQL Armor, OWASP checklist, query limits, introspection guard, rate limiting, APQ vs trusted documents, DoS protection |
| `references/react-graphql-client.md` | TanStack Query + graphql-request setup, codegen, fragment colocation, error handling, CI |
| `references/urql-client.md` | urql + Graphcache — exchanges, normalized cache keys, optimistic updates, codegen client-preset, fragment masking (optional — if you need a normalized cache) |
| `references/federation-guide.md` | Apollo Federation v2 — subgraph, supergraph, @key, Apollo Router, migration plan |

**Routing by task:** building/extending the BFF → SKILL.md §4–6 + `dataloader-patterns.md` +
`security-armor.md`. Frontend integration → `react-graphql-client.md` (+ `urql-client.md` if a
normalized cache is needed). Reviewing anything → `graphql-review-checklist.md`.

---

## 15. Sources

### Official documentation

- [graphql.org/learn](https://graphql.org/learn/) — GraphQL spec and concepts (official
  best-practices track: schema-design, security, performance, pagination)
- [GraphQL spec — September 2025 edition](https://spec.graphql.org/September2025/)
- [NestJS GraphQL docs](https://docs.nestjs.com/graphql/quick-start) — code-first, resolvers,
  federation
- [Apollo Server docs](https://www.apollographql.com/docs/apollo-server/)
- [Apollo Federation v2](https://www.apollographql.com/docs/federation/)
- [Relay Cursor Connections spec](https://relay.dev/graphql/connections.htm)

### Client side

- [graphql-request](https://github.com/jasonkuhrt/graphql-request) — lightweight client
- [graphql-codegen](https://the-guild.dev/graphql/codegen) — TypeScript type generation
- [TanStack Query + GraphQL](https://tanstack.com/query/v5/docs/framework/react/graphql)
- [urql docs](https://urql.dev/)

### Security

- [OWASP GraphQL Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/GraphQL_Cheat_Sheet.html)
- [GraphQL Armor](https://escape.tech/graphql-armor/)
- [GraphQL Inspector](https://the-guild.dev/graphql/inspector)
- [Trusted documents vs APQ](https://benjie.dev/graphql/trusted-documents)
