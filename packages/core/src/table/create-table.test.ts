import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DatakableError } from '../diagnostics/build'
import { defineDiagnostic } from '../diagnostics/catalog'
import type { Diagnostic } from '../diagnostics/types'
import { defineInterceptor } from '../intercept/define'
import { FALLBACK } from '../intercept/fallbacks'
import { createTable } from './create-table'
import { FEEDBACK_MS } from './state-feedback'
import { UPDATE_DEPTH_LIMIT } from './types'

declare module '../diagnostics/catalog' {
  interface DiagnosticCatalog {
    DK_TEST_TABLE_VALUE: { column: string; value: unknown; key: unknown }
  }
}

defineDiagnostic({
  code: 'DK_TEST_TABLE_VALUE',
  level: 'warn',
  where: (d) => ({ kind: 'option', path: `columns.${d.column}` }),
  problem: (d) => `value ${String(d.value)} with key ${String(d.key)}`,
  impact: () => 'none',
  fix: () => ['nothing'],
  redact: { value: 'value', key: 'rowKey' },
})

type Row = { id: number; email: string }
type S = { sorting: string[]; page: number; query: string }

const rows: Row[] = [
  { id: 1, email: 'a@x.io' },
  { id: 2, email: 'b@x.io' },
]

let seen: Diagnostic[]
const onDiagnostic = (d: Diagnostic) => {
  seen.push(d)
}
const codes = () => seen.map((d) => d.code)

beforeEach(() => {
  seen = []
  for (const m of ['error', 'warn', 'info', 'log', 'groupCollapsed', 'group', 'groupEnd'] as const)
    vi.spyOn(console, m).mockImplementation(() => {})
})
afterEach(() => {
  vi.restoreAllMocks()
})

const make = (extra: Partial<Parameters<typeof createTable<Row, S>>[0]> = {}) =>
  createTable<Row, S>({
    data: rows,
    initialState: { sorting: [], page: 0, query: '' },
    onDiagnostic,
    ...extra,
  })

describe('createTable: state', () => {
  it('returns the initial state and keeps the snapshot reference until a change', () => {
    const t = make()
    const a = t.getState()
    expect(a).toEqual({ sorting: [], page: 0, query: '' })
    expect(t.getState()).toBe(a)
    t.setState({ page: 0 })
    expect(t.getState()).toBe(a)
    t.setState({ page: 1 })
    const b = t.getState()
    expect(b).not.toBe(a)
    expect(b).toEqual({ sorting: [], page: 1, query: '' })
    expect(a.page).toBe(0)
  })

  it('accepts a function updater and merges partial results per slice', () => {
    const t = make()
    t.setState((prev) => ({ page: prev.page + 2 }))
    expect(t.getState()).toEqual({ sorting: [], page: 2, query: '' })
  })

  it('snapshots are frozen in development', () => {
    const t = make()
    expect(Object.isFrozen(t.getState())).toBe(true)
  })

  it('gives the data', () => {
    const t = make()
    expect(t.getData()).toBe(rows)
  })
})

