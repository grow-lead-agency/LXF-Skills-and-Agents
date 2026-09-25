# Staging environment on a single-VPS setup

Grounded in a real finding (a Laravel ERP audit): "no staging, testing happens in
production" plus 39 hardcoded production-URL references in `app/` and webhook registrations
that delete-and-recreate themselves against whatever `APP_URL` is set — meaning a naively
cloned staging environment with production tokens would actively break production webhooks.

## Nightly restore from backup + anonymization

Staging should run against a **real, current** schema and data shape (that's the point of
staging) but never against real customer PII or live third-party tokens.

```bash
#!/usr/bin/env bash
# staging-refresh.sh — run nightly via cron or a scheduled GitHub Actions workflow
set -euo pipefail

LATEST_BACKUP=$(aws s3 ls s3://example-backups/prod/ | sort | tail -n1 | awk '{print $4}')
aws s3 cp "s3://example-backups/prod/${LATEST_BACKUP}" /tmp/prod-dump.sql.gz
gunzip /tmp/prod-dump.sql.gz

mysql -h "$STAGING_DB_HOST" -e "DROP DATABASE IF EXISTS staging; CREATE DATABASE staging;"
mysql -h "$STAGING_DB_HOST" staging < /tmp/prod-dump.sql

# Anonymize BEFORE anything else can read the DB — see PII table list below
mysql -h "$STAGING_DB_HOST" staging < anonymize.sql

rm /tmp/prod-dump.sql
```

### PII table pattern — anonymize.sql

Identify PII columns by pattern (name, email, phone, address, IBAN, tax ID) across every
table, not just the obvious "customers" table — the audited app had customer PII duplicated
into `orders`, `input_reclamations`, and audit-log-style tables:

```sql
-- Pattern: replace with deterministic fake data keyed on the row id, so foreign keys and
-- joins between anonymized tables still line up (same customer_id -> same fake email).
UPDATE customers SET
  name = CONCAT('Test Customer ', id),
  email = CONCAT('customer+', id, '@staging.invalid'),
  phone = CONCAT('+420000', LPAD(id, 6, '0')),
  iban = NULL,
  address_line1 = 'Staging Test St. 1';

UPDATE orders SET
  customer_email = CONCAT('customer+', customer_id, '@staging.invalid'),
  customer_phone = CONCAT('+420000', LPAD(customer_id, 6, '0'));

UPDATE input_reclamations SET
  customer_iban = NULL,
  customer_phone = CONCAT('+420000', LPAD(customer_id, 6, '0'));
```

`@staging.invalid` is the RFC 2606 reserved TLD for exactly this — email addresses that are
guaranteed to never be a real deliverable inbox. Any outbound mail from staging that isn't
caught by the mailer config (next section) at least can't reach a real customer if it slips
through.

## No production tokens on staging

**Why this matters concretely:** the audited app registers webhooks with an external
platform (Shoptet) keyed on `APP_URL`, and the registration logic **deletes existing webhooks
and recreates them** on certain triggers. Point staging at a production API token with
`APP_URL=https://staging.example.com` and the app will happily re-register production's
webhooks to point at staging — silently breaking production order/customer webhooks.

- Every third-party integration (payment gateway, invoicing API, shipping carrier, webhook
  registrations) gets **separate staging credentials/sandbox mode**, not a copy of production's.
- If a third party genuinely has no sandbox mode, that integration must be **stubbed/mocked**
  on staging rather than pointed at the real API with real credentials.
- CI/deploy secrets for staging live in a separate GitHub Environment (`staging`) from
  production's (`production`) — never the same secret value reused across both.

## Egress allowlist

Staging should not be able to reach the public internet freely — a mis-anonymized row, a
queued job that didn't get the memo, or a misconfigured mailer can otherwise leak real data
outbound even after the anonymization pass above.

- Firewall egress from the staging VPS/container to an explicit allowlist: your own package
  registries (Packagist, npm), the staging mail catcher, and nothing else by default.
- `MAIL_MAILER=log` or a local catch-all (Mailpit/Mailhog) on staging — never a real SMTP
  provider with production credentials. This is the actual backstop if the anonymization pass
  above misses an email column somewhere.
- Outbound webhook registrations should be disabled entirely on staging via
  a feature flag / config check on `APP_ENV === 'staging'`, not relied upon to fail safely.

## `APP_URL` must never be hardcoded

dozens of places in the audited app referenced `https://erp.example.com` directly instead of
`config('app.url')` / `url()`. Beyond the staging-breaks-production-webhooks risk above, this
also means staging silently generates production links in emails, PDFs, and API responses —
undetectable until a customer clicks a "staging" email link that points at production, or a
tester on staging sees data as if they were in production.

```php
// Bad — direct in app code:
$url = "https://erp.example.com/orders/{$order->id}";

// Good:
$url = route('orders.show', $order); // or url("/orders/{$order->id}")
```

CI lint (scoped to app code, not vendor/tests fixtures that legitimately reference a real
domain for assertion purposes):

```yaml
- name: No hardcoded production domain in app code
  run: |
    if grep -rn "https://example.com" app/ resources/views/ --include='*.php' --include='*.blade.php'; then
      echo "::error::Hardcoded production URL found — use config('app.url') / route() / url()"
      exit 1
    fi
```

## Sources

- RFC 2606 reserved domains (`.invalid`) — https://www.rfc-editor.org/rfc/rfc2606
- Laravel `config('app.url')` / `URL::forceRootUrl` — https://laravel.com/docs/11.x/urls
