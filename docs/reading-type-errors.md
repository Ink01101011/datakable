# Reading type errors

DataKable checks your columns against your row type at compile time. TypeScript cannot be made to
print a custom message for these checks, so the errors come out in TypeScript's own words. This
page shows the six errors you are most likely to meet, what TypeScript prints for each, which line
to read, and how to fix it.

The examples use this row type:

```ts
type User = {
  id: number
  first: string
  age: number
  address: { city: string; geo: { lat: number; lng: number } }
  onClick: () => void
  friends: { id: number }[]
  // …
}
```

The output below is from TypeScript 6.0. In it, `ColumnDef<User, string>` is the column type;
with `@datakable/react` the second argument is `ReactNode`. Long path unions are shortened to
`'"id" | "first" | …'`.

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
columns: [{ key: 'frist' }]
```

```text
error TS2820: Type '"frist"' is not assignable to type '"id" | "first" | "age" | "address" | …'.
Did you mean '"first"'?
```

The long union is every path of your row type. TypeScript suggests the closest one.

**Fix:** use the suggested key.

## 2. Typo in a nested key

```ts
columns: [{ key: 'address.ctiy' }]
```

```text
error TS2820: Type '"address.ctiy"' is not assignable to type '"id" | … | "address.city" | …'.
Did you mean '"address.city"'?
```

Same error as 1. Nested paths are part of the union (up to 4 levels deep), so the suggestion works
for them too.

**Fix:** use the suggested path.

## 3. Filter kind not allowed for the value type

```ts
columns: [{ key: 'first', filter: { type: 'range' } }]
```

```text
error TS2322: Type '{ key: "first"; filter: { type: "range"; }; }' is not assignable to type 'ColumnDef<User, string>'.
  Types of property 'filter' are incompatible.
    Type '{ type: "range"; }' is not assignable to type 'StringFilter | undefined'.
      Types of property 'type' are incompatible.
        Type '"range"' is not assignable to type '"contains" | "equals" | "in"'.
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
columns: [{ key: 'address' }]
```

```text
error TS2322: Type '{ key: "address"; }' is not assignable to type 'ColumnDef<User, string>'.
  Type '{ key: "address"; }' is not assignable to type '({ key: "address"; } & BaseColumn<…> & NeedsCell<User, { city: string; geo: { … }; }, string>) | ({ ...; } & ... 1 more ... & NeedsFormat<...>)'.
    Type '{ key: "address"; }' is not assignable to type '{ key: "address"; } & BaseColumn<…> & NeedsFormat<{ city: string; geo: { … }; }>'.
      Property 'format' is missing in type '{ key: "address"; }' but required in type 'NeedsFormat<{ city: string; geo: { lat: number; lng: number; }; }>'.
```

The default formatter can display primitives, `Date` and arrays of primitives. It cannot display
an object, so the column must say how to render it. The second line shows the two ways to do that:
`NeedsCell` **or** `NeedsFormat`. TypeScript reports only the last one it tried, so the final line
says `format` is missing — but `cell` works just as well.

**Fix:** add either one.

```ts
{ key: 'address', format: (a) => a.city }
{ key: 'address', cell: ({ value }) => <City city={value} /> }
// or point at a displayable leaf instead:
{ key: 'address.city' }
```

The same error appears for an **array of objects** (`{ key: 'friends' }`, with
`NeedsFormat<{ id: number; }[]>`), with the same fix.

## 5. Function column without `cell` or `format`

```ts
columns: [{ key: 'onClick' }]
```

```text
error TS2322: Type '{ key: "onClick"; }' is not assignable to type 'ColumnDef<User, string>'.
  Type '{ key: "onClick"; }' is not assignable to type '({ key: "onClick"; } & BaseColumn<User, () => void, string> & NeedsCell<User, () => void, string>) | ({ key: "onClick"; } & BaseColumn<User, () => void, string> & NeedsFormat<...>)'.
    Type '{ key: "onClick"; }' is not assignable to type '{ key: "onClick"; } & BaseColumn<User, () => void, string> & NeedsFormat<() => void>'.
      Property 'format' is missing in type '{ key: "onClick"; }' but required in type 'NeedsFormat<() => void>'.
```

Same rule as 4: a function value has no sensible text. Usually this means the column should not
exist — a callback is rarely something to show.

**Fix:** remove the column, or render it with `cell` / `format` as in 4.

## 6. `rowKey` is not a path of the row

```ts
useDataTable({ data: users, rowKey: 'nope', columns })
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
  runtime and reports `DK_UNRENDERABLE_VALUE` if it meets an object.
