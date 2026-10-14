'use client'

import {
  type AnyFeature,
  boundaryDiagnostics,
  defaultFormat,
  deriveColumns,
  describeReturn,
  emitTableDiagnostic,
  type InvalidRowsMode,
  keepDiagnostics,
  matchesSlot,
  pipelineDiagnostics,
  type RowIssue,
  type RowModelStatus,
  type SearchStatus,
  slotDiagnostics,
  type TableSchema,
  type TableState,
} from '@datakable/core'
import {
  Component,
  type ComponentType,
  type ReactNode,
  useEffect,
  useLayoutEffect,
  useMemo,
} from 'react'
import {
  cellSlot,
  invalidCellSlot,
  registerRenderOperations,
  renderDiagnostics,
} from './render-codes'
import { type UseDataTableOptions, useDataTable } from './use-data-table'

// The codes this module emits (bundlers keep the definitions; see core's `keepDiagnostics`).
keepDiagnostics(renderDiagnostics, boundaryDiagnostics, slotDiagnostics, pipelineDiagnostics)

// The ops its boundaries stand for (§3.4: `render:table`, `render:cell`). Registered at import:
// the dist is one file per module (T37), so hook-only bundles (`useDataTable` without
// `<DataTable />`) never include this module, and this call ships only with `<DataTable />`.
registerRenderOperations()

// No @types/node here: declare just what is read.
declare const process: { env: { NODE_ENV?: string } }

/** No layout effects on the server (React 18 warns about them there). */
const useIsomorphicLayoutEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect

// --- public types --------------------------------------------------------------------------------

/** Props of `components.SearchInput`: the search feature's `input`, bound both ways. */
export interface SearchInputProps {
  /** `state.search.input` (updates as the user types). */
  value: string
  /** `state.search.status`: `pending` while a debounce waits, `searching` while a request runs. */
  status: SearchStatus
  /** `setSearch(value)`. */
  onChange(value: string): void
  /** `flushSearch()` (Enter). */
  onSubmit(): void
  /** `clearSearch()` (Esc). */
  onClear(): void
  /** The input's accessible name: `'Search <caption>'` with a text `caption`, else `'Search'`. */
  label: string
}

/** Props of `components.Pagination` (the pagination feature's state and API). */
export interface PaginationProps {
  pageIndex: number
  pageSize: number
  pageCount: number
  canPrev: boolean
  canNext: boolean
  prev(): void
  next(): void
  setPageIndex(index: number): void
  setPageSize(size: number): void
  /** The pager's accessible name: `'<caption> pagination'` with a text `caption`, else `'Pagination'`. */
  label: string
}

/** Props of `components.Empty`: shown when the table has loaded and has no rows to show. */
export interface EmptyProps {
  /** `true` when there is data but filters / search removed every row. */
  filtered: boolean
}

/** Props of `components.Loading`: the first load (`isInitialLoad`, nothing to show yet). */
export interface LoadingProps {
  status: RowModelStatus
}

/** Props of `components.Error`: the first load failed, or the body failed to render. */
export interface ErrorProps {
  status: RowModelStatus
  /**
   * `'load'`: `status === 'error'` on the first load. `'render'`: a component in the body outside
   * the cells threw (a component inside a cell renders `⚠` in that cell only).
   */
  reason: 'load' | 'render'
  /** `'load'`: `refetch()`. `'render'`: renders the body again. */
  retry(): void
}

/** `<DataTable components={...} />`: replaces the default parts (unstyled, `data-*` hooks only). */
export interface DataTableComponents {
  SearchInput?: ComponentType<SearchInputProps>
  Pagination?: ComponentType<PaginationProps>
  Empty?: ComponentType<EmptyProps>
  Loading?: ComponentType<LoadingProps>
  Error?: ComponentType<ErrorProps>
}

/** What `<DataTable table={...} />` reads: the value `useDataTable` returns. */
export interface DataTableSource {
  readonly state: TableState
  readonly rowModel: {
    readonly rows: readonly DataTableRow[]
    readonly filteredCount: number
    readonly totalCount: number
    readonly status: RowModelStatus
    readonly isInitialLoad: boolean
  }
  getOptions(): { readonly columns?: readonly unknown[] | undefined }
  getData(): readonly unknown[]
  refetch(): Promise<unknown>
}

