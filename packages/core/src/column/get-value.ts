/** A dot-path split into its segments once, for repeated per-cell walks. */
export type CompiledPath = readonly string[]

/** Splits a dot-path (`'address.geo.lat'`) into segments. Call once per column, not per cell. */
export function compilePath(path: string): CompiledPath {
  return path.split('.')
}

/**
 * Reads the value at `path` of `row`, defensively (§4.3): a `null`, `undefined` or non-object
 * (primitive, function) part-way through yields `undefined`. Arrays are walked by index. An
 * inherited method or `__proto__` (`constructor`, `toString`, `map`) yields `undefined`. Never
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
      const seg = segs[i] as string
      const next = (cur as Record<string, unknown>)[seg]
      // Inherited methods and `__proto__` (`constructor`, `toString`) are not row data (#42);
      // checked only for function values, so plain data and class getters cost nothing more.
      if ((typeof next === 'function' || seg === '__proto__') && !Object.hasOwn(cur, seg)) {
        return undefined
      }
      cur = next
    }
  } catch (error) {
    // The column cache (pipeline/column-cache.ts) passes onError and reports DK_CALLBACK_FAILED
    // once per column batch with the failing row indices (no per-cell emit).
    onError?.(error)
    return undefined
  }
  return cur
}
