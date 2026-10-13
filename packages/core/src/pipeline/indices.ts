const all = new WeakMap<readonly unknown[], Uint32Array>()

/**
 * `[0, 1, …, n - 1]` for `data`, built once per data reference (the input of the first pipeline
 * step, so its identity keys the per-step memo). Released with the data.
 */
export function allRows(data: readonly unknown[]): Uint32Array {
  let out = all.get(data)
  if (out) return out
  const n = data.length
  out = new Uint32Array(n)
  for (let i = 0; i < n; i++) out[i] = i
  all.set(data, out)
  return out
}
