# GraphQL Review Checklist & Anti-Patterns

Checklist for code review of GraphQL code — schema, resolvers (NestJS code-first and general),
security config, React clients (urql / Apollo / codegen), and tests. Grounded in production
e-commerce / BFF patterns plus consolidated best practices 2025/2026 (graphql.org, OWASP,
Apollo GraphOS, The Guild).

Use this file as a **PR review checklist**, not a tutorial — for concept explanations see the
main `SKILL.md` and `references/dataloader-patterns.md`, `references/security-armor.md`,
`references/react-graphql-client.md`, `references/urql-client.md`.

---

## 1. Iron Laws

Seven hard rules. Violations are blocking review comments, not "nice to have".

1. **Resolvers delegate to services / facades; they never contain business logic.**
   Why: logic in a resolver cannot be unit-tested without instantiating GraphQL plumbing
   (`ResolveInfo`, args, context) and cannot be reused from another entry point (REST, CLI,
   worker). A resolver = argument marshalling + service call + return. Nothing more.

2. **HTTP 200 ≠ success — always assert `errors` BEFORE `data`.**
   Why: GraphQL returns `200 OK` for almost all application errors (exceptions are transport
   failures such as malformed JSON). A test or client that only checks status codes passes
   even when the entire operation failed.

3. **Deprecation = `deprecationReason` in the schema, not a runtime exception.**
   Why: GraphQL tooling (GraphiQL, IDE plugins, codegen, Apollo/urql devtools) reads
   `deprecationReason` and warns developers **before** they send a query. A runtime throw
   only surfaces after the request fails in production — with a generic message and no
   replacement guidance.

4. **Complexity scoring belongs on EVERY paginated field, not only on root queries.**
   Why: if root `Query.products(first:100)` has cost scoring but nested
   `Category.products(first:100)` does not, an attacker bypasses the limit by running the same
   expensive operation nested instead of at the root — exactly the case complexity limits exist for.

5. **Depth limit is always set together with complexity/cost limit — never only one.**
   Why: a complexity budget alone is a coarse total-cost cap; it does not constrain *shape*.
   A shallow-but-wide query (`posts(first:1000){ comments(first:1000){ author{name} } }`,
   depth 3) can trigger up to a million resolver calls and still pass under the complexity
   budget. Depth limiting and complexity/cost analysis complement each other; neither replaces
   the other.

6. **DataLoader `.load()` / batch call is the last statement in the resolver — no `await` before it.**
   Why: DataLoader only batches calls within the same event-loop tick. Any async work
   (e.g. `await checkPermission()`) before `.load()` closes the batch window and the request
   silently falls back to N individual loads — no error, only lost performance.

7. **Choose error classes by semantics, not by the nearest existing example.**
   Why: base error classes often hardcode an HTTP-semantic code in the constructor
   (e.g. `NotFoundError` → 404 / `NOT_FOUND`). If a validation error or invalid-token error
   inherits that class, the client gets a misleading signal — the code says "not found" while
   reality is "bad input" or "session expired".

---

## 2. Anti-pattern table

