import { describe, expect, it } from 'vitest'
import {
  type AnyFeature,
  columnFilters,
  createTable,
  defineFeature,
  defineInterceptor,
  pagination,
  search,
  sorting,
  validity,
} from '../index'
import { makeSchema } from '../ingest/test-schemas'
import {
  type AnyTable,
  expectNoRowData,
  expectUsable,
  expectWellFormed,
  fail,
  loose,
  type Person,
  people,
  reject,
  settle,
  sink,
  useHarness,
} from './harness'

/**
 * Every public method × every callback slot (§11, §8.6 "every public method is guarded"): with one
 * slot failing, each table method and each built-in feature API method is called. None throws;
 * each returns its declared value (promises resolve, never reject); the row model stays usable and
 * every diagnostic is well-formed with no row data. Then the same after `destroy()`.
 */
useHarness()

const isPromise = (v: unknown) => v instanceof Promise

/** A promise that resolves to an `{ status }` outcome (setSearch / flushSearch / refetch). */
async function outcome(v: unknown, statuses: readonly string[]) {
  expect(isPromise(v)).toBe(true)
  const r = (await v) as { status: string }
  expect(statuses).toContain(r.status)
}

const OUTCOMES = ['applied', 'superseded', 'error'] as const

interface MethodCase {
  method: string
  call(t: AnyTable): unknown
  /** Checks the declared return value. */
  returns(v: unknown, t: AnyTable): void | Promise<void>
}

const none = (v: unknown) => expect(v).toBeUndefined()
const bool = (v: unknown) => expect(typeof v).toBe('boolean')

const methods: MethodCase[] = [
  // --- table (§3.2) ---
  { method: 'getState', call: (t) => t.getState(), returns: (v) => expect(v).toBeTypeOf('object') },
  { method: 'setState', call: (t) => t.setState({ x: 1 }), returns: none },
  {
    method: 'subscribe',
    call: (t) => t.subscribe(() => {}),
    returns: (v) => {
      expect(v).toBeTypeOf('function')
      expect(() => (v as () => void)()).not.toThrow()
    },
  },
  {
    method: 'setOptions',
    call: (t) => t.setOptions({ data: people().slice(1) }),
    returns: none,
  },
  {
    method: 'getOptions',
    call: (t) => t.getOptions(),
    returns: (v) => expect(v).toBeTypeOf('object'),
  },
  {
    method: 'getData',
    call: (t) => t.getData(),
    returns: (v) => expect(Array.isArray(v)).toBe(true),
  },
  {
    method: 'getRowModel',
    call: (t) => t.getRowModel(),
    returns: (v) => expect((v as { rows: unknown }).rows).toBeInstanceOf(Array),
  },
  {
    method: 'getInvalidRows',
    call: (t) => t.getInvalidRows(),
    returns: (v) => expect(Array.isArray(v)).toBe(true),
  },
  {
    method: 'getDiagnostics',
    call: (t) => t.getDiagnostics(),
    returns: (v) => expect(Array.isArray(v)).toBe(true),
  },
  { method: 'refetch', call: (t) => t.refetch(), returns: (v) => outcome(v, OUTCOMES) },
  // --- Row (§6.6) ---
  {
    method: 'Row.getValue',
    call: (t) => t.getRowModel().rows.map((r) => ['id', 'name', 'n', 'calc'].map(r.getValue, r)),
    returns: (v) => expect(Array.isArray(v)).toBe(true),
  },
  {
    method: 'Row.getCellIssues',
    call: (t) =>
      t
        .getRowModel()
        .rows.map((r) =>
          (r as unknown as { getCellIssues(id: string): unknown }).getCellIssues('n'),
        ),
    returns: (v) => {
      for (const issues of v as unknown[]) expect(Array.isArray(issues)).toBe(true)
    },
  },
  // --- columnFilters (§6.1) ---
  {
    method: 'setColumnFilter',
    call: (t) => t.setColumnFilter('n' as never, { type: 'range', value: { min: 1 } } as never),
    returns: none,
  },
  { method: 'resetColumnFilters', call: (t) => t.resetColumnFilters(), returns: none },
  // --- validity (§6.2) ---
  { method: 'setValidity', call: (t) => t.setValidity('all' as never), returns: none },
  // --- search (§6.3) ---
  {
    method: 'setSearch',
    call: (t) => t.setSearch('ada' as never),
    returns: (v) => outcome(v, OUTCOMES),
  },
  { method: 'flushSearch', call: (t) => t.flushSearch(), returns: (v) => outcome(v, OUTCOMES) },
  { method: 'cancelSearch', call: (t) => t.cancelSearch(), returns: none },
  { method: 'clearSearch', call: (t) => t.clearSearch(), returns: none },
  // --- sorting (§6.4) ---
  { method: 'toggleSort', call: (t) => t.toggleSort('n' as never), returns: none },
  {
    method: 'setSorting',
    call: (t) => t.setSorting([{ id: 'name', desc: true }] as never),
    returns: none,
  },
  { method: 'clearSorting', call: (t) => t.clearSorting(), returns: none },
  {
    method: 'getSortDirection',
    call: (t) => t.getSortDirection('n' as never),
    returns: (v) => expect([false, 'asc', 'desc']).toContain(v),
  },
  // --- pagination (§6.5) ---
  { method: 'setPageIndex', call: (t) => t.setPageIndex(1 as never), returns: none },
  { method: 'setPageSize', call: (t) => t.setPageSize(2 as never), returns: none },
  { method: 'nextPage', call: (t) => t.nextPage(), returns: none },
  { method: 'prevPage', call: (t) => t.prevPage(), returns: none },
  {
    method: 'getPageCount',
    call: (t) => t.getPageCount(),
    returns: (v) => expect(Number.isInteger(v)).toBe(true),
  },
  { method: 'canNextPage', call: (t) => t.canNextPage(), returns: bool },
  { method: 'canPrevPage', call: (t) => t.canPrevPage(), returns: bool },
  // --- last: teardown ---
  { method: 'destroy', call: (t) => t.destroy(), returns: none },
]