/** The part of a `Row` (§6.6) `<DataTable />` renders from. */
interface DataTableRow {
  readonly key: string | number
  readonly index: number
  readonly original: unknown
  readonly valid: boolean
  readonly issues: readonly RowIssue[]
  getValue(id: string): unknown
  getCellIssues(id: string): readonly RowIssue[]
}

/** `<DataTable />`'s own props, next to `table` or the `useDataTable` options. */
export interface DataTableOwnProps {
  components?: DataTableComponents | undefined
  caption?: ReactNode
}

/**
 * `<DataTable table={useDataTable(...)} />`, or `<DataTable data={rows} />` with the
 * `useDataTable` options as props (zero-config: columns derived from the data).
 */
export type DataTableProps<
  T = unknown,
  Sch = undefined,
  M extends InvalidRowsMode = InvalidRowsMode,
> = DataTableOwnProps &
  (
    | { table: DataTableSource }
    | (UseDataTableOptions<T, TableState, Sch, M> & {
        features?: readonly AnyFeature[]
        table?: undefined
      })
  )

// --- component -----------------------------------------------------------------------------------

/**
 * The zero-config table (§10). Renders what the installed features provide: sort buttons with
 * `aria-sort`, a search input bound to `input` (Enter = `flushSearch`, Esc = `clearSearch`),
 * pagination, and the Loading / Error / Empty states from `status` + `isInitialLoad` (§6.6).
 * Unstyled: style it through the `data-*` hooks (`data-status`, `data-initial-load`,
 * `data-invalid`, `data-sort`, …) or replace parts with `components`.
 *
 * `@datakable/react`'s `DataTable` installs no features with `data`; `datakable`'s installs the
 * default preset.
 */
export function DataTable<
  T,
  const Sch extends TableSchema | undefined = undefined,
  const M extends InvalidRowsMode = 'drop',
>(props: DataTableProps<T, Sch, M>): ReactNode
export function DataTable(
  props: DataTableOwnProps & { table?: DataTableSource | undefined },
): ReactNode {
  if (props.table !== undefined) {
    return (
      <DataTableView table={props.table} components={props.components} caption={props.caption} />
    )
  }
  return <ZeroConfig {...(props as DataTableOwnProps & { table?: undefined })} />
}

function ZeroConfig(props: DataTableOwnProps & { table?: undefined }) {
  const { components, caption, table: _, ...options } = props
  const view = useDataTable(options as never) as unknown as DataTableSource
  return <DataTableView table={view} components={components} caption={caption} />
}

/** Loose access to the installed features' APIs (the table is typed per feature set). */
type Api = DataTableSource & {
  toggleSort?(id: string, opts?: { multi?: boolean }): void
  setSearch?(q: string): Promise<unknown>
  flushSearch?(): Promise<unknown>
  clearSearch?(): void
  setPageIndex?(i: number): void
  setPageSize?(n: number): void
  nextPage?(): void
  prevPage?(): void
  getPageCount?(): number
  canNextPage?(): boolean
  canPrevPage?(): boolean
}

/** The column fields `<DataTable />` reads (types are checked where the columns are written). */
interface ColumnLike {
  key?: unknown
  id?: unknown
  header?: unknown
  sortable?: unknown
  cell?: (ctx: { row: unknown; value: unknown }) => ReactNode
  format?: (value: unknown) => unknown
  invalidCell?: (ctx: {
    original: unknown
    value: unknown
    issues: readonly RowIssue[]
  }) => ReactNode
}

interface Column {
  readonly def: ColumnLike
  readonly index: number
  readonly id: string
  readonly header: ReactNode
}

/** A cell callback that threw or broke its contract during this render (reported after commit). */
interface Failure {
  slot: string
  column: string
  row: number
  error?: unknown
  /** Bad return: what the contract expects and the type received. */
  expected?: string
  received?: string
  /** A value the default formatter cannot render (`DK_UNRENDERABLE_VALUE`): its type. */
  lost?: string
  index?: number
}

