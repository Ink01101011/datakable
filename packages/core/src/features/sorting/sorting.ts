import { defineOptions } from '../../catalog/options'
import { compilePath, getValue } from '../../column/get-value'
import type { Path } from '../../column/path'
import { defineFeature } from '../../feature/define'
import type { FeatureTypes, RowModelContext } from '../../feature/types'
import { errorName } from '../../intercept/classify'
import { type ResolvedColumn, resolveColumns } from '../../pipeline/columns'
import type { ColumnValues } from '../../pipeline/types'
import { type DataMode, modeOption } from '../../source/mode'
import { defaultIndexComparator, type IndexComparator, sortFnIndexComparator } from './compare'

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

export interface SortingOptions {
  /** Locale(s) of the string collator (`Intl.Collator(locale, { numeric: true })`); default: the runtime's. */
  locale?: string | readonly string[]
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

const sortingOptions = {
  locale: {
    type: ['string', 'array'],
    check: validLocale,
    expected: 'a BCP 47 locale tag or a list of them, e.g. "th" or ["th", "en"]',
  },
  mode: modeOption,
} as const

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
 * The sort itself is native `Array.prototype.sort` semantics (stable since ES2019) on a
 * `Uint32Array` copy; the `auto` strategy over exsorted is T15.
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

  function sortByValues(ctx: RowModelContext, col: ResolvedColumn, sortBy: SortBy): unknown[] {
    const data = ctx.data
    let byDef = sortByCache.get(data)
    if (!byDef) {
      byDef = new WeakMap()
      sortByCache.set(data, byDef)
    }
    let out = byDef.get(col.def)
    if (out) return out
    out = new Array(data.length)
    let count = 0
    let first: unknown
    const rows: number[] = []
    for (let r = 0; r < data.length; r++) {
      try {
        out[r] = sortBy(data[r])
      } catch (e) {
        out[r] = undefined
        if (count === 0) first = e
        if (rows.length < 5) rows.push(r)
        count++
      }
    }
    if (count > 0) {
      const name = errorName(first)
      ctx.emit(
        'DK_CALLBACK_FAILED',
        {
          slot: `columns[${col.index}].sortBy`,
          column: col.id,
          rows,
          count,
          fallback: 'the failed rows sort as missing values (last)',
          ...(name === undefined ? {} : { errorName: name }),
        },
        { cause: first },
      )
    }
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

      // At most one retry per entry: each failing sortFn falls back to the default comparator.
      for (;;) {
        const out = indices.slice()
        try {
          out.sort(build())
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
