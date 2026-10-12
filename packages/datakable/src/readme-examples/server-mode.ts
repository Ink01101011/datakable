import { createTable, type FetchResult } from '@datakable/core'
import { pagination } from '@datakable/core/pagination'
import { search } from '@datakable/core/search'
import { sorting } from '@datakable/core/sorting'

type User = { id: number; name: string }

const table = createTable({
  rowKey: 'id',
  // Server steps must come first in the pipeline (filter → search → sort → paginate);
  // client steps may follow them. Search typing defaults to a 300 ms debounce in server mode.
  features: [
    search({ mode: 'server' }),
    sorting({ mode: 'server' }),
    pagination({ mode: 'server', pageSize: 20 }),
  ],
  // Receives only the server-mode state. Latest request wins; superseded ones are aborted.
  fetcher: async ({ query, sort, pageIndex, pageSize, signal }) => {
    const params = new URLSearchParams({
      q: query ?? '',
      sort: (sort ?? []).map((s) => `${s.desc ? '-' : ''}${s.id}`).join(','),
      page: String(pageIndex),
      size: String(pageSize),
    })
    const res = await fetch(`/api/users?${params}`, { signal })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    return (await res.json()) as FetchResult<User> // { rows, rowCount }
  },
  timeout: 10_000, // default 30 s → DK_ASYNC_TIMEOUT
})

// A failed request keeps the previous rows, sets status 'error' and reports DK_FETCH_FAILED.
// Retry with the current params; like setSearch, it never rejects.
const { status } = await table.refetch() // 'applied' | 'superseded' | 'error'
console.log(status)
