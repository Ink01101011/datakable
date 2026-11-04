import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Diagnostic } from '../diagnostics/types'
import { columnFilters } from '../features/column-filters'
import { sorting } from '../features/sorting/sorting'
import { createTable } from './create-table'

/** Restored state (URL / storage) is untrusted input: #89, #102, #103. */

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
afterEach(() => {
  vi.restoreAllMocks()
})

type R = { id: number; name: string }
const data: R[] = [
  { id: 0, name: 'n0' },
  { id: 1, name: 'n1' },
  { id: 2, name: 'n2' },
]
const columns = [{ key: 'id' }, { key: 'name' }] as const
const ids = (t: { getRowModel(): { rows: readonly { original: unknown }[] } }) =>
  t.getRowModel().rows.map((r) => (r.original as R).id)
// biome-ignore lint/suspicious/noExplicitAny: malformed state on purpose
type Loose = any

const filters = (init?: object) =>
  createTable({
    data,
    columns,
    features: [columnFilters()],
    onDiagnostic,
    ...(init ? { initialState: init as Loose } : {}),
  })
const sorted = (init?: object) =>
  createTable({
    data,
    columns,
    features: [sorting()],
    onDiagnostic,
    ...(init ? { initialState: init as Loose } : {}),
  })

describe('#89: a null or malformed columnFilters / sorting slice', () => {
  it('setState({ columnFilters: null }): the slice is replaced and setColumnFilter works', () => {
    const t = filters()
    t.setState({ columnFilters: null as Loose })
    expect(t.getState().columnFilters).toEqual({})
    expect(codes()).toContain('DK_INVALID_STATE')
    t.setColumnFilter('name', { type: 'contains', value: 'n1' })
    expect(ids(t)).toEqual([1])
    expect(t.getState().columnFilters).toEqual({ name: { type: 'contains', value: 'n1' } })
    expect(codes()).not.toContain('DK_CALLBACK_FAILED')
  })

  it('initialState columnFilters: null is replaced at creation; resetColumnFilters works', () => {
    const t = filters({ columnFilters: null })
    expect(t.getState().columnFilters).toEqual({})
    const d = seen.find((x) => x.code === 'DK_INVALID_STATE')
    expect(d?.where).toEqual({ kind: 'option', path: 'state.columnFilters' })
    t.resetColumnFilters()
    t.setColumnFilter('id', { type: 'equals', value: 2 })
    expect(ids(t)).toEqual([2])
    expect(codes()).not.toContain('DK_CALLBACK_FAILED')
  })

  it('setState({ sorting: { by: [entry, null] } }): invalid entries are dropped, toggleSort works', () => {
    const t = sorted()
    t.setState({ sorting: { by: [{ id: 'name', desc: true }, null] } as Loose })
    expect(t.getState().sorting).toEqual({ by: [{ id: 'name', desc: true }] })
    expect(t.getRowModel().status).not.toBe('error')
    expect(ids(t)).toEqual([2, 1, 0])
    expect(codes()).toContain('DK_INVALID_STATE')
    expect(codes()).not.toContain('DK_FEATURE_FAILED')
    t.toggleSort('id')
    expect(t.getState().sorting).toEqual({ by: [{ id: 'id', desc: false }] })
    expect(codes()).not.toContain('DK_CALLBACK_FAILED')
  })

  it('sorting null or without an array `by` is replaced with an empty sort', () => {
    for (const bad of [null, {}, { by: 'name' }, 'x']) {
      seen = []
      const t = sorted({ sorting: bad })
      expect(t.getState().sorting).toEqual({ by: [] })
      expect(codes()).toEqual(['DK_INVALID_STATE'])
      expect(t.getSortDirection('name')).toBe(false)
      t.toggleSort('name', { multi: true })
      expect(t.getState().sorting).toEqual({ by: [{ id: 'name', desc: false }] })
    }
  })

  it('a controlled malformed slice is reported and the fixed slice goes to onStateChange', () => {
    const onStateChange = vi.fn()
    const t = createTable({
      data,
      columns,
      features: [columnFilters()],
      onDiagnostic,
      state: { columnFilters: null as Loose },
      onStateChange,
    })
    expect(codes()).toContain('DK_INVALID_STATE')
    expect(onStateChange).toHaveBeenCalled()
    // Until the owner feeds it back, the APIs still work on the empty slice.
    t.setColumnFilter('name', { type: 'contains', value: 'n2' })
    const updater = onStateChange.mock.calls.at(-1)?.[0] as (p: object) => object
    expect(updater({})).toEqual({ columnFilters: { name: { type: 'contains', value: 'n2' } } })
    expect(codes()).not.toContain('DK_CALLBACK_FAILED')
  })

  it('a valid slice is not reported', () => {
    const t = sorted({ sorting: { by: [{ id: 'id', desc: true }] } })
    t.setState({ sorting: { by: [] } })
    const f = filters({ columnFilters: { id: { type: 'equals', value: 1 } } })
    f.setState({ columnFilters: {} })
    expect(codes()).not.toContain('DK_INVALID_STATE')
  })
})

