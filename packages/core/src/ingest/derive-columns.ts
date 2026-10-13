/** Rows read by the ingest checks and zero-config derivation (§4.1: "first N rows, default 50"). */
export const INGEST_SAMPLE = 50

/** A derived (zero-config) column: a top-level key. */
export interface DerivedColumn {
  readonly key: string
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === 'object' && !Array.isArray(v)

/**
 * Calls `visit(row, index)` for each object row among the first `sample` rows. Never throws: a row
 * whose read or visit throws (a Proxy over the array or the row, a throwing getter) is skipped.
 */
export function forSampledRows(
  data: readonly unknown[],
  sample: number,
  visit: (row: Record<string, unknown>, index: number) => void,
): void {
  let n: number
  try {
    n = Math.min(data.length, sample)
  } catch {
    return
  }
  for (let i = 0; i < n; i++) {
    try {
      const row = data[i]
      if (isRecord(row)) visit(row, i)
    } catch {
      // Unreadable: skipped (the pipeline reports reads it depends on).
    }
  }
}

/**
 * Zero-config columns (§4.1): the union of the own enumerable top-level keys over the first
 * `sample` object rows, in first-seen order. A key whose value is a function in any sampled row is
 * skipped; so is a key containing `.` (a column key is a dot-path, so it cannot address it). Rows
 * whose keys cannot be read (a throwing Proxy trap) are skipped; a throwing getter skips that key's
 * function test only. Never throws.
 */
export function deriveColumns(
  data: readonly unknown[],
  sample: number = INGEST_SAMPLE,
): DerivedColumn[] {
  const seen = new Set<string>()
  const fns = new Set<string>()
  forSampledRows(data, sample, (row) => {
    for (const k of Object.keys(row)) {
      if (k.includes('.')) continue
      seen.add(k)
      try {
        if (typeof row[k] === 'function') fns.add(k)
      } catch {
        // An unreadable value is kept as a column; the column cache reports the read failure.
      }
    }
  })
  const out: DerivedColumn[] = []
  for (const k of seen) if (!fns.has(k)) out.push({ key: k })
  return out
}

/**
 * A memoised {@link deriveColumns}: derived once per data reference, and the previous array is
 * returned while the key list is unchanged, so pipeline steps memoised on `columns` keep hitting.
 */
export function createDerivedColumns(
  sample: number = INGEST_SAMPLE,
): (data: readonly unknown[]) => readonly DerivedColumn[] {
  let lastData: readonly unknown[] | undefined
  let last: readonly DerivedColumn[] = []
  return (data) => {
    if (data === lastData) return last
    lastData = data
    const next = deriveColumns(data, sample)
    const same = next.length === last.length && next.every((c, i) => c.key === last[i]?.key)
    if (!same) last = next
    return last
  }
}
