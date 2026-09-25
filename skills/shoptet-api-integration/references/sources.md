# Research Sources: shoptet

> Log of ALL URLs used during research, creation, and updates of this skill.
> Newest entries first. See CLAUDE.md §3 for format requirements.

## 2026-09-25 — Backend/ERP integration reference (webhooks, batch, snapshots)

Context: security and architecture audit of a Laravel ERP integrated with multiple Shoptet shops surfaced gaps in webhook signature handling, batch/async job semantics and snapshot usage.

- https://api.docs.shoptet.com/shoptet-api/openapi/ — nav + Basic principles (auth modes, rate
  limiting, leaky bucket, locks, response format, status codes, paging, async request overview)
- https://api.docs.shoptet.com/shoptet-api/openapi/webhooks — webhooks overview, payload shape,
  payload delivery opt-in (`sendPayload: full`)
- https://api.docs.shoptet.com/shoptet-api/openapi/webhooks/registernewwebhook — POST /api/webhooks
  registration semantics (one URL per event, up to 50/call, 409/422 behavior)
- https://api.docs.shoptet.com/shoptet-api/openapi/webhooks/generatewebhooksignaturekey —
  POST /api/webhooks/renew-signature-key, `Shoptet-Webhook-Signature` header reference
- https://developers.shoptet.com/webhooks/ — full webhook guide: registration example, retry
  behavior (4s timeout, 3 attempts total, 15min interval, inactive after), no ordering guarantee,
  parallel delivery, IP allowlist 185.184.254.0/24, HMAC-SHA1 signature algorithm + PHP/Python
  verification code examples
- https://developers.shoptet.com/asynchronous-requests/ — async job lifecycle, statuses,
  `job:finished` webhook requirement (403 if not registered), 24h result validity, 30-day job
  metadata retention, 3h auto-fail timeout (job:finished NOT emitted in that case)
- https://api.docs.shoptet.com/shoptet-api/openapi/products/productbatchupdate — PATCH
  /api/products/batch, JSONL format, 100MB max, per-row error handling, log-based result
- https://api.docs.shoptet.com/shoptet-api/openapi/products/productbatchdelete — DELETE
  /api/products/batch, guid/code semantics
- https://api.docs.shoptet.com/shoptet-api/openapi/products/getlistofallproducts — GET
  /api/products/snapshot, filters, GZIP JSONL result, include sections
- https://api.docs.shoptet.com/shoptet-api/openapi/products — nav confirming
  /api/orders/snapshot and /api/pricelists/{id}/batch exist as siblings
- https://api.docs.shoptet.com/shoptet-api/openapi/orders — Order BATCH insertion endpoint,
  orders/snapshot link confirmation
- https://api.docs.shoptet.com/shoptet-api/openapi/files — Files endpoints
  (GET/POST /api/system/files, /api/system/file) for self-hosting batch/upload files
- https://api.docs.shoptet.com/shoptet-api/openapi/section/code-lists/webhook-event-types (via
  webhooks nav page) — full webhook event type table incl. Payload supported column, 409
  conflict pairs (order:update/order:cancel, customer:update/enableOrders/disableOrders), mass
  webhook list, system webhook note
  (embedded content reached via https://api.docs.shoptet.com/shoptet-api/openapi/ nav scrape)
- https://developers.shoptet.com/shoptet-tools/data-import/ — manual product/customer import
  formats (XLSX/CSV/XML, CP-1250 encoding), Heureka XML feed support; no live confirmation found
  of an automatic scheduled URL-pull import mechanism (flagged as unverified in the reference doc)

## Initial Creation

*No sources logged for the original skill draft (pre-2026-09-25).*

## 2026-09-25 (review follow-up)
- https://developers.shoptet.com/api-release-news-from-march-25-2025/ : Order batch insertion available (ověřeno přes firecrawl search při review)
