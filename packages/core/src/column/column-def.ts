import type { IsAny, Path, PathValue, Primitive } from './path'

/** Whole-row `any` is treated as `Record<string, unknown>` (spec §4.2); other rows pass through. */
export type LooseRow<T> = IsAny<T> extends true ? Record<string, unknown> : T

/** `true` for `any` and `unknown`: values whose shape is not known at compile time. */
type IsLoose<V> = IsAny<V> extends true ? true : unknown extends V ? true : false

/** Type-agnostic filter kinds, the only ones allowed for `any` / `unknown` values. */
type LooseFilter = { type: 'equals' } | { type: 'contains' }

/** Filter kinds allowed for a column whose value type is `V` (spec §4.1, §6.1). */
export type FilterFor<V> =
  IsLoose<V> extends true
    ? LooseFilter
    : NonNullable<V> extends number | bigint | Date
      ? { type: 'range' } | { type: 'equals' } | { type: 'in' }
      : NonNullable<V> extends string
        ? { type: 'equals' } | { type: 'in' } | { type: 'contains' }
        : NonNullable<V> extends boolean
          ? { type: 'equals' }
          : never

/** Values the default formatter can render: primitives, `Date`, arrays of those. */
type Displayable = Primitive | readonly Primitive[]

/** Argument of a column's `cell` renderer. */
export type CellContext<T, V> = { row: T; value: V }

/** Argument of a column's `invalidCell` renderer. Refined with the `invalidRows: 'flag'` work. */
export type InvalidCellContext = { original: unknown; value: unknown }

/** Built-in sort algorithms, or a custom one over row indices (spec §6.4). */
export type SortAlgorithm =
  | 'auto'
  | 'tim'
  | 'radix'
  | 'counting'
  | 'merge'
  | 'native'
  | ((indices: Uint32Array, compare: (a: number, b: number) => number) => Uint32Array)

/** Fields shared by every column whose value type is `V`. */
type BaseColumn<T, V, R> = {
  header?: string
  /** Search weight; omit to exclude the column from search. */
  search?: number
  sortable?: boolean
  sortFn?: (a: V, b: V) => number
  sortBy?: (row: T) => Primitive
  sortAlgorithm?: SortAlgorithm
  filter?: FilterFor<V>
  /** Never logged by diagnostics at any level. */
  sensitive?: boolean
  invalidCell?: (ctx: InvalidCellContext) => R
  /**
   * Renders the cell. Required (or `format`) when the value is an object, a function or an
   * array of objects — the default formatter cannot display those.
   */
  cell?: (ctx: CellContext<T, V>) => R
  /**
   * Formats the value to a string. Required (or `cell`) when the value is an object, a function
   * or an array of objects — the default formatter cannot display those.
   */
  format?: (value: V) => string
}

/**
 * Rendering requirement for value `V`: objects, functions and arrays of objects MUST give `cell`
 * or `format`. Primitives, `Date`, arrays of primitives, `unknown` and `any` need neither.
 */
export type RenderReq<T, V, R> =
  IsLoose<V> extends true
    ? BaseColumn<T, V, R>
    : [NonNullable<V>] extends [Displayable]
      ? BaseColumn<T, V, R>
      : BaseColumn<T, V, R> &
          ({ cell: (ctx: CellContext<T, V>) => R } | { format: (value: V) => string })

/** A column bound to a dot-path of `T`; a distributive union over every path. */
export type KeyColumn<T, R> = {
  [P in Path<T>]: { key: P } & RenderReq<T, PathValue<T, P>, R>
}[Path<T>]

/** A derived column: `accessor` computes the value from the (contextually typed) row. */
export type AccessorColumn<T, R> = {
  id: string
  accessor: (row: T) => unknown
  key?: never
} & BaseColumn<T, unknown, R>

/**
 * One column of a table over rows `T`. `R` is the `cell` render result (`unknown` in core,
 * `ReactNode` in `@datakable/react`). Whole-row `any` is treated as `Record<string, unknown>`.
 */
export type ColumnDef<T, R = unknown> = KeyColumn<LooseRow<T>, R> | AccessorColumn<LooseRow<T>, R>
