---
name: ksef-e-invoicing
description: >-
  Polish KSeF (Krajowy System e-Faktur) e-invoicing integration for the
  datamixer Laravel app: n1ebieski/ksef-php-client (KSeF 2.0 API), FA(3)
  invoice XML, XAdES auth (robrichards/xmlseclibs), sessions, UPO retrieval,
  queue-based sending, frontend rendering. Trigger on: KSeF, e-faktura,
  faktura ustrukturyzowana, FA(3), UPO, KSeF number, ksef-php-client,
  XAdES, Polish e-invoicing, invoice submission to tax authority.
---

# KSeF e-invoicing (Poland)

KSeF (Krajowy System e-Faktur / National e-Invoice System) is the Polish
Ministry of Finance platform for issuing, receiving and storing structured
invoices. Every invoice is an XML document conforming to the official FA
schema; KSeF validates it, assigns a unique **KSeF number** (the legal
identifier of the invoice) and issues a **UPO** (Urzędowe Poświadczenie
Odbioru — official confirmation of receipt) per session. Since the KSeF 2.0
rollout in 2026, using KSeF is **mandatory** for B2B invoicing in Poland —
an invoice not sent to KSeF (outside the allowed exceptions/offline modes)
is not a legally issued invoice.

## Regulatory status (verified 2026-08-03)

| Date | Obligation |
|---|---|
| 1 Feb 2026 | KSeF 2.0 went live and became the ONLY system (KSeF 1.0 permanently shut down). Mandatory for taxpayers whose 2024 sales incl. VAT exceeded 200M PLN. |
| 1 Apr 2026 | Mandatory for all other businesses (Stage II — already in force). |
| 1 Jan 2027 | Mandatory for the smallest, previously exempt issuers (≤ 10 000 PLN of invoiced sales/month). Until end of 2026 they may still issue paper/electronic invoices. |

Source: ksef.podatki.gov.pl (Etapy wdrożenia + Podstawy prawne, modified
2026-05-29). Other 2026 relaxations (all verified on Podstawy prawne):
**offline24 mode** exists for connectivity problems; consumer (B2C) invoices
are optional in KSeF; the duty to quote the KSeF number in payments between
active VAT payers is deferred until end of 2026; VAT RR invoices optional
from 1 Apr 2026; invoice **attachments** supported since 1 Feb 2026 (after
prior notification in e-US).

**Schema: FA(3)** is the current invoice structure. Production and Demo
accept only FA(3), FA_PEF(3), FA_KOR_PEF(3). Test additionally still
accepts FA(2). Do not build new documents against FA(2).

## Environments (verified 2026-08-03, source: CIRFMF/ksef-docs)

| Env | API base | API docs | Notes |
|---|---|---|---|
| TEST | `https://api-test.ksef.mf.gov.pl` | `/docs/v2` | Release-candidate versions. Self-signed certs allowed; data is shared between integrators — use random NIPs, never real data. |
| DEMO | `https://api-demo.ksef.mf.gov.pl` | `/docs/v2` | Pre-production; mirrors prod config. Final integration validation. |
| PROD | `https://api.ksef.mf.gov.pl` | `/docs/v2` | Invoices with full legal effect. |

Taxpayer web apps: `ksef-test.mf.gov.pl`, `ksef-demo.mf.gov.pl`,
`ksef.mf.gov.pl`. URLs returned by the API always match the environment you
called. Test envs have maintenance windows 16:00–18:00 CET.

## Auth model (KSeF 2.0)

All API access is session-token based. Flow:

1. `POST /auth/challenge` → challenge.
2. Prove identity, one of:
   - **XAdES signature** — sign the `AuthTokenRequest` XML with a qualified
     certificate / trusted profile / **KSeF certificate** (issued via the
     MCU — Certificates and Permissions Module, live since 1 Nov 2025).
   - **KSeF token** — a pre-generated API token for the NIP context.
