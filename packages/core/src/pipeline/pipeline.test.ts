import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Diagnostic } from '../diagnostics/types'
import { defineFeature } from '../feature/define'
import type { AnyFeature, RowModelContext } from '../feature/types'
import { defineInterceptor } from '../intercept/define'
import { createTable } from '../table/create-table'
import { Row } from './row'
import { minFilter, numSort, pager } from './test-features'

let seen: Diagnostic[]
const onDiagnostic = (d: Diagnostic) => {
  seen.push(d)
}
const codes = () => seen.map((d) => d.code)

beforeEach(() => {
  seen = []
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  vi.spyOn(console, 'error').mockImplementation(() => {})
  vi.spyOn(console, 'groupCollapsed').mockImplementation(() => {})
  vi.spyOn(console, 'groupEnd').mockImplementation(() => {})
  vi.spyOn(console, 'log').mockImplementation(() => {})
})

type P = { id: string; age: number | null; name: string }
const people = (n: number): P[] =>
  Array.from({ length: n }, (_, i) => ({ id: `p${i}`, age: (i * 7) % 50, name: `n${i}` }))

const api = (t: object) => t as unknown as Record<string, (...a: unknown[]) => unknown>
const ages = (t: { getRowModel(): { rows: readonly Row<P>[] } }) =>
  t.getRowModel().rows.map((r) => r.original.age)

describe('getRowModel: no features', () => {
  it('returns every row in data order as Row instances', () => {
    const data = people(3)
    const t = createTable({ data, rowKey: 'id', columns: [{ key: 'age' }, { key: 'name' }] })
    const m = t.getRowModel()
    expect(m.totalCount).toBe(3)
    expect(m.filteredCount).toBe(3)
    expect(m.status).toBe('idle')
    expect(m.rows.map((r) => r.index)).toEqual([0, 1, 2])
    const r = m.rows[1] as Row<P>
    expect(r).toBeInstanceOf(Row)
    expect(r.original).toBe(data[1])
    expect(r.key).toBe('p1')
    expect(r.valid).toBe(true)
    expect(r.issues).toEqual([])
    expect(r.getCellIssues('age')).toEqual([])
    expect(r.getValue('age')).toBe(7)
    expect(r.getValue('nope')).toBeUndefined()
  })

  it('Row methods live on the prototype (own fields only: data)', () => {
    const t = createTable({ data: people(2), columns: [{ key: 'age' }] })
    const r = t.getRowModel().rows[0] as Row<P>
    for (const m of ['getValue', 'getCellIssues', 'valid', 'issues']) {
      expect(Object.hasOwn(r, m)).toBe(false)
    }
    expect(typeof Row.prototype.getValue).toBe('function')
  })

  it('key: rowKey path or function; the row index without rowKey', () => {
    const data = people(2)
    expect(
      createTable({ data })
        .getRowModel()
        .rows.map((r) => r.key),
    ).toEqual([0, 1])
    const byFn = createTable({ data, rowKey: (p) => `k-${p.name}` })
    expect(byFn.getRowModel().rows.map((r) => r.key)).toEqual(['k-n0', 'k-n1'])
  })

  it('a throwing rowKey function: one DK_CALLBACK_FAILED, fallback #index', () => {
    const t = createTable({
      data: people(3),
      onDiagnostic,
      rowKey: (p: P) => {
        if (p.name !== 'n0') throw new Error('nope')
        return p.id
      },
    })
    expect(t.getRowModel().rows.map((r) => r.key)).toEqual(['p0', '#1', '#2'])
    expect(codes()).toEqual(['DK_CALLBACK_FAILED'])
    expect(seen[0]?.details).toMatchObject({ slot: 'rowKey', count: 2, rows: [1, 2] })
  })

  it('accessor columns: Row.getValue calls the accessor; a throw is reported once', () => {
    const t = createTable({
      data: people(2),
      onDiagnostic,
      columns: [
        { key: 'age' },
        {
          id: 'bad',
          accessor: () => {
            throw new Error('x')
          },
        },
        { id: 'up', accessor: (p) => p.name.toUpperCase() },
      ],
    })
    const r = t.getRowModel().rows[1] as Row<P>
    expect(r.getValue('up')).toBe('N1')
    expect(r.getValue('bad')).toBeUndefined()
    expect(codes()).toEqual(['DK_CALLBACK_FAILED'])
    expect(seen[0]?.details).toMatchObject({ slot: 'columns[1].accessor', rows: [1], count: 1 })
  })
  it('a throwing getter read through Row.getValue: DK_CALLBACK_FAILED at columns[i].key', () => {
    const data = people(2).map((p, i) =>
      i === 1
        ? Object.defineProperty({ ...p }, 'age', {
            get() {
              throw new Error('getter')
            },
          })
        : p,
    )
    const t = createTable({ data, onDiagnostic, columns: [{ key: 'age' }] })
    const [r0, r1] = t.getRowModel().rows as Row<P>[]
    expect(r1?.getValue('age')).toBeUndefined()
    expect(codes()).toEqual(['DK_CALLBACK_FAILED'])
    expect(seen[0]?.details).toMatchObject({ slot: 'columns[0].key', rows: [1], count: 1 })
    // The failure does not leak into the next read.
    expect(r0?.getValue('age')).toBe(0)
    expect(codes()).toEqual(['DK_CALLBACK_FAILED'])
  })
})