const WARN = '⚠'
/** A failed cell's content: the `⚠` with its text alternative (#60). One element for every cell. */
const FAILED = (
  <span role="img" aria-label="Could not display this value">
    {WARN}
  </span>
)
const BUSY: readonly RowModelStatus[] = ['validating', 'pending', 'searching', 'fetching']
const LOADING: readonly RowModelStatus[] = ['validating', 'searching', 'fetching']

/**
 * The table loads its rows asynchronously: a `fetcher`, or a feature with a `searchFn` (its
 * `defineOptions` values). With nothing applied yet, its `'pending'` is a load waiting to start
 * (deferred until the client, §7.2), so `<DataTable />` shows Loading — also in the server HTML.
 */
function hasAsyncSource(table: DataTableSource): boolean {
  const options = table.getOptions() as { fetcher?: unknown; features?: unknown }
  if (typeof options.fetcher === 'function') return true
  if (!Array.isArray(options.features)) return false
  for (const f of options.features as readonly {
    options?: { values?: { searchFn?: unknown } }
  }[]) {
    if (typeof f?.options?.values?.searchFn === 'function') return true
  }
  return false
}

function resolveColumns(defs: readonly unknown[]): Column[] {
  const out: Column[] = []
  for (let index = 0; index < defs.length; index++) {
    const def = defs[index] as ColumnLike | null | undefined
    if (def === null || typeof def !== 'object') continue
    const id = typeof def.key === 'string' ? def.key : def.id
    if (typeof id !== 'string') continue
    out.push({ def, index, id, header: typeof def.header === 'string' ? def.header : id })
  }
  return out
}

const segment = (s: PropertyKey | { readonly key: PropertyKey }) =>
  String(typeof s === 'object' ? s.key : s)

/**
 * The redacted issue text for `title` (§5.1): the issue paths only. Schema messages embed the
 * received value, so they are never shown.
 */
function issueTitle(issues: readonly RowIssue[]): string {
  const paths = new Set<string>()
  for (const i of issues) paths.add(i.path?.length ? i.path.map(segment).join('.') : '(row)')
  return `Invalid: ${[...paths].join(', ')}`
}

/** The table behind a `useDataTable` view (its prototype), for reporting diagnostics. */
const tableOf = (view: object): object =>
  Object.hasOwn(view, 'rowModel') ? (Object.getPrototypeOf(view) as object) : view

function report(table: object, failures: readonly Failure[]) {
  const bySlot = new Map<string, Failure[]>()
  for (const f of failures) {
    const k = `${f.slot}\0${f.lost ? '' : f.expected === undefined ? 'throw' : 'return'}`
    const list = bySlot.get(k)
    if (list) list.push(f)
    else bySlot.set(k, [f])
  }
  for (const list of bySlot.values()) {
    const first = list[0] as Failure
    const rows = list.slice(0, 3).map((f) => f.row)
    const fallback = 'those cells rendered ⚠'
    try {
      if (first.lost !== undefined) {
        // Deduped by the table per column and data reference, like the column cache's report.
        emitTableDiagnostic(table, 'DK_UNRENDERABLE_VALUE', {
          column: first.column,
          index: first.index as number,
          count: list.length,
          rows,
          valueType: first.lost,
        })
      } else if (first.expected === undefined) {
        const e = first.error
        emitTableDiagnostic(
          table,
          'DK_CALLBACK_FAILED',
          {
            slot: first.slot,
            column: first.column,
            rows,
            count: list.length,
            fallback,
            ...(e instanceof Error ? { errorName: e.name } : {}),
          },
          { cause: e },
        )
      } else if (process.env.NODE_ENV !== 'production') {
        emitTableDiagnostic(table, 'DK_CALLBACK_BAD_RETURN', {
          slot: first.slot,
          column: first.column,
          expected: first.expected,
          received: first.received ?? 'undefined',
          count: list.length,
          rows,
          fallback,
        })
      }
    } catch {
      // Not a table made by createTable (a hand-made `table` prop): nothing to report to.
    }
  }
}

