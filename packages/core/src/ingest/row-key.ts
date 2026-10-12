import { compilePath, getValue } from '../column/get-value'
import type { Emit } from '../diagnostics/types'
import type { RowKey } from '../pipeline/row'
import { rowKeyDiagnostics } from './row-key-codes'
import { findUniqueFields } from './unique-fields'

void rowKeyDiagnostics

/** Rows listed in a diagnostic's `rows` sample. */
const SAMPLE = 5

/** `(row, index) => key` for the rows the pipeline builds. */
export type KeyOf = (row: unknown, index: number) => RowKey

const usable = (k: unknown): k is RowKey =>
  typeof k === 'string' || (typeof k === 'number' && !Number.isNaN(k))

const THREW: unique symbol = Symbol('threw')

const typeOf = (v: unknown): string => {
  if (v === null) return 'null'
  if (Array.isArray(v)) return 'array'
  return typeof v === 'number' ? 'number(NaN)' : typeof v
}

/**
 * Resolves `rowKey` (§5.2) over **all** rows, once per (data, rowKey) reference, so keys do not
 * change with filtering, sorting or paging:
 *
 * - a repeated key: the first row keeps it, later rows get `key#1`, `key#2`, …
 *   (`DK_DUPLICATE_ROW_KEY`, whose `fix` names fields that are unique across all rows);
 * - a missing / `null` / non-string-or-number key: `#index` (`DK_MISSING_ROW_KEY`);
 * - a throwing `rowKey` function: `#index`, passed to `onThrow` (reported by the runner as
 *   `DK_CALLBACK_FAILED`, as in T09).
 *
 * Only the rows that need a fallback are remembered; the returned reader re-reads the key of the
 * (visible) rows it is asked for, so a clean data set keeps no per-row memory. Without `rowKey`,
 * the key is the row index.
 */
export function resolveRowKeys(
  data: readonly unknown[],
  rowKey: unknown,
  emit: Emit,
  onThrow: (index: number, error: unknown) => void,
): KeyOf {
  const read = keyReader(rowKey, onThrow)
  if (read === undefined) return (_row, index) => index
  const fallbacks = scan(data, rowKey, read, emit)
  return (row, index) => {
    const f = fallbacks?.get(index)
    if (f !== undefined) return f
    const k = read(row, index)
    return usable(k) ? k : `#${index}`
  }
}

type Read = (row: unknown, index: number) => unknown

function keyReader(
  rowKey: unknown,
  onThrow: (index: number, error: unknown) => void,
): Read | undefined {
  let read: Read
  if (typeof rowKey === 'function') {
    const fn = rowKey as (row: unknown) => unknown
    read = (row, index) => {
      try {
        return fn(row)
      } catch (e) {
        onThrow(index, e)
        return THREW
      }
    }
  } else if (typeof rowKey === 'string') {
    const path = compilePath(rowKey)
    let cur = 0
    let threw = false
    const onError = (e: unknown) => {
      threw = true
      onThrow(cur, e)
    }
    read = (row, index) => {
      cur = index
      const k = getValue(row, path, onError)
      if (!threw) return k
      threw = false
      return THREW
    }
  } else {
    return undefined
  }
  return read
}

/**
 * One pass over every row: returns the fallback keys (only the rows that need one) and emits the
 * key diagnostics. Kept apart from the returned reader so the scan's maps are not captured by it.
 */
function scan(
  data: readonly unknown[],
  rowKey: unknown,
  read: Read,
  emit: Emit,
): Map<number, RowKey> | undefined {
  /** Every key handed out so far (raw keys and fallbacks) → the row that holds it. */
  const taken = new Map<RowKey, number>()
  /** Repeated raw key → the next `#n` to try. */
  const suffix = new Map<RowKey, number>()
  /** Only the rows that got a fallback key. */
  let fallbacks: Map<number, RowKey> | undefined
  /** `base#n` for the first free `n ≥ from` (a fallback can collide with a real key). */
  const free = (base: RowKey, from: number): [RowKey, number] => {
    let s = from
    let k: RowKey = `${base}#${s++}`
    while (taken.has(k)) k = `${base}#${s++}`
    return [k, s]
  }

  const missing = { count: 0, rows: [] as number[], valueType: '' }
  const dup = { count: 0, key: undefined as RowKey | undefined, rows: [] as number[], shared: 0 }

  for (let i = 0; i < data.length; i++) {
    const raw = read(data[i], i)
    let key: RowKey
    if (!usable(raw)) {
      if (raw !== THREW) {
        if (missing.count === 0) missing.valueType = typeOf(raw)
        if (missing.rows.length < SAMPLE) missing.rows.push(i)
        missing.count++
      }
      key = `#${i}`
      if (taken.has(key)) key = free(key, 1)[0]
    } else if (taken.has(raw)) {
      dup.count++
      if (dup.key === undefined) {
        dup.key = raw
        dup.rows.push(taken.get(raw) as number)
        dup.shared = 1
      }
      if (raw === dup.key) {
        dup.shared++
        if (dup.rows.length < SAMPLE) dup.rows.push(i)
      }
      const [k, next] = free(raw, suffix.get(raw) ?? 1)
      suffix.set(raw, next)
      key = k
    } else {
      taken.set(raw, i)
      continue
    }
    taken.set(key, i)
    if (fallbacks === undefined) fallbacks = new Map()
    fallbacks.set(i, key)
  }

  if (dup.key !== undefined || missing.count > 0) {
    // Error path only: the fix is computed from the data (a scan per candidate field).
    const path = typeof rowKey === 'string' ? rowKey : undefined
    const at = path === undefined ? {} : { path }
    if (dup.key !== undefined) {
      const found = findUniqueFields(data, path)
      emit('DK_DUPLICATE_ROW_KEY', {
        ...at,
        key: dup.key,
        rows: dup.rows,
        shared: dup.shared,
        count: dup.count,
        groups: suffix.size,
        total: data.length,
        unique: found.unique,
        ...(found.pair === undefined ? {} : { pair: found.pair }),
      })
    }
    if (missing.count > 0) {
      emit('DK_MISSING_ROW_KEY', {
        ...at,
        rows: missing.rows,
        count: missing.count,
        total: data.length,
        valueType: missing.valueType,
        unique: findUniqueFields(data, path, undefined).unique,
      })
    }
  }

  return fallbacks
}
