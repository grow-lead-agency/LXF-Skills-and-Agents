# AI Code Review

> How to validate AI-generated code before production. AI code is often syntactically
> polished but semantically wrong around authorization, persistence, and state.

---

## Core Principle

**Treat AI-generated code as untrusted by default.** Review it with the same scrutiny as
code from an unknown external contributor. The model does not know the application's policy
boundaries, MySQL constraints, GraphQL contract, or data sensitivity unless the repository
makes them explicit.

---

## Security Review Checklist

Run this checklist on every AI-generated PR before merge.

### Laravel Auth and Policies

- [ ] Every protected controller/action calls `$this->authorize(...)`, `Gate::authorize(...)`,
      or uses the corresponding `can` middleware
- [ ] Policies derive the actor from the authenticated request, never from a submitted `user_id`
- [ ] Form Requests validate and authorize external input before application services run
- [ ] Mass assignment does not permit ownership, role, tenant, or status fields unintentionally
- [ ] Admin endpoints are protected server-side, not merely hidden in React
- [ ] Policy tests cover owner, non-owner, privileged role, and unauthenticated requests

### NestJS GraphQL Auth

- [ ] Protected resolvers use the expected auth guard and authorization layer
- [ ] Resolver code reads the actor from GraphQL context, not from mutation input
- [ ] Field resolvers do not expose data the actor cannot read through the parent query
- [ ] Input DTOs use validation decorators and the global validation pipe is enabled
- [ ] Domain errors map to stable GraphQL errors without stack traces or internal SQL messages
- [ ] Guard and resolver integration tests run through the GraphQL execution boundary

### MySQL and Data Integrity

- [ ] Queries use Eloquent/query bindings or parameterized SQL; no string interpolation
- [ ] Foreign keys, unique constraints, and nullability enforce the same invariants as validation
- [ ] Multi-write operations use a transaction and test rollback on the second-write failure
- [ ] Read-modify-write flows handle concurrency (locking, unique constraint, or idempotency key)
- [ ] Migrations are reversible where the project requires rollback
- [ ] API/GraphQL responses select explicit fields and do not serialize internal columns by accident

### Data Exposure and Input Validation

- [ ] No secrets or server-only environment variables enter the Vite bundle
- [ ] Error responses omit exception class names, SQL, file paths, and stack traces
- [ ] Laravel inputs use Form Requests or explicit validation rules
- [ ] NestJS inputs use DTO validation; GraphQL scalars are not treated as sufficient validation
- [ ] File uploads validate type, size, content, and storage path
- [ ] URLs and identifiers are decoded, normalized, and authorized before use

### CORS and Headers

- [ ] Production CORS origins are explicit
- [ ] Credentials are allowed only for trusted origins
- [ ] nginx/application security headers are configured once and verified in an integration test
- [ ] The GraphQL endpoint does not expose introspection or playground contrary to project policy

---

## Common AI Mistakes

### 1. Authorization direction is inverted

```php
// AI WROTE THIS (wrong): blocks the owner and permits everyone else.
if ($booking->user_id === $request->user()->id) {
    abort(403);
}

// CORRECT: centralize the rule in BookingPolicy.
$this->authorize('delete', $booking);
$booking->delete();
```

### 2. Trusting client-provided ownership

```php
// AI WROTE THIS (wrong): caller chooses the owner.
Booking::create($request->validated()); // validated payload includes user_id

// CORRECT: derive ownership from the authenticated actor.
$booking = $request->user()->bookings()->create(
    $request->safe()->except('user_id')
);
```

The regression test must submit another user's ID and assert both `403/422` behavior and
`assertDatabaseMissing()` for the unauthorized row.

### 3. Resolver trusts a mutation input actor ID

```typescript
// AI WROTE THIS (wrong): userId is attacker-controlled.
@Mutation(() => Booking)
deleteBooking(@Args('id') id: string, @Args('userId') userId: string) {
  return this.bookingService.delete(id, userId)
}

// CORRECT: actor comes from authenticated GraphQL context.
@UseGuards(GqlAuthGuard)
@Mutation(() => Booking)
deleteBooking(@CurrentUser() actor: AuthenticatedUser, @Args('id') id: string) {
  return this.bookingService.deleteForActor(id, actor)
}
```

