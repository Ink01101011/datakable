import { defineOptions } from '../../catalog/options'
import { keepDiagnostics } from '../../diagnostics/catalog'
import { describeValue } from '../../diagnostics/redact'
import { defineFeature } from '../../feature/define'
import type { FeatureContext } from '../../feature/types'
import { defineInterceptor } from '../../intercept/define'
import { type DataMode, modeOption } from '../../source/mode'
import { getTableInternals } from '../../table/internals'
import type { Table, TableState } from '../../table/types'
import { paginationDiagnostics } from './codes'

keepDiagnostics(paginationDiagnostics)

export interface PaginationState {
  pageIndex: number
  pageSize: number
}

export interface PaginationApi {
  /** Goes to page `index`, clamped to `[0, getPageCount() - 1]`. */
  setPageIndex(index: number): void
  /** Changes the page size and keeps the first visible row on screen (`floor(firstRow / size)`). */
  setPageSize(size: number): void
  /** Next page; no-op on the last page. */
  nextPage(): void
  /** Previous page; no-op on the first page. */
  prevPage(): void
  /** `ceil(rowCount / pageSize)`; `0` when there are no rows. */
  getPageCount(): number
  canNextPage(): boolean
  canPrevPage(): boolean
}

export interface PaginationOptions {
  /** Starting page size (default 10). `options.initialState.pagination` takes precedence. */
  pageSize?: number
  /** Go back to page 0 when search, filters or sort change (default `true`). */
  autoResetPageIndex?: boolean
  /**
   * `'server'`: the server pages (its state goes to `options.fetcher`, or the app passes the
   * current page as `data`); the page count is `ceil(rowCount / pageSize)` with `rowCount` from the
   * fetcher result or the `rowCount` option (§6.5, §7.1). Default `'client'`.
   */
  mode?: DataMode
}

const DEFAULT_PAGE_SIZE = 10
const NAME = 'pagination'

const isIndex = (v: unknown): v is number => Number.isInteger(v) && (v as number) >= 0
const isSize = (v: unknown): v is number => Number.isInteger(v) && (v as number) > 0
const received = (v: unknown) => (typeof v === 'number' ? String(v) : describeValue(v))

const paginationOptions = {
  pageSize: { type: 'number', check: isSize, expected: 'an integer > 0' },
  autoResetPageIndex: { type: 'boolean' },
  mode: modeOption,
} as const

/** Stages whose state changes send the table back to page 0 (`autoResetPageIndex`). */
const RESET_STAGES = new Set(['filter', 'search', 'sort'])

/**
 * A slice change that resets the page. For a search slice only the applied `query` counts: typing
 * (`input`) and `status` alone keep the page (a debounced keystroke must not jump to page 0).
 */
function changed(stage: string, a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return false
  if (stage === 'search' && hasQuery(a) && hasQuery(b)) return !Object.is(a.query, b.query)
  return true
}

const hasQuery = (v: unknown): v is { query: unknown } =>
  v !== null && typeof v === 'object' && 'query' in v

/** The page actually shown: `pageIndex` clamped to the last page (0 for no rows). */
function effectiveIndex(pageIndex: number, pageSize: number, rowCount: number): number {
  const last = rowCount === 0 ? 0 : Math.ceil(rowCount / pageSize) - 1
  return pageIndex > last ? last : pageIndex
}

/** What the pagination interceptor needs of one table (registered by `createApi`). */
interface Host {
  /** Runs after `state:dispatch` / `table:setOptions` committed: validation, then auto-reset. */
  after(before: TableState): void
}

/**
 * Client-side pagination (§6.5). State `{ pageIndex, pageSize }`; the `paginate` step returns the
 * rows of the current page (`RowModel.filteredCount` stays the count before paging).
 *
 * - `setPageSize` keeps the first visible row on screen; `setPageIndex` clamps.
 * - `autoResetPageIndex` (default `true`): a change of a filter / search / sort slice resets
 *   `pageIndex` to 0 in the same update (one notification). An update that also sets the
 *   pagination slice keeps the page it sets.
 * - `pageIndex` is clamped when the row count shrinks (data change, filters with auto-reset off).
 * - Invalid values are never silent: API arguments are ignored and slices written to the store are
 *   replaced, both with `DK_INVALID_PAGINATION`.
 */
