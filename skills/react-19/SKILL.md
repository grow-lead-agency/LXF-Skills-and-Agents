---
name: react-19
description: >-
  React 19 new APIs and patterns — use() hook, useActionState, useOptimistic,
  useFormStatus, ref as prop, form actions, document metadata, resource preloading,
  React Compiler, and migration from React 18. Activate when writing React 19 code
  that uses new APIs, migrating React 18 patterns, or asking about Actions workflow,
  optimistic UI, async forms, or React Compiler setup. This skill is specifically
  about React 19 NEW features — NOT about basics (useState, useEffect, JSX).
  React 19 can also be hosted as an Astro island via the `@astrojs/react` integration
  (`client:load|idle|visible|only`) for content-heavy sites when the root project is Astro.
  Not for: react-hook-form patterns, TanStack Router specifics, general React basics,
  or Next.js App Router Server Actions.
  Triggers: react 19, useActionState, useOptimistic, useFormStatus, use hook, use(),
  form actions, ref as prop, forwardRef removal, react compiler, auto-memoization,
  document metadata, preload resource, optimistic update, async transition, actions,
  new hooks react, react 19 migration, react 19 patterns, react nineteen.
---

# React 19 — New APIs & Patterns

This skill covers React 19's new capabilities. Assumes React 18 knowledge — only what's NEW is documented here.

**Current stable: React 19.2** (19.2.0 released 2025-10-01; latest patch 19.2.7 — last verified 2026-07-15 via npm/Context7). All APIs below are stable unless marked [Canary].

---

## Quick Reference Map

| Feature | Import | Status |
|---------|--------|--------|
| `useActionState` | `react` | Stable |
| `useOptimistic` | `react` | Stable |
| `use()` | `react` | Stable |
| `<form action>` | `react-dom` | Stable |
| `useFormStatus` | `react-dom` | Stable |
| ref as prop | built-in | Stable |
| `<Context>` as provider | built-in | Stable |
| Ref cleanup functions | built-in | Stable |
| `<title>` / `<meta>` hoisting | `react-dom` | Stable |
| `preload`, `preinit`, etc. | `react-dom` | Stable |
| React Compiler | `babel-plugin-react-compiler` | Stable |
| `<Activity>` (React 19.2) | `react` | **Stable** (promoted from Canary in 19.2.0) |
| `useEffectEvent` (React 19.2) | `react` | Stable |
| `cacheSignal` (React 19.2, RSC only) | `react` | Stable |
| `<ViewTransition>` | `react` | Canary (still not promoted as of 19.2 — verified 2026-07-15) |

---

## 0. New in React 19.2 (Stable)

Three new stable APIs shipped in the 19.2.0 minor release (2025-10-01), on top of the Actions-era APIs below:

```tsx
import { Activity, useEffectEvent } from 'react'

// <Activity> — hide/restore a subtree's UI AND internal state (unlike conditional rendering,
// state and effects are preserved while hidden; unlike `display: none`, hidden effects unmount).
function Tabs({ activeTab }: { activeTab: 'chat' | 'settings' }) {
  return (
    <>
      <Activity mode={activeTab === 'chat' ? 'visible' : 'hidden'}>
        <ChatPanel />
      </Activity>
      <Activity mode={activeTab === 'settings' ? 'visible' : 'hidden'}>
        <SettingsPanel />
      </Activity>
    </>
  )
}

// useEffectEvent — extract non-reactive logic out of an Effect so the Effect's
// dependency array doesn't need to include values that shouldn't re-trigger it.
function ChatRoom({ roomId, theme }: { roomId: string; theme: string }) {
  const onConnected = useEffectEvent(() => {
    showNotification('Connected!', theme) // always reads latest `theme`
  })

  useEffect(() => {
    const connection = createConnection(roomId)
    connection.on('connected', () => onConnected())
    connection.connect()
    return () => connection.disconnect()
  }, [roomId]) // theme intentionally NOT a dependency — onConnected reads it live
}
```

