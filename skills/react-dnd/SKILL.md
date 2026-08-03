---
name: react-dnd
description: >-
  react-dnd with the HTML5 backend in the React 18 admin panel (Bootstrap 5 /
  react-bootstrap): DndProvider setup, useDrag/useDrop specs and collected props,
  item-type constants, hover reordering for sortable lists, optimistic persist to
  the Laravel API, nested targets, custom drag layers/previews, touch/multi-backend
  caveats, HTML5 a11y limits + keyboard fallback, and testing drag interactions.
  Triggers: "react-dnd", "HTML5Backend", "useDrag", "useDrop", "DndProvider",
  "sortable list", "drag and drop", "reorder rows", "drag preview", "useDragLayer",
  "admin drag", "dnd hover index".
---

# react-dnd — Admin panel (HTML5 backend)

Pin: React **18** admin UI, Vite **6** + `laravel-vite-plugin`, Bootstrap **5.3**
+ `react-bootstrap`, **react-dnd** + **`react-dnd-html5-backend`**. Classic HTML5
DnD model — not `@dnd-kit`, not `@hello-pangea/dnd`.

## Project conventions

- Admin entry: `resources/js/app.jsx` (Blade-mounted).
- UI: Bootstrap 5 + `react-bootstrap`. Prefer attaching drag/drop refs to a
  wrapping `<div>` — many Bootstrap components do not forward refs cleanly.
- Persist reorder via Laravel API (axios + session/CSRF from the Blade layout).
  Routes under `routes/api.php` / `routes/api_v1.php`, controllers in `app/Http`.
- Item type constants in one module (e.g. `resources/js/dnd/ItemTypes.js`).
- Mount **one** `DndProvider` high in the page tree, not per row.

## Install & provider

```bash
npm install react-dnd react-dnd-html5-backend
```

```jsx
import { DndProvider } from "react-dnd";
import { HTML5Backend } from "react-dnd-html5-backend";

export default function SortableBoard({ children }) {
  return <DndProvider backend={HTML5Backend}>{children}</DndProvider>;
}
```

`backend` is required. Do not nest multiple providers unless you intentionally
isolate trees.

## Item types as constants

```js
// resources/js/dnd/ItemTypes.js
export const ItemTypes = {
  CARD: "card",
  ROW: "row",
};
```

`type` (source) and `accept` (target) must match. Free-form strings per file
cause silent "can't drop" bugs.

## `useDrag`

```jsx
import { useDrag } from "react-dnd";
import { ItemTypes } from "../dnd/ItemTypes";

function DraggableChip({ id, label }) {
  const [{ isDragging }, drag, dragPreview] = useDrag(
    () => ({
      type: ItemTypes.CARD,
      item: { id },
      collect: (monitor) => ({ isDragging: monitor.isDragging() }),
      end: (item, monitor) => {
        // optional: if (!monitor.didDrop()) { /* revert */ }
      },
    }),
    [id],
  );

  return (
    <div
      ref={(node) => dragPreview(drag(node))}
      className="badge text-bg-secondary"
      style={{ opacity: isDragging ? 0.4 : 1 }}
    >
      {label}
    </div>
  );
}
```

**Spec:** `type` (required), `item` (object or `() => object`), `collect`,
`end`, `canDrag`, optional custom `isDragging`.

**Return tuple:** `[collected, drag, dragPreview]`.
- `drag(ref)` — drag handle
- `dragPreview(ref)` — HTML5 preview node (defaults to drag node)

Prefer `useDrag(() => spec, deps)` so closures stay fresh.

## `useDrop`

```jsx
import { useDrop } from "react-dnd";
import { ItemTypes } from "../dnd/ItemTypes";

function Dustbin({ onDrop }) {
  const [{ isOver, canDrop }, drop] = useDrop(
    () => ({
      accept: ItemTypes.CARD,
      drop: (item) => {
        onDrop(item);
        return { moved: true }; // source reads via monitor.getDropResult()
      },
      collect: (monitor) => ({
        isOver: monitor.isOver({ shallow: true }),
        canDrop: monitor.canDrop(),
      }),
    }),
    [onDrop],
  );

  const bg = isOver && canDrop ? "success" : canDrop ? "info" : "light";
  return (
    <div ref={drop} className={`p-3 border rounded bg-${bg}`}>
      Drop here
    </div>
  );
}
```

