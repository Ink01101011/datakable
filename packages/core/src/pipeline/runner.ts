import { compilePath, getValue } from '../column/get-value'
import type { Emit } from '../diagnostics/types'
import { featureDiagnostics } from '../feature/codes'
import type { AnyFeature, RowModelContext } from '../feature/types'
import { CellFailures } from '../intercept/cell-batch'
import { errorName } from '../intercept/classify'
import { type ContextBase, createContext } from '../intercept/context'
import { FALLBACK } from '../intercept/fallbacks'
import type { InterceptorRuntime } from '../intercept/runtime'
import type { TableState } from '../table/types'
import { createColumnCache } from './column-cache'
import { type ResolvedColumns, resolveColumns } from './columns'
import { allRows } from './indices'
import { Row, type RowKey, type RowSource } from './row'
import type { RowModel, RowModelStatus } from './types'

void featureDiagnostics

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
  let model: RowModel<T> | undefined

  function rowSource(cols: ResolvedColumns): RowSource {
    let s = sources.get(cols)
    if (s) return s
    s = {
      value(index, original, id) {
        const col = cols.byId.get(id)
        if (!col) return undefined
        const report = (e: unknown, field: string) => {
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
        if (col.path) return getValue(original, col.path, (e) => report(e, 'key'))
        if (!col.accessor) return undefined
        try {
          return col.accessor(original)
        } catch (e) {
          report(e, 'accessor')
          return undefined
        }
      },
    }
    sources.set(cols, s)
    return s
  }

  /** `(row, index) => key`; failures are recorded in `keyFailures` (reported once per run). */
  function keyReader(rowKey: unknown): (row: unknown, index: number) => RowKey {
    const ok = (k: unknown, index: number): RowKey =>
      typeof k === 'string' || (typeof k === 'number' && !Number.isNaN(k)) ? k : `#${index}`
    if (typeof rowKey === 'function') {
      const fn = rowKey as (row: unknown) => unknown
      return (row, index) => {
        try {
          return ok(fn(row), index)
        } catch (e) {
          keyFailed(index, e)
          return `#${index}`
        }
      }
    }
    if (typeof rowKey === 'string') {
      const path = compilePath(rowKey)
      let cur = 0
      const onError = (e: unknown) => keyFailed(cur, e)
      return (row, index) => {
        cur = index
        return ok(getValue(row, path, onError), index)
      }
    }
    // TODO(T11): DK_MISSING_ROW_KEY / DK_DUPLICATE_ROW_KEY and the `key#n` fallback keys.
    return (_row, index) => index
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
    const prev = last
    if (
      prev &&
      prev.indices === indices &&
      prev.data === data &&
      prev.columns === columns &&
      prev.rowKey === rowKey &&
      prev.model.status === status
    ) {
      return prev.model
    }
    const source = rowSource(resolveColumns(columns))
    const keyOf = keyReader(rowKey)
    const rows = new Array<Row<T>>(indices.length)
    keyFailures.reset()
    try {
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
    const m: RowModel<T> = { rows, filteredCount, totalCount: data.length, status }
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
        ok = true
        // TODO(T27): DK_FEATURE_BAD_OUTPUT for a non-index-array output.
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
      result = build(data, indices, columns, filteredCount, failed ? 'error' : 'idle')
      return indices
    })
    if (result) model = result
    else {
      // pipeline:run failed: the boundary reported it; keep the last good rows.
      model = last
        ? { ...last.model, status: 'error' }
        : { rows: EMPTY, filteredCount: 0, totalCount: 0, status: 'error' }
    }
    return model
  }

  return { run, current: () => model }
}