describe('createTable: subscribe', () => {
  it('notifies listeners with (state, prev) and stops after unsubscribe', () => {
    const t = make()
    const calls: [number, number][] = []
    const off = t.subscribe((s, p) => calls.push([s.page, p.page]))
    t.setState({ page: 3 })
    t.setState({ page: 3 })
    off()
    t.setState({ page: 4 })
    expect(calls).toEqual([[3, 0]])
  })

  it('a throwing listener does not stop the others (DK_LISTENER_FAILED)', () => {
    const t = make()
    const order: string[] = []
    t.subscribe(() => order.push('a'))
    t.subscribe(() => {
      throw new Error('boom')
    })
    t.subscribe(() => order.push('c'))
    t.setState({ page: 1 })
    expect(order).toEqual(['a', 'c'])
    expect(codes()).toEqual(['DK_LISTENER_FAILED'])
    const d = seen[0] as Diagnostic
    expect(d.level).toBe('error')
    expect(d.where).toEqual({ kind: 'operation', op: 'table.subscribe', slot: 'listener #2' })
    expect(d.context.trigger).toBe('api:setState')
    expect(d.context.cause).toBeInstanceOf(Error)
    expect(d.fix.length).toBeGreaterThan(0)
  })

  it('under strict, every listener still runs, then the DatakableError is thrown', () => {
    const t = make({ strict: true })
    const order: string[] = []
    t.subscribe(() => {
      throw new Error('boom')
    })
    t.subscribe(() => order.push('b'))
    expect(() => t.setState({ page: 1 })).toThrow(DatakableError)
    expect(order).toEqual(['b'])
    expect(t.getState().page).toBe(1)
  })

  it('a listener unsubscribing another during notify does not break the loop', () => {
    const t = make()
    const order: string[] = []
    let offB = () => {}
    t.subscribe(() => {
      order.push('a')
      offB()
    })
    offB = t.subscribe(() => order.push('b'))
    t.setState({ page: 1 })
    t.setState({ page: 2 })
    expect(order).toEqual(['a', 'b', 'a'])
  })
})

describe('createTable: update loop guard', () => {
  it('re-entrant updates run in further rounds; every listener sees the latest state', () => {
    const t = make()
    const pages: number[] = []
    t.subscribe((s) => {
      if (s.page < 3) t.setState({ page: s.page + 1 })
    })
    t.subscribe((s) => pages.push(s.page))
    t.setState({ page: 1 })
    expect(t.getState().page).toBe(3)
    expect(pages).toEqual([1, 2, 3])
    expect(seen).toEqual([])
  })

  it('drops updates past the depth limit (DK_UPDATE_LOOP) and recovers', () => {
    const t = make()
    let calls = 0
    const off = t.subscribe((s) => {
      calls++
      t.setState({ page: s.page + 1 })
    })
    t.setState({ page: 1 })
    expect(codes()).toEqual(['DK_UPDATE_LOOP'])
    expect(calls).toBe(UPDATE_DEPTH_LIMIT)
    expect(t.getState().page).toBe(UPDATE_DEPTH_LIMIT)
    const d = seen[0] as Diagnostic
    expect(d.level).toBe('error')
    expect(d.where).toEqual({ kind: 'operation', op: 'table.setState', slot: 'listener #1' })
    expect(d.details).toMatchObject({ limit: UPDATE_DEPTH_LIMIT, slices: ['page'] })
    off()
    t.setState({ page: 0 })
    expect(t.getState().page).toBe(0)
    expect(seen).toHaveLength(1)
  })
})

