# Output, files, session and cookies (categories 6, 7, 8)

## 1. Blade raw output

```blade
{{-- BAD: customer message, customer name from a webhook, order note --}}
{!! $message->body !!}

{{-- GOOD: plain text --}}
{{ $message->body }}

{{-- GOOD: rich text that must keep formatting, sanitized with an allowlist --}}
{!! clean($message->body) !!}          {{-- mews/purifier (HTMLPurifier) --}}
```

Symfony alternative without HTMLPurifier:

```php
use Symfony\Component\HtmlSanitizer\HtmlSanitizer;
use Symfony\Component\HtmlSanitizer\HtmlSanitizerConfig;

$this->app->singleton(HtmlSanitizer::class, fn () => new HtmlSanitizer(
    (new HtmlSanitizerConfig())->allowSafeElements()->allowLinkSchemes(['https', 'mailto'])
));
// Blade: {!! app(HtmlSanitizer::class)->sanitize($html) !!}   better: a SafeHtml cast or view component
```

Fix the data too: after patching a stored XSS, query the table for `<script`, `onerror=`,
`javascript:` and clean existing rows.

Find:
```bash
grep -rn '{!!' resources/views | grep -v -E 'clean\(|sanitize\(|__\(|trans\(|csrf_field|method_field|\$slot' | wc -l
grep -rn '{!!' resources/views | grep -E 'message|note|comment|name|email|phone|address|description'
```
In large legacy apps (thousands of `{!!`), ratchet: CI fails when the count increases.

Test:
```php
public function test_customer_message_is_not_rendered_as_html(): void
{
    $claim = Claim::factory()->create();
    $claim->messages()->create(['body' => '<img src=x onerror=alert(1)>']);

    $this->actingAs(User::factory()->withPermission('claims.view')->create())
        ->get(route('claims.chat', $claim))
        ->assertDontSee('<img src=x onerror=alert(1)>', false)
        ->assertSee('&lt;img', false);
}
```

## 2. PDF engines and headless Chrome

| Engine | Risk | Setting |
|--------|------|---------|
| dompdf (`barryvdh/laravel-dompdf`) | remote fetch, local file read | keep `isRemoteEnabled` false (dompdf only fetches web resources when it is true), set `chroot` to the directory with your assets |
| mPDF | fetches `<img src>` and CSS URLs while rendering = SSRF when user HTML reaches the template | escape all user data in PDF Blade views; serve images as local files or data URIs; block outbound network for the process that renders |
| Browsershot / Puppeteer | full browser, SSRF, `file://` | render only your own templates (`Browsershot::html(view(...)->render())`), never user URLs; no `noSandbox()` unless a container forces it; run in a queue with its own user |

```php
// Queue labels instead of rendering in the HTTP request
RenderShippingLabel::dispatch($shipment->id)->onQueue('labels');
```

Synchronous Chromium in PHP-FPM with the default small pool (`pm.max_children` 5 on many
distros) means a few simultaneous prints block every other request, webhooks included.

## 3. Disks and uploads

Rule of thumb: `public` disk = anything you would post on a billboard. Everything else =
`local` (in Laravel 11+ its root is `storage/app/private`).

```php
// BAD: invoice at a guessable public URL, never deleted
Storage::disk('public')->put("invoices/{$order->id}/invoice.pdf", $pdf);

// GOOD: private + authorized download
Storage::disk('local')->put("invoices/{$order->id}/".Str::uuid().'.pdf', $pdf);

Route::get('/invoices/{invoice}/download', function (Invoice $invoice) {
    Gate::authorize('view', $invoice);
    return Storage::disk('local')->download($invoice->path, "invoice-{$invoice->number}.pdf");
})->middleware(['auth']);

// or a short-lived link for email / third parties (local driver needs 'serve' => true)
$url = Storage::disk('local')->temporaryUrl($invoice->path, now()->addMinutes(15));
```

Inventory what is already public: `find storage/app/public -type f | sed 's|/[^/]*$||' | sort | uniq -c | sort -rn`
and check web server access logs for requests to the sensitive prefixes (possible breach
notification duty under GDPR).

Uploads:

```php
$request->validate([
    'files' => ['array', 'max:10'],
    'files.*' => ['file', 'max:10240', 'mimes:jpg,jpeg,png,webp,pdf'],   // no svg, no html
]);

foreach ($request->file('files', []) as $file) {
    $paths[] = $file->store("claims/{$claim->id}", 'local');           // hashName(), not original name
}
```

- Keep the original filename only as metadata for display (escaped), never as a path.
- If SVG is a business requirement: sanitize (e.g. `enshrined/svg-sanitize`) and serve
  with `Content-Type: image/svg+xml`, `Content-Security-Policy: sandbox`, and from a separate
  cookieless domain where possible.
