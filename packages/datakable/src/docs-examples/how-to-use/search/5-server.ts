import { createTable, type FetchResult } from '@datakable/core'
import { search } from '@datakable/core/search'
import { withFetcher } from '@datakable/core/server'

type User = { id: number; name: string }

const table = createTable({
  rowKey: 'id',
  // The server matches the query: typing defaults to a 300 ms debounce and minLength 2.
  features: [search({ mode: 'server' })],
  fetcher: withFetcher(async ({ query, signal }) => {
    const res = await fetch(`/api/users?q=${encodeURIComponent(query ?? '')}`, { signal })
    return (await res.json()) as FetchResult<User>
  }),
})

void table.setSearch('mali') // fetches once the debounce applies the query