describe('createTable: controlled state per slice', () => {
  it('a controlled slice comes from options.state; the others are owned', () => {
    const changes: unknown[] = []
    const t = make({
      state: { sorting: ['email'] },
      onStateChange: (u) => changes.push(u({ sorting: ['email'] })),
    })
    expect(t.getState()).toEqual({ sorting: ['email'], page: 0, query: '' })
    t.setState({ page: 2, sorting: ['id'] })
    // Owned slice committed; the controlled one waits for the owner.
    expect(t.getState()).toEqual({ sorting: ['email'], page: 2, query: '' })
    expect(changes).toEqual([{ sorting: ['id'] }])
    t.setOptions({ state: { sorting: ['id'] } })
    expect(t.getState()).toEqual({ sorting: ['id'], page: 2, query: '' })
  })

  it('onStateChange is not called for owned-only changes', () => {
    const onStateChange = vi.fn()
    const t = make({ state: { sorting: [] }, onStateChange })
    t.setState({ page: 1 })
    expect(onStateChange).not.toHaveBeenCalled()
  })

  it('the updater only merges the changed controlled slices into the owner state', () => {
    let owner: Partial<S> = { sorting: [], query: 'x' }
    const t = make({
      state: owner,
      onStateChange: (u) => {
        owner = u(owner)
      },
    })
    t.setState({ query: 'y', page: 5 })
    expect(owner).toEqual({ sorting: [], query: 'y' })
  })

  it('a slice passed as undefined is owned', () => {
    const t = make({ state: { sorting: undefined } })
    t.setState({ sorting: ['id'] })
    expect(t.getState().sorting).toEqual(['id'])
    expect(seen).toEqual([])
  })

  it('a slice that leaves control keeps its last value and becomes owned', () => {
    const t = make({ state: { page: 7 }, onStateChange: () => {} })
    t.setOptions({ state: {} })
    expect(t.getState().page).toBe(7)
    t.setState({ page: 8 })
    expect(t.getState().page).toBe(8)
  })

  it('DK_CONTROLLED_WITHOUT_HANDLER at creation and when an update is dropped', () => {
    const t = make({ state: { sorting: ['id'] } })
    expect(codes()).toEqual(['DK_CONTROLLED_WITHOUT_HANDLER'])
    const d = seen[0] as Diagnostic
    expect(d.level).toBe('warn')
    expect(d.where).toEqual({ kind: 'option', path: 'state.sorting' })
    expect(d.fix.join('\n')).toContain('onStateChange')
    t.setState({ sorting: ['email'], page: 1 })
    expect(t.getState()).toEqual({ sorting: ['id'], page: 1, query: '' })
    // Same code + where: aggregated by the hub's dedupe.
    expect(t.getDiagnostics()).toHaveLength(1)
    expect(t.getDiagnostics()[0]?.context.occurrences.count).toBe(2)
  })

  describe('DK_CONTROLLED_NOT_FED_BACK (development)', () => {
    beforeEach(() => {
      vi.useFakeTimers()
    })
    afterEach(() => {
      vi.useRealTimers()
    })

    it('an onStateChange that never feeds the value back is reported once, after FEEDBACK_MS', () => {
      const t = make({ state: { sorting: [] }, onStateChange: () => {} })
      t.setState({ sorting: ['id'] })
      t.setState({ sorting: ['email'] })
      vi.advanceTimersByTime(FEEDBACK_MS - 1)
      expect(codes()).toEqual([])
      vi.advanceTimersByTime(1)
      expect(codes()).toEqual(['DK_CONTROLLED_NOT_FED_BACK'])
      const d = seen[0] as Diagnostic
      expect(d.level).toBe('warn')
      expect(d.where).toEqual({ kind: 'option', path: 'state.sorting' })
      expect(d.details).toEqual({ slices: ['sorting'], waitedMs: FEEDBACK_MS })
      expect(d.context.trigger).toBe('api:setState')
      expect(d.fix.join('\n')).toContain('initialState')
      expect(t.getState().sorting).toEqual([])
      // A later ignored change is reported again (aggregated by the hub's dedupe).
      t.setState({ sorting: ['id'] })
      vi.advanceTimersByTime(FEEDBACK_MS)
      expect(t.getDiagnostics()[0]?.context.occurrences.count).toBe(2)
    })

    it('a synchronous or later feed-back is silent, and so is a different value fed back', () => {
      const t0: { table?: ReturnType<typeof make> } = {}
      let owned: Partial<S> = { sorting: [] }
      let t = make({
        state: owned,
        onStateChange: (u) => {
          owned = u(owned)
          t0.table?.setOptions({ state: owned })
        },
      })
      t0.table = t
      t.setState({ sorting: ['id'] })
      expect(t.getState().sorting).toEqual(['id'])
      vi.advanceTimersByTime(FEEDBACK_MS * 2)
      expect(codes()).toEqual([])

      let asked: Partial<S> = {}
      t = make({ state: { sorting: [] }, onStateChange: (u) => (asked = u({})) })
      t.setState({ sorting: ['id'] })
      vi.advanceTimersByTime(FEEDBACK_MS - 1)
      expect(asked).toEqual({ sorting: ['id'] })
      // The owner normalises the request: still an answer.
      t.setOptions({ state: { sorting: ['id', 'email'] } })
      vi.advanceTimersByTime(FEEDBACK_MS)
      expect(codes()).toEqual([])
      expect(vi.getTimerCount()).toBe(0)
    })

    it('owned slices, a slice leaving control, destroy and a throwing handler start no report', () => {
      const t = make({ state: { sorting: [] }, onStateChange: () => {} })
      t.setState({ page: 3 })
      expect(vi.getTimerCount()).toBe(0)
      t.setState({ sorting: ['id'] })
      t.setOptions({ state: {} })
      vi.advanceTimersByTime(FEEDBACK_MS)
      expect(codes()).toEqual([])

      const u = make({ state: { sorting: [] }, onStateChange: () => {} })
      u.setState({ sorting: ['id'] })
      u.destroy()
      expect(vi.getTimerCount()).toBe(0)

      const v = make({
        state: { sorting: [] },
        onStateChange: () => {
          throw new Error('nope')
        },
      })
      v.setState({ sorting: ['id'] })
      vi.advanceTimersByTime(FEEDBACK_MS)
      expect(codes()).toEqual(['DK_CALLBACK_FAILED'])
    })
  })

  it('a throwing onStateChange drops the whole update (DK_CALLBACK_FAILED)', () => {
    const t = make({
      state: { sorting: [] },
      onStateChange: () => {
        throw new Error('nope')
      },
    })
    const before = t.getState()
    t.setState({ sorting: ['id'], page: 4 })
    expect(t.getState()).toBe(before)
    expect(codes()).toEqual(['DK_CALLBACK_FAILED'])
    expect(seen[0]?.where).toEqual({ kind: 'option', path: 'onStateChange' })
  })

  it('a throwing updater function is reported with its slot', () => {
    const t = make()
    t.setState(() => {
      throw new Error('bad')
    })
    expect(codes()).toEqual(['DK_CALLBACK_FAILED'])
    // A method argument, not an option (T30): `operation table.setState at updater`.
    expect(seen[0]?.where).toEqual({ kind: 'operation', op: 'table.setState', slot: 'updater' })
  })
})