describe('pipeline: stage order and counts', () => {
  it('runs filter → sort → paginate whatever the listed order; filteredCount is pre-page', () => {
    const t = createTable({
      data: people(20),
      columns: [{ key: 'age' }],
      features: [pager(3), numSort('age'), minFilter('age')],
    })
    api(t).setMin?.(20)
    api(t).setSort?.('desc')
    const m = t.getRowModel()
    expect(m.totalCount).toBe(20)
    const expected = people(20)
      .map((p) => p.age as number)
      .filter((a) => a >= 20)
      .sort((a, b) => b - a)
    expect(m.filteredCount).toBe(expected.length)
    expect(ages(t)).toEqual(expected.slice(0, 3))
    api(t).setPage?.(1)
    expect(ages(t)).toEqual(expected.slice(3, 6))
  })

  it('listeners see the row model of the state they are notified with', () => {
    const t = createTable({
      data: people(10),
      columns: [{ key: 'age' }],
      features: [minFilter('age')],
    })
    const counts: number[] = []
    t.subscribe(() => counts.push(t.getRowModel().filteredCount))
    api(t).setMin?.(30)
    expect(counts).toEqual([people(10).filter((p) => (p.age as number) >= 30).length])
  })

  it('pipeline:step runs once per step with where = features[i].rowModel', () => {
    const wheres: string[] = []
    const t = createTable({
      data: people(5),
      columns: [{ key: 'age' }],
      features: [numSort('age'), minFilter('age')],
      interceptors: [
        defineInterceptor({
          name: 'spy',
          on: ['pipeline:step'],
          intercept: (ctx, next) => {
            wheres.push(ctx.where)
            return next()
          },
        }),
      ],
    })
    t.getRowModel()
    expect(wheres).toEqual(['features[1].rowModel', 'features[0].rowModel'])
  })
})

describe('pipeline: per-step memo', () => {
  const setup = () => {
    const calls = { filter: 0, sort: 0, page: 0 }
    const data = people(30)
    const t = createTable({
      data,
      columns: [{ key: 'age' }],
      features: [
        minFilter('age', () => calls.filter++),
        numSort('age', () => calls.sort++),
        pager(5, () => calls.page++),
        defineFeature({
          name: 'other',
          stage: 'none',
          initialState: () => 0,
          createApi: (ctx) => ({ bump: () => ctx.setState((n) => n + 1) }),
        }) as AnyFeature,
      ],
    })
    return { t, calls, data }
  }

  it('the same RowModel object while nothing changed (no step re-runs)', () => {
    const { t, calls } = setup()
    const a = t.getRowModel()
    expect(calls).toEqual({ filter: 1, sort: 1, page: 1 })
    expect(t.getRowModel()).toBe(a)
    expect(calls).toEqual({ filter: 1, sort: 1, page: 1 })
  })

  it('a slice outside the pipeline: memo hits on every step, same RowModel', () => {
    const { t, calls } = setup()
    const a = t.getRowModel()
    api(t).bump?.()
    t.setState({ unrelated: 1 })
    expect(t.getRowModel()).toBe(a)
    expect(calls).toEqual({ filter: 1, sort: 1, page: 1 })
  })

  it('a page change re-runs only paginate (filter + sort are memo hits)', () => {
    const { t, calls } = setup()
    t.getRowModel()
    api(t).setPage?.(1)
    t.getRowModel()
    expect(calls).toEqual({ filter: 1, sort: 1, page: 2 })
  })

  it('a filter change re-runs everything downstream', () => {
    const { t, calls } = setup()
    t.getRowModel()
    api(t).setMin?.(10)
    t.getRowModel()
    expect(calls).toEqual({ filter: 2, sort: 2, page: 2 })
  })

  it('new data re-runs every step; the same data reference does not', () => {
    const { t, calls, data } = setup()
    t.getRowModel()
    t.setOptions({ data })
    t.getRowModel()
    expect(calls).toEqual({ filter: 1, sort: 1, page: 1 })
    t.setOptions({ data: people(30) })
    t.getRowModel()
    expect(calls).toEqual({ filter: 2, sort: 2, page: 2 })
  })

  it('new columns re-run every step (column values may differ)', () => {
    const { t, calls } = setup()
    t.getRowModel()
    t.setOptions({ columns: [{ key: 'age' }] })
    t.getRowModel()
    expect(calls).toEqual({ filter: 2, sort: 2, page: 2 })
  })
})

