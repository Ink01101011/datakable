import { compilePath, getValue } from '../column/get-value'
import { DEV } from '../diagnostics/env'
import type { Emit } from '../diagnostics/types'
import { featureDiagnostics } from '../feature/codes'
import type { AnyFeature, RowModelContext } from '../feature/types'
import { type KeyOf, resolveRowKeys } from '../ingest/row-key'
import { joinIssuePath, pathTouches } from '../ingest/schema'
import { CellFailures } from '../intercept/cell-batch'
import { errorName } from '../intercept/classify'
import { type ContextBase, createContext } from '../intercept/context'
import { FALLBACK } from '../intercept/fallbacks'
import type { InterceptorRuntime } from '../intercept/runtime'
import type { TableState } from '../table/types'
import { createColumnCache } from './column-cache'
import { type ResolvedColumn, type ResolvedColumns, resolveColumns } from './columns'
import { checkStep, indexPrint, stepDiagnostics } from './dev-checks'
import { allRows } from './indices'
import { Row, type RowIssue, type RowSource } from './row'
import type { RowModel, RowModelStatus } from './types'

void featureDiagnostics
void stepDiagnostics

const EMPTY: readonly never[] = []

/** What `createTable` gives the runner. */
export interface PipelineHost {
  readonly runtime: InterceptorRuntime
  readonly emit: Emit
  /** Installed features in pipeline (stage) order. */
  readonly features: readonly AnyFeature[]
  /** `options.features` in the listed order: `where` = `features[<listed index>].rowModel`. */
  readonly listed: readonly AnyFeature[]
  base(): ContextBase
  /** Starts a pipeline run: increments and returns the run id. */
  nextRun(): number
  getData(): readonly unknown[]
  getState(): TableState
  getColumns(): readonly unknown[] | undefined
  getRowKey(): unknown
  /** `RowModel.isInitialLoad`: no data applied yet (§6.6). */
  isInitialLoad(): boolean
  /**
   * The table's status outside the pipeline (`'validating'`, `'error'` after a failed ingest, …);
   * a step failing in this run makes the row model `'error'` regardless.
   */
  status(): RowModelStatus
  /** Schema issues of a flagged row by data index (`invalidRows: 'flag'`); else `undefined`. */
  issues(index: number): readonly RowIssue[] | undefined
}

export interface Pipeline<T> {
  /** Runs `pipeline:run` and returns the row model (the previous object when nothing changed). */
  run(): RowModel<T>
  /** The last row model, if the pipeline ran. */
  current(): RowModel<T> | undefined
}

interface StepMemo {
  input: Uint32Array
  state: unknown
  columns: readonly unknown[]
  output: Uint32Array
}

interface Built<T> {
  model: RowModel<T>
  data: readonly unknown[]
  indices: Uint32Array
  columns: readonly unknown[]
  rowKey: unknown
}

/**
 * The index-based pipeline (§3.3, §9.1): each step consumes and produces a `Uint32Array` of row
 * indices, is memoised on (input reference, own slice, columns), and `Row` objects are created only
 * for the final (visible) indices.
 */
