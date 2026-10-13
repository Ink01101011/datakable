// @vitest-environment node
import { type FetchResult, sorting } from '@datakable/core'
import { withFetcher } from '@datakable/core/server'
import { renderToString } from 'react-dom/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DataTable } from './data-table'

// #7: Next 16 with `cacheComponents` aborts `next build` when a Client Component reads `Date.now()`
// while prerendering. A diagnostic emitted during the server render (a duplicate row key, a
// deferred fetcher) must not read `Date`. This records every wall-clock read through `Date`, as
// Next's prerender trap does.
const real = globalThis.Date
function trapDate(): string[] {
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
  return reads
}

// onDiagnostic is delivered after the commit (never on the server): the console sink shows the emit.
let printed: string[] = []
beforeEach(() => {
  printed = []
  for (const m of ['warn', 'error', 'info', 'log', 'groupCollapsed', 'groupEnd'] as const) {
    vi.spyOn(console, m).mockImplementation((...a: unknown[]) => {
      printed.push(a.join(' '))
    })
  }
})
const emitted = (code: string) => printed.some((l) => l.includes(code))
afterEach(() => {
  globalThis.Date = real
  vi.restoreAllMocks()
})

describe('<DataTable /> prerender reads no wall clock (#7)', () => {
  it('duplicate row key (DK_DUPLICATE_ROW_KEY): renders, reports, no Date read', () => {
    const reads = trapDate()
    const html = renderToString(<DataTable data={[{ id: 1 }, { id: 1 }]} rowKey="id" />)
    globalThis.Date = real
    expect(html).toContain('<table')
    expect(emitted('DK_DUPLICATE_ROW_KEY')).toBe(true)
    expect(reads).toEqual([])
  })

  it('a fetcher without initialData (DK_SSR_ASYNC_DEFERRED): no Date read', () => {
    const reads = trapDate()
    renderToString(
      <DataTable
        rowKey="id"
        features={[sorting({ mode: 'server' })]}
        fetcher={withFetcher(() => Promise.resolve<FetchResult<{ id: number }>>({ rows: [] }))}
      />,
    )
    globalThis.Date = real
    expect(emitted('DK_SSR_ASYNC_DEFERRED')).toBe(true)
    expect(reads).toEqual([])
  })
})