`cacheSignal()` (RSC-only) returns an `AbortSignal` that fires when a `cache()`-wrapped function's lifetime ends — use it to cancel in-flight work tied to a request's cache scope. React Performance Tracks (Scheduler + Components lanes in Chrome DevTools Performance panel) also shipped in 19.2 for profiling — no code change required, just open DevTools.

---

## 1. Actions — The Core Pattern

React 19 introduces "Actions": async functions inside `startTransition` that automatically manage pending state, errors, and optimistic updates.

**Before React 19 (manual state juggling):**

```tsx
function UpdateName() {
  const [name, setName] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [isPending, setIsPending] = useState(false)

  const handleSubmit = async () => {
    setIsPending(true)
    const error = await updateName(name)
    setIsPending(false)
    if (error) { setError(error); return }
    redirect('/path')
  }

  return (
    <div>
      <input value={name} onChange={e => setName(e.target.value)} />
      <button onClick={handleSubmit} disabled={isPending}>Update</button>
      {error && <p>{error}</p>}
    </div>
  )
}
```

**React 19 with Actions (useTransition approach):**

```tsx
import { useTransition, useState } from 'react'

function UpdateName() {
  const [name, setName] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  const handleSubmit = () => {
    startTransition(async () => {
      const error = await updateName(name)
      if (error) { setError(error); return }
      redirect('/path')
    })
  }

  return (
    <div>
      <input value={name} onChange={e => setName(e.target.value)} />
      <button onClick={handleSubmit} disabled={isPending}>Update</button>
      {error && <p>{error}</p>}
    </div>
  )
}
```

**Key rules for Actions:**
- Actions must use async transitions (`startTransition(async () => {...})`)
- `isPending` automatically toggles during the async work
- Errors bubble to the nearest Error Boundary (no manual try/catch needed for UI)
- Multiple dispatched Actions queue sequentially — each gets the result of the previous

---

## 2. `useActionState` — Form Actions with State

Wraps an action function with state management. Replaces the pattern of `useState` + `useTransition` + error tracking for form-based mutations.

```tsx
import { startTransition, useActionState } from 'react'

// Signature:
// const [state, dispatchAction, isPending] = useActionState(reducerAction, initialState, permalink?)

async function changeName(previousState: string | null, formData: FormData) {
  const name = formData.get('name') as string
  const error = await updateName(name)
  if (error) return error   // Return error string as new state
  redirect('/profile')
  return null
}

function ChangeNameForm() {
  const [error, submitAction, isPending] = useActionState(changeName, null)

  return (
    <form action={submitAction}>
      <input type="text" name="name" />
      <button type="submit" disabled={isPending}>Update</button>
      {error && <p className="text-red-500">{error}</p>}
    </form>
  )
}
```

**With multiple action types (reducer pattern):**

```tsx
type State = { count: number; error: string | null }
type Action = { type: 'increment' } | { type: 'reset' }

async function counterReducer(state: State, action: Action): Promise<State> {
  if (action.type === 'increment') {
    const result = await saveCount(state.count + 1)
    if (!result.ok) return { ...state, error: result.error }
    return { count: state.count + 1, error: null }
  }
  return { count: 0, error: null }
}

function Counter() {
  const [state, dispatch, isPending] = useActionState(counterReducer, { count: 0, error: null })

  return (
    <div>
      <p>Count: {state.count}</p>
      {state.error && <p>{state.error}</p>}
      <button
        onClick={() => startTransition(() => dispatch({ type: 'increment' }))}
        disabled={isPending}
      >
        +
      </button>
      <button
        onClick={() => startTransition(() => dispatch({ type: 'reset' }))}
        disabled={isPending}
      >
        Reset
      </button>
    </div>
  )
}
```

**Important caveats:**
- `dispatchAction` must run in an Action context: pass it to a form `action` prop or call it
  inside `startTransition`. A plain event handler does not establish that context.
