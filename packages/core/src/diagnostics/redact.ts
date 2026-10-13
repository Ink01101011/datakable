import { type DiagnosticMessages, defineDiagnostic } from './catalog'
import { DEV } from './env'
import type { Location } from './types'

declare module './catalog' {
  interface DiagnosticCatalog {
    DK_UNSAFE_REDACTION: { level: 'full' }
  }
}

/**
 * Redaction levels (§8.2). `'safe'`: paths, indices, counts, value types, hashed row keys
 * (production default). `'keys'`: + raw row keys (development default). `'full'`: + row values.
 */
export type RedactLevel = 'safe' | 'keys' | 'full'

/**
 * Custom rule: return a string to log instead of `value`, or `undefined` for the built-in policy.
 * `path` names the field, e.g. `where.key`, `details.value`, `details.keys.2`, `details.issues.0`.
 * Sensitive columns never reach it.
 */
export type RedactFn = (path: string, value: unknown) => string | undefined

export interface RedactionOptions {
  /** Default `'keys'` in development, `'safe'` in production. */
  level?: RedactLevel
  redact?: RedactFn
  /** Ids / keys of `sensitive: true` columns: never logged at any level. */
  sensitiveColumns?: () => Iterable<string>
  /** The `rowKey` column is sensitive: row keys are hashed at every level. */
  rowKeySensitive?: () => boolean
}

/**
 * Which detail fields of a diagnostic carry user data, declared on its `defineDiagnostic` entry.
 * Undeclared fields are logged as-is, so they must hold only DataKable-safe data (paths, ids,
 * indices, counts). Text builders receive the redacted values: treat these fields as opaque and
 * only interpolate them.
 *
 * - `rowKey` / `rowKeys`: a row key / an array of them (hashed under `'safe'`).
 * - `value` / `values`: a cell value / an array of them (type summary unless `'full'`). The column
 *   is `details.column` when it is a string, else the `where` column id.
 * - `schemaIssues`: one Standard Schema issue or an array of them (`scrubSchemaIssue`).
 * - `error`: a thrown value, e.g. a fetcher error (`scrubError`).
 */
export type RedactField = 'rowKey' | 'rowKeys' | 'value' | 'values' | 'schemaIssues' | 'error'

/** A resolved policy, built once per emit. */
export interface Redactor {
  level: RedactLevel
  custom: RedactFn | undefined
  sensitive: ReadonlySet<string>
  rowKeySensitive: boolean
  /** Called when the custom rule throws; the value is logged as `[redacted]`. */
  onError?: (error: unknown) => void
}

export const SENSITIVE = '[sensitive]'
export const REDACTED = '[redacted]'

const LEVELS: readonly string[] = ['safe', 'keys', 'full']
const EMPTY: ReadonlySet<string> = new Set()

export function resolveRedaction(
  option: RedactLevel | RedactionOptions | undefined,
  dev: boolean,
): Redactor {
  const o: RedactionOptions = typeof option === 'string' ? { level: option } : (option ?? {})
  const level = o.level ?? (dev ? 'keys' : 'safe')
  const cols = o.sensitiveColumns?.()
  return {
    // An unknown level gets the strictest policy; validating the option is optionValidator's job.
    level: LEVELS.includes(level) ? level : 'safe',
    custom: o.redact,
    sensitive: cols ? new Set(cols) : EMPTY,
    rowKeySensitive: o.rowKeySensitive?.() ?? false,
  }
}

/** Short 32-bit FNV-1a hash of `String(key)` (UTF-16 code units), as `h:xxxxxxxx`. */
export function hashRowKey(key: unknown): string {
  const s = String(key)
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return `h:${(h >>> 0).toString(16).padStart(8, '0')}`
}

/** The value's type, never its contents: `string(12)`, `number`, `array(3)`, `date`, … */
export function describeValue(v: unknown): string {
  if (v === null) return 'null'
  if (typeof v === 'string') return `string(${v.length})`
  if (typeof v === 'number') return Number.isNaN(v) ? 'number(NaN)' : 'number'
  if (Array.isArray(v)) return `array(${v.length})`
  if (v instanceof Date) return 'date'
  return typeof v
}

function custom(r: Redactor, path: string, value: unknown): string | undefined {
  if (!r.custom) return undefined
  try {
    return r.custom(path, value)
  } catch (e) {
    r.onError?.(e)
    return REDACTED
  }
}

function redactKey(r: Redactor, path: string, key: unknown): unknown {
  // A sensitive rowKey column wins over the custom rule and the level.
  if (r.rowKeySensitive) return hashRowKey(key)
  const c = custom(r, path, key)
  if (c !== undefined) return c
  return r.level === 'safe' ? hashRowKey(key) : key
}

function redactValue(r: Redactor, path: string, value: unknown, column?: string): unknown {
  if (column !== undefined && r.sensitive.has(column)) return SENSITIVE
  const c = custom(r, path, value)
  if (c !== undefined) return c
  return r.level === 'full' ? value : describeValue(value)
}

