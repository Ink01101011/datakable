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
