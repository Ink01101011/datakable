/**
 * Formats one scalar. Returns `undefined` when the value cannot be rendered (object, function,
 * array): the caller decides how to report it.
 */
function formatScalar(value: unknown): string | undefined {
  if (value === null || value === undefined) return ''
  const type = typeof value
  if (type === 'object') {
    if (value instanceof Date) {
      return Number.isNaN(value.getTime()) ? '' : value.toLocaleString()
    }
    return undefined
  }
  if (type === 'function') return undefined
  return String(value)
}

/**
 * The default cell formatter (§4.3), used when a column has neither `cell` nor `format`:
 *
 * - `null` / `undefined` → `''`
 * - primitives → `String(v)`
 * - valid `Date` → `toLocaleString()` (an invalid `Date` → `''`)
 * - array of primitives / `Date`s → elements formatted as above, joined with `', '`
 * - object, function, or an array containing one → `''`, and `onUnrenderable(value)` is called
 *
 * Never throws.
 */
export function defaultFormat(value: unknown, onUnrenderable?: (value: unknown) => void): string {
  let s: string | undefined
  try {
    s = formatValue(value)
  } catch {
    // A revoked Proxy, a throwing trap or array getter: unreadable, so unrenderable.
    s = undefined
  }
  return s === undefined ? unrenderable(value, onUnrenderable) : s
}

/** `undefined` when the value (or any array element) cannot be rendered. */
function formatValue(value: unknown): string | undefined {
  if (!Array.isArray(value)) return formatScalar(value)
  let out = ''
  for (let i = 0; i < value.length; i++) {
    const s = formatScalar(value[i])
    if (s === undefined) return undefined
    out = i === 0 ? s : `${out}, ${s}`
  }
  return out
}

function unrenderable(value: unknown, onUnrenderable?: (value: unknown) => void): string {
  // TODO(T09): define DK_UNRENDERABLE_VALUE (warn) and emit it from the column:batch loop, once per
  // column per run with a column `where`; callers report via onUnrenderable.
  onUnrenderable?.(value)
  return ''
}
