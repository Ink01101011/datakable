import { suggest } from '../catalog/suggest'
import type { Emit } from '../diagnostics/types'
import { type ResolvedColumn, resolveColumns } from '../pipeline/columns'
import { dataCheckDiagnostics } from './data-check-codes'
import { forSampledRows, INGEST_SAMPLE } from './derive-columns'

void dataCheckDiagnostics

/** Sample row indices kept per diagnostic. */
const MAX_ROWS = 5
/** Differing keys listed by DK_INCONSISTENT_ROW_SHAPE. */
const MAX_KEYS = 10
/** Did-you-mean candidates: path depth (§4.1 caps `Path<T>` at 4) and count. */
const MAX_DEPTH = 4
const MAX_CANDIDATES = 1000

const PRESENT = 0
const ABSENT = 1

const isRecord = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === 'object' && !Array.isArray(v) && !(v instanceof Date)

/**
 * Whether `path` exists in `row`, like `getValue` reads it: a missing key or a primitive / function
 * part-way is absent; a `null` / `undefined` part-way is present (nullable paths, §4.1). Reads only
 * the intermediate values (the last segment is tested with `in`). May throw (getter, Proxy trap).
 */
function probe(row: object, segs: readonly string[]): number {
  let cur: unknown = row
  for (let i = 0; i < segs.length; i++) {
    if (cur === null || cur === undefined) return PRESENT
    if (typeof cur !== 'object') return ABSENT
    const seg = segs[i] as string
    if (!(seg in cur)) return ABSENT
    if (i < segs.length - 1) cur = (cur as Record<string, unknown>)[seg]
  }
  return PRESENT
}

/** `a` and `b` differ by one swap of adjacent characters (case-insensitive). */
function isTransposition(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let i = 0
  while (i < a.length && a[i] === b[i]) i++
  return (
    i < a.length - 1 && a[i] === b[i + 1] && a[i + 1] === b[i] && a.slice(i + 2) === b.slice(i + 2)
  )
}

/**
 * Did-you-mean for a column path: `suggest` (Levenshtein) plus adjacent transpositions, which
 * Levenshtein counts as 2 edits and so misses in short names (`nmae` → `name`). Transpositions
 * come first.
 */
function suggestPath(path: string, candidates: Set<string>): string[] {
  const p = path.toLowerCase()
  const out: string[] = []
  for (const c of candidates) if (isTransposition(p, c.toLowerCase())) out.push(c)
  for (const c of suggest(path, candidates)) if (!out.includes(c)) out.push(c)
  return out
}

/** The dot-paths of the sampled rows (depth ≤ 4; arrays, `Date`, functions are leaves). */
function candidatePaths(data: readonly unknown[], sample: number): Set<string> {
  const out = new Set<string>()
  const walk = (obj: Record<string, unknown>, prefix: string, depth: number) => {
    for (const k of Object.keys(obj)) {
      if (out.size >= MAX_CANDIDATES) return
      const p = prefix + k
      out.add(p)
      if (depth < MAX_DEPTH) {
        const v = obj[k]
        if (isRecord(v)) walk(v, `${p}.`, depth + 1)
      }
    }
  }
  // An unreadable row is skipped part-way (forSampledRows catches).
  forSampledRows(data, sample, (row) => walk(row, '', 1))
  return out
}

export interface DataChecks {
  /**
   * Runs the §5.3 checks for `data` against `columns` (explicit columns: path checks; omitted:
   * shape check). Memoised on both references; reads only the first rows. Never throws.
   */
  check(data: readonly unknown[], columns: readonly unknown[] | undefined): void
}

/**
 * The ingest data checks (§5.3): `DK_COLUMN_PATH_NOT_FOUND` (with did-you-mean),
 * `DK_COLUMN_PATH_PARTIAL` and, for zero-config tables, `DK_INCONSISTENT_ROW_SHAPE`. Every check
 * reads only the first `sample` rows, so the cost does not grow with the data.
 */
export function createDataChecks(emit: Emit, sample: number = INGEST_SAMPLE): DataChecks {
  let lastData: readonly unknown[] | undefined
  let lastColumns: readonly unknown[] | undefined

  function checkPaths(data: readonly unknown[], columns: readonly unknown[]) {
    let candidates: Set<string> | undefined
    for (const col of resolveColumns(columns).list) {
      if (!col.path) continue
      checkPath(data, col, () => {
        candidates ??= candidatePaths(data, sample)
        return candidates
      })
    }
  }

  function checkPath(data: readonly unknown[], col: ResolvedColumn, paths: () => Set<string>) {
    const segs = col.path as readonly string[]
    let sampled = 0
    let count = 0
    const rows: number[] = []
    // A row whose probe throws is not counted (forSampledRows skips it).
    forSampledRows(data, sample, (row, index) => {
      const r = probe(row, segs)
      sampled++
      if (r === ABSENT) {
        count++
        if (rows.length < MAX_ROWS) rows.push(index)
      }
    })
    if (count === 0) return
    if (count === sampled) {
      const suggestions = suggestPath(col.id, paths())
      emit('DK_COLUMN_PATH_NOT_FOUND', { column: col.id, index: col.index, sampled, suggestions })
    } else {
      emit('DK_COLUMN_PATH_PARTIAL', { column: col.id, index: col.index, sampled, count, rows })
    }
  }

  function checkShape(data: readonly unknown[]) {
    const rowKeys: { index: number; keys: string[] }[] = []
    const present = new Map<string, number>()
    forSampledRows(data, sample, (row, index) => {
      const keys = Object.keys(row)
      rowKeys.push({ index, keys })
      for (const k of keys) present.set(k, (present.get(k) ?? 0) + 1)
    })
    const sampled = rowKeys.length
    const differing: { key: string; missing: number }[] = []
    for (const [key, n] of present) if (n < sampled) differing.push({ key, missing: sampled - n })
    if (differing.length === 0) return
    const rows: number[] = []
    let rowCount = 0
    for (const r of rowKeys) {
      if (r.keys.length === present.size) continue
      rowCount++
      if (rows.length < MAX_ROWS) rows.push(r.index)
    }
    emit('DK_INCONSISTENT_ROW_SHAPE', {
      sampled,
      keys: differing.slice(0, MAX_KEYS),
      keyCount: differing.length,
      rows,
      rowCount,
    })
  }

  return {
    check(data, columns) {
      if (data === lastData && columns === lastColumns) return
      lastData = data
      lastColumns = columns
      if (data.length === 0) return
      if (columns) checkPaths(data, columns)
      else checkShape(data)
    },
  }
}
