import { afterEach, describe, expect, it, vi } from 'vitest'
import { PROBE, type Releasable } from '../../pipeline/release'
import { createTable } from '../../table/create-table'
import type { RankState } from './ranks'
import { sorting } from './sorting'

afterEach(() => {
  vi.restoreAllMocks()
})

type R = { id: number; name: string | null }
// ≥ 10k rows: `auto` sorts strings by collation ranks (sorting.ts RANKS_MIN).
const N = 12_000
const make = (): R[] =>
  Array.from({ length: N }, (_, i) => ({
    id: i,
    name: i % 101 === 0 ? null : `name ${((i * 2654435761) >>> 0) % 50_000}`,
  }))

const order = (t: { getRowModel(): { rows: readonly { original: unknown }[] } }) =>
  t.getRowModel().rows.map((r) => (r.original as R).id)

/** A fresh table over `data`, sorted by name: the cold order. */
const cold = (data: R[], desc = false) => {
  const t = createTable({
    data,
    rowKey: 'id',
    features: [sorting()],
    initialState: { sorting: { by: [{ id: 'name', desc }] } },
  })
  return order(t)
}

type Probe = {
  rankKeys: WeakMap<object, object>
  history: Map<string, RankState>
  shown: unknown
  sortByCache: WeakMap<object, unknown>
  pathCache: WeakMap<object, unknown>
}
const probe = (f: object) => ((f as Releasable)[PROBE] as () => Probe)()

/** Counts `Intl.Collator#compare` calls (the getter returns a counting wrapper). */
function countCompares() {
  const desc = Object.getOwnPropertyDescriptor(Intl.Collator.prototype, 'compare')
  const get = desc?.get as (this: Intl.Collator) => Intl.Collator['compare']
  const count = { calls: 0 }
  vi.spyOn(Intl.Collator.prototype, 'compare', 'get').mockImplementation(function (
    this: Intl.Collator,
  ) {
    const real = get.call(this)
    return (a: string, b: string) => {
      count.calls++
      return real(a, b)
    }
  })
  return count
}

describe('sorting — incremental ranks across data versions (#95)', () => {
  it('a one-row setData re-ranks with a few collator calls and equals a cold sort', () => {
    const data = make()
    const f = sorting()
    const t = createTable({ data, rowKey: 'id', features: [f] })
    t.toggleSort('name')
    expect(order(t)).toEqual(cold(data))
    const count = countCompares()
    const edits: [number, string | null][] = [
      [N >> 1, 'aaa new'],
      [7, null],
      [N - 1, 'name 3'], // an existing string
      [101, 'zzz'], // a missing value becomes a string
    ]
    let cur = data
    for (const [at, name] of edits) {
      cur = cur.slice()
      cur[at] = { id: at, name }
      count.calls = 0
      t.setOptions({ data: cur })
      const got = order(t)
      expect(count.calls).toBeLessThan(64)
      vi.restoreAllMocks()
      expect(got).toEqual(cold(cur))
      countCompares()
    }
    // Rows inserted and removed (every index shifts), then the other direction.
    cur = [{ id: -1, name: 'name 0' }, ...cur.slice(0, 500), ...cur.slice(600)]
    t.setOptions({ data: cur })
    vi.restoreAllMocks()
    expect(order(t)).toEqual(cold(cur))
    t.toggleSort('name')
    expect(order(t)).toEqual(cold(cur, true))
    expect(probe(f).history.get('name')?.ids.size).toBeGreaterThan(10_000)
  })
})

describe('destroy() releases the sort caches (#98)', () => {
  it('features drop their caches and the runner its column cache, memo and keys', () => {
    const data = make()
    const f = sorting()
    const t = createTable({
      data,
      rowKey: 'id',
      columns: [{ key: 'name' }],
      features: [f],
    })
    t.toggleSort('name')
    t.setState({
      sorting: {
        by: [
          { id: 'name', desc: false },
          { id: 'id', desc: false },
        ],
      },
    })
    const rows = t.getRowModel().rows
    const runner = () => ((t as Releasable)[PROBE] as () => Record<string, unknown>)()
    const before = probe(f)
    expect(before.history.has('name')).toBe(true)
    expect(before.shown).toBeDefined()
    expect(before.pathCache.has(data)).toBe(true)
    expect(runner()).toEqual({ memo: 1, keys: true, last: true, cached: true })

    t.destroy()
    const after = probe(f)
    expect(after.rankKeys).not.toBe(before.rankKeys)
    expect(after.history.size).toBe(0)
    expect(after.shown).toBeUndefined()
    expect(after.pathCache.has(data)).toBe(false)
    expect(runner()).toEqual({ memo: 0, keys: false, last: false, cached: false })
    // The last row model stays readable (teardown renders).
    expect(t.getRowModel().rows).toBe(rows)
  })
})
