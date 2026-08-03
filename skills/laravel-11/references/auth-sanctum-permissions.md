# Auth: Sanctum 4 API tokens + spatie/laravel-permission 6

Read this when working on API authentication (`routes/api_v1.php`), token issuance,
roles/permissions, or authorization checks (policies, Blade, React-facing endpoints).

## Sanctum 4 — API token auth

The datamixer API (`/api/v1`) is consumed by the BFF using bearer tokens
(`DATAMIXER_API_KEY` on the BFF side). Sanctum stores tokens hashed in
`personal_access_tokens`; the plain text is shown **once** at creation.

### Issuing tokens

```php
// One-off (tinker / seeder / admin action):
$token = $user->createToken('bff')->plainTextToken;

// With abilities (scopes):
$token = $user->createToken('bff', ['orders:read', 'orders:write'])->plainTextToken;

// Optional expiry (3rd argument, Sanctum 4):
$token = $user->createToken('ci', ['*'], now()->addDays(30))->plainTextToken;
```

Global expiration can be set via `expiration` (minutes) in `config/sanctum.php`;
`null` = tokens never expire. Prune old expired tokens with the
`sanctum:prune-expired` artisan command (schedule it if expiry is enabled).

The `User` model must use `Laravel\Sanctum\HasApiTokens`.

### Token exchange endpoint (mobile/SPA-style login → token)

```php
Route::post('/token', function (Request $request) {
    $request->validate([
        'email' => 'required|email',
        'password' => 'required',
        'device_name' => 'required',
    ]);

    $user = User::where('email', $request->email)->first();

    if (! $user || ! Hash::check($request->password, $user->password)) {
        throw ValidationException::withMessages([
            'email' => ['The provided credentials are incorrect.'],
        ]);
    }

    return $user->createToken($request->device_name)->plainTextToken;
});
```

### Protecting api_v1 routes

```php
// routes/api_v1.php — group everything behind Sanctum:
Route::middleware('auth:sanctum')->group(function () {
    Route::apiResource('orders', Api\V1\OrderController::class);
});
```

Client sends `Authorization: Bearer <token>`. `$request->user()` resolves the
token's owner; `$request->user()->currentAccessToken()` gives the token model.

### Token abilities

Abilities are Sanctum's per-token scopes — independent from spatie permissions.
Check them in code:

```php
if ($user->tokenCan('orders:write')) { ... }
if ($user->tokenCant('orders:write')) { abort(403); }
```

Or via middleware. Laravel 11: register the aliases in `bootstrap/app.php`
(there is no HTTP Kernel):

```php
->withMiddleware(function (Middleware $middleware) {
    $middleware->alias([
        'abilities' => \Laravel\Sanctum\Http\Middleware\CheckAbilities::class,
        'ability'   => \Laravel\Sanctum\Http\Middleware\CheckForAnyAbility::class,
    ]);
})
```

```php
// requires ALL listed abilities:
Route::post('/orders', ...)->middleware(['auth:sanctum', 'abilities:orders:read,orders:write']);
// requires ANY of the listed abilities:
Route::get('/orders', ...)->middleware(['auth:sanctum', 'ability:orders:read,admin']);
```

Gotcha: first-party session (SPA cookie) requests are considered to have **all**
abilities — `tokenCan()` returns true for session-authenticated users. Ability
checks only constrain real bearer tokens.

### Revoking

```php
$user->tokens()->delete();                        // all tokens
$user->tokens()->where('id', $id)->delete();      // one token
$request->user()->currentAccessToken()->delete(); // current token (logout)
```

## spatie/laravel-permission 6

### Roles vs permissions — the rule

- **Check permissions, not roles**, in code (`can('edit orders')`), so access
  changes are data changes, not code changes.
- **Assign permissions to roles, roles to users.** Direct user→permission
  assignment is possible but keep it exceptional.
