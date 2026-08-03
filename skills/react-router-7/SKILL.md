---
name: react-router-7
description: >-
  react-router-dom v7 in the storefront SPA (React 19 + Vite 8): library/data mode
  with createBrowserRouter + RouterProvider — not Remix framework mode, not SSR.
  Nested layout routes, loaders/actions, lazy route modules, errorElement,
  auth-gated routes against the GraphQL BFF session, GraphQL loaders with AbortSignal,
  pending UI, search params, scroll restoration, createMemoryRouter tests.
  Triggers: "react-router", "createBrowserRouter", "RouterProvider", "loader",
  "useLoaderData", "useNavigation", "errorElement", "useRouteError", "Outlet",
  "useParams", "useSearchParams", "lazy route", "protected route", "NavLink",
  "createMemoryRouter", "react-router-dom 7", "storefront routing".
---

# React Router 7 — Storefront SPA (library / data mode)

Pin: **`react-router-dom` v7**. Use **data routers** (`createBrowserRouter` +
`RouterProvider`). Do **not** adopt framework mode (no `react-router.config`,
no SSR, no file-based route modules as the app framework). Declarative
`<BrowserRouter>` + `<Routes>` only fits tiny trees without loaders.

In v7, `react-router-dom` re-exports the public API — import from
`react-router-dom` (matches this project's dependency).

## Project conventions

- App root: `bff/frontend` (React 19, TS ~6.0, Vite 8). Dev port **3000** via
  `bff/docker-compose.yml` (project `luxshop`).
- Data: GraphQL against the NestJS BFF at `VITE_API_URL` (default
  `http://localhost:4000`). Storefront never calls Laravel REST directly.
- Router next to entry (e.g. `src/router.tsx` + `src/routes/*`). Co-locate page
  component + loader + error UI per feature as they grow.
- Auth/session from the BFF GraphQL session. Protect routes in **loaders** with
  `redirect`, not only with UI conditionals.
- Lint: oxlint. Prefer route `lazy` + Vite `import()` for code splitting — not
  ad-hoc `React.lazy` inside components.

## Bootstrap

```tsx
// src/main.tsx
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { RouterProvider } from "react-router-dom";
import { router } from "./router";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>,
);
```

```tsx
// src/router.tsx
import { createBrowserRouter, redirect } from "react-router-dom";
import { RootLayout } from "./routes/RootLayout";
import { HomePage } from "./routes/HomePage";
import { RouteError } from "./routes/RouteError";

export const router = createBrowserRouter([
  {
    path: "/",
    Component: RootLayout,
    errorElement: <RouteError />,
    children: [
      { index: true, Component: HomePage },
      {
        path: "products/:productId",
        lazy: () => import("./routes/ProductPage"),
      },
      {
        path: "account",
        lazy: () => import("./routes/AccountPage"),
        loader: async ({ request }) => {
          const session = await fetchSession({ signal: request.signal });
          if (!session?.user) return redirect("/login");
          return { session };
        },
      },
    ],
  },
]);
```

Prefer route fields `Component` / `loader` / `action` / `ErrorBoundary` over
JSX `element` — they compose cleanly with `lazy`.

## Nested routes, layouts, params, index

- Parent renders shared chrome + `<Outlet />` for children.
- `index: true` = default child at the parent's path.
- Dynamic segments: `path: "products/:productId"` → `useParams()` →
  `{ productId: string }`.
- Pathless layout routes: omit `path`, set `Component` + `children` to wrap a
  group without changing the URL.

```tsx
import { Outlet, useNavigation } from "react-router-dom";

export function RootLayout() {
  const navigation = useNavigation();
  const busy = navigation.state !== "idle";
  return (
    <div data-busy={busy || undefined}>
      {busy && <div role="status">Loading…</div>}
      <Outlet />
    </div>
  );
}
```

## Data APIs (library / data mode)

Loaders and actions run on the **client** here (no SSR). They still give
parallel data loading, cancellation, pending state, and form posts without
fetch-in-`useEffect` waterfalls on navigation.

### Loader

```tsx
import type { LoaderFunctionArgs } from "react-router-dom";
import { useLoaderData } from "react-router-dom";

export async function loader({ request, params }: LoaderFunctionArgs) {
  // request.signal aborts when the user navigates away
  const product = await gql(
    `query ($id: ID!) { product(id: $id) { id name } }`,
    { variables: { id: params.productId }, signal: request.signal },
  );
  return { product };
}

export function ProductPage() {
  const { product } = useLoaderData() as { product: { id: string; name: string } };
  return <h1>{product.name}</h1>;
}
```

Rules:
- Return serializable plain data.
- Pass `request.signal` on every network call.
- Parent and child loaders for one navigation run in **parallel** — do not
  re-fetch parent data inside the child.
- `return redirect("/path")` (or throw it) to change location from loader/action.
- `throw new Response("Not found", { status: 404 })` for HTTP-like errors;
  detect with `isRouteErrorResponse` in the boundary.

### Pending UI — `useNavigation`

```tsx
const navigation = useNavigation();
// state: "idle" | "loading" | "submitting"
const isNavigating = navigation.state === "loading";
const isSubmitting = navigation.state === "submitting";
// Boolean(navigation.location) also means a transition is in flight
```

### Actions

```tsx
import {
  Form,
  redirect,
  useActionData,
  useNavigation,
  type ActionFunctionArgs,
} from "react-router-dom";

export async function action({ request }: ActionFunctionArgs) {
  const formData = await request.formData();
  const email = String(formData.get("email") ?? "");
  if (!email.includes("@")) return { error: "Invalid email" };
  await gqlMutation(/* ... */, { signal: request.signal });
  return redirect("/account");
}

export function LoginPage() {
  const data = useActionData() as { error?: string } | undefined;
  const navigation = useNavigation();
  const busy = navigation.state === "submitting";
  return (
    <Form method="post">
      <input name="email" type="email" disabled={busy} />
      {data?.error && <p>{data.error}</p>}
      <button type="submit" disabled={busy}>
        {busy ? "Signing in…" : "Sign in"}
      </button>
    </Form>
  );
}
```

`<Form>` from react-router posts to the route `action` and drives navigation
state. A plain `<form onSubmit>` + imperative `fetch` does not.

## Lazy route modules + Vite splitting

```tsx
// route config
{ path: "checkout", lazy: () => import("./routes/CheckoutPage") }

// src/routes/CheckoutPage.tsx — export route properties by name
export { CheckoutPage as Component };
export { checkoutLoader as loader };
export { CheckoutError as ErrorBoundary };
```

Vite turns each dynamic `import()` into a separate chunk. `lazy` may also
return `{ Component, loader, action, ErrorBoundary }` assembled from multiple
imports if you need finer splits.

## Errors — `errorElement` / `useRouteError`

```tsx
import { isRouteErrorResponse, useRouteError, Link } from "react-router-dom";

export function RouteError() {
  const error = useRouteError();
  if (isRouteErrorResponse(error)) {
    return (
      <main>
        <h1>
          {error.status} {error.statusText}
        </h1>
        <p>{typeof error.data === "string" ? error.data : "Request failed"}</p>
        <Link to="/">Home</Link>
      </main>
    );
  }
  const message = error instanceof Error ? error.message : "Unknown error";
  return (
    <main>
      <h1>Something went wrong</h1>
      <p>{message}</p>
    </main>
  );
}
```

Route-level `errorElement` / `ErrorBoundary` catches loader, action, and render
errors for that branch; they bubble to the nearest ancestor. Always put a root
boundary on `/`.

## Navigation

| API | Use |
| --- | --- |
| `<Link to>` | Declarative navigation |
| `<NavLink to>` | + `isActive` / `className` callback |
| `useNavigate()` | Imperative: `navigate("/cart")`, `navigate(-1)` |
| `redirect("/login")` | From loaders/actions |
| `<Navigate to replace />` | Render-time redirect (prefer loader `redirect` for auth) |

`className={({ isActive }) => (isActive ? "nav-active" : "nav")}` on `NavLink`.

## Search params

```tsx
import { useSearchParams } from "react-router-dom";

const [searchParams, setSearchParams] = useSearchParams();
const q = searchParams.get("q") ?? "";

setSearchParams({ q: "oak" });
setSearchParams((prev) => {
  prev.set("page", "2");
  return prev;
});
```

`setSearchParams` navigates. The functional form does **not** queue like React
`setState` — multiple calls in one tick do not chain. In loaders, read filters
from `new URL(request.url).searchParams`.

## Scroll restoration

In data mode, render **one** `<ScrollRestoration />` in the root layout:

Place `<ScrollRestoration />` beside the root `<Outlet />`. Optional
`getKey={(location) => location.pathname}` restores per path instead of
`location.key`.

## Auth-gated routes (BFF session)

Protect in the **loader** so deep links and reload cannot flash private UI:

```tsx
import { redirect, type LoaderFunctionArgs } from "react-router-dom";

export async function requireSession({ request }: LoaderFunctionArgs) {
  const session = await fetchSession({ signal: request.signal });
  if (!session?.user) {
    const next = new URL(request.url).pathname;
    return redirect(`/login?next=${encodeURIComponent(next)}`);
  }
  return session;
}

// child
{
  path: "orders",
  loader: async (args) => {
    const session = await requireSession(args);
    const orders = await fetchOrders(session, { signal: args.request.signal });
    return { orders };
  },
  lazy: () => import("./routes/OrdersPage"),
}
```

Do not rely only on `if (!user) return <Navigate …>` — that runs after render
and races data fetches.

## GraphQL loaders — no waterfalls, cancel properly

```tsx
async function gql<T>(
  query: string,
  opts: { variables?: Record<string, unknown>; signal?: AbortSignal } = {},
): Promise<T> {
  const res = await fetch(import.meta.env.VITE_API_URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ query, variables: opts.variables }),
    signal: opts.signal,
  });
  if (!res.ok) throw new Response("BFF error", { status: res.status });
  const body = await res.json();
  if (body.errors?.length) {
    throw new Response(body.errors[0].message, { status: 400 });
  }
  return body.data as T;
}
```

- **One loader round-trip per route segment.** Ask the BFF for the page shape
  in a single operation (or a fixed `Promise.all` set).
- Always pass `signal: request.signal`.
- Shared layout data (cart badge) on the layout loader, not every child.
- Use loaders for **navigation-driven** data; client hooks for post-mount
  refetches.

## v6 → v7 differences that matter

Minimum: Node 20, React 18+. With all v6 future flags already on, v7 is mainly
a version bump; otherwise:

| Area | Effect |
| --- | --- |
| `v7_relativeSplatPath` | Multi-segment splats (`dashboard/*`) change relative links — split path + child `*` |
| `v7_startTransition` | Router state uses `React.useTransition`; do not create promises / `React.lazy` **inside** components |
| `v7_fetcherPersist` | Fetcher lifecycle follows idle state, not owner unmount |
| Package | Still install `react-router-dom` for SPA DOM bindings |
| Modes | Framework mode is optional; this storefront stays on **library data mode** |

## Testing with `createMemoryRouter`

```tsx
import { createMemoryRouter, RouterProvider, useLoaderData } from "react-router-dom";
import { render, screen } from "@testing-library/react";

function Stub() {
  const { title } = useLoaderData() as { title: string };
  return <h1>{title}</h1>;
}

const router = createMemoryRouter(
  [{ path: "/products/:productId", loader: () => ({ title: "Oak Table" }), Component: Stub }],
  { initialEntries: ["/products/42"] },
);
render(<RouterProvider router={router} />);
await screen.findByRole("heading", { name: "Oak Table" });
```

Use `initialEntries` / `initialIndex` for deep links. Assert redirects via
`router.state.location.pathname` after navigation settles.

## Anti-patterns

Framework-mode/SSR assumptions; page data only in `useEffect`; auth only in
components; missing `request.signal`; nested `BrowserRouter`; multiple
`<ScrollRestoration />`.

## Sources

- React Router — https://reactrouter.com/
- Data route objects — https://reactrouter.com/start/data/route-object
- Declarative routing — https://reactrouter.com/start/declarative/routing
- Pending UI — https://reactrouter.com/start/framework/pending-ui
- Upgrade from v6 — https://reactrouter.com/upgrading/v6
- API: createBrowserRouter — https://api.reactrouter.com/v7/functions/react_router.createBrowserRouter.html
- API: createMemoryRouter — https://api.reactrouter.com/v7/functions/react_router.createMemoryRouter.html
- API: useLoaderData — https://api.reactrouter.com/v7/functions/react_router.useLoaderData.html
- API: useRouteError / isRouteErrorResponse / useSearchParams / ScrollRestoration — https://api.reactrouter.com/v7/functions/react_router.html
- GitHub — https://github.com/remix-run/react-router
