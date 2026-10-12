import { describe, expect, it } from 'vitest'
import { type ContextBase, createContext, createContextPool } from './context'

const base: ContextBase = {
  table: 'tbl',
  run: 7,
  trigger: 'data-change',
  phase: 'client',
  emit: () => {},
}
const batchInput = (column: string) => ({
  column,
  slot: 'format' as const,
  rows: new Uint32Array(0),
})

describe('createContext', () => {
  it('builds a ctx with every §3.4 field', () => {
    const ctx = createContext('pipeline:run', { rowCount: 3 }, 'pipeline', base)
    expect(ctx).toMatchObject({
      op: 'pipeline:run',
      input: { rowCount: 3 },
      where: 'pipeline',
      table: 'tbl',
      run: 7,
      trigger: 'data-change',
      phase: 'client',
    })
    expect(ctx.meta).toBeInstanceOf(Map)
    expect(typeof ctx.emit).toBe('function')
    expect(ctx.signal).toBeUndefined()
  })

  it('carries a signal when given', () => {
    const ac = new AbortController()
    const ctx = createContext('async:request', { source: 'fetcher' }, 'fetcher', base, ac.signal)
    expect(ctx.signal).toBe(ac.signal)
  })
})

describe('createContextPool', () => {
  it('reuses a released ctx and resets it', () => {
    const pool = createContextPool()
    const a = pool.acquire('column:batch', batchInput('price'), 'columns[0].format', base)
    a.meta.set('x', 1)
    pool.release(a)
    const b = pool.acquire('column:batch', batchInput('name'), 'columns[1].format', {
      ...base,
      run: 8,
    })
    expect(b).toBe(a)
    expect(b.meta.size).toBe(0)
    expect(b.input.column).toBe('name')
    expect(b.where).toBe('columns[1].format')
    expect(b.run).toBe(8)
  })

  it('hands out distinct objects while one is in use (re-entrant safe)', () => {
    const pool = createContextPool()
    const a = pool.acquire('column:batch', batchInput('a'), 'a', base)
    const b = pool.acquire('column:batch', batchInput('b'), 'b', base)
    expect(b).not.toBe(a)
    pool.release(b)
    pool.release(a)
    expect(pool.size).toBe(2)
  })

  it('does not grow past its bound', () => {
    const pool = createContextPool(1)
    const a = pool.acquire('column:batch', batchInput('a'), 'a', base)
    const b = pool.acquire('column:batch', batchInput('b'), 'b', base)
    pool.release(a)
    pool.release(b)
    expect(pool.size).toBe(1)
  })
})
