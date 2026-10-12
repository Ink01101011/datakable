import { compilePath } from '../column/get-value'
import { buildDiagnostic, DatakableError } from '../diagnostics/build'
import type { DiagnosticDetails } from '../diagnostics/catalog'
import { keepDiagnostics } from '../diagnostics/catalog'
import type { Diagnostic, Emit } from '../diagnostics/types'
import { errorName } from '../intercept/classify'
import { NO_ISSUES, type RowIssue } from '../pipeline/row'
import { type InvalidRowsMode, type SchemaIssueColumn, schemaDiagnostics } from './schema-codes'
import type { StandardSchemaV1 } from './standard-schema'

keepDiagnostics(schemaDiagnostics)

/** One row that failed schema validation (`table.getInvalidRows()`, §5.1). */
export interface InvalidRow {
  /** Position in `options.data` (before invalid rows were dropped). */
  readonly index: number
  /** The row as given, before validation. */
  readonly raw: unknown
  /** The validator's issues (a synthetic one when the schema threw, `DK_SCHEMA_CRASHED`). */
  readonly issues: readonly RowIssue[]
}

/** Thrown by `createTable` / `setOptions` under `invalidRows: 'throw'` (§5.1). */
export class DatakableSchemaError extends DatakableError {
  override name = 'DatakableSchemaError'
  /** The rows that failed, as `getInvalidRows()` would list them. */
  readonly invalidRows: readonly InvalidRow[]

  constructor(d: Diagnostic, invalidRows: readonly InvalidRow[]) {
    super(d)
    this.invalidRows = invalidRows
  }
}

/** `true` for an object (or function: arktype) carrying a Standard Schema v1 `~standard`. */
export function isStandardSchema(v: unknown): v is StandardSchemaV1 {
  if (v === null || (typeof v !== 'object' && typeof v !== 'function')) return false
  const s = (v as { '~standard'?: { version?: unknown; validate?: unknown } })['~standard']
  return typeof s === 'object' && s !== null && s.version === 1 && typeof s.validate === 'function'
}

/** What a validated data array carries besides its rows (bound to the array by identity). */
export interface SchemaOutcome {
  readonly invalid: readonly InvalidRow[]
  /** `'flag'`: issues by index in the validated array; `undefined` when no row is flagged. */
  readonly flagged: ReadonlyMap<number, readonly RowIssue[]> | undefined
}

export interface SchemaIngest {
  /**
   * Validates every row (the `data:ingest` core). Returns the validated array — output values,
   * invalid rows dropped or kept per mode — or a promise of it when the schema is async. Throws
   * `DatakableSchemaError` under `'throw'` when a row is invalid.
   */
  validate(input: readonly unknown[], emit: Emit): readonly unknown[] | Promise<readonly unknown[]>
  /** The outcome of an array `validate` returned; `undefined` for any other array. */
  outcome(data: readonly unknown[]): SchemaOutcome | undefined
}

/** How many sample rows / issue paths a diagnostic carries. */
const SAMPLE = 5

/** Standard Schema issue path → `a.b.0.c`. Never throws (paths come from user code). */
export function joinIssuePath(path: RowIssue['path']): string {
  if (!path) return ''
  let out = ''
  for (let i = 0; i < path.length; i++) {
    const s = path[i]
    const k = typeof s === 'object' && s !== null ? (s as { key: PropertyKey }).key : s
    out += (i === 0 ? '' : '.') + (typeof k === 'symbol' ? k.toString() : String(k))
  }
  return out
}

/**
 * `row.getCellIssues` matching (§5.1), segment by segment against a column's compiled key path —
 * no string is built, so a check allocates nothing:
 *
 * - the issue path and the column key agree on their common prefix: equal, the issue under the
 *   column (`address.city` → `address`), or the column under the issue (`address` →
 *   `address.city`). `address` never matches `addressLine`.
 * - `{ key }` and numeric segments compare as strings (`['tags', 0]` → `tags.0`); a symbol segment
 *   never matches; one segment `'a.b'` is not the two-segment key `a.b`.
 * - a row-level issue (no or empty path) touches every column, accessor columns included;
 *   accessor columns (`segments` `undefined`) have no key, so they get only those.
 * - a path that throws when read (user code) counts as row-level. Never throws.
 */
