import { type CompiledPath, compilePath, getValue } from '../column/get-value'

/** Depth cap of a candidate path (as `Path<T>`, §4.1). */
const MAX_DEPTH = 4
/** Bound on the candidates checked (each is one pass over the data). */
const MAX_CANDIDATES = 64
/** Unique fields reported in a `fix`. */
const MAX_UNIQUE = 3

export interface UniqueFields {
  /** Paths whose value is a string / number in every row, never repeated (row-0 order). */
  unique: string[]
  /** With no unique field: a field `f` for which `${row.<rowKey>}-${row.<f>}` is unique. */
  pair?: string
}

const isKey = (v: unknown): v is string | number =>
  typeof v === 'string' || (typeof v === 'number' && !Number.isNaN(v))

const isPlain = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v) && !(v instanceof Date)

/**
 * Primitive leaf paths of `row` (depth ≤ 4; arrays and Dates are not walked). A field must be in
 * every row to be unique, so row 0's paths are the only candidates.
 */
function candidates(row: unknown, skip: string | undefined): string[] {
  const out: string[] = []
  const walk = (obj: Record<string, unknown>, prefix: string, depth: number) => {
    for (const k of Object.keys(obj)) {
      if (out.length >= MAX_CANDIDATES) return
      const path = prefix ? `${prefix}.${k}` : k
      let v: unknown
      try {
        v = obj[k]
      } catch {
        continue
      }
      if (isKey(v)) {
        if (path !== skip) out.push(path)
      } else if (isPlain(v) && depth < MAX_DEPTH) walk(v, path, depth + 1)
    }
  }
  if (isPlain(row)) walk(row, '', 1)
  return out
}

/** `true` when `keyAt(i)` is a usable key for every row and never repeats. */
function allDistinct(n: number, keyAt: (i: number) => unknown): boolean {
  const seen = new Set<unknown>()
  for (let i = 0; i < n; i++) {
    const v = keyAt(i)
    if (!isKey(v) || seen.has(v)) return false
    seen.add(v)
  }
  return true
}

/**
 * The fields that would make a good `rowKey`, computed by scanning every row (§5.2: the `fix` of
 * `DK_DUPLICATE_ROW_KEY` / `DK_MISSING_ROW_KEY`). Runs only when a key problem was found. With
 * `pairWith` (the `rowKey` path) and no unique field, also looks for a composite key, checked with
 * exactly the string the suggested `(row) => \`${row.a}-${row.b}\`` builds.
 */
export function findUniqueFields(
  data: readonly unknown[],
  rowKeyPath: string | undefined,
  pairWith = rowKeyPath,
): UniqueFields {
  if (data.length === 0) return { unique: [] }
  const paths = candidates(data[0], rowKeyPath)
  const compiled = paths.map(compilePath)
  const at = (path: CompiledPath) => (i: number) => getValue(data[i], path)
  const unique: string[] = []
  for (let c = 0; c < paths.length && unique.length < MAX_UNIQUE; c++) {
    if (allDistinct(data.length, at(compiled[c] as CompiledPath))) unique.push(paths[c] as string)
  }
  if (unique.length > 0 || pairWith === undefined) return { unique }
  const key = at(compilePath(pairWith))
  for (let c = 0; c < paths.length; c++) {
    const other = at(compiled[c] as CompiledPath)
    const ok = allDistinct(data.length, (i) => {
      const a = key(i)
      const b = other(i)
      return isKey(a) && isKey(b) ? `${a}-${b}` : undefined
    })
    if (ok) return { unique, pair: paths[c] as string }
  }
  return { unique }
}
