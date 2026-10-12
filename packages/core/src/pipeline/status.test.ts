import { beforeEach, describe, expect, it, vi } from 'vitest'
import { defineFeature } from '../feature/define'
import type { AnyFeature } from '../feature/types'
import { defineInterceptor } from '../intercept/define'
import { createTable } from '../table/create-table'

beforeEach(() => {
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  vi.spyOn(console, 'error').mockImplementation(() => {})
  vi.spyOn(console, 'groupCollapsed').mockImplementation(() => {})
  vi.spyOn(console, 'groupEnd').mockImplementation(() => {})
  vi.spyOn(console, 'log').mockImplementation(() => {})
})

type P = { id: string; n: number }
const people = (n: number): P[] => Array.from({ length: n }, (_, i) => ({ id: `p${i}`, n: i }))
const api = (t: object) => t as unknown as Record<string, (...a: unknown[]) => unknown>

describe('RowModel.isInitialLoad (§6.6)', () => {
  it('false once data given at creation produced a row model (an empty array counts)', () => {
    expect(createTable({ data: people(2) }).getRowModel().isInitialLoad).toBe(false)
    expect(createTable({ data: [] }).getRowModel().isInitialLoad).toBe(false)
  })

  it('true without data until data is applied; then a new row model and a notification', () => {
    const t = createTable<P>({})
    const first = t.getRowModel()
    expect(first.isInitialLoad).toBe(true)
    expect(first.rows).toHaveLength(0)
    const listener = vi.fn()
    t.subscribe(listener)
    t.setOptions({ data: [] })
    expect(listener).toHaveBeenCalledTimes(1)
    const next = t.getRowModel()
    expect(next).not.toBe(first)
    expect(next.isInitialLoad).toBe(false)
  })

  it('never goes back to true', () => {
    const t = createTable<P>({ data: people(1) })
    t.setOptions({ data: [] })
    expect(t.getRowModel().isInitialLoad).toBe(false)
    t.setOptions({ columns: [{ key: 'n' }] })
    expect(t.getRowModel().isInitialLoad).toBe(false)
  })

  it('an async ingest: true until the creation data is applied', async () => {
    const t = createTable<P>({
      data: people(2),
      interceptors: [
        defineInterceptor({
          name: 'async',
          on: ['data:ingest'],
          intercept: (_ctx, next) => Promise.resolve(next()),
        }),
      ],
    })
    expect(t.getRowModel().isInitialLoad).toBe(true)
    const listener = vi.fn()
    t.subscribe(listener)
    await new Promise((r) => setTimeout(r, 0))
    expect(listener).toHaveBeenCalled()
    const m = t.getRowModel()
    expect(m.isInitialLoad).toBe(false)
    expect(m.rows).toHaveLength(2)
  })
})

describe('status is never silent (§6.6)', () => {
  it("'error' from a failing rowModel and recovery to 'idle': new object + notification each", () => {
    let fail = false
    const flaky = defineFeature({
      name: 'flaky',
      stage: 'filter',
      initialState: () => ({ v: 0 }),
      createApi: (ctx) => ({ bump: () => ctx.setState((s) => ({ v: s.v + 1 })) }),
      rowModel: (indices) => {
        if (fail) throw new Error('boom')
        return indices
      },
    }) as AnyFeature
    const t = createTable({ data: people(3), features: [flaky], onDiagnostic: () => {} })
    const idle = t.getRowModel()
    expect(idle.status).toBe('idle')

    const seen: string[] = []
    t.subscribe(() => {
      seen.push(t.getRowModel().status)
    })

    fail = true
    api(t).bump?.()
    const error = t.getRowModel()
    expect(error.status).toBe('error')
    expect(error).not.toBe(idle)
    // Same visible rows (the step passed its input through), still a new object.
    const at = (m: { rows: readonly { index: number }[] }) => m.rows.map((r) => r.index)
    expect(at(error)).toEqual(at(idle))

    fail = false
    api(t).bump?.()
    const recovered = t.getRowModel()
    expect(recovered.status).toBe('idle')
    expect(recovered).not.toBe(error)
    expect(seen).toEqual(['error', 'idle'])
  })

  it("'error' when pipeline:run fails, back to 'idle' on good data: notified both times", () => {
    const data = people(2)
    const t = createTable<P>({ data, onDiagnostic: () => {} })
    const good = t.getRowModel()
    const seen: string[] = []
    t.subscribe(() => {
      seen.push(t.getRowModel().status)
    })
    const broken = new Proxy(people(3), {
      get(target, p, r) {
        if (typeof p === 'string' && /^\d+$/.test(p)) throw new Error('unreadable row')
        return Reflect.get(target, p, r)
      },
    })
    t.setOptions({ data: broken })
    const error = t.getRowModel()
    expect(error.status).toBe('error')
    expect(error).not.toBe(good)
    t.setOptions({ data })
    const recovered = t.getRowModel()
    expect(recovered.status).toBe('idle')
    expect(recovered).not.toBe(error)
    expect(seen).toEqual(['error', 'idle'])
  })
})
