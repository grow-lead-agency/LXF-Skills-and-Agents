# Research Sources — GraphQL Skill

## 2026-07-17 — Deep rewrite (Apollo / NestJS BFF + React clients + review checklist + Spec Sept 2025)

Key sources:

**Context7 library IDs (primary, versioned):**
- `/nestjs/docs` — NestJS GraphQL code-first, Apollo driver, resolvers, guards
- `/apollographql/apollo-server` — Apollo Server validation, plugins, context
- `/graphql/graphql-js` — Deferred patterns, validation rules, execution model

**GraphQL Foundation (official best-practices track, as of 2026-07-17):**
- https://spec.graphql.org/September2025/ — current spec edition (@oneOf, Schema Coordinates, full Unicode)
- https://graphql.org/blog/2025-09-08-september-edition/ + https://graphql.org/blog/2025-09-04-multioption-inputs-with-oneof/
- https://graphql.org/learn/schema-design/ | /security/ | /performance/ | /pagination/ | /robust-applications/ | /schema-review/ | /debug-errors/ | /authorization/ | /caching/ | /global-object-identification/ | /response/

**Security:**
- https://cheatsheetseries.owasp.org/cheatsheets/GraphQL_Cheat_Sheet.html — OWASP GraphQL Cheat Sheet
- https://benjie.dev/graphql/trusted-documents — APQ ≠ trusted documents (Benjie Gillam, GraphQL WG)

**Client-side:**
- https://nearform.com/open-source/urql/docs/graphcache/normalized-caching/ — urql graphcache
- https://the-guild.dev/graphql/codegen/plugins/presets/preset-client — codegen client preset
- https://tanstack.com/query/v5/docs/framework/react/graphql — TanStack Query + GraphQL

**Vendor / community skills (discover — cherry-pick sources):**
- https://github.com/apollographql/skills — official Apollo agent skills (schema design, federation, security structure)
- https://www.apollographql.com/docs/graphos/schema-design/guides/errors-as-data-explained + /naming-conventions
- https://www.graphql-js.org/docs/testing-approaches/ | https://bubble.ro/2026/07/11/the-graphql-mistakes-youll-make-anyway/ | https://medium.com/@connect.hashblock/graphql-at-scale-9-anti-patterns-faster-fixes-5146a1db9db8

## 2026-07-15 — Delta refresh

Verified via Context7 (`/urql-graphql/urql`, `/dotansimha/graphql-code-generator`) + `npm view` (live registry).

**npm live versions checked (2026-07-15):**
- `graphql@17.0.2` (core spec package, major bump from the 16.x line assumed at skill creation)
- `graphql-request@7.4.0`
- `@graphql-codegen/cli@7.2.0`, `@graphql-codegen/typescript@6.1.0`, `@graphql-codegen/typescript-operations@6.1.0`, `@graphql-codegen/typescript-react-query@7.0.5` (still actively published, not deprecated)
- `@graphql-inspector/cli@6.0.8`
- `@escape.tech/graphql-armor@3.2.0`
- `urql@5.0.3` (peer `@urql/core@^6.0.0`) — major bump from the v4 shown in the client comparison table

**Drift found:** none in the NestJS BFF-facing content (DataLoader, security armor, federation
patterns are unaffected by client-library version bumps). Primary recommended React stack is
`graphql-request` + TanStack Query, which tracks current majors. A maintenance-era storefront
may still run `urql@4` — documented so the skill does not imply a forced urql v4→v5 bump.

## Official documentation (used when authoring)

| URL | Contents | Date |
|-----|----------|------|
| https://graphql.org/learn/ | GraphQL spec — queries, mutations, subscriptions, SDL | 2026-04-23 |
| https://docs.nestjs.com/graphql/quick-start | NestJS GraphQL — code-first, Apollo driver | 2026-04-23 |
| https://www.apollographql.com/docs/apollo-server/ | Apollo Server — validation, plugins, context | 2026-04-23 |
| https://github.com/graphql/dataloader | DataLoader — batching and caching | 2026-04-23 |
| https://relay.dev/graphql/connections.htm | Relay Cursor Connections spec | 2026-04-23 |

## Apollo Federation

| URL | Contents | Date |
|-----|----------|------|
| https://www.apollographql.com/docs/ | Apollo Federation v2 overview | 2026-04-23 |
| https://www.apollographql.com/docs/federation/ | Subgraph, supergraph, @key directive | 2026-04-23 |
| https://www.apollographql.com/docs/router/ | Apollo Router (Rust) configuration | 2026-04-23 |

## Client side

| URL | Contents | Date |
|-----|----------|------|
| https://github.com/jasonkuhrt/graphql-request | graphql-request README + examples | 2026-04-23 |
| https://the-guild.dev/graphql/codegen | graphql-codegen configuration + plugins | 2026-04-23 |
| https://tanstack.com/query/v5/docs/framework/react/graphql | TanStack Query + GraphQL integration | 2026-04-23 |
| https://formidable.com/open-source/urql/ | URQL overview | 2026-04-23 |

## Security

| URL | Contents | Date |
|-----|----------|------|
| https://escape.tech/graphql-armor/ | GraphQL Armor plugin | 2026-04-23 |
| https://the-guild.dev/graphql/inspector | GraphQL Inspector — schema diff | 2026-04-23 |
| https://owasp.org/www-project-web-security-testing-guide/ | OWASP GraphQL testing guide | 2026-04-23 |
