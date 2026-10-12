import { describe, expect, it } from 'vitest'
import {
  type AnyFeature,
  columnFilters,
  createTable,
  type Diagnostic,
  type DiagnosticCode,
  defineFeature,
  defineInterceptor,
  type RowModelStatus,
  search,
  sorting,
} from '../index'
import { makeSchema } from '../ingest/test-schemas'
import {
  type AnyTable,
  expectDiagnostic,
  expectNoRowData,
  expectUsable,
  expectWellFormed,
  fail,
  InjectedError,
  loose,
  type Person,
  people,
  reject,
  SECRET,
  settle,
  sink,
  useHarness,
} from './harness'

/**
 * Every user callback slot × every injection that applies to it (§11 fault injection, §8.6):
 * the right code at the exact `where`, a non-empty `fix`, the registry fallback applied (checked
 * through its observable effect), a usable row model, the status the §6.6 rule gives, no row data
 * in any diagnostic and no unhandled rejection (checked after each test by the harness).
 */
useHarness()

type Inject = 'throw' | 'reject' | 'bad return'

interface SlotCase {
  slot: string
  inject: Inject
  code: DiagnosticCode
  where: string
  /** Status after the injection settled (§6.6 status rule, see pipeline/status-rule.ts). */
  status: RowModelStatus
  /** Builds the table and triggers the slot; returns the table. */
  run(onDiagnostic: (d: Diagnostic) => void): AnyTable | Promise<AnyTable>
  /** The fallback's observable effect. */
  fallback(t: AnyTable): void | Promise<void>
}

const ids = (t: AnyTable) => t.getRowModel().rows.map((r) => (r.original as Person).id)
const keys = (t: AnyTable) => t.getRowModel().rows.map((r) => r.key)

/** A test feature with one failing hook. */
const failing = (hook: 'initialState' | 'createApi' | 'rowModel' | 'badOutput'): AnyFeature =>
  defineFeature({
    name: 'probe',
    stage: 'filter',
    initialState: hook === 'initialState' ? fail : () => ({ on: true }),
    createApi: hook === 'createApi' ? fail : () => ({ probeOn: () => true }),
    rowModel:
      hook === 'rowModel'
        ? fail
        : hook === 'badOutput'
          ? () => [0, 1] as unknown as Uint32Array
          : (indices: Uint32Array) => indices,
  })

const sortedBy = (id: string) => ({ sorting: { by: [{ id, desc: false }] } }) as never

