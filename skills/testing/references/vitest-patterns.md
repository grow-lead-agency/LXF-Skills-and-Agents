# Vitest Patterns

> Unit + integration test patterns for a React + Vite stack with a REST/GraphQL API layer.

---

## Vitest Config (React + Vite)

Use `assets/vitest.config.react.ts` as template. Key settings:

```typescript
// vitest.config.ts
import { defineConfig } from 'vitest/config'
import tsconfigPaths from 'vite-tsconfig-paths'

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    environment: 'happy-dom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/__tests__/**/*.{test,spec}.{ts,tsx}'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      exclude: ['src/test/**', '**/*.d.ts', '**/types.ts'],
      thresholds: { lines: 70, functions: 70 },
    },
  },
})
```

---

## Standard Test Structure

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'

describe('ModuleName', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('functionName', () => {
    it('should return expected result for valid input', () => {
      // Arrange
      const input = createTestInput()
      // Act
      const result = functionName(input)
      // Assert
      expect(result).toEqual(expectedOutput)
    })

    it('should throw on invalid input', () => {
      expect(() => functionName(null)).toThrow('Expected error message')
    })
  })
})
```

---

## React Component Testing (RTL)

```typescript
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi } from 'vitest'
import { ProfileCard } from '../profile-card'

describe('ProfileCard', () => {
  const defaultProps = {
    name: 'Jane Doe',
    email: 'jane@example.com',
    onEdit: vi.fn(),
  }

  it('renders user info', () => {
    render(<ProfileCard {...defaultProps} />)

    expect(screen.getByText('Jane Doe')).toBeInTheDocument()
    expect(screen.getByText('jane@example.com')).toBeInTheDocument()
  })

  it('calls onEdit when edit button clicked', async () => {
    const user = userEvent.setup()
    render(<ProfileCard {...defaultProps} />)

    await user.click(screen.getByRole('button', { name: /edit/i }))

    expect(defaultProps.onEdit).toHaveBeenCalledOnce()
  })

  it('shows loading skeleton when isLoading', () => {
    render(<ProfileCard {...defaultProps} isLoading />)

    expect(screen.queryByText('Jane Doe')).not.toBeInTheDocument()
    expect(screen.getByTestId('profile-skeleton')).toBeInTheDocument()
  })
})
```

**Golden rules:**
- Query by role first (`getByRole`), then by text (`getByText`), then by testid (`getByTestId`)
- Never query by CSS class or component name
- Use `userEvent.setup()` for interactions (not `fireEvent`)
- Use `waitFor` / `findBy*` for async state changes
- Never use `setTimeout` hacks

---

## Service Function Testing (API layer)

Data-mutation functions in the frontend call the backend through an API client module.
Mock the client module, test the function directly — no HTTP mocking needed.

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createBooking } from '../services/create-booking'
import { createMockApiClient } from '@/test/mocks/api-client'

const mockApi = createMockApiClient()
vi.mock('@/lib/api-client', () => ({
  getApiClient: () => mockApi,
}))

describe('createBooking', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('creates booking with valid data', async () => {
    // Arrange — mock API response
    mockApi.post.mockResolvedValue({
      data: { id: 'booking-1', status: 'confirmed' },
    })

    // Act
    const result = await createBooking({
      serviceId: 'svc-1',
      date: '2026-03-15',
      time: '10:00',
    })

    // Assert
    expect(result).toEqual({
      success: true,
      data: { id: 'booking-1', status: 'confirmed' },
    })
  })

  it('returns error when user not authenticated', async () => {
    mockApi.post.mockRejectedValue({ response: { status: 401 } })

    const result = await createBooking({
      serviceId: 'svc-1',
      date: '2026-03-15',
      time: '10:00',
    })

    expect(result).toEqual({
      success: false,
      error: 'You must be signed in.',
    })
  })

  it('returns error when the API call fails', async () => {
    mockApi.post.mockRejectedValue({
      response: { status: 500, data: { message: 'duplicate key' } },
    })

    const result = await createBooking({
      serviceId: 'svc-1',
      date: '2026-03-15',
      time: '10:00',
    })

    expect(result).toEqual({
      success: false,
      error: expect.stringContaining('Something went wrong'),
    })
  })
})
```

**Pattern:** Service functions always return `{ success: true, data } | { success: false, error: string }`. Never let raw errors reach the UI layer.

---

## Custom Hook Testing