- Permissions/roles are plain Eloquent models (`roles`, `permissions`,
  `model_has_roles`, `model_has_permissions`, `role_has_permissions` tables).

### Setup on the model

```php
use Spatie\Permission\Traits\HasRoles;

class User extends Authenticatable
{
    use HasApiTokens, HasRoles, Notifiable;
}
```

### Creating and assigning

```php
$role = Role::create(['name' => 'accountant']);
$perm = Permission::create(['name' => 'export invoices']);

$role->givePermissionTo('export invoices');
$user->assignRole('accountant');

$user->hasRole('accountant');            // bool
$user->can('export invoices');           // preferred check (Gate integration)
$user->getAllPermissions();              // direct + via roles
```

Guards: permissions/roles are per-guard (`web` default). When checking against
API token users make sure the roles were created for the guard the user
authenticates with — a mismatch throws `RoleDoesNotExist`/`PermissionDoesNotExist`
or silently denies. If both web admin and API use the same `users` table and
default guard, you rarely need to touch this.

### Middleware (Laravel 11 registration)

```php
// bootstrap/app.php
->withMiddleware(function (Middleware $middleware) {
    $middleware->alias([
        'role'               => \Spatie\Permission\Middleware\RoleMiddleware::class,
        'permission'         => \Spatie\Permission\Middleware\PermissionMiddleware::class,
        'role_or_permission' => \Spatie\Permission\Middleware\RoleOrPermissionMiddleware::class,
    ]);
})
```

Note the v6 namespace is `Spatie\Permission\Middleware\...` (singular
`Middleware`, changed from `Middlewares` in v5).

```php
Route::group(['middleware' => ['auth:sanctum', 'permission:export invoices']], ...);
Route::group(['middleware' => ['role:admin|manager']], ...);   // OR with |
```

### ⚠️ Cache gotcha — after seeding or direct DB writes

The package caches permissions for 24h. Creating roles/permissions via the
models auto-flushes the cache, but **seeders that also assign within the same
process, tests, and any raw DB inserts** need an explicit reset or checks will
use stale data:

```php
// First line of a roles/permissions seeder:
app()[\Spatie\Permission\PermissionRegistrar::class]->forgetCachedPermissions();
```

```bash
php artisan permission:cache-reset   # manual flush (e.g. after deploy/seed)
```

Symptoms of a stale cache: freshly seeded permission exists in DB but
`can()` returns false / middleware 403s.

### Checks in policies

Policies stay the authorization front door; permissions are the data behind them:

```php
class InvoicePolicy
{
    public function export(User $user, Invoice $invoice): bool
    {
        return $user->can('export invoices')
            && $invoice->company_id === $user->company_id;
    }
}
// Controller / Form Request: $this->authorize('export', $invoice);
```

Do not call `$user->hasPermissionTo()` inside `Gate::before()` returning true for
super-admins via permission — use the documented pattern instead:

```php
Gate::before(fn ($user, $ability) => $user->hasRole('super-admin') ? true : null);
```

(Return `null`, not `false`, so other checks still run.)

### Checks in Blade

```blade
@can('export invoices') ... @endcan          {{-- preferred, native Gate --}}
@role('admin') ... @endrole                  {{-- package directive --}}
@hasanyrole('admin|manager') ... @endhasanyrole
```

### Permissions for the React admin / BFF-facing endpoints

The React admin (Bootstrap 5 SPA pages) and the BFF cannot run Blade directives —
expose the user's effective permissions in the auth payload once and let the
frontend toggle UI; the server remains the enforcement point:

```php
// e.g. /api/v1/me
return [
    'user'        => UserResource::make($user),
    'roles'       => $user->getRoleNames(),                          // Collection<string>
    'permissions' => $user->getAllPermissions()->pluck('name'),      // direct + via roles
];
```

Frontend hides an "Export" button when `permissions` lacks `export invoices`;
the endpoint still enforces `permission:export invoices` middleware or a policy.
Never trust the UI check alone.