const cases: SlotCase[] = [
  // --- rows and columns -------------------------------------------------------------------------
  {
    slot: 'rowKey',
    inject: 'throw',
    code: 'DK_CALLBACK_FAILED',
    where: 'options.rowKey',
    status: 'idle',
    run: (onDiagnostic) => loose(createTable({ data: people(), rowKey: fail, onDiagnostic })),
    fallback: (t) => expect(keys(t)).toEqual(['#0', '#1', '#2']),
  },
  {
    slot: 'columns[i].accessor (column cache, sort step)',
    inject: 'throw',
    code: 'DK_CALLBACK_FAILED',
    where: 'options.columns[1].accessor',
    status: 'idle',
    run: (onDiagnostic) =>
      loose(
        createTable({
          data: people(),
          columns: [{ key: 'id' }, { id: 'calc', accessor: fail }],
          features: [sorting()],
          initialState: sortedBy('calc'),
          onDiagnostic,
        }),
      ),
    // Every cell reads as undefined: missing values keep their input order.
    fallback: (t) => expect(ids(t)).toEqual(['p0', 'p1', 'p2']),
  },
  {
    slot: 'columns[i].accessor (Row.getValue)',
    inject: 'throw',
    code: 'DK_CALLBACK_FAILED',
    where: 'options.columns[1].accessor',
    status: 'idle',
    run: (onDiagnostic) => {
      const t = loose(
        createTable({
          data: people(),
          columns: [{ key: 'id' }, { id: 'calc', accessor: fail }],
          onDiagnostic,
        }),
      )
      t.getRowModel().rows[0]?.getValue('calc')
      return t
    },
    fallback: (t) => expect(t.getRowModel().rows[1]?.getValue('calc')).toBeUndefined(),
  },
  {
    slot: 'columns[i].key (a throwing getter in the data)',
    inject: 'throw',
    code: 'DK_CALLBACK_FAILED',
    where: 'options.columns[0].key',
    status: 'idle',
    run: (onDiagnostic) => {
      const data = people()
      Object.defineProperty(data[0], 'n', { get: fail, enumerable: true })
      return loose(
        createTable({
          data,
          columns: [{ key: 'n' }, { key: 'id' }],
          features: [sorting()],
          initialState: sortedBy('n'),
          onDiagnostic,
        }),
      )
    },
    // p0's value is missing: sorted last.
    fallback: (t) => expect(ids(t)).toEqual(['p1', 'p2', 'p0']),
  },
  {
    slot: 'columns[i].format',
    inject: 'throw',
    code: 'DK_CALLBACK_FAILED',
    where: 'options.columns[0].format',
    status: 'idle',
    run: async (onDiagnostic) => {
      const t = loose(
        createTable({
          data: people(),
          columns: [{ key: 'name', format: fail }],
          features: [search()],
          onDiagnostic,
        }),
      )
      await t.setSearch('ada' as never)
      return t
    },
    // Every cell formats as '': nothing matches.
    fallback: (t) => expect(t.getRowModel().filteredCount).toBe(0),
  },
  {
    slot: 'columns[i].format',
    inject: 'bad return',
    code: 'DK_CALLBACK_BAD_RETURN',
    where: 'options.columns[0].format',
    status: 'idle',
    run: async (onDiagnostic) => {
      const t = loose(
        createTable({
          data: people(),
          columns: [{ key: 'n', format: ((v: number) => v * 100) as never }],
          features: [search()],
          onDiagnostic,
        }),
      )
      await t.setSearch('200' as never)
      return t
    },
    // Coerced with the default formatter: 200 → '200', the best match for '200'.
    fallback: (t) => expect(ids(t)[0]).toBe('p2'),
  },
  // --- sorting ----------------------------------------------------------------------------------
  {
    slot: 'columns[i].sortFn',
    inject: 'throw',
    code: 'DK_CALLBACK_FAILED',
    where: 'options.columns[0].sortFn',
    status: 'idle',
    run: (onDiagnostic) =>
      loose(
        createTable({
          data: people(),
          columns: [{ key: 'n', sortable: true, sortFn: fail }],
          features: [sorting()],
          initialState: sortedBy('n'),
          onDiagnostic,
        }),
      ),
    // The default comparator sorted the column.
    fallback: (t) => expect(ids(t)).toEqual(['p1', 'p2', 'p0']),
  },
  {
    slot: 'columns[i].sortFn',
    inject: 'bad return',
    code: 'DK_SORT_COMPARATOR_INVALID',
    where: 'options.columns[0].sortFn',
    status: 'idle',
    run: (onDiagnostic) =>
      loose(
        createTable({
          data: people(),
          columns: [{ key: 'n', sortable: true, sortFn: () => Number.NaN }],
          features: [sorting()],
          initialState: sortedBy('n'),
          onDiagnostic,
        }),
      ),
    fallback: (t) => expect(ids(t)).toEqual(['p1', 'p2', 'p0']),
  },
  {
    slot: 'columns[i].sortBy',
    inject: 'throw',
    code: 'DK_CALLBACK_FAILED',
    where: 'options.columns[0].sortBy',
    status: 'idle',
    run: (onDiagnostic) =>
      loose(
        createTable({
          data: people(),
          columns: [{ key: 'name', sortable: true, sortBy: fail }],
          features: [sorting()],
          initialState: sortedBy('name'),
          onDiagnostic,
        }),
      ),
    // Every key is missing: input order.
    fallback: (t) => expect(ids(t)).toEqual(['p0', 'p1', 'p2']),
  },
  {
    slot: 'columns[i].sortAlgorithm',
    inject: 'throw',
    code: 'DK_CALLBACK_FAILED',
    where: 'options.columns[0].sortAlgorithm',
    status: 'idle',
    run: (onDiagnostic) =>
      loose(
        createTable({
          data: people(),
          columns: [{ key: 'n', sortAlgorithm: fail }],
          features: [sorting()],
          initialState: sortedBy('n'),
          onDiagnostic,
        }),
      ),
    // Sorted with the native algorithm instead.
    fallback: (t) => expect(ids(t)).toEqual(['p1', 'p2', 'p0']),
  },
  {
    slot: 'columns[i].sortAlgorithm',
    inject: 'bad return',
    code: 'DK_CALLBACK_BAD_RETURN',
    where: 'options.columns[0].sortAlgorithm',
    status: 'idle',
    run: (onDiagnostic) =>
      loose(
        createTable({
          data: people(),
          columns: [{ key: 'n', sortAlgorithm: (() => [2, 1, 0]) as never }],
          features: [sorting()],
          initialState: sortedBy('n'),
          onDiagnostic,
        }),
      ),
    fallback: (t) => expect(ids(t)).toEqual(['p1', 'p2', 'p0']),
  },
  {
    slot: 'sorting({ algorithm })',
    inject: 'throw',
    code: 'DK_CALLBACK_FAILED',
    where: 'options.sorting.algorithm',
    status: 'idle',
    run: (onDiagnostic) =>
      loose(
        createTable({
          data: people(),
          columns: [{ key: 'n' }],
          features: [sorting({ algorithm: fail })],
          initialState: sortedBy('n'),
          onDiagnostic,
        }),
      ),
    fallback: (t) => expect(ids(t)).toEqual(['p1', 'p2', 'p0']),
  },
  // --- filters ----------------------------------------------------------------------------------
  {
    slot: 'state.columnFilters[id].fn (custom filter)',
    inject: 'throw',
    code: 'DK_CALLBACK_FAILED',
    where: 'options.state.columnFilters.n.fn',
    status: 'idle',
    run: (onDiagnostic) => {
      const t = loose(
        createTable({
          data: people(),
          columns: [{ key: 'n' }],
          features: [columnFilters()],
          onDiagnostic,
        }),
      )
      t.setColumnFilter('n' as never, { type: 'custom', fn: fail } as never)
      t.getRowModel()
      return t
    },
    // Failed rows are non-matching.
    fallback: (t) => expect(t.getRowModel().filteredCount).toBe(0),
  },
  // --- schema -----------------------------------------------------------------------------------
  {
    slot: 'schema',
    inject: 'throw',
    code: 'DK_SCHEMA_CRASHED',
    where: 'options.schema',
    status: 'idle',
    run: (onDiagnostic) =>
      loose(createTable({ data: people(), schema: makeSchema<Person>(fail), onDiagnostic })),
    // Each row gets a synthetic issue and is handled per invalidRows ('drop').
    fallback: (t) => {
      expect(t.getRowModel().rows).toHaveLength(0)
      expect(t.getInvalidRows()).toHaveLength(3)
    },
  },
  {
    slot: 'schema',
    inject: 'reject',
    code: 'DK_SCHEMA_CRASHED',
    where: 'options.schema',
    status: 'idle',
    run: async (onDiagnostic) => {
      const t = loose(
        createTable({
          data: people(),
          schema: makeSchema<Person>(fail, { async: true }),
          onDiagnostic,
        }),
      )
      await settle()
      return t
    },
    fallback: (t) => expect(t.getInvalidRows()).toHaveLength(3),
  },
  // --- async sources ----------------------------------------------------------------------------
  ...(['throw', 'reject'] as const).map(
    (inject): SlotCase => ({
      slot: 'fetcher',
      inject,
      code: 'DK_FETCH_FAILED',
      where: 'options.fetcher',
      status: 'error',
      run: async (onDiagnostic) => {
        const t = loose(
          createTable({
            features: [sorting({ mode: 'server' })],
            fetcher: inject === 'throw' ? fail : reject,
            onDiagnostic,
          }),
        )
        await settle()
        return t
      },
      fallback: async (t) => {
        // Never rejects; nothing applied, so still the initial load.
        await expect(t.refetch()).resolves.toEqual({ status: 'error' })
        expect(t.getRowModel().isInitialLoad).toBe(true)
      },
    }),
  ),
  {
    slot: 'fetcher',
    inject: 'bad return',
    code: 'DK_FETCH_BAD_RESPONSE',
    where: 'options.fetcher',
    status: 'error',
    run: async (onDiagnostic) => {
      const t = loose(
        createTable({
          features: [sorting({ mode: 'server' })],
          fetcher: (() => ({ items: [] })) as never,
          onDiagnostic,
        }),
      )
      await settle()
      return t
    },
    fallback: async (t) => {
      await expect(t.refetch()).resolves.toEqual({ status: 'error' })
      expect(t.getRowModel().rows).toHaveLength(0)
    },
  },
  ...(['throw', 'reject', 'bad return'] as const).map(
    (inject): SlotCase => ({
      slot: 'search({ searchFn })',
      inject,
      code: 'DK_SEARCH_FAILED',
      where: 'options.searchFn',
      status: 'error',
      run: async (onDiagnostic) => {
        const searchFn =
          inject === 'throw' ? fail : inject === 'reject' ? reject : () => 42 as never
        const t = loose(
          createTable({ data: people(), features: [search({ searchFn })], onDiagnostic }),
        )
        await expect(t.setSearch('ada' as never)).resolves.toEqual({ status: 'error' })
        return t
      },
      // The previous results (every row) are kept.
      fallback: (t) => expect(ids(t)).toEqual(['p0', 'p1', 'p2']),
    }),
  ),
  // --- state ------------------------------------------------------------------------------------
  {
    slot: 'setState(updater)',
    inject: 'throw',
    code: 'DK_CALLBACK_FAILED',
    where: 'operation table.setState at updater',
    status: 'idle',
    run: (onDiagnostic) => {
      const t = loose(createTable({ data: people(), initialState: { x: 1 }, onDiagnostic }))
      t.setState(fail)
      return t
    },
    fallback: (t) => expect(t.getState()).toEqual({ x: 1 }),
  },
  {
    slot: 'feature ctx.setState(updater)',
    inject: 'throw',
    code: 'DK_CALLBACK_FAILED',
    where: 'operation probe.setState at updater',
    status: 'idle',
    run: (onDiagnostic) => {
      const probe = defineFeature({
        name: 'probe',
        stage: 'none',
        initialState: () => 1,
        createApi: (ctx) => ({ probeSet: (fn: (n: number) => number) => ctx.setState(fn) }),
      })
      const t = loose(createTable({ data: people(), features: [probe], onDiagnostic }))
      t.probeSet(fail as never)
      return t
    },
    fallback: (t) => expect(t.getState().probe).toBe(1),
  },
  {
    slot: 'onStateChange',
    inject: 'throw',
    code: 'DK_CALLBACK_FAILED',
    where: 'options.onStateChange',
    status: 'idle',
    run: (onDiagnostic) => {
      const t = loose(
        createTable({
          data: people(),
          columns: [{ key: 'n' }],
          features: [sorting()],
          state: { sorting: { by: [] } },
          onStateChange: fail,
          onDiagnostic,
        }),
      )
      t.toggleSort('n' as never)
      return t
    },
    // Nothing committed: the state is unchanged.
    fallback: (t) => expect(t.getState().sorting).toEqual({ by: [] }),
  },
  {
    slot: 'subscribe(listener)',
    inject: 'throw',
    code: 'DK_LISTENER_FAILED',
    where: 'operation table.subscribe at listener #1',
    status: 'idle',
    run: (onDiagnostic) => {
      const t = loose(createTable({ data: people(), onDiagnostic }))
      t.subscribe(fail)
      let calls = 0
      t.subscribe(() => void calls++)
      t.setState({ x: 1 })
      expect(calls).toBe(1)
      return t
    },
    fallback: (t) => expect(t.getState()).toEqual({ x: 1 }),
  },
  // --- interceptors -----------------------------------------------------------------------------
  ...(['state:dispatch', 'pipeline:run', 'data:ingest', 'table:setOptions'] as const).map(
    (op): SlotCase => ({
      slot: `interceptors[i].intercept on ${op}`,
      inject: 'throw',
      code: 'DK_INTERCEPTOR_FAILED',
      where: `interceptor "boom" on ${op}`,
      status: 'idle',
      run: (onDiagnostic) => {
        const t = loose(
          createTable({
            data: people(),
            interceptors: [defineInterceptor({ name: 'boom', on: [op], intercept: fail })],
            onDiagnostic,
          }),
        )
        t.setState({ x: 1 })
        t.setOptions({ data: people().slice(0, 2) })
        return t
      },
      // Skipped: its next ran directly, so every op still did its work.
      fallback: (t) => {
        expect(t.getState()).toEqual({ x: 1 })
        expect(t.getRowModel().rows).toHaveLength(2)
      },
    }),
  ),
  {
    slot: 'interceptors[i].intercept on column:batch (hot)',
    inject: 'throw',
    code: 'DK_INTERCEPTOR_FAILED',
    where: 'interceptor "boom" on column:batch',
    status: 'idle',
    run: (onDiagnostic) =>
      loose(
        createTable({
          data: people(),
          columns: [{ key: 'n' }],
          features: [sorting()],
          initialState: sortedBy('n'),
          interceptors: [
            defineInterceptor({ name: 'boom', on: ['column:batch'], hot: true, intercept: fail }),
          ],
          onDiagnostic,
        }),
      ),
    fallback: (t) => expect(ids(t)).toEqual(['p1', 'p2', 'p0']),
  },
  {
    slot: 'interceptors[i].intercept on async:request',
    inject: 'reject',
    code: 'DK_INTERCEPTOR_FAILED',
    where: 'interceptor "boom" on async:request',
    status: 'idle',
    run: async (onDiagnostic) => {
      const t = loose(
        createTable({
          features: [sorting({ mode: 'server' })],
          fetcher: () => ({ rows: people() }),
          interceptors: [
            defineInterceptor({ name: 'boom', on: ['async:request'], intercept: reject }),
          ],
          onDiagnostic,
        }),
      )
      await settle()
      return t
    },
    fallback: async (t) => {
      expect(t.getRowModel().rows).toHaveLength(3)
      await expect(t.refetch()).resolves.toEqual({ status: 'applied' })
    },
  },
  // --- features ---------------------------------------------------------------------------------
  {
    slot: 'feature initialState()',
    inject: 'throw',
    code: 'DK_FEATURE_FAILED',
    where: 'feature "probe"',
    status: 'idle',
    run: (onDiagnostic) =>
      loose(createTable({ data: people(), features: [failing('initialState')], onDiagnostic })),
    fallback: (t) => expect(t.getState().probe).toBeUndefined(),
  },
  {
    slot: 'feature createApi()',
    inject: 'throw',
    code: 'DK_FEATURE_FAILED',
    where: 'feature "probe"',
    status: 'idle',
    run: (onDiagnostic) =>
      loose(createTable({ data: people(), features: [failing('createApi')], onDiagnostic })),
    fallback: (t) => expect(Object.hasOwn(t, 'probeOn')).toBe(false),
  },
  {
    slot: 'feature rowModel()',
    inject: 'throw',
    code: 'DK_FEATURE_FAILED',
    where: 'feature "probe"',
    status: 'error',
    run: (onDiagnostic) =>
      loose(createTable({ data: people(), features: [failing('rowModel')], onDiagnostic })),
    // The step passed its input through.
    fallback: (t) => expect(ids(t)).toEqual(['p0', 'p1', 'p2']),
  },
  {
    slot: 'feature rowModel()',
    inject: 'bad return',
    code: 'DK_FEATURE_BAD_OUTPUT',
    where: 'feature "probe"',
    status: 'error',
    run: (onDiagnostic) =>
      loose(createTable({ data: people(), features: [failing('badOutput')], onDiagnostic })),
    fallback: (t) => expect(ids(t)).toEqual(['p0', 'p1', 'p2']),
  },
]