/**
 * The value `defaultFormat` could not render in the current cell (an object, array or function,
 * never `undefined`). One module-level callback: no closure per cell.
 */
let lost: unknown
const onLost = (v: unknown) => {
  lost = v
}

/**
 * Renders one cell's content; a throwing or contract-breaking callback renders `⚠`. An object
 * returned by `cell` / `invalidCell` (an element, an array) may hold components that throw while
 * React renders them, so it gets its own boundary; primitives cannot, so they get none (no cost).
 */
function cellContent(
  col: Column,
  row: DataTableRow,
  failures: Failure[],
  table: object,
): ReactNode {
  const def = col.def
  const value = row.getValue(col.id)
  const issues = row.valid ? undefined : row.getCellIssues(col.id)
  let slot = 'cell'
  try {
    if (issues !== undefined && issues.length > 0) {
      if (def.invalidCell) {
        slot = 'invalidCell'
        const out = def.invalidCell({ original: row.original, value, issues })
        if (matchesSlot(invalidCellSlot, out)) return guard(out, table, col, row, 'invalidCell')
        return bad(failures, col, row, slot, 'a value (not a Promise)', out)
      }
      return (
        <>
          {defaultFormat(value)}{' '}
          <span data-dk-invalid-marker="" aria-hidden="true">
            {WARN}
          </span>
        </>
      )
    }
    if (def.cell) {
      const out = def.cell({ row: row.original, value })
      if (matchesSlot(cellSlot, out)) return guard(out, table, col, row, 'cell')
      return bad(failures, col, row, slot, 'a value (not a Promise)', out)
    }
    if (def.format) {
      slot = 'format'
      const out = def.format(value)
      if (typeof out === 'string') return out
      bad(failures, col, row, slot, 'a string', out)
      return defaultFormat(value)
    }
    const text = defaultFormat(value, onLost)
    if (lost !== undefined) {
      const { id: column, index } = col
      const type = Array.isArray(lost) ? 'array' : typeof lost
      failures.push({ slot: `columns[${index}]`, column, index, row: row.index, lost: type })
      lost = undefined
    }
    return text
  } catch (error) {
    failures.push({ slot: `columns[${col.index}].${slot}`, column: col.id, row: row.index, error })
    return FAILED
  }
}

/** Wraps object content in a per-cell boundary (`render:cell`); primitives pass through as-is. */
function guard(
  out: ReactNode,
  table: object,
  col: Column,
  row: DataTableRow,
  slot: 'cell' | 'invalidCell',
): ReactNode {
  if (typeof out !== 'object' || out === null) return out
  return (
    <CellBoundary table={table} col={col} slot={slot} row={row.index} original={row.original}>
      {out}
    </CellBoundary>
  )
}

function bad(
  failures: Failure[],
  col: Column,
  row: DataTableRow,
  slot: string,
  expected: string,
  out: unknown,
): ReactNode {
  failures.push({
    slot: `columns[${col.index}].${slot}`,
    column: col.id,
    row: row.index,
    expected,
    received: describeReturn(out),
  })
  return FAILED
}

type Page = { pageIndex: number; pageSize: number }

/**
 * The pager of the rendered snapshot, like the pagination API computes it live: the hydrating
 * render must match the server HTML even when the table changed meanwhile (#16). Client mode
 * pages over the row model's `filteredCount`; server mode over the fetched `rowCount`, which only
 * the table knows (and no render changes).
 */
function pages(view: Api, page: Page, count: number) {
  const features = (
    view.getOptions() as { features?: readonly { stage?: string; mode?: string }[] }
  ).features
  if (features?.some((f) => f?.stage === 'paginate' && f.mode === 'server')) {
    return {
      ...page,
      pageCount: view.getPageCount?.() ?? 0,
      canPrev: view.canPrevPage?.() ?? false,
      canNext: view.canNextPage?.() ?? false,
    }
  }
  const pageCount = Math.ceil(count / page.pageSize)
  const index = Math.min(page.pageIndex, Math.max(pageCount - 1, 0))
  return { ...page, pageCount, canPrev: index > 0, canNext: index + 1 < pageCount }
}

