import { createTable } from '@datakable/core'
import { search } from '@datakable/core/search'
import { withSearchFn } from '@datakable/core/search-async'

type Product = { sku: string; name: string }
declare const products: Product[]

const table = createTable({
  data: products,
  rowKey: 'sku',
  features: [
    search({
      typing: { strategy: 'debounce', wait: 300 },
      // Your own matching, e.g. a search API. Wrapped with withSearchFn: client search alone
      // never bundles the async engine.
      searchFn: withSearchFn(async ({ query, signal }) => {
        const res = await fetch(`/api/products/search?q=${encodeURIComponent(query)}`, { signal })
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        // The matching row keys (rowKey values) in relevance order, or the rows themselves.
        return { keys: (await res.json()) as string[] }
      }),
    }),
  ],
  timeout: 10_000, // a slower request is aborted: DK_ASYNC_TIMEOUT
})

const outcome = await table.setSearch('chair')
// 'applied'; 'superseded' if a newer query replaced it; 'error' if searchFn failed
// (DK_SEARCH_FAILED: the previous results stay, state.search.error holds the error).
console.log(outcome.status, table.getState().search.status)
