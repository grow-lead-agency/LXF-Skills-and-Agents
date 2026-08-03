// Standard test setup file
// Copy to src/test/setup.ts
// Dependencies: @testing-library/react, @testing-library/jest-dom, vitest

import '@testing-library/jest-dom'
import { cleanup } from '@testing-library/react'
import { afterEach } from 'vitest'

// RTL: clean up DOM after each test
afterEach(() => cleanup())

// MSW: mock server lifecycle
// Uncomment when MSW is set up:
// import { server } from './mocks/server'
// beforeAll(() => server.listen({ onUnhandledRequest: 'error' }))
// afterEach(() => server.resetHandlers())
// afterAll(() => server.close())

// Keep framework/service mocks local to the tests that need them. A global Sentry,
// router, or GraphQL-client mock can hide integration errors in unrelated tests.
