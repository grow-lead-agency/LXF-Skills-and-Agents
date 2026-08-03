# Playwright E2E Patterns

> End-to-end testing for React SPAs with an authenticated backend. Use for critical user flows only.

---

## Playwright Config

Use `assets/playwright.config.ts` as template. Key settings:

```typescript
import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI ? 'github' : 'html',
  use: {
    baseURL: process.env.BASE_URL || 'http://localhost:5173',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'setup', testMatch: /.*\.setup\.ts/ },
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        storageState: 'e2e/.auth/user.json',
      },
      dependencies: ['setup'],
    },
    {
      name: 'mobile',
      use: {
        ...devices['Pixel 7'],
        storageState: 'e2e/.auth/user.json',
      },
      dependencies: ['setup'],
    },
  ],
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:5173',
    reuseExistingServer: !process.env.CI,
  },
})
```

---

## Auth Session Reuse

Authenticate once, reuse across tests:

```typescript
// e2e/auth.setup.ts
import { test as setup, expect } from '@playwright/test'

const authFile = 'e2e/.auth/user.json'

setup('authenticate', async ({ page }) => {
  // Navigate to login
  await page.goto('/login')

  // Enter credentials (use a dedicated test account)
  await page.getByLabel('Email').fill(process.env.TEST_USER_EMAIL!)
  await page.getByLabel('Password').fill(process.env.TEST_USER_PASSWORD!)
  await page.getByRole('button', { name: /sign in/i }).click()

  await page.waitForURL('/dashboard')

  // Save auth state (cookies + localStorage)
  await page.context().storageState({ path: authFile })
})
```

Add to `.gitignore`:
```
e2e/.auth/
```

---

## Page Object Model (POM)

Encapsulate page interactions:

```typescript
// e2e/pages/dashboard.page.ts
import { type Page, type Locator, expect } from '@playwright/test'

export class DashboardPage {
  readonly page: Page
  readonly heading: Locator
  readonly bookingsList: Locator
  readonly newBookingButton: Locator

  constructor(page: Page) {
    this.page = page
    this.heading = page.getByRole('heading', { name: /dashboard/i })
    this.bookingsList = page.getByTestId('bookings-list')
    this.newBookingButton = page.getByRole('button', { name: /new booking/i })
  }

  async goto() {
    await this.page.goto('/dashboard')
    await expect(this.heading).toBeVisible()
  }

  async createBooking(service: string, date: string) {
    await this.newBookingButton.click()
    await this.page.getByLabel(/service/i).selectOption(service)
    await this.page.getByLabel(/date/i).fill(date)
    await this.page.getByRole('button', { name: /confirm/i }).click()
  }

  async expectBookingVisible(service: string) {
    await expect(this.bookingsList.getByText(service)).toBeVisible()
  }
}
```

Usage in test:
```typescript
import { test, expect } from '@playwright/test'
import { DashboardPage } from './pages/dashboard.page'

test('user can create a booking', async ({ page }) => {
  const dashboard = new DashboardPage(page)
  await dashboard.goto()
  await dashboard.createBooking('Haircut', '2026-03-15')
  await dashboard.expectBookingVisible('Haircut')
})
```

---

## Network Interception

Mock API responses for testing error states:

```typescript
test('shows error toast when API returns 500', async ({ page }) => {
  // Intercept API call and return error
  await page.route('**/api/bookings', (route) =>
    route.fulfill({
      status: 500,
      contentType: 'application/json',
      body: JSON.stringify({ error: 'Internal server error' }),
    })
  )

  const dashboard = new DashboardPage(page)
  await dashboard.goto()
  await dashboard.createBooking('Haircut', '2026-03-15')

  // Assert toast error appears
  await expect(page.getByRole('alert')).toBeVisible()
  await expect(page.getByRole('alert')).toContainText(/something went wrong/i)
})

test('shows offline state when network fails', async ({ page }) => {
  const dashboard = new DashboardPage(page)
  await dashboard.goto()

  // Simulate offline
  await page.route('**/*', (route) => route.abort('connectionrefused'))

  await dashboard.createBooking('Haircut', '2026-03-15')
  await expect(page.getByText(/check your internet connection/i)).toBeVisible()
})
```