**Spec:** `accept`, `drop`, `hover`, `canDrop`, `collect`.

**Monitor (common):** `isOver({ shallow })`, `canDrop()`, `getItem()`,
`getItemType()`, `getClientOffset()`, `getDropResult()`, `didDrop()`.

Use `isOver({ shallow: true })` when targets nest so parents do not highlight
over children.

### Source + target on one node

```jsx
const [, drag] = useDrag(/* ... */);
const [, drop] = useDrop(/* ... */);
return <div ref={(node) => drag(drop(node))} />;
// or: const ref = useRef(null); drag(drop(ref)); return <div ref={ref} />
```

## Sortable lists — hover index-swap

Reorder on **hover**, not only drop. Mutate the drag item's `index` so later
hovers compare against the live position.

```jsx
import { useRef } from "react";
import { useDrag, useDrop } from "react-dnd";
import { ItemTypes } from "../dnd/ItemTypes";

export function SortableRow({ id, index, text, moveRow }) {
  const ref = useRef(null);

  const [{ isDragging }, drag] = useDrag(
    () => ({
      type: ItemTypes.ROW,
      item: () => ({ id, index }),
      collect: (monitor) => ({ isDragging: monitor.isDragging() }),
    }),
    [id, index],
  );

  const [, drop] = useDrop(
    () => ({
      accept: ItemTypes.ROW,
      hover(item, monitor) {
        if (!ref.current) return;
        const dragIndex = item.index;
        const hoverIndex = index;
        if (dragIndex === hoverIndex) return;

        const rect = ref.current.getBoundingClientRect();
        const middleY = (rect.bottom - rect.top) / 2;
        const clientOffset = monitor.getClientOffset();
        if (!clientOffset) return;
        const clientY = clientOffset.y - rect.top;

        // Only swap after the pointer crosses half the row
        if (dragIndex < hoverIndex && clientY < middleY) return;
        if (dragIndex > hoverIndex && clientY > middleY) return;

        moveRow(dragIndex, hoverIndex);
        item.index = hoverIndex; // critical — keep monitor item in sync
      },
    }),
    [index, moveRow],
  );

  drag(drop(ref));

  return (
    <div
      ref={ref}
      className="list-group-item d-flex align-items-center"
      style={{ opacity: isDragging ? 0.3 : 1 }}
    >
      <span className="me-2 text-muted" aria-hidden="true">
        ⋮⋮
      </span>
      {text}
    </div>
  );
}
```

### Persist order to Laravel (optimistic + rollback)

```jsx
import { useCallback, useState } from "react";
import axios from "axios";
import { DndProvider } from "react-dnd";
import { HTML5Backend } from "react-dnd-html5-backend";
import { SortableRow } from "./SortableRow";

export function ReorderableList({ initialItems, saveUrl }) {
  const [items, setItems] = useState(initialItems);

  const moveRow = useCallback((from, to) => {
    setItems((prev) => {
      const next = [...prev];
      const [removed] = next.splice(from, 1);
      next.splice(to, 0, removed);
      return next;
    });
  }, []);

  async function persistOrder() {
    const previous = items;
    try {
      await axios.put(saveUrl, { order: items.map((i) => i.id) });
    } catch (err) {
      setItems(previous); // rollback
      console.error(err);
    }
  }

  return (
    <DndProvider backend={HTML5Backend}>
      <div className="list-group">
        {items.map((item, index) => (
          <SortableRow
            key={item.id}
            id={item.id}
            index={index}
            text={item.label}
            moveRow={moveRow}
          />
        ))}
      </div>
      <button type="button" className="btn btn-primary mt-2" onClick={persistOrder}>
        Save order
      </button>
    </DndProvider>
  );
}
```

Prefer save on drag `end` or an explicit button — **not** on every hover.

**Pitfalls:** forgot `item.index = hoverIndex`; unguarded `ref.current`; stale
`item` (use `item: () => ({ id, index })`); array-index React keys; PUT every
hover.

