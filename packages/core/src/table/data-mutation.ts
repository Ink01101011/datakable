import { defineDiagnostic } from '../diagnostics/catalog'
import { DEV } from '../diagnostics/env'
import type { Emit } from '../diagnostics/types'

/**
 * `DK_DATA_MUTATED` (§5.3, dev): `options.data` passed again as the same array, but its contents
 * changed since it was ingested. DataKable re-reads data only on a new reference, so the table would
 * silently keep showing the old rows. Dev only: the definition, its text and the check sit behind
 * `DEV`, so a production bundle has none of it.
 */

declare module '../diagnostics/catalog' {
  interface DiagnosticCatalog {
    DK_DATA_MUTATED: {
      /** `data.length` when it was ingested, and now. */
      previousLength: number
      length: number
      /** Sampled row indices whose row was replaced or changed in place (empty: length changed). */
      rows: readonly number[]
    }
  }
}

export const dataMutationDiagnostics = DEV
  ? [
      defineDiagnostic({
        code: 'DK_DATA_MUTATED',
        level: 'warn',
        where: () => ({ kind: 'option', path: 'data' }),
        problem: (d) =>
          'options.data is the same array as before, but its contents changed' +
          (d.previousLength === d.length
            ? ` (rows ${d.rows.map((r) => `#${r}`).join(', ')} changed in place)`
            : ` (length ${d.previousLength} → ${d.length})`),
        impact: () =>
          'the table still shows the previous contents: data is re-read only when the array ' +
          'reference changes',
        fix: () => [
          'pass a new array instead of mutating it: setOptions({ data: [...data, row] }); in React, ' +
            'update state immutably: setRows((rows) => [...rows, row])',
          'to change one row, replace it: rows.map((r) => (r.id === id ? { ...r, ...patch } : r))',
        ],
      }),
    ]
  : []

/** At most this many rows are sampled, and this many own keys per row. */
const ROWS = 16
const KEYS = 64

export interface DataPrint {
  readonly length: number
  /** Sampled row positions. */
  readonly rows: readonly number[]
  /** Per sampled row: the row itself (identity) and a shallow hash of its own values. */
  readonly refs: readonly unknown[]
  readonly hashes: readonly number[]
}

const fnv = (h: number, s: string) => {
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193)
  return h
}

/** Shallow hash of a row: its first {@link KEYS} own keys and their primitive values (or types). */
function rowHash(row: unknown): number {
  let h = 0x811c9dc5
  if (row === null || typeof row !== 'object') return fnv(h, `${typeof row}:${String(row)}`) >>> 0
  try {
    let k = 0
    for (const key in row) {
      if (!Object.hasOwn(row, key)) continue
      if (k++ === KEYS) break
      const v = (row as Record<string, unknown>)[key]
      h = fnv(h, key)
      h = fnv(h, v !== null && typeof v === 'object' ? 'object' : `${typeof v}:${String(v)}`)
    }
  } catch {
    // A throwing getter / Proxy trap: the row is compared by identity only.
  }
  return h >>> 0
}

/** A bounded fingerprint of `data`: its length and {@link ROWS} evenly spaced rows (row 0 always). */
export function dataPrint(data: readonly unknown[]): DataPrint {
  const n = data.length
  const stride = n <= ROWS ? 1 : Math.floor(n / ROWS)
  const rows: number[] = []
  const refs: unknown[] = []
  const hashes: number[] = []
  for (let i = 0; i < n && rows.length < ROWS; i += stride) {
    rows.push(i)
    refs.push(data[i])
    hashes.push(rowHash(data[i]))
  }
  return { length: n, rows, refs, hashes }
}

/** `'length'` when the length changed, else the sampled row indices that changed (empty: same). */
export function diffPrint(print: DataPrint, data: readonly unknown[]): 'length' | number[] {
  if (data.length !== print.length) return 'length'
  const changed: number[] = []
  for (let i = 0; i < print.rows.length; i++) {
    const r = print.rows[i] as number
    const row = data[r]
    if (row !== print.refs[i] || rowHash(row) !== print.hashes[i]) changed.push(r)
  }
  return changed
}

/**
 * A dev check must never change what the table does: rows that cannot be read (a throwing Proxy or
 * getter) leave the check off, and the pipeline reports them as usual.
 */
function safePrint(data: readonly unknown[]): DataPrint | undefined {
  try {
    return dataPrint(data)
  } catch {
    return undefined
  }
}

/** Remembers the ingested `data` and reports `DK_DATA_MUTATED` when the same array comes back changed. */
export function createDataMutationCheck(emit: Emit) {
  let print: DataPrint | undefined
  return {
    /** `options.data` was ingested. */
    remember(data: readonly unknown[] | undefined) {
      print = data === undefined ? undefined : safePrint(data)
    },
    /** `options.data` was passed again with the same reference. */
    check(data: readonly unknown[] | undefined) {
      if (!print || data === undefined) return
      let diff: 'length' | number[]
      try {
        diff = diffPrint(print, data)
      } catch {
        return
      }
      if (diff !== 'length' && diff.length === 0) return
      emit('DK_DATA_MUTATED', {
        previousLength: print.length,
        length: data.length,
        rows: diff === 'length' ? [] : diff,
      })
      // Compare later calls with what was last seen: each further change reports again.
      print = safePrint(data)
    },
  }
}