### 4. Application validation without a database invariant

```php
// Validation alone can race: two requests may both pass exists() before either insert.
if (!Booking::where('external_id', $externalId)->exists()) {
    Booking::create(['external_id' => $externalId]);
}
```

Back critical uniqueness with a MySQL unique index and translate duplicate-key failures into
the public domain error. Test two competing writes or at minimum assert the constraint exists
and the second insert fails predictably.

### 5. Transaction missing around related writes

```php
// AI WROTE THIS (wrong): partial state remains if item creation fails.
$order = Order::create($attributes);
$order->items()->createMany($items);

// CORRECT:
$order = DB::transaction(function () use ($attributes, $items) {
    $order = Order::create($attributes);
    $order->items()->createMany($items);
    return $order;
});
```

### 6. Missing `await` in the BFF

```typescript
// AI WROTE THIS (wrong): returns before mapping errors or applying output filtering.
const booking = this.laravelClient.createBooking(input)
return this.presenter.present(booking)

// CORRECT:
const booking = await this.laravelClient.createBooking(input)
return this.presenter.present(booking)
```

---

## Mutation Testing

Verify test quality by intentionally breaking one invariant at a time:

1. Invert a Laravel policy condition.
2. Remove `@UseGuards()` from a resolver.
3. Remove a MySQL unique constraint in an isolated test migration.
4. Delete a transaction wrapper.
5. Run the smallest relevant PHPUnit/Jest suite.
6. If tests still pass, restore the code and add the missing behavior test.

```bash
# Laravel policy + MySQL feature tests
php artisan test --filter=BookingAuthorizationTest

# NestJS resolver/guard tests
npm run test --workspace=bff -- booking.resolver
```

Automated mutation tools are optional; the gate is whether a realistic authorization or data
integrity defect makes the suite fail.

---

## Type and Static Analysis Audit

```bash
# PHP type and framework analysis
vendor/bin/phpstan analyse

# TypeScript type checking
npx tsc --noEmit

# Find new explicit any types outside tests/generated code
grep -rn ': any' bff/src frontend/src --include='*.ts' --include='*.tsx' \
  | grep -v '\.test\.' | grep -v generated

# Find swallowed promise rejections / empty catches for manual review
grep -rn 'catch.*{}\|\.catch(() => {})' bff/src frontend/src --include='*.ts' --include='*.tsx'
```

Static analysis is a gate, not proof of correct authorization or persistence behavior.

---

## AI-Generated Test Skepticism

When an AI writes tests, verify:

1. **The test fails when the policy/guard/constraint is broken.** A green test that never crosses
   the real boundary is not evidence.
2. **Authorization tests use at least two distinct users.** Reusing one actor hides ownership bugs.
3. **Laravel feature tests use MySQL when behavior depends on MySQL semantics.** SQLite can mask
   collation, locking, JSON, and constraint differences.
4. **Resolver tests cover guard integration.** Calling a resolver method directly bypasses NestJS
   guards unless the test explicitly invokes the framework boundary.
5. **Mocks match the Laravel/GraphQL contract.** Generated mocks often omit error extensions,
   pagination wrappers, or nullable fields.
6. **Assertions test externally visible behavior.** Prefer HTTP/GraphQL status, response shape,
   and committed database state over internal call counts.

---

## Review Workflow

1. Read the diff and identify changed trust boundaries and persisted invariants.
2. Run `vendor/bin/phpstan analyse`, `npx tsc --noEmit`, and lint.
3. Run focused PHPUnit and Jest/Vitest suites.
4. Review Laravel policy/Form Request coverage and NestJS guard/resolver coverage.
5. Verify MySQL constraints and transaction behavior against the migration.
6. Perform one mutation test on each critical authorization/data path.
7. Run the relevant Playwright journey before merge.

---

## Sources

- https://brightsec.com/blog/5-best-practices-for-reviewing-and-approving-ai-generated-code/
- https://docs.github.com/en/copilot/tutorials/review-ai-generated-code
- https://laravel.com/docs/11.x/authorization
- https://laravel.com/docs/11.x/database-testing
- https://docs.nestjs.com/security/authorization
