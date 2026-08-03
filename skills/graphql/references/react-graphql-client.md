# React GraphQL Client — TanStack + Apollo + URQL

## Client comparison

| | TanStack + graphql-request | Apollo Client | URQL |
|--|---------------------------|---------------|------|
| **Install size** | ~14kb (graphql-request) | ~40kb | ~20kb |
| **Setup overhead** | Minimal (if TanStack is already in the app) | Medium (ApolloProvider) | Low |
| **Normalized cache** | No — fine for dashboards | Yes — good for highly reactive apps | Partial (document cache; full via Graphcache) |
| **Subscriptions** | Via EventSource / SSE or custom transport | Apollo Link WebSocket/SSE | Builtin (subscriptions) |
| **Optimistic updates** | TanStack Query natively | Apollo natively | URQL natively |
| **SSR / React frameworks** | React Query Hydration boundary | NextSSRLink / Apollo SSR helpers | SSR exchange |
| **DevTools** | TanStack Query DevTools | Apollo DevTools | URQL Devtools |
| **TypeScript** | graphql-codegen (excellent) | graphql-codegen (excellent) | graphql-codegen (excellent) |
| **Default recommendation for this stack** | ✅ **Use this** for admin / BFF-facing React apps | When subscriptions dominate | Alternative when you need normalized cache without Apollo weight |

**Default choice: TanStack Query + graphql-request.** Many React admin apps already use TanStack
Query for REST against the NestJS BFF — add graphql-request as the GraphQL transport and keep
the same query / mutation / cache model. For storefront-style apps that need entity
normalization across list/detail, prefer urql + Graphcache (see `urql-client.md`).

## Setup

```bash
# Install
npm install graphql-request graphql

# Codegen (dev dep)
npm install --save-dev @graphql-codegen/cli \
  @graphql-codegen/typescript \
  @graphql-codegen/typescript-operations \
  @graphql-codegen/typescript-react-query
```

```typescript
// lib/graphql-client.ts
import { GraphQLClient } from 'graphql-request'

const graphqlBaseUrl = import.meta.env.VITE_GRAPHQL_URL

if (!graphqlBaseUrl) {
  throw new Error('VITE_GRAPHQL_URL is required')
}

function createGqlClient(token?: string) {
  return new GraphQLClient(
    `${graphqlBaseUrl}/graphql`, // NestJS BFF GraphQL endpoint
    {
      headers: token
        ? { Authorization: `Bearer ${token}` }
        : {},
    }
  )
}

// Vite client-side default. Recreate the client with the current token after login/refresh.
export const gqlClient = createGqlClient()
export { createGqlClient }
```

## graphql-codegen configuration

```yaml
# codegen.yml
schema:
  - 'http://localhost:3000/graphql':  # NestJS BFF local GraphQL
      headers:
        Authorization: 'Bearer ${CODEGEN_TOKEN}'

# Or from a committed schema file (offline / CI-friendly)
# schema: './schema.graphql'

documents:
  - 'src/**/*.graphql'
  - '!src/**/*.test.graphql'

generates:
  src/generated/graphql.ts:
    plugins:
      - typescript
      - typescript-operations
      - typescript-react-query
    config:
      reactQueryVersion: 5
      exposeQueryKeys: true           # exports query key factory
      exposeFetcher: true
      fetcher: '@/lib/graphql-client#gqlClient'
      addInfiniteQuery: true          # infinite scroll variants
      dedupeFragments: true
```

```json
// package.json scripts
{
  "scripts": {
    "codegen": "graphql-codegen --config codegen.yml",
    "codegen:watch": "graphql-codegen --config codegen.yml --watch"
  }
}
```

## Using generated hooks

### Query — collection with filters

```typescript
// Auto-generated hook from GetEmailsDocument
import { useGetEmailsQuery } from '@/generated/graphql'

function EmailsTable({ filters }: { filters: EmailFilters }) {
  const { data, isLoading, error } = useGetEmailsQuery(
    gqlClient,
    {
      filter: {
        recipient: filters.recipient,
        status: filters.status,
        createdAt: filters.dateFrom ? { after: filters.dateFrom } : undefined,
      },
      first: filters.pageSize ?? 20,
      after: filters.cursor,
    },
    {
      staleTime: 30_000,
      refetchInterval: filters.autoRefresh ? 10_000 : false,
    }
  )

  if (isLoading) return <TableSkeleton />
  if (error) return <ErrorAlert error={error} />

  return (
    <Table>
      {data?.emails.edges.map(({ node }) => (
        <EmailRow key={node.id} email={node} />
      ))}
    </Table>
  )
}
```

### Mutation with optimistic update

```typescript
import { useCreateEmailMutation, useGetEmailsQuery } from '@/generated/graphql'
import { useQueryClient } from '@tanstack/react-query'

function SendEmailButton() {
  const queryClient = useQueryClient()

  const { mutate, isPending } = useCreateEmailMutation(gqlClient, {
    onMutate: async (variables) => {
      // Optimistic update — add to cache immediately
      await queryClient.cancelQueries({ queryKey: useGetEmailsQuery.getKey({}) })
      const previous = queryClient.getQueryData(useGetEmailsQuery.getKey({}))

      queryClient.setQueryData(useGetEmailsQuery.getKey({}), (old: any) => ({
        ...old,
        emails: {
          ...old.emails,
          edges: [
            {
              node: {
                id: 'temp-' + Date.now(),
                status: 'QUEUED',
                recipient: variables.input.recipient,
              },
            },
            ...old.emails.edges,
          ],
        },
      }))

      return { previous }
    },
    onError: (error, _variables, context) => {
      // Rollback on error
      queryClient.setQueryData(useGetEmailsQuery.getKey({}), context?.previous)
    },
    onSettled: () => {
      // Invalidate for fresh data after the mutation
      queryClient.invalidateQueries({ queryKey: useGetEmailsQuery.getKey({}) })
    },
  })

  return (
    <Button onClick={() => mutate({ input: { /* ... */ } })} disabled={isPending}>
      {isPending ? 'Sending...' : 'Send email'}
    </Button>
  )
}
```

