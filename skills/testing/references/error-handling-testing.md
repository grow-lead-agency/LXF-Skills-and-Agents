# Error Handling Testing

> Tests for the exact bugs that caused production issues: silent failures, empty toasts,
> broken error boundaries, missing Sentry events.

---

## Centralized Error Classifier

Every app should have one error classifier. Test it thoroughly:

```typescript
// src/lib/errors.ts
export type AppError = {
  status: number
  message: string    // User-facing
  logToSentry: boolean
}

export function classifyError(status: number, serverMessage?: string): AppError {
  switch (status) {
    case 401:
      return { status: 401, message: 'You must be signed in.', logToSentry: false }
    case 403:
      return { status: 403, message: 'You do not have permission for this action.', logToSentry: false }
    case 422:
      return { status: 422, message: serverMessage || 'Please check the submitted data.', logToSentry: false }
    case 429:
      return { status: 429, message: 'Too many requests. Please try again later.', logToSentry: false }
    default:
      return { status, message: 'Something went wrong. Please try again.', logToSentry: true }
  }
}
```

### Test the classifier

```typescript
import { describe, it, expect } from 'vitest'
import { classifyError } from '@/lib/errors'

describe('classifyError', () => {
  it('401 → sign-in message, no Sentry', () => {
    const err = classifyError(401)
    expect(err.message).toBe('You must be signed in.')
    expect(err.logToSentry).toBe(false)
  })

  it('403 → permission denied, no Sentry', () => {
    const err = classifyError(403)
    expect(err.message).toContain('permission')
    expect(err.logToSentry).toBe(false)
  })

  it('422 → uses server message if provided', () => {
    const err = classifyError(422, 'Email is required')
    expect(err.message).toBe('Email is required')
    expect(err.logToSentry).toBe(false)
  })

  it('422 → fallback message when no server message', () => {
    const err = classifyError(422)
    expect(err.message).toContain('submitted data')
  })

  it('500 → generic message, YES Sentry', () => {
    const err = classifyError(500)
    expect(err.message).toContain('went wrong')
    expect(err.logToSentry).toBe(true)
  })

  it('502 → generic message, YES Sentry', () => {
    const err = classifyError(502)
    expect(err.logToSentry).toBe(true)
  })

  it('never returns undefined or empty message', () => {
    for (const status of [400, 401, 403, 404, 422, 429, 500, 502, 503]) {
      const err = classifyError(status)
      expect(err.message).toBeTruthy()
      expect(err.message).not.toBe('undefined')
      expect(err.message.length).toBeGreaterThan(5)
    }
  })
})
```

---

## Error Boundary Testing (RTL)

```typescript
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi } from 'vitest'
import * as Sentry from '@sentry/nextjs'
import ErrorPage from '@/app/error'

// Mock Sentry
vi.mock('@sentry/nextjs', () => ({
  captureException: vi.fn(),
}))

// Component that throws for testing
function ThrowingChild({ shouldThrow }: { shouldThrow: boolean }) {
  if (shouldThrow) throw new Error('Test render error')
  return <div>OK</div>
}

describe('Error Boundary (app/error.tsx)', () => {
  it('renders fallback UI with user-friendly message', () => {
    const error = new Error('Something broke')
    const reset = vi.fn()

    render(<ErrorPage error={error} reset={reset} />)

    // Must show user-friendly message, NOT the raw error
    expect(screen.getByText(/something went wrong/i)).toBeInTheDocument()
    expect(screen.queryByText('Something broke')).not.toBeInTheDocument()
  })

  it('shows retry button that calls reset()', async () => {
    const user = userEvent.setup()
    const error = new Error('Transient error')
    const reset = vi.fn()

    render(<ErrorPage error={error} reset={reset} />)

    const retryButton = screen.getByRole('button', { name: /try again/i })
    await user.click(retryButton)

    expect(reset).toHaveBeenCalledOnce()
  })

  it('reports error to Sentry', () => {
    const error = new Error('Should be reported')
    const reset = vi.fn()

    render(<ErrorPage error={error} reset={reset} />)

    expect(Sentry.captureException).toHaveBeenCalledWith(error)
  })

  it('does NOT expose stack trace to user', () => {
    const error = new Error('Secret error')
    error.stack = 'at secretFunction (secret-file.ts:42)'
    const reset = vi.fn()

    render(<ErrorPage error={error} reset={reset} />)

    expect(screen.queryByText(/secretFunction/)).not.toBeInTheDocument()
    expect(screen.queryByText(/secret-file/)).not.toBeInTheDocument()
  })
})
```

---

## Toast Message Testing (Sonner)