const ariaSort = (dir: 'asc' | 'desc' | false) =>
  dir === 'asc' ? 'ascending' : dir === 'desc' ? 'descending' : 'none'

function DataTableView(props: {
  table: DataTableSource
  components: DataTableComponents | undefined
  caption: ReactNode
}) {
  const view = props.table as Api
  const parts = props.components ?? {}
  const { state, rowModel } = view
  const { rows, status, isInitialLoad } = rowModel
  const defs = view.getOptions().columns
  const data = view.getData()
  // Zero-config columns follow the data; given columns follow their reference (§10).
  const derivedFrom = defs === undefined ? data : undefined
  const columns = useMemo(
    () => resolveColumns(defs ?? (derivedFrom ? deriveColumns(derivedFrom) : [])),
    [defs, derivedFrom],
  )
  const failures: Failure[] = []
  const table = tableOf(view)
  // After commit, never during render: a sink may set state.
  useIsomorphicLayoutEffect(() => {
    if (failures.length > 0) report(table, failures)
  })

  const sortable = typeof view.toggleSort === 'function'
  const sortBy = (state.sorting as { by: readonly { id: string; desc?: boolean }[] } | undefined)
    ?.by
  const searchState = state.search as { input: string; status: SearchStatus } | undefined
  const paged = typeof view.getPageCount === 'function'
  // Loading (§6.6, §10): nothing to show yet and rows on their way — in flight, or deferred async
  // work that has not started (SSR, §7.2: 'pending').
  const loading =
    isInitialLoad && (LOADING.includes(status) || (status === 'pending' && hasAsyncSource(view)))
  const failed = isInitialLoad && status === 'error'
  const span = Math.max(columns.length, 1)
  const retryLoad = () => void view.refetch()
  // A text caption names the search box and the pager, so two tables get distinct names (#59).
  const cap = props.caption
  const named = typeof cap === 'string' || typeof cap === 'number' ? `${cap}` : ''

  const Empty = parts.Empty ?? DefaultEmpty
  const Loading = parts.Loading ?? DefaultLoading
  const ErrorState = parts.Error ?? DefaultError

  let body: ReactNode
  if (loading) {
    body = stateRow(span, 'loading', <Loading status={status} />)
  } else if (failed) {
    body = stateRow(span, 'error', <ErrorState status={status} reason="load" retry={retryLoad} />)
  } else if (rows.length === 0) {
    body = stateRow(span, 'empty', <Empty filtered={rowModel.totalCount > 0} />)
  } else {
    body = rows.map((row) => {
      const valid = row.valid
      return (
        <tr
          key={row.key}
          data-invalid={valid ? undefined : 'true'}
          aria-invalid={valid ? undefined : 'true'}
          title={valid ? undefined : issueTitle(row.issues)}
        >
          {columns.map((col) => {
            const issues = valid ? undefined : row.getCellIssues(col.id)
            const broken = issues !== undefined && issues.length > 0
            return (
              <td
                key={col.index}
                data-invalid={broken ? 'true' : undefined}
                aria-invalid={broken ? 'true' : undefined}
                title={broken ? issueTitle(issues) : undefined}
              >
                {cellContent(col, row, failures, table)}
              </td>
            )
          })}
        </tr>
      )
    })
  }

  // The server runs no effects: report now (setting state is a no-op there).
  if (typeof window === 'undefined' && failures.length > 0) report(table, failures)

  return (
    <div
      data-datakable=""
      data-status={status}
      data-initial-load={isInitialLoad ? 'true' : 'false'}
      aria-busy={BUSY.includes(status) ? 'true' : undefined}
    >
      {searchState && (
        <div data-dk-search="" data-status={searchState.status}>
          {part(table, 'SearchInput', parts.SearchInput, DefaultSearchInput, {
            value: searchState.input,
            status: searchState.status,
            onChange: (q) => void view.setSearch?.(q),
            onSubmit: () => void view.flushSearch?.(),
            onClear: () => view.clearSearch?.(),
            label: named ? `Search ${named}` : 'Search',
          })}
        </div>
      )}
      {!loading && !failed && status !== 'idle' && (
        <RefreshIndicator status={status} retry={retryLoad} />
      )}
      <table>
        {props.caption != null && <caption>{props.caption}</caption>}
        <thead>
          <tr>
            {columns.map((col) => {
              const canSort = sortable && col.def.sortable !== false
              // From the rendered state, not the live table (the hydrating render, #16).
              const e = canSort ? sortBy?.find((x) => x.id === col.id) : undefined
              const dir = e ? (e.desc ? 'desc' : 'asc') : false
              return (
                <th
                  key={col.index}
                  scope="col"
                  aria-sort={canSort ? ariaSort(dir) : undefined}
                  data-sort={dir || undefined}
                >
                  {canSort ? (
                    <button
                      type="button"
                      onClick={(e) => view.toggleSort?.(col.id, { multi: e.shiftKey })}
                    >
                      {col.header}
                      <span data-dk-sort-indicator="" aria-hidden="true">
                        {dir === 'asc' ? ' ▲' : dir === 'desc' ? ' ▼' : ''}
                      </span>
                    </button>
                  ) : (
                    col.header
                  )}
                </th>
              )
            })}
          </tr>
        </thead>
        <tbody>
          <BodyBoundary
            table={table}
            resetKey={rowModel}
            fallback={(retry) =>
              stateRow(span, 'error', <ErrorState status={status} reason="render" retry={retry} />)
            }
          >
            {body}
          </BodyBoundary>
        </tbody>
      </table>
      {paged &&
        part(table, 'Pagination', parts.Pagination, DefaultPagination, {
          ...pages(view, state.pagination as Page, rowModel.filteredCount),
          prev: () => view.prevPage?.(),
          next: () => view.nextPage?.(),
          setPageIndex: (i) => view.setPageIndex?.(i),
          setPageSize: (n) => view.setPageSize?.(n),
          label: named ? `${named} pagination` : 'Pagination',
        })}
    </div>
  )
}