type IssuePath = ReadonlyArray<PropertyKey | { key: PropertyKey }>

/** Joins a Standard Schema issue path: `['user', 0, { key: 'email' }]` → `user.0.email`. */
function issuePath(path: IssuePath | undefined): string {
  if (!path) return ''
  return path.map((s) => String(typeof s === 'object' && s !== null ? s.key : s)).join('.')
}

function underSensitive(r: Redactor, path: string): boolean {
  if (r.sensitive.size === 0) return false
  for (const col of r.sensitive) if (path === col || path.startsWith(`${col}.`)) return true
  return false
}

/**
 * A schema issue as `{ path, message }`. Validators embed received values in their messages, so
 * under `'safe'` / `'keys'` (and for sensitive columns) the message is DataKable's own text.
 */
export function scrubSchemaIssue(
  issue: unknown,
  r: Redactor,
  fieldPath = 'issue',
): { path: string; message: string } {
  const i = (typeof issue === 'object' && issue !== null ? issue : {}) as {
    message?: unknown
    path?: IssuePath
  }
  let path: string
  try {
    path = issuePath(i.path)
  } catch {
    path = ''
  }
  const own = `invalid value at ${path || '(root)'}`
  if (underSensitive(r, path)) return { path, message: own }
  const c = custom(r, fieldPath, i.message)
  if (c !== undefined) return { path, message: c }
  return { path, message: r.level === 'full' && typeof i.message === 'string' ? i.message : own }
}

/**
 * A thrown value as `error.name` + `code` only (fetcher errors embed URLs, tokens, payloads). The
 * full error belongs in `context.cause`, which reaches `onDiagnostic` only.
 */
export function scrubError(e: unknown): string {
  if (typeof e !== 'object' || e === null) return typeof e
  try {
    const { name, code } = e as { name?: unknown; code?: unknown }
    const n = typeof name === 'string' && name ? name : 'object'
    return typeof code === 'string' || typeof code === 'number' ? `${n} (${code})` : n
  } catch {
    return 'object'
  }
}

/** Hashes / passes through `where.key` per the policy; other locations hold no user data. */
export function redactLocation(where: Location, r: Redactor): Location {
  if (where.kind !== 'row' || where.key === undefined) return where
  const key = redactKey(r, 'where.key', where.key)
  return { kind: 'row', index: where.index, key: typeof key === 'string' ? key : String(key) }
}

/** A shallow copy of `details` with the declared fields redacted; the input is never mutated. */
export function redactDetails(
  details: Record<string, unknown>,
  fields: Readonly<Record<string, RedactField | undefined>> | undefined,
  where: Location,
  r: Redactor,
): Record<string, unknown> {
  if (!fields) return details
  const out: Record<string, unknown> = { ...details }
  const column =
    typeof details.column === 'string'
      ? details.column
      : where.kind === 'column'
        ? where.id
        : undefined
  for (const name of Object.keys(fields)) {
    const kind = fields[name]
    if (kind === undefined || !(name in details)) continue
    const v = details[name]
    const p = `details.${name}`
    const each = (f: (x: unknown, path: string) => unknown) =>
      Array.isArray(v) ? v.map((x, i) => f(x, `${p}.${i}`)) : f(v, p)
    switch (kind) {
      case 'rowKey':
        out[name] = redactKey(r, p, v)
        break
      case 'rowKeys':
        out[name] = each((x, path) => redactKey(r, path, x))
        break
      case 'value':
        out[name] = redactValue(r, p, v, column)
        break
      case 'values':
        out[name] = each((x, path) => redactValue(r, path, x, column))
        break
      case 'schemaIssues':
        out[name] = each((x, path) => scrubSchemaIssue(x, r, path))
        break
      case 'error':
        out[name] = custom(r, p, v) ?? scrubError(v)
        break
    }
  }
  return out
}

/** Message text (§8.2): development builds, or production via `@datakable/core/messages`. */
export const redactionMessages: DiagnosticMessages<'DK_UNSAFE_REDACTION'> = {
  DK_UNSAFE_REDACTION: {
    problem: (d) => `diagnostics.redact is '${d.level}' in a production build`,
    impact: () =>
      'raw row keys and cell values (except sensitive columns) reach onDiagnostic, ' +
      'getDiagnostics() and the console',
    fix: () => [
      "remove diagnostics.redact in production (the default is 'safe')",
      "or use 'keys' to log raw row keys without cell values",
      'mark personal-data columns with sensitive: true so they are never logged',
    ],
  },
}

/** `'full'` in a production build (§8.2: "warns if enabled in production"). Emitted by the hub. */
export const DK_UNSAFE_REDACTION = defineDiagnostic(
  {
    code: 'DK_UNSAFE_REDACTION',
    level: 'warn',
    where: () => ({ kind: 'option', path: 'diagnostics.redact' }),
  },
  DEV && redactionMessages.DK_UNSAFE_REDACTION,
)
