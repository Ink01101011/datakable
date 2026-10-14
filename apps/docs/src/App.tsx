import {
  DataTable,
  type DataTableComponents,
  type Diagnostic,
  pagination,
  search,
  sorting,
  useDataTable,
  type ValidityState,
  VERSION,
  withFetcher,
  withSchema,
} from 'datakable/react'
import { type ReactNode, useCallback, useId, useRef, useState } from 'react'
import { AccountSchema, createFakeServer, rawAccounts, rows } from './data'

type OnDiagnostic = (d: Diagnostic) => void

/** A titled example; `aria-labelledby` makes it a named region. */
function Section(props: { title: string; intro: ReactNode; children: ReactNode }) {
  const id = useId()
  return (
    <section aria-labelledby={id} className="example">
      <h2 id={id}>{props.title}</h2>
      <p>{props.intro}</p>
      {props.children}
    </section>
  )
}

// --- 1. zero-config ------------------------------------------------------------------------------

function ZeroConfig({ onDiagnostic }: { onDiagnostic: OnDiagnostic }) {
  return (
    <Section
      title="Zero-config <DataTable />"
      intro={`${rows.length.toLocaleString()} rows; columns come from the data, sort headers, search and pagination are on.`}
    >
      <DataTable data={rows} rowKey="id" caption="People" onDiagnostic={onDiagnostic} />
    </Section>
  )
}

// --- 2. useDataTable + custom render -------------------------------------------------------------

const ariaSort = (dir: 'asc' | 'desc' | false) =>
  dir === 'asc' ? 'ascending' : dir === 'desc' ? 'descending' : 'none'

const COLUMNS = ['name', 'age', 'city', 'role'] as const

function CustomRender({ onDiagnostic }: { onDiagnostic: OnDiagnostic }) {
  const table = useDataTable({ data: rows, rowKey: 'id', onDiagnostic })
  const { rows: page, filteredCount, totalCount, status, isInitialLoad } = table.rowModel

  // The status model is never silent: every (status, isInitialLoad) pair has a visible state.
  let banner: ReactNode = null
  if (status === 'error') {
    banner = isInitialLoad ? 'Could not load.' : 'Could not update; showing the previous rows.'
  } else if (status !== 'idle') {
    banner = isInitialLoad ? `Loading (${status})…` : `Updating (${status})…`
  }

  return (
    <Section
      title="useDataTable with a custom render"
      intro="Your own markup on the headless table: status + isInitialLoad drive the banner, data-* attributes carry the state for CSS."
    >
      <div className="custom" data-status={status} data-initial-load={String(isInitialLoad)}>
        <div className="toolbar">
          <input
            type="search"
            aria-label="Search people"
            placeholder="Search names, cities…"
            value={table.state.search.input}
            onChange={(e) => void table.setSearch(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void table.flushSearch()
              else if (e.key === 'Escape') table.clearSearch()
            }}
          />
          <output className="badge" data-status={status}>
            {status}
            {isInitialLoad ? ' · initial load' : ''}
          </output>
        </div>
        {banner && (
          <p role={status === 'error' ? 'alert' : 'status'} className="banner">
            {banner}
          </p>
        )}
        <table aria-busy={status !== 'idle' && status !== 'error' ? 'true' : undefined}>
          <thead>
            <tr>
              {COLUMNS.map((id) => {
                const dir = table.getSortDirection(id)
                return (
                  <th key={id} scope="col" aria-sort={ariaSort(dir)} data-sort={dir || undefined}>
                    <button
                      type="button"
                      onClick={(e) => table.toggleSort(id, { multi: e.shiftKey })}
                    >
                      {id}
                      {dir === 'asc' ? ' ▲' : dir === 'desc' ? ' ▼' : ''}
                    </button>
                  </th>
                )
              })}
              <th scope="col">joined</th>
            </tr>
          </thead>
          <tbody>
            {page.map((row) => (
              <tr key={row.key} data-row-index={row.index}>
                <td>{row.original.name}</td>
                <td data-numeric="">{row.original.age}</td>
                <td>{row.original.city}</td>
                <td>{row.original.role}</td>
                <td>{row.original.joined.toISOString().slice(0, 10)}</td>
              </tr>
            ))}
            {page.length === 0 && !isInitialLoad && (
              <tr data-empty="">
                <td colSpan={COLUMNS.length + 1}>No one matches “{table.state.search.input}”.</td>
              </tr>
            )}
          </tbody>
        </table>
        <div className="toolbar">
          <button type="button" disabled={!table.canPrevPage()} onClick={table.prevPage}>
            Previous
          </button>
          <span>
            Page {table.state.pagination.pageIndex + 1} of {Math.max(table.getPageCount(), 1)} ·{' '}
            {filteredCount.toLocaleString()} of {totalCount.toLocaleString()} rows
          </span>
          <button type="button" disabled={!table.canNextPage()} onClick={table.nextPage}>
            Next
          </button>
        </div>
      </div>
    </Section>
  )
}