export function issuePathTouches(
  path: RowIssue['path'],
  segments: readonly string[] | undefined,
): boolean {
  try {
    if (!path || path.length === 0) return true
    if (!segments) return false
    const n = path.length < segments.length ? path.length : segments.length
    for (let i = 0; i < n; i++) {
      const s = path[i]
      const k = typeof s === 'object' && s !== null ? (s as { key: PropertyKey }).key : s
      if (typeof k === 'symbol' || String(k) !== segments[i]) return false
    }
    return true
  } catch {
    return true
  }
}

/**
 * The issues of `issues` that touch the column with key path `segments` (`undefined`: accessor
 * column), per {@link issuePathTouches}. Allocates only when an issue matches.
 */
export function matchCellIssues(
  issues: readonly RowIssue[],
  segments: readonly string[] | undefined,
): readonly RowIssue[] {
  let out: RowIssue[] | undefined
  for (let i = 0; i < issues.length; i++) {
    const issue = issues[i] as RowIssue
    let path: RowIssue['path']
    try {
      path = issue.path
    } catch {
      path = undefined
    }
    if (!issuePathTouches(path, segments)) continue
    out ??= []
    out.push(issue)
  }
  return out ?? NO_ISSUES
}

const isThenable = (v: unknown): v is PromiseLike<unknown> =>
  v != null && typeof (v as { then?: unknown }).then === 'function'

type Settled = StandardSchemaV1.Result<unknown> | Crash

/** `validate` threw or rejected. */
class Crash {
  constructor(readonly error: unknown) {}
}

const crashIssue = (): RowIssue => ({
  message: 'the schema threw while validating this row (DK_SCHEMA_CRASHED)',
})

const columnKeys = (columns: readonly unknown[] | undefined) => {
  const out: { key: string; index: number }[] = []
  if (!columns) return out
  for (let index = 0; index < columns.length; index++) {
    const key = (columns[index] as { key?: unknown } | null)?.key
    if (typeof key === 'string') out.push({ key, index })
  }
  return out
}

/**
 * The schema step of `data:ingest` (§5.1). `schema` and `mode` are read once, at creation; the
 * result is memoised per data reference.
 */
