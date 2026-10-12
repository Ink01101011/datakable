import { optionDiagnostics } from '../../catalog/codes'
import { defineOptions } from '../../catalog/options'
import { describeReturn } from '../../catalog/slots'
import type { SortAlgorithm } from '../../column/column-def'
import { compilePath, getValue } from '../../column/get-value'
import type { Path } from '../../column/path'
import { useDiagnostics } from '../../diagnostics/catalog'
import { DEV } from '../../diagnostics/env'
import { defineFeature } from '../../feature/define'
import type { FeatureTypes, RowModelContext } from '../../feature/types'
import { CellFailures } from '../../intercept/cell-batch'
import { errorName } from '../../intercept/classify'
import { boundaryDiagnostics } from '../../intercept/codes'
import { type ResolvedColumn, resolveColumns } from '../../pipeline/columns'
import { allRows } from '../../pipeline/indices'
import type { ColumnValues } from '../../pipeline/types'
import { type DataMode, modeOption } from '../../source/mode'
import { detectCapability } from '../../versioning/capability'
import { comparatorDiagnostics, sortingDiagnostics } from './codes'
import {
  defaultIndexComparator,
  type IndexComparator,
  RANK,
  sortFnIndexComparator,
  typeRank,
} from './compare'
import {
  chooseAuto,
  hasExsorted,
  intKeys,
  needsIntKeys,
  sortIntKeys,
  sortWithComparator,
} from './strategy'

useDiagnostics(sortingDiagnostics, comparatorDiagnostics, boundaryDiagnostics, optionDiagnostics)

/** One sort key: a column id (a path of the row type) and its direction. */
export type SortEntry<T> = { id: Path<T>; desc: boolean }

/** The `sorting` slice (§6.4): multi-column, earlier entries first. Empty = unsorted. */
export type SortingState<T> = { by: readonly SortEntry<T>[] }

export type SortDirection = 'asc' | 'desc'

export type SortingApi<T> = {
  /**
   * Cycles `id` asc → desc → none. Without `multi` the result is a single-column sort; with `multi`
   * (Shift+click) `id` is appended, cycled in place or removed and the other entries are kept.
   */
  toggleSort(id: Path<T>, options?: { multi?: boolean }): void
  /** Replaces the whole sort. */
  setSorting(by: readonly SortEntry<T>[]): void
  /** Removes every sort entry (input order). */
  clearSorting(): void
  /** `id`'s direction in the current sort, or `false` (for `aria-sort`). */
  getSortDirection(id: Path<T>): SortDirection | false
}

export interface SortingTypes extends FeatureTypes {
  state: SortingState<this['T']>
  api: SortingApi<this['T']>
}

/**
 * How rows are sorted (§6.4): `'auto'` (default) picks per sort from one O(n) scan — exsorted
 * tim / counting / radix for a single column of safe-integer keys (numbers, `Date`s), native
 * `Array.prototype.sort` otherwise. A built-in name forces that algorithm (radix / counting only
 * apply to safe-integer keys); a function sorts the row indices itself.
 */
export type SortAlgorithmOption = SortAlgorithm

export interface SortingOptions {
  /** Locale(s) of the string collator (`Intl.Collator(locale, { numeric: true })`); default: the runtime's. */
  locale?: string | readonly string[]
  /** The sort algorithm (default `'auto'`); a column's `sortAlgorithm` takes precedence. */
  algorithm?: SortAlgorithmOption
  /** Reports the algorithm chosen for each sort, why, n and the time taken (`DK_SORT_STRATEGY`). */
  debug?: boolean
  /**
   * `'server'`: the server sorts (its state goes to `options.fetcher`, or the app fetches); core
   * skips this step (§7.1). Default `'client'`.
   */
  mode?: DataMode
}

const validLocale = (v: unknown) => {
  try {
    Intl.getCanonicalLocales(v as string | string[])
    return true
  } catch {
    return false
  }
}

const ALGORITHMS = ['auto', 'tim', 'radix', 'counting', 'merge', 'native'] as const

const sortingOptions = {
  locale: {
    type: ['string', 'array'],
    check: validLocale,
    expected: 'a BCP 47 locale tag or a list of them, e.g. "th" or ["th", "en"]',
  },
  algorithm: {
    type: ['string', 'function'],
    oneOf: ALGORITHMS,
    expected: `one of ${ALGORITHMS.map((a) => `'${a}'`).join(', ')}, or (indices, compare) => indices`,
  },
  debug: { type: 'boolean' },
  mode: modeOption,
} as const

type CustomAlgorithm = Extract<SortAlgorithm, (...args: never[]) => unknown>

const now = () => (typeof performance === 'undefined' ? Date.now() : performance.now())

const missing = (v: unknown) => typeRank(v) === RANK.missing