- With Server Functions, `initialState` must be serializable
- `permalink` param: for progressive enhancement with RSC — browser navigates there if JS hasn't loaded yet

---

## 3. `<form>` Actions — Native Form Integration

Pass async functions directly to `action` prop on `<form>`, `<input>`, and `<button>`.

```tsx
// Basic form action
async function createItem(formData: FormData) {
  const name = formData.get('name') as string
  await db.items.create({ name })
  // Form auto-resets on success
}

function CreateItemForm() {
  return (
    <form action={createItem}>
      <input type="text" name="name" placeholder="Item name" />
      <button type="submit">Create</button>
    </form>
  )
}
```

**Form auto-reset:** When a `<form>` action succeeds, React automatically resets uncontrolled inputs. Override with `requestFormReset(formEl)` if you need manual reset timing.

**Button-level action override (`formAction`):**

```tsx
function ItemForm() {
  return (
    <form action={createItem}>
      <input type="text" name="name" />
      <button type="submit">Create</button>
      <button formAction={createAsDraft}>Save as Draft</button>
    </form>
  )
}
```

---

## 4. `useFormStatus` — Pending State in Child Components

Reads the pending state of the nearest parent `<form>`. Designed for design system components that need form context without prop drilling.

```tsx
import { useFormStatus } from 'react-dom'

// Must be inside a <form> — cannot be in the same component as the <form>
function SubmitButton() {
  const { pending, data, method, action } = useFormStatus()
  return (
    <button type="submit" disabled={pending}>
      {pending ? 'Saving...' : 'Save'}
    </button>
  )
}

function MyForm() {
  return (
    <form action={saveData}>
      <input name="title" />
      <SubmitButton />  {/* SubmitButton reads form status */}
    </form>
  )
}
```

**Returns:**
- `pending: boolean` — is the parent form submitting?
- `data: FormData | null` — the data being submitted
- `method: 'get' | 'post'`
- `action: Function | null` — the action function

**Critical pitfall:** `useFormStatus` does NOT work in the same component that renders `<form>`. It must be in a child component.

---

## 5. `useOptimistic` — Optimistic UI Updates

Show optimistic state immediately while async work happens. Automatically reverts if the action fails.

```tsx
import { useOptimistic, startTransition } from 'react'

// Simple value toggle
function LikeButton({ isLiked, onToggle }: { isLiked: boolean; onToggle: () => Promise<void> }) {
  const [optimisticLiked, setOptimisticLiked] = useOptimistic(isLiked)

  return (
    <button onClick={() => {
      startTransition(async () => {
        setOptimisticLiked(!isLiked)  // Show immediately
        await onToggle()              // Real update — if this throws, reverts
      })
    }}>
      {optimisticLiked ? '❤️' : '🤍'}
    </button>
  )
}
```

**With list — optimistic add:**

```tsx
type Message = { id: string; text: string }

function MessageList({ messages, sendMessage }: {
  messages: Message[]
  sendMessage: (text: string) => Promise<void>
}) {
  const [optimisticMessages, addOptimisticMessage] = useOptimistic(
    messages,
    (currentMessages, newText: string) => [
      ...currentMessages,
      { id: crypto.randomUUID(), text: newText }  // Temp optimistic entry
    ]
  )

  return (
    <div>
      {optimisticMessages.map(m => <div key={m.id}>{m.text}</div>)}
      <form action={async (formData) => {
        const text = formData.get('text') as string
        addOptimisticMessage(text)   // Immediate update
        await sendMessage(text)      // Real mutation — reverts on error
      }}>
        <input name="text" />
        <button type="submit">Send</button>
      </form>
    </div>
  )
}
```

**How revert works:** `useOptimistic(serverValue)` — when the action finishes, React resolves to `serverValue`. If the server returns the updated value (via state update), both converge in one render. No extra "clear" render.

