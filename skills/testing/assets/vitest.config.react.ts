// Vitest config for a React 19 + Vite application
// Copy to the frontend workspace as vitest.config.ts
// Dependencies: vitest, @vitejs/plugin-react, @vitest/coverage-v8,
// @testing-library/react, @testing-library/jest-dom, jsdom, vite-tsconfig-paths

import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'
import tsconfigPaths from 'vite-tsconfig-paths'

export default defineConfig({
  plugins: [react(), tsconfigPaths()],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
    exclude: ['node_modules/**', 'e2e/**'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      exclude: ['src/test/**', '**/*.d.ts', '**/types.ts', '**/*.generated.*'],
      thresholds: {
        lines: 70,
        functions: 70,
      },
    },
    reporters: process.env.CI ? ['github-actions', 'default'] : ['default'],
  },
})