/**
 * Dev check of a column's `sortFn` (§8.3 `DK_SORT_COMPARATOR_INVALID`), sampled: up to 8 present
 * values spread over the input, every pair both ways. A throw gives no verdict (the sort reports
 * it as `DK_CALLBACK_FAILED`).
 */
function checkSortFn(
  fn: SortFn,
  values: ColumnValues,
  indices: Uint32Array,
): { reason: 'nan' | 'not-number' | 'inconsistent'; received?: string } | undefined {
  const sample: unknown[] = []
  const step = Math.max(1, Math.floor(indices.length / 8))
  for (let i = 0; i < indices.length && sample.length < 8; i += step) {
    const v = values[indices[i] as number]
    if (!missing(v)) sample.push(v)
  }
  try {
    for (let i = 0; i < sample.length; i++) {
      for (let j = i; j < sample.length; j++) {
        const x = fn(sample[i], sample[j])
        const y = fn(sample[j], sample[i])
        for (const r of [x, y]) {
          if (typeof r !== 'number') return { reason: 'not-number', received: describeReturn(r) }
          if (Number.isNaN(r)) return { reason: 'nan' }
        }
        if (Math.sign(x) !== -Math.sign(y)) return { reason: 'inconsistent' }
      }
    }
  } catch {
    return undefined
  }
  return undefined
}

type SortFn = (a: unknown, b: unknown) => number
type SortBy = (row: unknown) => unknown

const fnField = (def: object, field: 'sortFn' | 'sortBy') => {
  const f = (def as Record<string, unknown>)[field]
  return typeof f === 'function' ? f : undefined
}

/** Aborts a native sort when a column's `sortFn` throws (the entry then falls back). */
class SortFnFailed {
  constructor(
    readonly entry: number,
    readonly error: unknown,
  ) {}
}

/**
 * Sorting (§6.4): `toggleSort` (asc → desc → none, `multi`), stable sort of the row indices with
 * the default comparator — missing values (`null`, `undefined`, `NaN`, invalid `Date`) last in both
 * directions, mixed types by type rank, strings with one `Intl.Collator(locale, { numeric: true })`
 * — or a column's `sortFn` / `sortBy`. Never touches the data: a copy of the index array is sorted.
 *
 * `algorithm: 'auto'` (default) picks per sort from one O(n) scan (§6.4): exsorted tim / counting /
 * radix for a single column of safe-integer keys (numbers, `Date`s), native `Array.prototype.sort`
 * (stable) for strings, floats, multi-column and `sortFn`. Every choice gives the same stable order.
 * `sorting({ algorithm })` or a column's `sortAlgorithm` overrides it; `debug: true` reports each
 * choice (`DK_SORT_STRATEGY`).
 */