```typescript
import { renderHook, waitFor } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import { useBookings } from '../hooks/use-bookings'

// If the hook uses a data-fetching library (e.g. TanStack Query or Apollo),
// wrap it in the corresponding provider:
const createWrapper = () => {
  return ({ children }: { children: React.ReactNode }) => (
    <AppProviders>{children}</AppProviders>
  )
}

describe('useBookings', () => {
  it('returns bookings for authenticated user', async () => {
    const { result } = renderHook(() => useBookings('user-1'), {
      wrapper: createWrapper(),
    })

    // Initially loading
    expect(result.current.isLoading).toBe(true)

    // Wait for data
    await waitFor(() => expect(result.current.isSuccess).toBe(true))

    expect(result.current.data).toHaveLength(3)
    expect(result.current.data![0]).toHaveProperty('id')
  })
})
```

---

## MSW Setup

```typescript
// src/test/mocks/handlers.ts
import { http, HttpResponse } from 'msw'

export const handlers = [
  http.get('/api/bookings', () => {
    return HttpResponse.json([
      { id: '1', date: '2026-03-15', status: 'confirmed' },
    ])
  }),

  http.post('/api/bookings', async ({ request }) => {
    const body = await request.json()
    if (!body.serviceId) {
      return HttpResponse.json(
        { error: 'serviceId is required' },
        { status: 422 }
      )
    }
    return HttpResponse.json({ id: '2', ...body, status: 'confirmed' }, { status: 201 })
  }),
]

// src/test/mocks/server.ts
import { setupServer } from 'msw/node'
import { handlers } from './handlers'

export const server = setupServer(...handlers)
```

Per-test override:
```typescript
import { server } from '@/test/mocks/server'
import { http, HttpResponse } from 'msw'

it('shows error when API returns 500', async () => {
  server.use(
    http.get('/api/bookings', () => {
      return HttpResponse.json({ error: 'Internal error' }, { status: 500 })
    })
  )
  // ... test error UI
})
```

MSW also supports GraphQL handlers (`graphql.query`, `graphql.mutation`) — use them
when the frontend talks to a GraphQL BFF instead of REST endpoints.

---

## API Client Mock Factory

Keep one shared mock factory instead of re-creating inline mocks per test:

```typescript
// src/test/mocks/api-client.ts
import { vi } from 'vitest'

export function createMockApiClient() {
  return {
    get: vi.fn().mockResolvedValue({ data: null }),
    post: vi.fn().mockResolvedValue({ data: null }),
    put: vi.fn().mockResolvedValue({ data: null }),
    patch: vi.fn().mockResolvedValue({ data: null }),
    delete: vi.fn().mockResolvedValue({ data: null }),
  }
}
```

**Usage:** Configure return values per test, not globally. Use `as const` for type-safe fixtures:

```typescript
const BOOKING_FIXTURE = {
  id: 'booking-1',
  service_id: 'svc-1',
  user_id: 'user-1',
  date: '2026-03-15',
  status: 'confirmed' as const,
}
```

---

## Form Testing

Works with any form library (react-hook-form, Formik, plain controlled forms) —
test through the rendered UI, not the library internals:

```typescript
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { BookingForm } from '../booking-form'

describe('BookingForm', () => {
  it('shows validation errors on empty submit', async () => {
    const user = userEvent.setup()
    const onSubmit = vi.fn()
    render(<BookingForm onSubmit={onSubmit} />)

    await user.click(screen.getByRole('button', { name: /submit/i }))

    await waitFor(() => {
      expect(screen.getByText(/date is required/i)).toBeInTheDocument()
      expect(screen.getByText(/select a service/i)).toBeInTheDocument()
    })
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('submits with valid data', async () => {
    const user = userEvent.setup()
    const onSubmit = vi.fn()
    render(<BookingForm onSubmit={onSubmit} />)

    await user.type(screen.getByLabelText(/date/i), '2026-03-15')
    await user.selectOptions(screen.getByLabelText(/service/i), 'haircut')
    await user.click(screen.getByRole('button', { name: /submit/i }))

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledWith(
        expect.objectContaining({ date: '2026-03-15', service: 'haircut' })
      )
    })
  })
})
```

---

## Coverage Strategy

Focus on critical paths, not raw numbers:

| Priority | Target coverage | What |
|----------|---------------|------|
| P0 (must) | 90%+ | Auth, permissions, payment, data mutations |
| P1 (should) | 70%+ | Business logic, API handlers, form validation |
| P2 (nice) | 50%+ | UI components, utilities, formatters |
| Skip | — | Generated code, type files, config files |

Set thresholds in vitest config:
```typescript
coverage: {
  thresholds: { lines: 70, functions: 70 },
}
```

---

## Sources

- https://www.freecodecamp.org/news/how-to-test-react-applications-with-vitest/
- https://cursorrules.org/article/vitest-cursor-mdc-file