describe('#102: a "__proto__" key never changes the prototype of state objects', () => {
  const evil = () => JSON.parse('{"__proto__":{"isAdmin":true}}')

  it('initialState', () => {
    const t = filters(evil())
    const s = t.getState() as Loose
    expect(Object.getPrototypeOf(s)).toBe(Object.prototype)
    expect(s.isAdmin).toBeUndefined()
    expect(Object.keys(s)).toEqual(['columnFilters'])
    expect(codes()).toContain('DK_STATE_UNKNOWN_KEY')
    expect(({} as Loose).isAdmin).toBeUndefined()
  })

  it('setState', () => {
    const t = filters()
    t.setState(evil())
    const s = t.getState() as Loose
    expect(Object.getPrototypeOf(s)).toBe(Object.prototype)
    expect(s.isAdmin).toBeUndefined()
    const d = seen.find((x) => x.code === 'DK_STATE_UNKNOWN_KEY')
    expect(d?.where).toEqual({ kind: 'option', path: 'state.__proto__' })
  })

  it('setState with an updater', () => {
    const t = filters()
    t.setState(() => evil())
    expect((t.getState() as Loose).isAdmin).toBeUndefined()
    expect(Object.getPrototypeOf(t.getState())).toBe(Object.prototype)
  })

  it('setOptions({ state }) (controlled)', () => {
    const t = filters()
    t.setOptions({ state: evil(), onStateChange: () => {} })
    const s = t.getState() as Loose
    expect(Object.getPrototypeOf(s)).toBe(Object.prototype)
    expect(s.isAdmin).toBeUndefined()
    t.setState({ columnFilters: {} })
    expect(Object.getPrototypeOf(t.getState())).toBe(Object.prototype)
    expect(codes()).toContain('DK_STATE_UNKNOWN_KEY')
  })

  it('setColumnFilter("__proto__", …) is ignored and reported', () => {
    const t = filters()
    t.setColumnFilter('__proto__' as never, { type: 'equals', value: 'x' })
    const slice = t.getState().columnFilters as Loose
    expect(Object.getPrototypeOf(slice)).toBe(Object.prototype)
    expect(slice.type).toBeUndefined()
    expect(slice.value).toBeUndefined()
    const d = seen.find((x) => x.code === 'DK_STATE_UNKNOWN_KEY')
    expect(d?.where).toEqual({ kind: 'option', path: 'state.columnFilters.__proto__' })
    expect(ids(t)).toEqual([0, 1, 2])
  })

  it('a restored slice with an own "__proto__" key keeps its prototype on setColumnFilter', () => {
    const t = filters({ columnFilters: JSON.parse('{"__proto__":{"type":"equals","value":"x"}}') })
    t.setColumnFilter('name', { type: 'contains', value: 'n' })
    const slice = t.getState().columnFilters as Loose
    expect(Object.getPrototypeOf(slice)).toBe(Object.prototype)
    expect(slice.type).toBeUndefined()
    expect(ids(t)).toEqual([0, 1, 2])
  })

  it('a column or slice named "constructor" still works', () => {
    const rows = [{ constructor: 'a' }, { constructor: 'b' }] as Loose[]
    const t = createTable({
      data: rows,
      columns: [{ key: 'constructor' }] as Loose,
      features: [columnFilters()],
      onDiagnostic,
    })
    t.setColumnFilter('constructor', { type: 'equals', value: 'b' })
    expect(t.getRowModel().rows.map((r) => (r.original as Loose).constructor)).toEqual(['b'])
    t.setState({ constructor: 1 } as Loose)
    expect((t.getState() as Loose).constructor).toBe(1)
    expect(codes()).not.toContain('DK_STATE_UNKNOWN_KEY')
  })
})

describe('#103: dev deepFreeze of deeply nested restored state', () => {
  const deep = (n: number) => {
    let v: Loose = {}
    for (let i = 0; i < n; i++) v = i % 2 ? { a: v } : [v]
    return { a: v }
  }

  it('createTable returns a table for a 10k-deep initialState, and the snapshot is frozen', () => {
    // About 60 KB of JSON, which JSON.parse handles fine (the issue's payload).
    const json = `{"nested":${'{"a":'.repeat(10_000)}{}${'}'.repeat(10_000)}}`
    const payload = JSON.parse(json)
    const t = createTable({ data, initialState: payload as Loose, onDiagnostic })
    const s = t.getState() as Loose
    expect(Object.isFrozen(s)).toBe(true)
    expect(Object.isFrozen(s.nested)).toBe(true)
    expect(Object.isFrozen(s.nested.a.a)).toBe(true)
    t.setState({ other: deep(10_000) } as Loose)
    expect(Object.isFrozen((t.getState() as Loose).other.a)).toBe(true)
  })

  it('a 10k-deep field on a restored sort entry: setSorting / clearSorting still work', () => {
    const entry = { id: 'name', desc: false, extra: deep(10_000) }
    const t = createTable({
      data,
      features: [sorting()],
      initialState: { sorting: { by: [entry] } } as Loose,
      onDiagnostic,
    })
    t.setSorting([{ id: 'name', desc: true }])
    expect(t.getState().sorting.by).toEqual([{ id: 'name', desc: true }])
    t.setState({ sorting: { by: [entry] } } as Loose)
    t.clearSorting()
    expect(t.getState().sorting.by).toEqual([])
  })
})
