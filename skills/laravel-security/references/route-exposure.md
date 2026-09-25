# Route exposure audit (category 1)

Goal: know, for every route, what actually runs in front of it. Reading `routes/web.php`
is not enough: groups nest, aliases hide classes, and `withoutMiddleware()` removes checks
from everything below it.

## 1. Quick inventory from the CLI

```bash
# All state-changing routes and their resolved middleware
php artisan route:list --json --except-vendor \
  | jq -r '.[] | select(.method | test("POST|PUT|PATCH|DELETE"))
           | "\(.method)\t\(.uri)\t\(.action)\t\((.middleware // []) | join(","))"' \
  > routes-write.tsv

# Write routes without any authentication middleware
php artisan route:list --json --except-vendor \
  | jq -r '.[] | select(.method | test("POST|PUT|PATCH|DELETE"))
           | select(((.middleware // []) | map(test("Authenticate|auth|ValidateSignature|signed|Webhook"; "i")) | any) | not)
           | "\(.method) \(.uri) -> \(.action)"'

# Write routes that are authenticated but carry no authorization (permission/role/can)
php artisan route:list --json --except-vendor \
  | jq -r '.[] | select(.method | test("POST|PUT|PATCH|DELETE"))
           | select((.middleware // []) | map(test("Authenticate|auth"; "i")) | any)
           | select(((.middleware // []) | map(test("Permission|Role|Authorize|can:"; "i")) | any) | not)
           | "\(.method) \(.uri) -> \(.action)"'

# GET routes whose name or URI suggests a side effect
php artisan route:list --json --except-vendor \
  | jq -r '.[] | select(.method | test("^GET"))
           | select(((.name // "") + " " + .uri) | test("delete|destroy|remove|purge|cancel|approve|reject|sync|send|reset|import|decision"; "i"))
           | "\(.uri) -> \(.action)"'
```

Notes:
- The JSON `middleware` field is the resolved list; run the commands on the exact commit you
  audit, with production-like `APP_ENV` (conditional route files exist).
- Controller-level authorization (`$this->authorize()`, `Gate::authorize()`, FormRequest
  `authorize()`) is invisible here. Treat "no middleware" routes as *candidates* and read the
  action. Prefer moving authorization to middleware so the test below can see it.
- Then open each route file and look for anything defined **after** the auth group's closing
  `});`. That is where the public "helper" routes accumulate.

## 2. Regression test: every state-changing route has auth + authorization

Drop into `tests/Feature/Security/RouteSecurityTest.php`. It fails the build the moment
someone adds a write route outside the protected groups or strips middleware.