describe('pipeline: failures', () => {
  it('a throwing rowModel: DK_FEATURE_FAILED (hook rowModel), input passed through, status error', () => {
    let fail = true
    const boom = defineFeature({
      name: 'boom',
      stage: 'filter',
      initialState: () => ({ on: true }),
      createApi: (ctx) => ({ toggleBoom: () => ctx.setState((s) => ({ on: !s.on })) }),
      rowModel: (indices) => {
        if (fail) throw new TypeError('bad')
        return indices.subarray(0, 1)
      },
    }) as AnyFeature
    const t = createTable({ data: people(4), onDiagnostic, features: [boom] })
    const m = t.getRowModel()
    expect(m.status).toBe('error')
    expect(m.rows).toHaveLength(4)
    expect(codes()).toEqual(['DK_FEATURE_FAILED'])
    expect(seen[0]?.details).toMatchObject({
      feature: 'boom',
      hook: 'rowModel',
      errorName: 'TypeError',
    })
    expect(seen[0]?.where).toEqual({ kind: 'feature', name: 'boom' })
    expect(seen[0]?.context.run).toBeGreaterThan(0)
    fail = false
    api(t).toggleBoom?.()
    const next = t.getRowModel()
    expect(next.status).toBe('idle')
    expect(next.rows).toHaveLength(1)
  })

  it('pipeline:run fails: the last good row model is kept with status error', () => {
    const t = createTable<P>({ data: people(2), onDiagnostic })
    const good = t.getRowModel()
    expect(good.status).toBe('idle')
    const broken = new Proxy(people(3), {
      get(target, p, r) {
        if (typeof p === 'string' && /^\d+$/.test(p)) throw new Error('unreadable row')
        return Reflect.get(target, p, r)
      },
    })
    t.setOptions({ data: broken })
    const m = t.getRowModel()
    expect(m.status).toBe('error')
    expect(m.rows).toBe(good.rows)
    expect(seen.length).toBe(1)
    expect(seen[0]?.impact).toMatch(/last good row model/)
  })

  it('a non-Uint32Array output passes the input through (T27 adds the diagnostic)', () => {
    const bad = defineFeature({
      name: 'bad',
      stage: 'filter',
      initialState: () => null,
      createApi: () => ({}),
      rowModel: () => [0] as unknown as Uint32Array,
    }) as AnyFeature
    const t = createTable({ data: people(3), features: [bad] })
    expect(t.getRowModel().rows).toHaveLength(3)
  })
})