/**
 * A search / pager part (outside the body): a custom one that throws is replaced by the default
 * part (`DK_RENDER_FAILED` at `components.<name>`) until another component is passed.
 */
function part<P extends object>(
  table: object,
  name: 'SearchInput' | 'Pagination',
  Custom: ComponentType<P> | undefined,
  Default: ComponentType<P>,
  props: P,
): ReactNode {
  if (!Custom) return <Default {...props} />
  return (
    <BodyBoundary
      table={table}
      slot={`components.${name}`}
      resetKey={Custom}
      fallback={() => <Default {...props} />}
    >
      <Custom {...props} />
    </BodyBoundary>
  )
}

function stateRow(span: number, kind: string, content: ReactNode) {
  return (
    <tr data-dk-state={kind}>
      <td colSpan={span}>{content}</td>
    </tr>
  )
}

// --- error boundaries (DK_RENDER_FAILED) ---------------------------------------------------------

interface BoundaryProps {
  table: object
  /** A part outside the body (`components.SearchInput`): reported as the slot. */
  slot?: string
  /** A new value (the next row model) renders the body again. */
  resetKey: unknown
  fallback(retry: () => void): ReactNode
  children: ReactNode
}

/**
 * Catches a component that throws inside the body outside any cell boundary (§10: a
 * `components.Empty` / `Loading` / `Error` part): reports `DK_RENDER_FAILED` (`render:table`) and
 * shows the Error state; the header, search and pagination keep working.
 */
class BodyBoundary extends Component<BoundaryProps, { failed: boolean; key: unknown }> {
  override state = { failed: false, key: this.props.resetKey }

  static getDerivedStateFromError() {
    return { failed: true }
  }

  static getDerivedStateFromProps(props: BoundaryProps, state: { key: unknown }) {
    return props.resetKey === state.key ? null : { failed: false, key: props.resetKey }
  }

  override componentDidCatch(error: unknown) {
    try {
      emitTableDiagnostic(
        this.props.table,
        'DK_RENDER_FAILED',
        {
          op: 'render:table',
          ...(this.props.slot ? { slot: this.props.slot } : {}),
          ...(error instanceof Error ? { errorName: error.name } : {}),
        },
        { cause: error },
      )
    } catch {
      // Not a table made by createTable: nothing to report to.
    }
  }

