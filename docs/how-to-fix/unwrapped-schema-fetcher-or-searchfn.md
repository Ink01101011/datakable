# `DK_INVALID_OPTION` for `schema`, `fetcher` or `searchFn`

Creating the table throws `DatakableConfigError: DK_INVALID_OPTION` naming `options.schema`,
`options.fetcher` or `options.searchFn` — also in a production build, where the message is only
`DK_INVALID_OPTION: (see docs)` with `where` and the docs URL. The function was passed without its
wrapper.

## Why the wrapper

Validation, the server source and the async search engine are opt-in imports, so a table that does
not use them does not bundle them. The function goes through its wrapper, which carries the
engine:

| Option | Wrapper | Import |
|---|---|---|
| `schema` | `withSchema(UserSchema)` | `datakable`, or `@datakable/core/schema` |
| `fetcher` | `withFetcher(fetchUsers)` | `datakable`, or `@datakable/core/server` |
| `search({ searchFn })` | `withSearchFn(fn)` | `datakable`, or `@datakable/core/search-async` |

A bare function would be silently ignored without its engine, so DataKable throws instead, in
every build: in development from the option validator with the full text, in production from a
small guard. The table is not created.

## Fix

Wrap it:

```ts
import {
  createTable,
  type FetchResult,
  pagination,
  type StandardSchemaV1,
  search,
  withFetcher,
  withSchema,
  withSearchFn,
} from 'datakable'

type User = { id: number; name: string }
declare const UserSchema: StandardSchemaV1<unknown, User> // zod, valibot, arktype, …
declare const json: unknown[]
declare const users: User[]

async function fetchUsers(): Promise<FetchResult<User>> {
  const res = await fetch('/api/users')
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return (await res.json()) as FetchResult<User>
}

// Each one through its wrapper: a table without them does not bundle their engines.
createTable({ data: json, rowKey: 'id', schema: withSchema(UserSchema) })

createTable({
  rowKey: 'id',
  features: [pagination({ mode: 'server' })],
  fetcher: withFetcher(fetchUsers),
})

createTable({
  data: users,
  rowKey: 'id',
  features: [
    search<User>({
      searchFn: withSearchFn(({ query, rows }) => rows.filter((u) => u.name.startsWith(query))),
    }),
  ],
})
```

TypeScript rejects the bare function already; the runtime error means the types were bypassed —
JavaScript, an `as any`, or options assembled in an untyped object:

```ts
import { createTable, type FetchResult, pagination } from 'datakable'

type User = { id: number; name: string }
declare function fetchUsers(): Promise<FetchResult<User>>

createTable({
  rowKey: 'id',
  features: [pagination({ mode: 'server' })],
  // @ts-expect-error a bare function: wrap it with withFetcher(fetchUsers)
  fetcher: fetchUsers,
})
```

The same holds for `table.setOptions({ fetcher })`: a bare function is rejected and the previous
fetcher is kept. In React, `fetcher={withFetcher(fetchUsers)}` may be written inline: the wrapper
is memoised per function.

## Related codes

[`DK_INVALID_OPTION`](errors.md#dk_invalid_option) ·
[`DK_FETCHER_WITHOUT_SERVER_MODE`](errors.md#dk_fetcher_without_server_mode) ·
[`DK_SCHEMA_CRASHED`](errors.md#dk_schema_crashed)

## See also

- [`@datakable/core` schema validation](../../packages/core/README.md#schema-validation) and
  [server mode](../../packages/core/README.md#server-mode)
- [The bundle is too big](bundle-too-big.md)
- [How to fix](README.md) — every symptom.
