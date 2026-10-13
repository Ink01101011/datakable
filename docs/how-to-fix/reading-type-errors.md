# Reading type errors

DataKable checks your columns against your row type at compile time. TypeScript cannot be made to
print a custom message for these checks, so the errors come out in TypeScript's own words. This
page shows the six errors you are most likely to meet, what TypeScript prints for each, which line
to read, and how to fix it. Every example below is compiled in CI with `// @ts-expect-error` on
the failing line, and every output is what TypeScript prints for it.

The examples use this row type:

```ts
// The row type of the examples on this page.
export type User = {
  id: number
  first: string
  age: number
  address: { city: string; geo: { lat: number; lng: number } }
  onClick: () => void
  friends: { id: number }[]
}
```

The output is from TypeScript 6.0, for columns typed `ColumnDef<User, ReactNode>` (the type
`useDataTable` and `<DataTable />` take; with `@datakable/core` alone the second argument is
`unknown`). `…` marks text left out: mostly the long union of every path of `User`.

**Tip:** read the *last* line of a multi-line error first. It names the property that is wrong.

| # | You wrote | The line that matters |
|---|---|---|
| [1](#1-typo-in-key) | `{ key: 'frist' }` | `Did you mean '"first"'?` |
| [2](#2-typo-in-a-nested-key) | `{ key: 'address.ctiy' }` | `Did you mean '"address.city"'?` |
| [3](#3-filter-kind-not-allowed-for-the-value-type) | `filter: { type: 'range' }` on a string | `not assignable to type 'StringFilter \| undefined'` |
| [4](#4-object-column-without-cell-or-format) | `{ key: 'address' }` | `Property 'format' is missing … 'NeedsFormat<…>'` |
| [5](#5-function-column-without-cell-or-format) | `{ key: 'onClick' }` | `Property 'format' is missing … 'NeedsFormat<() => void>'` |
| [6](#6-rowkey-is-not-a-path-of-the-row) | `rowKey: 'nope'` | `Type '"nope"' is not assignable to type '"id" \| …'` |

## 1. Typo in `key`

```ts
import type { ColumnDef } from 'datakable'
import type { ReactNode } from 'react'
import type { User } from './1-user'

export const columns: ColumnDef<User, ReactNode>[] = [
  // @ts-expect-error TS2820: 'frist' is not a path of User
  { key: 'frist' },
]
```

```text
error TS2820: Type '"frist"' is not assignable to type '"id" | "first" | "age" | "address" | …'. Did you mean '"first"'?
```

The long union is every path of your row type. TypeScript suggests the closest one.

**Fix:** use the suggested key.

## 2. Typo in a nested key

```ts
import type { ColumnDef } from 'datakable'
import type { ReactNode } from 'react'
import type { User } from './1-user'

export const columns: ColumnDef<User, ReactNode>[] = [
  // @ts-expect-error TS2820: 'address.ctiy' is not a path of User
  { key: 'address.ctiy' },
]
```

```text
error TS2820: Type '"address.ctiy"' is not assignable to type '"id" | … | "address.city" | …'. Did you mean '"address.city"'?
```

Same error as 1. Nested paths are part of the union (up to 4 levels deep), so the suggestion works
for them too.

**Fix:** use the suggested path.

## 3. Filter kind not allowed for the value type

```ts
import type { ColumnDef } from 'datakable'
import type { ReactNode } from 'react'
import type { User } from './1-user'

export const columns: ColumnDef<User, ReactNode>[] = [
  // @ts-expect-error TS2322: a string column takes 'contains' | 'equals' | 'in', not 'range'
  { key: 'first', filter: { type: 'range' } },
]
```

```text
error TS2322: Type '{ key: "first"; filter: { type: "range"; }; }' is not assignable to type 'ColumnDef<User, ReactNode>'.
  Types of property 'filter' are incompatible.
    Type '{ type: "range"; }' is not assignable to type 'StringFilter | undefined'.
      Types of property 'type' are incompatible.
        Type '"range"' is not assignable to type '"equals" | "in" | "contains"'.
```

The filter kinds a column accepts depend on its value type. The third line names the set
(`StringFilter`), and the last line lists its kinds.

| Value type | Set | Allowed `type` |
|---|---|---|
| `number`, `bigint`, `Date` | `NumberFilter` | `range`, `equals`, `in` |
| `string` | `StringFilter` | `equals`, `in`, `contains` |
| `boolean` | `BooleanFilter` | `equals` |
| `any` / `unknown` (or a whole row typed `any`) | — | `equals`, `contains` |

**Fix:** pick a kind from the last line, or point the column at a value of the right type.

## 4. Object column without `cell` or `format`

```ts
import type { ColumnDef } from 'datakable'
import type { ReactNode } from 'react'
import type { User } from './1-user'

export const columns: ColumnDef<User, ReactNode>[] = [
  // @ts-expect-error TS2322: an object value needs `cell` or `format`
  { key: 'address' },
]
```

```text
error TS2322: Type '{ key: "address"; }' is not assignable to type 'ColumnDef<User, ReactNode>'.
  Type '{ key: "address"; }' is not assignable to type '({ key: "address"; } & BaseColumn<…> & NeedsCell<User, { city: string; geo: { lat: number; lng: number; }; }, ReactNode> & { ...; }) | ... 4 more ... | (…)'.
    Type '{ key: "address"; }' is not assignable to type '{ key: "address"; } & BaseColumn<…> & NeedsFormat<{ city: string; geo: { lat: number; lng: number; }; }> & NeedsSortBy<...>'.
      Property 'format' is missing in type '{ key: "address"; }' but required in type 'NeedsFormat<{ city: string; geo: { lat: number; lng: number; }; }>'.
```

The default formatter can display primitives, `Date` and arrays of primitives. It cannot display
an object, so the column must say how to render it. The second line lists the ways the column
could be valid: `NeedsCell` **or** `NeedsFormat` (each combined with the sort options, hence
`... 4 more ...`). TypeScript reports only the last one it tried, so the final line says `format`
is missing — but `cell` works just as well.

**Fix:** add either one, or point the column at a displayable leaf.

```tsx
import type { ColumnDef } from 'datakable'
import type { ReactNode } from 'react'
import type { User } from './1-user'

// Any one of these: text with `format`, a component with `cell`, or a displayable leaf.
export const withFormat: ColumnDef<User, ReactNode>[] = [
  { key: 'address', format: (address) => address.city },
]
export const withCell: ColumnDef<User, ReactNode>[] = [
  { key: 'address', cell: ({ value }) => <em>{value.city}</em> },
]
export const withLeaf: ColumnDef<User, ReactNode>[] = [{ key: 'address.city' }]

// An array of objects is fixed the same way.
export const friends: ColumnDef<User, ReactNode>[] = [
  { key: 'friends', format: (list) => `${list.length} friends` },
]
```

The same error appears for an **array of objects** (`{ key: 'friends' }`, with
`NeedsFormat<{ id: number; }[]>`), with the same fix.

## 5. Function column without `cell` or `format`

```ts
import type { ColumnDef } from 'datakable'
import type { ReactNode } from 'react'
import type { User } from './1-user'

export const columns: ColumnDef<User, ReactNode>[] = [
  // @ts-expect-error TS2322: a function value needs `cell` or `format` (or no column)
  { key: 'onClick' },
]
```

```text
error TS2322: Type '{ key: "onClick"; }' is not assignable to type 'ColumnDef<User, ReactNode>'.
  Type '{ key: "onClick"; }' is not assignable to type '({ key: "onClick"; } & BaseColumn<User, () => void, ReactNode> & NeedsCell<User, () => void, ReactNode> & { sortable?: false; }) | ... 4 more ... | (…)'.
    Type '{ key: "onClick"; }' is not assignable to type '{ key: "onClick"; } & BaseColumn<User, () => void, ReactNode> & NeedsFormat<() => void> & NeedsSortFn<() => void>'.
      Property 'format' is missing in type '{ key: "onClick"; }' but required in type 'NeedsFormat<() => void>'.
```

Same rule as 4: a function value has no sensible text. Usually this means the column should not
exist — a callback is rarely something to show.

**Fix:** remove the column, or render it with `cell` / `format` as in 4.

## 6. `rowKey` is not a path of the row

```ts
import { createTable } from 'datakable'
import type { User } from './1-user'

declare const users: User[]

export const table = createTable({
  data: users,
  // @ts-expect-error TS2322: 'nope' is not a path of User
  rowKey: 'nope',
})
```

```text
error TS2322: Type '"nope"' is not assignable to type '"id" | "first" | "age" | "address" | …'.
```

`rowKey` takes the same paths as `key`. There is no "Did you mean" here when the name is far from
every path.

**Fix:** use a path whose value is unique per row (usually `'id'`), or pass a function
`(row) => string | number`.

## Hover help

Hover `cell` or `format` in a column, or pick it from autocomplete, to see when it is required.
On object, function and array-of-objects columns TypeScript shows only the signature on hover
(the `NeedsCell | NeedsFormat` union has two declarations); use autocomplete there, or read the
`NeedsFormat` / `NeedsCell` names in the error itself (sections 4 and 5).

## Getting the most precise errors

- These checks need a known row type. With `any[]` data, keys are not checked and filters are
  limited to `equals` / `contains`. Pass a `schema` or write `useDataTable<User>(…)`.
- Fields typed `any` or `unknown` need no `cell` / `format`; the default formatter handles them at
  runtime and reports [`DK_UNRENDERABLE_VALUE`](errors.md#dk_unrenderable_value) if it meets an
  object.

## See also

- [Diagnostics reference](errors.md) — the runtime side: every `DK_*` code.
- [How to fix](README.md) — troubleshooting by symptom.
- [`@datakable/core` columns](../../packages/core/README.md#columns) — what each column field
  takes.