describe('createTable: destroy', () => {
  it('runs table:destroy, then mutating calls are no-ops with DK_TABLE_DESTROYED', () => {
    const ops: string[] = []
    const t = make({
      interceptors: [
        defineInterceptor({
          name: 'spy',
          on: ['table:destroy'],
          intercept: (ctx, next) => {
            ops.push(ctx.op)
            return next()
          },
        }),
      ],
    })
    const listener = vi.fn()
    t.subscribe(listener)
    t.destroy()
    expect(ops).toEqual(['table:destroy'])
    const state = t.getState()
    t.setState({ page: 9 })
    t.setOptions({ data: [] })
    const off = t.subscribe(listener)
    off()
    expect(t.getState()).toBe(state)
    expect(t.getData()).toBe(rows)
    expect(listener).not.toHaveBeenCalled()
    expect(codes()).toEqual(['DK_TABLE_DESTROYED', 'DK_TABLE_DESTROYED', 'DK_TABLE_DESTROYED'])
    expect(seen.map((d) => d.where)).toEqual([
      { kind: 'operation', op: 'table.setState' },
      { kind: 'operation', op: 'table.setOptions' },
      { kind: 'operation', op: 'table.subscribe' },
    ])
    expect(seen[0]?.level).toBe('warn')
  })

  it('destroy() from a listener stops the notification: later listeners are not called', () => {
    const t = make()
    const later = vi.fn()
    t.subscribe(() => t.destroy())
    t.subscribe(later)
    t.setState({ page: 1 })
    expect(later).not.toHaveBeenCalled()
  })

  it('a second destroy() is a silent no-op (idempotent)', () => {
    const t = make()
    t.destroy()
    t.destroy()
    expect(seen).toEqual([])
  })
})

