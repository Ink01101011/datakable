const MAX_DEPTH = 20

/**
 * Converts any value into something `JSON.stringify` cannot throw on (§8.1 `toJSON`): bigint →
 * `"10n"`, cycles → `"[Circular]"` (shared non-cyclic refs are kept), Errors → name/message/cause,
 * Map/Set → arrays, typed arrays → a size summary, functions/symbols → a label.
 */
export function toSafeJson(value: unknown): unknown {
  return walk(value, new Set(), 0)
}

function walk(v: unknown, stack: Set<object>, depth: number): unknown {
  switch (typeof v) {
    case 'bigint':
      return `${v}n`
    case 'number':
      return Number.isFinite(v) ? v : String(v)
    case 'function':
      return `[Function ${(v as { name?: string }).name || 'anonymous'}]`
    case 'symbol':
      return v.toString()
    case 'object':
      break
    default:
      return v
  }
  if (v === null) return null
  const o = v as object
  if (stack.has(o)) return '[Circular]'
  if (depth >= MAX_DEPTH) return '[MaxDepth]'
  if (o instanceof Date) return Number.isNaN(o.getTime()) ? 'Invalid Date' : o.toISOString()
  if (ArrayBuffer.isView(o)) {
    const len = (o as { length?: number }).length ?? o.byteLength
    return `[${o.constructor.name}(${len})]`
  }
  stack.add(o)
  try {
    const d = depth + 1
    if (o instanceof Error) {
      const out: Record<string, unknown> = { name: o.name, message: o.message }
      if (o.cause !== undefined) out.cause = walk(o.cause, stack, d)
      return out
    }
    if (Array.isArray(o)) return o.map((x) => walk(x, stack, d))
    if (o instanceof Map) return [...o].map(([k, x]) => [walk(k, stack, d), walk(x, stack, d)])
    if (o instanceof Set) return [...o].map((x) => walk(x, stack, d))
    const toJSON = (o as { toJSON?: unknown }).toJSON
    if (typeof toJSON === 'function') {
      try {
        return walk(toJSON.call(o), stack, d)
      } catch {
        return '[Unserializable]'
      }
    }
    const out: Record<string, unknown> = {}
    for (const key of Object.keys(o)) {
      const x = (o as Record<string, unknown>)[key]
      if (x !== undefined) out[key] = walk(x, stack, d)
    }
    return out
  } finally {
    stack.delete(o)
  }
}