export function createSchemaIngest(
  schema: StandardSchemaV1,
  mode: InvalidRowsMode,
  getColumns: () => readonly unknown[] | undefined,
): SchemaIngest {
  const std = schema['~standard']
  const memo = new WeakMap<readonly unknown[], readonly unknown[]>()
  const outcomes = new WeakMap<readonly unknown[], SchemaOutcome>()

  function run(row: unknown): Settled | PromiseLike<Settled> {
    try {
      const r = std.validate(row)
      if (!isThenable(r)) return r
      return Promise.resolve(r).then(
        (x) => x,
        (e: unknown) => new Crash(e),
      )
    } catch (e) {
      return new Crash(e)
    }
  }

  function settle(input: readonly unknown[], results: readonly Settled[], emit: Emit) {
    const out: unknown[] = []
    const invalid: InvalidRow[] = []
    let flagged: Map<number, readonly RowIssue[]> | undefined
    const crashed: number[] = []
    let firstCrash: unknown
    for (let i = 0; i < input.length; i++) {
      const r = results[i]
      let issues: readonly RowIssue[] | undefined
      if (r instanceof Crash) {
        if (crashed.length === 0) firstCrash = r.error
        crashed.push(i)
        issues = [crashIssue()]
      } else if (r == null || typeof r !== 'object') {
        // Not a Standard Schema result: treated like a crash.
        if (crashed.length === 0) firstCrash = new TypeError('validate returned no result object')
        crashed.push(i)
        issues = [crashIssue()]
      } else if (r.issues !== undefined) {
        issues = r.issues
      }
      if (issues === undefined) {
        out.push((r as StandardSchemaV1.SuccessResult<unknown>).value)
        continue
      }
      invalid.push({ index: i, raw: input[i], issues })
      if (mode === 'flag') {
        flagged ??= new Map()
        flagged.set(out.length, issues)
        out.push(input[i])
      }
    }
    if (crashed.length > 0) {
      const name = errorName(firstCrash)
      emit(
        'DK_SCHEMA_CRASHED',
        {
          mode,
          count: crashed.length,
          rows: crashed.slice(0, SAMPLE),
          ...(name === undefined ? {} : { errorName: name }),
        },
        { cause: firstCrash },
      )
    }
    const crashedSet = new Set(crashed)
    const failing = invalid.filter((r) => !crashedSet.has(r.index))
    if (failing.length > 0) {
      const details: DiagnosticDetails<'DK_SCHEMA_INVALID_ROW'> = {
        mode,
        count: failing.length,
        total: input.length,
        rows: failing.slice(0, SAMPLE).map((r) => r.index),
        issues: failing.slice(0, SAMPLE).map((r) => r.issues[0]),
        columns: issueColumns(failing),
      }
      if (mode === 'throw') throwSchemaError(details, invalid, emit)
      emit('DK_SCHEMA_INVALID_ROW', details)
    } else if (mode === 'throw' && invalid.length > 0) {
      throw new DatakableSchemaError(
        buildDiagnostic('DK_SCHEMA_CRASHED', {
          mode,
          count: crashed.length,
          rows: crashed.slice(0, SAMPLE),
        }),
        invalid,
      )
    }
    outcomes.set(out, { invalid, flagged })
    memo.set(input, out)
    return out
  }

  /** Issue paths of the invalid rows, matched to columns, most frequent first. */
  function issueColumns(rows: readonly InvalidRow[]): SchemaIssueColumn[] {
    // Joined path → [count, one raw path]: the raw path is matched segment by segment, like
    // getCellIssues (`matchCellIssues`), so the fix names the column whose cells show the issue.
    const counts = new Map<string, [number, RowIssue['path']]>()
    for (const r of rows) {
      const seen = new Set<string>()
      for (const issue of r.issues) {
        let raw: RowIssue['path']
        let p: string
        try {
          raw = issue.path
          p = joinIssuePath(raw)
        } catch {
          raw = undefined
          p = ''
        }
        if (seen.has(p)) continue
        seen.add(p)
        const c = counts.get(p)
        if (c) c[0]++
        else counts.set(p, [1, raw])
      }
    }
    const keys = columnKeys(getColumns())
    return [...counts]
      .sort((a, b) => b[1][0] - a[1][0])
      .slice(0, SAMPLE)
      .map(([path, [count, raw]]) => {
        const col =
          path === '' ? undefined : keys.find((k) => issuePathTouches(raw, compilePath(k.key)))
        return col ? { path, column: col.key, index: col.index, count } : { path, count }
      })
  }

  function throwSchemaError(
    details: DiagnosticDetails<'DK_SCHEMA_INVALID_ROW'>,
    invalid: readonly InvalidRow[],
    emit: Emit,
  ): never {
    let d: Diagnostic | undefined
    try {
      emit('DK_SCHEMA_INVALID_ROW', details)
    } catch (e) {
      // strict: the hub rethrew the (redacted, enriched) diagnostic.
      if (!(e instanceof DatakableError)) throw e
      d = e.diagnostic
    }
    throw new DatakableSchemaError(d ?? buildDiagnostic('DK_SCHEMA_INVALID_ROW', details), invalid)
  }

  return {
    validate(input, emit) {
      const hit = memo.get(input)
      if (hit) return hit
      const results = new Array<Settled | PromiseLike<Settled>>(input.length)
      let async = false
      for (let i = 0; i < input.length; i++) {
        const r = run(input[i])
        if (isThenable(r)) async = true
        results[i] = r
      }
      if (!async) return settle(input, results as Settled[], emit)
      return Promise.all(results).then((settled) => settle(input, settled, emit))
    },
    outcome: (data) => outcomes.get(data),
  }
}