**Must be called inside an Action** — calling `setOptimistic` outside a transition causes a warning.

---

## 6. `use()` — Read Promises and Context in Render

A new API (not a hook, though it follows hook conventions) that reads resources during render. Unlike hooks, can be called conditionally.

```tsx
import { use } from 'react'

// Reading a Promise — suspends until resolved
function UserProfile({ userPromise }: { userPromise: Promise<User> }) {
  const user = use(userPromise)  // Suspends until resolved
  return <div>{user.name}</div>
}

// Parent must wrap in Suspense
function Page() {
  const userPromise = fetchUser(userId)  // Create promise outside the component
  return (
    <Suspense fallback={<Skeleton />}>
      <UserProfile userPromise={userPromise} />
    </Suspense>
  )
}
```

**Reading context conditionally (unlike `useContext`):**

```tsx
import { use } from 'react'
import { ThemeContext } from './ThemeContext'

function Heading({ children }: { children: React.ReactNode }) {
  if (!children) return null  // Early return — useContext would break here

  const theme = use(ThemeContext)  // Works in conditionals!
  return <h1 style={{ color: theme.color }}>{children}</h1>
}
```

**Critical: Do NOT create promises inside the component that calls `use()`.**

```tsx
// BAD — promise recreated on every render
function Bad() {
  const data = use(fetch('/api/data').then(r => r.json()))  // ❌ Warns
}

// GOOD — promise created outside / in parent / cached
const dataPromise = fetch('/api/data').then(r => r.json())  // Outside component
function Good() {
  const data = use(dataPromise)  // ✅
}
```

**Error handling with `use()`:** Wrap in ErrorBoundary. Rejected promises trigger the nearest error boundary.

---

## 7. Ref as Prop — No More `forwardRef`

React 19 passes `ref` as a regular prop to function components. `forwardRef` is now optional (still works, but deprecated path).

```tsx
// React 18 — required forwardRef
const MyInput = forwardRef<HTMLInputElement, { placeholder: string }>(
  ({ placeholder }, ref) => <input ref={ref} placeholder={placeholder} />
)

// React 19 — ref is just a prop
function MyInput({ placeholder, ref }: { placeholder: string; ref?: React.Ref<HTMLInputElement> }) {
  return <input ref={ref} placeholder={placeholder} />
}

// Usage unchanged
const inputRef = useRef<HTMLInputElement>(null)
<MyInput ref={inputRef} placeholder="Type here" />
```

**Codemod:** `npx codemod@latest react/19/replace-forwardRef`

**Ref cleanup functions (new):**

```tsx
// Return cleanup from ref callback — runs on unmount
<video ref={(videoEl) => {
  const player = initPlayer(videoEl)
  return () => player.destroy()  // NEW: cleanup function
}} />
```

---

## 8. `<Context>` as Provider

Shorter syntax for context providers.

```tsx
// React 18
const ThemeContext = createContext<string>('light')
<ThemeContext.Provider value="dark">...</ThemeContext.Provider>

// React 19
<ThemeContext value="dark">...</ThemeContext>
```

`<Context.Provider>` still works but will be deprecated in a future version.

---

## 9. Document Metadata — No react-helmet Needed

Render `<title>`, `<meta>`, `<link>` anywhere in the component tree — React hoists them to `<head>`.

```tsx
function ProductPage({ product }: { product: Product }) {
  return (
    <article>
      {/* Metadata — hoisted to <head> automatically */}
      <title>{product.name} — My Store</title>
      <meta name="description" content={product.description} />
      <meta property="og:image" content={product.imageUrl} />
      <link rel="canonical" href={`https://mystore.com/products/${product.slug}`} />

      {/* Regular content */}
      <h1>{product.name}</h1>
      <p>{product.description}</p>
    </article>
  )
}
```

**Title — string interpolation (not JSX expression):**

```tsx
// BAD — creates a two-element array as children
<title>Page {pageNumber}</title>  // ❌

