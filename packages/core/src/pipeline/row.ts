/** A row identity: the `rowKey` value, or the fallback (§5.2). */
export type RowKey = string | number

/** A validation issue of a row (Standard Schema v1 issue shape, §5.1). */
export interface RowIssue {
  readonly message: string
  readonly path?: readonly (PropertyKey | { readonly key: PropertyKey })[] | undefined
}

/** What a {@link Row} reads its cells through (internal; one per `columns` reference). */
export interface RowSource {
  value(index: number, original: unknown, id: string): unknown
  /** Schema issues of a flagged row (`invalidRows: 'flag'`); `undefined` for a valid row. */
  issues(index: number): readonly RowIssue[] | undefined
  /** The issues of a flagged row that touch column `id` (`matchCellIssues`). */
  cellIssues(issues: readonly RowIssue[], id: string): readonly RowIssue[]
}

export const NO_ISSUES: readonly RowIssue[] = Object.freeze([])

/**
 * One visible row (§6.6). Created only for the rows `getRowModel()` returns, never for the whole
 * data set (§9.1), and only when read ({@link lazyRows}); the methods live on the prototype, so a
 * row costs its four fields.
 */
export class Row<T = unknown> {
  /** The row's `rowKey` value (the row index without `rowKey`). */
  readonly key: RowKey
  /** Position in the ingested data. */
  readonly index: number
  /** The row object as passed in `data`. */
  readonly original: T
  readonly #source: RowSource

  /** @internal Rows are created by the pipeline. */
  constructor(source: RowSource, index: number, key: RowKey, original: T) {
    this.key = key
    this.index = index
    this.original = original
    this.#source = source
  }

  /** `false` for a row flagged by schema validation (`invalidRows: 'flag'`). */
  get valid(): boolean {
    return this.#source.issues(this.index) === undefined
  }

  /** The row's schema issues (empty for a valid row). */
  get issues(): readonly RowIssue[] {
    return this.#source.issues(this.index) ?? NO_ISSUES
  }

  /**
   * The value of column `id` for this row (`key` path or `accessor`); `undefined` for an unknown
   * column. Never throws: a throwing accessor reports `DK_CALLBACK_FAILED` and reads `undefined`.
   */
  getValue(id: string): unknown {
    return this.#source.value(this.index, this.original, id)
  }

  /**
   * The schema issues whose path points into column `id`, matched segment by segment: the issue
   * path equals the column key, or one contains the other (`address` ↔ `address.city`, never
   * `addressLine`). Row-level issues (no path) count for every cell; accessor columns have no key,
   * so they get only those. Empty for a valid row or an unknown column.
   */
  getCellIssues(id: string): readonly RowIssue[] {
    const issues = this.#source.issues(this.index)
    return issues === undefined ? NO_ISSUES : this.#source.cellIssues(issues, id)
  }
}

/** A valid row under `invalidRows: 'flag'`: `original` is the schema output. */
export type ValidRow<T> = Row<T> & { readonly valid: true }

/** A flagged row (`invalidRows: 'flag'`): `original` is the raw, unvalidated value. */
export type FlaggedInvalidRow = Row<unknown> & { readonly valid: false }

/** `getRowModel().rows` under `invalidRows: 'flag'` (§5.1): narrow on `row.valid`. */
export type FlaggedRow<T> = ValidRow<T> | FlaggedInvalidRow

/** `p` as an index below `length` (a canonical array index string), else `-1`. */
function indexOf(p: string | symbol, length: number): number {
  if (typeof p !== 'string') return -1
  const i = Number(p)
  return Number.isInteger(i) && i >= 0 && i < length && String(i) === p ? i : -1
}

/**
 * `RowModel.rows` without a `Row` per visible row up front (§9.3 memory: 90k rows unpaginated): a
 * real array (`Array.isArray`, `length`, index reads, iteration, every array method) over a sparse
 * target that builds row `i` with `make(i)` the first time it is read and keeps it, so identity is
 * stable. `Object.keys` / `ownKeys` build every row first.
 */
export function lazyRows<R>(length: number, make: (i: number) => R): R[] {
  const target: R[] = []
  target.length = length
  let complete = length === 0
  const fill = () => {
    if (complete) return
    for (let i = 0; i < length; i++) if (!(i in target)) target[i] = make(i)
    complete = true
  }
  return new Proxy(target, {
    get(t, p, receiver) {
      const v = Reflect.get(t, p, receiver)
      if (v !== undefined || complete) return v
      const i = indexOf(p, length)
      if (i < 0 || i in t) return v
      const row = make(i)
      t[i] = row
      return row
    },
    has: (t, p) => Reflect.has(t, p) || indexOf(p, length) >= 0,
    getOwnPropertyDescriptor(t, p) {
      const i = indexOf(p, length)
      if (i >= 0 && !(i in t)) t[i] = make(i)
      return Reflect.getOwnPropertyDescriptor(t, p)
    },
    ownKeys(t) {
      fill()
      return Reflect.ownKeys(t)
    },
  })
}