export function createPipeline<T>(host: PipelineHost): Pipeline<T> {
  const cache = createColumnCache(host)
  const steps = host.features.filter((f) => f.stage !== 'none' && typeof f.rowModel === 'function')
  const where = new Map(steps.map((f) => [f, `features[${host.listed.indexOf(f)}].rowModel`]))
  const memo = new Map<AnyFeature, StepMemo>()
  const sources = new WeakMap<ResolvedColumns, RowSource>()
  const keyFailures = new CellFailures()
  /** The first `rowKey` error of the current build (its `cause`). */
  let keyError: unknown
  const keyFailed = (index: number, e: unknown) => {
    if (keyFailures.count === 0) keyError = e
    keyFailures.add(index, e)
  }
  let last: Built<T> | undefined
  /** Row keys resolved over all rows (§5.2), per (data, rowKey) reference. */
  let keys: { data: readonly unknown[]; rowKey: unknown; keyOf: KeyOf } | undefined
  let model: RowModel<T> | undefined

  /** `Row.getValue` failures: one emit per failing cell, built only when a cell fails. */
  function reportCell(col: ResolvedColumn, index: number, e: unknown, field: string) {
    const name = errorName(e)
    host.emit(
      'DK_CALLBACK_FAILED',
      {
        slot: `columns[${col.index}].${field}`,
        column: col.id,
        rows: [index],
        count: 1,
        fallback: 'the cell reads as undefined',
        ...(name === undefined ? {} : { errorName: name }),
      },
      { cause: e },
    )
  }
  // A key-path read error, captured by a closure made once (Row.getValue is per cell: no
  // allocation per call).
  let pathFailed = false
  let pathError: unknown
  const onPathError = (e: unknown) => {
    pathFailed = true
    pathError = e
  }

  function rowSource(cols: ResolvedColumns): RowSource {
    let s = sources.get(cols)
    if (s) return s
    s = {
      value(index, original, id) {
        const col = cols.byId.get(id)
        if (!col) return undefined
        if (col.path) {
          const v = getValue(original, col.path, onPathError)
          if (pathFailed) {
            const e = pathError
            pathFailed = false
            pathError = undefined
            reportCell(col, index, e, 'key')
          }
          return v
        }
        if (!col.accessor) return undefined
        try {
          return col.accessor(original)
        } catch (e) {
          reportCell(col, index, e, 'accessor')
          return undefined
        }
      },
      issues: (index) => host.issues(index),
      cellIssues(issues, id) {
        const col = cols.byId.get(id)
        if (!col?.path) return EMPTY
        let out: RowIssue[] | undefined
        for (const issue of issues) {
          let p: string
          try {
            p = joinIssuePath(issue.path)
          } catch {
            p = ''
          }
          if (!pathTouches(p, col.id)) continue
          out ??= []
          out.push(issue)
        }
        return out ?? EMPTY
      },
    }
    sources.set(cols, s)
    return s
  }

  function reportKeyFailures() {
    if (keyFailures.count === 0) return
    const name = errorName(keyError)
    host.emit(
      'DK_CALLBACK_FAILED',
      {
        slot: 'rowKey',
        rows: Array.from(keyFailures.sample()),
        count: keyFailures.count,
        fallback: "those rows use the fallback key '#<index>'",
        ...(name === undefined ? {} : { errorName: name }),
      },
      { cause: keyError },
    )
  }

  function build(
    data: readonly unknown[],
    indices: Uint32Array,
    columns: readonly unknown[],
    filteredCount: number,
    status: RowModelStatus,
  ): RowModel<T> {
    const rowKey = host.getRowKey()
    const isInitialLoad = host.isInitialLoad()
    const prev = last
    if (
      prev &&
      prev.indices === indices &&
      prev.data === data &&
      prev.columns === columns &&
      prev.rowKey === rowKey &&
      prev.model.status === status &&
      prev.model.isInitialLoad === isInitialLoad
    ) {
      return prev.model
    }
    const source = rowSource(resolveColumns(columns))
    const rows = new Array<Row<T>>(indices.length)
    keyFailures.reset()
    try {
      if (keys?.data !== data || keys.rowKey !== rowKey) {
        keys = { data, rowKey, keyOf: resolveRowKeys(data, rowKey, host.emit, keyFailed) }
      }
      const keyOf = keys.keyOf
      for (let i = 0; i < indices.length; i++) {
        const r = indices[i] as number
        const original = data[r] as T
        rows[i] = new Row<T>(source, r, keyOf(original, r), original)
      }
      reportKeyFailures()
    } finally {
      keyFailures.reset()
      keyError = undefined
    }
    const m: RowModel<T> = { rows, filteredCount, totalCount: data.length, status, isInitialLoad }
    last = { model: m, data, indices, columns, rowKey }
    return m
  }

  function run(): RowModel<T> {
    host.nextRun()
    const data = host.getData()
    const columns = host.getColumns() ?? EMPTY
    const cols = resolveColumns(columns)
    const state = host.getState()
    let failed = false
    let result: RowModel<T> | undefined

    const rowModelContext = (name: string): RowModelContext => ({
      name,
      data,
      emit: host.emit,
      run: host.base().run,
      columns,
      getColumnValues: (id) => {
        const col = cols.byId.get(id)
        return col ? cache.values(data, col) : undefined
      },
      getFormattedValues: (id) => {
        const col = cols.byId.get(id)
        return col ? cache.formatted(data, col) : undefined
      },
    })

    function step(f: AnyFeature, input: Uint32Array): Uint32Array {
      const slice = state[f.name]
      const m = memo.get(f)
      if (m && m.input === input && Object.is(m.state, slice) && m.columns === columns) {
        return m.output
      }
      let ok = false
      const ctx = createContext(
        'pipeline:step',
        { stage: f.stage, feature: f.name, indices: input },
        where.get(f) as string,
        host.base(),
      )
      const output = host.runtime.run('pipeline:step', ctx, () => {
        let out: unknown
        // Dev check (§3.4 devChecks): a bounded fingerprint of the input before rowModel runs.
        const before = DEV ? indexPrint(input) : 0
        try {
          out = (f.rowModel as NonNullable<AnyFeature['rowModel']>)(
            input,
            slice,
            rowModelContext(f.name),
          )
        } catch (e) {
          const name = errorName(e)
          host.emit(
            'DK_FEATURE_FAILED',
            {
              feature: f.name,
              hook: 'rowModel',
              fallback: 'the step passed its input through',
              ...(name === undefined ? {} : { errorName: name }),
            },
            { cause: e },
          )
          return input
        }
        // Dev: a mutated input warns; a bad output passes the input through, not memoised.
        if (DEV && !checkStep(host.emit, f.name, input, before, out, data.length)) return input
        ok = true
        return out instanceof Uint32Array ? out : input
      })
      if (ok) memo.set(f, { input, state: slice, columns, output })
      else {
        failed = true
        memo.delete(f)
      }
      return output
    }

    const ctx = createContext('pipeline:run', { rowCount: data.length }, 'features', host.base())
    // The last good row model (§3.4): its indices; the runner keeps the matching rows below.
    if (last) ctx.meta.set(FALLBACK, last.indices)
    void host.runtime.run('pipeline:run', ctx, () => {
      let indices = allRows(data)
      let filteredCount = -1
      for (const f of steps) {
        if (f.stage === 'paginate' && filteredCount < 0) filteredCount = indices.length
        indices = step(f, indices)
      }
      if (filteredCount < 0) filteredCount = indices.length
      result = build(data, indices, columns, filteredCount, failed ? 'error' : host.status())
      return indices
    })
    if (result) model = result
    else {
      // pipeline:run failed: the boundary reported it; keep the last good rows.
      const isInitialLoad = host.isInitialLoad()
      model = last
        ? { ...last.model, status: 'error', isInitialLoad }
        : { rows: EMPTY, filteredCount: 0, totalCount: 0, status: 'error', isInitialLoad }
    }
    return model
  }

  return { run, current: () => model }
}
