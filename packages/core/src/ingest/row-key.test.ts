import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Diagnostic } from '../diagnostics/types'
import { minFilter } from '../pipeline/test-features'
import { createTable } from '../table/create-table'
import { findUniqueFields } from './unique-fields'

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

type U = { id: number | null; uuid: string; branch: string; age: number; meta: { code: string } }
const users = (ids: (number | null)[]): U[] =>
  ids.map((id, i) => ({
    id,
    uuid: `u-${i}`,
    branch: `b${i % 3}`,
    age: i % 2,
    meta: { code: `c${i}` },
  }))
const keys = (t: { getRowModel(): { rows: readonly { key: string | number }[] } }) =>
  t.getRowModel().rows.map((r) => r.key)

describe('rowKey: unique keys', () => {
  it('uses the key value; no diagnostic', () => {
    const t = createTable({ data: users([1, 2, 3]), rowKey: 'id', onDiagnostic })
    expect(keys(t)).toEqual([1, 2, 3])
    expect(codes()).toEqual([])
  })

  it('a nested path and a function', () => {
    const data = users([1, 2])
    expect(keys(createTable({ data, rowKey: 'meta.code', onDiagnostic }))).toEqual(['c0', 'c1'])
    expect(keys(createTable({ data, rowKey: (u) => u.uuid, onDiagnostic }))).toEqual(['u-0', 'u-1'])
    expect(codes()).toEqual([])
  })

  it('the row index without rowKey, whatever the data', () => {
    const t = createTable({ data: users([1, 1, null]), onDiagnostic })
    expect(keys(t)).toEqual([0, 1, 2])
    expect(codes()).toEqual([])
  })
})

