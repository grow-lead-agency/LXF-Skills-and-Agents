# Sources: laravel-security

Research 2026-09-25 (all pages opened via firecrawl scrape or curl):

- https://laravel.com/docs/12.x/authorization (Gate::before, policies)
- https://laravel.com/docs/12.x/urls (temporarySignedRoute, hasValidSignature, signed middleware)
- https://laravel.com/docs/12.x/rate-limiting
- https://laravel.com/docs/12.x/routing (rate limiting, route model binding)
- https://laravel.com/docs/12.x/middleware
- https://laravel.com/docs/12.x/session
- https://laravel.com/docs/12.x/requests (trustHosts, trustProxies)
- https://laravel.com/docs/12.x/authentication (AuthenticateSession, logoutOtherDevices)
- https://laravel.com/docs/12.x/queues (ShouldBeUnique, WithoutOverlapping, --timeout vs retry_after)
- https://laravel.com/docs/12.x/scheduling (withoutOverlapping)
- https://laravel.com/docs/12.x/filesystem (visibility, temporaryUrl, local serve)
- https://laravel.com/docs/13.x/releases (support policy table, security fix end dates)
- https://raw.githubusercontent.com/laravel/laravel/12.x/config/session.php (same_site lax, partitioned)
- https://raw.githubusercontent.com/laravel/laravel/13.x/config/session.php
- https://raw.githubusercontent.com/laravel/framework/12.x/src/Illuminate/Foundation/Configuration/Middleware.php (throttleApi opt-in, prependToPriorityList, trustHosts)
- https://raw.githubusercontent.com/laravel/framework/12.x/src/Illuminate/Routing/Router.php (public gatherRouteMiddleware)
- https://raw.githubusercontent.com/laravel/framework/12.x/src/Illuminate/Foundation/Console/RouteListCommand.php (route:list --json middleware array)
- https://developers.shoptet.com/webhooks/ (Shoptet-Webhook-Signature HMAC-SHA1, renew-signature-key, IP range 185.184.254.0/24, 4 s ack, 3 attempts)
- https://spatie.be/docs/laravel-permission/v6/basic-usage/middleware
- https://spatie.be/docs/laravel-permission/v6/best-practices/roles-vs-permissions
- https://github.com/dompdf/dompdf (isRemoteEnabled, chroot)
- https://raw.githubusercontent.com/spatie/browsershot/main/docs/miscellaneous-options/disable-sandboxing.md

Opened, unusable: https://mpdf.github.io/reference/mpdf-variables/whiteliststreamwrappers.html (404). The mPDF remote-fetch advice is therefore generic (escape + egress block), not tied to a verified mPDF option.

Primary input (internal, not public): anonymized findings register of a Laravel 11 ERP security audit, 2026-09-25.