3. Poll auth status, then redeem → **accessToken** (short-lived JWT) +
   **refreshToken**. Refresh instead of re-authenticating.

Interactive/batch invoice sending additionally requires a client-generated
**symmetric encryption key** (invoices are encrypted in transit inside the
session). `ksef-php-client` handles all of this — see below.

## Invoice lifecycle

```
build FA(3) XML  →  validate against XSD  →  authenticate (token/XAdES)
→ open session (online or batch)  →  send invoice(s)  →  poll session/invoice status
→ on success: store KSeF number  →  close session  →  fetch UPO  →  store UPO
```

- The **KSeF number** is assigned per invoice; the **UPO** is issued per
  session (covers the invoices accepted in it).
- Rejected invoices (schema errors, duplicate, business rules) never get a
  KSeF number — fix and resend as a NEW submission.
- Offline24: issue with QR codes offline, deliver to KSeF later (edge case;
  design for online-first).

## n1ebieski/ksef-php-client — lifecycle mapping

Already in `composer.json`. Verified against the README at v1.8.0
(2026-07-22, targets **KSeF API 2.0 + FA(3)**; requires PHP ^8.1 — fine on
PHP 8.4). Method names below are from the README — do not invent others;
each resource section links the exact `/docs/v2` endpoint.

```php
use N1ebieski\KSEFClient\ClientBuilder;
use N1ebieski\KSEFClient\ValueObjects\Mode;
use N1ebieski\KSEFClient\Factories\EncryptionKeyFactory;

$client = (new ClientBuilder())
    ->withMode(Mode::Test)                       // Test | Demo | Production
    ->withKsefToken(config('services.ksef.token'))     // token auth, OR:
    // ->withCertificatePath(storage_path('ksef/cert.p12'), $passphrase)
    ->withIdentifier(config('services.ksef.nip'))
    ->withEncryptionKey($storedKey)              // REQUIRED for invoice resources — persist it!
    ->withValidateXml(true)                      // XSD validation before send
    ->build();
```

With `withKsefToken()` or `withCertificate*()` set, the client performs
**auto authorization** (challenge → signature/token → access token) lazily.
Manual flow (`auth()->challenge()`, `auth()->xadesSignature()`,
`auth()->status()`, `auth()->token()->redeem()`) exists if you need to own
the token cache — you can persist and reuse tokens via
`withAccessToken($token, $validUntil)` / `withRefreshToken(...)`.

| Lifecycle step | Client call |
|---|---|
| Open interactive session | `$client->sessions()->online()->open(new OpenRequest(...))` |
| Send one invoice (XML) | `$client->sessions()->online()->send(new SendXmlRequest(...))` |
| Batch open + send many | `$client->sessions()->batch()->openAndSend(new OpenAndSendXmlRequest(...))` (also DTO and ZIP variants) |
| Poll session/invoice status | `$client->sessions()->status(new StatusRequest(...))` |
| Close session | `$client->sessions()->online()->close(new CloseRequest(...))` |
| Fetch UPO (XML body) | `$client->sessions()->upo(new UpoRequest(...))->body()` |
| Download an invoice by KSeF number | `$client->invoices()->download(new DownloadRequest(...))->body()` |
| Search received/sent invoices | `$client->invoices()->query()->metadata(new MetadataRequest(...))` |
| Bulk export | `$client->invoices()->exports()->init(...)` + `->status(...)` |

Every resource accepts either a typed `*Request` DTO or a plain array
(auto-mapped). Responses expose `->object()` (DTO), `->body()`, `->status()`.
The README also covers: FA(3) `Faktura` DTO with `fromXml()`/`toXml()`,
permissions, certificates (MCU), QR code generation (`I` online / `II`
offline codes), offline invoices, PDF visualization via the companion
`n1ebieski/ksef-pdf-generator`, and `testdata` endpoints. README sections
are thin on request-field detail — when a DTO's fields are unclear, read
the linked `/docs/v2` endpoint doc or the DTO source in
`vendor/n1ebieski/ksef-php-client/src`, and see the full runnable examples
in the README ("Send an invoice, check for UPO and generate QR code",
"Batch async send…"): https://github.com/n1ebieski/ksef-php-client

