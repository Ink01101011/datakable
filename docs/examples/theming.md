# Theming: styles.css, CSS variables and dark mode

`<DataTable />` ships unstyled. `datakable/styles.css` is an optional default look that you theme
with CSS custom properties, and it follows the system's dark mode. This recipe imports it, changes
the accent and density, and adds an app-controlled dark theme.

## Goal

Give one table a purple accent, rounder corners and denser rows, in light and dark mode, and
support a theme toggle that overrides the system setting.

## The code

The component:

```tsx
import { DataTable } from 'datakable/react'

type User = { id: number; name: string; age: number }

// The wrapper class scopes the theme to this table. The stylesheet and the theme are plain CSS,
// below.
export function UsersTable({ users }: { users: User[] }) {
  return (
    <div className="users-table">
      <DataTable data={users} rowKey="id" caption="Users" />
    </div>
  )
}
```

Your stylesheet. It imports DataTable's stylesheet first (or `import 'datakable/styles.css'` once
in your app entry), then sets the theme:

```css
@import "datakable/styles.css";

/* Scoped to one table. Use the selector [data-datakable] alone to theme every table (not :root:
   the stylesheet sets its defaults on [data-datakable] itself, which would shadow :root). */
.users-table [data-datakable] {
  --dk-accent: #7c3aed;
  --dk-radius: 10px;
  --dk-font-size: 0.9375rem;
  --dk-cell-py: 0.375rem; /* denser rows */
}

/* The stylesheet switches to its dark set under prefers-color-scheme: dark. Adjust it there. */
@media (prefers-color-scheme: dark) {
  .users-table [data-datakable] {
    --dk-accent: #a78bfa;
  }
}

/* A theme toggle that sets data-theme on <html> wins over the system setting. */
[data-theme="dark"] [data-datakable] {
  --dk-fg: #f0f6fc;
  --dk-muted: #9198a1;
  --dk-bg: #0d1117;
  --dk-subtle: #151b23;
  --dk-border: #3d444d;
  --dk-control-border: #6e7681;
  --dk-danger: #f85149;
  --dk-danger-bg: #25171c;
}

[data-theme="light"] [data-datakable] {
  --dk-fg: #1f2328;
  --dk-muted: #59636e;
  --dk-bg: #fff;
  --dk-subtle: #f6f8fa;
  --dk-border: #d1d9e0;
  --dk-control-border: #818b98;
  --dk-danger: #d1242f;
  --dk-danger-bg: #ffebe9;
}

/* Style any part through its data-* / aria-* hook: your rules always win. */
.users-table th[aria-sort="ascending"],
.users-table th[aria-sort="descending"] {
  text-decoration: underline;
}
```

## What you will see

- A bordered table with a shaded header, row hover, styled pager and search input, the active sort
  header and focus rings in purple, and slightly tighter rows.
- In dark mode (system setting) the dark palette with a lighter purple accent; with
  `data-theme="dark"` or `"light"` on `<html>`, that palette whatever the system says (the
  table's `#7c3aed` accent stays: the toggle rules set only the palette).
- Loading, Empty and Error rows centred and muted, the error in the danger colour; flagged rows
  (`invalidRows: 'flag'`) tinted with `--dk-danger-bg`; a spinner while a search is pending or
  running (a still ring under `prefers-reduced-motion`).

## Variations

- **The variables:** `--dk-font-size`, `--dk-fg`, `--dk-muted`, `--dk-bg`, `--dk-subtle`,
  `--dk-border`, `--dk-control-border`, `--dk-accent`, `--dk-danger`, `--dk-danger-bg`,
  `--dk-radius`, `--dk-cell-py`, `--dk-cell-px`. `--dk-control-border` is the search input's
  border; keep it at 3:1 or more against `--dk-bg` (the defaults: 3.45:1 light, 4.12:1 dark).
- **No stylesheet at all:** skip the import and style the hooks yourself: `[data-datakable]` on the
  root, with `data-status` and `data-initial-load`; `aria-sort` / `data-sort` on headers;
  `data-invalid` on flagged rows and cells; `data-dk-state` on the Loading / Empty / Error row;
  `data-dk-search`, `data-dk-pagination`, `data-dk-refresh` on the built-in parts.
- **Utility CSS (Tailwind, …):** replace the parts with `components` and give them your classes;
  the table rows stay plain `<tr>` / `<td>` you can target from a wrapper.
- **Without `datakable`:** the same file is `@datakable/react/styles.css`.

## See also

- [Entry points of `datakable`](../../packages/datakable/README.md#entry-points) — including
  `datakable/styles.css`.
- [`@datakable/react`](../../packages/react/README.md#datatable) — the `data-*` hooks.
- [Styling `<DataTable />`](../how-to-use/react.md#styling) — `styles.css` and the `data-*` hooks.
- [Examples](README.md)
