import {
  DataTable,
  type DataTableComponents,
  type Diagnostic,
  type FetchResult,
  pagination,
  withFetcher,
} from 'datakable/react'

type User = { id: number; name: string }

const features = [pagination({ mode: 'server', pageSize: 20 })]

const fetcher = withFetcher(async ({ pageIndex, signal }) => {
  const res = await fetch(`/api/users?page=${pageIndex}`, { signal })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return (await res.json()) as FetchResult<User>
})

// Shown when the first load fails; `retry` calls table.refetch(). A later failure keeps the
// last good rows and shows the refresh indicator, with its own retry button.
const components: DataTableComponents = {
  Error: ({ retry }) => (
    <p role="alert">
      Could not load the users.{' '}
      <button type="button" onClick={retry}>
        Try again
      </button>
    </p>
  ),
}

// The original error reaches onDiagnostic only (as context.cause), never the console.
const report = (d: Diagnostic) => {
  if (d.code === 'DK_FETCH_FAILED') console.error('users request failed', d.context.cause)
}

export function Users() {
  return (
    <DataTable
      rowKey="id"
      features={features}
      fetcher={fetcher}
      components={components}
      onDiagnostic={report}
    />
  )
}