## Where xmlseclibs fits

`robrichards/xmlseclibs` is the XML-DSIG signing primitive. You need it
only for the **XAdES enveloped signature** on the auth challenge XML when
authenticating with a local certificate (`XMLSecurityDSig` +
`XMLSecurityKey` with RSA-SHA256, then extend the `ds:Object` with XAdES
`QualifyingProperties`). If you authenticate with a **KSeF token** or let
`ksef-php-client` handle certificate auth (`withCertificatePath()`), you do
not call xmlseclibs directly — the client signs internally. Keep xmlseclibs
for custom signing flows (e.g. signing with an externally-held qualified
cert where you must assemble the XAdES envelope yourself). Never sign
invoice XML — invoices are not signed, only the auth request is.

## Laravel integration (datamixer conventions)

- Client wrapper: `app/Services/Ksef/KsefClientFactory.php` — builds the
  client from `config/services.php` (`ksef.mode`, `ksef.nip`, `ksef.token`
  or cert path/passphrase, `ksef.encryption_key`). Secrets in `.env`; the
  encryption key and tokens are secrets — never log them.
- Job: `app/Jobs/SendInvoiceToKsef.php` (`QUEUE_CONNECTION=database`).
  One invoice per job. Suggested shape:

```php
class SendInvoiceToKsef implements ShouldQueue
{
    use Queueable; // Laravel 11 single trait — bundles Dispatchable, InteractsWithQueue, SerializesModels

    public int $tries = 5;
    public function backoff(): array { return [60, 300, 900, 3600]; }
    public $uniqueFor = 3600;   // with ShouldBeUnique, key = invoice id

    public function __construct(public int $invoiceId) {}

    public function handle(KsefClientFactory $factory): void
    {
        $invoice = Invoice::findOrFail($this->invoiceId);
        if ($invoice->ksef_number) return;               // idempotency guard
        // build FA(3) XML (Action/Service), send via online session,
        // poll status with the client's retry helper, persist result
    }

    public function failed(Throwable $e): void
    {
        // mark invoice ksef_status = 'failed', notify; NEVER silently drop —
        // an unsent invoice is a compliance incident
    }
}
```

- Retry rules: retry network errors, 5xx, 429 and auth-expiry (re-auth then
  retry). Do NOT blindly retry validation rejections (4xx with a semantic
  error code) — surface them to the user. Duplicate submissions are
  rejected by KSeF, which makes retries safe, but keep the local
  `ksef_number IS NULL` guard anyway.
- Status polling: session processing is async. Either poll within the job
  (client `Utility::retry()` / `withRetryTiming()`) or dispatch a delayed
  `CheckKsefStatus` follow-up job; store the session `referenceNumber` so a
  crashed job can resume.
- Persistence (migration on `invoices` or a dedicated `ksef_submissions`
  table): `ksef_number` (string, unique, nullable), `ksef_status` (enum:
  pending/sent/accepted/rejected/failed/offline), `ksef_reference_number`
  (session ref), `ksef_sent_at`, `ksef_error` (json), `upo_xml` (or a path
  on flysystem storage) + FA(3) source XML. Keep the exact submitted XML —
  it is the legal document; the PDF is only a visualization.
- Events: fire `InvoiceAcceptedByKsef` from the job and broadcast (Pusher)
  so the React admin updates without refresh.

## Frontend display

`@akmf/ksef-fe-invoice-converter` (package.json) renders the stored FA(3)
invoice XML into HTML/PDF-style visualization in the React admin — feed it
the raw XML you persisted, don't re-derive data. **TODO-verify:** this
package returns 404 on the public npm registry (checked 2026-08-03) — it is
private/scoped to an internal registry, so its exact API could not be
verified; read its README in `node_modules/@akmf/ksef-fe-invoice-converter`
before use. The Ministry's open-source equivalent (FA(3) XML → PDF/HTML
visualization, incl. UPO) is `CIRFMF/ksef-pdf-generator` on GitHub; the PHP
side can use the companion `n1ebieski/ksef-pdf-generator` instead. Always
show the KSeF number and status badge next to the rendered invoice;
sanitize any HTML output (dompurify is available on the storefront side).