```php
<?php

namespace Tests\Feature\Security;

use Illuminate\Routing\Route as RoutingRoute;
use Illuminate\Support\Facades\Route;
use Illuminate\Support\Str;
use Tests\TestCase;

final class RouteSecurityTest extends TestCase
{
    /**
     * Routes that are intentionally reachable without a logged-in user.
     * Key = route name (or "METHOD uri" when unnamed). Value = reason. Keep it short.
     */
    private const PUBLIC_WRITE_ALLOWLIST = [
        'login' => 'login form',
        'logout' => 'logout',
        'password.email' => 'reset request, throttled',
        'password.update' => 'reset with token',
        // 'webhooks.shoptet' => 'HMAC verified by VerifyShoptetWebhookSignature',
    ];

    /** Authenticated write routes that intentionally need no extra permission. */
    private const AUTH_ONLY_ALLOWLIST = [
        // 'profile.update' => 'user edits own profile',
    ];

    private const AUTHN = [
        \Illuminate\Auth\Middleware\Authenticate::class,
        \Illuminate\Routing\Middleware\ValidateSignature::class,
        // your own HMAC / token middleware counts as authentication for machine callers:
        // \App\Http\Middleware\VerifyShoptetWebhookSignature::class,
    ];

    private const AUTHZ = [
        \Illuminate\Auth\Middleware\Authorize::class,           // can:
        \Spatie\Permission\Middleware\PermissionMiddleware::class,
        \Spatie\Permission\Middleware\RoleMiddleware::class,
        \Spatie\Permission\Middleware\RoleOrPermissionMiddleware::class,
    ];

    public function test_every_state_changing_route_requires_authentication(): void
    {
        $violations = [];

        foreach ($this->writeRoutes() as $key => $route) {
            if (array_key_exists($key, self::PUBLIC_WRITE_ALLOWLIST)) {
                continue;
            }
            if (! $this->hasAny($route, self::AUTHN)) {
                $violations[] = $key.' -> '.$route->getActionName();
            }
        }

        $this->assertSame([], $violations, "Write routes without authentication:\n".implode("\n", $violations));
    }

    public function test_every_authenticated_write_route_has_authorization(): void
    {
        $violations = [];

        foreach ($this->writeRoutes() as $key => $route) {
            if (array_key_exists($key, self::PUBLIC_WRITE_ALLOWLIST)
                || array_key_exists($key, self::AUTH_ONLY_ALLOWLIST)) {
                continue;
            }
            if ($this->hasAny($route, [\Illuminate\Auth\Middleware\Authenticate::class])
                && ! $this->hasAny($route, self::AUTHZ)) {
                $violations[] = $key.' -> '.$route->getActionName();
            }
        }

        $this->assertSame([], $violations, "Write routes without permission/can middleware:\n".implode("\n", $violations));
    }

    public function test_allowlists_do_not_contain_stale_entries(): void
    {
        $known = array_keys($this->allRoutesByKey());
        $stale = array_diff(array_keys(self::PUBLIC_WRITE_ALLOWLIST + self::AUTH_ONLY_ALLOWLIST), $known);

        $this->assertSame([], array_values($stale), 'Allowlist entries for routes that no longer exist');
    }

    public function test_no_get_route_looks_like_a_side_effect(): void
    {
        $pattern = '/(delete|destroy|remove|purge|cancel|approve|reject|sync|send|reset|import)/i';
        $allowed = [/* 'orders.export' => 'read-only despite the name' */];
        $violations = [];

        foreach ($this->allRoutesByKey() as $key => $route) {
            if (! in_array('GET', $route->methods(), true) || isset($allowed[$key])) {
                continue;
            }
            if (preg_match($pattern, ($route->getName() ?? '').' '.$route->uri())) {
                $violations[] = $key;
            }
        }

        $this->assertSame([], $violations, "GET routes that look state-changing:\n".implode("\n", $violations));
    }

    /** @return array<string, RoutingRoute> */
    private function writeRoutes(): array
    {
        return array_filter(
            $this->allRoutesByKey(),
            fn (RoutingRoute $r) => array_diff($r->methods(), ['GET', 'HEAD', 'OPTIONS']) !== []
        );
    }

    /** @return array<string, RoutingRoute> */
    private function allRoutesByKey(): array
    {
        $out = [];
        foreach (Route::getRoutes() as $route) {
            if (Str::startsWith($route->getActionName(), ['Laravel\\', 'Livewire\\', 'Barryvdh\\'])) {
                continue; // vendor routes; audit separately if exposed in production
            }
            $key = $route->getName() ?? implode('|', $route->methods()).' '.$route->uri();
            $out[$key] = $route;
        }

        return $out;
    }

    /** Resolved middleware (groups + aliases expanded, withoutMiddleware applied). */
    private function hasAny(RoutingRoute $route, array $classes): bool
    {
        $resolved = app('router')->gatherRouteMiddleware($route);

        foreach ($resolved as $mw) {
            if (! is_string($mw)) {
                continue; // closure middleware
            }
            $class = Str::before($mw, ':');
            foreach ($classes as $wanted) {
                if ($class === $wanted || is_subclass_of($class, $wanted)) {
                    return true;
                }
            }
        }

        return false;
    }
}
```

Adoption in a legacy app: the first run lists hundreds of routes. Do not allowlist them in
bulk. Commit the current list as a baseline file, make the test fail only on *new*
violations, and burn the baseline down route by route (ratchet).

## 3. Behavioral test per sensitive route

The structural test proves middleware exists; one behavioral test per critical route proves
it works. Run as the **lowest** privileged role, not admin.

```php
public function test_guest_cannot_delete_uploaded_files(): void
{
    Storage::fake('public');
    Storage::disk('public')->put('labels/1.pdf', 'x');

    $this->deleteJson('/delete-image', ['path' => 'labels/1.pdf'])->assertUnauthorized();

    Storage::disk('public')->assertExists('labels/1.pdf');
}

public function test_plain_employee_cannot_escalate_own_permissions(): void
{
    $employee = User::factory()->create();          // no roles
    Permission::findOrCreate('permissions.manage');

    $this->actingAs($employee)
        ->post(route('permissions.user.sync', $employee), ['permissions' => ['permissions.manage']])
        ->assertForbidden();

    $this->assertFalse($employee->fresh()->hasPermissionTo('permissions.manage'));
}
```

## 4. Find it in code review

- `routes/*.php`: `Route::` calls after the group that applies `auth`.
- `->withoutMiddleware(` anywhere (Semgrep rule `laravel-without-middleware`).
- `Auth::routes()` without `['register' => false]` on an internal app.
- Test or demo routes (`/test-*`, `/demo`, `/debug`) rendering real records.
- `Route::get(` whose closure or action writes (`->delete()`, `->update(`, `Mail::`).