describe('every callback slot × injection (§11)', () => {
  it.each(cases.map((c) => [`${c.slot} — ${c.inject}`, c] as const))('%s', async (_name, c) => {
    const { seen, onDiagnostic } = sink()
    const table = await c.run(onDiagnostic)
    // The row model is lazy: reading it runs the pipeline (and the slots it calls).
    table.getRowModel()
    await settle()
    expectDiagnostic(seen, c.code, c.where)
    expectWellFormed(seen)
    expectNoRowData(seen)
    const m = expectUsable(table)
    expect(m.status).toBe(c.status)
    await c.fallback(table)
  })
})

describe('slots without a diagnostic of their own', () => {
  it('onDiagnostic throwing is swallowed with one console.error; the table keeps working', () => {
    const t = loose(
      createTable({
        data: people(),
        rowKey: fail,
        onDiagnostic: fail,
      }),
    )
    expect(() => t.getRowModel()).not.toThrow()
    t.setOptions({ data: people() })
    expectUsable(t)
    // Still recorded: getDiagnostics() does not depend on the user sink.
    expect(t.getDiagnostics().map((d) => d.code)).toContain('DK_CALLBACK_FAILED')
    // One console.error for the failing sink (the console sink logs the diagnostics themselves).
    const calls = (console.error as unknown as { mock: { calls: unknown[][] } }).mock.calls
    const sinkFailures = calls.filter((c) => c[1] instanceof InjectedError)
    expect(sinkFailures).toHaveLength(1)
    expect(String(sinkFailures[0]?.[0])).toMatch(/diagnostics pipeline failed/)
  })

  it('diagnostics.redact throwing never kills the table and leaks no row data', () => {
    const { seen, onDiagnostic } = sink()
    const t = loose(
      createTable({
        data: people(),
        rowKey: fail,
        diagnostics: { redact: fail },
        onDiagnostic,
      }),
    )
    expect(() => t.getRowModel()).not.toThrow()
    expectUsable(t)
    expectNoRowData(seen)
    expectNoRowData(t.getDiagnostics())
    expect(JSON.stringify(t.getDiagnostics())).not.toContain(SECRET)
  })
})

