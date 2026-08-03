// Standard test setup file
// Copy to src/test/setup.ts
// Dependencies: @testing-library/react, @testing-library/jest-dom, vitest, msw

import '@testing-library/jest-dom'
import { cleanup } from '@testing-library/react'
import { afterEach, afterAll, beforeAll, vi } from 'vitest'

// RTL: clean up DOM after each test
afterEach(() => cleanup())

// MSW: mock server lifecycle
// Uncomment when MSW is set up:
// import { server } from './mocks/server'
// beforeAll(() => server.listen({ onUnhandledRequest: 'error' }))
// afterEach(() => server.resetHandlers())
// afterAll(() => server.close())

// Sentry: silence in tests (spy instead of real calls)
vi.mock('@sentry/nextjs', () => ({
  captureException: vi.fn(),
  captureMessage: vi.fn(),
  init: vi.fn(),
  setUser: vi.fn(),
  withScope: vi.fn((cb) => cb({ setExtra: vi.fn(), setTag: vi.fn() })),
}))

// Next.js navigation: mock (common need in component tests)
vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: vi.fn(),
    replace: vi.fn(),
    back: vi.fn(),
    refresh: vi.fn(),
  }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => '/',
  redirect: vi.fn(),
}))