export const sorting = (opts: SortingOptions = {}) => {
  let collator: Intl.Collator | undefined
  const getCollator = () => {
    if (collator) return collator
    try {
      collator = new Intl.Collator(opts.locale as string | string[] | undefined, { numeric: true })
    } catch {
      collator = new Intl.Collator(undefined, { numeric: true })
    }
    return collator
  }

  // Values that the column cache does not hold, per data reference (released with it).
  const sortByCache = new WeakMap<readonly unknown[], WeakMap<object, unknown[]>>()
  const pathCache = new WeakMap<readonly unknown[], Map<string, unknown[]>>()
  /** exsorted feature detection (§8.5), once per feature instance, on the first sort needing it. */
  let exsorted: boolean | undefined

  /** `sortBy` failures (§3.4): numbers only; text is built only when a cell failed. */
  const sortByFailures = new CellFailures()

  /**
   * `sortBy` is a cell slot: one `column:batch` per column per data reference, an inline
   * `try/catch` per row. A failed row (or a batch an interceptor skipped) keys as `undefined`,
   * which sorts last.
   */
  function sortByValues(ctx: RowModelContext, col: ResolvedColumn, sortBy: SortBy): unknown[] {
    const data = ctx.data
    let byDef = sortByCache.get(data)
    if (!byDef) {
      byDef = new WeakMap()
      sortByCache.set(data, byDef)
    }
    let out = byDef.get(col.def)
    if (out) return out
    const values: unknown[] = new Array(data.length).fill(undefined)
    const rows = allRows(data)
    sortByFailures.reset()
    ctx.batch(col.id, 'sortBy', rows, () => {
      for (let i = 0; i < rows.length; i++) {
        const r = rows[i] as number
        try {
          values[r] = sortBy(data[r])
        } catch (e) {
          sortByFailures.add(r, e)
        }
      }
      sortByFailures.report(ctx.emit, col.index, col.id, 'sortBy')
    })
    sortByFailures.reset()
    out = values
    byDef.set(col.def, out)
    return out
  }

  function pathValues(ctx: RowModelContext, id: string): unknown[] {
    const data = ctx.data
    let byId = pathCache.get(data)
    if (!byId) {
      byId = new Map()
      pathCache.set(data, byId)
    }
    let out = byId.get(id)
    if (out) return out
    const path = compilePath(id)
    out = new Array(data.length)
    for (let r = 0; r < data.length; r++) out[r] = getValue(data[r], path)
    byId.set(id, out)
    return out
  }

  return defineFeature<'sorting', SortingTypes>({
    name: 'sorting',
    stage: 'sort',
    mode: opts.mode ?? 'client',
    options: defineOptions(sortingOptions, opts),
    initialState: () => ({ by: [] }),
    createApi: (ctx) => ({
      toggleSort: (id, options) =>
        ctx.setState((s) => {
          const by = s.by
          const i = by.findIndex((e) => e.id === id)
          const cur = by[i]
          const next = !cur ? { id, desc: false } : cur.desc ? undefined : { id, desc: true }
          if (!options?.multi) return { by: next ? [next] : [] }
          if (!cur) return { by: [...by, next as SortEntry<unknown>] }
          const out = by.slice()
          if (next) out[i] = next
          else out.splice(i, 1)
          return { by: out }
        }),
      setSorting: (by) => ctx.setState({ by: by.slice() }),
      clearSorting: () => ctx.setState({ by: [] }),
      getSortDirection: (id) => {
        const e = ctx.getState().by.find((x) => x.id === id)
        return e ? (e.desc ? 'desc' : 'asc') : false
      },
    }),
    rowModel: (indices, state, ctx) => {
      const by = state?.by
      if (!by || by.length === 0 || indices.length < 2) return indices
      const t0 = opts.debug ? now() : 0
      const cols = resolveColumns(ctx.columns)
      const entries = by.map((e) => {
        const id = String(e.id)
        const col = cols.byId.get(id)
        const sortBy = col && (fnField(col.def, 'sortBy') as SortBy | undefined)
        const values: ColumnValues = sortBy
          ? sortByValues(ctx, col, sortBy)
          : (ctx.getColumnValues(id) ?? pathValues(ctx, id))
        const sortFn =
          col && !sortBy ? (fnField(col.def, 'sortFn') as SortFn | undefined) : undefined
        return { col, desc: e.desc === true, values, sortFn }
      })

      // Dev (§8.3): a sampled sortFn check; an invalid one falls back to the default comparator.
      if (DEV) {
        for (const e of entries) {
          if (!e.sortFn) continue
          const bad = checkSortFn(e.sortFn, e.values, indices)
          if (!bad) continue
          e.sortFn = undefined
          const col = e.col as ResolvedColumn
          ctx.emit('DK_SORT_COMPARATOR_INVALID', { column: col.id, index: col.index, ...bad })
        }
      }

      // The requested algorithm: the primary column's `sortAlgorithm`, else the table's.
      const primary = entries[0] as (typeof entries)[number]
      const colAlgorithm =
        primary.col && (primary.col.def as { sortAlgorithm?: unknown }).sortAlgorithm
      const fromColumn = colAlgorithm !== undefined
      let requested = (fromColumn ? colAlgorithm : (opts.algorithm ?? 'auto')) as SortAlgorithm
      const noEffect = (reason: string) =>
        ctx.emit(
          'DK_OPTION_NO_EFFECT',
          fromColumn
            ? { path: `columns[${primary.col?.index}].sortAlgorithm`, reason, once: false }
            : { path: 'algorithm', feature: 'sorting', reason, once: false },
        )
      if (
        typeof requested !== 'function' &&
        !(ALGORITHMS as readonly unknown[]).includes(requested)
      ) {
        noEffect(
          `${JSON.stringify(requested)} is not a sort algorithm (accepted: ${ALGORITHMS.join(', ')}, ` +
            'or a function); auto was used',
        )
        requested = 'auto'
      }
      if (requested !== 'native' && exsorted === undefined) {
        exsorted = detectCapability(
          hasExsorted,
          {
            feature: 'sorting',
            dependency: 'exsorted',
            capability: 'timSort / mergeSort / radixSort / countingSort',
            supported: '^1.2.3',
            fallback: 'Array.prototype.sort (native, stable)',
          },
          ctx.emit,
        )
      }

      const build = (): IndexComparator => {
        const cmps = entries.map((e, k) => {
          const fn = e.sortFn
          if (!fn) return defaultIndexComparator(e.values, e.desc, getCollator())
          const guarded: SortFn = (a, b) => {
            try {
              return fn(a, b)
            } catch (error) {
              throw new SortFnFailed(k, error)
            }
          }
          return sortFnIndexComparator(e.values, e.desc, guarded)
        })
        if (cmps.length === 1) return cmps[0] as IndexComparator
        return (a, b) => {
          for (let k = 0; k < cmps.length; k++) {
            const c = (cmps[k] as IndexComparator)(a, b)
            if (c !== 0) return c
          }
          return 0
        }
      }

      let algorithm: string = 'native'
      let reason = ''
      /** One attempt; a throwing sortFn propagates as SortFnFailed (the loop below retries). */
      const sortOnce = (): Uint32Array => {
        const want = requested
        if (typeof want === 'function') {
          const custom = want as CustomAlgorithm
          let res: unknown
          try {
            res = custom(indices.slice(), build())
          } catch (error) {
            if (error instanceof SortFnFailed) throw error
            reportCustom(true, error)
            return native('the custom algorithm threw')
          }
          if (res instanceof Uint32Array && res.length === indices.length) {
            algorithm = 'custom'
            reason = fromColumn ? 'column sortAlgorithm' : 'sorting({ algorithm })'
            return res
          }
          reportCustom(false, res)
          return native('the custom algorithm returned a bad value')
        }
        if (exsorted === false) return native('exsorted unavailable')
        const by = fromColumn ? 'column sortAlgorithm' : 'sorting({ algorithm })'
        // Integer keys: a single column with the default comparator (§6.4).
        const single = entries.length === 1 && !primary.sortFn
        const keys =
          single && want !== 'native' ? intKeys(primary.values, indices, primary.desc) : undefined
        if (want !== 'auto' && want !== 'native') {
          if (keys) {
            try {
              const out = sortIntKeys(keys, want)
              algorithm = want
              reason = `${by}, safe-integer keys`
              return out
            } catch {
              noEffect(
                `exsorted ${want}Sort could not sort these keys` +
                  (want === 'counting' ? ' (key range above 1,000,000)' : '') +
                  '; auto was used',
              )
            }
          } else if (needsIntKeys(want)) {
            noEffect(
              `${want} sorts a single column of safe integer keys (numbers or Dates, no sortFn); ` +
                'auto was used',
            )
          } else {
            algorithm = want
            reason = by
            return sortWithComparator(indices, build(), want as 'tim' | 'merge')
          }
        } else if (want === 'native') return native(by)
        if (!keys) {
          return native(
            single
              ? 'keys are not all safe integers'
              : entries.length > 1
                ? 'multi-column'
                : 'custom sortFn',
          )
        }
        const choice = chooseAuto(keys)
        algorithm = choice.algorithm
        reason = `auto: ${choice.reason}`
        return sortIntKeys(keys, choice.algorithm)
      }
      const native = (why: string) => {
        algorithm = 'native'
        reason = why
        return sortWithComparator(indices, build(), 'native')
      }
      /** A custom algorithm threw (`threw`, `value` = the error) or returned a bad `value`. */
      const reportCustom = (threw: boolean, value: unknown) => {
        const slot = fromColumn
          ? `columns[${primary.col?.index}].sortAlgorithm`
          : 'sorting.algorithm'
        const fallback = 'the rows were sorted with the native algorithm'
        if (!threw) {
          // The slot contract check is dev only (§3.4 slotContract); the fallback applies always.
          if (DEV) {
            ctx.emit('DK_CALLBACK_BAD_RETURN', {
              slot,
              expected: `a Uint32Array of ${indices.length} row indices`,
              received: describeReturn(value),
              count: 1,
              fallback,
            })
          }
          return
        }
        const name = errorName(value)
        ctx.emit(
          'DK_CALLBACK_FAILED',
          {
            slot,
            count: 1,
            fallback,
            ...(name === undefined ? {} : { errorName: name }),
          },
          { cause: value },
        )
      }

      // At most one retry per entry: each failing sortFn falls back to the default comparator.
      for (;;) {
        try {
          const out = sortOnce()
          if (opts.debug) {
            ctx.emit('DK_SORT_STRATEGY', {
              algorithm,
              reason,
              n: indices.length,
              ms: now() - t0,
              by: by.map((e) => `${String(e.id)}:${e.desc ? 'desc' : 'asc'}`),
              ...(primary.col ? { column: { index: primary.col.index, id: primary.col.id } } : {}),
            })
          }
          return out
        } catch (e) {
          if (!(e instanceof SortFnFailed)) throw e
          const entry = entries[e.entry] as (typeof entries)[number]
          entry.sortFn = undefined
          const col = entry.col as ResolvedColumn
          const name = errorName(e.error)
          ctx.emit(
            'DK_CALLBACK_FAILED',
            {
              slot: `columns[${col.index}].sortFn`,
              column: col.id,
              count: 1,
              fallback: 'the column was sorted with the default comparator',
              ...(name === undefined ? {} : { errorName: name }),
            },
            { cause: e.error },
          )
        }
      }
    },
  })
}