describe('column cache', () => {
  it('lazy: no column is read unless a step asks for it', () => {
    const accessor = vi.fn((p: P) => p.name)
    const t = createTable({
      data: people(5),
      columns: [{ key: 'age' }, { id: 'x', accessor }],
      features: [minFilter('age')],
    })
    api(t).setMin?.(10)
    t.getRowModel()
    expect(accessor).not.toHaveBeenCalled()
  })

  it('numeric columns are a Float64Array (nullish → NaN); others a plain array', () => {
    let ctx: RowModelContext | undefined
    const data = people(4)
    ;(data[2] as P).age = null
    const t = createTable({
      data,
      columns: [{ key: 'age' }, { key: 'name' }],
      features: [minFilter('age', (c) => (ctx = c))],
    })
    t.getRowModel()
    const ages = ctx?.getColumnValues('age')
    expect(ages).toBeInstanceOf(Float64Array)
    expect(Array.from(ages as Float64Array)).toEqual([0, 7, Number.NaN, 21])
    expect(ctx?.getColumnValues('name')).toEqual(['n0', 'n1', 'n2', 'n3'])
    expect(ctx?.getColumnValues('nope')).toBeUndefined()
  })

  it('built once per data reference and column (cache hit across runs); rebuilt for new data', () => {
    const accessor = vi.fn((p: P) => p.age)
    let ctx: RowModelContext | undefined
    const t = createTable({
      data: people(6),
      columns: [{ id: 'a', accessor }],
      features: [minFilter('a', (c) => (ctx = c)), pager(2)],
    })
    api(t).setMin?.(0)
    t.getRowModel()
    const first = ctx?.getColumnValues('a')
    api(t).setMin?.(5)
    t.getRowModel()
    expect(ctx?.getColumnValues('a')).toBe(first)
    expect(accessor).toHaveBeenCalledTimes(6)
    t.setOptions({ data: people(6) })
    t.getRowModel()
    expect(ctx?.getColumnValues('a')).not.toBe(first)
    expect(accessor).toHaveBeenCalledTimes(12)
  })

  it('one column:batch per column, intercepted per batch (never per cell)', () => {
    const batches: string[] = []
    let ctx: RowModelContext | undefined
    const t = createTable({
      data: people(100),
      columns: [{ key: 'age' }, { key: 'name' }],
      features: [minFilter('age', (c) => (ctx = c))],
      interceptors: [
        defineInterceptor({
          name: 'batch-spy',
          on: ['column:batch'],
          hot: true,
          intercept: (c, next) => {
            batches.push(`${c.where} ${c.input.rows.length}`)
            return next()
          },
        }),
      ],
    })
    api(t).setMin?.(1)
    t.getRowModel()
    ctx?.getFormattedValues('name')
    ctx?.getFormattedValues('name')
    expect(batches).toEqual(['columns[0].key 100', 'columns[1].key 100', 'columns[1].format 100'])
  })

  it('a throwing accessor: one DK_CALLBACK_FAILED per column per data (count + first rows)', () => {
    let ctx: RowModelContext | undefined
    const t = createTable({
      data: people(20),
      onDiagnostic,
      columns: [
        { key: 'name' },
        {
          id: 'v',
          accessor: (p) => {
            if (Number(p.id.slice(1)) % 2) throw new RangeError('odd')
            return 1
          },
        },
      ],
      features: [minFilter('v', (c) => (ctx = c))],
    })
    api(t).setMin?.(0)
    t.getRowModel()
    api(t).setMin?.(1)
    t.getRowModel()
    expect(codes()).toEqual(['DK_CALLBACK_FAILED'])
    expect(seen[0]?.details).toMatchObject({
      slot: 'columns[1].accessor',
      column: 'v',
      count: 10,
      rows: [1, 3, 5, 7, 9],
      errorName: 'RangeError',
    })
    // 1 or undefined (fallback): a numeric column, the failed cells are NaN.
    const v = ctx?.getColumnValues('v') as Float64Array
    expect(v).toBeInstanceOf(Float64Array)
    expect(v[1]).toBeNaN()
    expect(v[0]).toBe(1)
  })

  it('a throwing getter on a key path: reported at columns[i].key', () => {
    let ctx: RowModelContext | undefined
    const data = people(3).map((p, i) =>
      i === 1
        ? Object.defineProperty({ ...p }, 'age', {
            get() {
              throw new Error('getter')
            },
          })
        : p,
    )
    const t = createTable({
      data,
      onDiagnostic,
      columns: [{ key: 'age' }],
      features: [minFilter('age', (c) => (ctx = c))],
    })
    api(t).setMin?.(0)
    t.getRowModel()
    expect(codes()).toEqual(['DK_CALLBACK_FAILED'])
    expect(seen[0]?.details).toMatchObject({ slot: 'columns[0].key', rows: [1], count: 1 })
    expect(ctx?.getColumnValues('age')?.[1]).toBeNaN()
  })

  it('formatted values: format callback, default formatter, nullish numbers stay empty', () => {
    let ctx: RowModelContext | undefined
    const data = people(3)
    ;(data[1] as P).age = null
    const t = createTable({
      data,
      columns: [{ key: 'age' }, { key: 'name', format: (v) => `<${v}>` }],
      features: [minFilter('age', (c) => (ctx = c))],
    })
    t.getRowModel()
    expect(ctx?.getFormattedValues('age')).toEqual(['0', '', '14'])
    expect(ctx?.getFormattedValues('name')).toEqual(['<n0>', '<n1>', '<n2>'])
  })

  it("a throwing format: '' for those cells, one DK_CALLBACK_FAILED at columns[i].format", () => {
    let ctx: RowModelContext | undefined
    const t = createTable({
      data: people(3),
      onDiagnostic,
      columns: [
        {
          key: 'name',
          format: (v) => {
            if (v === 'n2') throw new Error('f')
            return v
          },
        },
      ],
      features: [minFilter('name', (c) => (ctx = c))],
    })
    t.getRowModel()
    expect(ctx?.getFormattedValues('name')).toEqual(['n0', 'n1', ''])
    expect(codes()).toEqual(['DK_CALLBACK_FAILED'])
    expect(seen[0]?.details).toMatchObject({ slot: 'columns[0].format', rows: [2], count: 1 })
  })

  it('DK_UNRENDERABLE_VALUE: once per column, column where, count + sample, no values', () => {
    type O = { id: number; meta: unknown }
    let ctx: RowModelContext | undefined
    const SECRET = 'SECRET-OBJ'
    const data: O[] = Array.from({ length: 8 }, (_, i) => ({
      id: i,
      meta: i % 2 ? { secret: SECRET } : 'ok',
    }))
    const t = createTable({
      data,
      onDiagnostic,
      columns: [{ key: 'id' }, { key: 'meta' }],
      features: [minFilter('id', (c) => (ctx = c))],
    })
    t.getRowModel()
    expect(ctx?.getFormattedValues('meta')).toEqual(['ok', '', 'ok', '', 'ok', '', 'ok', ''])
    ctx?.getFormattedValues('meta')
    expect(codes()).toEqual(['DK_UNRENDERABLE_VALUE'])
    const d = seen[0] as Diagnostic
    expect(d.level).toBe('warn')
    expect(d.where).toEqual({ kind: 'column', index: 1, id: 'meta' })
    expect(d.details).toMatchObject({ count: 4, rows: [1, 3, 5, 7], valueType: 'object' })
    expect(d.fix.length).toBeGreaterThan(0)
    expect(d.fix[0]).toMatch(/columns\[1\]/)
    expect(JSON.stringify(d)).not.toContain(SECRET)
  })

  it('no DK_UNRENDERABLE_VALUE when the column declares cell', () => {
    let ctx: RowModelContext | undefined
    const t = createTable({
      data: [{ o: { a: 1 } }] as { o: { a: number } }[],
      onDiagnostic,
      columns: [{ key: 'o', cell: ({ value }) => value.a }],
      features: [minFilter('o', (c) => (ctx = c))],
    })
    t.getRowModel()
    expect(ctx?.getFormattedValues('o')).toEqual([''])
    expect(seen).toEqual([])
  })
})

