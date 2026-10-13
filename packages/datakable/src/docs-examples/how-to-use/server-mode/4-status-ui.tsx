import {
  type FetchParams,
  type FetchResult,
  pagination,
  sorting,
  useDataTable,
  withFetcher,
} from 'datakable'

type Order = { id: string; customer: string; total: number }

async function fetchOrders({ sort, pageIndex, pageSize, signal }: FetchParams) {
  const order = (sort ?? []).map((s) => `${s.desc ? '-' : ''}${s.id}`).join(',')
  const res = await fetch(`/api/orders?sort=${order}&page=${pageIndex}&size=${pageSize}`, {
    signal,
  })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return (await res.json()) as FetchResult<Order>
}

// Hoisted: features are read once (`as const` keeps their APIs on the type), and a hoisted
// fetcher is the same wrapper on every render.
const features = [
  sorting({ mode: 'server' }),
  pagination({ mode: 'server', pageSize: 20 }),
] as const
const fetcher = withFetcher(fetchOrders)

export function Orders() {
  const table = useDataTable({ rowKey: 'id', features, fetcher })
  const { rows, status, isInitialLoad } = table.rowModel

  // Nothing to show yet: a full loading state, or an error with nothing behind it.
  if (isInitialLoad && status === 'error') {
    return (
      <p role="alert">
        Could not load the orders.{' '}
        <button type="button" onClick={() => void table.refetch()}>
          Retry
        </button>
      </p>
    )
  }
  if (isInitialLoad) return <p role="status">Loading orders…</p>

  // Loaded once: later requests show over the previous rows.
  return (
    <section aria-busy={status === 'fetching'}>
      {status === 'fetching' && <p role="status">Updating…</p>}
      {status === 'error' && (
        <p role="alert">
          Could not refresh; showing the previous page.{' '}
          <button type="button" onClick={() => void table.refetch()}>
            Retry
          </button>
        </p>
      )}
      <ul>
        {rows.map((row) => (
          <li key={row.key}>
            {row.original.customer}: {row.original.total}
          </li>
        ))}
      </ul>
      <button type="button" disabled={!table.canNextPage()} onClick={table.nextPage}>
        Next page
      </button>
    </section>
  )
}
