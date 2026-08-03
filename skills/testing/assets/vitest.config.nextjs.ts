// Vitest config for Next.js + Supabase projects
// Copy to project root as vitest.config.ts
// Dependencies: vitest, @testing-library/react, @testing-library/jest-dom, happy-dom, vite-tsconfig-paths

import { defineConfig } from 'vitest/config'
import tsconfigPaths from 'vite-tsconfig-paths'

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    environment: 'happy-dom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/__tests__/**/*.{test,spec}.{ts,tsx}'],
    exclude: ['node_modules', 'e2e'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      exclude: [
        'src/test/**',
        '**/*.d.ts',
        '**/types.ts',
        'src/components/ui/**', // shadcn generated
      ],
      thresholds: {
        lines: 70,
        functions: 70,
      },
    },
    // Reporters: use 'github' in CI for inline PR annotations
    reporter: process.env.CI ? ['github', 'verbose'] : ['verbose'],
  },
})
