# Authorization, tokens and signed URLs (categories 2 and 3)

## 1. spatie/laravel-permission wiring

Register aliases once in `bootstrap/app.php` (Laravel 11+):

```php
->withMiddleware(function (Middleware $middleware) {
    $middleware->alias([
        'role' => \Spatie\Permission\Middleware\RoleMiddleware::class,
        'permission' => \Spatie\Permission\Middleware\PermissionMiddleware::class,
        'role_or_permission' => \Spatie\Permission\Middleware\RoleOrPermissionMiddleware::class,
    ]);
})
```

Route layout that stays correct as the app grows: read and write split, permission on
every write group, nothing after the closing brace.

```php
Route::middleware(['auth', 'auth.session', 'active'])->group(function () {
    Route::get('/orders', [OrderController::class, 'index'])->middleware('permission:orders.view');
    Route::get('/orders/{order}', [OrderController::class, 'show'])->middleware('can:view,order');

    Route::middleware('permission:orders.update')->group(function () {
        Route::patch('/orders/{order}/address', [OrderAddressController::class, 'update'])
            ->middleware('can:update,order');
        Route::post('/orders/{order}/payments', [OrderPaymentController::class, 'store'])
            ->middleware(['permission:orders.payments.create', 'can:update,order']);
    });

    Route::middleware('permission:permissions.manage')->prefix('admin/permissions')->group(function () {
        Route::post('/users/{user}/roles', [UserRoleController::class, 'update']);
        Route::post('/users/{user}/permissions', [UserPermissionController::class, 'update']);
    });
});

// Public routes live in their own file with their own throttle, e.g. routes/public.php,
// each one listed in RouteSecurityTest::PUBLIC_WRITE_ALLOWLIST with a reason.
```

Permission management action, hardened:

```php
public function update(UpdateUserPermissionsRequest $request, User $user): RedirectResponse
{
    $actor = $request->user();
    abort_if($user->is($actor), 403, 'Cannot change own permissions.');

    $requested = $request->validated('permissions');           // array of names
    abort_unless($actor->hasAllPermissions($requested), 403, 'Cannot grant what you do not hold.');

    $user->syncPermissions($requested);
    activity()->performedOn($user)->causedBy($actor)->withProperties(['permissions' => $requested])
        ->log('permissions.synced');                              // any audit log you use

    return back();
}
```

After an incident, audit who changed what: compare `model_has_permissions` and
`model_has_roles` against the expected matrix; spatie does not keep history by itself.

Other rules:
- Check permissions (`can('orders.update')`), not role names (spatie best practice: roles group
  users, permissions are what code checks).
- A super-admin bypass belongs in `Gate::before` returning `true` or `null`, never `false`
  (a `false` there denies everything, including legitimate checks).
- After seeding permissions in tests or deploys: `app(PermissionRegistrar::class)->forgetCachedPermissions()`.

## 2. Hardcoded user-ID allowlists

```php
// BAD: "permission" as a list of IDs, often combined with withoutMiddleware on a group
if (! in_array(auth()->id(), [10, 11, 12])) { abort(403); }

// GOOD
Route::middleware('permission:reports.all-shops')->get('/reports/accounting', ...);
```

Find: Semgrep rule `laravel-hardcoded-user-id-allowlist`, plus
`grep -rnE "(auth\(\)->id\(\)|Auth::id\(\)|->user\(\)->id)\s*(===?|!==?|,)\s*\[?[0-9]" app/`.

## 3. Policies with tenant scoping (IDOR)

Sequential IDs make every `findOrFail($id)` enumerable. The fix is a Policy that checks
tenant ownership, applied on every route model binding.

```php
// app/Policies/InvoicePolicy.php
final class InvoicePolicy
{
    public function view(User $user, Invoice $invoice): bool
    {
        return $user->can('invoices.view') && $user->canAccessShop($invoice->shop_id);
    }

    public function delete(User $user, Invoice $invoice): bool
    {
        return $user->can('invoices.delete')
            && $user->canAccessShop($invoice->shop_id)
            && $invoice->isDraft();                       // business state guard
    }
}

// app/Models/User.php
public function canAccessShop(int $shopId): bool
{
    return $this->can('shops.all') || $this->shops()->whereKey($shopId)->exists();
}
```

Policies are auto-discovered when they follow the `App\Policies\{Model}Policy` convention;
otherwise register with `Gate::policy()` in a service provider. Use them in routes
(`->middleware('can:view,invoice')`) or controllers (`Gate::authorize('view', $invoice)`).

Listing endpoints need the same scope as a query, not only per-record checks:

```php
Invoice::query()->whereIn('shop_id', $request->user()->accessibleShopIds())->paginate();
```

IDOR regression test (write one per document type: invoices, credit notes, delivery notes):

```php
public function test_user_cannot_download_invoice_of_other_shop(): void
{
    [$shopA, $shopB] = Shop::factory()->count(2)->create();
    $user = User::factory()->create();
    $user->givePermissionTo('invoices.view');
    $user->shops()->attach($shopA);

    $foreign = Invoice::factory()->for($shopB)->create();

    $this->actingAs($user)->get(route('invoices.download', $foreign))->assertForbidden();
}
```