describe("a failure that sets 'error' is never silent (§6.6)", () => {
  /** Statuses listeners saw, read from the row model inside each notification. */
  const watch = (t: AnyTable) => {
    const statuses: string[] = []
    t.subscribe(() => void statuses.push(t.getRowModel().status))
    return statuses
  }

  it.each(['throw', 'reject', 'bad return'] as const)('fetcher %s', async (inject) => {
    const t = loose(
      createTable({
        features: [sorting({ mode: 'server' })],
        fetcher: inject === 'throw' ? fail : inject === 'reject' ? reject : ((() => 1) as never),
      }),
    )
    const statuses = watch(t)
    await settle()
    expect(statuses.at(-1)).toBe('error')
    // A retry that fails again: 'error' throughout (error > fetching, §6.6).
    await expect(t.refetch()).resolves.toEqual({ status: 'error' })
    expect(t.getRowModel().status).toBe('error')
  })

  it.each(['throw', 'reject', 'bad return'] as const)('searchFn %s', async (inject) => {
    const searchFn = inject === 'throw' ? fail : inject === 'reject' ? reject : () => 42 as never
    const t = loose(createTable({ data: people(), features: [search({ searchFn })] }))
    const statuses = watch(t)
    await t.setSearch('ada')
    expect(statuses).toContain('searching')
    expect(statuses.at(-1)).toBe('error')
  })

  it('a feature rowModel that starts throwing after a state change', () => {
    let throwing = false
    const probe = defineFeature({
      name: 'probe',
      stage: 'filter',
      initialState: () => 0,
      createApi: () => ({}),
      rowModel: (i: Uint32Array) => (throwing ? fail() : i),
    })
    const t = loose(createTable({ data: people(), features: [probe] }))
    const statuses = watch(t)
    throwing = true
    t.setState({ probe: 1 })
    expect(statuses).toEqual(['error'])
  })
})