describe('rowKey: DK_DUPLICATE_ROW_KEY', () => {
  it('fallback keys key#1, key#2; one error naming the rows', () => {
    const t = createTable({ data: users([7, 42, 9, 42, 42]), rowKey: 'id', onDiagnostic })
    expect(keys(t)).toEqual([7, 42, 9, '42#1', '42#2'])
    expect(codes()).toEqual(['DK_DUPLICATE_ROW_KEY'])
    const d = seen[0] as Diagnostic
    expect(d.level).toBe('error')
    expect(d.details).toMatchObject({ path: 'id', key: 42, rows: [1, 3, 4], count: 2, total: 5 })
    expect(d.where).toEqual({ kind: 'row', index: 3, key: '42' })
    expect(d.problem).toContain('rowKey "id" is not unique')
    expect(d.problem).toContain('#1, #3, #4')
    expect(d.impact).toContain('42#1, 42#2')
  })

  it('fix names fields unique across all rows, computed by a scan', () => {
    // branch (b0 b1 b2 b0) and age repeat; uuid and meta.code do not.
    const t = createTable({ data: users([1, 1, 2, 3]), rowKey: 'id', onDiagnostic })
    void t.getRowModel()
    const d = seen[0] as Diagnostic
    expect(d.details.unique).toEqual(['uuid', 'meta.code'])
    expect(d.fix[0]).toBe("rowKey: 'uuid' (unique in all 4 rows)")
    expect(d.fix[1]).toBe("rowKey: 'meta.code' (unique in all 4 rows)")
  })

  it('never suggests a field that is unique only in the first rows', () => {
    // `serial` is unique in the first 60 rows and repeats at the end; `uuid` is unique everywhere.
    const data = Array.from({ length: 61 }, (_, i) => ({
      id: i < 2 ? 0 : i,
      serial: i === 60 ? 5 : i,
      uuid: `u${i}`,
      flag: true,
    }))
    createTable({ data, rowKey: 'id', onDiagnostic }).getRowModel()
    expect(seen[0]?.details.unique).toEqual(['uuid'])
  })

  it('no unique field: a verified composite rowKey (rowKey + a field)', () => {
    // No single field is unique; (id, branch) is.
    const data = [
      { id: 1, branch: 'a', n: 'x' },
      { id: 1, branch: 'b', n: 'x' },
      { id: 2, branch: 'a', n: 'y' },
    ]
    createTable({ data, rowKey: 'id', onDiagnostic }).getRowModel()
    const d = seen[0] as Diagnostic
    expect(d.details).toMatchObject({ unique: [], pair: 'branch' })
    expect(d.fix[0]).toBe(`rowKey: (row) => \`\${row.id}-\${row.branch}\` (unique in all 3 rows)`)
  })

  it('the composite is checked with the exact string it builds', () => {
    // `${id}-${b}`: '1-2' + '3' vs '1' + '2-3' collide as strings → no pair suggested.
    const data = [
      { id: '1-2', b: '3' },
      { id: '1', b: '2-3' },
      { id: '1', b: '9' },
      { id: '1-2', b: '3' },
    ]
    createTable({ data, rowKey: 'id', onDiagnostic }).getRowModel()
    const d = seen[0] as Diagnostic
    expect(d.details.pair).toBeUndefined()
    expect(d.details.unique).toEqual([])
    expect(d.fix.join('\n')).toContain('no field is unique across all 4 rows')
  })

  it('keys are computed over all rows: stable when the first occurrence is filtered out', () => {
    const data = [
      { id: 1, age: 1 },
      { id: 1, age: 30 },
      { id: 2, age: 40 },
    ]
    const t = createTable({
      data,
      rowKey: 'id',
      columns: [{ key: 'age' }],
      features: [minFilter('age')],
    })
    expect(keys(t)).toEqual([1, '1#1', 2])
    ;(t as unknown as { setMin(v: number): void }).setMin(10)
    expect(keys(t)).toEqual(['1#1', 2])
  })

  it('a fallback key already used by another row moves on to the next n', () => {
    const t = createTable({
      data: [{ id: 'a' }, { id: 'a#1' }, { id: 'a' }],
      rowKey: 'id',
      onDiagnostic,
    })
    expect(keys(t)).toEqual(['a', 'a#1', 'a#2'])
    expect(new Set(keys(t)).size).toBe(3)
  })

  it("1 and '1' are the same key (compared as strings, like React keys and explainRow) (#24)", () => {
    const t = createTable({
      data: [
        { id: 1, n: 'number one' },
        { id: '1', n: 'string one' },
      ],
      rowKey: 'id',
      onDiagnostic,
    })
    expect(keys(t)).toEqual([1, '1#1'])
    expect(codes()).toEqual(['DK_DUPLICATE_ROW_KEY'])
    expect(seen[0]?.details).toMatchObject({ key: '1', rows: [0, 1], shared: 2, count: 1 })
    expect(t.explainRow('1').index).toBe(0)
    expect(t.explainRow('1#1').index).toBe(1)
  })

  it("a field unique only by type (1 vs '1') is never suggested (#24)", () => {
    const data = [
      { id: 7, code: 1, uuid: 'a' },
      { id: 7, code: '1', uuid: 'b' },
    ]
    expect(findUniqueFields(data, 'id').unique).toEqual(['uuid'])
  })

  it('a fallback never takes the real, unique key of a later row (#29)', () => {
    const t = createTable({
      data: [{ id: '1' }, { id: '1' }, { id: '1#1' }],
      rowKey: 'id',
      onDiagnostic,
    })
    expect(keys(t)).toEqual(['1', '1#2', '1#1'])
    expect(t.explainRow('1#1').index).toBe(2)
    expect(seen[0]?.details).toMatchObject({ key: '1', rows: [0, 1], count: 1 })
  })

  it('a missing-key fallback #index never takes a later real key (#29)', () => {
    const t = createTable({
      data: [{ id: null }, { id: 2 }, { id: '#0' }] as { id: unknown }[],
      rowKey: 'id' as never,
      onDiagnostic,
    })
    expect(keys(t)).toEqual(['#0#1', 2, '#0'])
    expect(t.explainRow('#0').index).toBe(2)
    expect(codes()).toEqual(['DK_MISSING_ROW_KEY'])
  })

  it('several duplicated values: one diagnostic with the group count', () => {
    const t = createTable({ data: users([1, 1, 2, 2, 3]), rowKey: 'id', onDiagnostic })
    expect(keys(t)).toEqual([1, '1#1', 2, '2#1', 3])
    expect(codes()).toEqual(['DK_DUPLICATE_ROW_KEY'])
    expect(seen[0]?.details).toMatchObject({ key: 1, rows: [0, 1], count: 2, groups: 2 })
    expect(seen[0]?.problem).toContain('2 values are repeated')
  })

  it('a rowKey function', () => {
    const t2 = createTable({ data: users([1, 2, 3, 4]), rowKey: (u) => u.branch, onDiagnostic })
    expect(keys(t2)).toEqual(['b0', 'b1', 'b2', 'b0#1'])
    const d2 = seen[0] as Diagnostic
    expect(d2.code).toBe('DK_DUPLICATE_ROW_KEY')
    expect(d2.details.path).toBeUndefined()
    expect(d2.problem).toContain('the rowKey function returns repeated keys')
    expect(d2.fix[0]).toBe("rowKey: 'id' (unique in all 4 rows)")
  })

  it('reported once per data reference; again for new data', () => {
    const data = users([1, 1])
    const t = createTable({
      data,
      rowKey: 'id',
      onDiagnostic,
      columns: [{ key: 'age' }],
      features: [minFilter('age')],
    })
    void t.getRowModel()
    ;(t as unknown as { setMin(v: number): void }).setMin(1)
    void t.getRowModel()
    expect(codes()).toEqual(['DK_DUPLICATE_ROW_KEY'])
    t.setOptions({ data: users([3, 3]) })
    void t.getRowModel()
    expect(codes()).toEqual(['DK_DUPLICATE_ROW_KEY', 'DK_DUPLICATE_ROW_KEY'])
  })

  it("redaction: 'safe' hashes the key in details and where", () => {
    createTable({
      data: users([5, 5]),
      rowKey: 'id',
      onDiagnostic,
      diagnostics: { redact: 'safe' },
    }).getRowModel()
    const d = seen[0] as Diagnostic
    expect(d.details.key).toMatch(/^h:[0-9a-f]{8}$/)
    expect(d.where).toMatchObject({ kind: 'row', index: 1, key: d.details.key })
  })
})