```typescript
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { toast } from 'sonner'
import { BookingForm } from '../booking-form'

// Mock sonner
vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
    loading: vi.fn(),
    dismiss: vi.fn(),
  },
}))

describe('Toast messages', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('shows success toast after creating booking', async () => {
    const user = userEvent.setup()
    render(<BookingForm />)

    // ... fill form and submit
    await user.click(screen.getByRole('button', { name: /submit/i }))

    await waitFor(() => {
      expect(toast.success).toHaveBeenCalledWith(
        expect.stringContaining('Booking')
      )
    })
  })

  it('shows error toast with readable message on API failure', async () => {
    // Mock API to return 500
    server.use(
      http.post('/api/bookings', () =>
        HttpResponse.json({ error: 'DB error' }, { status: 500 })
      )
    )

    const user = userEvent.setup()
    render(<BookingForm />)
    await user.click(screen.getByRole('button', { name: /submit/i }))

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalled()
      // CRITICAL: message must be user-readable, not raw error
      const message = vi.mocked(toast.error).mock.calls[0][0]
      expect(message).not.toBe('undefined')
      expect(message).not.toBe('DB error') // Never expose internal errors
      expect(message).toMatch(/went wrong|error|try again/i) // User-facing message
    })
  })

  it('shows validation toast on empty form submit', async () => {
    const user = userEvent.setup()
    render(<BookingForm />)

    await user.click(screen.getByRole('button', { name: /submit/i }))

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith(
        expect.stringMatching(/required|fill in/i)
      )
    })
  })
})
```

---

## Server Action Error Shape

Server Actions must NEVER throw to the client. Test the return shape:

```typescript
import { describe, it, expect } from 'vitest'
import { createBooking } from '../actions/create-booking'
import { createMockSupabase } from '@/test/mocks/supabase'

describe('Server Action error shape', () => {
  it('returns { success: true, data } on success', async () => {
    // ... mock successful DB call
    const result = await createBooking(validInput)

    expect(result).toHaveProperty('success', true)
    expect(result).toHaveProperty('data')
    expect(result).not.toHaveProperty('error')
  })

  it('returns { success: false, error: string } on failure', async () => {
    // ... mock DB failure
    const result = await createBooking(validInput)

    expect(result).toHaveProperty('success', false)
    expect(result).toHaveProperty('error')
    expect(typeof result.error).toBe('string')
    expect(result.error!.length).toBeGreaterThan(0)
  })

  it('never throws (catches all errors)', async () => {
    // ... mock catastrophic failure
    await expect(createBooking(validInput)).resolves.toBeDefined()
    // If this rejects, the Server Action is throwing to client — BAD
  })
})
```

---

## Sentry Capture Verification

Test that Sentry.captureException is called in the right places:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'
import * as Sentry from '@sentry/nextjs'

vi.mock('@sentry/nextjs', () => ({
  captureException: vi.fn(),
  captureMessage: vi.fn(),
  setUser: vi.fn(),
  init: vi.fn(),
}))

describe('Sentry integration', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('captures 500 errors', async () => {
    // Trigger code that hits a 500
    await handleApiError(new Response('error', { status: 500 }))

    expect(Sentry.captureException).toHaveBeenCalledOnce()
  })

  it('does NOT capture 401 errors (expected)', async () => {
    await handleApiError(new Response('unauthorized', { status: 401 }))

    expect(Sentry.captureException).not.toHaveBeenCalled()
  })

  it('does NOT capture 422 validation errors', async () => {
    await handleApiError(new Response('invalid', { status: 422 }))

    expect(Sentry.captureException).not.toHaveBeenCalled()
  })

  it('includes user context when available', async () => {
    // Simulate authenticated error
    await handleAuthenticatedError(new Error('DB failed'), { userId: 'u-1' })

    expect(Sentry.captureException).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({
        extra: expect.objectContaining({ userId: 'u-1' }),
      })
    )
  })
})
```

---

## Pattern: "Every Catch Block Has a Test"

Audit your codebase:

```bash
# Find all catch blocks
grep -rn 'catch' src/ --include='*.ts' --include='*.tsx' | grep -v 'test' | grep -v 'node_modules'
```

For each catch block, verify:
1. It logs the error (`console.error` or `Sentry.captureException`)
2. It returns a user-readable message (not raw error)
3. It has a corresponding test that triggers the catch path

---

## Pattern: Testing Human-Readable Error Messages

```typescript
it('all user-facing error messages are readable', () => {
  const testCases = [
    { status: 400, expected: /request|invalid/i },
    { status: 401, expected: /sign/i },
    { status: 403, expected: /permission/i },
    { status: 404, expected: /found|not found/i },
    { status: 422, expected: /data|fill/i },
    { status: 429, expected: /many|later/i },
    { status: 500, expected: /went wrong|error/i },
  ]

  for (const { status, expected } of testCases) {
    const err = classifyError(status)
    expect(err.message).toMatch(expected)
    expect(err.message).not.toBe('undefined')
    expect(err.message).not.toBe('[object Object]')
    expect(err.message.length).toBeGreaterThan(5)
    expect(err.message.length).toBeLessThan(200) // Not a stack trace
  }
})
```

---

## Sources

- https://oneuptime.com/blog/post/2026-01-15-handle-api-errors-gracefully-react/view
- https://certificates.dev/blog/error-handling-in-react-with-react-error-boundary
- https://docs.sentry.io/product/sentry-basics/integrate-frontend/generate-first-error/