// GOOD — single string
<title>{`Page ${pageNumber}`}</title>  // ✅
```

**Stylesheet precedence:**

```tsx
// Link stylesheets anywhere — React manages insertion order
function Dashboard() {
  return (
    <Suspense fallback={<Loading />}>
      <link rel="stylesheet" href="/dashboard.css" precedence="default" />
      <link rel="stylesheet" href="/charts.css" precedence="high" />
      <DashboardContent />
    </Suspense>
  )
}
```

**Async script deduplication:**

```tsx
// Render async scripts anywhere — React deduplicates across the tree
function MyWidget() {
  return (
    <div>
      <script async src="https://widget.example.com/widget.js" />
      Widget content
    </div>
  )
}
```

---

## 10. Resource Preloading APIs

```tsx
import { prefetchDNS, preconnect, preload, preinit } from 'react-dom'

function AppRoot() {
  // DNS prefetch — when you might request from this host
  prefetchDNS('https://api.example.com')

  // Preconnect — when you will request but don't know what yet
  preconnect('https://api.example.com')

  // Preload — download now, use later (fonts, images, stylesheets, scripts)
  preload('https://fonts.example.com/font.woff2', { as: 'font', crossOrigin: 'anonymous' })
  preload('/hero-image.webp', { as: 'image', fetchPriority: 'high' })
  preload('/critical.css', { as: 'style' })

  // Preinit — download AND execute immediately (scripts, stylesheets)
  preinit('https://analytics.example.com/script.js', { as: 'script' })
}
```

**Use case: preload on hover (before navigation):**

```tsx
function NavLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a
      href={href}
      onMouseEnter={() => {
        preload(`/page-data${href}.json`, { as: 'fetch' })
        preconnect(new URL(href, window.location.href).origin)
      }}
    >
      {children}
    </a>
  )
}
```

---

## 11. React Compiler — Auto-Memoization

Stable Babel/Vite plugin that automatically adds memoization. Removes the need for manual `useMemo`, `useCallback`, `React.memo` in most cases.

**Installation (Vite):**

```bash
npm install -D babel-plugin-react-compiler@latest
```

```ts
// vite.config.ts
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [
    react({
      babel: {
        plugins: ['babel-plugin-react-compiler'],
      },
    }),
  ],
})
```

**What it handles automatically:**

```tsx
// BEFORE: Manual memoization (error-prone)
const ExpensiveList = memo(function ExpensiveList({ items, onClick }) {
  const sorted = useMemo(() => [...items].sort(), [items])
  const handleClick = useCallback((id: string) => onClick(id), [onClick])
  return sorted.map(item => <Item key={item.id} onClick={() => handleClick(item.id)} />)
})

