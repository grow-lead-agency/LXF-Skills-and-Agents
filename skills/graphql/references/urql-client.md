# urql — GraphQL client for React storefronts

Reference for `urql` on the React client. **urql@4** is still a common production baseline for
headless e-commerce storefronts (urql 4.x + `@urql/exchange-graphcache` 6.x + optional
`next-urql`). **urql@5 / `@urql/core`@6** is current (2026). Sibling:
`references/react-graphql-client.md` (TanStack Query + graphql-request for admin dashboards) —
cross-refs at the end.

---

## 1. When to choose urql (vs TanStack Query+graphql-request vs Apollo Client)

| | urql | TanStack Query + graphql-request | Apollo Client |
|--|------|-----------------------------------|----------------|
| **Install size** | ~20kb | ~14kb | ~40kb |
| **Normalized cache** | Optional (`@urql/exchange-graphcache`) | No | Yes, always on |
| **Cache default** | Document cache (without Graphcache) | Query-key cache (REST-like) | Normalized (cannot turn off) |
| **SSR (Next.js / RSC)** | `ssrExchange` + optional `next-urql` | `HydrationBoundary` | Apollo SSR helpers |
| **Exchange model** | Composable middleware (Wonka streams) | Query fn + hooks | Link chain |
| **When to choose** | Headless storefront; need list/detail entity sync without Apollo weight | Internal dashboard; REST-first team talking to NestJS BFF | Federation, subscriptions as a core feature |

**Storefront context:** urql is a strong default for headless e-commerce storefronts consuming
a NestJS GraphQL BFF (backed by Laravel). Graphcache keeps `ProductListPage` and
`ProductDetailPage` consistent without hand-written invalidation — a case where document-cache
alone is not enough and full Apollo is often heavier than needed. Admin dashboards often stay
on TanStack Query + graphql-request without normalization (REST-first team, no shared entity
cache) — see `references/react-graphql-client.md`.

---

## 2. Client setup + exchanges

An urql client is a pipeline of **exchanges** (Wonka streams) — order matters.

```typescript
// urql/createClient.ts
import { Client, fetchExchange, ssrExchange, dedupExchange } from 'urql'
import { cacheExchange } from './cache/cacheExchange' // Graphcache — replaces document cacheExchange

export function createUrqlClient(opts: { isServer: boolean; token?: string }) {
  const ssr = ssrExchange({ isClient: !opts.isServer })

  return new Client({
    url: `${process.env.NEXT_PUBLIC_GRAPHQL_URL}/graphql`, // NestJS BFF
    exchanges: [
      dedupExchange,   // dedupe identical in-flight operations
      cacheExchange,   // Graphcache (normalized) — see §3
      ssr,             // serialize server results, replay on the client
      fetchExchange,   // always last — actual network fetch
    ],
    fetchOptions: () => ({
      headers: opts.token ? { Authorization: `Bearer ${opts.token}` } : {},
    }),
  })
}
```

**Ordering rules:** `dedupExchange` first (must see the operation before the cache, otherwise
it also dedupes cache hits); cache exchange **before** `ssrExchange` and `fetchExchange`
(cache must answer before the network); `fetchExchange` always last (terminal, performs the
request). Custom exchanges (auth refresh, error logging) go **before** the cache (see every
operation) or **after** the cache / before fetch (see only cache misses), depending on purpose.

**`ssrExchange` for SSR frameworks:** on the server (`isClient: false`) it collects results;
`ssr.extractData()` is serialized into the payload; on the client (`isClient: true`) a new
`ssrExchange` with `initialState` "replays" those operations from cache instead of refetching —
analogous to `dehydrate` / `HydrationBoundary` in TanStack Query.

---

## 3. Graphcache — normalized cache

`@urql/exchange-graphcache` normalizes by `__typename` + a keyable field (default `id` / `_id`) —
builds keys like `Product:123`, stores scalars in `records` and related entity keys in `links`.
Independent queries that reference the same entity stay in sync automatically.

### Keys config — storefront pattern

```typescript
// urql/cache/cacheExchange.ts
import { cacheExchange } from '@urql/exchange-graphcache'
import schema from '../../schema-compressed.graphql.json'

export const cache = cacheExchange({
  schema, // introspected schema — required for fragment matching on union/interface types
  keys: {
    // Key by `uuid` rather than `id` when the schema exposes both — stay consistent across types
    Product: (data) => data.uuid as string,
    Category: (data) => data.uuid as string,
    Order: (data) => data.uuid as string,

    // Types WITHOUT a natural id/uuid — embedded/nested objects that only exist as part of a parent.
    // keys: () => null = "do not normalize; store as embedded record"
    Image: () => null,
    Money: () => null,

    // Mutation result types — same idea: explicitly "this is not an entity"
    CartModificationsResult: () => null,
    ComplaintItem: () => null,
  },
})
```

