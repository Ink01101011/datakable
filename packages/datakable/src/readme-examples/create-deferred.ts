import { createDeferred, createTable, type FetchResult, sorting, startTable } from 'datakable'

type User = { id: number; name: string }

// For your own bindings (useDataTable does this for you): a table created inside
// createDeferred starts no async work — no fetcher request, no searchFn call, no timer.
const table = createDeferred(() =>
  createTable({
    rowKey: 'id',
    features: [sorting({ mode: 'server' })],
    fetcher: async ({ signal }) =>
      (await (await fetch('/api/users', { signal })).json()) as FetchResult<User>,
  }),
)

// On the server: render from the row model as it is (status 'pending', no rows yet).
console.log(table.getRowModel().status) // 'pending'

// In the browser, once the server HTML is hydrated: the deferred request starts.
startTable(table)