| Anti-pattern | Why it fails | Correct approach |
|---|---|---|
| Business logic (URL resolution, precedence rules, entity branching) directly in a resolver class | Untestable without GraphQL plumbing; mixes transport concerns (raw `variableValues`) with domain decisions | Extract into a service with typed inputs; resolver only marshalls args and calls |
| Deprecated field throws at runtime instead of `deprecationReason` in the schema | Client tooling does not warn early; dev discovers the problem only on a failed production request | `deprecationReason: "Use X instead"` on the field definition (in addition to the resolver, not instead of it) |
| Nested `Connection` fields (e.g. `Category.products`, `Brand.products`) without complexity scoring while the root field has it | The same expensive operation nested scores like a cheap flat field — exactly bypasses the limit complexity analysis should catch | Same `complexity` option / helper on all connection fields, not only root queries. Recurring health check: grep for connection return types without complexity |
| Error subclass inherits `NotFoundError` (or another semantically specific base) for a non-"not found" case (validation, expired token) | Base class hardcodes HTTP-semantic code; consumers branching on code get a misleading signal | Choose base class by actual error semantics; do not copy the nearest existing example |
| Complexity limit set, depth limit missing (default often disabled) | Complexity budget is coarse — misses shallow-but-wide queries with exponential resolver fan-out | Always set both together; depth 8–12 is a typical range for storefront / BFF schemas with self-referential depth |
| Zero dedicated GraphQL-layer tests — only E2E through the UI | Regressions in filtering, resolution, batch loaders, or mutation validation surface only in production or by chance via E2E | Functional tests against the GraphQL endpoint with real query strings — at least every custom mutation + error paths |
| `await` (any async work) before `.load()` in a resolver | Closes the DataLoader batch window; N+1 returns silently, no error, just slower | `.load()` as last statement; permission check sync, or `batchScheduleFn` with delay |
| Conflating APQ (Automatic Persisted Queries) with trusted documents / allowlisting | APQ is a bandwidth optimization — anyone can register a new operation at runtime; zero security value | Trusted documents = allowlist built at CI/build-time; server rejects unknown `documentId` with no runtime registration. See `security-armor.md` |
| Schema as a 1:1 mirror of a DB table or Laravel model ("Schema as ORM") — dozens of raw columns on `User` | Does not match what the client needs; leaks internal implementation into the public contract | Design the schema around client task-oriented use cases, not around database structure |
| Mutation returns only `Boolean` / a scalar instead of the mutated entity | Forces client refetch; breaks optimistic updates and normalized cache merge (urql Graphcache, Apollo InMemoryCache) | Return enough of the mutated entity for the client cache to update without a refetch |
| Missing `__typename` in a fragment / selection set | Normalized caches (urql/Apollo/Relay) need `__typename` + a keyable field to generate cache keys; without it, silent cache miss/duplication, not an error | Auto-inject `__typename` everywhere via a codegen transform (`addTypenameSelectionDocumentTransform` for urql) |
| Offset-based pagination (`first: N offset: M`) on a large / hot table | Inconsistent results under concurrent insert/delete; O(offset) scan at high offsets | Cursor-based pagination (opaque base64 cursor); Relay Connection shape as the default |
| Auth check hardcoded only inside a field resolver | Not reusable from other entry points; drift between resolvers where someone forgets the check (including at node level, not only edge level) | Delegate to the business-logic layer (service method), do not implement auth only in resolver code |
| No `extensions.code` error taxonomy — each resolver invents its own error shape | Client error handling becomes string-matching on messages instead of type-safe switch on codes | Define a small taxonomy (`USER_ERROR`, `VALIDATION_ERROR`, `INTERNAL_ERROR`) and apply it consistently; tests assert on codes, not message text |
| Codegen run manually, generated files committed to git | Schema drift discovered only by chance; committing generated code = merge-conflict noise and false confidence that "types are done" | Regenerate from `schema.graphql` in CI/on build; put `*.generated.tsx` / generated `types.ts` in `.gitignore` when regenerating at build |
| "Query-scope type anchoring" workaround (type declared as a Query field with no resolve, only so the compiler does not prune it) | Looks like a dead/bogus query field; an agent may delete it or (worse) copy it as "how to add a query field" | Document the pattern explicitly as a known trick; do not delete or copy without understanding |

---

## 3. Review checklist by area

### 3.1 Schema design

- [ ] Fields are nullable by default; `!` only as an explicit guarantee to the client — fields
      depending on an external service / join are nullable (failure of one dependency must not
      null the whole response)
- [ ] Lists are always `[Type!]!`, never `[Type]` (empty list instead of mixed-null list)
- [ ] New paginated connection fields (root and nested) have complexity scoring
- [ ] New root query fields have no verb prefix (`products`, not `getProducts`); mutations have
      a verb prefix (`addCustomer`, not `customerAdd`)
- [ ] Input types use the `Input` suffix; mutation output types use a consistent suffix
      (`Payload` / `Response`)
- [ ] Mutations return the mutated entity (or a union of outcomes), not bare `Boolean`
- [ ] Business-logic errors (user should react differently by error type) are errors-as-data
      (union / `userErrors` list); system errors (crash, DB outage) stay in top-level `errors`
- [ ] Deprecation has `deprecationReason` with a concrete replacement, not just "deprecated"

### 3.2 Resolvers (NestJS code-first / general)

- [ ] Resolver = validate args → call service → return; no domain logic inline
- [ ] DataLoader / batch loader called as the last step of the resolver, not after `await`
- [ ] Service / repository methods accept arrays of parent IDs and do one IN-clause or one
      Laravel batch call, not N calls in a loop
- [ ] New error classes inherit by real semantics (404 / `NOT_FOUND` only for "not found")
- [ ] Auth check is in the service layer (and Nest guards where appropriate), not only hardcoded
      in the resolver; checked at edge (list) and node (single entity) levels
- [ ] Input validation (class-validator / Zod / DTO pipes) runs before domain logic

### 3.3 Security config

- [ ] Depth limit **and** complexity/cost limit are both set (not only one)
- [ ] Complexity scoring on all connection / paginated fields, root and nested
- [ ] Introspection disabled in production with an explicit guard (not only a single boolean
      tied to a debug flag with no backup)
- [ ] Rate limiting runs in the business-logic layer, not only at network/WAF level (GraphQL's
      flexible field selection prevents a network-layer limiter from distinguishing cheap vs expensive)
