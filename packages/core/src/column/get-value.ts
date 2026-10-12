/** A dot-path split into its segments once, for repeated per-cell walks. */
export type CompiledPath = readonly string[]

/** Splits a dot-path (`'address.geo.lat'`) into segments. Call once per column, not per cell. */
export function compilePath(path: string): CompiledPath {
  return path.split('.')
}

/**
 * Reads the value at `path` of `row`, defensively (§4.3): a `null`, `undefined` or non-object
 * (primitive, function) part-way through yields `undefined`. Arrays are walked by index. Never
 * throws: a throwing getter or Proxy trap yields `undefined` and is passed to `onError`.
 *
 * Hot paths should pass a {@link compilePath} result so the walk allocates nothing per cell.
 */
export function getValue(
  row: unknown,
  path: string | CompiledPath,
  onError?: (error: unknown) => void,
): unknown {
  const segs = typeof path === 'string' ? compilePath(path) : path
  let cur: unknown = row
  try {
    for (let i = 0; i < segs.length; i++) {
      if (cur === null || typeof cur !== 'object') return undefined
      cur = (cur as Record<string, unknown>)[segs[i] as string]
    }
  } catch (error) {
    // TODO(T06/T09): T06 defines DK_CALLBACK_FAILED; T09's column:batch loop passes onError and
    // emits it once per column per run with the failing row indices (no per-cell emit).
    onError?.(error)
    return undefined
  }
  return cur
}