Also do not trust a tenant or subject ID supplied by a client. If a BFF or SPA sends
`customer_id`, ignore it and resolve the customer from the authenticated token.

## 4. `withoutMiddleware` pitfalls

```php
// BAD: one line removes the permission check from every nested route
Route::middleware(['auth', EnsureUserHasPermission::class])->group(function () {
    Route::withoutMiddleware(EnsureUserHasPermission::class)->group(function () {
        // 300 routes, now authorized by nothing but "is logged in"
    });
});
```

`withoutMiddleware` is legitimate for narrow cases (excluding CSRF on one webhook route).
On groups it hides the blast radius. Rule: no `withoutMiddleware` on groups; on single routes
only with a comment and a RouteSecurityTest allowlist entry.

## 5. Mass assignment and column writes

```php
// BAD
$buffer->update($request->all());                            // can change created_by_user_id
$product->{$request->input('field')} = $request->input('value');

// GOOD
$buffer->update($request->validated());
$field = $request->validate(['field' => ['required', Rule::in(['width', 'height', 'depth', 'weight'])]])['field'];
$product->forceFill([$field => $request->float('value')])->save();
```

## 6. Customer decision links (tokens in links)

Pattern: an email contains "Accept / Cancel / Wait" links for an order. The token check is
the only thing between the internet and your order state machine.

```php
// BAD: debug bypass, timing-unsafe, never expires, reusable
if ($request->token !== $order->decision_token && $request->token !== 'debug') {
    abort(403);
}
```

Option A, signed URLs (no DB state needed to validate):

```php
// generate
$url = URL::temporarySignedRoute('orders.decision', now()->addDays(7), [
    'order' => $order->id, 'decision' => 'cancel', 'nonce' => $decision->id,
]);

// route
Route::get('/orders/{order}/decision/{decision}', [OrderDecisionController::class, 'show'])
    ->name('orders.decision')->middleware(['signed', 'throttle:20,1']);
Route::post('/orders/{order}/decision/{decision}', [OrderDecisionController::class, 'store'])
    ->name('orders.decision.store')->middleware(['signed', 'throttle:20,1']);
```

GET shows a confirmation page; the POST performs the change. Email clients and link scanners
prefetch GET links, so a GET that cancels an order will eventually cancel one by itself.
Signed URLs stay valid until expiry, so consume a single-use record:

```php
public function store(Order $order, string $decision, Request $request): Response
{
    DB::transaction(function () use ($order, $decision, $request) {
        $row = CustomerDecision::whereKey($request->integer('nonce'))
            ->where('order_id', $order->id)->lockForUpdate()->firstOrFail();

        abort_if($row->used_at !== null, 410, 'Link already used.');
        abort_unless($order->status->allowsCustomerDecision(), 409);

        $row->update(['used_at' => now(), 'decision' => $decision]);
        app(ApplyCustomerDecision::class)($order, $decision);
    });

    return response()->view('decision.done');
}
```

Option B, random token in DB: store only a hash, compare with `hash_equals`, check expiry and
`used_at`:

```php
$plain = Str::random(40);
CustomerDecision::create([
    'order_id' => $order->id,
    'token_hash' => hash('sha256', $plain),
    'expires_at' => now()->addDays(7),
]);

// verify
$row = CustomerDecision::where('order_id', $order->id)->whereNull('used_at')
    ->where('expires_at', '>', now())->latest('id')->first();
abort_unless($row && hash_equals($row->token_hash, hash('sha256', (string) $request->query('token'))), 403);
```

Regression tests:

```php
public function test_decision_link_rejects_any_literal_token(): void
{
    $order = Order::factory()->create();
    foreach (['', '0', 'debug', 'test', '666', 'null'] as $guess) {
        $this->post("/orders/{$order->id}/decision/cancel?token={$guess}")->assertForbidden();
    }
    $this->assertNotSame(OrderStatus::Cancelled, $order->fresh()->status);
}

public function test_signed_decision_link_is_single_use_and_expires(): void
{
    $order = Order::factory()->awaitingDecision()->create();
    $decision = CustomerDecision::factory()->for($order)->create();
    $url = URL::temporarySignedRoute('orders.decision.store', now()->addHour(),
        ['order' => $order->id, 'decision' => 'cancel', 'nonce' => $decision->id]);

    $this->post($url)->assertOk();
    $this->post($url)->assertStatus(410);

    $this->travel(2)->hours();
    $this->post($url)->assertForbidden();   // ValidateSignature throws InvalidSignatureException (403)
}
```

## 7. Internal API tokens: fail closed

```php
// BAD: config('internal.token') defaults to '' -> an empty header passes
if ($request->header('X-Internal-Token') !== config('internal.token')) abort(401);

// GOOD
final class RequireInternalToken
{
    public function handle(Request $request, Closure $next): Response
    {
        $expected = (string) config('internal.token');
        $given = (string) $request->header('X-Internal-Token');

        if (strlen($expected) < 32 || ! hash_equals($expected, $given)) {
            abort(401);
        }

        return $next($request);
    }
}
```

Test: with `config(['internal.token' => ''])` a request with an empty header gets 401.