## Testing strategy

- Unit (PHPUnit 11, `tests/Unit`): FA(3) XML building — assert against the
  XSD locally (client ships schemas in `resources/xsd`; `withValidateXml(true)`).
  Mock the KSeF client (mockery) in job tests; use `Queue::fake()`.
- Integration (`tests/Feature`, opt-in via env): run against **TEST**
  (`Mode::Test`, `https://api-test.ksef.mf.gov.pl`) with a self-signed
  cert or test KSeF token and a **random NIP** — TEST data is shared across
  integrators, never send real company data or production invoices there.
  The client's `testdata` resource can seed subjects/permissions; TEST has
  rate limits (also covered by the `testdata` rate-limit endpoints).
- Promotion: validate the full flow (auth → send → status → UPO) on
  **DEMO** before switching `KSEF_MODE=production`. Assert on: KSeF number
  format, UPO retrieval, duplicate rejection, and an intentionally invalid
  invoice (schema violation) surfacing a readable error.
- Never point automated tests at PROD.

## Project conventions

- Laravel 11 app at repo root; PHP 8.4 (composer `^8.2`), Sail for local dev.
- Jobs in `app/Jobs`, domain services in `app/Services`, single-purpose
  actions in `app/Actions`, enums (e.g. `KsefStatus`) in `app/Enums`,
  models in `app/Models`, events in `app/Events`.
- Queues: `QUEUE_CONNECTION=database`; supervisor runs workers on deploy
  (Deployer reloads it) — long polling belongs in jobs, never in HTTP requests.
- Config in `config/services.php` + `.env` (`KSEF_MODE`, `KSEF_NIP`,
  `KSEF_TOKEN` / `KSEF_CERT_PATH` + `KSEF_CERT_PASSPHRASE`,
  `KSEF_ENCRYPTION_KEY`); never commit secrets.
- Admin UI: React 18 + Bootstrap 5.3 in `resources/js` (`app.jsx`), Blade
  in `resources/views`; live updates via laravel-echo + pusher-js.
- JS tests: Vitest 4 in `tests/js/**/*.test.js`.

## Sources (all verified 2026-08-03)

- Rollout stages & dates — https://ksef.podatki.gov.pl/etapy-wdrozenia-ksef/
- Legal basis, 200M PLN threshold, offline24, deferrals —
  https://ksef.podatki.gov.pl/informacje-ogolne-ksef-20/podstawy-prawne-oraz-kluczowe-terminy/
- Environments & accepted schema versions (TEST/DEMO/PRD, FA(3)) —
  https://github.com/CIRFMF/ksef-docs/blob/main/srodowiska.md
- KSeF 2.0 API reference (auth: XAdES + KSeF token, sessions, UPO) —
  https://api-test.ksef.mf.gov.pl/docs/v2/index.html (also api-demo/api hosts)
- FA(3) logical structure —
  https://ksef.podatki.gov.pl/informacje-ogolne-ksef-20/struktura-logiczna-fa-3/
- n1ebieski/ksef-php-client README (v1.8.0, 2026-07-22; method names,
  ClientBuilder, auth modes, sessions/UPO/invoices) —
  https://github.com/n1ebieski/ksef-php-client
- Packagist (version + PHP requirement) —
  https://packagist.org/packages/n1ebieski/ksef-php-client
- Official invoice visualization library —
  https://github.com/CIRFMF/ksef-pdf-generator
- @akmf/ksef-fe-invoice-converter — NOT on public npm (404, 2026-08-03);
  see TODO-verify in "Frontend display".
