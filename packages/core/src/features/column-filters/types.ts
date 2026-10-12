import type { FilterFor, LooseRow } from '../../column/column-def'
import type { Path, PathValue } from '../../column/path'
import type { FeatureTypes } from '../../feature/types'

/** The value a filter compares against: the element type for array-valued cells (§6.1). */
type Elem<V> = NonNullable<V> extends readonly (infer E)[] ? NonNullable<E> : NonNullable<V>

/** Inclusive bounds; an absent bound is open. */
export type RangeValue<E> = { min?: E | undefined; max?: E | undefined }

/** Strict equality (`Date`s by time value). `undefined`, `null` and `''` are inactive. */
export type EqualsFilter<E> = { type: 'equals'; value: E | null | undefined }
/** Case-insensitive, NFC-normalised substring. `undefined` and `''` are inactive. */
export type ContainsFilter = { type: 'contains'; value: string | undefined }
/** Set membership. `undefined` and `[]` are inactive. */
export type InFilter<E> = { type: 'in'; value: readonly E[] | undefined }
/** Inclusive bounds on number / bigint / `Date`. No bound given = inactive. */
export type RangeFilter<E> = { type: 'range'; value: RangeValue<E> | undefined }
/**
 * A user predicate. `fn` gets the whole (non-nullish) cell value — arrays included — the
 * filter's `value` and the row. Always active. A throw makes the row non-matching
 * (`DK_CALLBACK_FAILED`).
 */
export type CustomFilter<V, T> = {
  type: 'custom'
  value?: unknown
  fn: (value: NonNullable<V>, filterValue: unknown, row: T) => boolean
}

type ByKind<E> = {
  equals: EqualsFilter<E>
  contains: ContainsFilter
  in: InFilter<E>
  range: RangeFilter<E>
}

/**
 * The filter of one column whose value type is `V`: the kinds `FilterFor<V>` allows for that
 * column (so a column def's `filter` and its state agree), plus `custom`.
 */
export type ColumnFilter<V, T = unknown> =
  | ByKind<Elem<V>>[FilterFor<V>['type'] & keyof ByKind<unknown>]
  | CustomFilter<V, T>

/** `columnFilters` slice: one optional filter per column id, typed by the column's value. */
export type ColumnFiltersState<T> = {
  [P in Path<LooseRow<T>>]?: ColumnFilter<PathValue<LooseRow<T>, P>, LooseRow<T>>
}

export type ColumnFiltersApi<T> = {
  /** Sets the filter of column `id`; `undefined` removes it. */
  setColumnFilter<P extends Path<LooseRow<T>>>(
    id: P,
    filter: ColumnFilter<PathValue<LooseRow<T>, P>, LooseRow<T>> | undefined,
  ): void
  /** Removes every column filter. */
  resetColumnFilters(): void
}

export interface ColumnFiltersTypes extends FeatureTypes {
  state: ColumnFiltersState<this['T']>
  api: ColumnFiltersApi<this['T']>
}