describe('rowKey: DK_MISSING_ROW_KEY', () => {
  it('missing / null / non-key values get #index; one error', () => {
    const data = [
      { id: 1, uuid: 'a' },
      { uuid: 'b' },
      { id: null, uuid: 'c' },
      { id: { x: 1 }, uuid: 'd' },
      { id: Number.NaN, uuid: 'e' },
      { id: 'ok', uuid: 'f' },
    ] as { id?: unknown; uuid: string }[]
    const t = createTable({ data, rowKey: 'id' as never, onDiagnostic })
    expect(keys(t)).toEqual([1, '#1', '#2', '#3', '#4', 'ok'])
    // Zero-config + a row without `id` also differs in shape (T12, §5.3): reported separately.
    expect(codes()).toEqual(['DK_INCONSISTENT_ROW_SHAPE', 'DK_MISSING_ROW_KEY'])
    const d = seen.find((x) => x.code === 'DK_MISSING_ROW_KEY') as Diagnostic
    expect(d.level).toBe('error')
    expect(d.details).toMatchObject({
      path: 'id',
      rows: [1, 2, 3, 4],
      count: 4,
      total: 6,
      valueType: 'undefined',
      unique: ['uuid'],
    })
    expect(d.where).toEqual({ kind: 'row', index: 1 })
    expect(d.problem).toContain('4 rows have no usable key at "id"')
    expect(d.impact).toContain("'#<index>'")
    expect(d.fix[0]).toBe("rowKey: 'uuid' (unique in all 6 rows)")
  })

  it('a rowKey function returning undefined', () => {
    const t = createTable({
      data: users([1, 2]),
      rowKey: (u) => (u.age === 1 ? (undefined as unknown as string) : u.uuid),
      onDiagnostic,
    })
    expect(keys(t)).toEqual(['u-0', '#1'])
    expect(codes()).toEqual(['DK_MISSING_ROW_KEY'])
    expect(seen[0]?.problem).toContain('the rowKey function returned no usable key for 1 row')
  })

  it('missing and duplicate together: both reported', () => {
    const t = createTable({ data: users([1, null, 1]), rowKey: 'id', onDiagnostic })
    expect(keys(t)).toEqual([1, '#1', '1#1'])
    expect(codes().sort()).toEqual(['DK_DUPLICATE_ROW_KEY', 'DK_MISSING_ROW_KEY'])
  })
})

describe('findUniqueFields', () => {
  it('walks primitive leaves of row 0 (depth ≤ 4), skipping arrays, dates and the rowKey', () => {
    const rows = [
      { id: 1, tags: ['a'], at: new Date(0), a: { b: { c: { d: 'x0', e: { f: 1 } } } } },
      { id: 2, tags: ['b'], at: new Date(1), a: { b: { c: { d: 'x1', e: { f: 2 } } } } },
    ]
    expect(findUniqueFields(rows, 'id').unique).toEqual(['a.b.c.d'])
    expect(findUniqueFields(rows, undefined).unique).toEqual(['id', 'a.b.c.d'])
  })

  it('empty data: nothing', () => {
    expect(findUniqueFields([], 'id')).toEqual({ unique: [] })
  })

  it('a field missing or null in some row is not unique', () => {
    const rows = [
      { id: 1, a: 1, b: 'x' },
      { id: 1, b: 'y' },
      { id: 1, a: null, b: 'z' },
    ]
    expect(findUniqueFields(rows, 'id').unique).toEqual(['b'])
  })
})

describe('rowKey: a throwing getter on the key path', () => {
  it('DK_CALLBACK_FAILED at rowKey only (not also DK_MISSING_ROW_KEY); fallback #index', () => {
    const bad = Object.defineProperty({}, 'id', {
      get() {
        throw new Error('getter')
      },
    })
    const t = createTable({ data: [{ id: 1 }, bad as { id: number }], rowKey: 'id', onDiagnostic })
    expect(keys(t)).toEqual([1, '#1'])
    // The getter row has no enumerable keys, so zero-config also reports its shape (T12, §5.3).
    expect(codes()).toEqual(['DK_INCONSISTENT_ROW_SHAPE', 'DK_CALLBACK_FAILED'])
    const d = seen.find((x) => x.code === 'DK_CALLBACK_FAILED')
    expect(d?.details).toMatchObject({ slot: 'rowKey', rows: [1], count: 1 })
  })
})
