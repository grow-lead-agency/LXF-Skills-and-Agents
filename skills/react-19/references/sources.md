# Research Sources — react-19 skill

## Primary Sources (React 19 Official)

1. **React 19 Release Blog** — https://react.dev/blog/2024/12/05/react-19
   - Actions, useActionState, useOptimistic, use(), ref as prop, document metadata, preloading, compiler
   - Fetched: 2026-04-03

2. **React 19 Upgrade Guide** — https://react.dev/blog/2024/04/25/react-19-upgrade-guide
   - Breaking changes, removed APIs, codemods, TypeScript changes
   - Fetched: 2026-04-03

3. **useActionState Reference** — https://react.dev/reference/react/useActionState
   - Full API signature, caveats, examples, troubleshooting
   - Fetched: 2026-04-03

4. **useOptimistic Reference** — https://react.dev/reference/react/useOptimistic
   - Full API, how revert works, list patterns
   - Fetched: 2026-04-03

5. **use() API Reference** — https://react.dev/reference/react/use
   - Promise + Context reading, Suspense integration, caveats
   - Fetched: 2026-04-03

6. **useFormStatus Reference** — https://react.dev/reference/react-dom/hooks/useFormStatus
   - Status object, pending/data/method/action, pitfalls
   - Fetched: 2026-04-03

7. **`<title>` Component Reference** — https://react.dev/reference/react-dom/components/title
   - Document metadata hoisting, string interpolation gotcha
   - Fetched: 2026-04-03

8. **preload() API Reference** — https://react.dev/reference/react-dom/preload
   - Resource preloading API, options
   - Fetched: 2026-04-03

9. **React Compiler Introduction** — https://react.dev/learn/react-compiler/introduction
   - Auto-memoization, what it does, when to use manual memoization
   - Fetched: 2026-04-03

10. **React Compiler Installation** — https://react.dev/learn/react-compiler/installation
    - Vite setup, ESLint integration, verification
    - Fetched: 2026-04-03

11. **ViewTransition Component** — https://react.dev/reference/react/ViewTransition
    - Canary-only animation API (noted as [Canary] in skill)
    - Fetched: 2026-04-03

## Secondary Sources

13. **ctx7 react skill (blencorp/claude-code-kit)** — https://github.com/blencorp/claude-code-kit
    - Evaluated as CHERRY-PICK verdict: only the forwardRef removal note was useful; rest is React 18 basics
    - Inspected: 2026-04-03

## Notes

- React 19.2 is current stable as of 2026-04-03
- ViewTransition (`<ViewTransition>`) is Canary only as of this date
- React Compiler is stable (was experimental in early 2024 RC, now stable with React 19.2)
- useFormState (old Canary name) → renamed to useActionState in stable release

## 2026-07-15 — Delta refresh

Verified via Context7 (`/react/react` — Versions: v19.2.7, v18.2.0) + npm registry (`npm view react version` → 19.2.7) + WebFetch of https://react.dev/blog/2025/10/01/react-19-2.

**Drift found and fixed:**
- `<Activity>` was marked `[Canary]` in the Quick Reference Map — **wrong**. `<Activity>` was promoted to **stable** in the 19.2.0 release (2025-10-01). Confirmed via WebFetch: "`<Activity>` is released as a stable feature in React 19.2."
- Skill said "React 19.2 (released April 2025)" — **wrong date**. Context7 changelog (`/react/react` CHANGELOG.md) shows `## 19.2.0 (October 1st, 2025)`. Corrected to 2025-10-01.
- `<ViewTransition>` confirmed still Canary/experimental as of 19.2 (WebFetch: "not mentioned as a stable feature in React 19.2... being prepared for but not yet available"). No change needed — skill's original Canary label was already correct for this one.

**New in React 19.2 (added to skill, not previously documented):**
- `useEffectEvent` (stable) — extracts non-reactive logic out of Effects.
- `cacheSignal` (stable, RSC-only) — `AbortSignal` for `cache()` lifetime.
- React Performance Tracks in Chrome DevTools (no API, just DevTools UI).
- Server-only resume APIs (`resume`, `resumeAndPrerender`, `resumeToPipeableStream`, etc.) for partial pre-rendering with Web/Node streams — out of scope for this skill's client-focused content, not added.

Sources fetched:
- https://github.com/react/react/blob/main/CHANGELOG.md (via Context7 `/react/react`) — Fetched: 2026-07-15
- https://react.dev/blog/2025/10/01/react-19-2 — Fetched: 2026-07-15 (WebFetch)
- npm registry `react` package versions/dist-tags — Fetched: 2026-07-15

No further drift found in Actions/useActionState/useOptimistic/use()/ref-as-prop/form actions content — verified still accurate against current stable.