/** A table with the whole preset and a column of each kind. `patch` injects one failing slot. */
type Fault = {
  slot: string
  options?: Record<string, unknown>
  features?: () => AnyFeature[]
  /** After creation (e.g. a failing listener). */
  after?: (t: AnyTable) => void
  /** Feature API methods this configuration does not install. */
  absent?: readonly string[]
}

const preset = (
  opts: { searchFn?: unknown; algorithm?: unknown; mode?: 'server' } = {},
): AnyFeature[] => [
  columnFilters(opts.mode ? { mode: opts.mode } : {}),
  // validity has no server mode; a client filter step before server steps is DK_MODE_ORDER.
  ...(opts.mode ? [] : [validity()]),
  search({
    ...(opts.searchFn ? { searchFn: opts.searchFn as never } : {}),
    ...(opts.mode ? { mode: opts.mode } : {}),
  }),
  sorting({
    ...(opts.algorithm ? { algorithm: opts.algorithm as never } : {}),
    ...(opts.mode ? { mode: opts.mode } : {}),
  }),
  pagination({ pageSize: 2, ...(opts.mode ? { mode: opts.mode } : {}) }),
]

const failingFeature = (hook: 'initialState' | 'createApi' | 'rowModel'): AnyFeature =>
  defineFeature({
    name: 'probe',
    stage: 'filter',
    initialState: hook === 'initialState' ? fail : () => 0,
    createApi: hook === 'createApi' ? fail : () => ({}),
    rowModel: hook === 'rowModel' ? fail : (i: Uint32Array) => i,
  })

const columns = (patch: Record<string, unknown> = {}) => [
  { key: 'id' },
  { key: 'name', ...(patch.name as object) },
  { key: 'n', ...(patch.n as object) },
  { id: 'calc', accessor: (r: Person) => r.n * 2, ...(patch.calc as object) },
]

