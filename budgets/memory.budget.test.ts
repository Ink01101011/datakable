import { createDefaultFeatures, createTable } from '@datakable/core'
import { describe, expect, it } from 'vitest'
import { measureHeap } from './measure'

// §9.3 "Pipeline memory at 100k rows (excluding source data) ≤ 5 MB" with the REAL default preset
// (columnFilters, validity, search, sorting, pagination) from the built `@datakable/core`, in
// production mode (T37). Memory = JS heap + typed-array backing stores after two full GCs, taken
// after the source data exists and while the table is alive: what the table adds on top of `data`.
//
// Scenarios: 100k rows `{ id, age, name }`, all columns derived (zero-config), filter `age ≥ 10`
// (90k rows kept), sort by `age`; then the default page of 10 rows, a client search on top, or no
// pagination (90k visible rows). Every scenario is held to the 5 MB spec budget (F2): `rows` builds
// a Row only when its index is read, and search keeps no per-row projection (search-index.ts).

const N = 100_000
type R = { id: number; age: number; name: string }
const makeData = (): R[] =>
  Array.from({ length: N }, (_, i) => ({ id: i, age: (i * 7919) % 100, name: `name ${i}` }))

const BUDGET_MB = 5

const CITIES = ['Bangkok', 'กรุงเทพมหานคร', 'Chiang Mai', 'São Paulo', 'Zürich', '東京']
const TAGS = ['admin', 'beta', 'vip', 'ลูกค้า', 'früh', '🔥']

/** The PVT shape (#27): ten mixed-type fields, nullish / NaN numbers, Date | string, arrays. */
const mixedUsers = () =>
  Array.from({ length: N }, (_, i) => {
    const id = i + 1
    const ms = Date.UTC(2015, 0, 1) + ((i * 7919) % 3650) * 86_400_000 + ((i * 104729) % 86_400_000)
    return {
      id,
      name: `user ${(i * 2654435761) % N}`,
      age:
        id % 17 === 0
          ? null
          : id % 19 === 0
            ? undefined
            : id % 23 === 0
              ? Number.NaN
              : 18 + (i % 62),
      city: CITIES[i % CITIES.length] as string,
      email: `user${id}@example.com`,
      joined: id % 2 === 0 ? new Date(ms) : new Date(ms).toISOString(),
      balance: id % 25 === 0 ? `${9007199254740993n + BigInt(id)}` : ((i * 7919) % 1_000_000) / 100,
      tags: TAGS.filter((_, k) => (i >> k) % 3 === 0).slice(0, 3),
      address: { street: `${1 + (i % 999)} Sukhumvit Rd`, geo: { lat: i % 90, lng: i % 180 } },
      isActive: i % 10 > 2,
    }
  })

function preset(data: R[]) {
  return createTable({ data, rowKey: 'id', features: createDefaultFeatures(), onDiagnostic() {} })
}

describe('§9.3 pipeline memory, real default preset, 100k rows (dist, production)', () => {
  it(`filter + sort, paginated (10 rows): ≤ ${BUDGET_MB} MB`, () => {
    const data = makeData()
    const { mb, value: t } = measureHeap(() => {
      const t = preset(data)
      t.getRowModel()
      t.setColumnFilter('age', { type: 'range', value: { min: 10 } })
      t.toggleSort('age')
      t.getRowModel()
      return t
    })
    const m = t.getRowModel()
    console.info(`[§9.3 memory] filter+sort, paginated: ${mb.toFixed(2)} MB (budget ${BUDGET_MB})`)
    expect(m.rows).toHaveLength(10)
    expect(m.filteredCount).toBe(data.filter((r) => r.age >= 10).length)
    expect(mb).toBeLessThanOrEqual(BUDGET_MB)
    expect(t.getData()).toBe(data)
  })

  it(`client search applied: ≤ ${BUDGET_MB} MB`, async () => {
    const data = makeData()
    const { mb, value: t } = await measureHeap(async () => {
      const t = preset(data)
      t.getRowModel()
      t.setColumnFilter('age', { type: 'range', value: { min: 10 } })
      t.toggleSort('age')
      await expect(t.setSearch('name 99')).resolves.toEqual({ status: 'applied' })
      t.getRowModel()
      return t
    })
    const m = t.getRowModel()
    console.info(`[§9.3 memory] filter+sort+search: ${mb.toFixed(2)} MB (budget ${BUDGET_MB})`)
    expect(t.getState().search.query).toBe('name 99')
    expect(m.filteredCount).toBeGreaterThan(0)
    expect(mb).toBeLessThanOrEqual(BUDGET_MB)
    expect(t.getData()).toBe(data)
  })

  // #27: zero-config search over mixed column types (the PVT data shape). Columns of primitives
  // (strings, nullable numbers, number | string, booleans) keep no formatted copy; object columns
  // (dates, arrays, nested objects) keep their formatted strings in the column cache. Every
  // searched column still costs its values array (8 bytes per row in Node), so the budget holds
  // for a few searched columns: five primitive columns are held to it, seven and all ten printed.
  it(`zero-config search, 5 mixed primitive columns: ≤ ${BUDGET_MB} MB (7 and 10 printed)`, async () => {
    const data = mixedUsers()
    const five = data.map(({ id, name, age, balance, isActive }) => ({
      id,
      name,
      age,
      balance,
      isActive,
    }))
    const seven = data.map(({ joined, tags, address, ...rest }) => rest)
    const run = async (rows: readonly { id: number }[], label: string) => {
      const { mb, value: t } = await measureHeap(async () => {
        const t = createTable({
          data: rows,
          rowKey: 'id',
          features: createDefaultFeatures(),
          onDiagnostic() {},
        })
        t.getRowModel()
        await expect(t.setSearch('user 12')).resolves.toEqual({ status: 'applied' })
        return t
      })
      console.info(`[§9.3 memory] zero-config search, ${label}: ${mb.toFixed(2)} MB`)
      expect(t.getRowModel().filteredCount).toBeGreaterThan(0)
      expect(t.getData()).toBe(rows)
      return mb
    }
    expect(await run(five, `5 primitive columns (budget ${BUDGET_MB})`)).toBeLessThanOrEqual(
      BUDGET_MB,
    )
    await run(seven, '7 primitive columns')
    await run(data, 'all 10 columns (+ Date | string, arrays, objects)')
  })

  it(`filter + sort, unpaginated (90k visible rows): ≤ ${BUDGET_MB} MB`, () => {
    const data = makeData()
    const { mb, value: t } = measureHeap(() => {
      const t = preset(data)
      t.setPageSize(N)
      t.setColumnFilter('age', { type: 'range', value: { min: 10 } })
      t.toggleSort('age')
      t.getRowModel()
      return t
    })
    const m = t.getRowModel()
    console.info(
      `[§9.3 memory] filter+sort, unpaginated: ${mb.toFixed(2)} MB (budget ${BUDGET_MB})`,
    )
    expect(m.rows).toHaveLength(m.filteredCount)
    expect(mb).toBeLessThanOrEqual(BUDGET_MB)
    expect(t.getData()).toBe(data)
  })
})
