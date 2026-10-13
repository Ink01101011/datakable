import { pagination, search, sorting, useDataTable, withSearchFn } from 'datakable'

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
