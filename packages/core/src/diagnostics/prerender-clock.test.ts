import { afterEach, describe, expect, it, vi } from 'vitest'
import { sorting } from '../features/sorting'
import { withFetcher } from '../source/server-entry'
import { createTable } from '../table/create-table'
import { createDeferred } from '../table/ssr'
import { createDiagnostics } from './hub'

// Next 16 `cacheComponents` (#7): reading `Date.now()` / `new Date()` while prerendering aborts
// `next build` ("encountered the unstable value `Date.now()`"). Next reserves `Date` for output and
// `performance` for introspection, so a diagnostic emitted during a render must never read `Date`.
// This mirrors Next's trap: every wall-clock read through `Date` is recorded.
function trapDate() {
  const real = globalThis.Date
  const reads: string[] = []
  const Trap = function (this: unknown, ...args: unknown[]) {
    if (!new.target) reads.push('Date()')
    else if (args.length === 0) reads.push('new Date()')
    return new.target ? Reflect.construct(real, args, new.target) : real()
  } as unknown as DateConstructor
  Object.defineProperties(Trap, Object.getOwnPropertyDescriptors(real))
  Trap.now = () => {
    reads.push('Date.now()')
    return real.now()
  }
  globalThis.Date = Trap
  return { reads, restore: () => (globalThis.Date = real) }
}

let trap: ReturnType<typeof trapDate> | undefined
afterEach(() => {
  trap?.restore()
  trap = undefined
  vi.restoreAllMocks()
})

const quiet = () => {
  for (const m of ['warn', 'error', 'info', 'groupCollapsed', 'groupEnd'] as const) {
    vi.spyOn(console, m).mockImplementation(() => {})
  }
}

describe('diagnostics never read Date while rendering (#7, Next 16 cacheComponents)', () => {
  it('DK_DUPLICATE_ROW_KEY: no Date read; occurrences still hold an epoch-ms timestamp', () => {
    quiet()
    const before = Date.now()
    trap = trapDate()
    const t = createTable({ data: [{ id: 1 }, { id: 1 }], rowKey: 'id' })
    t.getRowModel()
    const { reads } = trap
    trap.restore()
    const d = t.getDiagnostics().find((x) => x.code === 'DK_DUPLICATE_ROW_KEY')
    expect(d).toBeDefined()
    expect(reads).toEqual([])
    const { first, last } = d?.context.occurrences ?? { first: 0, last: 0 }
    expect(first).toBeGreaterThanOrEqual(before - 1000)
    expect(first).toBeLessThanOrEqual(Date.now() + 1000)
    expect(Number.isInteger(first)).toBe(true)
    expect(last).toBe(first)
  })

  it('DK_SSR_ASYNC_DEFERRED (the createDeferred docs example): no Date read', () => {
    quiet()
    trap = trapDate()
    const t = createDeferred(() =>
      createTable({
        rowKey: 'id',
        features: [sorting({ mode: 'server' })],
        fetcher: withFetcher(async () => ({ rows: [] as { id: number }[] })),
      }),
    )
    expect(t.getRowModel().status).toBe('pending')
    const { reads } = trap
    trap.restore()
    expect(t.getDiagnostics().map((x) => x.code)).toContain('DK_SSR_ASYNC_DEFERRED')
    expect(reads).toEqual([])
  })

  it('the hub and its console rate limit use the injected clock, else no Date read', () => {
    quiet()
    trap = trapDate()
    const hub = createDiagnostics({ dev: true })
    hub.emit('DK_INTERNAL', { op: 'test', problem: 'x' })
    const { reads } = trap
    trap.restore()
    expect(reads).toEqual([])
    expect(
      createDiagnostics({ now: () => 42 }).emit('DK_INTERNAL', { op: 'test', problem: 'y' })
        ?.context.occurrences.first,
    ).toBe(42)
  })
})