describe('createTable: diagnostics wiring', () => {
  it('uses options.name and exposes getDiagnostics()', () => {
    const t = make({ name: 'UsersTable', state: { page: 1 } })
    expect(t.getDiagnostics()[0]?.context.table).toBe('UsersTable')
  })

  it('routes interceptor failures through the hub (runtime emit)', () => {
    const t = make({
      interceptors: [
        defineInterceptor({
          name: 'broken',
          on: ['state:dispatch'],
          intercept: () => {
            throw new Error('x')
          },
        }),
      ],
    })
    t.setState({ page: 1 })
    expect(t.getState().page).toBe(1)
    expect(codes()).toEqual(['DK_INTERCEPTOR_FAILED'])
  })

  it('an interceptor throwing after next() is skipped and the result kept', () => {
    const t = make({
      interceptors: [
        defineInterceptor({
          name: 'thrower',
          on: ['state:dispatch'],
          intercept: (_ctx, next) => {
            next()
            throw new Error('after next')
          },
        }),
      ],
    })
    t.setState({ page: 1 })
    expect(t.getState().page).toBe(1)
    expect(codes()).toEqual(['DK_INTERCEPTOR_FAILED'])
  })

  it('data:ingest carries the previous data as FALLBACK', () => {
    const fallbacks: unknown[] = []
    const t = make({
      interceptors: [
        defineInterceptor({
          name: 'spy',
          on: ['data:ingest'],
          intercept: (ctx, next) => {
            fallbacks.push(ctx.meta.get(FALLBACK))
            return next()
          },
        }),
      ],
    })
    const next = [{ id: 3, email: 'c@x.io' }]
    t.setOptions({ data: next })
    expect(fallbacks).toEqual([[], rows])
    expect(t.getData()).toBe(next)
  })

  it('applies an async ingest result when it resolves (latest wins)', async () => {
    const t = make({
      interceptors: [
        defineInterceptor({
          name: 'async',
          on: ['data:ingest'],
          intercept: (_ctx, next) => Promise.resolve(next()),
        }),
      ],
    })
    // Creation ingest is async too: data stays empty until it resolves.
    expect(t.getData()).toEqual([])
    const listener = vi.fn()
    t.subscribe(listener)
    const a = [{ id: 9, email: 'z@x.io' }]
    const b = [{ id: 10, email: 'y@x.io' }]
    t.setOptions({ data: a })
    t.setOptions({ data: b })
    await new Promise((r) => setTimeout(r, 0))
    expect(t.getData()).toBe(b)
    expect(listener).toHaveBeenCalled()
  })

  it('strict rethrows error-level diagnostics', () => {
    const t = make({
      strict: true,
      onStateChange: () => {
        throw new Error('x')
      },
      state: { page: 0 },
    })
    expect(() => t.setState({ page: 1 })).toThrow(DatakableError)
  })

  it("strict: after getRowModel() throws, the model is the 'error' fallback, not empty 'idle' (#43)", () => {
    const t = createTable({ data: [{ id: 1 }, { id: 1 }], rowKey: 'id', strict: true })
    expect(() => t.getRowModel()).toThrow(/DK_DUPLICATE_ROW_KEY/)
    // No good rows yet: empty with status 'error' (a later failed run keeps the last good rows).
    expect(t.getRowModel()).toMatchObject({ rows: [], status: 'error' })
    expect(t.getData()).toHaveLength(2)
  })
})

