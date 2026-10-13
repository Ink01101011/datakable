import type { AnyFeature, RowModelContext, Stage } from '../feature/types'
import { resolveRowKeys } from '../ingest/row-key'
import type { SchemaOutcome } from '../ingest/schema'
import type { InvalidRowsMode } from '../ingest/schema-codes'
import type { RowKey } from '../pipeline/row'
import type { RunRecord } from '../pipeline/runner'
import type { RowModel, RowModelStatus } from '../pipeline/types'
import { DEV } from './env'
import type { explainDetail } from './explain-detail'
import { formatRowExplanation, formatTableExplanation } from './explain-text'
import { type RedactionOptions, redactDetails, resolveRedaction, scrubSchemaIssue } from './redact'
import { readTrace } from './trace-store'
import type { Diagnostic, Location, Trigger } from './types'

/** What `createTable` gives `explain()` / `explainRow()`: read-only views of the table. */
export interface ExplainHost {
  readonly table: object
  /** Installed features in pipeline (stage) order. */
  readonly features: readonly AnyFeature[]
  /** The current row model (computed if data, state or columns changed, like `getRowModel()`). */
  rowModel(): RowModel<unknown>
  lastRun(): RunRecord | undefined
  /** A step context for replaying a `rowModel` on chosen rows (no diagnostics, no interceptors). */
  replay(name: string): RowModelContext
  data(): readonly unknown[]
  state(): Readonly<Record<string, unknown>>
  rowKey(): unknown
  /** `options.invalidRows` when a schema is set; `undefined` without one. */
  schemaMode(): InvalidRowsMode | undefined
  schema(): SchemaOutcome | undefined
  diagnostics(): readonly Diagnostic[]
  readonly redaction: RedactionOptions
  /** Why a step removed a row (`explainDetail`): it comes with the features (their runtime). */
  readonly detail?: typeof explainDetail
}

/** One step of {@link TableExplanation}: counts only. */
export interface ExplainStep {
  readonly feature: string
  readonly stage: Stage
  /** `'server'`: the server ran the step; its counts are the rows it was given. */
  readonly mode: 'client' | 'server'
  readonly input: number
  readonly output: number
  /** Served from the step memo in this run (nothing changed for it). */
  readonly cached: boolean
  /** The step threw or returned a bad output and passed its input through. */
  readonly failed: boolean
  /** Duration (tracer only, development or `interceptors: [tracer()]`). */
  readonly ms?: number
}

/** What `table.explain()` returns (§8.4); `String(e)` is the console summary. */
export interface TableExplanation {
  readonly run: number
  readonly trigger: Trigger
  readonly status: RowModelStatus
  /** Rows after ingest (after the schema dropped invalid rows). */
  readonly rows: number
  /** With a schema: its `invalidRows` mode and how many rows failed it. */
  readonly schema?: { readonly mode: InvalidRowsMode; readonly invalid: number }
  readonly steps: readonly ExplainStep[]
  /** Rows after filter and search (`getRowModel().filteredCount`). */
  readonly filteredCount: number
  /** With a pagination slice: the page shown (0-based), the page count and the page size. */
  readonly page?: { readonly index: number; readonly count: number; readonly size: number }
  /** Rows in `getRowModel().rows`. */
  readonly visible: number
  /** Error and warning diagnostics in `getDiagnostics()`. */
  readonly diagnostics: number
  /** Timings come from the tracer (it saw this run). */
  readonly traced: boolean
  /** Duration of the run (tracer only). */
  readonly ms?: number
  toString(): string
}

/**
 * `kept` / `removed` by the step, `skipped` (server mode), `failed` (passed its input through),
 * `not-reached` (an earlier step or the schema removed the row).
 */
export type RowStepOutcome = 'kept' | 'removed' | 'skipped' | 'failed' | 'not-reached'

export interface RowStep {
  readonly feature: string
  readonly stage: Stage
  readonly outcome: RowStepOutcome
  /** Kept: the row's position in the step output (0-based) and the output size. */
  readonly position?: number
  readonly of?: number
  /** Why the step removed the row (redacted). */
  readonly detail?: Readonly<Record<string, unknown>>
}