- Files pushed to other domains (SFTP to a storefront's asset host) inherit that domain's
  origin: an HTML file there is XSS on the storefront.

Deleting:

```php
// BAD
Storage::disk('public')->delete($request->input('path'));

// GOOD
$path = $request->input('path');
abort_unless(in_array($path, session('wizard.uploads', []), true), 403);
Storage::disk('local')->delete($path);
```

Atomic feed writes (consumers polling the file never see a half-written feed):

```php
$final = storage_path('app/private/feeds/stock.jsonl');
$tmp = $final.'.'.Str::random(8).'.tmp';
$fh = fopen($tmp, 'wb');
foreach ($rows as $row) { fwrite($fh, json_encode($row).PHP_EOL); }
fflush($fh); fclose($fh);
rename($tmp, $final);                  // atomic on the same filesystem
```

Serve feeds that contain PII or purchase prices through a route with a long random token
in the path compared with `hash_equals`, not from `/storage`.

## 4. Session cookies, SameSite and iframes

Framework default (`config/session.php` in laravel/laravel 12.x): `same_site` = `lax`,
`partitioned` = `false` (`SESSION_PARTITIONED_COOKIE`). Partitioned cookies require
`secure` and `same_site = none`.

The trap: some flow (a returns wizard, a customer portal) is embedded in an iframe on
another site; it needs its cookie cross-site, someone sets `SESSION_SAME_SITE=none` globally,
and the admin becomes CSRF-able through every GET with a side effect. Flipping back to `lax`
breaks the embedded flow. Options, best first:

1. **Stateless embedded flow:** carry a short-lived signed token (URL param or `postMessage`)
   and keep no session in the iframe.
2. **Separate cookie for the embedded routes:** a middleware that runs before `StartSession`
   and switches the cookie name and attributes for that route group only.

```php
final class EmbeddedSessionCookie
{
    public function handle(Request $request, Closure $next): Response
    {
        config([
            'session.cookie' => 'embed_session',
            'session.same_site' => 'none',
            'session.secure' => true,
            'session.partitioned' => true,
        ]);

        return $next($request);
    }
}

// bootstrap/app.php: make sure it runs before StartSession
$middleware->prependToPriorityList(
    before: \Illuminate\Session\Middleware\StartSession::class,
    prepend: \App\Http\Middleware\EmbeddedSessionCookie::class,
);

// routes
Route::middleware([EmbeddedSessionCookie::class, 'web', 'throttle:30,1'])
    ->prefix('embed')->group(base_path('routes/embed.php'));
```

Verify in the browser that the admin cookie is still `lax` and the embed cookie carries
`SameSite=None; Secure; Partitioned`. Ship with an E2E test (Playwright) that loads the
embedded page inside an iframe on a different origin and completes the flow. Add
`frame-ancestors` CSP listing the sites allowed to embed.

Test for the admin side:

```php
public function test_admin_session_cookie_is_lax(): void
{
    $this->get('/login')->assertCookie(config('session.cookie'));
    $this->assertSame('lax', config('session.same_site'));
}
```

## 5. Session ID only from the cookie

A custom `StartSession` subclass that reads `?sid=` from the URL (to survive third-party
cookie blocking in iframes) enables fixation and leaks the session through logs, Referer and
copy-pasted links. Replace with option 1 or 2 above. Find:
`grep -rn "extends StartSession\|getSessionId\|setId(" app/`.

## 6. Host header and password reset links

Reset links are built from the request host unless told otherwise. With a web server that
accepts any `Host`, an attacker triggers a reset for the victim with `Host: evil.example`
and harvests the token when the victim clicks.

```php
// bootstrap/app.php
->withMiddleware(function (Middleware $middleware) {
    $middleware->trustHosts(at: ['^erp\.example\.com$'], subdomains: false);
    $middleware->trustProxies(at: ['10.0.0.0/8']);   // only if behind a proxy; never '*' on a public box
})

// AppServiceProvider::boot()
if ($this->app->isProduction()) {
    URL::forceRootUrl(config('app.url'));
    URL::forceScheme('https');
}
```

nginx: add a default `server { listen 443 ssl default_server; return 444; }` so unknown hosts
never reach PHP. Test:

```php
public function test_reset_link_ignores_host_header(): void
{
    Notification::fake();
    $user = User::factory()->create();

    $this->withServerVariables(['HTTP_HOST' => 'evil.example'])
        ->post('/forgot-password', ['email' => $user->email]);

    Notification::assertSentTo($user, ResetPassword::class, function ($n) use ($user) {
        $url = $n->toMail($user)->actionUrl;
        return str_starts_with($url, config('app.url'));
    });
}
```

(With `trustHosts` active the request may be rejected earlier; either outcome passes the intent.)

## 7. Sessions after password change, offboarding

```php
// routes: add auth.session to the authenticated group
Route::middleware(['auth', 'auth.session', 'active'])->group(...);

// app/Http/Middleware/EnsureUserIsActive.php  (alias 'active')
public function handle(Request $request, Closure $next): Response
{
    if ($request->user() && ! $request->user()->is_active) {
        Auth::guard('web')->logout();
        $request->session()->invalidate();
        abort(403, 'Account disabled.');
    }
    return $next($request);
}
```

Also revoke Sanctum tokens on deactivation (`$user->tokens()->delete()`) and set
`expiration` in `config/sanctum.php`. Login throttling beyond the default and 2FA for admin
accounts close the rest of this category.

## 8. CORS

`config/cors.php`: `supports_credentials => true` only with an explicit `allowed_origins`
list of origins that really call the API with cookies. Storefront origins that only need
public data do not belong in a credentialed list.
