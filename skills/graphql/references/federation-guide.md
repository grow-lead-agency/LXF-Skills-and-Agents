# Apollo Federation v2 — Multi-service GraphQL

## What Federation is

Apollo Federation lets you split one large GraphQL schema into smaller "subgraphs" — each
service publishes its own schema and an **Apollo Router (supergraph)** composes them
automatically.

```
React app → Router (supergraph) → emails-service (subgraph)
                                → payments-service (subgraph)
                                → pdf-service (subgraph)
                                → inventory-service (subgraph)
                                → customers-service (subgraph, future)
```

**When to use:** the platform grows past roughly ~10 services with shared entities
(e.g. `Customer` exists in Emails, Payments, Orders — federation stitches those into one graph).

**Earlier phase:** a single NestJS GraphQL BFF that aggregates Laravel (or other) REST/API
endpoints is often enough for 4–6 services. Federation adds operational cost; adopt it when
entity sharing and ownership boundaries justify it.

## Key concepts

### @key directive — entity identity

```graphql
# emails-service/schema.graphql
extend schema
  @link(url: "https://specs.apollo.dev/federation/v2.0", import: ["@key", "@external"])

type Email @key(fields: "id") {
  id: ID!
  recipient: String!
  status: EmailStatus!
  # Reference to Customer owned by customers-service
  customer: Customer!
}

# Customer is a "stub" — defined in customers-service
type Customer @key(fields: "id", resolvable: false) {
  id: ID!
}
```

```graphql
# customers-service/schema.graphql (owns Customer type)
extend schema
  @link(url: "https://specs.apollo.dev/federation/v2.0", import: ["@key"])

type Customer @key(fields: "id") {
  id: ID!
  name: String!
  email: String!
  orders: [Order!]!
}

# Emails service can extend Customer with its own fields
extend type Customer @key(fields: "id") {
  id: ID! @external
  emails: [Email!]!  # New field contributed by emails-service
}
```

### Entity resolution (NestJS / Apollo)

```typescript
// emails-service: resolveReference for a Customer stub
import { Resolver, ResolveReference } from '@nestjs/graphql'

@Resolver('Customer')
export class CustomerEntityResolver {
  @ResolveReference()
  resolveReference(reference: { __typename: string; id: string }): { id: string } {
    // Router sends { __typename: 'Customer', id: '...' }
    // This subgraph returns the local representation needed for federation resolution
    return { id: reference.id }
  }
}
```

### Apollo Router vs Apollo Gateway

| | Apollo Router | Apollo Gateway (JS) |
|--|--------------|---------------------|
| **Implementation** | Rust (high-performance) | Node.js |
| **Latency** | ~10× lower | Higher overhead |
| **Memory** | ~50MB | ~200MB+ |
| **Config** | `router.yaml` | JavaScript code |
| **Enterprise features** | JWT auth, persisted queries, rate limit | Plugin system |
| **Recommended choice** | ✅ Apollo Router | Legacy; prefer Router |

## Apollo Router setup (Rust)

```yaml
# router.yaml
supergraph:
  # Composed supergraph schema (generated from subgraphs)
  path: ./supergraph.graphql

# Or dynamic uplink for managed federation
uplink:
  urls:
    - https://uplink.api.apollographql.com

headers:
  all:
    request:
      - propagate:
          matching: x-*  # Propagate custom headers into subgraphs

cors:
  origins:
    - https://app.example.com

limits:
  max_depth: 10
  max_height: 200
  max_root_fields: 20
  max_aliases: 30

telemetry:
  exporters:
    tracing:
      otlp:
        endpoint: http://otel-collector:4317
```

### Supergraph schema generation

```bash
# Install Apollo Rover CLI
npm install -g @apollo/rover

# Fetch subgraph schemas
rover subgraph introspect http://emails-service/graphql > emails.graphql
rover subgraph introspect http://payments-service/graphql > payments.graphql

# Compose supergraph schema
rover supergraph compose --config supergraph-config.yaml > supergraph.graphql
```

```yaml
# supergraph-config.yaml
federation_version: =2.0
subgraphs:
  emails:
    routing_url: http://emails-service/graphql
    schema:
      file: ./emails.graphql
  payments:
    routing_url: http://payments-service/graphql
    schema:
      file: ./payments.graphql
  pdf:
    routing_url: http://pdf-service/graphql
    schema:
      file: ./pdf.graphql
  inventory:
    routing_url: http://inventory-service/graphql
    schema:
      file: ./inventory.graphql
```