describe('table integration', () => {
  it('getRowModel is a core method: a feature cannot take the name', () => {
    const f = defineFeature({
      name: 'evil',
      stage: 'none',
      initialState: () => null,
      createApi: () => ({ getRowModel: () => null }),
    }) as AnyFeature
    expect(() => createTable({ data: [], features: [f] })).toThrow(/getRowModel/)
  })

  it('destroyed before the first run: an empty row model', () => {
    const t = createTable({ data: people(2) })
    t.destroy()
    expect(t.getRowModel()).toEqual({
      rows: [],
      filteredCount: 0,
      totalCount: 0,
      status: 'idle',
      isInitialLoad: false,
    })
  })

  it('after destroy, getRowModel returns the last row model', () => {
    const t = createTable({ data: people(2) })
    const m = t.getRowModel()
    t.destroy()
    expect(t.getRowModel()).toBe(m)
  })

  it('ctx.where never carries row keys or cell values (R2 property)', () => {
    const SENTINEL = 'SECRET-123'
    const PATH = /^[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*|\[\d+\])*$/
    const wheres: string[] = []
    type R = { id: string; v: unknown; n: number }
    const data: R[] = [
      { id: SENTINEL, v: { [SENTINEL]: SENTINEL }, n: 1 },
      { id: `${SENTINEL}2`, v: SENTINEL, n: 2 },
    ]
    let ctx: RowModelContext | undefined
    const t = createTable({
      data,
      rowKey: 'id',
      onDiagnostic,
      diagnostics: { redact: 'safe' },
      columns: [
        { key: 'id' },
        { key: 'v' },
        {
          id: 'boom',
          accessor: (r) => {
            throw new Error(String(r.id))
          },
        },
        {
          key: 'n',
          format: (n) => {
            throw new Error(`${SENTINEL}${n}`)
          },
        },
      ],
      features: [minFilter('n', (c) => (ctx = c)), numSort('n'), pager(1)],
      interceptors: [
        defineInterceptor({
          name: 'where-spy',
          on: '*',
          hot: true,
          intercept: (c, next) => {
            // diagnostic:emit carries the formatted Location (e.g. `columns[1] (id "v")`): column
            // ids are code, checked for the sentinel below but not against PATH.
            if (c.op !== 'diagnostic:emit') wheres.push(c.where)
            else if (c.where.includes(SENTINEL)) wheres.push(c.where)
            return next()
          },
        }),
      ],
    })
    api(t).setMin?.(0)
    api(t).setSort?.('desc')
    for (const id of ['id', 'v', 'boom', 'n']) {
      ctx?.getColumnValues(id)
      ctx?.getFormattedValues(id)
    }
    t.getRowModel().rows[0]?.getValue('boom')
    expect(wheres.length).toBeGreaterThan(5)
    for (const w of wheres) {
      expect(w).not.toContain(SENTINEL)
      expect(w).toMatch(PATH)
    }
    expect(seen.length).toBeGreaterThan(0)
    for (const d of seen) {
      expect(JSON.stringify(d.where)).not.toContain(SENTINEL)
      expect(JSON.stringify(d.details)).not.toContain(SENTINEL)
      expect(d.fingerprint).not.toContain(SENTINEL)
    }
  })
})