---

## Permission Boundary Tests

Test that unauthorized users can't access protected resources:

```typescript
test.describe('unauthenticated user', () => {
  test.use({ storageState: { cookies: [], origins: [] } }) // No auth

  test('redirects to login from dashboard', async ({ page }) => {
    await page.goto('/dashboard')
    await expect(page).toHaveURL(/\/login/)
  })

  test('redirects to login from settings', async ({ page }) => {
    await page.goto('/settings')
    await expect(page).toHaveURL(/\/login/)
  })

  test('API returns 401 for protected endpoints', async ({ page }) => {
    const response = await page.request.get('/api/bookings')
    expect(response.status()).toBe(401)
  })
})

test.describe('regular user (not admin)', () => {
  test.use({ storageState: 'e2e/.auth/regular-user.json' })

  test('cannot access admin panel', async ({ page }) => {
    await page.goto('/admin')
    await expect(page.getByText(/you do not have permission/i)).toBeVisible()
  })
})
```

**Tip:** Run the E2E suite as the LOWEST privileged role by default — an admin-only
suite hides permission and empty-state bugs.

---

## Visual Regression

```typescript
test('dashboard matches screenshot', async ({ page }) => {
  const dashboard = new DashboardPage(page)
  await dashboard.goto()

  // Wait for dynamic content to settle
  await page.waitForLoadState('networkidle')

  await expect(page).toHaveScreenshot('dashboard.png', {
    maxDiffPixelRatio: 0.01,
    fullPage: true,
  })
})
```

Store baselines in `e2e/__screenshots__/`. Update with `npx playwright test --update-snapshots`.

---

## Toast Assertion Patterns

Works with Bootstrap toasts or any toast library — target the ARIA role, not the library's DOM:

```typescript
// Helper
async function expectToast(page: Page, text: RegExp) {
  const toast = page.getByRole('alert')
  await expect(toast).toBeVisible({ timeout: 5000 })
  await expect(toast).toContainText(text)
}

// Usage
test('shows success toast after booking', async ({ page }) => {
  // ... create booking ...
  await expectToast(page, /booking created/i)
})

test('shows error toast on validation failure', async ({ page }) => {
  // ... submit empty form ...
  await expectToast(page, /fill in the required fields/i)
})
```

If your toast markup does not use `role="alert"`, add it — it helps both tests and screen readers.

---

## CI Configuration

```yaml
# In GitHub Actions
- name: Install Playwright browsers
  run: npx playwright install --with-deps chromium

- name: Run E2E tests
  run: npm run test:e2e
  env:
    BASE_URL: ${{ steps.deploy-preview.outputs.url }}
    TEST_USER_EMAIL: ${{ secrets.TEST_USER_EMAIL }}
    TEST_USER_PASSWORD: ${{ secrets.TEST_USER_PASSWORD }}

- name: Upload test results
  if: always()
  uses: actions/upload-artifact@v4
  with:
    name: playwright-report
    path: playwright-report/
    retention-days: 7
```

---

## Debugging

```bash
# Headed mode with step-by-step
npx playwright test --headed --debug

# Specific test
npx playwright test e2e/booking.spec.ts --headed

# View trace
npx playwright show-trace test-results/trace.zip

# Generate report
npx playwright show-report
```

---

## Sources

- https://www.deviqa.com/blog/guide-to-playwright-end-to-end-testing-in-2025/
- https://www.righttail.co/blog/playwright-end-to-end-testing-complete-guide
- https://www.bunnyshell.com/blog/introduction-to-end-to-end-testing-everything-you-/