describe('an interceptor that fails after calling next()', () => {
  it('sync: reported once and the op is not run twice', () => {
    const { seen, onDiagnostic } = sink()
    const t = loose(
      createTable({
        data: people(),
        columns: [{ key: 'n' }],
        features: [sorting()],
        interceptors: [
          defineInterceptor({
            name: 'late',
            on: ['state:dispatch'],
            intercept: (_ctx, next) => {
              next()
              return fail()
            },
          }),
        ],
        onDiagnostic,
      }),
    )
    t.toggleSort('n')
    // One toggle (asc), not two (desc).
    expect(t.getSortDirection('n')).toBe('asc')
    expectDiagnostic(seen, 'DK_INTERCEPTOR_FAILED', 'interceptor "late" on state:dispatch')
    expectNoRowData(seen)
  })

  it('async: its rejection after next() keeps the result; the fetcher ran once', async () => {
    const { seen, onDiagnostic } = sink()
    let calls = 0
    const t = loose(
      createTable({
        features: [sorting({ mode: 'server' })],
        fetcher: () => {
          calls++
          return { rows: people() }
        },
        interceptors: [
          defineInterceptor({
            name: 'late',
            on: ['async:request'],
            intercept: async (_ctx, next) => {
              await next()
              return reject()
            },
          }),
        ],
        onDiagnostic,
      }),
    )
    await settle()
    expect(calls).toBe(1)
    expect(t.getRowModel().rows).toHaveLength(3)
    expect(t.getRowModel().status).toBe('idle')
    expectDiagnostic(seen, 'DK_INTERCEPTOR_FAILED', 'interceptor "late" on async:request')
  })
})