const faults: Fault[] = [
  { slot: 'none (baseline)' },
  { slot: 'rowKey', options: { rowKey: fail } },
  { slot: 'columns[i].accessor', options: { columns: columns({ calc: { accessor: fail } }) } },
  { slot: 'columns[i].format', options: { columns: columns({ name: { format: fail } }) } },
  {
    slot: 'columns[i].sortFn',
    options: { columns: columns({ n: { sortable: true, sortFn: fail } }) },
  },
  {
    slot: 'columns[i].sortBy',
    options: { columns: columns({ name: { sortable: true, sortBy: fail } }) },
  },
  {
    slot: 'columns[i].sortAlgorithm',
    options: { columns: columns({ n: { sortAlgorithm: fail } }) },
  },
  { slot: 'sorting({ algorithm })', features: () => preset({ algorithm: fail }) },
  {
    slot: 'state.columnFilters[id].fn',
    options: { initialState: { columnFilters: { n: { type: 'custom', fn: fail } } } },
  },
  { slot: 'schema (throws)', options: { schema: makeSchema<Person>(fail) } },
  { slot: 'schema (rejects)', options: { schema: makeSchema<Person>(fail, { async: true }) } },
  { slot: 'search({ searchFn }) throws', features: () => preset({ searchFn: fail }) },
  { slot: 'search({ searchFn }) rejects', features: () => preset({ searchFn: reject }) },
  {
    slot: 'fetcher throws',
    absent: ['setValidity'],
    options: { data: undefined, fetcher: fail },
    features: () => preset({ mode: 'server' }),
  },
  {
    slot: 'fetcher rejects',
    absent: ['setValidity'],
    options: { data: undefined, fetcher: reject },
    features: () => preset({ mode: 'server' }),
  },
  {
    slot: 'onStateChange',
    options: { state: { sorting: { by: [] }, search: undefined }, onStateChange: fail },
  },
  { slot: 'onDiagnostic', options: { onDiagnostic: fail, rowKey: fail } },
  { slot: 'diagnostics.redact', options: { diagnostics: { redact: fail }, rowKey: fail } },
  {
    slot: "interceptors[i].intercept on '*' (sync throw)",
    options: {
      interceptors: [defineInterceptor({ name: 'boom', on: '*', hot: true, intercept: fail })],
    },
  },
  {
    slot: 'interceptors[i].intercept on async:request (reject)',
    options: {
      interceptors: [defineInterceptor({ name: 'boom', on: ['async:request'], intercept: reject })],
    },
    features: () => preset({ searchFn: () => [] }),
  },
  { slot: 'subscribe(listener)', after: (t) => void t.subscribe(fail) },
  { slot: 'feature initialState()', features: () => [...preset(), failingFeature('initialState')] },
  { slot: 'feature createApi()', features: () => [...preset(), failingFeature('createApi')] },
  { slot: 'feature rowModel()', features: () => [...preset(), failingFeature('rowModel')] },
]

function build(fault: Fault) {
  const { seen, onDiagnostic } = sink()
  const t = loose(
    createTable({
      data: people(),
      rowKey: 'id',
      columns: columns(),
      features: fault.features?.() ?? preset(),
      onDiagnostic,
      ...fault.options,
    } as never),
  )
  fault.after?.(t)
  return { t, seen }
}

describe('the method list covers every public method', () => {
  it('every function on a preset table is in the method list', () => {
    const { t } = build({ slot: 'none' })
    const listed = new Set(methods.map((m) => m.method))
    const own = Object.keys(t).filter(
      (k) => typeof (t as Record<string, unknown>)[k] === 'function',
    )
    expect(own.filter((k) => !listed.has(k))).toEqual([])
  })
})

describe.each(faults.map((f) => [f.slot, f] as const))('with %s failing', (_slot, fault) => {
  const present = methods.filter((m) => !fault.absent?.includes(m.method))
  it.each(present.map((m) => [m.method, m] as const))('%s never throws', async (_m, m) => {
    const { t, seen } = build(fault)
    await settle()
    let value: unknown
    expect(() => {
      value = m.call(t)
    }).not.toThrow()
    await m.returns(value, t)
    await settle()
    expectUsable(t)
    expectWellFormed(seen)
    expectNoRowData(seen)
    expectNoRowData(t.getDiagnostics())
  })

  it('every method after destroy() is a no-op returning its declared value', async () => {
    const { t, seen } = build(fault)
    await settle()
    t.destroy()
    for (const m of present) {
      let value: unknown
      expect(() => {
        value = m.call(t)
      }, m.method).not.toThrow()
      await m.returns(value, t)
    }
    await settle()
    expectWellFormed(seen)
    expectNoRowData(seen)
  })
})