**Rule:** a type without a natural identifier that always exists only as part of a parent
(nested `Image`, mutation payload) gets `keys: () => null` explicitly. Without that, Graphcache
generates an auto embedded key (`Product:123.image`) and only logs a warning — it works, but
signals unfinished cache configuration.

### `__typename` — required, not optional

Graphcache (like Apollo/Relay) needs `__typename` on every selection to build keys. Missing
`__typename` in a fragment = **silent** cache-miss / duplicate data, not an error. Codegen must
inject `__typename` automatically — with `client-preset` (§4) via
`addTypenameSelectionDocumentTransform`. Critical when combined with persisted documents
(a hashed document without `__typename` silently breaks normalization — see §4 below and
`references/security-armor.md`).

### `resolvers` — client-side field resolvers

```typescript
resolvers: {
  Query: {
    // Serve product(uuid) from an existing cache entity without a network round-trip
    // if the product was already loaded by another query (e.g. from a list)
    product: (_parent, args) => ({ __typename: 'Product', uuid: args.uuid }),
  },
},
```

`undefined` from a resolver = "I don't know, go to the network" (cache miss). `null` = "there
really is no value" (valid cache hit). Easy to mix up — accidentally returning `null` instead of
`undefined` makes Graphcache believe it has an answer and the network request never fires.

### `updates` — cache invalidation after mutation

Mutations that change relations **outside their own selection set** need an explicit `updates`
handler:

```typescript
updates: {
  Mutation: {
    addToCart: (result, _args, cache) => {
      // mutation returns only CartModificationsResult, but we need to
      // refresh the `cart` query that the mutation does not see
      cache.updateQuery({ query: CartQueryDocument }, (data) => {
        if (!data || !result.addToCart) return data
        return { ...data, cart: mergeCartLine(data.cart, result.addToCart) }
      })
    },
  },
},
```

Mutations that return the full mutated entity in the same shape as the query that displays it
often need no `updates` at all — Graphcache writes through via the shared entity key. That is
why mutation return-shape discipline (`references/graphql-review-checklist.md` §2) matters twice
for urql: a mutation that returns only `Boolean` forces hand-written `updates` handlers everywhere.

### Optimistic updates

```typescript
optimistic: {
  addToCart: (args, cache, info) => ({
    __typename: 'CartModificationsResult',
    cart: {
      __typename: 'Cart',
      uuid: getCurrentCartUuid(cache),
      totalItems: getCurrentCart(cache).totalItems + args.input.quantity,
    },
  }),
},
```

Graphcache stores optimistic results in a separate "layer" above confirmed data. Multiple
concurrent optimistic mutations commit layers only together (never partially); queries that
depend on optimistic data pause refetch until the layer resolves — which prevents UI flicker
back to a stale state. That is why an in-flight mutation can look like a "frozen" query —
intended behavior, not a bug.

**When Graphcache vs document cache (default):** document cache is enough when you do not need
to share entities across queries (cache by exact operation+variables, bulk invalidation).
Graphcache when you need list/detail sync, optimistic UI, or infinite-scroll merge — the typical
e-commerce storefront case.

---

## 4. graphql-codegen — client-preset

`@graphql-codegen/client-preset` is the recommended path (replaces hand-wired
`typed-document-node` for application code — that plugin remains only for low-level use). Supports
urql / `@urql/core` natively.

```typescript
// codegen-config.ts
import type { CodegenConfig } from '@graphql-codegen/cli'

const config: CodegenConfig = {
  schema: 'schema.graphql', // exported from NestJS BFF
  documents: ['graphql/requests/**/*.graphql'],
  generates: {
    './graphql/generated/': {
      preset: 'client',
      presetConfig: {
        addTypenameSelectionDocumentTransform: true, // Graphcache must not lose __typename
        persistedDocuments: true, // trusted documents pattern — see references/security-armor.md
      },
      config: {
        scalars: { Money: 'string', Uuid: 'string' },
        avoidOptionals: true, // force explicit `| undefined` at call sites
      },
    },
  },
}
export default config
```

### Fragment masking

Headline feature of `client-preset` — a component declares its data dependency via a colocated
fragment; the parent **cannot** pass raw data to the child and must go through generated
`useFragment()` (rename to `getFragmentData()` to avoid ESLint "rules of hooks" false positives):