  retry = () => this.setState({ failed: false })

  override render() {
    return this.state.failed ? this.props.fallback(this.retry) : this.props.children
  }
}

interface CellBoundaryProps {
  table: object
  col: Column
  slot: 'cell' | 'invalidCell'
  /** The row's index in the data (`row.index`). */
  row: number
  /** The row's data: a new object (or new columns) renders a failed cell again. */
  original: unknown
  children: ReactNode
}

interface CellBoundaryState {
  failed: boolean
  original: unknown
  def: ColumnLike
}

/**
 * One cell's boundary (`render:cell`, §3.4): a component returned by `cell` / `invalidCell` that
 * throws renders `⚠` in that cell only and reports `DK_RENDER_FAILED` (deduped per column); the
 * other cells, rows and the table keep working. Only wraps object content (see `guard`).
 */
class CellBoundary extends Component<CellBoundaryProps, CellBoundaryState> {
  override state: CellBoundaryState = {
    failed: false,
    original: this.props.original,
    def: this.props.col.def,
  }

  static getDerivedStateFromError() {
    return { failed: true }
  }

  static getDerivedStateFromProps(props: CellBoundaryProps, state: CellBoundaryState) {
    return props.original === state.original && props.col.def === state.def
      ? null
      : { failed: false, original: props.original, def: props.col.def }
  }

  override componentDidCatch(error: unknown) {
    const { table, col, slot, row } = this.props
    try {
      emitTableDiagnostic(
        table,
        'DK_RENDER_FAILED',
        {
          op: 'render:cell',
          slot: `columns[${col.index}].${slot}`,
          column: col.id,
          row,
          ...(error instanceof Error ? { errorName: error.name } : {}),
        },
        { cause: error },
      )
    } catch {
      // Not a table made by createTable: nothing to report to.
    }
  }

  override render() {
    return this.state.failed ? FAILED : this.props.children
  }
}

// --- default parts (unstyled) --------------------------------------------------------------------

function DefaultSearchInput({
  value,
  status,
  onChange,
  onSubmit,
  onClear,
  label,
}: SearchInputProps) {
  return (
    <>
      <input
        type="search"
        aria-label={label}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') onSubmit()
          else if (e.key === 'Escape') onClear()
        }}
      />
      {(status === 'pending' || status === 'searching') && (
        <span role="status" data-dk-spinner="" aria-label="Searching" />
      )}
    </>
  )
}

function DefaultPagination(p: PaginationProps) {
  return (
    <nav aria-label={p.label} data-dk-pagination="">
      <button type="button" aria-label="Previous page" disabled={!p.canPrev} onClick={p.prev}>
        ‹
      </button>
      <span data-dk-page="">
        Page {p.pageIndex + 1} of {Math.max(p.pageCount, 1)}
      </span>
      <button type="button" aria-label="Next page" disabled={!p.canNext} onClick={p.next}>
        ›
      </button>
    </nav>
  )
}

const DefaultEmpty = ({ filtered }: EmptyProps) => <>{filtered ? 'No matching rows' : 'No rows'}</>

const DefaultLoading = (_: LoadingProps) => <span role="status">Loading…</span>

function DefaultError({ reason, retry }: ErrorProps) {
  return (
    <div role="alert">
      {reason === 'load' ? 'Could not load the rows.' : 'Could not display the rows.'}{' '}
      <button type="button" onClick={retry}>
        Retry
      </button>
    </div>
  )
}

/** Over stale rows (§6.6): the table is busy, or a later update failed. */
function RefreshIndicator({ status, retry }: { status: RowModelStatus; retry(): void }) {
  if (status === 'error') {
    return (
      <div data-dk-refresh="" data-status={status} role="alert">
        Could not refresh; showing the previous rows.{' '}
        <button type="button" onClick={retry}>
          Retry
        </button>
      </div>
    )
  }
  return (
    <div data-dk-refresh="" data-status={status} role="status">
      Updating…
    </div>
  )
}
