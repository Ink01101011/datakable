import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { pagination } from '../features/pagination'
import { createTable } from '../table/create-table'
import type { FetchParams, FetchResult } from './fetcher'

const unhandled: unknown[] = []
type Proc = {
  on(e: string, f: (e: unknown) => void): void
  off(e: string, f: (e: unknown) => void): void
}
const proc = (globalThis as unknown as { process: Proc }).process
const onUnhandled = (e: unknown) => {
  unhandled.push(e)
}

beforeEach(() => {
  unhandled.length = 0
  proc.on('unhandledRejection', onUnhandled)
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  vi.spyOn(console, 'error').mockImplementation(() => {})
  vi.spyOn(console, 'groupCollapsed').mockImplementation(() => {})
  vi.spyOn(console, 'groupEnd').mockImplementation(() => {})
  vi.spyOn(console, 'log').mockImplementation(() => {})
})
afterEach(async () => {
  await new Promise((r) => setTimeout(r, 0))
  proc.off('unhandledRejection', onUnhandled)
  expect(unhandled).toEqual([])
  vi.restoreAllMocks()
})

type P = { id: string }
const rows = (n: number): P[] => Array.from({ length: n }, (_, i) => ({ id: `p${i}` }))
const key = (p: FetchParams | undefined) => ({ ...p, signal: undefined })
const tick = () => new Promise((r) => setTimeout(r, 0))

function manual() {
  const calls: {
    params: FetchParams
    resolve: (r: unknown) => void
    reject: (e: unknown) => void
  }[] = []
  const fetcher = vi.fn(
    (params: FetchParams) =>
      new Promise<FetchResult<P>>((resolve, reject) => {
        calls.push({ params, resolve: resolve as (r: unknown) => void, reject })
      }),
  )
  const last = () => calls[calls.length - 1] as (typeof calls)[number]
  return { fetcher, calls, last }
}

const make = (fetcher: (p: FetchParams) => Promise<FetchResult<P>>, strict = false) =>
  createTable<P, never, [ReturnType<typeof pagination>]>({
    fetcher,
    strict,
    onDiagnostic: () => {},
    features: [pagination({ mode: 'server' })],
  })

describe('table.refetch() (retry a failed fetch from the UI)', () => {
  it("recovers after a failed fetch: 'error' → refetch → 'applied', status 'idle'", async () => {
    const m = manual()
    const t = make(m.fetcher)
    m.last().reject(new Error('down'))
    await tick()
    expect(t.getRowModel().status).toBe('error')
    const p = t.refetch()
    expect(m.calls).toHaveLength(2)
    expect(key(m.last().params)).toEqual(key(m.calls[0]?.params))
    expect(t.getRowModel().status).toBe('error')
    m.last().resolve({ rows: rows(2), rowCount: 2 })
    await expect(p).resolves.toEqual({ status: 'applied' })
    expect(t.getRowModel().status).toBe('idle')
    expect(t.getRowModel().rows).toHaveLength(2)
  })

  it("resolves { status: 'error' } on failure and on a bad response; never rejects", async () => {
    const m = manual()
    const t = make(m.fetcher)
    m.last().resolve({ rows: rows(1), rowCount: 1 })
    await tick()
    const a = t.refetch()
    m.last().reject(new Error('down'))
    await expect(a).resolves.toEqual({ status: 'error' })
    const b = t.refetch()
    m.last().resolve({ nope: 1 })
    await expect(b).resolves.toEqual({ status: 'error' })
    // The previous rows are kept.
    expect(t.getRowModel().rows).toHaveLength(1)
  })

  it('strict: still resolves (the DatakableError goes to the hub, not the caller)', async () => {
    const m = manual()
    const t = make(m.fetcher, true)
    await tick()
    const p = t.refetch()
    m.last().reject(new Error('down'))
    await expect(p).resolves.toEqual({ status: 'error' })
  })

  it("a refetch replaced by a newer request is 'superseded'", async () => {
    const m = manual()
    const t = make(m.fetcher)
    const a = t.refetch()
    const b = t.refetch()
    m.last().resolve({ rows: rows(1), rowCount: 1 })
    await expect(a).resolves.toEqual({ status: 'superseded' })
    await expect(b).resolves.toEqual({ status: 'applied' })
  })

  it("without a fetcher: 'applied' at once (nothing to load); after destroy: 'superseded'", async () => {
    const t = createTable<P>({ data: rows(1) })
    await expect(t.refetch()).resolves.toEqual({ status: 'applied' })
    const m = manual()
    const s = make(m.fetcher)
    const p = s.refetch()
    s.destroy()
    await expect(p).resolves.toEqual({ status: 'superseded' })
    await expect(s.refetch()).resolves.toEqual({ status: 'superseded' })
  })

  it('refetch is a core method (on the table literal)', () => {
    const t = createTable<P>({ data: rows(1) })
    expect(typeof t.refetch).toBe('function')
  })
})

describe('setOptions({ fetcher }) with a new reference refetches', () => {
  it('a new fetcher runs at once with the current params; the same reference does not', async () => {
    const m = manual()
    const t = make(m.fetcher)
    m.last().resolve({ rows: rows(1), rowCount: 1 })
    await tick()
    t.setOptions({ fetcher: m.fetcher })
    expect(m.calls).toHaveLength(1)
    const n = manual()
    t.setOptions({ fetcher: n.fetcher })
    expect(n.calls).toHaveLength(1)
    expect(key(n.last().params)).toEqual(key(m.calls[0]?.params))
    expect(t.getRowModel().status).toBe('fetching')
    n.last().resolve({ rows: rows(3), rowCount: 3 })
    await tick()
    expect(t.getRowModel().rows).toHaveLength(3)
    // Unrelated option changes do not refetch.
    t.setOptions({ name: 'x' })
    expect(n.calls).toHaveLength(1)
  })
})
