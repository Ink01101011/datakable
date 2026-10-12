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
  /** The issues of a flagged row whose path points into column `id` (a key column). */
  cellIssues(issues: readonly RowIssue[], id: string): readonly RowIssue[]
}

const NO_ISSUES: readonly RowIssue[] = Object.freeze([])

/**
 * One visible row (§6.6). Created only for the rows `getRowModel()` returns, never for the whole
 * data set (§9.1); the methods live on the prototype, so a row costs its four fields.
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
   * The schema issues whose path points into column `id`: the issue path equals the column key, or
   * one contains the other (`address` ↔ `address.city`); row-level issues (no path) count for every
   * cell. Accessor columns have no path, so no cell issues.
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
