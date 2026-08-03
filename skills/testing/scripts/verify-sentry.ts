/**
 * Sentry Smoke Test — verify events reach Sentry
 *
 * Usage:
 *   SENTRY_DSN=... SENTRY_AUTH_TOKEN=... SENTRY_ORG=your-org SENTRY_PROJECT=my-project \
 *     npx tsx scripts/verify-sentry.ts
 *
 * What it does:
 *   1. Sends a test error to Sentry via SDK
 *   2. Waits for ingestion (5 seconds)
 *   3. Queries Sentry API to verify the event arrived
 *   4. Prints PASS or FAIL
 */

const SENTRY_DSN = process.env.SENTRY_DSN
const SENTRY_AUTH_TOKEN = process.env.SENTRY_AUTH_TOKEN
const SENTRY_ORG = process.env.SENTRY_ORG
const SENTRY_PROJECT = process.env.SENTRY_PROJECT
const SENTRY_HOST = process.env.SENTRY_HOST || 'de.sentry.io' // EU region — change if your org is on US (sentry.io)

// Validate env vars
if (!SENTRY_DSN) {
  console.error('ERROR: SENTRY_DSN is required')
  process.exit(1)
}
if (!SENTRY_AUTH_TOKEN) {
  console.error('ERROR: SENTRY_AUTH_TOKEN is required')
  process.exit(1)
}
if (!SENTRY_ORG) {
  console.error('ERROR: SENTRY_ORG is required')
  process.exit(1)
}
if (!SENTRY_PROJECT) {
  console.error('ERROR: SENTRY_PROJECT is required')
  process.exit(1)
}

// Generate unique test ID
const testId = `pre-deploy-smoke-${Date.now()}`
console.log(`Sending test error: ${testId}`)

// Step 1: Send test error via Sentry SDK
const Sentry = await import('@sentry/node')

Sentry.init({
  dsn: SENTRY_DSN,
  environment: 'smoke-test',
  release: `smoke-test-${Date.now()}`,
})

Sentry.captureException(new Error(`[PRE-DEPLOY SMOKE TEST] ${testId}`))
await Sentry.flush(3000)

console.log('Error sent. Waiting 5 seconds for ingestion...')

// Step 2: Wait for Sentry to ingest
await new Promise((resolve) => setTimeout(resolve, 5000))

// Step 3: Query Sentry API
console.log('Checking Sentry API...')

const apiUrl = `https://${SENTRY_HOST}/api/0/projects/${SENTRY_ORG}/${SENTRY_PROJECT}/issues/?query=${encodeURIComponent(testId)}&limit=1`

const response = await fetch(apiUrl, {
  headers: {
    Authorization: `Bearer ${SENTRY_AUTH_TOKEN}`,
  },
})

if (!response.ok) {
  console.error(`FAIL: Sentry API returned ${response.status}`)
  console.error(await response.text())
  process.exit(1)
}

const issues = await response.json()

// Step 4: Verify
if (Array.isArray(issues) && issues.length > 0) {
  const issue = issues[0]
  console.log(`\nPASS: Sentry received the test event`)
  console.log(`  Issue ID: ${issue.id}`)
  console.log(`  Title: ${issue.title}`)
  console.log(`  URL: https://${SENTRY_HOST}/organizations/${SENTRY_ORG}/issues/${issue.id}/`)
  process.exit(0)
} else {
  console.error('\nFAIL: Event not found in Sentry after 5 seconds')
  console.error('Possible causes:')
  console.error('  - SENTRY_DSN is wrong')
  console.error('  - SENTRY_AUTH_TOKEN lacks project:read scope')
  console.error('  - SENTRY_PROJECT name mismatch')
  console.error('  - Sentry ingest is slow (try again)')
  process.exit(1)
}
