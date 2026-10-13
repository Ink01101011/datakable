import {
  createDeferred,
  createTable,
  type FetchResult,
  sorting,
  startTable,
  withFetcher,
} from 'datakable'

type User = { id: number; name: string }

// For your own bindings (useDataTable does this for you): a table created inside createDeferred
// starts no async work — no fetcher request, no searchFn call, no timer.
const table = createDeferred(() =>
  createTable({
    rowKey: 'id',
    features: [sorting({ mode: 'server' })],
    fetcher: withFetcher(
      async ({ signal }) =>
        (await (await fetch('/api/users', { signal })).json()) as FetchResult<User>,
    ),
  }),
)

// On the server: render from the row model as it is. Its status is 'pending' (nothing fetched
// yet), and DK_SSR_ASYNC_DEFERRED (info) says why.
const { status, isInitialLoad } = table.getRowModel()
console.log(status, isInitialLoad) // 'pending' true

// In the browser, once the server HTML is hydrated: the deferred request starts. Idempotent.
startTable(table)