```typescript
// components/ProductCard.tsx
import { graphql, getFragmentData, type FragmentType } from '@/graphql/generated'

export const ProductCardFragment = graphql(`
  fragment ProductCardFragment on Product {
    __typename
    uuid
    name
    priceForSaleWithTax
  }
`)

export function ProductCard(props: { product: FragmentType<typeof ProductCardFragment> }) {
  const product = getFragmentData(ProductCardFragment, props.product)
  return <div>{product.name}</div>
}
```

The parent literally cannot "leak" fields it is not allowed to touch into the child — enforced
by the type system, not by review discipline. Testing masked components requires
`makeFragmentData()` — a plain object where a masked fragment type is expected is a compile
error, not a sneaky `as any`.

### Fragment colocation + conventions

```
graphql/requests/products/
  fragments/ListedProductFragment.graphql   # composes smaller fragments (Image, Price, ...)
  queries/ProductListQuery.graphql          # consumes ListedProductFragment
```

Fragments live next to the domain that consumes them, not in one central dump. Storefront
convention: "do not add a field the feature does not use"; "check existing hooks/fragments
before writing a new operation". Large storefronts often end up fragment-heavy on purpose
(dozens of domains, many fragments).

Naming: `{Entity}{Purpose}Query.graphql`, `{Action}{Entity}Mutation.graphql`,
`{Entity}Fragment.graphql` — operation name matches file name (enforced by convention, not lint;
a good candidate for a CI/ESLint rule as domain count grows).

---

## 5. Error handling on the client

### `CombinedError`

urql folds network and GraphQL errors into a single `CombinedError` on the operation result:

```typescript
const [result] = useQuery({ query: ProductQueryDocument, variables: { uuid } })

if (result.error) {
  if (result.error.networkError) {
    // transport/connection failed — request never completed on the server
  }
  if (result.error.graphQLErrors.length > 0) {
    // server returned 200 with an `errors` field — see partial data below
    result.error.graphQLErrors.forEach((e) => console.error(e.message, e.extensions?.code))
  }
}
```

### Partial data — `errors` and `data` at the same time

The GraphQL spec allows a response with **both** `data` and `errors` at once (field-level
error, other fields resolved successfully). urql does not special-case this for you —
`result.data` may be populated even when `result.error` is non-empty:

```typescript
// BAD — blanket-fail on any error discards legitimate partial data
if (result.error) return <ErrorPage />

// GOOD — inspect what is actually missing; render the rest
if (result.error && !result.data) return <ErrorPage />  // total failure
return (
  <div>
    <ProductName name={result.data?.product?.name} />
    {!result.data?.product?.reviews && <ReviewsUnavailableBanner />}
  </div>
)
```

### Retry strategy

`@urql/exchange-retry` for network-level retry with backoff — belongs **before** the cache
exchange (retry must wrap fetch, not cache-hit responses):

```typescript
import { retryExchange } from '@urql/exchange-retry'

retryExchange({
  initialDelayMs: 300,
  maxDelayMs: 5000,
  maxNumberAttempts: 3,
  retryIf: (err) => !!err.networkError, // do NOT retry GraphQL business-logic errors
})
```

`retryIf` must explicitly exclude `graphQLErrors` without `networkError` — retrying validation
or business-logic errors is a no-op or harmful, not recoverable.

### Errors-as-data union result types in the UI

For mutations designed as union result types (`CheckoutResponse = Order | InsufficientStockError |
InvalidPaymentMethodError` — see `references/graphql-review-checklist.md`), the client branches
on `__typename`, not on `result.error`:

```typescript
const [, checkout] = useMutation(CheckoutMutationDocument)

async function handleCheckout() {
  const { data } = await checkout({ paymentMethod })
  switch (data?.checkout.__typename) {
    case 'Order':
      router.push(`/order/${data.checkout.uuid}`)
      break
    case 'InsufficientStockError':
      showToast(`Insufficient stock: ${data.checkout.product.name}`)
      break
    case 'InvalidPaymentMethodError':
      showToast('Invalid payment method')
      break
    default:
      // Unknown union member — schema grew, client does not know the new type.
      // NEVER a silent no-op (graphql.org/learn robust-applications)
      showToast('Unexpected response, please try again')
  }
}
```

The `default` branch is mandatory: a long-lived deployed client against a schema that later
gains a union member must have an explicit fallback, otherwise the `switch` silently falls
through.

---

## 6. SSR / RSC patterns

`next-urql` was designed primarily for the Pages Router (`withUrqlClient` HOC). In the App
Router with RSC, a manual `ssrExchange` pattern (or prop-passing of initial data) is more common:

```typescript
// app/products/[slug]/page.tsx — Server Component
import { createUrqlClient } from '@/urql/createClient'
import { ProductQueryDocument } from '@/graphql/generated'
import { ProductDetail } from './ProductDetail' // Client Component

export default async function ProductPage({ params }: { params: { slug: string } }) {
  const client = createUrqlClient({ isServer: true })
  const result = await client.query(ProductQueryDocument, { slug: params.slug }).toPromise()
  if (!result.data) notFound()
  return <ProductDetail initialData={result.data} slug={params.slug} />
}
```

```typescript
// ProductDetail.tsx — Client Component
'use client'
import { useQuery } from 'urql'
import { ProductQueryDocument } from '@/graphql/generated'

export function ProductDetail({ initialData, slug }: Props) {
  const [result] = useQuery({ query: ProductQueryDocument, variables: { slug } })
  const data = result.data ?? initialData // rehydrate from RSC fetch; avoid remount refetch when possible
  return <div>{data.product?.name}</div>
}
```

Full Graphcache normalization between a server-side `client.query()` (new client per request)
and a client singleton requires explicit serialization (`ssrExchange().extractData()` →
client `ssrExchange({ initialState })`) — without it, RSC fetch and client cache run
independently. For read-only pages it is simpler to pass `initialData` as a prop (above) and
let client `useQuery` revalidate than to chase full SSR cache hydration.

---

## 7. Versions: urql@4 (production baseline) vs urql@5 / `@urql/core`@6 (current)

**A maintenance-era storefront may still run urql@4** — that is production reality, not an
urgent defect.

- **Public API stays stable across major versions** — `createClient` / `Client`, `Provider`,
  `useQuery` / `useMutation` / `useSubscription`, and the exchange pipeline model do not change
  conceptually between v4 and v5. A typical upgrade is "bump + smoke test", not a rewrite.
  **Always check the current CHANGELOG before bumping** (`npm view urql versions` + GitHub
  release notes) — `@urql/exchange-*` packages have their own versioning cycles that must stay
  compatible with core.
- **When to migrate:** a concrete new feature that v4 lacks and the project needs, a security
  patch, or a new peer dependency (React 19, `graphql` major) forces a stack-wide bump.
- **When NOT to migrate:** "it is newer" alone is not a reason. A maintenance branch with
  active daily development — force-upgrading a major client version mid-feature work risks
  regressions in Graphcache configuration (keys/resolvers/updates) for a cost nobody asked for.
  General principle: upgrades are managed projects with an impact map, not a side effect of
  "while we are here".
- **Practical test before a bump:** full codegen regen + E2E suite — often the only automated
  safety net on the storefront GraphQL contract (dedicated GraphQL operation unit tests on the
  client frequently do not exist).

---

## 8. Gotchas

- **Missing `__typename` = silent degradation, not an error.** Duplicate/stale data with no
  console message — first suspicion: fragment/query without `__typename`. Verify
  `addTypenameSelectionDocumentTransform` in the codegen config.
- **`keys: () => null` must be explicit for embedded types** — otherwise only a warning + auto
  embedded key, not an error, but a signal of unfinished cache config.
- **`resolvers` `undefined` vs `null` is easy to mix up.** `undefined` = cache miss (go to network),
  `null` = valid "really nothing". Accidental `null` silently suppresses the network request.
- **Optimistic layers pause refetch of concurrent queries** — "frozen" UI after a mutation is
  intended behavior, not a bug.
- **Persisted documents + Graphcache = required `addTypenameSelectionDocumentTransform`** — a
  hash-only document without `__typename` silently breaks normalization.
- **`retryExchange` without a `retryIf` guard also retries business-logic errors** — always
  limit to `networkError`.
- **SSR cache hydration between server and client needs explicit `extractData` / `initialState`
  transfer** — without it, duplicate fetch on hydrate; not an error, just a wasted round-trip.
- **`avoidOptionals: true` in codegen changes call-site ergonomics across the whole project at
  once** — not only for new code.

---

## Cross-reference

- `references/react-graphql-client.md` — TanStack Query + graphql-request for admin dashboards
  (no normalized cache, REST-first teams) — different choice for a different app shape; same
  codegen toolchain.
- `references/dataloader-patterns.md` — server-side N+1 prevention (relevant for the NestJS BFF
  the urql client consumes).
- `references/security-armor.md` (trusted documents / persisted queries) and
  `references/graphql-review-checklist.md` (errors-as-data, mutation return shape, client
  checklist) — related topics this reference builds on.

Sources: https://urql.dev, https://the-guild.dev/graphql/codegen
