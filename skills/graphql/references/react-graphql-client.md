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
bun add graphql-request graphql

# Codegen (dev dep)
bun add -D @graphql-codegen/cli \
  @graphql-codegen/typescript \
  @graphql-codegen/typescript-operations \
  @graphql-codegen/typescript-react-query
```

```typescript
// lib/graphql-client.ts
import { GraphQLClient } from 'graphql-request'

function createGqlClient(token?: string) {
  return new GraphQLClient(
    `${process.env.NEXT_PUBLIC_GRAPHQL_URL}/graphql`, // NestJS BFF GraphQL endpoint
    {
      headers: token
        ? { Authorization: `Bearer ${token}` }
        : {},
    }
  )
}

// Client-side singleton
export const gqlClient = createGqlClient()

// Server-side (RSC) — with session token
export async function getServerGqlClient() {
  const session = await getSession() // your auth helper
  return createGqlClient(session?.token)
}
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
      page.tsx
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
import { FragmentType, useFragment } from '@/generated/graphql'
import { EmailRowFieldsFragmentDoc } from '@/generated/graphql'

interface Props {
  email: FragmentType<typeof EmailRowFieldsFragmentDoc>
}

export function EmailRow({ email: emailFragment }: Props) {
  const email = useFragment(EmailRowFieldsFragmentDoc, emailFragment)

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

## SSR (e.g. Next.js App Router)

```typescript
// app/emails/page.tsx — Server Component
import { getServerGqlClient } from '@/lib/graphql-client'
import { GetEmailsDocument } from '@/generated/graphql'
import { HydrationBoundary, dehydrate, QueryClient } from '@tanstack/react-query'
import { EmailsTable } from './EmailsTable'

export default async function EmailsPage() {
  const queryClient = new QueryClient()
  const serverClient = await getServerGqlClient()

  // Prefetch on the server
  await queryClient.prefetchQuery({
    queryKey: ['emails', 'list'],
    queryFn: () => serverClient.request(GetEmailsDocument, { first: 20 }),
  })

  return (
    // HydrationBoundary passes prefetched data to the client
    <HydrationBoundary state={dehydrate(queryClient)}>
      <EmailsTable />  {/* Client Component — uses useGetEmailsQuery */}
    </HydrationBoundary>
  )
}
```

## Error handling

```typescript
// GraphQL returns HTTP 200 even on errors → always inspect the errors field
import { GraphQLClient, ClientError } from 'graphql-request'

async function safeRequest<T>(doc: string, variables: Record<string, unknown>): Promise<T | null> {
  try {
    const data = await gqlClient.request<T>(doc, variables)
    return data
  } catch (error) {
    if (error instanceof ClientError) {
      // GraphQL errors (validation, permission, not found)
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
// app/layout.tsx — add TanStack Query DevTools
import { ReactQueryDevtools } from '@tanstack/react-query-devtools'

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html>
      <body>
        {children}
        {process.env.NODE_ENV === 'development' && (
          <ReactQueryDevtools initialIsOpen={false} />
        )}
      </body>
    </html>
  )
}
```

## CI integration

```yaml
# CI — regenerate types and fail if generated output drifts
graphql-codegen:
  stage: build
  script:
    - bun run codegen
    - git diff --exit-code src/generated/  # Fail on uncommitted generated changes
  rules:
    - if: $CI_PIPELINE_SOURCE == "merge_request_event"

# GraphQL Inspector — catch breaking schema changes against the NestJS schema
graphql-inspector:
  stage: test
  script:
    - bunx @graphql-inspector/cli diff
        $OLD_SCHEMA_URL
        $NEW_SCHEMA_URL
  allow_failure: false  # Breaking change = pipeline fail
```