## NestJS as a Federation subgraph

NestJS code-first GraphQL with the Apollo Federation driver:

```bash
npm install @nestjs/graphql @nestjs/apollo @apollo/subgraph graphql
```

```typescript
// app.module.ts
import { GraphQLModule } from '@nestjs/graphql'
import { ApolloFederationDriver, ApolloFederationDriverConfig } from '@nestjs/apollo'

GraphQLModule.forRoot<ApolloFederationDriverConfig>({
  driver: ApolloFederationDriver,
  autoSchemaFile: {
    federation: 2,
  },
})
```

```typescript
// email.entity.ts — code-first entity with @key
import { ObjectType, Directive, Field, ID } from '@nestjs/graphql'

@ObjectType()
@Directive('@key(fields: "id")')
export class Email {
  @Field(() => ID)
  id: string

  @Field()
  recipient: string

  @Field()
  status: string
}
```

### Option: single NestJS BFF without Federation (earlier phase)

Keep one NestJS GraphQL BFF that calls Laravel REST (or other services) from field
resolvers / services. Auth, rate limits, and audit stay on the BFF. Move to Federation
when multiple teams own subgraphs and need independent schema deploys.

## Federation adoption plan

### Prerequisites

- [ ] GraphQL endpoint stable on the NestJS BFF (or first subgraphs)
- [ ] React clients use GraphQL for primary list/detail queries
- [ ] Subscriptions / realtime path (if any) is stable
- [ ] Roughly 8+ services with clear entity ownership

### Migration steps

1. **Add Federation dependencies to each subgraph service**
   ```bash
   npm install @nestjs/graphql @nestjs/apollo @apollo/subgraph
   ```

2. **Add @key directives on shared entities**
   ```graphql
   type Email @key(fields: "id") { ... }
   type Payment @key(fields: "orderId") { ... }
   ```

3. **Run Apollo Router as a new service**
   ```bash
   # Container image
   FROM ghcr.io/apollographql/router:latest
   COPY router.yaml /dist/config/router.yaml
   COPY supergraph.graphql /dist/supergraph.graphql
   ```

4. **Point React clients at the Router instead of a single BFF**
   ```typescript
   // Was: NestJS BFF only
   // Now: supergraph entrypoint
   const gqlClient = new GraphQLClient('https://graphql.example.com/graphql')
   ```

5. **CI/CD: automatic supergraph composition**
   ```yaml
   # Example CI job
   compose-supergraph:
     stage: build
     script:
       - rover supergraph compose --config supergraph-config.yaml > supergraph.graphql
       - docker build -t graphql-router .
       # Push image + deploy
   ```

## Shared entities — cross-service extensions

```graphql
# orders-service — owns Order
type Order @key(fields: "id") {
  id: ID!
  amount: Decimal!
  status: OrderStatus!
}

# payments-service — extends Order with payment info
extend type Order @key(fields: "id") {
  id: ID! @external
  payment: Payment  # Field contributed by payments service
}

# emails-service — extends Order with email history
extend type Order @key(fields: "id") {
  id: ID! @external
  emailHistory: [Email!]!  # Field contributed by emails service
}
```

The React client can then query:

```graphql
query OrderDetail($orderId: ID!) {
  order(id: $orderId) {
    id
    amount
    status
    # Resolved from payments-service
    payment {
      status
      receivedAt
      qrCode
    }
    # Resolved from emails-service
    emailHistory {
      subject
      status
      sentAt
    }
  }
}
```

Apollo Router automatically fans the query out into parallel calls to both services.

## Managed Federation (Apollo GraphOS)

Apollo offers cloud-managed federation — subgraphs report schemas to Apollo, Apollo composes
the supergraph and distributes it to routers.

**Recommendation for many teams:** self-hosted Apollo Router (not managed), when:
- Schemas may describe sensitive structures (compliance preference for in-cluster composition)
- GraphOS enterprise pricing is hard to justify
- ~10 services are still manageable with Rover compose in CI

Revisit managed federation if multi-team schema publishing and schema checks become the bottleneck.

Sources: https://www.apollographql.com/docs/federation/, https://www.apollographql.com/docs/router/, https://docs.nestjs.com/graphql/federation