### Infinite scroll (cursor pagination)

```typescript
import { useInfiniteQuery } from '@tanstack/react-query'
import { GetEmailsDocument } from '@/generated/graphql'

function InfiniteEmailsList() {
  const { data, fetchNextPage, hasNextPage, isFetchingNextPage } = useInfiniteQuery({
    queryKey: ['emails', 'infinite'],
    queryFn: ({ pageParam }) =>
      gqlClient.request(GetEmailsDocument, {
        first: 20,
        after: pageParam,
      }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => {
      const { hasNextPage, endCursor } = lastPage.emails.pageInfo
      return hasNextPage ? endCursor : undefined
    },
  })

  const allEmails = data?.pages.flatMap(p => p.emails.edges.map(e => e.node)) ?? []

  return (
    <>
      {allEmails.map(email => <EmailRow key={email.id} email={email} />)}
      {hasNextPage && (
        <Button onClick={() => fetchNextPage()} disabled={isFetchingNextPage}>
          {isFetchingNextPage ? 'Loading...' : 'Load more'}
        </Button>
      )}
    </>
  )
}
```

## Fragment colocation

Fragments should live next to the components that use them:

```
src/
  components/
    emails/
      EmailRow.tsx
      EmailRow.graphql      # fragment lives next to the component
      EmailDetail.tsx
      EmailDetail.graphql
  pages/
    emails/
      EmailsPage.tsx
      EmailsPage.graphql    # page query composes fragments
```

```graphql
# components/emails/EmailRow.graphql
fragment EmailRowFields on Email {
  id
  recipient
  status
  sentAt
}
```

```graphql
# pages/emails/EmailsPage.graphql
# Imports the fragment from the component
query GetEmailsPage($first: Int, $after: String) {
  emails(first: $first, after: $after) {
    edges {
      node {
        ...EmailRowFields
      }
    }
    pageInfo {
      hasNextPage
      endCursor
    }
    totalCount
  }
}
```

```typescript
// components/emails/EmailRow.tsx
import type { EmailRowFieldsFragment } from '@/generated/graphql'

interface Props {
  email: EmailRowFieldsFragment
}

export function EmailRow({ email }: Props) {
  return (
    <TableRow>
      <TableCell>{email.recipient}</TableCell>
      <TableCell>
        <StatusBadge status={email.status} />
      </TableCell>
      <TableCell>{formatDate(email.sentAt)}</TableCell>
    </TableRow>
  )
}
```

## Client-side prefetch in a Vite app

```typescript
// main.tsx — prefetch route-critical data before the first render when needed
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { gqlClient } from '@/lib/graphql-client'
import { GetEmailsDocument } from '@/generated/graphql'
import { App } from './App'

const queryClient = new QueryClient()

await queryClient.prefetchQuery({
  queryKey: ['emails', 'list'],
  queryFn: () => gqlClient.request(GetEmailsDocument, { first: 20 }),
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </StrictMode>,
)
```

Most Vite apps can skip eager prefetch and let the generated hooks fetch when each route renders.
If a separate Next.js App Router frontend is introduced, use a server-created `QueryClient` plus
`dehydrate` / `HydrationBoundary`; treat that as framework-specific integration, not the default.

## Error handling

```typescript
// Executed operations may return HTTP 200 with field errors; request/transport failures may not.
import { GraphQLClient, ClientError } from 'graphql-request'

async function safeRequest<T>(doc: string, variables: Record<string, unknown>): Promise<T | null> {
  try {
    const data = await gqlClient.request<T>(doc, variables)
    return data
  } catch (error) {
    if (error instanceof ClientError) {
      // Inspect both the HTTP response status and any GraphQL errors.
      console.error('GraphQL HTTP status:', error.response.status)
      const gqlErrors = error.response.errors
      gqlErrors?.forEach(e => {
        console.error('GraphQL error:', e.message, e.extensions)
      })
      return null
    }
    throw error  // rethrow network errors
  }
}
```

## DevTools

```typescript
// AppProviders.tsx — add TanStack Query DevTools in Vite development mode
import type { PropsWithChildren } from 'react'
import { QueryClientProvider } from '@tanstack/react-query'
import { ReactQueryDevtools } from '@tanstack/react-query-devtools'
import { queryClient } from './query-client'

export function AppProviders({ children }: PropsWithChildren) {
  return (
    <QueryClientProvider client={queryClient}>
      {children}
      {import.meta.env.DEV && <ReactQueryDevtools initialIsOpen={false} />}
    </QueryClientProvider>
  )
}
```

## CI integration

```yaml
# CI — regenerate types and fail if generated output drifts
graphql-codegen:
  stage: build
  script:
    - npm run codegen
    - git diff --exit-code src/generated/  # Fail on uncommitted generated changes
  rules:
    - if: $CI_PIPELINE_SOURCE == "merge_request_event"

# GraphQL Inspector — catch breaking schema changes against the NestJS schema
graphql-inspector:
  stage: test
  script:
    - npx @graphql-inspector/cli diff
        $OLD_SCHEMA_URL
        $NEW_SCHEMA_URL
  allow_failure: false  # Breaking change = pipeline fail
```