export const pagination = (opts: PaginationOptions = {}) => {
  const initialSize = opts.pageSize ?? DEFAULT_PAGE_SIZE
  const autoReset = opts.autoResetPageIndex !== false
  const mode = opts.mode ?? 'client'
  // One feature instance may serve several tables: per-table state lives here.
  const hosts = new WeakMap<object, Host>()

  const interceptor = defineInterceptor({
    name: NAME,
    on: ['state:dispatch', 'table:setOptions'],
    intercept(ctx, next) {
      const host = hosts.get(ctx.table as object)
      if (!host) return next()
      const before = (ctx.table as Table<unknown, TableState>).getState()
      const out = next()
      host.after(before)
      return out
    },
  })

  return defineFeature({
    name: NAME,
    stage: 'paginate',
    mode,
    options: defineOptions(paginationOptions, opts),
    interceptors: [interceptor],
    initialState: (): PaginationState => ({ pageIndex: 0, pageSize: initialSize }),
    // After destroy(): the getters still return their declared types (no pages, no navigation).
    destroyedResult: { getPageCount: () => 0, canNextPage: () => false, canPrevPage: () => false },
    createApi: (ctx: FeatureContext<PaginationState>): PaginationApi => {
      const table = ctx.table

      const internals = getTableInternals(table)
      let missingReported = false
      /**
       * Rows to page over. Server mode (§6.5, §7.1): the fetcher result's `rowCount`
       * (`undefined` until the first one applied), else the `rowCount` option, else
       * `DK_ROW_COUNT_MISSING` and `data.length` as the total.
       */
      const rowCount = (): number | undefined => {
        if (mode !== 'server') return table.getRowModel().filteredCount
        const n = internals.rowCount()
        if (n !== undefined || internals.hasFetcher()) return n
        const rows = table.getRowModel().totalCount
        if (!missingReported) {
          missingReported = true
          ctx.emit('DK_ROW_COUNT_MISSING', { rows })
        }
        return rows
      }

      /** The slice with invalid fields replaced (`prev` = the last valid slice, if any). */
      function sanitize(s: unknown, prev: unknown): PaginationState | undefined {
        const fallbackSize = isSize((prev as PaginationState | undefined)?.pageSize)
          ? (prev as PaginationState).pageSize
          : initialSize
        if (s === null || typeof s !== 'object') {
          report('state', 'pageIndex', s, 'the pagination state was reset to its initial value')
          return { pageIndex: 0, pageSize: initialSize }
        }
        const { pageIndex, pageSize } = s as Partial<PaginationState>
        let fixed: PaginationState | undefined
        if (!isIndex(pageIndex)) {
          report('state', 'pageIndex', pageIndex, 'pageIndex was replaced by 0')
          fixed = { ...(s as PaginationState), pageIndex: 0 }
        }
        if (!isSize(pageSize)) {
          report('state', 'pageSize', pageSize, `pageSize was replaced by ${fallbackSize}`)
          fixed = { ...(fixed ?? (s as PaginationState)), pageSize: fallbackSize }
        }
        return fixed
      }

      function report(
        source: 'setPageIndex' | 'setPageSize' | 'state',
        field: 'pageIndex' | 'pageSize',
        value: unknown,
        fallback: string,
      ) {
        ctx.emit('DK_INVALID_PAGINATION', { source, field, received: received(value), fallback })
      }

      /**
       * The current slice and the page actually shown. An unknown count (a server count not
       * fetched yet) clamps nothing.
       */
      function current() {
        const s = ctx.getState()
        const count = rowCount()
        const index =
          count === undefined ? s.pageIndex : effectiveIndex(s.pageIndex, s.pageSize, count)
        return { s, count, index }
      }

      function goTo(index: number) {
        const { s, count } = current()
        const target =
          index < 0 ? 0 : count === undefined ? index : effectiveIndex(index, s.pageSize, count)
        if (target !== s.pageIndex) ctx.setState({ ...s, pageIndex: target })
      }

      hosts.set(table, {
        after(before) {
          const now = table.getState()
          const slice = now[NAME]
          if (!Object.is(before[NAME], slice)) {
            const fixed = sanitize(slice, before[NAME])
            if (fixed) ctx.setState(fixed)
            return // an update that sets the pagination slice keeps its page
          }
          if (!autoReset || (slice as PaginationState).pageIndex === 0) return
          for (const f of getTableInternals(table).features) {
            if (RESET_STAGES.has(f.stage) && changed(f.stage, before[f.name], now[f.name])) {
              ctx.setState({ ...(slice as PaginationState), pageIndex: 0 })
              return
            }
          }
        },
      })

      // A slice given at creation (initialState / controlled state) is checked once, here.
      const fixed = sanitize(ctx.getState(), undefined)
      if (fixed) ctx.setState(fixed)

      // Clamp when the row count shrinks. A listener sees every change (data, async ingest,
      // filters with auto-reset off); its update is notified in the next round.
      table.subscribe(() => {
        const { s, index } = current()
        if (index !== s.pageIndex) ctx.setState({ ...s, pageIndex: index })
      })

      return {
        setPageIndex(index) {
          if (!Number.isInteger(index)) {
            report('setPageIndex', 'pageIndex', index, 'the call was ignored')
            return
          }
          goTo(index)
        },
        setPageSize(size) {
          if (!isSize(size)) {
            report('setPageSize', 'pageSize', size, 'the call was ignored')
            return
          }
          const { s, index } = current()
          if (size === s.pageSize) return
          const firstRow = index * s.pageSize
          ctx.setState({ pageIndex: Math.floor(firstRow / size), pageSize: size })
        },
        nextPage() {
          goTo(current().index + 1)
        },
        prevPage() {
          goTo(current().index - 1)
        },
        getPageCount() {
          const count = rowCount()
          return !count ? 0 : Math.ceil(count / ctx.getState().pageSize)
        },
        canNextPage() {
          const { s, count, index } = current()
          return count !== undefined && (index + 1) * s.pageSize < count
        },
        canPrevPage() {
          return current().index > 0
        },
      }
    },
    rowModel: (indices, s) => {
      const size = isSize(s?.pageSize) ? s.pageSize : initialSize
      const index = effectiveIndex(isIndex(s?.pageIndex) ? s.pageIndex : 0, size, indices.length)
      const start = index * size
      if (start === 0 && size >= indices.length) return indices
      return indices.subarray(start, start + size)
    },
  })
}
