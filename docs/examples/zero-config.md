# A zero-config table from an array

The smallest DataTable: pass an array of objects and get a table that sorts, searches and
paginates, with no column definitions. Start here to get rows on screen, then add columns and
features when you need them.

## Goal

Render an array of users as a table with sort headers, a search input and pagination, and run the
same table without React.

## The code

```sh
npm install datakable react
```

```tsx
import { DataTable } from 'datakable'

type User = { id: number; name: string; email: string; age: number; city: string }

const users: User[] = [
  { id: 1, name: 'Mali Srisuk', email: 'mali@example.com', age: 31, city: 'Bangkok' },
  { id: 2, name: 'Anan Wong', email: 'anan@example.com', age: 25, city: 'Chiang Mai' },
  { id: 3, name: 'Ploy Chai', email: 'ploy@example.com', age: 40, city: 'Bangkok' },
  { id: 4, name: 'Ada Lovelace', email: 'ada@example.com', age: 36, city: 'London' },
]

// Columns come from the data. Sort headers, a search input and pagination are built in.
export function UsersTable() {
  return <DataTable data={users} rowKey="id" caption="Users" />
}
```

The same table without React: `createTable` from `datakable` installs the same default preset.

```ts
import { createTable } from 'datakable'

type User = { id: number; name: string; age: number; city: string }

const users: User[] = [
  { id: 1, name: 'Mali Srisuk', age: 31, city: 'Bangkok' },
  { id: 2, name: 'Anan Wong', age: 25, city: 'Chiang Mai' },
  { id: 3, name: 'Ploy Chai', age: 40, city: 'Bangkok' },
  { id: 4, name: 'Ada Lovelace', age: 36, city: 'London' },
]

// The same table without React: the same preset, the same row model.
export const table = createTable({ data: users, rowKey: 'id' })

table.setColumnFilter('city', { type: 'equals', value: 'Bangkok' })
table.toggleSort('age') // ascending

const { rows, filteredCount, totalCount } = table.getRowModel()
console.log(rows.map((row) => row.original.name)) // ['Mali Srisuk', 'Ploy Chai']
console.log(`${filteredCount} of ${totalCount}`) // '2 of 4'
```

## What you will see

- One column per key of the rows (the union of keys over the first 50 rows), in the order the keys
  appear: `id`, `name`, `email`, `age`, `city`. The header is the key.
- Each header is a button: click to sort ascending, again for descending, a third time for no sort.
  Shift+click adds a second sort key. The `<th>` carries `aria-sort`.
- A search input above the table: fuzzy matching over every column, applied as you type. Enter
  applies it at once, Esc clears it.
- Ten rows per page, with Previous / Next buttons below the table.
- No styles: the table renders plain HTML with `data-*` hooks. Import `datakable/styles.css` for a
  default look ([Theming](theming.md)).
- The headless table logs `['Mali Srisuk', 'Ploy Chai']` and `'2 of 4'`: the Bangkok users, by
  age.

## Variations

- **Name the columns or format values:** pass `columns` ([Custom columns](custom-columns.md)).
- **Your own markup:** `useDataTable({ data })` returns the same table for your own JSX
  ([A headless table](headless-table.md)).
- **Fewer features:** `features={[sorting()]}` replaces the preset, so there is no search input and
  no pager. With `features`, only what you list is installed and typed.
- **Replace a part:** `components={{ Empty: () => <p>No users yet.</p> }}` swaps the empty state;
  `SearchInput`, `Pagination`, `Loading` and `Error` work the same way.

## See also

- [`datakable` README](../../packages/datakable/README.md) — `useDataTable`, `createTable`,
  `<DataTable />`.
- [Features](../../packages/core/README.md#features) — what the default preset installs.
- [Examples](README.md)
