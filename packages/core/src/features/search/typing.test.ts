import { ExSearch } from 'ex-search'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Diagnostic } from '../../diagnostics/types'
import { createTable } from '../../table/create-table'
import { pagination } from '../pagination'
import { type SearchTyping, search } from './search'

let seen: Diagnostic[]
const onDiagnostic = (d: Diagnostic) => {
  seen.push(d)
}
const codes = () => seen.map((d) => d.code)

beforeEach(() => {
  seen = []
  vi.useFakeTimers()
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  vi.spyOn(console, 'error').mockImplementation(() => {})
  vi.spyOn(console, 'info').mockImplementation(() => {})
  vi.spyOn(console, 'groupCollapsed').mockImplementation(() => {})
  vi.spyOn(console, 'groupEnd').mockImplementation(() => {})
  vi.spyOn(console, 'log').mockImplementation(() => {})
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

type U = { id: number; name: string }
const users: U[] = [
  { id: 0, name: 'Adams' },
  { id: 1, name: 'Bob' },
  { id: 2, name: 'Cara' },
]

const make = (typing: SearchTyping | undefined) =>
  createTable({
    data: users,
    onDiagnostic,
    columns: [{ key: 'name', search: 1 }],
    features: [search(typing ? { typing } : {})],
  })

type T = ReturnType<typeof make>
const slice = (t: T) => t.getState().search
const ids = (t: T) => t.getRowModel().rows.map((r) => r.original.id)

describe('typing: immediate (default, client)', () => {
  it('input and query change together; no timer', () => {
    const t = make(undefined)
    void t.setSearch('bob')
    expect(slice(t)).toEqual({ input: 'bob', query: 'bob', status: 'idle' })
    expect(vi.getTimerCount()).toBe(0)
  })
})

describe('typing: debounce (debouncedSignal)', () => {
  it('trailing: input at once, query after `wait` of quiet; pending meanwhile', () => {
    const t = make({ strategy: 'debounce', wait: 200 })
    void t.setSearch('b')
    vi.advanceTimersByTime(100)
    void t.setSearch('bo')
    expect(slice(t)).toEqual({ input: 'bo', query: '', status: 'pending' })
    expect(ids(t)).toEqual([0, 1, 2])
    vi.advanceTimersByTime(199)
    expect(slice(t).query).toBe('')
    vi.advanceTimersByTime(1)
    expect(slice(t)).toEqual({ input: 'bo', query: 'bo', status: 'idle' })
    expect(ids(t)).toEqual([1])
  })

  it('wait defaults to 300 ms and accepts a temporal object', () => {
    const t = make({ strategy: 'debounce' })
    void t.setSearch('bob')
    vi.advanceTimersByTime(299)
    expect(slice(t).status).toBe('pending')
    vi.advanceTimersByTime(1)
    expect(slice(t).query).toBe('bob')

    const u = make({ strategy: 'debounce', wait: { seconds: 1, ms: 500 } })
    void u.setSearch('bob')
    vi.advanceTimersByTime(1499)
    expect(slice(u).status).toBe('pending')
    vi.advanceTimersByTime(1)
    expect(slice(u)).toEqual({ input: 'bob', query: 'bob', status: 'idle' })
  })

  it('leading: the first keystroke applies at once, the rest of the burst is dropped', () => {
    const t = make({ strategy: 'debounce', wait: 200, behavior: 'leading' })
    void t.setSearch('b')
    expect(slice(t)).toEqual({ input: 'b', query: 'b', status: 'idle' })
    void t.setSearch('bo')
    // Nothing is scheduled to commit 'bo': not pending (Enter commits it).
    expect(slice(t)).toEqual({ input: 'bo', query: 'b', status: 'idle' })
    vi.advanceTimersByTime(1000)
    expect(slice(t).query).toBe('b')
    void t.setSearch('bob')
    expect(slice(t).query).toBe('bob')
  })

  it('flushSearch (Enter) applies the input now; the timer does not fire again', () => {
    const t = make({ strategy: 'debounce', wait: 200 })
    void t.setSearch('cara')
    void t.flushSearch()
    expect(slice(t)).toEqual({ input: 'cara', query: 'cara', status: 'idle' })
    const listener = vi.fn()
    t.subscribe(listener)
    vi.advanceTimersByTime(500)
    expect(listener).not.toHaveBeenCalled()
  })

  it('cancelSearch drops the pending query; clearSearch empties both and cancels', () => {
    const t = make({ strategy: 'debounce', wait: 200 })
    void t.setSearch('bob')
    t.cancelSearch()
    expect(slice(t)).toEqual({ input: 'bob', query: '', status: 'idle' })
    vi.advanceTimersByTime(500)
    expect(slice(t).query).toBe('')

    void t.flushSearch()
    void t.setSearch('cara')
    t.clearSearch()
    expect(slice(t)).toEqual({ input: '', query: '', status: 'idle' })
    vi.advanceTimersByTime(500)
    expect(slice(t).query).toBe('')
  })

  it('typing back to the applied query cancels the pending commit', () => {
    const t = make({ strategy: 'debounce', wait: 200 })
    void t.setSearch('bob')
    void t.flushSearch()
    void t.setSearch('bobx')
    expect(slice(t).status).toBe('pending')
    void t.setSearch('bob')
    expect(slice(t)).toEqual({ input: 'bob', query: 'bob', status: 'idle' })
    expect(vi.getTimerCount()).toBe(0)
  })

  it('destroy cancels the timer (no late update, no DK_TABLE_DESTROYED)', () => {
    const t = make({ strategy: 'debounce', wait: 200 })
    void t.setSearch('bob')
    t.destroy()
    vi.advanceTimersByTime(500)
    expect(codes()).not.toContain('DK_TABLE_DESTROYED')
  })
})

describe('typing: throttle', () => {
  it('the first keystroke applies; later ones commit the latest value per window', () => {
    const t = make({ strategy: 'throttle', wait: 100 })
    void t.setSearch('b')
    expect(slice(t)).toEqual({ input: 'b', query: 'b', status: 'idle' })
    void t.setSearch('bo')
    void t.setSearch('bob')
    expect(slice(t)).toEqual({ input: 'bob', query: 'b', status: 'pending' })
    vi.advanceTimersByTime(100)
    expect(slice(t)).toEqual({ input: 'bob', query: 'bob', status: 'idle' })
    expect(ids(t)).toEqual([1])
  })

  it('flushSearch / cancelSearch drop the trailing commit', () => {
    const t = make({ strategy: 'throttle', wait: 100 })
    void t.setSearch('b')
    void t.setSearch('bo')
    t.cancelSearch()
    expect(slice(t)).toEqual({ input: 'bo', query: 'b', status: 'idle' })
    vi.advanceTimersByTime(200)
    expect(slice(t).query).toBe('b')
  })
})

describe('typing: minLength and commitOn', () => {
  it('minLength: a shorter (trimmed) input is an empty query', () => {
    const t = make({ minLength: 2 })
    void t.setSearch('b')
    expect(slice(t)).toEqual({ input: 'b', query: '', status: 'idle' })
    expect(ids(t)).toEqual([0, 1, 2])
    void t.setSearch(' b ')
    expect(slice(t).query).toBe('')
    void t.setSearch('bo')
    expect(slice(t).query).toBe('bo')
    void t.setSearch('b')
    expect(slice(t).query).toBe('')
  })

  it('minLength applies to flushSearch and to debounced commits', () => {
    const t = make({ strategy: 'debounce', wait: 100, minLength: 3, commitOn: 'type' })
    void t.setSearch('bob')
    vi.advanceTimersByTime(100)
    expect(slice(t).query).toBe('bob')
    void t.setSearch('bo')
    expect(slice(t).status).toBe('pending')
    vi.advanceTimersByTime(100)
    expect(slice(t)).toEqual({ input: 'bo', query: '', status: 'idle' })
  })

  it("commitOn 'enter': typing only sets input; flushSearch commits", () => {
    const t = make({ commitOn: 'enter' })
    void t.setSearch('bob')
    expect(slice(t)).toEqual({ input: 'bob', query: '', status: 'idle' })
    vi.advanceTimersByTime(1000)
    expect(slice(t).query).toBe('')
    void t.flushSearch()
    expect(slice(t)).toEqual({ input: 'bob', query: 'bob', status: 'idle' })
    expect(ids(t)).toEqual([1])
  })
})

describe('typing: RowModel.status (§6.6, never silent)', () => {
  it("'pending' while a debounce waits; a new row model and a notification each change", () => {
    const t = make({ strategy: 'debounce', wait: 200 })
    const first = t.getRowModel()
    expect(first.status).toBe('idle')
    const listener = vi.fn()
    t.subscribe(listener)
    void t.setSearch('bob')
    expect(listener).toHaveBeenCalledTimes(1)
    const pending = t.getRowModel()
    expect(pending).not.toBe(first)
    expect(pending.status).toBe('pending')
    expect(pending.rows).toHaveLength(3)
    vi.advanceTimersByTime(200)
    expect(listener).toHaveBeenCalledTimes(2)
    const done = t.getRowModel()
    expect(done.status).toBe('idle')
    expect(done.rows.map((r) => r.original.id)).toEqual([1])
  })

  it('typing without a query change does not re-run matching', () => {
    const t = make({ strategy: 'debounce', wait: 200 })
    void t.setSearch('bob')
    vi.advanceTimersByTime(200)
    expect(ids(t)).toEqual([1])
    const run = vi.spyOn(ExSearch.prototype, 'search')
    void t.setSearch('bobx')
    expect(ids(t)).toEqual([1])
    expect(run).not.toHaveBeenCalled()
  })

  it("the search slice's 'searching' / 'error' reach RowModel.status", () => {
    const t = make(undefined)
    t.setState({ search: { input: 'b', query: '', status: 'searching' } })
    expect(t.getRowModel().status).toBe('searching')
    t.setState({ search: { input: 'b', query: '', status: 'error', error: new Error('x') } })
    expect(t.getRowModel().status).toBe('error')
    t.setState({ search: { input: 'b', query: '', status: 'idle' } })
    expect(t.getRowModel().status).toBe('idle')
  })
})

describe('typing: pagination reset (R6)', () => {
  it('resets the page when the query changes, not per keystroke', () => {
    const many = Array.from({ length: 50 }, (_, i) => ({ id: i, name: i % 2 ? 'Bob' : 'Cara' }))
    const t = createTable({
      data: many,
      columns: [{ key: 'name', search: 1 }],
      features: [search({ typing: { strategy: 'debounce', wait: 200 } }), pagination()],
    })
    t.setPageIndex(1)
    void t.setSearch('bo')
    expect(t.getState().pagination.pageIndex).toBe(1)
    vi.advanceTimersByTime(200)
    expect(t.getState().pagination.pageIndex).toBe(0)
  })
})

describe('typing: options (§3.5)', () => {
  it('invalid values are DK_INVALID_OPTION', () => {
    expect(() => make({ strategy: 'later' as never })).toThrow(/DK_INVALID_OPTION|strategy/)
    expect(() => make({ strategy: 'debounce', wait: -1 })).toThrow(/DK_INVALID_OPTION|wait/)
    expect(() => make({ strategy: 'debounce', wait: { seconds: -1 } })).toThrow(
      /DK_INVALID_OPTION|wait/,
    )
    expect(() => make({ minLength: 1.5 })).toThrow(/DK_INVALID_OPTION|minLength/)
    expect(() => make({ commitOn: 'blur' as never })).toThrow(/DK_INVALID_OPTION|commitOn/)
  })

  it('unknown typing keys are reported', () => {
    make({ strategy: 'debounce', wiat: 10 } as never)
    expect(codes()).toContain('DK_UNKNOWN_OPTION')
  })

  it('wait / behavior without a strategy that uses them are DK_OPTION_NO_EFFECT', () => {
    make({ wait: 100 })
    expect(codes()).toContain('DK_OPTION_NO_EFFECT')
    seen = []
    make({ strategy: 'throttle', behavior: 'leading' })
    expect(codes()).toContain('DK_OPTION_NO_EFFECT')
    seen = []
    make({ strategy: 'debounce', wait: 100, behavior: 'leading' })
    expect(codes()).not.toContain('DK_OPTION_NO_EFFECT')
  })
})