describe('getRowModel: rows are built lazily (§9.3 memory)', () => {
  /** A rowKey function counting its calls: the key scan reads every row once. */
  const counted = () => {
    const calls = { n: 0 }
    const rowKey = (p: P) => {
      calls.n++
      return p.id
    }
    return { calls, rowKey }
  }

  it('a Row is built the first time its index is read, then kept (stable identity)', () => {
    const { calls, rowKey } = counted()
    const t = createTable({ data: people(1000), rowKey, columns: [{ key: 'age' }] })
    const m = t.getRowModel()
    expect(m.rows).toHaveLength(1000)
    // The scan over all rows (§5.2), and no Row yet.
    expect(calls.n).toBe(1000)
    const r = m.rows[5] as Row<P>
    expect(calls.n).toBe(1001)
    expect(r).toBeInstanceOf(Row)
    expect(r.key).toBe('p5')
    expect(m.rows[5]).toBe(r)
    expect(calls.n).toBe(1001)
    expect(m.rows[1000]).toBeUndefined()
    expect(m.rows[-1]).toBeUndefined()
    expect(calls.n).toBe(1001)
  })

  it('behaves as an array: iteration, methods, spread, keys, JSON, in', () => {
    const data = people(4)
    const m = createTable({ data, rowKey: 'id', columns: [{ key: 'age' }] }).getRowModel()
    const rows = m.rows
    expect(Array.isArray(rows)).toBe(true)
    expect(rows.map((r) => r.key)).toEqual(['p0', 'p1', 'p2', 'p3'])
    const seenKeys: unknown[] = []
    rows.forEach((r) => {
      seenKeys.push(r.key)
    })
    for (const r of rows) seenKeys.push(r.index)
    expect(seenKeys).toEqual(['p0', 'p1', 'p2', 'p3', 0, 1, 2, 3])
    expect([...rows].map((r) => r.original)).toEqual(data)
    expect(rows.slice(1, 3).map((r) => r.key)).toEqual(['p1', 'p2'])
    expect(rows.indexOf(rows[2] as Row<P>)).toBe(2)
    expect(rows.find((r) => r.key === 'p3')?.index).toBe(3)
    expect(Object.keys(rows)).toEqual(['0', '1', '2', '3'])
    expect(3 in rows).toBe(true)
    expect(4 in rows).toBe(false)
    expect(JSON.parse(JSON.stringify(rows))).toHaveLength(4)
    expect(rows.at(-1)?.key).toBe('p3')
  })

  it('a rowKey that throws only when a row is built later is reported then (never silent)', () => {
    let scanned = false
    const t = createTable({
      data: people(3),
      onDiagnostic,
      rowKey: (p: P) => {
        if (scanned && p.id === 'p2') throw new Error('late')
        return p.id
      },
    })
    const m = t.getRowModel()
    scanned = true
    expect(codes()).toEqual([])
    expect(m.rows[2]?.key).toBe('#2')
    expect(codes()).toEqual(['DK_CALLBACK_FAILED'])
    expect(seen[0]?.details).toMatchObject({ slot: 'rowKey', count: 1, rows: [2] })
  })
})
