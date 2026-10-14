# Search through an API, with debounce

The built-in search matches rows on the client. When matching belongs to a search service (a
full-text index, typo tolerance, synonyms), `searchFn` sends the query there and the table shows
the rows it returns, in its order.

## Goal

Keep a product list on the client, send the search query to `/api/products/search` 250 ms after
the user stops typing, and show the matching products in the API's relevance order.

## The code

```tsx
import { pagination, search, sorting, useDataTable, withSearchFn } from 'datakable/react'

export type Product = { sku: string; name: string; price: number }

// The rows are on the client; the matching runs on your search API (e.g. a full-text index).
// It returns the matching row keys, best match first. `signal` aborts superseded requests.
const searchProducts = withSearchFn<Product>(async ({ query, signal }) => {
  const res = await fetch(`/api/products/search?q=${encodeURIComponent(query)}`, { signal })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const { skus } = (await res.json()) as { skus: string[] }
  return { keys: skus }
})

const features = [
  search({
    searchFn: searchProducts,
    // One request after 250 ms without typing; under 2 characters, every row is shown.
    typing: { strategy: 'debounce', wait: 250, minLength: 2 },
  }),
  sorting(),
  pagination({ pageSize: 20 }),
] as const // a tuple: the table's type knows each feature's API

export function ProductSearch({ products }: { products: Product[] }) {
  const table = useDataTable({ data: products, rowKey: 'sku', features })
  const { input, status } = table.state.search

  return (
    <section>
      <input
        type="search"
        aria-label="Search products"
        value={input}
        onChange={(e) => void table.setSearch(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') void table.flushSearch() // search now, skip the wait
          if (e.key === 'Escape') table.clearSearch()
        }}
      />
      {/* 'pending': the debounce is waiting; 'searching': the request is in flight. */}
      {(status === 'pending' || status === 'searching') && <span role="status">Searching…</span>}
      {status === 'error' && <span role="alert">Search failed; showing the previous results.</span>}
      <ul>
        {table.rowModel.rows.map((row) => (
          <li key={row.key}>
            {row.original.name} — ${row.original.price}
          </li>
        ))}
      </ul>
    </section>
  )
}
```

## What you will see

- Typing `d`, `de`, `desk` quickly sends one request, for `desk`, 250 ms after the last keystroke.
  "Searching…" shows while the debounce waits (`status: 'pending'`) and while the request runs
  (`'searching'`).
- The rows whose `sku` the API returned, in the API's order (until you sort), paginated as usual. The previous results stay on screen until the new ones arrive.
- Under 2 characters no request is sent and every product shows. Enter searches at once; Esc
  clears the search.
- A newer query aborts the request in flight (`signal`). A failed request keeps the previous
  results, sets `status: 'error'` ("Search failed; …") and reports [`DK_SEARCH_FAILED`](../how-to-fix/errors.md#dk_search_failed).

## Variations

- **Return rows instead of keys:** `searchFn` may return the matching rows (references from
  `rows`) instead of `{ keys }`.
- **Search locally, your way:** the function inside `withSearchFn` can be synchronous, e.g. a
  call into a client-side index: `withSearchFn(({ query }) => ({ keys: index.search(query) }))`.
- **Search on the server with the rows:** if the server also pages and sorts, use
  `search({ mode: 'server' })` with a `fetcher` instead ([Server-side table](server-side-table.md)).
- **Commit on Enter only:** `typing: { commitOn: 'enter' }`.
- **Smaller bundle:** import `withSearchFn` from `@datakable/core/search-async`, so a table without
  a `searchFn` does not bundle the request engine.

## See also

- [Features](../../packages/core/README.md#features) — the `search()` options.
- [Status model](../../packages/core/README.md#status-model) — `pending` and `searching`.
- [Your own matching: `searchFn`](../how-to-use/search.md#your-own-matching-searchfn) and [server
  mode](../how-to-use/server-mode.md) — the guides.
- [Search finds nothing, or is slow](../how-to-fix/search-finds-nothing-or-is-slow.md) —
  troubleshooting.
- [Examples](README.md)
