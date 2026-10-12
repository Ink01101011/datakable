/**
 * The semver subset `requires.core` needs (§3.3): `^ ~ = > >= < <=`, x-ranges (`1.x`, `1.2.*`,
 * `*`, partial `1.2`), space-separated AND and `||`. Prerelease / build tags are ignored: a feature
 * that works on `1.0.0` is assumed to work on `1.0.0-beta.1`. No dependency; cold path only.
 */
export type Version = readonly [number, number, number]

const VERSION_RE = /^v?(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/
const PARTIAL_RE = /^v?(\d+|[xX*])(?:\.(\d+|[xX*]))?(?:\.(\d+|[xX*]))?(?:[-+].*)?$/
const OP_RE = /^(\^|~|>=|<=|>|<|=)?\s*(.*)$/

export function parseVersion(v: string): Version | undefined {
  const m = VERSION_RE.exec(v.trim())
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : undefined
}

export function compareVersions(a: Version, b: Version): number {
  return a[0] - b[0] || a[1] - b[1] || a[2] - b[2]
}

/** `[low, high)` bounds: `low` inclusive unless `lowEx`, `high` exclusive (undefined = none). */
interface Bounds {
  low?: Version
  lowEx?: boolean
  high?: Version
  highIn?: boolean
}

type Loose = [number, number | undefined, number | undefined] | undefined

function parsePartial(s: string): Loose | null {
  const m = PARTIAL_RE.exec(s)
  if (!m) return null
  const n = (x: string | undefined) => (x === undefined || /[xX*]/.test(x) ? undefined : Number(x))
  const major = n(m[1])
  if (major === undefined) return undefined
  const minor = n(m[2])
  return [major, minor, minor === undefined ? undefined : n(m[3])]
}

function comparator(token: string): Bounds | null {
  const [, op = '', rest = ''] = OP_RE.exec(token) as RegExpExecArray
  if (rest === '' && op !== '') return null
  const p = rest === '' ? undefined : parsePartial(rest)
  if (p === null) return null
  if (p === undefined) return op === '' || op === '>=' || op === '<=' || op === '=' ? {} : null
  const [M, m, pt] = p
  const low: Version = [M, m ?? 0, pt ?? 0]
  // The first version past the partial's precision (1.2 → 1.3.0, 1 → 2.0.0).
  const next: Version = m === undefined ? [M + 1, 0, 0] : pt === undefined ? [M, m + 1, 0] : low
  switch (op) {
    case '^': {
      const high: Version =
        M > 0 || m === undefined
          ? [M + 1, 0, 0]
          : m > 0 || pt === undefined
            ? [0, m + 1, 0]
            : [0, 0, pt + 1]
      return { low, high }
    }
    case '~':
      return { low, high: m === undefined ? [M + 1, 0, 0] : [M, m + 1, 0] }
    case '>=':
      return { low }
    case '>':
      return pt === undefined ? { low: next } : { low, lowEx: true }
    case '<':
      return { high: low }
    case '<=':
      return pt === undefined ? { high: next } : { high: low, highIn: true }
    default:
      // `=` / bare: exact for a full version, an x-range otherwise.
      return pt === undefined ? { low, high: next } : { low, high: low, highIn: true }
  }
}

function within(v: Version, b: Bounds): boolean {
  if (b.low) {
    const c = compareVersions(v, b.low)
    if (c < 0 || (c === 0 && b.lowEx)) return false
  }
  if (b.high) {
    const c = compareVersions(v, b.high)
    if (c > 0 || (c === 0 && !b.highIn)) return false
  }
  return true
}

/**
 * Whether `version` is in `range`. `undefined` when either cannot be parsed, so callers can tell
 * "unmet" from "not a range" and say which.
 */
export function satisfies(version: string, range: string): boolean | undefined {
  const v = parseVersion(version)
  if (!v) return undefined
  let any = false
  for (const alt of range.split('||')) {
    // `>= 1.2` → `>=1.2`: an operator binds to the next token.
    const tokens = alt
      .trim()
      .replace(/(\^|~|>=|<=|>|<|=)\s+/g, '$1')
      .split(/\s+/)
      .filter(Boolean)
    let ok = true
    for (const t of tokens.length === 0 ? ['*'] : tokens) {
      const b = comparator(t)
      if (b === null) return undefined
      if (ok && !within(v, b)) ok = false
    }
    if (ok) any = true
  }
  return any
}