- [ ] If the API is not for third-party clients with arbitrary queries → trusted documents
      (allowlist), not reliance on APQ or depth/complexity limits alone
- [ ] Field-suggestion hints ("Did you mean X?") disabled together with introspection in
      high-security contexts
- [ ] See the full checklist in `references/security-armor.md`

### 3.4 Client (urql / Apollo + codegen)

- [ ] `__typename` is part of every selection set (auto-injected via codegen transform)
- [ ] Fragments are colocated with the consuming component — not centralized, not duplicated
      fields across many queries
- [ ] Generated files (`*.generated.tsx`, `types.ts`) are not hand-edited and are regenerated
      on build/CI (or committed only if CI proves they match)
- [ ] Response is checked for `errors` BEFORE reading `data`; blanket-fail only on
      `errors.length > 0` is wrong — you must read `path` (partial success with field-level auth
      is a legitimate state)
- [ ] No force-unwrap of nullable fields (`data.user!.profile!.email!`) — optional chaining /
      guard patterns instead
- [ ] Unknown union / interface subtypes and unknown enum values have an explicit fallback branch,
      not only handling for today's known types (schemas grow)
- [ ] Cache-keyed types without a natural `id` / `uuid` have explicit `keys: () => null`
      (embedded object), not silent "ghost data" duplication

### 3.5 Tests

- [ ] Every custom mutation has a functional test against the real GraphQL endpoint (real query
      string, not a mocked resolver alone)
- [ ] Coverage includes: happy path, validation-error path (assert `extensions.code`, not message
      text), auth-denied path, follow-up query proving the write actually happened
- [ ] Pagination: first page (no `after`), middle page (valid cursor), last page
      (`hasNextPage: false`), invalid cursor (graceful fail, not 500), zero / over-limit size
- [ ] N+1 regression test — SQL / Laravel HTTP call counts measured and asserted under a
      threshold, not just "it feels fast"

---

## 4. CI gates

Automate in order from fastest to slowest:

1. **Syntax validation** — parse SDL (`buildSchema` equivalent), immediate feedback
2. **Schema diff / breaking-change classification** — diff current schema vs proposed
   (GraphQL Inspector or equivalent), classify **BREAKING** (removing field/type/argument,
   adding required argument, non-null → nullable) / **DANGEROUS** (new enum values, new
   union/interface members, new fields on input types) / **NON_BREAKING**. Breaking change
   without explicit approval = blocking fail.
3. **Composition validation** — only if the schema is federated (multiple subgraphs); otherwise skip
4. **Linting** — naming conventions, presence of descriptions/docs on new fields
5. **Downstream codegen check** — after regenerating `schema.graphql`, re-run codegen on the
   React client and verify typecheck passes (catches breaking changes schema-diff may miss
   because the client actually uses that operation)
6. **Deploy gate** — schema check before deploy (Rover-style "revalidate all persisted
   documents against the candidate schema" when trusted documents are in use — safe field
   removal becomes "revalidation passed" instead of guessing)

CODEOWNERS on schema files for shared/sensitive domains; escalate breaking changes to a
broader review, not only the PR author.

---

## 5. Testing minimum

Three complementary layers, not competing ones:

| Layer | What it verifies | When to use |
|---|---|---|
| **Unit** | Resolver / service functions in isolation, mocked `(parent, args, context, info)` | Business-logic edge cases, error handling — fast feedback |
| **Integration** | `graphql()` against a real schema (no HTTP server) — variables, fragments, nested selections | Default layer for new operations; catches schema↔resolver wiring bugs |
| **E2E** | Real HTTP request against a running NestJS server — transport, auth middleware, real data sources (Laravel) | Critical user flows only, not the primary test layer (expensive, slow) |

**Mandatory minimum before merging a non-trivial GraphQL change:**

- New/changed mutation → at least 1 integration test (happy path) + 1 error-path test
- New resolver with its own logic (not a thin pass-through) → unit test on that logic
- New/changed DataLoader or batch loader → test asserting SQL / HTTP call count (N+1 regression)
- Change in auth/authorization logic → tests for authorized **and** unauthorized access
- Schema change (new field, type change) → schema-diff CI gate must pass (see §4)

**Anti-patterns to catch in review:** tests that only assert `response.status_code == 200` and
never check `errors`; tests with a wide selection set (30 fields) that assert only on 3 of them
(breaks on every unrelated change); tests asserting on literal error message text instead of
`extensions.code`.

Sources: https://graphql.org/learn/, https://cheatsheetseries.owasp.org/cheatsheets/GraphQL_Cheat_Sheet.html, https://www.graphql-js.org/docs/testing-approaches/, https://www.apollographql.com/docs/graphos/schema-design/guides/errors-as-data-explained, https://benjie.dev/graphql/trusted-documents