// --- 3. server mode ------------------------------------------------------------------------------

// Read once, at creation: define features outside the component.
const serverFeatures = [
  search({ mode: 'server' }),
  sorting({ mode: 'server' }),
  pagination({ mode: 'server', pageSize: 10 }),
]

const serverComponents: DataTableComponents = {
  Loading: () => <span role="status">Loading…</span>,
}

function ServerMode({ onDiagnostic }: { onDiagnostic: OnDiagnostic }) {
  const [fail, setFail] = useState(false)
  const failRef = useRef(fail)
  failRef.current = fail
  // One fake server per instance; it reads the toggle at request time.
  const [fetcher] = useState(() =>
    withFetcher(createFakeServer({ latency: 600, shouldFail: () => failRef.current })),
  )
  const table = useDataTable({ rowKey: 'id', features: serverFeatures, fetcher, onDiagnostic })
  const { status, isInitialLoad } = table.rowModel

  return (
    <Section
      title="Server mode"
      intro="A fake fetcher over the same rows (600 ms latency, abortable). Make it fail, then search, sort, page or refetch: a failed first load shows Error + Retry, a later failure keeps the previous rows."
    >
      <div className="toolbar">
        <label>
          <input type="checkbox" checked={fail} onChange={(e) => setFail(e.target.checked)} /> Make
          requests fail
        </label>
        <button type="button" onClick={() => void table.refetch()}>
          Refetch
        </button>
        <output className="badge" data-status={status}>
          {status}
          {isInitialLoad ? ' · initial load' : ''}
        </output>
      </div>
      <DataTable table={table} components={serverComponents} caption="People (server)" />
    </Section>
  )
}

// --- 4. schema, flag mode ------------------------------------------------------------------------

function SchemaFlag({ onDiagnostic }: { onDiagnostic: OnDiagnostic }) {
  const table = useDataTable({
    data: rawAccounts,
    schema: withSchema(AccountSchema),
    invalidRows: 'flag',
    rowKey: 'id',
    onDiagnostic,
  })
  const invalid = table.getInvalidRows().length

  return (
    <Section
      title="Schema, flag mode"
      intro={`A Standard Schema validates every raw row; invalidRows: 'flag' keeps the ${invalid} invalid ones, marked with data-invalid / aria-invalid.`}
    >
      <div className="toolbar">
        <label>
          Show{' '}
          <select
            value={table.state.validity}
            onChange={(e) => table.setValidity(e.target.value as ValidityState)}
          >
            <option value="all">all rows</option>
            <option value="valid">valid rows</option>
            <option value="invalid">invalid rows</option>
          </select>
        </label>
      </div>
      <DataTable table={table} caption="Accounts" />
    </Section>
  )
}

// --- diagnostics ---------------------------------------------------------------------------------

const MAX_EVENTS = 50

type Event = { seq: number; d: Diagnostic }

function DiagnosticsPanel({ events, onClear }: { events: readonly Event[]; onClear(): void }) {
  return (
    <Section
      title="Diagnostics"
      intro="Every onDiagnostic event from the examples above, newest first (the console shows them too)."
    >
      <div className="toolbar">
        <button type="button" onClick={onClear} disabled={events.length === 0}>
          Clear
        </button>
        <span>{events.length} events</span>
      </div>
      {events.length === 0 ? (
        <p>No diagnostics yet.</p>
      ) : (
        <ol className="diagnostics">
          {events.map(({ seq, d }) => (
            <li key={seq} data-level={d.level}>
              <code>{d.code}</code> <span data-dk-level="">{d.level}</span>{' '}
              <span data-dk-where="">{d.fingerprint}</span>
              {d.problem && <div>{d.problem}</div>}
              {d.fix.length > 0 && <div>Fix: {d.fix[0]}</div>}
            </li>
          ))}
        </ol>
      )}
    </Section>
  )
}

// --- app -----------------------------------------------------------------------------------------

export function App() {
  const [events, setEvents] = useState<readonly Event[]>([])
  const seq = useRef(0)
  const onDiagnostic = useCallback((d: Diagnostic) => {
    const event = { seq: seq.current++, d }
    setEvents((prev) => [event, ...prev].slice(0, MAX_EVENTS))
  }, [])

  return (
    <main>
      <h1>DataKable playground</h1>
      <p>v{VERSION}. All data is generated in the browser; nothing is fetched over the network.</p>
      <ZeroConfig onDiagnostic={onDiagnostic} />
      <CustomRender onDiagnostic={onDiagnostic} />
      <ServerMode onDiagnostic={onDiagnostic} />
      <SchemaFlag onDiagnostic={onDiagnostic} />
      <DiagnosticsPanel events={events} onClear={() => setEvents([])} />
    </main>
  )
}