/** What `table.explainRow(key)` returns (§8.4); `String(e)` is the console report. */
export interface RowExplanation {
  /** The key asked for, redacted (a hash under `'safe'`). */
  readonly key: unknown
  readonly found: boolean
  /** Position in `getData()`; absent when not found or dropped by the schema. */
  readonly index?: number
  /** Position in `options.data` of a row the schema dropped. */
  readonly rawIndex?: number
  readonly schema: 'none' | 'valid' | 'flagged' | 'dropped'
  /** Schema issues of a flagged / dropped row (paths + DataKable's own text unless `'full'`). */
  readonly issues?: readonly { path: string; message: string }[]
  readonly steps: readonly RowStep[]
  /** The step that removed the row: a feature name, or `'schema'`. */
  readonly removedBy?: string
  /** The row is in `getRowModel().rows`. */
  readonly visible: boolean
  readonly run: number
  /** Rows after ingest (for "not found"). */
  readonly rows: number
  toString(): string
}

const NOOP = () => {}

/** Steps that take part in the row model: a stage and a `rowModel` (server mode included). */
const pipelineSteps = (features: readonly AnyFeature[]) =>
  features.filter((f) => f.stage !== 'none' && typeof f.rowModel === 'function')

const isServer = (f: AnyFeature) => f.mode === 'server'

/** `{ pageIndex, pageSize }` of the first paginate-stage slice that has them. */
export function pageOf(host: ExplainHost): { index: number; size: number } | undefined {
  for (const f of host.features) {
    if (f.stage !== 'paginate') continue
    const s = host.state()[f.name] as { pageIndex?: unknown; pageSize?: unknown } | undefined
    if (typeof s?.pageIndex === 'number' && typeof s.pageSize === 'number' && s.pageSize > 0) {
      return { index: s.pageIndex, size: s.pageSize }
    }
  }
  return undefined
}

export const pageCount = (rows: number, size: number) => Math.ceil(rows / size)

/** Clamped like pagination does (the page actually shown). */
export const shownPage = (index: number, count: number) => Math.max(0, Math.min(index, count - 1))

/** `table.explain()` (§8.4): the last run's counts, with tracer timings when it was traced. */
export function explainTable(host: ExplainHost): TableExplanation {
  const model = host.rowModel()
  const last = host.lastRun()
  const trace = readTrace(host.table)
  const traced = trace !== undefined && last !== undefined && trace.run === last.run
  const steps: ExplainStep[] = []
  let flowing = model.totalCount
  for (const f of pipelineSteps(host.features)) {
    if (isServer(f)) {
      steps.push(step(f, 'server', flowing, flowing, false, false))
      continue
    }
    const rec = last?.steps.find((s) => s.feature === f)
    if (!rec) continue
    flowing = rec.output.length
    const ms = traced ? trace.steps.get(f.name)?.ms : undefined
    steps.push({
      ...step(f, 'client', rec.input.length, rec.output.length, rec.cached, rec.failed),
      ...(ms === undefined ? {} : { ms }),
    })
  }
  const mode = host.schemaMode()
  const schema = host.schema()
  const p = pageOf(host)
  const count = p ? pageCount(model.filteredCount, p.size) : 0
  let diagnostics = 0
  for (const d of host.diagnostics()) if (d.level !== 'info') diagnostics++
  const e: TableExplanation = {
    run: last?.run ?? 0,
    trigger: last?.trigger ?? 'init',
    status: model.status,
    rows: model.totalCount,
    ...(mode === undefined ? {} : { schema: { mode, invalid: schema?.invalid.length ?? 0 } }),
    steps,
    filteredCount: model.filteredCount,
    ...(p ? { page: { index: shownPage(p.index, count), count, size: p.size } } : {}),
    visible: model.rows.length,
    diagnostics,
    traced,
    ...(traced && trace.ms !== undefined ? { ms: trace.ms } : {}),
    toString: () => (DEV ? formatTableExplanation(e) : JSON.stringify(e)),
  }
  return e
}

