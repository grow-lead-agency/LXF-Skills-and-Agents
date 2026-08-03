# AI Code Review

> How to validate AI-generated code before production. AI code is syntactically perfect
> but frequently semantically wrong — especially around auth, permissions, and state.

---

## Core Principle

**Treat AI-generated code as untrusted by default.** Review it with the same scrutiny
as code from an unknown external contributor. AI does not understand your security model,
business logic, or data sensitivity.

---

## Security Review Checklist

Run this checklist on every AI-generated PR before merge:

### Auth & Permissions

- [ ] Every Server Action checks `getUser()` / session at the top
- [ ] No Server Action trusts client-provided user IDs
- [ ] RLS policies don't use `USING (true)` on sensitive tables
- [ ] `WITH CHECK` clause exists on INSERT/UPDATE policies
- [ ] Middleware auth check doesn't have inverted logic (common AI mistake)
- [ ] Admin routes are protected (not just hidden from UI)

### Data Exposure

- [ ] No `SUPABASE_SERVICE_ROLE_KEY` in client components
- [ ] No `.env` values exposed via `NEXT_PUBLIC_` that shouldn't be
- [ ] No raw SQL in client-side code
- [ ] Error responses don't expose internal error messages/stack traces
- [ ] API responses don't include fields the user shouldn't see

### Input Validation

- [ ] All external input validated with Zod before processing
- [ ] No template literal SQL (use parameterized queries / Supabase client)
- [ ] File uploads validated (type, size, content)
- [ ] URL parameters decoded and validated

### CORS & Headers

- [ ] CORS not set to `Access-Control-Allow-Origin: *` in production
- [ ] Allowed origins list is explicit
- [ ] Security headers present (CSP, X-Frame-Options, etc.)

---

## Common AI Mistakes

### 1. Auth check direction is wrong

```typescript
// AI WROTE THIS (wrong):
if (user.role === 'admin') {
  return { error: 'Unauthorized' }  // Blocks admins!
}

// CORRECT:
if (user.role !== 'admin') {
  return { error: 'Unauthorized' }
}
```

### 2. Missing null check on user

```typescript
// AI WROTE THIS (wrong):
const { data: { user } } = await supabase.auth.getUser()
const bookings = await getBookings(user.id) // user can be null!

// CORRECT:
const { data: { user } } = await supabase.auth.getUser()
if (!user) return { success: false, error: 'You must be signed in.' }
const bookings = await getBookings(user.id)
```

### 3. Trusting client-provided data

```typescript
// AI WROTE THIS (wrong):
export async function deleteBooking(bookingId: string, userId: string) {
  // userId comes from client — user can delete anyone's booking!
  await supabase.from('bookings').delete().eq('id', bookingId).eq('user_id', userId)
}

// CORRECT:
export async function deleteBooking(bookingId: string) {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { success: false, error: 'Unauthorized' }
  // userId from server session, not client
  await supabase.from('bookings').delete().eq('id', bookingId).eq('user_id', user.id)
}
```

### 4. Overly broad RLS

```typescript
// AI WROTE THIS (wrong):
CREATE POLICY "allow_all" ON bookings FOR ALL USING (true);

// CORRECT:
CREATE POLICY "users_own_bookings" ON bookings
  FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "users_create_own" ON bookings
  FOR INSERT WITH CHECK (auth.uid() = user_id);
```

### 5. Async/await mistakes

```typescript
// AI WROTE THIS (wrong — missing await):
const data = supabase.from('bookings').select('*')
console.log(data) // Promise, not data!

// CORRECT:
const { data } = await supabase.from('bookings').select('*')
```

---

## Mutation Testing

Verify test quality by intentionally breaking code:

1. Change a condition (`===` → `!==`)
2. Remove an auth check
3. Change a return value
4. Run `npm test`
5. If tests still pass → tests are weak, fix them

```bash
# Manual mutation test flow:
# 1. Break something intentional
# 2. Run tests
npm test
# 3. If tests pass → BAD (test doesn't catch the bug)
# 4. Fix the code back
# 5. Write a better test that catches the mutation
```

For automated mutation testing, consider Stryker (optional — manual is usually enough).

---

## Type Safety Audit

```bash
# Find all 'any' types (should be zero in new code)
grep -rn ': any' src/ --include='*.ts' --include='*.tsx' | grep -v node_modules | grep -v '.test.'

# Find unchecked array access
grep -rn '\[0\]' src/ --include='*.ts' --include='*.tsx' | grep -v node_modules

# Find missing error handling
grep -rn '\.catch(() => {})' src/ --include='*.ts' --include='*.tsx'
```

---

## AI-Generated Test Skepticism

When an AI writes tests, verify:

1. **The test actually fails when you break the code** — change the implementation, run the test. If it still passes, the test is useless.
2. **Assertions test behavior, not implementation** — `expect(result.status).toBe('ok')` is good. `expect(mockFn).toHaveBeenCalledTimes(3)` might be testing implementation.
3. **Error paths are covered** — AI loves happy-path tests. Check for failure tests.
4. **Mocks match reality** — AI mocks may return shapes that don't match real API responses.

---

## Review Workflow

1. AI generates code
2. Run `npx tsc --noEmit && npm run lint` — catches syntax/type issues
3. Read the diff — focus on auth, permissions, data flow
4. Run security checklist above
5. Run mutation test on critical paths
6. Only then commit

---

## Sources

- https://brightsec.com/blog/5-best-practices-for-reviewing-and-approving-ai-generated-code/
- https://docs.github.com/en/copilot/tutorials/review-ai-generated-code
- https://www.mabl.com/blog/when-ai-writes-code-who-accountable-quality