describe('createTable: redaction mapping (diagnostics.redact, sensitive, rowKey)', () => {
  const emitter = (details: { column: string; value: unknown; key: unknown }) =>
    defineInterceptor({
      name: 'emitter',
      on: ['state:dispatch'],
      intercept: (ctx, next) => {
        ctx.emit('DK_TEST_TABLE_VALUE', details)
        return next()
      },
    })

  it("defaults to 'keys' in development: raw keys, value types", () => {
    const t = make({ interceptors: [emitter({ column: 'id', value: 'SECRET', key: 42 })] })
    t.setState({ page: 1 })
    expect(seen[0]?.details).toEqual({ column: 'id', value: 'string(6)', key: 42 })
  })

  it("maps a level string: 'safe' hashes keys, 'full' keeps values", () => {
    const safe = make({
      diagnostics: { redact: 'safe' },
      interceptors: [emitter({ column: 'id', value: 'SECRET', key: 42 })],
    })
    safe.setState({ page: 1 })
    expect(seen[0]?.details.key).toMatch(/^h:[0-9a-f]{8}$/)
    seen = []
    const full = make({
      diagnostics: { redact: 'full' },
      interceptors: [emitter({ column: 'id', value: 'SECRET', key: 42 })],
    })
    full.setState({ page: 1 })
    expect(seen[0]?.details.value).toBe('SECRET')
  })

  it('maps a custom redact function', () => {
    const t = make({
      diagnostics: { redact: (path) => (path === 'details.value' ? '<v>' : undefined) },
      interceptors: [emitter({ column: 'id', value: 'SECRET', key: 42 })],
    })
    t.setState({ page: 1 })
    expect(seen[0]?.details).toMatchObject({ value: '<v>', key: 42 })
  })

  it('a sensitive column is never logged; a sensitive rowKey column is always hashed', () => {
    const t = make({
      diagnostics: { redact: 'full' },
      rowKey: 'email',
      columns: [{ key: 'id' }, { key: 'email', sensitive: true }],
      interceptors: [emitter({ column: 'email', value: 'SECRET', key: 'a@x.io' })],
    })
    t.setState({ page: 1 })
    expect(seen[0]?.details.value).toBe('[sensitive]')
    expect(seen[0]?.details.key).toMatch(/^h:[0-9a-f]{8}$/)
  })

  it('follows column changes made with setOptions', () => {
    const t = make({
      diagnostics: { redact: 'full' },
      columns: [{ key: 'email' }],
      interceptors: [emitter({ column: 'email', value: 'SECRET', key: 1 })],
    })
    t.setOptions({ columns: [{ key: 'email', sensitive: true }] })
    t.setState({ page: 1 })
    expect(seen[0]?.details.value).toBe('[sensitive]')
  })
})

describe('createTable: ctx.where never carries row data (R2 property)', () => {
  const SENTINEL = 'SECRET-123'
  const PATH = /^[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*|\[\d+\])*$/

  it('every op the store runs has a constant option path / method name as where', () => {
    const wheres: string[] = []
    const t = createTable<Record<string, unknown>, Record<string, unknown>>({
      name: 'T',
      data: [{ [SENTINEL]: SENTINEL, id: SENTINEL }],
      columns: [{ key: 'id' }],
      rowKey: 'id',
      initialState: { [SENTINEL]: SENTINEL },
      state: { q: SENTINEL },
      onStateChange: () => {},
      onDiagnostic,
      interceptors: [
        defineInterceptor({
          name: 'where-spy',
          on: '*',
          hot: true,
          intercept: (ctx, next) => {
            wheres.push(ctx.where)
            return next()
          },
        }),
      ],
    })
    t.subscribe(() => {})
    t.setState({ [SENTINEL]: `${SENTINEL}!`, q: `${SENTINEL}?` })
    t.setState(() => ({ [SENTINEL]: SENTINEL }))
    t.setOptions({ data: [{ id: SENTINEL }], state: { q: `${SENTINEL}#` } })
    t.destroy()
    expect(wheres.length).toBeGreaterThan(5)
    for (const w of wheres) {
      expect(w).not.toContain(SENTINEL)
      expect(w).toMatch(PATH)
    }
    for (const d of seen) expect(JSON.stringify(d)).not.toContain(SENTINEL)
  })
})