// AFTER: Write naturally — compiler handles it
function ExpensiveList({ items, onClick }) {
  const sorted = [...items].sort()  // Compiler memoizes this
  const handleClick = (id: string) => onClick(id)  // Compiler stabilizes this
  return sorted.map(item => <Item key={item.id} onClick={() => handleClick(item.id)} />)
}
```

**Verify the compiler is working:** Open React DevTools — optimized components show "Memo ✨" badge.

**Opt out specific components:**

```tsx
function ProblematicComponent() {
  'use no memo'  // Compiler skips this component
  // ...
}
```

**When to keep manual memoization:**
- Calculations outside components (compiler only memoizes components/hooks)
- Cases where the same calculation is shared across multiple components
- When you need explicit control over memoization identity

**ESLint integration:**

```bash
npm install -D eslint-plugin-react-hooks@latest
```

The ESLint plugin identifies violations of Rules of React that prevent compiler optimization.

---

## 12. Error Handling Improvements

**React 19 error reporting changes:**
- Errors no longer re-thrown after being caught (no more duplicate logs)
- `createRoot` and `hydrateRoot` now accept error handlers:

```tsx
const root = createRoot(container, {
  onUncaughtError: (error, errorInfo) => {
    // Report to Sentry etc. — this replaces window.onerror for React errors
    Sentry.captureException(error, { extra: errorInfo })
  },
  onCaughtError: (error, errorInfo) => {
    // Caught by Error Boundary — log but don't show to user
    console.error('Caught by boundary:', error)
  },
})
```

**Improved hydration error diffs:** Instead of multiple cryptic warnings, React 19 logs a single diff showing what mismatched.

**Error boundaries with Actions:** When an Action throws, React automatically cancels all queued actions and shows the nearest Error Boundary.

---

## 13. Migration from React 18

### Removed APIs (breaking)

| Removed | Replace with |
|---------|-------------|
| `ReactDOM.render()` | `createRoot().render()` |
| `ReactDOM.hydrate()` | `hydrateRoot()` |
| `unmountComponentAtNode()` | `root.unmount()` |
| `React.createFactory()` | JSX directly |
| `react-dom/test-utils` → `act` | `import { act } from 'react'` |
| `react-test-renderer/shallow` | `react-shallow-renderer` package |
| String refs (`ref="input"`) | Ref callbacks or `useRef` |
| Legacy Context (`contextTypes`, `getChildContext`) | `createContext` + `useContext` |
| `propTypes` checks | TypeScript |
| `defaultProps` on function components | ES6 default params |

### Codemods — run these first

```bash
# Run all React 19 migration codemods at once:
npx codemod@latest react/19/migration-recipe

# Individual codemods:
npx codemod@latest react/19/replace-reactdom-render
npx codemod@latest react/19/replace-string-ref
npx codemod@latest react/19/replace-act-import
npx codemod@latest react/prop-types-typescript
```

### TypeScript changes

```tsx
// ref is now typed as a prop in function components
interface MyInputProps {
  placeholder: string
  ref?: React.Ref<HTMLInputElement>  // Add this
}

// ReactDOM.render no longer exists in types
// Use React.JSX.IntrinsicElements instead of JSX.IntrinsicElements
// useFormState → useActionState (renamed)
```

### Upgrade path

1. Upgrade to React 18.3 first — it adds warnings for deprecated APIs
2. Fix all deprecation warnings
3. Upgrade to React 19
4. Run codemods
5. Fix TypeScript errors

---

## Anti-Patterns

**Avoid useFormState (deprecated name):**
```tsx
// ❌ Old name from Canary — renamed to useActionState
import { useFormState } from 'react-dom'  // Deprecated

// ✅
import { useActionState } from 'react'
```

**Do not create promises inside `use()` calls:**
```tsx
// ❌ Promise recreated every render — warns in React 19
function Bad() {
  const data = use(fetch('/api').then(r => r.json()))
}
```

**useFormStatus must be in a child, not the form's component:**
```tsx
// ❌ Doesn't work
function Form() {
  const { pending } = useFormStatus()  // Always false
  return <form action={submit}><button disabled={pending}>Send</button></form>
}

// ✅
function SubmitBtn() {
  const { pending } = useFormStatus()
  return <button disabled={pending}>Send</button>
}
function Form() {
  return <form action={submit}><SubmitBtn /></form>
}
```

**setOptimistic must be called inside an Action:**
```tsx
// ❌ Outside transition
button.addEventListener('click', () => setOptimistic(true))  // Warning

// ✅ Inside startTransition
startTransition(async () => {
  setOptimistic(true)
  await doWork()
})
```

**forwardRef not needed in React 19 function components:**
```tsx
// ❌ Legacy — still works but unnecessary
const Input = forwardRef<HTMLInputElement, Props>((props, ref) => <input ref={ref} {...props} />)

// ✅ Ref is just a prop now
function Input({ ref, ...props }: Props & { ref?: React.Ref<HTMLInputElement> }) {
  return <input ref={ref} {...props} />
}
```