## Nested targets & performance

- If a child `drop` handles the item, parents can check `monitor.didDrop()` and
  no-op.
- Highlight with `isOver({ shallow: true })` only.
- `collect` / `hover` fire often — return minimal props; `useCallback` for
  `moveRow`; `React.memo` long lists.
- Put ids in `item`, not entire app state.

## Custom drag preview / drag layer

Empty the native preview, render a custom layer:

```jsx
import { useEffect } from "react";
import { useDrag, useDragLayer } from "react-dnd";
import { getEmptyImage } from "react-dnd-html5-backend";

// on the source, after useDrag:
const [, drag, preview] = useDrag(() => ({ /* type, item, collect */ }), []);
useEffect(() => {
  preview(getEmptyImage(), { captureDraggingState: true });
}, [preview]);

function CustomDragLayer() {
  const { isDragging, item, currentOffset } = useDragLayer((monitor) => ({
    item: monitor.getItem(),
    currentOffset: monitor.getSourceClientOffset(),
    isDragging: monitor.isDragging(),
  }));
  if (!isDragging || !currentOffset) return null;
  const { x, y } = currentOffset;
  return (
    <div
      style={{
        position: "fixed",
        pointerEvents: "none", // required so drops still hit targets
        left: 0,
        top: 0,
        transform: `translate(${x}px, ${y}px)`,
        zIndex: 1000,
      }}
    >
      <div className="list-group-item shadow">{item?.id}</div>
    </div>
  );
}
```

Render `CustomDragLayer` once under `DndProvider`.

## Touch / multi-backend

`HTML5Backend` uses the browser HTML5 DnD API. **Touch devices often cannot
drag reliably.** Either document desktop-only for that screen, or evaluate a
maintained multi-backend (HTML5 + Touch) against React 18 before adopting. Test
real admin devices.

## Accessibility + keyboard fallback

HTML5 DnD is weak for keyboard and screen readers. Always offer a non-pointer
path for the same reorder:

Bootstrap `btn-group` with **Move up** / **Move down** buttons calling the same
`moveRow(from, to)` as DnD. Visible focus + `aria-live="polite"` after keyboard
moves. Drag must not be the only way to change order.

## Testing

Simulate native events (react-dnd testing docs):

```jsx
import { render, screen, fireEvent } from "@testing-library/react";

test("drops onto a target", () => {
  render(<Board />); // tree includes DndProvider + HTML5Backend
  const cells = screen.getAllByRole("gridcell");
  const target = cells[0];
  const source = cells[18].firstChild;

  fireEvent.dragStart(source);
  fireEvent.dragEnter(target);
  fireEvent.dragOver(target);
  fireEvent.drop(target);
  // assert order / mock API
});
```

Assert outcomes (row order, axios mock payload), not monitor internals. Unit-test
pure `moveRow` without DnD. jsdom DnD support is limited — keep these coarse.
Admin JS tests: `tests/js/**/*.test.js` + root `vitest.config.js`.

## Anti-patterns

`DndProvider` per row; mistyped string types; persist on every `hover`; array
index as React `key`; touch assumed with HTML5Backend alone; drag-only reorder.

## Sources

- Overview — https://react-dnd.github.io/react-dnd/docs/overview
- Tutorial — https://react-dnd.github.io/react-dnd/docs/tutorial
- Hooks overview — https://react-dnd.github.io/react-dnd/docs/api/hooks-overview
- useDrag / useDrop / useDragLayer — https://react-dnd.github.io/react-dnd/docs/api/use-drag
- DropTargetMonitor — https://react-dnd.github.io/react-dnd/docs/api/drop-target-monitor
- Sortable example — https://react-dnd.github.io/react-dnd/examples/sortable/simple
- Nested targets — https://react-dnd.github.io/react-dnd/examples/nesting/drop-targets
- Testing — https://react-dnd.github.io/react-dnd/docs/testing
- GitHub — https://github.com/react-dnd/react-dnd
- HTML5 backend — https://www.npmjs.com/package/react-dnd-html5-backend