function step(
  f: AnyFeature,
  mode: 'client' | 'server',
  input: number,
  output: number,
  cached: boolean,
  failed: boolean,
): ExplainStep {
  return { feature: f.name, stage: f.stage, mode, input, output, cached, failed }
}

/** Index of the row whose key equals `key` (`42` matches `'42'`), or -1. */
function findKey(rows: readonly unknown[], rowKey: unknown, key: unknown): number {
  const keyOf = resolveRowKeys(rows, rowKey, NOOP, NOOP)
  const s = String(key)
  for (let i = 0; i < rows.length; i++) {
    const k = keyOf(rows[i], i)
    if (k === key || String(k) === s) return i
  }
  return -1
}

/**
 * `table.explainRow(key)` (§8.4): replays the row through every stage of the last run — schema,
 * then each step in pipeline order — and names the step that removed it. Survival is read from the
 * recorded step input / output (no per-row bookkeeping during normal runs); a removal by a filter
 * replays its filters on the single row to name the ones that reject it. Read-only: no state
 * change, no notification, no diagnostic. Every value it shows is redacted (§8.2).
 */
export function explainRow(host: ExplainHost, key: RowKey): RowExplanation {
  const model = host.rowModel()
  const last = host.lastRun()
  const data = host.data()
  const r = resolveRedaction(host.redaction, DEV)
  const where: Location = { kind: 'feature', name: 'explainRow' }
  const shownKey = redactDetails({ key }, { key: 'rowKey' }, where, r).key
  const mode = host.schemaMode()
  const outcome = host.schema()
  const rowKey = host.rowKey()

  const index = findKey(data, rowKey, key)
  let schema: RowExplanation['schema'] = mode === undefined ? 'none' : 'valid'
  let rawIndex: number | undefined
  let issues: readonly unknown[] | undefined
  if (index >= 0) {
    issues = outcome?.flagged?.get(index)
    if (issues) schema = 'flagged'
  } else if (outcome && outcome.invalid.length > 0 && rowKey !== undefined && mode !== 'flag') {
    // Dropped by the schema: looked up among the invalid raw rows by the same key.
    const i = findKey(
      outcome.invalid.map((x) => x.raw),
      rowKey,
      key,
    )
    const inv = outcome.invalid[i]
    if (inv) {
      schema = 'dropped'
      rawIndex = inv.index
      issues = inv.issues
    }
  }
  const found = index >= 0 || rawIndex !== undefined
  let removedBy: string | undefined = schema === 'dropped' ? 'schema' : undefined
  const steps: RowStep[] = []
  for (const f of pipelineSteps(host.features)) {
    const base = { feature: f.name, stage: f.stage }
    if (!found || removedBy !== undefined) {
      steps.push({ ...base, outcome: 'not-reached' })
      continue
    }
    if (isServer(f)) {
      steps.push({ ...base, outcome: 'skipped' })
      continue
    }
    const rec = last?.steps.find((s) => s.feature === f)
    if (!rec) {
      steps.push({ ...base, outcome: 'not-reached' })
      continue
    }
    const position = rec.output.indexOf(index)
    if (position >= 0) {
      const of = rec.output.length
      steps.push({ ...base, outcome: rec.failed ? 'failed' : 'kept', position, of })
      continue
    }
    removedBy = f.name
    const detail = host.detail?.(host, f, rec.input, index, r, where)
    steps.push({ ...base, outcome: 'removed', ...(detail ? { detail } : {}) })
  }
  const e: RowExplanation = {
    key: shownKey,
    found,
    ...(index >= 0 ? { index } : {}),
    ...(rawIndex === undefined ? {} : { rawIndex }),
    schema,
    ...(issues ? { issues: issues.map((x, i) => scrubSchemaIssue(x, r, `issues.${i}`)) } : {}),
    steps,
    ...(removedBy === undefined ? {} : { removedBy }),
    visible: index >= 0 && model.rows.some((row) => (row as { index?: unknown }).index === index),
    run: last?.run ?? 0,
    rows: data.length,
    toString: () => (DEV ? formatRowExplanation(e) : JSON.stringify(e)),
  }
  return e
}
