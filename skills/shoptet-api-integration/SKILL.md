---
name: shoptet-api-integration
description: >-
  Backend integration of an ERP with Shoptet e-shops over the Shoptet API: webhook
  registration and signature verification (Shoptet-Webhook-Signature, HMAC-SHA1 over the
  raw body, per-shop signature key), retries, ordering and idempotency, re-verifying
  delete events via the API, Private API auth and rate limits, async jobs and the
  job:finished webhook, batch JSONL (PATCH /api/products/batch), order batch insertion,
  products/orders snapshots, feeds consumed by Shoptet, and integration pitfalls
  (URL-encoding, per-environment webhook URLs, staging vs production tokens).
  Trigger for: "shoptet webhook", "webhook podpis", "Shoptet-Webhook-Signature",
  "shoptet batch", "shoptet snapshot", "shoptet api limity", "shoptet job",
  "napojení ERP na Shoptet", "shoptet private api".
  NE pro: Shoptet šablony, SEO, marketing a vzhled e-shopu.
---

# Shoptet API integration (ERP backend)

Everything a backend needs to integrate reliably with Shoptet: receive webhooks safely,
call the Private API within limits, run async batch jobs and snapshots, and avoid the
classic multi-shop integration bugs.

**Full reference:** [references/api-integration-backend.md](references/api-integration-backend.md)
(all facts live-verified against api.docs.shoptet.com and developers.shoptet.com, 2026-09-25;
sources in [references/sources.md](references/sources.md)).

## Must-do checklist

1. **Verify every webhook.** Header `Shoptet-Webhook-Signature` = `hash_hmac('sha1', $rawBody, $signatureKey)`.
   Use the raw request body (`$request->getContent()`), compare with `hash_equals`, reject
   otherwise. The signature key is per shop (`POST /api/webhooks/renew-signature-key`).
2. **Ack fast, process async.** Shoptet waits ~4 s and retries (3 attempts total, ~15 min apart).
   Put the event on a queue, return 200 immediately.
3. **Idempotency.** No ordering or uniqueness guarantee. Dedup on
   `(eshopId, event, eventInstance, eventCreated)`, back it with a UNIQUE index, use upserts.
4. **Never trust a delete event blindly.** Before marking anything deleted locally, `GET` the
   entity from the API and act only on a real 404.
5. **One URL per event per shop.** Re-registering webhooks (e.g. from a deploy or a staging
   environment with production tokens) silently moves or deletes production webhooks.
   Staging must never hold production tokens; build webhook URLs from `APP_URL`.
6. **URL-encode path parameters** built from payload values (`eventInstance`) before calling
   the API.
7. **Async jobs** (batch, snapshots) require a registered `job:finished` webhook; result URLs
   are valid 24 h. Host batch JSONL files at an unguessable, short-lived URL and clean up.
8. **Feeds Shoptet downloads** (stock/price XML): write to a temp file and `rename()`
   atomically, so Shoptet never fetches a half-written feed.

See the reference for payload shapes, status codes, limits, job states and code examples.

<!-- Origin: GrowLead / Claude | Created: 2026-09-25 | Extracted from the shoptet skill (references/api-integration-backend.md) | Inspiration: https://api.docs.shoptet.com, https://developers.shoptet.com/api-release-news-from-march-25-2025/ -->
